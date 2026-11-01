# MarketHub — multi-vendor marketplace

Current implementation: auth/profile code and Phases 2–6 are implemented with database-independent tests and production builds. Atlas connectivity and the live API integration suite now pass. See [current auth and integration status](docs/AUTHENTICATION.md); historical phase notes below describe earlier checkpoints. Atlas-backed integration, successful Cloudinary uploads, and browser visual verification remain outstanding; this is not yet deployment-ready.

## Run

Install dependencies with `npm install`, copy `.env.example` to `.env`, and configure Atlas, an access-token secret of at least 32 characters, the frontend origin, and SMTP. Never commit `.env`.

- `npm run check:db`: authenticated Atlas ping and transaction capability check; does not seed or change data.
- `npm run dev`: API on port 4000.
- `npm test`: TypeScript build and Jest/Supertest request tests.
- `npm run build` / `npm start`: compiled production API.

## Implemented API

All routes use the `/api` prefix. Registration accepts only name, email, and password; roles cannot be assigned publicly. Passwords require 12–72 characters and are hashed with bcrypt. Login requires email verification. Access tokens expire after ten minutes; refresh cookies expire after seven days. Refresh tokens are stored as hashes, rotated atomically, and retain consumed tokens until expiry to detect replay and revoke the token family.

Authentication: `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/request-verify-email`, `/auth/verify-email`, `/auth/request-reset-password`, `/auth/reset-password`.

Recovery/verification completion accepts a token; reset also accepts a password. Request endpoints accept email. SMTP delivers links; tokens are never returned in API responses.

User management: `GET/PATCH /users/me`, `POST /users/me/password` (currentPassword/newPassword), `DELETE /users/me` (password), `PATCH /admin/users/:id/active` (active boolean). Protected endpoints require a Bearer access token. Password changes and account deactivation revoke sessions and invalidate access tokens. Only administrators can reactivate accounts. Admin creation is intentionally unavailable through registration.

## Verification and limitations

TypeScript compilation and eight database-independent Jest/Supertest tests pass. Tests cover unauthenticated access, privilege injection, malformed input, origin protection, missing refresh cookies, logout cookie handling, malformed recovery tokens, and absent SMTP configuration.

Atlas DNS resolves, but an authenticated connection attempt fails with MongooseServerSelectionError and MongoNetworkError for all three cluster members. Authentication success has therefore NOT been verified. Review Atlas network access and connectivity manually; this application does not alter Atlas settings or fall back to another database. Existing database data has not been modified.

Phase 1 remains incomplete: database-backed registration/login/rotation/replay/recovery/ownership tests, React authentication/profile screens, profile image upload, OpenAPI documentation, and SMTP delivery verification remain outstanding. There are no seeded accounts. Do not treat this as deployment-ready. Production must provision unique indexes before serving traffic because production automatic index creation is disabled. Production cookie configuration assumes frontend and API are served on the same site; unrelated domains require an explicit CSRF and cookie deployment design.

# Phase 2 — catalog and customer storefront

Implemented a React/TypeScript/Vite storefront with Tailwind, React Router, Redux Toolkit for mobile navigation, TanStack Query caching, Axios cancellation/timeouts, and React Hook Form/Zod filters.

Run `npm run dev` and `npm run dev:client` in separate terminals. Vite proxies `/api` to port 4000. `npm run build:client` type-checks and builds the frontend to `dist-client`. For a separate deployed backend, set `VITE_API_URL` to its HTTPS `/api` URL at build time. Configure SPA rewrites to `/index.html` on Vercel.

Public catalog API:
- `GET /api/categories`: active categories.
- `GET /api/products`: q, category (ObjectId), minPrice/maxPrice (USD decimal strings), sort (newest/price-asc/price-desc/popular), page, limit (1–48), featured (true/false).
- `GET /api/products/:id`: active product, active category, and up to four related products.

Money is stored as integer cents. Search treats input as literal text, including regex characters. Sorting has deterministic ID tie breakers. Public fields exclude seller account identifiers and private user data. Inactive categories/listings are not exposed. Catalog failures return 503 when no database connection exists; the frontend shows retryable error states. Empty results, missing images, stock status, loading skeletons, and pagination are implemented.

