# Deployment runbook

This runbook covers the same-origin Vercel deployment and the optional Render API configuration. Deployment status and URLs are recorded separately once deployment completes. Never describe a local build as a verified production deployment.

## Environment

Copy `.env.example` to ignored `.env` locally. Never put database credentials or Cloudinary/SMTP/JWT secrets in VITE_ variables, committed files, CI variables printed to logs, or frontend code.

| Variable | Where | Purpose |
| --- | --- | --- |
| MONGODB_URI | API | Atlas SRV URI; database is markethub |
| JWT_ACCESS_SECRET | API | Random secret, at least 32 characters |
| CLIENT_ORIGIN | API | Exact frontend origin, no trailing slash |
| NODE_ENV | API | production for deployed secure cookies |
| PORT | API | Hosting provider port; default 4000 |
| TRUST_PROXY | API | 1 only for the intended single trusted reverse proxy |
| CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET | API | Product/category image storage |
| SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD / MAIL_FROM | API | Verification and password reset email |
| VITE_API_URL | Frontend build | Absolute HTTPS API URL ending in /api, or /api for a configured same-origin proxy |
| ALLOW_CREATE_INDEXES | explicit maintenance command | Must equal true to run npm run db:indexes |
| ALLOW_DEV_SEED / ALLOW_DEMO_CATALOG_APPEND | development seed only | Explicit catalog seed opt-in; optional append to a nonempty development catalog |

## API on Render

Connect the repository using `render.yaml`. Review the selected plan before creating a paid service. Fill secret values in the provider UI; the blueprint contains no credentials. It builds using npm ci and TypeScript and starts compiled Express. Health checks use `/api/health`, returning 503 if the database is unavailable. Automatic deploys are disabled.

Set Atlas access permissions manually as appropriate; the application never changes Atlas settings. Verify Atlas connectivity with `npm run check:db`. The application never falls back to local MongoDB or creates a replica set.

Before serving traffic, explicitly set ALLOW_CREATE_INDEXES=true and run `npm run db:indexes` against the intended deployment. It creates declared indexes without dropping existing indexes. If unique indexes fail due to existing duplicates, stop and inspect manually; the tool does not delete or repair data. Deployments never seed automatically.

## Full application on Vercel (recommended for this deployment)

Import the GitHub repository at its root. Keep Framework Preset as Other: `vercel.json` builds the Express TypeScript server and Vite client, serves `dist-client`, and sends `/api/*` to `api/index.ts`. The function reuses the existing Express app and a cached MongoDB connection. React Router paths fall back to `index.html`.

Set these private Vercel environment variables for Production (and independently for Preview if needed):

- `MONGODB_URI`: your MongoDB Atlas connection string.
- `JWT_ACCESS_SECRET`: a fresh random secret of at least 32 characters.
- `NODE_ENV=production` and `TRUST_PROXY=1`.
- `VITE_API_URL=/api` so browser API calls use the same HTTPS domain as the frontend.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`.
- `CLIENT_ORIGIN`: the production HTTPS origin without a trailing slash. It may be omitted when Vercel exposes `VERCEL_PROJECT_PRODUCTION_URL`; that production domain is used automatically for CORS, mutation origin checks, and email links.

Do not copy the local `CLIENT_ORIGIN=http://localhost:5173`, `NODE_ENV=development`, or any seed/maintenance opt-ins into the deployment. `.env` and provider credentials are excluded from Git and deployment uploads.

The frontend and API share one origin, preserving Secure, HttpOnly, SameSite=Strict refresh cookies. Preview deployments need their own explicit `CLIENT_ORIGIN` to support authenticated mutations; the default fallback points to production.

Vercel limits function request bodies to 4.5 MB, so image uploads are capped at 4 MB to allow multipart overhead. Cloudinary remains the image storage provider. The API bundle explicitly includes `docs/openapi.json`. No database seed, index creation, or order generation runs during deployment.

Before publishing, ensure Atlas network access permits the deployment's outbound connections. The application does not change Atlas security settings. A production `/api/health` response of `ready` confirms database connectivity. See the release checks below for authentication, email, uploads, and orders.

The in-memory rate limiter is instance-local on Vercel; a high-traffic marketplace should use a shared rate-limit store. The existing Render configuration remains available as an alternative persistent API host, but deploying on separate unrelated domains requires a reviewed cookie/proxy topology.

## Release verification

1. npm ci; npm test; npm run build:client.
2. Verify authenticated Atlas ping and transaction capability; provision indexes explicitly.
3. Verify registration, email delivery, login, cookie rotation/replay, and account revocation after Phase 1 is repaired.
4. Upload real PNG/JPEG/WebP images; confirm malformed/oversize uploads fail.
5. Create an order across two approved sellers. Verify historical prices, stock, per-seller privacy, notifications, delivery reviews, and safe cancellation restoration.
6. Race two checkouts for one remaining unit. Exactly one should succeed. Inject transaction failure and confirm no partial stock/order/notification writes. Repeat cancellation to confirm no double restoration.
7. Exercise mobile/tablet/desktop pages, keyboard navigation, galleries, forms, empty/error states and API outages. Add actual screenshots to docs/screenshots after verifying those pages; no fabricated screenshots are included.
8. Review dependency advisories and rerun production audit. Current builds have known low/moderate advisories and a bundle-size warning.

Deployment never creates demo data or runs maintenance commands automatically.

References: [Render blueprint specification](https://render.com/docs/blueprint-spec), [Vercel project configuration](https://vercel.com/docs/project-configuration), [Render health checks](https://render.com/docs/health-checks).


