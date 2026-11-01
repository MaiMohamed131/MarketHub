# Authentication and Atlas verification status

Authentication/profile code is implemented and covered by request tests. Atlas connectivity and live API integration now pass. This document supersedes historical "Phase 1 deferred" notes in earlier phase summaries.

## Latest verification

Atlas authenticated connectivity and transaction support are now verified. The live Atlas API integration suite passed on 2026-10-31 in isolated database markethub_e2e_1793453269972_3a31b932. It verified registration/login with a local SMTP test mailbox, seller approval, multi-vendor checkout, idempotency, ownership, cancellation restoration, fulfillment, reviews, notifications, admin overview, last-unit concurrent checkout, password changes/reset/replay, logout revocation, and deactivation. Existing application data was not modified. Real external SMTP, Cloudinary, and authenticated browser workflows remain unverified.

Earlier failure reports below are historical and are superseded by this successful run.

## Earlier Atlas diagnostics

Authenticated connection attempts on 2026-10-31 fail before credential authentication. DNS resolves the three Atlas members, but TLS negotiation returns ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR (alert 80) from each. Validated TLS 1.2 and the system CA store produce the same result. A direct TCP probe also failed in the restricted execution environment. This evidence does not prove a password error or identify a single cause.

Check the current computer's egress IP against Atlas Network Access and check local firewall/VPN/network policy for MongoDB traffic. See [MongoDB's connection troubleshooting guide](https://www.mongodb.com/docs/atlas/troubleshoot-connection/). The agent did not edit Atlas settings, disable TLS verification, change credentials, or use a local fallback.

Commands: npm run check:db (read-only authenticated ping); npm run atlas:diagnose (credential-redacted network/TLS detail). Database connection checks now use autoIndex=false and never create indexes implicitly.

## Auth implementation

Public registration accepts only name/email/password and always creates customers. Passwords are bcrypt-hashed, require 12–72 characters, and cannot exceed bcrypt's 72 UTF-8 byte boundary. Login requires active, verified accounts. Rate limits apply to all authentication requests; exact Origin validation protects browser mutations. Production refresh cookies are Secure, HTTP-only, SameSite=Strict, and scoped to /api/auth. Use documented same-site HTTPS custom domains.

Access tokens expire after ten minutes and include the current user security version and revocable session-family identifier. Protected APIs recheck active status/version and, for newly issued tokens, live family state. Refresh token hashes and family records are stored server-side. Rotation and family serialization occur inside an Atlas transaction. Replaying a used token commits family revocation before responding 401, rather than rolling revocation back by throwing inside the transaction. Concurrent refreshes fail closed; the frontend shares one refresh promise per page to prevent its own parallel requests racing.

Logout revokes its refresh family, immediately invalidating that family's newly issued access tokens. Password change/reset invalidates all refresh families, deletes refresh tokens, and increments the user's security version. Account deactivation is password-confirmed and transactional; it revokes sessions, suspends approved store access, and hides listings. Administrators cannot self-deactivate through the customer endpoint. Administrator activation controls remain separately authorized.

Recovery/verification links contain single-use random tokens; only SHA-256 hashes are stored. Tokens expire after one hour. Consumption, user changes, token cleanup, and session invalidation occur in the same transaction. SMTP delivery failure removes the attempted token and returns an explicit service error. Real email delivery still needs SMTP configuration and verification.

Profile management supports name editing and validated Cloudinary avatar upload. SVG/arbitrary remote URL uploads are rejected. Replaced old avatar assets are retained; automatic orphan cleanup is not implemented. Email address changes are not supported because they require a separate re-verification workflow.

Frontend pages: /sign-in, /register, /forgot-password, /request-verification, /verify-email?token=..., /reset-password?token=..., /account. Tokens remain in memory rather than localStorage; Axios shares refresh handling across all customer/seller/admin modules. Account changes clear cached private data on sign-out/password/deactivation. Recovery link tokens are removed from the URL after successful use.

Run npm run db:indexes explicitly after a verified connection to create SessionFamily and other declared indexes; this command has NOT been executed against the application database.

## Integration runner

npm run test:e2e uses the configured Atlas URI but always selects a new database named markethub_e2e_<timestamp>_<random>. It refuses NODE_ENV=production. It creates indexes and fixtures ONLY in that new database, never drops databases, and retains its test database for inspection. It never resets, seeds, or deletes existing application data.

The runner uses a local SMTP test mailbox to exercise email links, not a real email provider. Product media records are explicit synthetic fixtures in the isolated test database; they do not claim successful Cloudinary delivery. It covers registration, verification, login, seller approval, categories/products, wishlist/cart, multi-vendor orders, idempotency, stock restoration, fulfillment, review updates, notifications, admin overview, a race for the last available unit, password changes/reset/replay, logout revocation, and account deactivation. It is an API integration runner, not a browser end-to-end suite.

The attempted run was blocked at Atlas connection before any writes. No isolated test database was created and no existing data changed. Browser checks verified sign-in, registration and recovery navigation, plus the sign-in outage message; successful authenticated browser workflows and visual screenshots remain unverified because Atlas is unavailable and browser screenshot capture failed.


Final verification for this follow-up: 125 Jest/Supertest tests pass across eight suites. Backend compilation and the frontend type-check/production build pass. The added success-path test discovered and fixed the verification schema requiring an unwanted password field. The Atlas API integration runner was attempted and failed before writes. No live end-to-end success, email delivery, avatar upload, or screenshot verification is claimed.

## Current real-email verification result

Both authentication emails were accepted by the real SMTP provider and confirmed in the recipient's inbox. Single-use link races/replays and session revocation passed against live Atlas using the isolated test runner server/check-email-auth.ts. Existing marketplace accounts and passwords were not modified. This supersedes earlier notes that external SMTP or real link consumption were unverified. API consumption was automated from in-memory outgoing message observation; browser click-through testing was not part of this run.
