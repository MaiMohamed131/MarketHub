# Browser QA — MarketHub

Date: 2026-10-31. The real React/Vite frontend and Express API were exercised against Atlas database `mh_browser_1793471619728`. Existing marketplace data/accounts were not modified. Test users are synthetic verified customer, two sellers, and administrator accounts. Initial product photos were deliberately absent to exercise the missing-image fallback; they are not portfolio product photography.

## Verified browser workflows

| Area | Observed result |
| --- | --- |
| Customer sign-in/logout | Successful customer, seller, and administrator sign-in and sign-out through the real forms; refresh after full page navigation continued working. |
| Catalog | Products and categories loaded; invalid min/max range produced form feedback; search plus $20–$25 filters appeared in the URL and found the matching product. |
| Product details | Description, seller, price, stock and image-unavailable fallback displayed. Delivered purchase later showed 5.0 and one review. |
| Wishlist/cart | Saved a product, moved it to cart, added a second seller's product, and opened checkout. |
| Multi-vendor checkout | Two groups ($24 + $32), $10 shipping and $66 total confirmed; no online payment was simulated. |
| Fulfillment | Seller saw only the Ceramic Coffee Cup group, not the other store's item; confirmed → processing → shipped → delivered succeeded. |
| Reviews | Delivered product offered a review link; browser submission succeeded and public product displayed the review/rating. |
| Cancellation | A second $29 order displayed a confirmation dialog, cancelled successfully, and stock returned to 11 (12 initial minus the delivered unit). |
| Notifications | Customer saw placed/confirmed/processing/shipped/delivered events; mark-all-read completed. |
| Seller products | Created a draft via the form; it appeared in the product list; inventory adjustment changed stock from 3 to 7. |
| Admin overview | Role/product/order counts, $24 delivered revenue, and recent order appeared. |
| User management | Searched for the test customer, deactivated with a reason, then reactivated; observed inactive/active status changes. |
| Category management | Created Mobile accessories; uploaded an image and saved it. |
| Browser uploads | Non-image file rejected with the correct message; real PNG upload through the file chooser succeeded against Cloudinary. |
| Product moderation | Blocked the test listing; admin row changed to blocked and public details became unavailable. |
| Order management/disputes | Admin saw both seller groups, opened an internal case, resolved it and saw the resolution retained. |
| Authorization | Customer navigating to admin saw Administrator access required rather than private dashboard content. |

## Responsive checks

The browser viewport control was checked against actual CSS widths reported by the rendered document. Phone widths 320 and 390, tablet width 800, and desktop width 1440 were exercised. An additional 487px mobile viewport was used during early order/seller/admin checks.

Observed document widths stayed within the viewport on the measured home, product, seller fulfillment/inventory, admin category and user-table pages. Wide admin tables scroll inside their own overflow containers rather than forcing page-level horizontal scrolling. Mobile menu navigation worked. Screenshots were visually inspected for customer order tracking, seller inventory, mobile home/product, and desktop administration. Capture was unavailable at the narrowest 320px override, so that width was checked through rendered DOM/accessibility and layout bounds instead.

## Issues fixed and rechecked

1. Dashboard and utility-page h1 elements inherited Tailwind's 16px reset. Restored a responsive heading hierarchy; desktop admin heading now computes to 40px and mobile detail headings remain appropriately sized.
2. Checkout briefly rendered cached totals while refetching the cart. Cart mounts now request a refresh, and order submission is disabled with Refreshing totals feedback until it completes. The disabled state was observed in the browser. Backend total/revision validation remains unchanged.
3. Development hot reload recreated the React root, producing console warnings. Reuse the existing root through Vite hot-module data. Subsequent page reload/hot updates rendered successfully; historical console entries remain in the browser log.
4. A blocked/removed product's 404 was presented as a catalog connectivity outage. Added a specific unavailable-listing state with a browse-marketplace link, and verified it against the blocked product.
5. Corrected singular rating/review labels (one star, one review).

## Evidence

- [Desktop admin overview](screenshots/desktop-admin-overview.png)
- [Mobile admin users](screenshots/mobile-admin-users.png)
- [Mobile admin order](screenshots/mobile-admin-order.png)
- [Mobile product](screenshots/mobile-product-review.png)
- [Tablet homepage](screenshots/tablet-home.png)
- [Unavailable listing](screenshots/desktop-unavailable-product.png)

## Reproduction and limits

Run `npm run test:browser:serve` and `npm run dev:client` in separate terminals. The fixture launcher refuses production mode, creates a NEW isolated Atlas database each time, provisions indexes there, and binds the API to loopback on port 4000. It uses reserved .example identities and a known test-only password; it must never be exposed as a production server. This is an explicit testing fixture command, not the normal application startup or production seed.

This was a single-browser manual QA pass, not an automated cross-browser/device certification. Registration/password-reset browser submission, every seller-application transition, every product-edit/archive edge case, and every action at every breakpoint were not exhaustively repeated here. Those API/security paths have separate unit/live integration coverage. Actual password changes through browser automation were not performed. Payment collection and shipping integrations are not implemented and were not represented as tested.

Existing dependency advisories and Vite's bundle-size warning remain separate outstanding items. The fixture database is retained for inspection. Only the one Cloudinary image generated by this browser run is eligible for test cleanup; existing project assets are untouched.

## Final checks and cleanup

All 141 Jest/Supertest tests pass, backend TypeScript compilation passes, and the latest frontend type-check/production build passes. The single Cloudinary asset created through the browser test was removed successfully (one checked, one deleted, zero pending) after clearing its test-category reference in the isolated database. The fixture API and Vite test servers were stopped. Existing marketplace data and assets were untouched. Six screenshots are retained with this report.