`npm run seed:catalog` is development-only: set `NODE_ENV=development` and `ALLOW_DEV_SEED=true`. It adds 48 clearly labeled demo products across 12 categories using stable identities, and reruns insert no duplicates. It preserves existing accounts and orders and skips non-demo catalogs unless explicitly opted in. See [docs/REDESIGN.md](docs/REDESIGN.md) for complete instructions.

Product publishing is implemented in Phase 4 and category administration in Phase 5. Checkout and wishlist are implemented in Phase 3; review submission remains Phase 6. Popular sorting uses actual salesCount, not invented sales. Homepage artwork is a CSS illustration and is not a product photograph.

Atlas-backed query behavior remains unverified while the Phase 1 network issue persists. Catalog request tests use explicit model mocks and schema validation; no in-memory or local MongoDB is used.

Final Phase 2 validation: 16 Jest/Supertest tests pass (including 8 catalog tests), backend TypeScript compilation passes, and frontend type-check/production build passes. Local preview responds HTTP 200. Browser opened the homepage but lost its session before screenshot/responsive interaction verification; full visual QA is outstanding. Compatible npm audit fixes were applied and unused Vitest dependencies removed; npm still reports 19 low/moderate dependency advisories. No critical advisories remain in the latest install report. Do not force-downgrade Jest to resolve transitive advisories without reviewing compatibility.

# Phase 3 — cart, wishlist, checkout, and orders

Implemented persistent per-user carts/wishlists, stock-aware quantity changes, atomic wishlist-to-cart moves, Cash on Delivery checkout, customer order history/details, cancellation confirmation, and seller-scoped fulfillment APIs. A small existing-account sign-in screen connects shopping to the Phase 1 endpoints; registration, recovery/profile screens, SMTP, and Atlas fixes remain deferred. Access tokens stay in memory; shopping requests use cookie refresh on expiry.

## API

All shopping endpoints require a Bearer access token:
- GET `/api/cart`; PUT `/api/cart/items/:productId` with `{quantity,revision}`; DELETE the same URL.
- GET `/api/wishlist`; PUT/DELETE `/api/wishlist/:productId`; POST `/api/wishlist/:productId/move`.
- POST `/api/orders` with `{address,paymentMethod:"cod",revision,expectedTotal}` and a UUID `Idempotency-Key` header. Address fields: name, email, phone, line1, optional line2, city, postalCode, country (`US`).
- GET `/api/orders?page=1` (20 per page); GET `/api/orders/:id`; POST `/api/orders/:id/cancel`.
- GET `/api/seller/orders` (latest 50); PATCH `/api/seller/orders/:id/groups/:groupId` with `{status}`.

## Business rules

All money uses integer USD cents. Prices and names are copied from the server catalog into immutable order line snapshots. Client prices/totals are never used to calculate an order; expectedTotal only detects a changed quote. Shipping is $5 per seller group, waived for that group's subtotal of at least $100. This release supports US delivery only; no tax collection or Stripe integration is implemented. Payment remains unpaid for COD; delivery does not pretend that payment has been collected.

Checkout requires active products/categories/seller accounts, a matching cart revision, and sufficient inventory. A MongoDB transaction guards each stock deduction with `stock >= quantity`, creates one order with separate seller groups, and empties the cart. Transaction failure has no nontransactional fallback. A unique `(user,idempotencyKey)` index protects repeated requests. Production must explicitly create the declared Basket/Order indexes before traffic; production automatic index creation remains disabled. These protections must be validated against Atlas before deployment.

Seller transitions are pending → confirmed → processing → shipped → delivered. Sellers can only see or update their own groups; other seller groups and the customer order total are omitted. Product sales counters increase only on delivery. Sellers do not receive payment-management privileges.

Customers can cancel the entire order only while every group is pending or confirmed. Cancellation restores inventory and records a terminal state in one transaction. Repeated cancellation does not restore stock twice. Missing inventory records cause cancellation to fail safely for manual investigation. Concurrent fulfillment/cancellation writes target the same order document and therefore participate in transaction conflict handling.

