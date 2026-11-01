import "dotenv/config";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectDatabase } from "./db.js";
import { User } from "./models.js";
import { SellerApplication } from "./seller-models.js";
import { Product, Category } from "./catalog-models.js";

// No customers, administrators, orders, payments, or existing product data are changed.
if (
  process.env.NODE_ENV !== "development" ||
  process.env.ALLOW_DEV_SEED !== "true"
)
  throw Error(
    "Catalog seed requires NODE_ENV=development and ALLOW_DEV_SEED=true. Production seeding is prohibited.",
  );
const data = JSON.parse(
  await readFile(
    new URL("../server/demo-catalog.json", import.meta.url),
    "utf8",
  ),
);
try {
  await connectDatabase();
  const realProduct = await Product.exists({
    demoKey: { $not: /^markethub-v2-/ },
  });
  if (realProduct && process.env.ALLOW_DEMO_CATALOG_APPEND !== "true") {
    console.log(
      "Existing catalog detected. Nothing changed. Set ALLOW_DEMO_CATALOG_APPEND=true explicitly to add clearly labeled demo listings alongside it.",
    );
  } else {
    // Build only the sparse demo identity index; never drop or reset collections.
    await Product.collection.createIndex(
      { demoKey: 1 },
      { unique: true, sparse: true },
    );
    const email = "catalog-v2-demo@markethub.example";
    let seller = await User.findOne({ email });
    if (seller && (seller.role !== "seller" || !seller.active))
      throw Error(
        "Demo seller identity is unavailable; no existing account was modified.",
      );
    if (!seller)
      seller = await User.create({
        email,
        name: "MarketHub Demonstration Store",
        role: "seller",
        verified: true,
        password: await bcrypt.hash(
          randomBytes(48).toString("hex").slice(0, 64),
          12,
        ),
      });
    await SellerApplication.updateOne(
      { user: seller._id },
      {
        $setOnInsert: {
          user: seller._id,
          storeName: "MarketHub Demo",
          description: "Development demonstration catalog only",
          email,
          phone: "+1 555 555 0100",
          status: "approved",
          reason: "Development-only seed",
        },
      },
      { upsert: true, runValidators: true },
    );
    let inserted = 0;
    const categoryIds = new Map<string, mongoose.Types.ObjectId>();
    for (const category of data.categories) {
      const record = await Category.findOneAndUpdate(
        { slug: category.slug },
        {
          $setOnInsert: {
            ...category,
            description: "Discover " + category.name.toLowerCase(),
            active: true,
          },
        },
        { upsert: true, returnDocument: "after", runValidators: true },
      );
      categoryIds.set(category.slug, record!._id);
    }
    const now = Date.now();
    for (const [index, item] of data.products.entries()) {
      const { slug, ...product } = item;
      const result = await Product.updateOne(
        { demoKey: product.demoKey },
        {
          $setOnInsert: {
            ...product,
            category: categoryIds.get(slug),
            seller: seller._id,
            storeName: "MarketHub Demo",
            active: true,
            averageRating: 0,
            reviewCount: 0,
            salesCount: 0,
            createdAt: new Date(now - index * 60000),
            updatedAt: new Date(now),
          },
        },
        { upsert: true, runValidators: true, timestamps: false },
      );
      inserted += result.upsertedCount;
    }
    console.log(
      `Inserted ${inserted} demonstration products. Existing records unchanged. Catalog contains ${await Product.countDocuments({ demoKey: /^markethub-v2-/ })} demo products.`,
    );
  }
} finally {
  await mongoose.disconnect();
}
