# SMTP configuration and real delivery checks

Nodemailer already handles verification/password reset messages. The backend reads .env; the frontend receives no SMTP credentials. Both application email and the verification command now use server/mail.ts.

Add/update the following in the ignored root .env:

```
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM=
CLIENT_ORIGIN=http://localhost:5173
SMTP_TEST_TO=
```

Use the provider's SMTP server, username, SMTP/app password, and authorized sender address. MAIL_FROM can be `MarketHub <verified-sender@your-domain>`. Do not use your normal account password when the provider requires an app password or SMTP-specific key. Never put real values in .env.example or any VITE_ variable. The .gitignore already excludes .env and .env.*.

Port 465 uses implicit TLS. Other ports use STARTTLS, required for non-localhost servers; certificate validation remains enabled. Localhost test SMTP is permitted without TLS for the isolated integration runner. Provider-specific setup must be checked against the chosen provider's official documentation.

Run npm run check:smtp after configuring the environment. It verifies connection/TLS/authentication, then sends a plain test message only when SMTP_TEST_TO is set. It never prints credentials, raw server responses, or email tokens. Server acceptance does not prove inbox delivery: confirm receipt and check spam/quarantine. The standalone message includes no authentication links and does not alter accounts or create database records.

To test actual templates, start both applications, register a test account whose inbox you control, request verification at /request-verification, and follow the real link. Then use /forgot-password and confirm password reset from the resulting email. CLIENT_ORIGIN must be the exact running frontend origin so links reach the application. Rate limits and single-use one-hour token expiry apply. A provider accepting mail but not delivering it requires checking sender verification, provider logs, and domain SPF/DKIM/DMARC configuration.

## Configuration verified

The existing Nodemailer integration was retained. Local SMTP_PASS and SMTP_FROM keys were renamed to the application's SMTP_PASSWORD and MAIL_FROM keys without printing or committing their values. The configured provider passed a real connection, TLS, and authentication check. A real non-token delivery test was accepted by the SMTP server for the user-authorized recipient. Inbox receipt requires recipient confirmation; server acceptance alone is not claimed as proof of inbox placement.

New files: server/mail.ts (shared transport configuration), server/check-smtp.ts (redacted real delivery check), tests/mail.test.js, and this guide. Updated: server/auth.ts (uses the shared transport), package.json (check:smtp script), .env.example (empty sender and optional test recipient), and ignored local .env. The existing authentication behavior and password/token lifecycle were preserved.

The recipient subsequently confirmed receipt in their inbox. Real SMTP delivery is therefore verified, including server acceptance and recipient-confirmed inbox arrival. All 141 Jest/Supertest tests pass across ten suites, including TLS configuration, port handling, missing credentials, authentication email dispatch, and failure cleanup. The delivered message was a plain transport test; live verification/reset link consumption should still be exercised with a real account through the application pages described above.

## Live verification and password-reset integration

The user-authorized real-mail test passed on 2026-10-31, and the recipient confirmed that both verification and reset messages reached the inbox. The test used the real SMTP provider and Atlas in a new isolated database (mh_auth_1793471379089_be31c0); existing marketplace accounts and passwords were untouched.

Verified: registration; unverified-login rejection; correct verification/reset link origin and token format; server-side token hashing; one successful consumption under concurrent requests; subsequent replay rejection; two independent login sessions; refresh rotation and replay detection; revocation of a replayed token's successor/family; isolation of unrelated sessions before reset; reset invalidation of all access/refresh sessions; old-password rejection; new-password login; password-change revocation; logout revocation; and no reusable action tokens or active sessions at completion.

Run npm run test:email-auth to repeat explicitly. It reads SMTP_TEST_TO from ignored .env, sends TWO real messages, and automatically consumes the links through the API. Opening those messages afterward should show an invalid/expired-link result. It observes actual outgoing Nodemailer messages in memory to obtain tokens, calls the real SMTP transport, and never prints passwords or tokens. This verifies API/token lifecycle plus real email delivery; it is not a browser click-through test. The isolated database is retained for inspection, never dropped. NODE_ENV=production is refused.

No production authentication defect was found in this run. A TypeScript annotation in the new test runner was corrected during compilation.