Cart revisions prevent lost quantity updates and stale checkout. A basket allows 50 distinct products with quantities 1–99; a wishlist is limited to 100 entries in ordinary requests. Cart/wishlist entries never reserve stock. Checkout is the final stock authority. Customer order history supports pagination in both the UI and API. Seller dashboard UI remains Phase 4.

## Verification limits

Jest/Supertest tests cover calculations, validation, API authorization, ownership scopes, stock guard construction, checkout idempotency, price-change rejection, cancellation restoration/replay, wishlist stock failures, seller isolation, and transaction-failure behavior using explicit Mongoose mocks. No memory/local MongoDB is used. Mock tests cannot prove database rollback, transaction retry behavior, unique-index enforcement, or actual concurrent overselling prevention. Those Atlas integration tests remain required. Frontend TypeScript and production build pass; browser interaction/visual verification remains outstanding. No database writes or seed commands were executed for this phase.

Final Phase 3 checks: all 38 Jest/Supertest tests pass; backend compilation and frontend TypeScript/production build pass. The frontend bundle still emits Vite's >500 kB advisory. Existing npm dependency audit findings remain 19 low/moderate advisories; no security-clean deployment claim is made.

# Phase 4 — seller workspace

Implemented customer seller applications, pending/approved/rejected/suspended states, rejection resubmission, administrator review APIs, approved-seller middleware, seller overview, product CRUD, inventory adjustments, image uploads, low-stock watch, product performance, and seller fulfillment UI. Phase 1 remains deferred.

Customer/seller pages: `/seller/application`, `/seller`, `/seller/products`, `/seller/products/new`, `/seller/products/:id`, and `/seller/orders`. Use an existing verified account to sign in. A customer applies, then an existing administrator reviews through the API; administrator review UI belongs to Phase 5.

APIs (all authenticated):
- GET/POST `/api/seller/application`: own application/status; POST accepts storeName, description (30–2,000 characters), email, phone. Pending/approved/suspended applications cannot be resubmitted; rejected applications can.
- GET `/api/admin/seller-applications?page=1`: paginated applications (administrator only).
- PATCH `/api/admin/seller-applications/:id`: status (approved/rejected/suspended), reason. Initial review allows approval/rejection; approved stores can be suspended; suspended stores can be approved again. Decisions and role promotion are transactional.
- GET `/api/seller/manage/overview`: product count, seller-specific order counts, delivered merchandise sales, recent fulfillment groups, and up to ten low-stock products.
- GET `/api/seller/manage/products?page=1&q=...&low=true`: 20 results per page. GET `/api/seller/manage/products/:id` returns own nonarchived product.
- POST `/api/seller/manage/products`: name, description, price (integer USD cents), stock, category ID, images, active.
- PATCH `/api/seller/manage/products/:id`: same fields except stock, plus version (product.__v). Version guards prevent stale edits. Sellers cannot assign owner, sales counts, ratings, or featured status.
- POST `/api/seller/manage/products/:id/inventory`: delta and expectedStock. Atomic ownership/current-stock guards prevent stale adjustments and negative inventory. Product editing cannot overwrite inventory.
- DELETE `/api/seller/manage/products/:id`: archive and deactivate; preserve the record for historical orders and stock restoration.
- POST `/api/seller/manage/images`: multipart image field, single PNG/JPEG/WebP up to 5 MB. Up to eight uploaded images per listing. The upload URL must belong to the current seller's Media records. Active listings require at least one image; drafts may omit images.

Configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET only on the server. Upload validates binary signatures before Cloudinary decodes the image; SVG and arbitrary URL fetching are unsupported. Cloudinary uploads and decoded image transformations require live external verification. If persistence fails after upload, the server attempts to remove the new asset. Product images now have reference-aware cleanup; see docs/CLOUDINARY.md for current behavior.

Approval is required for management and fulfillment routes. Publishing rechecks approval inside the same transaction and writes the application document so concurrent suspension conflicts with publishing. Suspension deactivates listings; reapproval does not automatically republish them. Existing development sellers without an approved application must be explicitly reviewed before using the workspace. The additive development seed now creates an approved demo application for newly seeded sellers; no migration or seed was executed.

