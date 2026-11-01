# Development demonstration catalog

See [REDESIGN.md](REDESIGN.md) for complete startup and seeding instructions.

The catalog seed now creates 48 products across 12 categories. It requires `NODE_ENV=development` and `ALLOW_DEV_SEED=true`, uses stable demo identifiers, and can be rerun without duplicating or replacing products. Existing non-demo catalogs are skipped unless `ALLOW_DEMO_CATALOG_APPEND=true` is explicitly set.

It creates only one demonstration seller with a random password; it does not create customer or administrator accounts. Register normally through the application to test customer shopping. Existing accounts and orders are untouched. No demonstration orders or payments are created.

Products are visibly identified as demonstration listings. Ratings and sales are zero until actual reviews and deliveries exist. Images use public product photography and local illustrations.

The existing `test:e2e` command uses a separately named test database and retains it for inspection; it does not write orders to the application catalog. External SMTP and Cloudinary require their separate configured checks.
