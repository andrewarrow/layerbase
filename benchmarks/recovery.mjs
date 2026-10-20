import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { HranaClient, loadConfig } from './libsql-stress.mjs';

const reportPath = process.argv[2];
if (!reportPath) throw new Error('Usage: node benchmarks/recovery.mjs path/to/result.json');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const config = loadConfig(report.provider ?? 'layerbase');
report.recoveryChecks ??= [];
const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
function objects(result) {
  return result.rows.map(row => Object.fromEntries(result.cols.map((col, i) => [col.name,
    row[i].type === 'integer' ? Number(row[i].value) : row[i].value ?? null])));
}
let recovered = false;
for (let attempt = 0; attempt < 10; attempt++) {
  if (attempt > 0) await delay(20_000);
  const client = new HranaClient({ ...config, timeoutMs: 5_000, maxSockets: 1 });
  const check = { at: new Date().toISOString() };
  try {
    const before = performance.now();
    await client.execute('SELECT 1 AS healthy');
    check.healthy = true;
    check.elapsedMs = performance.now() - before;
    recovered = true;
  } catch (error) {
    check.healthy = false;
    check.code = error.code;
    check.message = error.message;
  } finally { client.close(); }
  report.recoveryChecks.push(check); save(); console.log(JSON.stringify(check));
  if (recovered) break;
}
report.recoveryStatus = recovered ? 'healthy' : 'still unavailable after bounded cooldown';
if (recovered) {
  const client = new HranaClient({ ...config, timeoutMs: 15000, maxSockets: 1 });
  try {
    report.recoveryVerification = objects(await client.execute(`SELECT
      (SELECT count(*) FROM lbbench_writes WHERE run_id=?) AS persistedInserts,
      (SELECT sum(benchmark_counter) FROM lbbench_users) AS updateCounterAfter,
      (SELECT count(*) FROM lbbench_writes WHERE run_id=? AND length(payload)<>256) AS invalidPayloads,
      (SELECT count(*) FROM lbbench_users) AS users,(SELECT count(*) FROM lbbench_projects) AS projects,
      (SELECT count(*) FROM lbbench_events) AS events,
      (SELECT page_size FROM pragma_page_size)*(SELECT page_count FROM pragma_page_count) AS databaseBytes`,
    [report.runId, report.runId]))[0];
    const verified = report.recoveryVerification;
    verified.persistedBeyondAcknowledged = verified.persistedInserts-report.accounting.acknowledgedInsertRows;
    verified.updateCountMatchesAcknowledged = verified.updateCounterAfter-report.updateCounterBefore===report.accounting.acknowledgedUpdates;
    verified.foreignKeyViolations = objects(await client.execute('PRAGMA foreign_key_check')).length;
    verified.quickCheck = objects(await client.execute('PRAGMA quick_check(1)'));
    report.recoveredAt = new Date().toISOString();
    console.log(JSON.stringify({ verification: verified }));
  } catch (error) { report.recoveryVerificationError = { code: error.code, message: error.message }; }
  finally { client.close(); }
}
save();
