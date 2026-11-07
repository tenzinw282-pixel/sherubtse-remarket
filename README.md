# Sherubtse ReMarket

Buy Smart â€¢ Sell Easy â€¢ Bid Better

A student marketplace for Sherubtse College, Bhutan. One Express service serves EJS, API routes and Socket.IO. PostgreSQL owns transactional state; MongoDB owns messaging, notifications and activity records.

**Current status: foundation plus email registration and product uploads.** Registration, emailed OTP verification, login/logout and fixed-price listing creation with Cloudinary images are implemented. Buying, auctions, messaging, dashboards, password recovery and moderation remain planned. See [the detailed plan](IMPLEMENTATION_PLAN.md). This is not yet a production marketplace.

## Local setup

Requires Node.js 22+, Neon PostgreSQL (or local PostgreSQL 15+), MongoDB Atlas (or local MongoDB), Cloudinary, and an SMTP provider.

1. Run `npm ci` (`npm.cmd ci` if PowerShell blocks npm.ps1).
2. Copy `.env.example` to `.env` and replace every service placeholder. Do not commit `.env`.
3. Generate a session secret using `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"` and put it in `.env`.
4. Run `npm run migrate` to create PostgreSQL tables and real category reference data. No users or listings are seeded.
5. Run `node scripts/sync-mongo-indexes.js` to create MongoDB indexes.
6. Run `npm run dev`, then open `http://localhost:3000`.

Configuration fails closed when required environment values are missing. Service clients do not verify SMTP delivery or Cloudinary credentials at startup. Both databases must connect before HTTP starts. `/health` returns 200 only if both databases respond; otherwise 503. Health checks do not allocate sessions.

Use a Neon connection string with certificate verification enabled. Use the Atlas connection string supplied for your cluster, create a database user restricted to the app database, and configure network access for your runtime. Set SMTP host, port, credentials and a verified sender (`EMAIL_FROM`); port 465 uses TLS immediately, other ports require SMTP STARTTLS. Cloudinary requires its cloud name, API key and API secret. None of these secrets goes to the browser.

Leave `ALLOWED_EMAIL_DOMAIN` empty unless the college confirms the official domain. Email verification will not imply verified college affiliation.

## Tests

`npm test` runs foundation tests without external accounts. Tests use stubbed database probes and a memory session store explicitly supplied by tests; runtime always uses PostgreSQL sessions. Tests cover configuration validation, health behavior, security headers/cookies, CSRF rejection, 404 rendering and migration rollback orchestration. They do not establish that a real database accepts the schema.

Additional account/upload tests cover registration hashing, SMTP failure handling, OTP expiry, incorrect attempts, reuse, resend invalidation, account and IP limits, complete HTTP registration/verification/login/logout with test adapters, image type/size validation, verified-account authorization, listing persistence and cleanup after database failure. Email, Cloudinary and PostgreSQL are mocked in automated feature tests; these are not live registration database tests.

## Email registration and product images

1. Fill real `DATABASE_URL` and `MONGODB_URI` values in your private `.env`. A session secret must be random and at least 32 characters. Never put credentials in `.env.example`.
2. Run `npm run migrate` (includes `002_otp_delivery.sql`) and `node scripts/sync-mongo-indexes.js`.
3. Run `npm run check:services` to check SMTP authentication/TLS and Cloudinary authenticated API access. This does not send email and never prints provider response bodies, credentials or OTPs.
4. Optionally run `npm run check:upload`. This uploads a disposable one-pixel PNG using the actual product-upload service and deletes it immediately. No product listing is created.
5. Run `npm run dev`, open `/register`, and submit your student details. A real OTP email is sent to the submitted address. Check spam/junk if necessary.
6. Open `/verify-email`, submit the code, then log in at `/login` and open `/sell` to upload product images. A successful listing redirects to its product details page.

Registration uses bcrypt and cryptographic six-digit OTPs protected with a challenge-specific HMAC using the session secret. Codes expire five minutes after issuance; each code permits five wrong attempts. Resending waits at least 60 seconds, invalidates earlier codes and allows five requests per account per hour. IP limits also apply. No OTP is logged or returned in HTTP responses. Only SMTP-accepted messages are marked delivered; failed sending invalidates the challenge and leaves the account unverified. SMTP acceptance does not guarantee inbox delivery. To recover after a closed registration session, log in with the unverified account and use resend.

Images require a verified, non-suspended account and session-bound CSRF token. The browser sends the token in the `X-CSRF-Token` header before multipart parsing. JPEG/PNG/WebP file signatures and declared types are checked, then Cloudinary decodes and re-encodes to WebP with dimensions limited to 1600px. Maximum five images, 5 MB each. Image bytes remain in bounded memory and are not written to disk. PostgreSQL stores only Cloudinary asset IDs/HTTPS URLs alongside the authenticated seller ID. Failed listing saves trigger uploaded-asset cleanup; if Cloudinary cleanup is unavailable, a redacted operator message asks you to inspect unused assets. Crash recovery for orphan uploads is future work.

