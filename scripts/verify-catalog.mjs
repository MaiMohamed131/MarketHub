import { readFile, writeFile } from "node:fs/promises";
const base = "http://localhost:4000/api";
const get = async (path) => {
  const r = await fetch(base + path);
  if (!r.ok) throw Error(`${path}: HTTP ${r.status}`);
  return r.json();
};
const all = await get("/products?limit=48");
const categories = (await get("/categories")).categories;
const assert = (v, label) => {
  if (!v) throw Error(label);
};
assert(all.pagination.total >= 48, "Expected populated MongoDB catalog");
const sample = all.products.find((p) => p.stock > 0);
const search = await get("/products?q=" + encodeURIComponent(sample.name));
assert(
  search.products.some((p) => p._id === sample._id),
  "Search failed",
);
for (const category of categories) {
  const list = await get("/products?category=" + category._id);
  assert(
    list.products.every((p) => p.category === category._id),
    "Category filter failed",
  );
}
const inStock = await get("/products?inStock=true&limit=48");
assert(
  inStock.products.every((p) => p.stock > 0),
  "Stock filter failed",
);
const brand = await get("/products?brand=" + encodeURIComponent(sample.brand));
assert(
  brand.products.every((p) => p.brand === sample.brand),
  "Brand filter failed",
);
const price = await get(
  "/products?minPrice=10&maxPrice=50&sort=price-asc&limit=48",
);
assert(
  price.products.every(
    (p, i, a) =>
      p.price >= 1000 && p.price <= 5000 && (!i || p.price >= a[i - 1].price),
  ),
  "Price filter/sort failed",
);
const rated = await get("/products?minRating=4&sort=rating");
assert(
  rated.products.every((p) => p.averageRating >= 4),
  "Rating filter failed",
);
const deals = await get("/products?deals=true&limit=48");
assert(
  deals.products.every((p) => p.originalPrice > p.price),
  "Deals filter failed",
);
const page2 = await get("/products?limit=4&page=2");
assert(
  page2.pagination.page === 2 && page2.products.length === 4,
  "Pagination failed",
);
const detail = await get("/products/" + sample._id);
assert(
  detail.product._id === sample._id &&
    detail.related.every((p) => p._id !== sample._id),
  "Detail/related failed",
);
const seed = JSON.parse(await readFile("server/demo-catalog.json", "utf8"));
const images = [...new Set(seed.products.flatMap((p) => p.images))];
const failures = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: 5 }, async () => {
    while (cursor < images.length) {
      const src = images[cursor++];
      try {
        const url = src.startsWith("/") ? "http://localhost:5173" + src : src;
        const r = await fetch(url, {
          method: "HEAD",
          signal: AbortSignal.timeout(20000),
        });
        if (!r.ok || !r.headers.get("content-type")?.startsWith("image/"))
          failures.push({ src, status: r.status });
      } catch {
        failures.push({ src, status: "unreachable" });
      }
    }
  }),
);
const report = {
  products: all.pagination.total,
  categories: categories.length,
  apiChecks: "passed",
  imagesChecked: images.length,
  imageFailures: failures,
};
await writeFile(
  "docs/catalog-verification.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
