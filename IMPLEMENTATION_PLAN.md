# Sherubtse ReMarket implementation plan

## Phase 1 — Foundation

Deliver the Node/Express/EJS structure, validated environment configuration, PostgreSQL pool and persistent session configuration, MongoDB schemas, migrations, SMTP/Cloudinary clients, security headers, session CSRF protection, health endpoint, graceful shutdown, deployment skeleton, and foundation tests. No product data or authentication is simulated.

Completion gate: dependency installation, foundation tests, syntax checks; live database migration and connectivity checks require provisioned services. SMTP and Cloudinary client construction does not prove delivery or upload.

## Phase 2 — Accounts

Implement registration validation, bcrypt hashing, six-digit cryptographic OTP generation, protected challenge hashes, five-minute expiry, five-attempt locking, resend cooldown, per-email/IP limits, real SMTP templates, verification, session-regenerating login, logout, password reset/change, and email-change reverification. Keep email and affiliation verification distinct. Add verified/student/admin middleware. Implement secure CLI admin bootstrap; never public admin registration.

Tests: registration, duplicate email behavior, correct/incorrect/expired OTP, resend and IP limits, failed delivery, login/logout, password reset, session invalidation, CSRF. Mock SMTP in tests only.

## Phase 3 — Marketplace and responsive interface

Build shared navigation/footer, home, marketplace, details, listing create/edit, profile, about, contact, and terms/privacy. Add PostgreSQL search, filters, sort, pagination, owner permissions, Cloudinary uploads with decoded file signature/type checks, size/count limits and cleanup. Use navy, white, gold, responsive Bootstrap and accessible forms. Never seed fake product listings.

Tests: listing persistence, image failures and validation, search/filter combinations, edit/delete permissions. Check keyboard navigation and mobile/desktop layouts.

## Phase 4 — Fixed-price transactions

Use a PostgreSQL transaction to lock and reserve an available item and create its pending transaction. Validate buyer/seller distinction. Implement purchases/sales pages, handover/receipt confirmations, cancellation and disputes. Complete only after both parties confirm; describe cash on collection without accepting payment credentials.

Tests: purchases, simultaneous reservations, duplicates, participant permissions, state transitions and cancellation policy.

## Phase 5 — Auctions

Create auctions with validated start/end/increment. Lock the auction row before validating each bid using database time and exact decimal arithmetic. Commit before broadcasting. Add authenticated/verified socket connections with refreshed user status and room authorization. Implement history, countdown with server time, highest bidder, and bid counts.

Implement restart-safe recurring reconciliation selecting overdue rows with locks. Closing must produce at most one transaction and durable outbox events. Reconcile at startup as well as periodically; Render restarts must not lose deadlines.

Tests: valid/invalid/self bids, suspended users, simultaneous bids against a real separate PostgreSQL database, deadline boundary, winner selection, empty auctions, repeated closure, notification retry and commit-before-broadcast behavior.

## Phase 6 — Student tools

Build unified dashboard and statistics, favorites, MongoDB conversations/messages with participant checks, unread counts and history, notifications and mark-read, transaction reviews. Add PostgreSQL outbox dispatcher with deduplicated MongoDB notifications and safe retries. Store PostgreSQL user references only in MongoDB. Never treat MongoDB delivery failure as a rollback of a purchase or bid.

Tests: message authorization and room joins, review eligibility, favorites, duplicate notification delivery, read/unread state, worker recovery.

## Phase 7 — Administration and security

Build statistics, user suspension, listing moderation, reports, auction inspection, disputes and audit views. Require admin authorization on every endpoint; audit moderation in PostgreSQL and project noncritical activity into MongoDB. Recheck suspended status on HTTP/socket actions. Review validation, escaped output, uploads, rate limits, secrets and authorization across all implemented endpoints.

Tests: admin access control, suspension/session effects, reports, disputes, audit creation and unsafe inputs.

## Phase 8 — Release checks and deployment

Complete automated coverage of all 20 test scenarios from the brief. Use isolated PostgreSQL/MongoDB test databases for integration/concurrency tests and mock email/image services. Run regression and browser checks. Finalize Render configuration, GitHub instructions, troubleshooting, service setup and operational runbook. Validate a real SMTP email and Cloudinary upload with configured accounts before claiming those integrations work. Publish only to user-authorized accounts with available credentials.

## Phase reporting

After each phase record files changed, checks run and outcomes, run instructions, required external configuration, remaining work and verification limits. No feature is considered verified merely because its code exists.