### Service troubleshooting

- Gmail: use `SMTP_HOST=smtp.gmail.com`, port `587` (required STARTTLS) or `465` (TLS), your full Gmail address as `SMTP_USER`, and a current app password as `SMTP_PASS`. Enable 2-Step Verification; a normal account password is not sufficient. Set `EMAIL_FROM` to a sender your account permits.
- Authentication failure: update the app password or Cloudinary credentials in `.env`, restart the app, then rerun the checks. For Cloudinary, all three values must belong to the same active cloud account.
- DNS/timeouts: check host spelling, firewall, outbound SMTP restrictions and runtime network access. Keep certificate verification enabled. Some hosting plans restrict SMTP; use an allowed SMTP provider/port and a plan permitting outbound email.
- Sender/recipient rejection: check the email address, sender verification, provider sandbox restrictions and sending limits. No verification bypass is offered.
- Upload errors: check account quota, supported file formats and upload restrictions. `check:services` verifies API access; `check:upload` separately verifies upload and delete permissions.
- A `delivered_at` database error means migration `002_otp_delivery.sql` has not been applied.
- If credentials were accidentally placed in a tracked file or shared output, rotate the SMTP app password and Cloudinary secret, update `.env`, and remove the exposed values from repository history if committed.

For real migration checks, set `TEST_DATABASE_URL` to a separate disposable PostgreSQL database with `test` in its name and run `npm run test:database`. This command applies migrations and checks repeatability and category data. Never point it at application data. Real concurrency/auction/authentication tests arrive with their respective phases.

## Structure

- `app.js`, `server.js`: HTTP composition, server lifecycle and Socket.IO foundation. Socket connections are rejected until authentication is implemented.
- `config/`: environment validation and PostgreSQL, MongoDB, SMTP and Cloudinary setup.
- `middleware/`: security middleware, including session-bound CSRF checks.
- `migrations/`, `scripts/`: transactional, checksum-tracked SQL migrations and index setup.
- `models/`: Mongoose conversation, message, notification and activity schemas.
- `views/`, `public/`: shared EJS partials, development landing page and styles; Bootstrap assets served locally.
- `controllers/`, `routes/`, `services/`, `jobs/`: reserved for subsequent feature phases.
- `tests/`: automated checks.

Currency uses PostgreSQL `numeric(12,2)`; future services must retain strings/decimal arithmetic rather than JavaScript floating point. Timestamps use `timestamptz` and pool timezone UTC. Migrations use a PostgreSQL advisory lock and per-file transaction. Never edit applied migrations; add a new numbered file.

## GitHub and Render

Create a private GitHub repository. From this directory run `git init`, `git add .`, `git commit -m "Initialize ReMarket foundation"`, then add the remote provided by GitHub and push. Inspect staged files first and ensure `.env` is excluded. No repository or remote is created automatically by this phase.

In Render, connect the repository and use `render.yaml` as a Blueprint, or create a Node web service with build `npm ci`, pre-deploy `npm run migrate && node scripts/sync-mongo-indexes.js`, start `npm start`, and health path `/health`. Use a service plan supporting pre-deploy commands; otherwise run migrations/index setup from a controlled shell before starting the service. Set the environment values from `.env.example`, set `NODE_ENV=production` and `APP_BASE_URL` to your actual HTTPS origin. Render supplies `PORT`. No deployment URL is assumed.

Set database network access for Render and verify the health endpoint. PostgreSQL persists sessions, Atlas persists documents and Cloudinary will persist uploads; no persistent Render filesystem is needed. Configure only one trusted Render proxy hop, HTTPS and secure cookies. Deployment is premature for public marketplace use until later phases pass their gates.

## Troubleshooting

- **PowerShell execution policy:** use `npm.cmd` without changing machine policy.
- **Missing environment variables:** create `.env` in the repository root and fill required values. Use a random session secret rather than the example placeholder.
- **Startup failure:** check database credentials, TLS, DNS and network allowlists; run migrations. Errors intentionally omit connection strings.
- **Session table missing:** run `npm run migrate` against the same database used by the web service.
- **Health 503:** check both database services. SMTP and Cloudinary are not health dependencies.
- **CSRF 403:** reload the form and submit the session token as `_csrf` or `X-CSRF-Token`. Cookies must be enabled.
- **Production session cookie absent:** verify HTTPS, the Render proxy and `NODE_ENV`; local development uses HTTP-compatible cookies.
- **Changed migration checksum:** restore the applied migration and create a new migration for changes.

## Phase 1 verification record

Executed: all 29 foundation/account/upload tests passed. SMTP authenticated connection succeeded. Cloudinary authenticated API check, actual upload through the product image service, and deletion of the temporary test asset succeeded. No test email was sent to an unspecified recipient. Live database-backed registration remains unverified while database connection values are placeholders.

Live Neon/Atlas migrations, SMTP delivery, Cloudinary uploads and Render deployment require real credentials and are not verified by offline tests. Browser responsiveness has not been checked. Subsequent phases must supply real feature implementations before their functionality is claimed.

