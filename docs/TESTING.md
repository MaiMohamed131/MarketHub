# Testing and verification

Run npm test for TypeScript compilation and Jest/Supertest tests. No Atlas credentials are required for this suite. The tests explicitly mock Mongoose operations; they do not use MongoDB Memory Server or local MongoDB. Run npm run build:client for frontend type checking and a production build.

Covered: request validation, unauthenticated/role restrictions, sensitive-field projections, seller/product ownership, cart stock guards and revisions, integer money and shipping, multi-vendor snapshots, idempotent checkout, price changes, cancellation restoration and replay, seller fulfillment isolation, application review, inventory edits, moderation, category safety, dispute resolution, delivered-purchase review eligibility and aggregate updates, notification ownership and idempotent writes.

Mocked transaction callbacks are not real transactions. They cannot prove rollback, transaction retry correctness, concurrent overselling prevention, unique-index enforcement, or Cloudinary/SMTP success. Those remain live integration requirements. Browser interaction/layout tests and screenshots also remain outstanding. Do not infer complete end-to-end coverage from passing unit/request tests.

OpenAPI: start the API and visit /api/docs. Raw specification: /api/openapi.json. Import docs/openapi.json into Postman for schema-based requests, or use docs/MarketHub.postman_collection.json for the endpoint inventory. Set baseUrl/accessToken yourself. No real credentials are included. Regenerate after route changes with npm run docs:generate. API response descriptions are intentionally concise; the README documents business rules and response fields are demonstrated by request tests.

GitHub Actions runs npm ci, npm test, and the frontend build on pushes/pull requests. The workflow has no database credentials and performs no deployments or seeding.

Validation snapshot: 108 tests pass across seven suites; backend compilation and frontend production build pass. This is a database-independent result, not a live deployment certification.


Latest live result: Atlas authenticated connectivity and transaction support are now verified. The live Atlas API integration suite passed on 2026-10-31 in isolated database markethub_e2e_1793453269972_3a31b932. It verified registration/login with a local SMTP test mailbox, seller approval, multi-vendor checkout, idempotency, ownership, cancellation restoration, fulfillment, reviews, notifications, admin overview, last-unit concurrent checkout, password changes/reset/replay, logout revocation, and deactivation. Existing application data was not modified. Real external SMTP, Cloudinary, and authenticated browser workflows remain unverified.
