import { configuredCloudinary, destroyProjectImage } from "./cloudinary.js";
import { claimProductImages, cleanupImages } from "./media-lifecycle.js";
import { notify } from "./community-models.js";
import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import multer from "multer";
import { SellerApplication, Media } from "./seller-models.js";
import { Category, Product } from "./catalog-models.js";
import { Order } from "./commerce-models.js";
import { User } from "./models.js";
import { objectId, conflict } from "./commerce-service.js";
import {
  applicationSchema,
  productInput,
  productEdit,
  inventoryInput,
  imageFormat,
  statusError,
} from "./seller-validation.js";
export const sellers = Router();
sellers.use((_req, _res, next) =>
  mongoose.connection.readyState === 1
    ? next()
    : next(statusError(503, "Seller services temporarily unavailable")),
);
sellers.get("/seller/application", async (req: any, res) => {
  const application = await SellerApplication.findOne({
    user: req.user._id,
  }).lean();
  res.json({ application });
});
sellers.post("/seller/application", async (req: any, res) => {
  if (req.user.role !== "customer")
    throw statusError(403, "Only customers may apply");
  const v = applicationSchema.parse(req.body);
  const current = await SellerApplication.findOne({ user: req.user._id });
  if (current && current.status !== "rejected")
    throw conflict("An application already exists");
  if (current) {
    const updated = await SellerApplication.findOneAndUpdate(
      { _id: current._id, status: "rejected" },
      {
        $set: { ...v, status: "pending", reason: "" },
        $unset: { reviewedBy: 1, reviewedAt: 1 },
      },
      { new: true },
    );
    if (!updated) throw conflict("Application changed");
    res.json({ application: updated });
  } else
    res.status(201).json({
      application: await SellerApplication.create({
        ...v,
        user: req.user._id,
      }),
    });
});
sellers.get("/admin/seller-applications", async (req: any, res) => {
  if (req.user.role !== "admin")
    throw statusError(403, "Administrator required");
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(1)
    .parse(req.query.page);
  res.json({
    applications: await SellerApplication.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * 20)
      .limit(20)
      .lean(),
  });
});
sellers.patch("/admin/seller-applications/:id", async (req: any, res) => {
  if (req.user.role !== "admin")
    throw statusError(403, "Administrator required");
  const id = objectId.parse(req.params.id);
  const v = z
    .object({
      status: z.enum(["approved", "rejected", "suspended"]),
      reason: z.string().trim().min(3).max(500),
    })
    .strict()
    .parse(req.body);
  await mongoose.connection.transaction(async (session) => {
    const a = await SellerApplication.findById(id).session(session);
    if (!a) throw statusError(404, "Application not found");
    const allowed =
      a.status === "pending"
        ? ["approved", "rejected"]
        : a.status === "approved"
          ? ["suspended"]
          : a.status === "suspended"
            ? ["approved"]
            : [];
    if (!allowed.includes(v.status))
      throw conflict("Invalid application transition");
    const user = await User.findOne({ _id: a.user, active: true }).session(
      session,
    );
    if (!user || user.role === "admin")
      throw conflict("Applicant account unavailable");
    a.status = v.status;
    a.reason = v.reason;
    a.reviewedBy = req.user._id;
    a.reviewedAt = new Date();
    await a.save({ session });
    if (v.status === "approved") {
      user.role = "seller";
      await user.save({ session });
    }
    if (v.status === "suspended")
      await Product.updateMany(
        { seller: a.user },
        { $set: { active: false }, $inc: { __v: 1 } },
        { session },
      );
  });
  res.status(204).end();
});
export async function approvedSeller(req: any, _res: any, next: any) {
  try {
    if (req.user.role !== "seller")
      throw statusError(403, "Approved seller required");
    const a = await SellerApplication.findOne({
      user: req.user._id,
      status: "approved",
    });
    if (!a) throw statusError(403, "Seller approval required");
    req.store = a;
    next();
  } catch (e) {
    next(e);
  }
}
sellers.use("/seller/manage", approvedSeller);
const pageInput = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    q: z.string().trim().max(100).default(""),
    low: z.enum(["true", "false"]).optional(),
  })
  .strict();