Dashboard sales are delivered merchandise value, not collected cash or profit. Pending orders include all unfinished fulfillment groups; completed orders are delivered groups. Low-stock watch uses a threshold of five units; notification delivery remains Phase 6. The product table exposes delivered units, while the editor shows rating information. Seller order UI uses the existing latest-50 API; deeper seller-order pagination is outstanding.

Production must provision the SellerApplication unique user index, Media unique URL index, and seller product index in addition to earlier indexes. No indexes or database data were modified during this phase. Atlas-backed transaction/race tests, successful Cloudinary delivery, and browser visual verification remain pending; backend tests explicitly mock database operations rather than using local or in-memory MongoDB.

Phase 4 final validation: 62 Jest/Supertest tests pass across four suites; backend TypeScript compilation and frontend type-check/production build pass. Seller tests cover application validation and account promotion, administrator restrictions, rejection/suspension transitions, publishing approval races, owned image requirements, product ownership/version guards, negative/stale inventory adjustments, archival, upload signatures/size limits, and missing Cloudinary configuration. No live upload, database-backed success flow, or browser visual verification is claimed. Vite still reports a bundle-size advisory; npm reports 19 existing low/moderate advisories.

# Phase 5 — platform administration

Implemented `/admin` overview and dedicated user, seller, product, category, and order management pages. All admin API routes require an active administrator; the client checks the current account role for the workspace gate. Phase 1 remains deferred: use an existing verified admin account; there is no public administrator registration or automatic role promotion to administrator.

- Overview: role counts, product/order totals, pending applications, delivered merchandise revenue, monthly sales, recent orders, and recorded user/product management events. Monthly sales group by order placement month and include only currently delivered seller groups. Revenue excludes shipping and is not a collected-payment or profit metric.
- Users: paginated search by name/email, role filters, safe account details, activation/deactivation with reasons. Deactivation invalidates access versions, revokes refresh sessions, hides listings, and suspends an approved store in one transaction. Reactivation does not automatically approve the store or republish listings. Self-management and changing other administrators' activation are blocked.
- Sellers: paginated store search/status filters, application detail, approve/reject/suspend/reapprove actions through the Phase 4 decision API. Rejected applications must be resubmitted by their customer before review. The administrator UI now exposes this workflow.
- Products: paginated search/status filters, full product review, version-guarded moderation and reason capture. Blocking persists moderationBlocked so seller edits cannot republish it. Admin approval checks listing images, active category/account, and approved seller application. Archive preserves order references and cancellation inventory restoration; no product record is physically deleted.
- Categories: list active/inactive categories, create/edit with unique slugs and optimistic versions, category image uploads, deactivate, and delete only categories without any product references, including archived products. Publishing/editing takes a category write lock in its transaction so safe deletion conflicts with concurrent product creation. Deactivating a category hides its listings through public catalog checks.
- Orders: paginated search by full order ID or customer email, seller fulfillment status filter, order/address/items/history snapshots, eligible whole-order cancellation, and internal dispute creation/resolution. The shared cancellation service enforces pending/confirmed-only cancellation and transactional stock restoration for both customers and admins. Resolving disputes preserves original notes plus separate resolution text; it does not issue refunds, mark payments collected, or bypass fulfillment rules.

Admin API reference:
- GET `/api/admin/overview`.
- GET `/api/admin/users?page=1&q=&role=customer&active=true`; GET `/users/:id`; PATCH `/users/:id/active` with `{active,reason}`.
- GET `/api/admin/sellers?page=1&q=&status=pending`; decision endpoint remains PATCH `/api/admin/seller-applications/:id` with `{status,reason}`.
- GET `/api/admin/products?page=1&q=&active=true&seller=<id>&category=<id>`; GET `/products/:id`; PATCH `/products/:id` with `{active,version,reason}`; DELETE `/products/:id` with `{reason}` JSON body.
- GET/POST `/api/admin/categories`; PATCH `/categories/:id` with `{name,slug,description,image,active,version}`; DELETE `/categories/:id`. Creation uses the same fields without version. New category images must belong to the acting administrator's upload records; unchanged existing images can be retained.
- POST `/api/admin/images`: single multipart image field, PNG/JPEG/WebP, max 5 MB, server-side Cloudinary configuration from Phase 4.
- GET `/api/admin/orders?page=1&q=&status=shipped`; GET `/orders/:id`; POST `/orders/:id/cancel`.
- POST `/api/admin/orders/:id/disputes` with `{subject,notes}`; PATCH `/orders/:id/disputes/:disputeId` with `{notes}` to resolve an open case.

