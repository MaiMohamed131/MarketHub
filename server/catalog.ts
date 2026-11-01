import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Category, Product } from "./catalog-models.js";
export const catalog = Router();
const id = z.string().regex(/^[a-f\d]{24}$/i);
const amount = z
  .string()
  .regex(/^\d{1,7}(\.\d{1,2})?$/)
  .transform((v) => Math.round(Number(v) * 100));
export const catalogQuery = z
  .object({
    q: z.string().trim().max(100).optional(),
    category: id.optional(),
    minPrice: amount.optional(),
    maxPrice: amount.optional(),
    sort: z
      .enum(["newest", "price-asc", "price-desc", "popular", "rating"])
      .default("newest"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(48).default(12),
    brand: z.string().trim().max(80).optional(),
    minRating: z.coerce.number().min(0).max(5).optional(),
    inStock: z.enum(["true", "false"]).optional(),
    deals: z.enum(["true", "false"]).optional(),
    featured: z.enum(["true", "false"]).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.minPrice === undefined ||
      v.maxPrice === undefined ||
      v.minPrice <= v.maxPrice,
    { message: "Minimum exceeds maximum" },
  );
export function buildFilter(
  v: z.infer<typeof catalogQuery>,
  categoryIds: mongoose.Types.ObjectId[],
) {
  const filter: Record<string, unknown> = {
    active: true,
    category: v.category
      ? { $eq: new mongoose.Types.ObjectId(v.category), $in: categoryIds }
      : { $in: categoryIds },
  };
  if (v.q) {
    const escaped = v.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { name: { $regex: escaped, $options: "i" } },
      { description: { $regex: escaped, $options: "i" } },
    ];
  }
  if (v.minPrice !== undefined || v.maxPrice !== undefined)
    filter.price = {
      ...(v.minPrice !== undefined ? { $gte: v.minPrice } : {}),
      ...(v.maxPrice !== undefined ? { $lte: v.maxPrice } : {}),
    };
  if (v.featured) filter.featured = v.featured === "true";
  if (v.brand) filter.brand = v.brand;
  if (v.minRating !== undefined) filter.averageRating = { $gte: v.minRating };
  if (v.inStock) filter.stock = v.inStock === "true" ? { $gt: 0 } : 0;
  if (v.deals === "true") filter.$expr = { $gt: ["$originalPrice", "$price"] };
  return filter;
}
export const sortOrders = {
  rating: { averageRating: -1, reviewCount: -1, _id: -1 },
  newest: { createdAt: -1, _id: -1 },
  "price-asc": { price: 1, _id: 1 },
  "price-desc": { price: -1, _id: -1 },
  popular: { salesCount: -1, _id: -1 },
} as const;
const fields =
  "name description price currency stock category storeName images averageRating reviewCount createdAt brand originalPrice specifications demoKey";
function ready() {
  if (mongoose.connection.readyState !== 1)
    throw Object.assign(
      new Error("Catalog temporarily unavailable. Please try again later."),
      { status: 503 },
    );
}
catalog.get("/categories", async (_req, res) => {
  ready();
  const categories = await Category.find({ active: true })
    .select("name slug description image")
    .sort({ name: 1 })
    .lean();
  res.json({ categories });
});
catalog.get("/products", async (req, res) => {
  const v = catalogQuery.parse(req.query);
  ready();
  const categories = await Category.find({ active: true }).select("_id").lean();
  const filter = buildFilter(
    v,
    categories.map((c) => c._id),
  );
  const [products, total] = await Promise.all([
    Product.find(filter)
      .select(fields)
      .sort(sortOrders[v.sort])
      .skip((v.page - 1) * v.limit)
      .limit(v.limit)
      .maxTimeMS(5000)
      .lean(),
    Product.countDocuments(filter).maxTimeMS(5000),
  ]);
  res.json({
    products,
    pagination: {
      page: v.page,
      limit: v.limit,
      total,
      pages: Math.ceil(total / v.limit),
    },
  });
});
catalog.get("/products/:id", async (req, res) => {
  const productId = id.parse(req.params.id);
  ready();
  const product = await Product.findOne({ _id: productId, active: true })
    .select(fields)
    .lean();
  const category = product
    ? await Category.findOne({ _id: product.category, active: true })
        .select("name slug")
        .lean()
    : null;
  if (!product || !category)
    throw Object.assign(new Error("Product not found"), { status: 404 });
  const related = await Product.find({
    active: true,
    category: product.category,
    _id: { $ne: product._id },
  })
    .select(fields)
    .sort({ salesCount: -1, _id: -1 })
    .limit(4)
    .lean();
  res.json({ product: { ...product, category }, related });
});
