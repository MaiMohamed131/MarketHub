# Cloudinary product images

Cloudinary was already integrated with the existing SDK and Multer; no new packages were installed. Credentials are backend environment variables loaded from the ignored root .env by the API entrypoint. No credentials were changed or copied into frontend source.

Required variables:

```
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

All three variables were present locally, and a real Cloudinary credentials check succeeded. Their values were never printed. .env.example contains empty placeholders; .gitignore excludes .env and .env.* while allowing .env.example.

## Upload and save

1. Start npm run dev and npm run dev:client. Open http://localhost:5173.
2. Sign in as an approved seller and open Seller workspace → Products & inventory → Add product.
3. Upload PNG, JPEG, or WebP files, at most 5 MB each. Up to eight images can be attached to one product. The API accepts a single multipart field named image on each request.
4. Fill product fields, select a category, and save. Publishing requires at least one image. Only URLs recorded as uploaded by the current seller are accepted.
5. Verify the product in MongoDB: images contains the returned HTTPS secure_url values. Media stores the publicId separately for safe Cloudinary deletion. API keys, API secrets, and signed upload credentials are never returned to the browser.
6. In Cloudinary, product assets are organized under markethub/products/<seller-id>. Existing category/avatar integrations remain under the same markethub root. The folder upload parameter is retained for compatibility with both older fixed-folder accounts and dynamic-folder accounts; see [Cloudinary folder modes](https://cloudinary.com/documentation/folder_modes).

The existing POST /api/seller/manage/images endpoint performs signature checks on bytes before Cloudinary decodes the image, bounds multipart size/count, and restricts formats. Missing credentials produce a service-unavailable response; rejected files produce 400; Cloudinary upload failures produce 502. If MongoDB metadata persistence fails after upload, the API attempts to destroy the newly created asset. A simultaneous failure of both external systems can still require manual recovery; no distributed transaction across Cloudinary/MongoDB is claimed.

## Image lifecycle

- Removing an existing image from a product deletes it after the product update commits, provided no other current product, category, or order snapshot references it.
- Seller and administrator product archival perform the same cleanup. The product itself remains archived for order/inventory history.
- Shared images and images referenced by historical orders are deliberately retained; they are necessary for those records.
- Removing a newly uploaded, unsaved image from the gallery calls DELETE /api/seller/manage/images with {url}. The endpoint verifies ownership and refuses to delete a referenced image.
- Product attachment writes lock the Media record in the product transaction. Cleanup marks it deleting before checking references, preventing an attachment from racing deletion.
- Failed deletions preserve the public ID and a deleting status with a retry marker. Product update/delete is not rolled back after a successful database commit merely because external cleanup failed.
- Abandoned uploads from a closed browser are eligible for cleanup after a 24-hour grace period.

Explicit maintenance command (PowerShell):

```
$env:ALLOW_MEDIA_CLEANUP = 'true'
npm run media:cleanup
Remove-Item Env:ALLOW_MEDIA_CLEANUP
```

This processes up to 100 tracked MarketHub assets per run: failed cleanups or records older than 24 hours. Re-run for additional batches. Schedule this command in hosting maintenance if automatic abandoned-upload cleanup is required. It does not scan/delete arbitrary Cloudinary account assets. Only public IDs starting with markethub/ and recorded in this application's Media collection are eligible. No bulk cleanup command was executed during implementation.

## Verification

- npm test: unit/request tests, including missing credentials, SDK configuration, namespace restrictions, references, retries, idempotent deletion, and transaction attachment guards.
- npm run build:client: frontend type-check and production build.
- npm run check:cloudinary: opt-in real Cloudinary/Atlas product lifecycle verification. It creates a newly named isolated Atlas test database, uploads a generated 1-pixel PNG through the real seller endpoint, verifies the secure URL in MongoDB, checks shared references, updates and archives test products, and deletes only the generated Cloudinary asset. It never changes the existing application database or old-project Cloudinary assets. The test database is retained for inspection.

The real lifecycle test passed in mh_media_1793469591966_d329bfef. Upload, markethub namespace, secure URL persistence, shared-reference protection, update cleanup, and archive cleanup were verified. Initial attempts failed before creating fixtures because the generated test database name exceeded Atlas's name-length limit; the test name was shortened. Authentication, database connection configuration, and payment logic were not changed.

Files added: server/cloudinary.ts (environment configuration/deletion guard), server/media-lifecycle.ts (attachment locks/reference-aware cleanup), server/cleanup-media.ts (retry/stale upload maintenance), server/check-cloudinary.ts (real isolated integration test), tests/cloudinary.test.js, and this guide. Files modified: server/seller.ts (uploads/update/archive/discard hooks), server/seller-models.ts (cleanup state), server/admin.ts (product archive cleanup only), client/src/seller.tsx (unsaved gallery removal), tests/seller.test.js and tests/admin.test.js (regression fixtures), package.json (maintenance/test scripts), .env.example (empty placeholders/maintenance flag), README.md, and generated OpenAPI/Postman documentation. .gitignore was checked and already excluded secret environment files; no change was needed. No authentication, payment, or MongoDB connection code was modified.