Search values are validated and escaped rather than accepted as MongoDB operators. List pages use 20 records per page with deterministic ordering. No arbitrary user role, price, inventory, order total, or payment-status editing was added to the admin UI/API.

Management activity currently records user activation and product moderation/archive actions; it is not a complete platform audit trail. Seller decisions retain their reviewer/time/reason on the application. Disputes are internal administrator records; customer dispute submission and notifications remain future work. Successful Cloudinary uploads, real Atlas transactions/concurrency/index enforcement, and browser visual verification remain unverified. Database-independent tests use explicit model mocks and never memory/local MongoDB. No existing database data was changed and no seed/migration was run in Phase 5.


Phase 5 final validation: 83 Jest/Supertest tests pass across five suites. Backend TypeScript compilation and frontend type-check/production build pass. Atlas transaction/concurrency tests, database-enforced index behavior, successful Cloudinary uploads, and browser visual QA remain pending. No database mutations or seed commands were executed. Existing Vite bundle-size and npm low/moderate dependency advisories remain outstanding.


# Phase 6 — reviews, notifications, and release preparation

Implemented delivered-purchase product reviews (1–5 stars, comments, editable per product/order/customer), server-side eligibility, transactional aggregate ratings, and public paginated review display. Order detail pages link delivered products to the review form. Reviews expose display names but exclude purchaser IDs, email addresses, and order IDs from public responses.

Implemented recipient-scoped in-app notifications with pagination, unread filtering, individual/all-read actions, and a one-minute polling UI at /notifications. Checkout, seller fulfillment transitions, cancellation, and checkout-triggered low stock events and manual inventory reductions write notifications in the same database transactions. Event keys deduplicate each recipient/event. Administrator user/product management actions create notifications for the acting administrator, and the admin overview retains management activity. Socket.IO, push/email delivery, broadcasts to all administrators, are not implemented. Manual inventory reductions to five or fewer units also notify the seller within the adjustment transaction.

New APIs: GET /api/products/:id/reviews?page=1 (public); PUT /api/products/:id/review with {order,rating,comment} (customer); GET /api/reviews/mine?page=1; GET /api/notifications?page=1&unread=true; PATCH /api/notifications/:id/read; PATCH /api/notifications/read-all. Product/order/customer uniqueness and notification event uniqueness require the declared indexes.

Documentation and release files:
- [Deployment runbook](docs/DEPLOYMENT.md): Vercel/Render setup, exact environment variables, same-site cookie deployment constraint, explicit index creation, and live verification steps.
- [Testing guide](docs/TESTING.md): what mocks prove, what remains unverified, Postman and CI usage.
- [Demo seed guide](docs/DEMO.md): explicit development command, two sellers/customer/admin identities, caller-selected password, and partial-seed limits.
- Swagger UI at /api/docs; raw OpenAPI at /api/openapi.json; specification and endpoint collection in docs/. Run npm run docs:generate after route changes.
- Root vercel.json, render.yaml, and .github/workflows/ci.yml prepare builds and tests. No hosting resource was created and no code was published.
- npm run db:indexes requires ALLOW_CREATE_INDEXES=true. It creates declared indexes without dropping existing ones and never repairs data automatically. It has not been executed.

Phase 1 remains deferred. Do not use unrelated default Vercel/Render domains for cookie refresh with the existing SameSite=Strict configuration; use same-site HTTPS custom domains or resolve cookie/CSRF topology during Phase 1. Atlas transactions/concurrency, real image/email delivery, browser interaction/layout verification, and application screenshots remain outstanding. No deployment, seeding, index creation, or database mutation was performed. Existing dependency advisories remain documented.

