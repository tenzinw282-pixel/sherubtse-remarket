# Render startup repair and verification

For the later migration-stage investigation, bounded runner, unchanged-history audit and exact diagnostic codes, see [MIGRATION_STARTUP.md](MIGRATION_STARTUP.md). The previous root-cause limits still apply: a log excerpt with no fatal line cannot identify the remote failure by itself.

## Confirmed findings

- The earlier `Production requires HTTPS` error is an intentional validation failure: an HTTP `APP_BASE_URL` stops startup before the server binds. `APP_URL` is not consumed. The local development file had subsequently been changed to `https://localhost:3000`; that is also not a valid production origin and breaks local HTTP WebSocket origin checks. Local development is restored to HTTP localhost; private credentials were not changed or committed.
- The public production origin confirmed by the operator is `https://sherubtse-remarket.onrender.com`.
- `engines.node: >=22` allowed Render to choose later major versions. The project now pins Node **22.x**, with `.node-version` and Render's `NODE_VERSION=22`. Node 22.23.4 was downloaded from the official Node distribution and checksum-verified for local testing. There is no evidence that Node 26 itself caused the fatal exit.
- The PostgreSQL SSL warning is a warning, not an exit instruction. A production-like run connected successfully once given a valid origin. Remote PostgreSQL URLs are now always normalized to `sslmode=verify-full`, including weaker legacy modes, while certificate and hostname checks remain enabled. No `rejectUnauthorized:false` or insecure hostname callback is used.
- Startup previously discarded provider error codes and checked only account/session tables. The startup path now reports controlled JSON diagnostics for configuration, migrations, PostgreSQL/Atlas connection, schema, indexes, application loading and port binding. Dependency import failures are inside the error boundary too.
- A Render pre-deploy command is only available on eligible paid services. Startup now runs transactional, checksum-checked, advisory-locked migrations and creates missing MongoDB indexes before listening; the Blueprint no longer depends on a pre-deploy hook. Neon migrations use the direct endpoint of the same configured database, avoiding session-lock problems on transaction pooling. No data reset, destructive migration or new account is performed.

The supplied log excerpt does **not** contain the fatal error after the SSL warning. Without connected private Render logs, the exact cause of that later remote exit cannot be confirmed. This report distinguishes verified code/configuration defects from unknown remote settings. The new diagnostic codes expose the failing stage without exposing credentials.

## Exact Render settings

In **Render Dashboard → sherubtse-remarket → Environment**, configure:

