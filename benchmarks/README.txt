Layerbase and Turso libSQL benchmark

Uses LIBSQL_URL and LIBSQL_AUTH_TOKEN from the repository's .env by default.
Use --provider=turso to select TURSO_URL and TURSO_AUTH_TOKEN. Credentials are
not printed. Requires Node.js 22; no npm dependencies.

First run:
  node benchmarks/run.mjs

Run against the populated benchmark tables:
  node benchmarks/run.mjs --reuse

Run the same schema and workload against Turso:
  node benchmarks/run.mjs --provider=turso --max-concurrency=256

Reuse the populated benchmark tables on Turso:
  node benchmarks/run.mjs --provider=turso --reuse

Create and verify the dataset without timed traffic:
  node benchmarks/run.mjs --seed-only

The schema contains four lbbench_ tables. Initial data consists of 10,000 users,
2,000 projects, and 100,000 events, with foreign keys and secondary indexes.
Writes append 256-byte synthetic payloads to lbbench_writes. Updates increment
benchmark_counter in lbbench_users. Tables and generated data remain available.

The HTTP benchmark measures point lookups, indexed joins returning 20 rows,
single-row inserts, single-row updates, an 80% read / 20% insert workload, and
100-row atomic inserts. Every operation uses one Hrana v2 HTTP pipeline with
one SQL statement and a stream close. TCP/TLS connections are reused.

Each concurrency level uses a two-second warmup and eight-second measurement.
The best error-free level in each workload gets a 20-second confirmation.
All in-flight requests drain before computing elapsed time. Warmup traffic is
excluded from throughput but included in persistence verification. There are
no retries. HTTP errors, SQL errors, and incorrect returned data count as errors.
Each family stops escalating after material errors. Timeouts or HTTP 429 open
a circuit breaker and stop all remaining load; a failed warmup skips measurement.
Latencies are client
end-to-end times, including the network, queueing, and JSON processing.

Defaults bound timed load to 600 seconds, 250,000 requests, and 1,000,000
attempted inserted rows. Default maximum concurrency is 64; the explicit
--max-concurrency option supports values up to 256. Options:
  --duration=8 --confirmation=20 --max-concurrency=64 --max-write-rows=100000
  --families=single_insert,single_update,mixed_80_read_20_insert,batch_insert_100_rows

To measure one concurrency level instead of a ramp, add --concurrency=N
and set --max-concurrency to at least N. For example, a focused read check:
  node benchmarks/run.mjs --provider=turso --reuse --max-concurrency=224 --concurrency=224 --families=point_read

Results, including warmup and measurement counts, latency percentiles, error
samples, CPU/event-loop metrics, query plans, and persistence checks, are saved
after every stage in benchmarks/results/*.json. Final checks compare inserted
rows and counter increments with acknowledged writes, check foreign keys,
and run SQLite quick_check.

After a completed Layerbase run, record post-load availability and persistence:
  node benchmarks/post-load.mjs benchmarks/results/<runId>.json

The helper accepts only a Layerbase report. It runs ten sequential SELECT 1
probes at 35-second intervals, beginning at the report's finishedAt (offsets
0, 35, ..., 315 seconds). If started after finishedAt, it begins immediately
and keeps 35 seconds between probes. Each probe uses a fresh one-socket client
with a five-second timeout and no retries. It then appends one 256-byte
diagnostic write, checks its row and payload separately, recounts the original
run's rows against acknowledged inserts plus the diagnostic write, and checks
counter deltas only when the counter still matches the source report's
baseline. Incremental results are saved to
benchmarks/results/<runId>-post-load.json; the source report is not modified.

These are measurements from one remote client with warmed data, rather than
an isolated database-engine ceiling. Database size is page_count * page_size;
this excludes transient WAL, server replicas, and filesystem overhead.

Protocol reference:
https://github.com/tursodatabase/libsql/blob/main/docs/HRANA_3_SPEC.md
