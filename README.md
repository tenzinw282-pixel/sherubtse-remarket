# Sherubtse ReMarket

Buy Smart â€¢ Sell Easy â€¢ Bid Better

A student marketplace for Sherubtse College, Bhutan. One Express service serves EJS, API routes and Socket.IO. PostgreSQL owns transactional state; MongoDB owns messaging, notifications and activity records.

## UI redesign — Phase 1

The design-system foundation is implemented across existing pages: the requested navy/gold palette, locally served Inter, shared typography/spacing/control tokens, responsive navigation and footer, form/content cards, focus indicators, skip navigation and reduced-motion support. No schema changes or account changes are needed. See [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) for component rules and [REDESIGN_PLAN.md](REDESIGN_PLAN.md) for the audit and remaining implementation phases.

Run `npm test` for backend/HTTP regressions and `npm run test:ui` for browser layout/accessibility checks. On Windows the latter uses installed Microsoft Edge; set `BROWSER_CHANNEL` if using another installed Playwright-supported channel. Other platforms need the corresponding Playwright browser installed. Browser tests use synthetic data in an isolated local fixture, not real accounts. Screenshots are saved in ignored `artifacts/design-system/`. The expanded suite checks 135 page/viewport combinations at 320, 375, 768, 1024 and 1440px, axe WCAG scans, skip-link keyboard focus, reduced motion and enlarged text reflow. Automated scans are not a full WCAG certification.

The later implementation now includes marketplace, profiles, dashboards, approvals, transactions, auctions, messaging and admin management. The original compact exchange SVG is in `public/brand/icon.svg`. See [COMPLETION_STATUS.md](COMPLETION_STATUS.md) for the current audit, verification and remaining limits; earlier design/implementation plans are historical roadmaps.

**Current status: connected student marketplace.** Accounts, profile/avatar editing, searchable approved listings, unified dashboards, purchases/handover/receipt/reviews, real-time bidding and reliable auction closure, admin approvals/management, conversations and notifications are implemented. Password recovery and some further refinements remain outstanding. This has not been deployed or certified for public production use.

## Administrator setup and approval workflow

Run `npm run admin:create` from a trusted terminal (`npm.cmd run admin:create` on PowerShell). Enter the administrator email. For a new account, enter its name and a strong password; password input is hidden. For an existing account, explicitly type `PROMOTE` to confirm the role change. Promotion preserves its password, profile, listings and history. Alternatively provide `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD`, and, only when intentionally promoting an existing account, `ADMIN_CONFIRM_PROMOTION=PROMOTE` through a protected shell environment; never put passwords in command arguments or commit them. No default administrator is created.

Log in at `/login` with the account's own credentials. New/unverified accounts must finish real emailed OTP verification before `/admin` access. Existing administrators remain subject to verification and suspension checks. Students cannot set their role through registration. The protected CLI has been tested for explicit promotion, account/listing preservation and idempotence in an isolated database schema.

Every student submission now starts **Pending Review**. In `/admin/approvals`, inspect the listing and supply a reason to approve/reject. Approved available products appear in the homepage and marketplace. Hidden products remain visible only to their owner or an admin. Editing resubmits for review; listings with bids or active transactions cannot be edited or withdrawn. Existing product records were retained and now require review too.

## Marketplace and auctions

Browse `/marketplace` or `/auctions`, save favorites on product details, and use `/sell` to submit fixed-price or auction listings. Auction start/end defaults synchronize to PostgreSQL time, and submitted times are stored in UTC. An administrator must approve before bidding. One account supplies buyer and seller capabilities through `/dashboard` and its listings/purchases/sales/bids/won-auctions/favorites sections.

Fixed-price buying reserves the item atomically. Arrange collection/payment outside the site. The seller confirms handover in My Sales; the buyer confirms receipt in My Purchases. Both confirmations complete the transaction and enable reviews. Participants can cancel before handover or open a dispute; administrators can resume a disputed transaction or cancel it and remove the listing. No payment credentials are accepted.

Bidding validates exact decimal amounts under PostgreSQL row locks; self-bids, early/late bids, unapproved items and suspended users are rejected. Socket.IO broadcasts committed bids; HTTP polling reconciles state after missed events. A five-second worker plus startup reconciliation closes overdue auctions and creates at most one winner transaction, then delivers persistent outbox notifications. Keep the Render service active for prompt reconciliation; downtime is recovered on restart. See My Won Auctions for winning purchases.

Use Contact Seller on a listing, or Contact Buyer/Seller on a transaction, to start a private product conversation. `/messages` enforces participant authorization, stores messages in MongoDB and delivers socket events. `/notifications` shows persisted updates with private read actions.

## Complete workflow tests

Run `npm test`, `npm run test:admin`, `npm run test:integration`, and `npm run test:ui`. The integration suites create only isolated test schemas/databases and remove those resources afterward; credentials must have those permissions. Email/images are mocked in workflow tests. Optional `TEST_DATABASE_URL` and `TEST_MONGODB_URI` may point to separately provisioned test services. Do not interrupt integration-test cleanup. Browser testing requires installed Edge on Windows (or an installed Playwright channel configured by `BROWSER_CHANNEL`).