| Variable | Value or source |
| --- | --- |
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `22` — remove an existing `26` override; this setting takes precedence over repo version files |
| `APP_BASE_URL` | `https://sherubtse-remarket.onrender.com` |
| `DATABASE_URL` | Existing Neon PostgreSQL connection string; certificate-verified SSL is enforced |
| `MONGODB_URI` | Existing Atlas URI with valid user, database and TLS settings |
| `SESSION_SECRET` | Private random value, at least 32 characters; preserve it across deployments to retain sessions |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` (STARTTLS required) or `465` (TLS) |
| `SMTP_USER` | Gmail account permitted to send OTP emails |
| `SMTP_PASS` | That account's valid Gmail app password |
| `EMAIL_FROM` | Sender address permitted by the configured account |
| `CLOUDINARY_CLOUD_NAME` | Existing Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Existing Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Existing Cloudinary API secret |

Optional: `DIRECT_DATABASE_URL` to override the direct migration connection, and `ALLOWED_EMAIL_DOMAIN` only if an official college domain is confirmed. Render supplies `PORT`, `RENDER_EXTERNAL_URL` and `RENDER_GIT_COMMIT`; do not copy localhost port settings into production. `RENDER_EXTERNAL_URL` is used only if `APP_BASE_URL` is absent. An explicitly incorrect `APP_BASE_URL` is rejected rather than silently hidden. `APP_URL` is ignored and can be removed.

Service commands:

```text
Build command: npm ci
Start command: npm start
Pre-deploy command: leave empty (startup performs checked migrations/index setup)
Health check path: /health
```

The application binds to `0.0.0.0:process.env.PORT`. Render terminates HTTPS; Express trusts one proxy hop and uses `Secure`, `HttpOnly`, `SameSite=Lax` production cookies. It does not require a local HTTPS listener or local TLS certificate. Health probes remain HTTP-compatible behind the proxy without relaxing cookie security.

**Existing dashboard services:** a Git push does not necessarily apply `render.yaml` environment changes unless the service is Blueprint-managed. Verify these exact Environment values in the dashboard. The private `.env` file is ignored and is not uploaded to GitHub/Render.

## Gmail restriction

Render free web services block outbound SMTP ports 25, 465 and 587. Gmail SMTP requires a service plan that permits those ports. If the service is free, configure an allowed email service/API integration in a separate change or select an appropriate paid instance; no service-plan upgrade was made here. Email verification must never be bypassed. SMTP is checked explicitly with `npm run check:services`, not during server startup, so blocked SMTP does not take the entire marketplace offline.

Sources: [Render Node version precedence](https://render.com/docs/node-version), [Render deployment/pre-deploy behavior](https://render.com/docs/deploys), [Render SMTP restriction](https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports), [Neon transaction pooling](https://neon.com/docs/connect/connection-pooling).

## Diagnostic examples

| Code/stage | Action |
| --- | --- |
| `CONFIG_HTTPS` / `CONFIG_PUBLIC_ORIGIN` | Correct `APP_BASE_URL` in Render Environment |
| `CONFIG_MISSING` | Add exactly the named variables; no values are logged |
| `CONFIG_RENDER_ENV` | Set `NODE_ENV=production` |
| `DATABASE_AUTH_FAILED` | Correct database user/password and URL encoding in the service's environment |
| `DATABASE_TLS_FAILED` | Fix database hostname, CA trust or connection string; keep validation enabled |
| `DATABASE_UNREACHABLE` | Check database availability, DNS, Render outbound access and Atlas/Neon allowlists |
| `DATABASE_SCHEMA_MISSING` | Check startup migration logs and ensure the runtime and migration URLs refer to the intended database |
| `MIGRATION_CHECKSUM_CHANGED` | Restore the applied migration and write a new numbered migration; never reset data |
| `MODULE_NOT_FOUND` in `providerCodes` | Ensure the required file is committed and run `npm ci` under Node 22 |
| `EADDRINUSE` | Check the configured port and duplicate processes |

## Verification and push gate

Local Node 22 production startup uses the real configured service credentials with environment overrides only (`NODE_ENV=production`, the confirmed HTTPS origin and a separate local port). It applies/validates migrations, connects to both databases, validates all 17 required SQL tables plus feature columns, creates MongoDB indexes, serves the site, and checks proxy-secure cookie/HSTS behavior. No credentials, cookies, OTPs or provider response bodies are printed.

The completion report records actual test results. The fast suite includes production URL/SSL/cookie/failure-redaction checks. Real marketplace integration uses isolated temporary PostgreSQL/MongoDB test resources, with SMTP/images mocked. Browser and CLI tests verify existing features. `npm run check:secrets` scans staged source and every unpublished commit for configured credentials, private environment files, private keys and token markers before pushing.

`/health` returns `X-ReMarket-Revision` when Render supplies a valid `RENDER_GIT_COMMIT`. A healthy response with the pushed commit hash confirms the new deployment is serving. Public HTTP availability alone cannot inspect private environment settings, deploy history or SMTP network access. No claim of deployed success is valid without a matching healthy response or authenticated Render deployment status.

## Executed verification

- Official checksum-verified Node **22.23.4**: **42** regression/deployment tests passed.
- Real PostgreSQL/MongoDB marketplace suite: **18** reported tests passed in isolated temporary test resources; email/images mocked.
- Administrator CLI promotion/preservation/idempotence test passed.
- Browser suite: **135** page/viewport combinations passed, including accessibility, password controls, keyboard navigation and reduced motion.
- `npm start` with `NODE_ENV=production`, the confirmed HTTPS origin and a separate local port succeeded: migrations, PostgreSQL schema, Atlas connection/indexes, health, homepage, marketplace, auctions and login.
- Proxy-aware production cookie was `Secure`, `HttpOnly`, `SameSite=Lax`; HSTS was present.
- The configured PostgreSQL database is `neondb`; all **17** required tables and migrations 001–003 were verified. The Node socket confirmed certificate-authorized **TLSv1.3**. A preliminary `pg_stat_ssl` query was unsuitable behind the transaction pooler, so transport was verified on the actual TLS socket instead.
- Gmail SMTP authentication and Cloudinary authenticated connectivity passed locally under Node 22. No OTP, password, API secret or session-cookie value was printed.
- Staged-source and unpublished-history secret gate passed before commit/push. Private `.env` remains untracked.
- The initial public Render health request timed out. A successful deployed result is not claimed here; check the completion message for the post-push outcome.

## Source files in the repair

- Startup/configuration: `server.js`, `app.js`, `config/env.js`, `config/databases.js`, `config/diagnostics.js`, `config/runtime.js`.
- Runtime/deployment metadata: `.node-version`, `.env.example`, `package.json`, `package-lock.json`, `render.yaml`.
- Operations: `scripts/migrate.js`, `scripts/sync-mongo-indexes.js`, `scripts/dev.js`, `scripts/check-secrets.js`.
- Verification/documentation: `tests/deployment.test.js`, `browser/design.spec.js`, `README.md`, `RENDER_DEPLOYMENT.md`.
- Previously uncommitted, tested password/navigation features preserved for deployment: `public/navigation.js`, `public/passwords.js`, `public/styles.css`, `views/login.ejs`, `views/register.ejs`, `views/partials/footer.ejs`, `views/partials/password-input.ejs`.

No application tables or existing user/listing records were deleted. The local private `.env` received only a correction to its development origin and is excluded from Git.
