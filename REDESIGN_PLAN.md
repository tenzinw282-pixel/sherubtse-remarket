# Sherubtse ReMarket redesign

## Inspection and scope

The current Express/EJS application implements email registration, OTP verification/resend, login/logout, fixed-price listing creation with Cloudinary images, product details, terms, errors, and health checks. PostgreSQL stores accounts, sessions and listings; MongoDB schemas and indexes are present. Buying, bidding, reconciliation, marketplace browsing, dashboards, messages, notifications, password recovery and admin tooling are not implemented, despite tables existing for several of them. No public admin registration route exists.

UI issues found: a minimal stylesheet without a spacing/type system, generic forms without consistent surfaces, inconsistent page widths, limited navigation hierarchy, no locally supplied Inter font, no skip link, and no documented contrast rules. Admin authorization/bootstrap/dashboard are missing, rather than merely hidden.

## Implementation order

1. **Design system (this delivery):** exact brand palette, self-hosted Inter, semantic typography/spacing/radius/motion tokens, buttons/forms/status surfaces, responsive shared shell, and application to existing pages. Verify regressions, contrast, focus and common viewport widths. Preserve route contracts and all existing database records.
2. **Logo:** original vector symbol and horizontal/compact/light/dark/monochrome SVG variants and favicon. Add actual PNG exports only when generated; integrate into navigation and email templates. Do not use the official college crest.
3. **Marketplace and product experience:** real database browsing/filter/search/pagination, categories, favorites, image gallery, seller/contact/reporting connections, and listing edit/delete with owner permissions. Add only working navigation destinations.
4. **Authentication and student dashboard:** fuller account page interactions, password recovery/reset, persistent form feedback, accessible image previews, unified student dashboard with real statistics and connected sections. Preserve OTP/session security.
5. **Admin system:** protected `admin:create` command with hidden password input, explicit confirmation for existing-account promotion, preserved account history and verified email requirement. Add server-side admin authorization, real dashboard statistics, users/listings/auctions/reports moderation and reasoned audit records. No default credentials or public registration.
6. **Transactional workflows:** atomic reservations, handover/receipt, reviews, locked exact-decimal bidding, restart-safe idempotent auction closure, and commit-before-broadcast Socket.IO events. Add concurrent integration tests against isolated databases.
7. **Messaging and notifications:** participant authorization, persisted MongoDB data, PostgreSQL outbox delivery, unread/read state, authorized socket rooms and retry-safe notifications.
8. **Release validation:** all implemented flows, mobile/keyboard checks, accessibility scans, performance checks, deployment/environment review and documented GitHub/Render instructions. No destructive schema changes. Apply new numbered migrations only when backend changes require them.

The numbered sections consolidate the supplied ten-phase brief into implementation checkpoints; Phase 1 is intentionally the design-system foundation. Existing `IMPLEMENTATION_PLAN.md` retains the original backend work plan. Later features are not represented by inactive links or simulated data.

## Phase 1 changes and validation

CSS and EJS updates implement a shared visual foundation on home, login, register, verify email, sell, product details, terms and error pages. The homepage is the first composition using that system, with a clearly identified early-release status. Local font delivery is the only new runtime route. No database migration, account modification, secret change or deployment configuration change is needed.

Run `npm test` for behavior regressions and `npm run test:ui` for browser checks. Browser checks use an isolated HTTP fixture with synthetic test data and a memory session store; no production accounts, email or uploads are created. Generated screenshots go to ignored `artifacts/design-system/`. See `DESIGN_SYSTEM.md` for the component contract and accessibility rules.

Verification: the 30 existing behavior tests passed. Browser checks passed all 40 page/viewport combinations with no reported axe violations, no horizontal overflow, working local Inter loading, working skip-link keyboard navigation and reduced-motion behavior. Desktop/mobile screenshots were visually inspected. The live homepage, registration page, health endpoint and local font returned HTTP 200. This phase does not validate production deployment, assistive technology compatibility or unimplemented admin/transaction features.
