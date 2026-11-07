# Migration startup audit and repair

## What was actually established

The complete supplied Render log stops after the migration-stage announcement and contains no fatal error, SQLSTATE, timeout duration or termination signal. Therefore it cannot establish which remote check failed. The earlier `APP_URL` warning is informational and does not stop the process.

The configured local Neon database was audited directly under Node 22.23.4:

- `DATABASE_URL` is a pooled Neon URL; no local `DIRECT_DATABASE_URL` override is configured.
- The runner derives a direct endpoint for the same Neon branch/database and retains certificate/hostname verification.
- The connected database is `neondb`, schema `public`; schema USAGE/CREATE and migration-history SELECT/INSERT are available.
- Migrations 001, 002 and 003 have exact stored checksum matches against both local files and committed Git contents. The local audit does **not** indicate a checksum mismatch.
- The migration advisory lock was immediately available at audit time. This does not establish the lock state during a different Render deployment.
- The existing migration command succeeded before the repair. The corrected runner then checked all three migrations and applied **zero** new migrations to the configured application schema.

These observations do not prove Render is using identical secret environment values or network permissions. The exact remote failure remains unconfirmed until the new per-step diagnostic or authenticated Render logs identify it. No guessed failure is represented as a confirmed root cause.

## Confirmed code defects fixed

1. Failure reporting previously occurred only after cleanup. A stalled `pool.end()` could prevent the original failure from reaching the server's logger. SQL rollback/unlock failures could also replace the original error. Errors are now synchronously written before cleanup, and the original failure is retained. Tests explicitly reproduce both cleanup-error masking and stalled cleanup.
2. Advisory-lock acquisition was unbounded. The runner now uses a bounded nonblocking advisory-lock loop, PostgreSQL statement/object-lock timeouts, a connection timeout and an overall migration watchdog. The watchdog keeps the process alive until a result or explicit fatal diagnostic; it never bypasses a check.
3. Startup had no signal diagnostics before HTTP readiness. SIGTERM/SIGINT during initialization now reports `STARTUP_INTERRUPTED` and the current stage before exiting. A forced kill such as SIGKILL cannot be logged by application code.
4. Checksum verification used raw checkout bytes. SQL files now have an explicit LF Git checkout rule, and verification recognizes exact LF/CRLF variants of the same source. Substantive SQL changes remain fatal. Existing stored checksums and timestamps are **never updated** to accommodate a change.
5. The runner now preflights every applied checksum and dependency before applying any pending SQL, checks numeric ordering/duplicates/history gaps/missing source files, and rejects a `DIRECT_DATABASE_URL` pointing to a different Neon branch/database before opening that migration connection.
6. An already-existing history table is read rather than subjected to an unnecessary CREATE command on every boot. DDL permissions are still required for missing history or pending migrations; checksum and history validation are unchanged.

No production tables or existing data/history records were dropped, recreated, reset or deleted. Each new migration and its history insert still commit in the same PostgreSQL transaction. No TLS verification was disabled.

## Render configuration

In **Render → service → Environment**:

- Keep `DATABASE_URL` pointing to the intended Neon application database. A pooled URL is appropriate for application transactions.
- `DIRECT_DATABASE_URL` is optional. If present, it must come from the same Neon branch and database with pooling disabled. It can use a separately authorized migration role. Correct or remove a wrong/placeholder override. Its value is never logged.
- Without an override, the runner removes the Neon `-pooler` hostname suffix itself and enforces `sslmode=verify-full`.
- `APP_URL` can be removed because the canonical public origin is `APP_BASE_URL`; that warning is unrelated to migration failure.
- No new mandatory variables are introduced. Optional bounds are `MIGRATION_CONNECT_TIMEOUT_MS=30000`, `MIGRATION_LOCK_TIMEOUT_MS=15000`, `MIGRATION_STATEMENT_TIMEOUT_MS=60000`, and `MIGRATION_TIMEOUT_MS=90000`. Values are positive milliseconds, at most 600000. Inspect the actual failure before raising them; do not disable locks or checksum checks.