## Publishing the current source

Review `git status` and `git diff`, confirm `.env` is ignored and untracked, then stage reviewed source, commit, and push to your configured private GitHub remote. No push, account promotion or production deployment is performed automatically. Render's existing build/pre-deploy/start commands are preserved: `npm ci`, `npm run migrate && node scripts/sync-mongo-indexes.js`, `npm start`. Set the actual HTTPS `APP_BASE_URL`, all service secrets, and `NODE_ENV=production`; use `/health` for readiness. The same service serves Socket.IO. Apply migration 003 before running the new code and create your administrator through a protected shell.

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

For standalone migration checks, set `TEST_DATABASE_URL` to a separate disposable PostgreSQL database with `test` in its name and run `npm run test:database`. This command checks migration repeatability and category data. The full `test:integration` command separately verifies real transactions/concurrency in an isolated schema, as described above.

## Structure

- `app.js`, `server.js`: HTTP composition, authenticated Socket.IO setup, reconciliation jobs and graceful server lifecycle.
- `config/`: environment validation and PostgreSQL, MongoDB, SMTP and Cloudinary setup.
- `middleware/`: security middleware, including session-bound CSRF checks.
- `migrations/`, `scripts/`: transactional, checksum-tracked SQL migrations and index setup.
- `models/`: Mongoose conversation, message, notification and activity schemas.
- `views/`, `public/`: shared EJS layouts, marketplace/account/admin pages, browser interactions and local Bootstrap/Inter assets.
- `routes/`, `services/`, `jobs/`: HTTP routes, catalog/transaction/bidding/approval logic and outbox/reconciliation workers.
- `tests/`, `integration/`, `browser/`: fast regressions, isolated real-database/CLI tests and browser accessibility/layout checks.

Currency uses PostgreSQL `numeric(12,2)` and JavaScript BigInt cents for comparisons/increments. Timestamps use `timestamptz`; auction deadlines use database time. Migrations use a PostgreSQL advisory lock and per-file transaction. Use a direct Neon URL for migration/test operations requiring session-level settings or locks. Never edit applied migrations; add a new numbered file.

## GitHub and Render

Use your existing private GitHub repository and remote. Review `git status` and `git diff`, verify `.env` is ignored/untracked, stage only reviewed source, then commit and push to your intended branch. If no remote is configured, add the private repository's remote before pushing. No commit or push was performed automatically.

In Render, connect the repository and use `render.yaml` as a Blueprint, or create a Node web service with build `npm ci`, pre-deploy `npm run migrate && node scripts/sync-mongo-indexes.js`, start `npm start`, and health path `/health`. Use a service plan supporting pre-deploy commands; otherwise run migrations/index setup from a controlled shell before starting the service. Set the environment values from `.env.example`, set `NODE_ENV=production` and `APP_BASE_URL` to your actual HTTPS origin. Render supplies `PORT`. No deployment URL is assumed.

Set database network access for Render and verify the health endpoint. PostgreSQL persists sessions, Atlas persists documents and Cloudinary persists uploads; no persistent Render filesystem is needed. Configure one trusted Render proxy hop, HTTPS and secure cookies. Complete real service acceptance and the remaining release checks in `COMPLETION_STATUS.md` before a public launch.

## Troubleshooting

- **PowerShell execution policy:** use `npm.cmd` without changing machine policy.
- **Missing environment variables:** create `.env` in the repository root and fill required values. Use a random session secret rather than the example placeholder.
- **Startup failure:** check database credentials, TLS, DNS and network allowlists; run migrations. Errors intentionally omit connection strings.
- **Session table missing:** run `npm run migrate` against the same database used by the web service.
- **Failed running server.js:** read the startup message above the watcher notice. Startup checks report missing session/verification tables; run `npm.cmd run migrate` and restart. Database connection failures include redacted guidance for authentication, DNS or firewall problems.
- **Port already in use:** only run one development server. If `http://localhost:3000/health` responds, open the existing website; otherwise identify the process using your configured port or set a free `PORT` in `.env` before restarting.
- **Health 503:** check both database services. SMTP and Cloudinary are not health dependencies.
- **CSRF 403:** reload the form and submit the session token as `_csrf` or `X-CSRF-Token`. Cookies must be enabled.
- **Production session cookie absent:** verify HTTPS, the Render proxy and `NODE_ENV`; local development uses HTTP-compatible cookies.
- **Changed migration checksum:** restore the applied migration and create a new migration for changes.

## Verification record

The regression suite, real PostgreSQL/MongoDB marketplace suite, actual CLI promotion test and expanded browser suite have been executed. See the completion report and `COMPLETION_STATUS.md` for final counts and limits. SMTP authentication and an actual Cloudinary upload/delete succeeded in earlier work. Automated workflow tests mock email/image providers and do not send messages to real students.

Database-backed registration, approvals, concurrent buying/bidding, auction closure, messages, notifications and admin pages are covered by integration tests. Layout and automated accessibility are checked at five widths. Render deployment, manual screen-reader acceptance and final real student inbox delivery are not claimed.