sellers.get("/seller/manage/products", async (req: any, res) => {
  const v = pageInput.parse(req.query);
  const filter: Record<string, unknown> = {
    seller: req.user._id,
    deleted: { $ne: true },
  };
  if (v.low === "true") filter.stock = { $lte: 5 };
  if (v.q)
    filter.name = {
      $regex: v.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      $options: "i",
    };
  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((v.page - 1) * 20)
      .limit(20)
      .lean(),
    Product.countDocuments(filter),
  ]);
  res.json({ products, total, page: v.page });
});
sellers.get("/seller/manage/products/:id", async (req: any, res) => {
  const product = await Product.findOne({
    _id: objectId.parse(req.params.id),
    seller: req.user._id,
    deleted: { $ne: true },
  }).lean();
  if (!product) throw statusError(404, "Product not found");
  res.json({ product });
});
async function validateReferences(
  v: { category: string; images: string[]; active: boolean },
  seller: mongoose.Types.ObjectId,
) {
  if (!(await Category.exists({ _id: v.category, active: true })))
    throw conflict("Choose an active category");
  if (new Set(v.images).size !== v.images.length)
    throw conflict("Duplicate image");
  if (v.active && !v.images.length)
    throw conflict("Upload at least one image before publishing");
  const count = await Media.countDocuments({
    seller,
    url: { $in: v.images },
    status: { $ne: "deleting" },
  });
  if (count !== v.images.length)
    throw statusError(400, "Use images uploaded by your store");
}
sellers.post("/seller/manage/products", async (req: any, res) => {
  const v = productInput.parse(req.body);
  await validateReferences(v, req.user._id);
  let product;
  await mongoose.connection.transaction(async (session) => {
    const gate = await SellerApplication.updateOne(
      { user: req.user._id, status: "approved" },
      { $inc: { __v: 1 } },
      { session },
    );
    if (!gate.matchedCount) throw statusError(403, "Seller approval required");
    await claimProductImages(v.images, req.user._id, session);
    const categoryGuard = await Category.updateOne(
      { _id: v.category, active: true },
      { $inc: { __v: 1 } },
      { session },
    );
    if (!categoryGuard.matchedCount) throw conflict("Category unavailable");
    [product] = await Product.create(
      [{ ...v, seller: req.user._id, storeName: req.store.storeName }],
      { session },
    );
  });
  res.status(201).json({ product });
});
sellers.patch("/seller/manage/products/:id", async (req: any, res) => {
  const id = objectId.parse(req.params.id);
  const { version, ...v } = productEdit.parse(req.body);
  await validateReferences(v, req.user._id);
  const previous = await Product.findOne({ _id: id, seller: req.user._id })
    .select("images")
    .lean();
  let product;
  await mongoose.connection.transaction(async (session) => {
    const gate = await SellerApplication.updateOne(
      { user: req.user._id, status: "approved" },
      { $inc: { __v: 1 } },
      { session },
    );
    if (!gate.matchedCount) throw statusError(403, "Seller approval required");
    const categoryGuard = await Category.updateOne(
      { _id: v.category, active: true },
      { $inc: { __v: 1 } },
      { session },
    );
    if (!categoryGuard.matchedCount) throw conflict("Category unavailable");
    product = await Product.findOneAndUpdate(
      {
        _id: id,
        seller: req.user._id,
        __v: version,
        deleted: { $ne: true },
        moderationBlocked: { $ne: true },
      },
      { $set: v, $inc: { __v: 1 } },
      { new: true, runValidators: true, session },
    );
    if (!product)
      throw conflict("Product unavailable or changed. Reload before editing.");
  });
  const imageCleanup = await cleanupImages(
    (previous?.images || []).filter((url) => !v.images.includes(url)),
    req.user._id,
  );
  res.json({ product, imageCleanup });
});
sellers.post("/seller/manage/products/:id/inventory", async (req: any, res) => {
  const id = objectId.parse(req.params.id);
  const { delta, expectedStock } = inventoryInput.parse(req.body);
  const nextStock = expectedStock + delta;
  if (nextStock < 0 || nextStock > 1000000)
    throw conflict("Stock must stay between 0 and 1,000,000");
  const product = await mongoose.connection.transaction(async (session) => {
    const product = await Product.findOneAndUpdate(
      {
        _id: id,
        seller: req.user._id,
        deleted: { $ne: true },
        stock: expectedStock,
      },
      { $inc: { stock: delta, __v: 1 } },
      { new: true, runValidators: true, session },
    );
    if (!product)
      throw conflict(
        "Stock changed or product unavailable. Refresh before adjusting.",
      );
    if (delta < 0 && nextStock <= 5)
      await notify(
        req.user._id,
        "Low stock",
        product.name + " has " + nextStock + " units remaining.",
        "/seller/products/" + id,
        "inventory:" + id + ":" + product.__v,
        session,
      );
    return product;
  });
  res.json({ product });
});
sellers.delete("/seller/manage/products/:id", async (req: any, res) => {
  const id = objectId.parse(req.params.id);
  const previous = await Product.findOne({ _id: id, seller: req.user._id })
    .select("images")
    .lean();
  const r = await Product.updateOne(
    { _id: id, seller: req.user._id, deleted: { $ne: true } },
    { $set: { deleted: true, active: false }, $inc: { __v: 1 } },
  );
  if (!r.matchedCount) throw statusError(404, "Product not found");
  await cleanupImages(previous?.images || [], req.user._id);
  res.status(204).end();
});
sellers.get("/seller/manage/overview", async (req: any, res) => {
  const seller = req.user._id;
  const [totalProducts, lowStock, stats, recent] = await Promise.all([
    Product.countDocuments({ seller, deleted: { $ne: true } }),
    Product.find({ seller, deleted: { $ne: true }, stock: { $lte: 5 } })
      .select("name stock")
      .limit(10)
      .lean(),
    Order.aggregate([
      { $match: { "groups.seller": seller } },
      { $unwind: "$groups" },
      { $match: { "groups.seller": seller } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          pendingOrders: {
            $sum: {
              $cond: [
                {
                  $in: [
                    "$groups.status",
                    ["pending", "confirmed", "processing", "shipped"],
                  ],
                },
                1,
                0,
              ],
            },
          },
          completedOrders: {
            $sum: { $cond: [{ $eq: ["$groups.status", "delivered"] }, 1, 0] },
          },
          totalSales: {
            $sum: {
              $cond: [
                { $eq: ["$groups.status", "delivered"] },
                "$groups.subtotal",
                0,
              ],
            },
          },
        },
      },
    ]),
    Order.find({ "groups.seller": seller })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
  ]);
  res.json({
    totalProducts,
    lowStock,
    stats: stats[0] || {
      totalOrders: 0,
      pendingOrders: 0,
      completedOrders: 0,
      totalSales: 0,
    },
    recent: recent.map((o) => ({
      _id: o._id,
      createdAt: o.createdAt,
      groups: o.groups.filter((g) => String(g.seller) === req.user.id),
    })),
  });
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 0 },
}).single("image");
sellers.post(
  "/seller/manage/images",
  (req, res, next) =>
    upload(req, res, (e) =>
      e ? next(statusError(400, "Upload one image of at most 4 MB")) : next(),
    ),
  async (req: any, res) => {
    if (!req.file || !imageFormat(req.file.buffer))
      throw statusError(400, "Only PNG, JPEG, and WebP images are allowed");
    const cloudinary = configuredCloudinary();
    const result = await new Promise<{ secure_url: string; public_id: string }>(
      (resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: `markethub/products/${req.user.id}`,
            resource_type: "image",
            allowed_formats: ["jpg", "png", "webp"],
            transformation: [
              { width: 1600, height: 1600, crop: "limit" },
              { fetch_format: "auto" },
            ],
          },
          (err, result) =>
            err
              ? reject(statusError(502, "Image upload failed"))
              : result
                ? resolve(result)
                : reject(statusError(502, "Image upload failed")),
        );
        stream.end(req.file.buffer);
      },
    );
    try {
      await Media.create({
        seller: req.user._id,
        url: result.secure_url,
        publicId: result.public_id,
      });
    } catch (e) {
      await destroyProjectImage(result.public_id).catch(() => {});
      throw e;
    }
    res.status(201).json({ url: result.secure_url });
  },
);

sellers.delete("/seller/manage/images", async (req: any, res) => {
  const { url } = z
    .object({ url: z.url().startsWith("https://") })
    .strict()
    .parse(req.body);
  const results = await cleanupImages([url], req.user._id);
  if (!results.length) throw statusError(404, "Image not found");
  if (results[0].status === "retained")
    throw conflict("Image is still used by a product or order");
  if (results[0].status === "pending")
    throw statusError(503, "Image cleanup is pending; retry later");
  res.status(204).end();
});