Use `npm run migrate:diagnose` in an environment with the actual Render database variables to audit connection-source identity, permissions, exact/LF/CRLF checksum matches and lock availability. The audit does not run SQL migrations or change history; its nonblocking advisory-lock probe is immediately released.

## Reading the new startup logs

Startup reports `migration-source`, `migration-connect`, `migration-settings`, `migration-lock`, `migration-history`, `migration-checksum`, `migration-sql`, and `migration-applied` steps. Success includes the number verified/applied.

Failures include a controlled `code`, original sanitized SQLSTATE/network codes in `providerCodes`, the operation and migration filename when known. SQL text, passwords, tokens and full connection strings are not logged.

| Code | Meaning and next action |
| --- | --- |
| `MIGRATION_DATABASE_MISMATCH` | Correct/remove the direct override; no SQL ran on that target |
| `MIGRATION_CONNECT_TIMEOUT` | Check direct Neon availability, DNS, Render network access and connect timeout |
| `DATABASE_AUTH_FAILED` / `MIGRATION_AUTHORIZATION_FAILED` | Check database login and access policy |
| `MIGRATION_PERMISSION_DENIED` (`42501`) | Use an authorized migration role with schema/history permissions and ownership/membership needed for DDL |
| `MIGRATION_LOCK_TIMEOUT` | Inspect concurrent migration/DDL sessions; do not delete history or terminate sessions blindly |
| `MIGRATION_STATEMENT_TIMEOUT` (`57014`) | Inspect the named SQL operation and database contention |
| `MIGRATION_CHECKSUM_CHANGED` | Restore the applied SQL file and add a new numbered migration for changes |
| `MIGRATION_SOURCE_MISSING` / `MIGRATION_HISTORY_GAP` | Inspect source deployment and history in the intended database; do not reset them |
| `MIGRATION_SQL_SYNTAX` (`42601`) | Fix the named unapplied migration; a failed transaction is rolled back |
| `MIGRATION_TOTAL_TIMEOUT` | Overall startup bound reached; its message names the last phase, including stalled cleanup |
| `STARTUP_INTERRUPTED` | Platform/process termination occurred before readiness; inspect Render deployment cancellation/termination information |

## Verification

`npm test` covers the existing application plus migration failure cases. `npm run test:migrations` executes the actual migration SQL in a uniquely named temporary schema, verifies unchanged records/history on rerun, rollback on syntax/statement timeout errors, independent lock contention, and exactly-once concurrent application. The test uses its own advisory-lock key and cleans up only its temporary schema; application records and migration locks are not altered.

The final completion message records executed results and the pushed commit. Production-mode `npm start` was also exercised on a separate local port using the confirmed public origin; health, homepage, marketplace, auctions and login returned HTTP 200 after migration verification. This establishes successful startup with the configured credentials, not a confirmed successful remote Render deployment.

Executed under Node 22.23.4: **57** regression/unit tests passed, including **15** focused migration cases; **6** reported real-database migration tests passed (five scenarios plus their parent). The application-database audit and migration verification succeeded with **0 newly applied** and no edits to existing history. The SQL files in `migrations/` have no source changes in this repair.

Changed files: `.gitattributes`, `.env.example`, `server.js`, `config/databases.js`, `config/diagnostics.js`, `scripts/migrate.js`, `scripts/diagnose-migrations.js`, `scripts/check-secrets.js`, `package.json`, `tests/foundation.test.js`, `tests/migrations.test.js`, `tests/deployment.test.js`, `integration/migrations.spec.js`, `MIGRATION_STARTUP.md`, and `RENDER_DEPLOYMENT.md`. The secret gate's assignment regex was also corrected so an empty optional variable does not consume the following comment as its value; actual secret detection remains enforced.
