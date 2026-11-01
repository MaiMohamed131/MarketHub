# MarketHub storefront redesign

The existing React/TypeScript + Express/Mongoose application is retained. Authentication, seller/admin workspaces, SMTP, Cloudinary, reviews, and order APIs remain in place.

## Run locally

Use Node 22 and the existing `.env` configuration (`MONGODB_URI`, authentication secrets, and existing integration settings). Never commit credentials.

```powershell
npm run dev
# In a second terminal:
npm run dev:client
```

Frontend: http://localhost:5173 · API: http://localhost:4000/api

## Development catalog

```powershell
$env:NODE_ENV = 'development'
$env:ALLOW_DEV_SEED = 'true'
npm run seed:catalog
```

If the host blocks `tsx` user-info lookup, use the equivalent compiled script:

```powershell
npm run build
node dist/seed-catalog.js
```

- Creates 48 clearly marked demonstration products across 12 categories, priced in integer USD cents.
- Requires an explicit development environment and opt-in; refuses production.
- Uses unique sparse `demoKey` identities and `$setOnInsert`; reruns neither duplicate nor overwrite products.
- Skips an existing non-demo catalog. To intentionally append demo products to a nonempty development catalog, also set `ALLOW_DEMO_CATALOG_APPEND=true`.
- Creates one demonstration seller with a random, inaccessible password and an approved demonstration store. Creates no customers, administrators, orders, or payment transactions.
- Reuses category slugs without modifying existing categories or customer records.
- Uses public DummyJSON product photography, a public Unsplash hero, and local illustrative SVGs for selected sample goods. Demo descriptions identify illustrative content. No invented reviews or sales are seeded.
- Catalog data lives in `server/demo-catalog.json`; local illustrations live in `client/public/images`.
- Clear the opt-in environment flags when finished. Do not use demonstration data as a production catalog.

## Storefront behavior

Home collections, category navigation, search results, pagination, related products, and product details load from the existing API and MongoDB. Search and filters are reflected in the URL. Added API parameters:

| Parameter | Values |
| --- | --- |
| `brand` | Exact brand name, maximum 80 characters |
| `minRating` | Number from 0 through 5 |
| `inStock` | `true` or `false` |
| `deals` | `true` for original price greater than current price |
| `sort` | `newest`, `popular`, `rating`, `price-asc`, `price-desc` |

Existing category, price, search, featured, limit, and page parameters continue to work. Rating and popularity sorts use actual persisted review/sales totals; new demo products have zero reviews and sales.

Product cards offer authenticated add-to-cart and wishlist actions. Product details add quantity selection, discount display, specifications, image selection, delivery information, related products, and the existing review component. Cart updates use backend revision checking. Checkout retains server-calculated totals, stock checks, cash on delivery, and an idempotency key. Free shipping copy matches the backend: $100 per store; otherwise $5 per store, US delivery only.

The design supports mobile/tablet/desktop layouts, loading and failure states, keyboard focus, and reduced motion. Typography uses Playfair Display/Inter with Georgia/Arial fallbacks.

## Validation

```powershell
npm run build
npm run build:client
npm test
npm run test:e2e
npm run verify:catalog
```

The integration suite uses its own uniquely named isolated database retained for inspection; it does not place customer orders in the development catalog. It requires database/network access. See `docs/TESTING.md` for existing checks.

No newsletter integration or business social/support addresses existed, so no pretend subscription or external social links were added. Set real store contact details and a formal returns policy before a public launch. Google Fonts and external product photos require network access; local fonts can be added later if offline delivery is required.

## Verification completed in this redesign

- Frontend and backend production builds passed.
- 143 automated tests passed across all 10 suites, including new marketplace filter checks.
- The existing Atlas integration suite passed authentication, local SMTP verification, multi-vendor checkout, idempotency, ownership, cancellation inventory restoration, fulfillment, reviews, notifications, administration, and password revocation.
- Seed executed successfully with 48 products and 12 categories; a second run inserted zero products.
- Live API search, category, brand, availability, price, rating, discount, pagination, detail, and related-product checks passed.
- Desktop and mobile browser checks confirmed navigation, search, quantity controls, images, no horizontal overflow, and sign-in feedback for cart/wishlist actions. Authenticated interactions were covered by API integration tests.
- External SMTP delivery and Cloudinary uploads were not rerun. The build reports a non-blocking JavaScript bundle-size warning.

## Guest shopping and checkout

Buyers can add, update, and remove cart selections without signing in. The browser stores only product IDs, quantities, and transfer retry metadata in `markethub.guest-cart.v1`; live product information is fetched from the API. Browser storage must be available to retain selections after closing or reloading the tab.

Checkout prompts guests to sign in or create an account. Login merges their selections with the account cart using the existing revision-checked API. Successfully transferred selections are removed locally; unavailable items remain available for retry or removal. Interrupted transfer attempts track their exact target quantity to avoid duplicating a successful update when retrying a lost response. Shipping and final totals are confirmed after authentication; the backend still validates prices, stock, and orders.

Wishlist and account-specific functions continue to require sign-in. The guest cart is shared by tabs on the same browser origin. It does not place orders or reserve inventory.
