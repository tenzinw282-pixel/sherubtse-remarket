# ReMarket implementation and verification

This records the current implementation rather than the earlier phased proposals.

## Audit before this update

Working: email registration/OTP verification, login/logout, secure PostgreSQL sessions, Cloudinary listing uploads, basic product details, database connections and migrations, and the shared UI foundation. Present only as schema/infrastructure: auctions/bids, transactions, favorites, reports, admin actions and MongoDB messaging/notifications. Missing: database-backed homepage, marketplace search/browse, profiles/dashboard, product moderation, purchase lifecycle, bidding/closure, administrator bootstrap/management, messages and notification views.

## Implemented

- Homepage with original exchange icon, search, category links, recently approved products, real featured products, live auctions, announcements and responsive navigation. Empty states reflect actual data.
- Public marketplace with category/condition/type/price filters, search, sort and pagination. Pending, rejected, removed and suspended-seller listings are excluded from public browsing.
- Public student profiles; private profile editing with Cloudinary avatar, bio and optional private student ID.
- Unified student overview, listings, purchases, sales, bids, won auctions and favorites, with real PostgreSQL statistics and data.
- Fixed-price or auction creation, bounded Cloudinary uploads, local image previews, owner-only text/price/category/date editing, reapproval after edits, and eligible withdrawal without deleting records. Existing images are preserved on edit.
- Pending-review workflow on all listings. Only the owner or an administrator can inspect a hidden product. Approval/rejection decisions are audited and generate durable notifications. No unapproved buying or bidding.
- Locked fixed-price reservation, one active transaction per product, seller handover, buyer receipt, cancellation before handover, disputes, and completed-transaction reviews.
- Exact-decimal PostgreSQL bids with product/auction locks, increment/start/deadline/seller/account checks, UTC timestamps, authoritative state/history/countdown, commit-before-broadcast Socket.IO events, outbid notices and automatic restart-safe closing. Unique winning transactions make repeated/concurrent closing idempotent. Empty auctions do not manufacture winners.
- Protected administrator command and dashboard. Existing-account promotion requires explicit confirmation and preserves the account and its records. New administrator accounts remain unverified until emailed OTP verification. No public admin registration/default credentials.
- Admin users/search/status filtering, suspension/reactivation, approvals, listing moderation/featuring, auction monitoring/cancellation, transactions/dispute decisions, reports, category activation/creation, announcements and protected reasoned audit records. There is no bid/winner-edit endpoint.
- MongoDB conversations/messages with participant authorization, message history, unread state and real-time delivery. Persisted notifications, unread counts and read actions. A PostgreSQL outbox retries important notifications without rolling back committed marketplace state.
- Original compact SVG exchange icon at `public/brand/icon.svg`, used in the wordmark and as a favicon. Additional horizontal/monochrome logo exports and PNG brand files are not claimed.

## Database and operational behavior

Migration `003_marketplace.sql` adds profile fields, moderation fields/indexes, category activation and announcements. Existing records remain intact; existing products require administrator review. Migrations 001–003 have been applied to the configured application database. PostgreSQL and MongoDB connectivity were verified through the live health endpoint.

Auction timing consistently uses PostgreSQL `clock_timestamp()`, including creation/approval checks. This fixes the observed development-host/database clock skew. Browser countdowns synchronize with database time. The worker reconciles overdue auctions at startup and every five seconds, even without connected clients; actual close notifications may be delayed during downtime, then reconcile after restart.

`npm run test:integration` uses a uniquely named isolated PostgreSQL schema on the configured database (or `TEST_DATABASE_URL`) and a uniquely named temporary Atlas database (or `TEST_MONGODB_URI`). Neon tests use the direct endpoint of the same database because the transaction pooler rejects schema startup settings. Tests mock email/images and clean up only their own isolated resources. They do not register artificial students or products in the application schema.

## Verification commands

- `npm test`: existing account, OTP, upload, CSRF, security and health regressions.
- `npm run test:integration`: real PostgreSQL/MongoDB HTTP, concurrency, moderation, purchase, auction, messaging, notification and socket tests. No real external test emails or product uploads.
- `npm run test:admin`: actual CLI denied/confirmed promotion, preserved password/profile/listing, duplicate prevention and audit checks in an isolated schema.
- `npm run test:ui`: headless Edge/axe, 135 page/viewport combinations at 320, 375, 768, 1024 and 1440px, keyboard skip link, enlarged text and reduced motion. Uses synthetic in-process fixture data, not application records.
- `npm run check:services` and `npm run check:upload`: authenticated external-service checks; upload command creates and deletes only a disposable image.

Results: 31 fast regression/worker tests passed; 18 reported real-database integration tests passed (the parent plus 17 workflow scenarios); the administrator CLI integration test passed; and the browser suite passed 135 page/viewport combinations. The final regression run also verifies worker shutdown drains in-flight reconciliation without overlap. Earlier failed runs found and fixed the Neon test-connection setting, Atlas temporary database name length, development clock mismatch and UI contrast/ARIA issues. Production dependency audit reported zero known vulnerabilities.

## Remaining limits

- Final production hosting/deployment, real student inbox delivery and full user acceptance have not been performed in this update. SMTP authentication and a real Cloudinary upload/delete were verified in earlier work; the full automated workflow uses mocks for those services.
- Password recovery/change/email-change flows from the original broader brief still need implementation. Current registration/verification/login/logout work; users should retain their password safely.
- Listing image replacement/reordering after creation is not implemented; edit preserves existing images. Profile pictures can be replaced. Unused image cleanup after a process crash still needs an operational reconciliation task.
- Dashboard/admin/history screens currently cap most lists at 100 records; marketplace browsing has pagination. Conversation history API supports a `before` timestamp but a load-older control is not yet provided.
- Automated accessibility checks are not a manual screen-reader certification; no Lighthouse score or deployed Render test is claimed. Formal college-approved legal/privacy language and operational support procedures remain required before public release.
- Notification reconciliation is retry-safe; direct MongoDB message writes are not a cross-database transaction. A rare notification failure after a message write can require a page refresh.
- The development-only nodemon/minimatch dependency chain has two moderate audit findings. Production dependencies are checked separately; no forced downgrade of user-installed development tools was made.