Final Phase 6 validation: 108 Jest/Supertest tests pass across seven suites; backend TypeScript compilation and frontend type-check/production build pass. Swagger UI and raw OpenAPI serve successfully without a database, and readiness returns 503 when disconnected. Notification tests cover checkout recipients, low-stock events, shipping events, failure propagation, ownership, and read state; review tests cover delivered purchase eligibility, uniqueness declarations, safe public projection, validation, and aggregate updates. No live transaction, Cloudinary/SMTP success, browser layout, screenshot, or hosting deployment verification is claimed. Existing bundle-size and low/moderate dependency advisories remain outstanding.


# Phase 1 follow-up — authentication and integration verification

Implemented session-family revocation with transactional refresh rotation/replay handling, transactional recovery-token consumption, UTF-8-safe bcrypt password validation, password-confirmed account deactivation, avatar upload, and all authentication/profile screens. Centralized Axios refresh handling now serves all application modules. Default local frontend URL is http://localhost:5173 to match CLIENT_ORIGIN exactly.

[Current authentication status and Atlas diagnosis](docs/AUTHENTICATION.md) explains the code, tests, remaining live-service requirements, and the opt-in Atlas API integration runner. Atlas still fails before authentication with TLS alert 80 on all members. TLS 1.2 and system-CA tests did not resolve it. The API integration attempt stopped before any writes; full end-to-end success is NOT claimed. Real SMTP/Cloudinary credentials and successful delivery verification remain required.


Phase 1 follow-up validation: 125 tests pass; backend and frontend builds pass. Browser navigation and sign-in database-outage handling were checked. Real Atlas integration remains blocked by TLS alert 80; SMTP/Cloudinary configuration and successful external-service checks are still required.


# Latest Atlas integration result

Atlas authenticated connectivity and transaction support are now verified. The live Atlas API integration suite passed on 2026-10-31 in isolated database markethub_e2e_1793453269972_3a31b932. It verified registration/login with a local SMTP test mailbox, seller approval, multi-vendor checkout, idempotency, ownership, cancellation restoration, fulfillment, reviews, notifications, admin overview, last-unit concurrent checkout, password changes/reset/replay, logout revocation, and deactivation. Existing application data was not modified. Real external SMTP, Cloudinary, and authenticated browser workflows remain unverified.

## Cloudinary product image configuration and cleanup

The existing credentials were verified against Cloudinary, and a real isolated Atlas product-image lifecycle test passed. Product uploads remain backend-only and support eight images per listing. Removed/unreferenced product images are now cleaned up after updates or seller/admin archival; shared assets and order-history snapshots are preserved. Failed cleanup retains retry metadata. Unsaved gallery removals are deleted safely, and a maintenance command handles abandoned uploads after 24 hours. See [Cloudinary setup and testing](docs/CLOUDINARY.md) for exact variables, testing steps, and cleanup behavior. No existing application data or old Cloudinary project assets were changed.

## SMTP configuration

Real SMTP connectivity, TLS, and authentication have been verified, and the provider accepted a delivery-test message to the user-selected recipient. Verification and password-reset messages share the tested server transport. Credentials remain in the ignored backend .env; .env.example has empty placeholders. See [SMTP setup and test instructions](docs/SMTP.md). Inbox placement requires recipient confirmation.

SMTP follow-up: recipient-confirmed inbox delivery succeeded. All 141 tests pass. Real verification/reset link consumption with a user's account remains separate from this transport-delivery test.

## Real email authentication follow-up

Verification and password-reset emails now passed live SMTP/Atlas integration, and the recipient confirmed both arrived in the inbox. Concurrent and repeated single-use link checks passed, as did refresh replay protection and access/refresh revocation on reset, password change, and logout. Existing marketplace accounts/passwords were untouched. See docs/SMTP.md and npm run test:email-auth for the isolated, repeatable test; its links are consumed automatically.

## Browser QA follow-up

Real customer, seller and administrator workflows were exercised through the browser against an isolated Atlas database, including mobile/tablet/desktop layouts. Fixed heading hierarchy, checkout refresh/submission feedback, React hot-reload root reuse, unavailable-product handling and singular review labels. [Browser QA report](docs/BROWSER_QA.md) records tested flows, screenshots, measured widths, and limits. Existing marketplace data was not changed.

## Storefront redesign and safe demonstration catalog

See [docs/REDESIGN.md](docs/REDESIGN.md) for the forest-green/cream storefront, local startup, API filters, and the repeatable 48-product development seed.
