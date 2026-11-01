import { cleanupImages } from "./media-lifecycle.js";
import { recordAudit } from "./audit.js";
import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { User, Session } from "./models.js";
import { Product, Category } from "./catalog-models.js";
import { Order } from "./commerce-models.js";
import { SellerApplication, Media } from "./seller-models.js";
import { Audit, Dispute } from "./admin-models.js";
import { objectId, conflict } from "./commerce-service.js";
import { statusError, imageFormat } from "./seller-validation.js";
import { cancelOrder } from "./order-actions.js";
export const admin = Router();
admin.use((req: any, _res, next) => {
  if (req.user.role !== "admin")
    return next(statusError(403, "Administrator required"));
  if (mongoose.connection.readyState !== 1)
    return next(statusError(503, "Admin services temporarily unavailable"));
  next();
});
const paging = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  q: z.string().trim().max(100).default(""),
};
const reason = z.string().trim().min(3).max(500);
const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const userFields = "name email role active verified createdAt avatar";
admin.get("/overview", async (_req, res) => {
  const [users, products, orders, pendingApplications, sales, recent, events] =
    await Promise.all([
      User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),
      Product.countDocuments({ deleted: { $ne: true } }),
      Order.countDocuments(),
      SellerApplication.countDocuments({ status: "pending" }),
      Order.aggregate([
        { $unwind: "$groups" },
        { $match: { "groups.status": "delivered" } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
            revenue: { $sum: "$groups.subtotal" },
            groups: { $sum: 1 },
          },
        },
        { $sort: { _id: -1 } },
      ]),
      Order.find()
        .select("total paymentMethod paymentStatus createdAt groups.status")
        .sort({ createdAt: -1 })
        .limit(6)
        .lean(),
      Audit.find().sort({ createdAt: -1 }).limit(8).lean(),
    ]);
  res.json({
    users,
    products,
    orders,
    pendingApplications,
    revenue: sales.reduce((n, s) => n + s.revenue, 0),
    sales: sales.slice(0, 12).reverse(),
    recent,
    events,
  });
});
admin.get("/users", async (req, res) => {
  const v = z
    .object({
      ...paging,
      role: z.enum(["customer", "seller", "admin"]).optional(),
      active: z.enum(["true", "false"]).optional(),
    })
    .strict()
    .parse(req.query);
  const filter = {
    ...(v.role ? { role: v.role } : {}),
    ...(v.active ? { active: v.active === "true" } : {}),
    ...(v.q
      ? {
          $or: [
            { name: { $regex: escape(v.q), $options: "i" } },
            { email: { $regex: escape(v.q), $options: "i" } },
          ],
        }
      : {}),
  };
  const [users, total] = await Promise.all([
    User.find(filter)
      .select(userFields)
      .sort({ createdAt: -1, _id: -1 })
      .skip((v.page - 1) * 20)
      .limit(20)
      .lean(),
    User.countDocuments(filter),
  ]);
  res.json({ users, total, page: v.page });
});
admin.get("/users/:id", async (req, res) => {
  const id = objectId.parse(req.params.id);
  const user = await User.findById(id).select(userFields).lean();
  if (!user) throw statusError(404, "User not found");
  const application = await SellerApplication.findOne({ user: id }).lean();
  res.json({ user, application });
});
admin.patch("/users/:id/active", async (req: any, res) => {
  const id = objectId.parse(req.params.id);
  const v = z.object({ active: z.boolean(), reason }).strict().parse(req.body);
  if (id === req.user.id)
    throw conflict("You cannot change your own administrator account");
  await mongoose.connection.transaction(async (session) => {
    const target = await User.findById(id).session(session);
    if (!target) throw statusError(404, "User not found");
    if (target.role === "admin")
      throw statusError(
        403,
        "Administrator accounts require separate account governance",
      );
    target.active = v.active;
    target.version++;
    await target.save({ session });
    await Session.deleteMany({ user: target._id }, { session });
    if (!v.active) {
      await SellerApplication.updateOne(
        { user: target._id, status: "approved" },
        {
          $set: {
            status: "suspended",
            reason: "Account deactivated by administrator",
          },
          $inc: { __v: 1 },
        },
        { session },
      );
      await Product.updateMany(
        { seller: target._id },
        { $set: { active: false }, $inc: { __v: 1 } },
        { session },
      );
    }
    await recordAudit(
      [
        {
          actor: req.user._id,
          action: v.active ? "user.activated" : "user.deactivated",
          target: target._id,
          reason: v.reason,
        },
      ],
      { session },
    );
  });
  res.status(204).end();
});
admin.get("/sellers", async (req, res) => {
  const v = z
    .object({
      ...paging,
      status: z
        .enum(["pending", "approved", "rejected", "suspended"])
        .optional(),
    })
    .strict()
    .parse(req.query);
  const filter = {
    ...(v.status ? { status: v.status } : {}),
    ...(v.q ? { storeName: { $regex: escape(v.q), $options: "i" } } : {}),
  };
  const [sellers, total] = await Promise.all([
    SellerApplication.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((v.page - 1) * 20)
      .limit(20)
      .lean(),
    SellerApplication.countDocuments(filter),
  ]);
  res.json({ sellers, total, page: v.page });
});
admin.get("/products", async (req, res) => {
  const v = z
    .object({
      ...paging,
      active: z.enum(["true", "false"]).optional(),
      seller: objectId.optional(),
      category: objectId.optional(),
    })
    .strict()
    .parse(req.query);
  const filter = {
    ...(v.active ? { active: v.active === "true" } : {}),
    ...(v.seller ? { seller: v.seller } : {}),
    ...(v.category ? { category: v.category } : {}),
    ...(v.q ? { name: { $regex: escape(v.q), $options: "i" } } : {}),
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
admin.get("/products/:id", async (req, res) => {
  const product = await Product.findById(objectId.parse(req.params.id)).lean();
  if (!product) throw statusError(404, "Product not found");
  res.json({ product });
});
admin.patch("/products/:id", async (req: any, res) => {
  const id = objectId.parse(req.params.id);
  const v = z
    .object({ active: z.boolean(), reason, version: z.number().int().min(0) })
    .strict()
    .parse(req.body);
  await mongoose.connection.transaction(async (session) => {
    const product = await Product.findOne({
      _id: id,
      __v: v.version,
      deleted: { $ne: true },
    }).session(session);
    if (!product) throw conflict("Product changed or archived");
    if (v.active) {
      if (
        !product.images.length ||
        !(await Category.exists({
          _id: product.category,
          active: true,
        }).session(session)) ||
        !(await SellerApplication.exists({
          user: product.seller,
          status: "approved",
        }).session(session)) ||
        !(await User.exists({ _id: product.seller, active: true }).session(
          session,
        ))
      )
        throw conflict("Product is not eligible for publication");
    }
    product.active = v.active;
    product.moderationBlocked = !v.active;
    product.__v++;
    await product.save({ session });
    await recordAudit(
      [
        {
          actor: req.user._id,
          action: v.active ? "product.approved" : "product.blocked",
          target: product._id,
          reason: v.reason,
        },
      ],
      { session },
    );
  });
  res.status(204).end();
});
admin.delete("/products/:id", async (req: any, res) => {
  const id = objectId.parse(req.params.id);
  const { reason: r } = z.object({ reason }).strict().parse(req.body);
  const previous = await Product.findById(id).select("images").lean();
  await mongoose.connection.transaction(async (session) => {
    const result = await Product.updateOne(
      { _id: id, deleted: { $ne: true } },
      {
        $set: { active: false, deleted: true, moderationBlocked: true },
        $inc: { __v: 1 },
      },
      { session },
    );
    if (!result.matchedCount) throw statusError(404, "Product not found");
    await recordAudit(
      [
        {
          actor: req.user._id,
          action: "product.archived",
          target: new mongoose.Types.ObjectId(id),
          reason: r,
        },
      ],
      { session },
    );
  });
  await cleanupImages(previous?.images || []);
  res.status(204).end();
});
export const categoryInput = z
  .object({
    name: z.string().trim().min(2).max(80),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(100),
    description: z.string().trim().max(500),
    image: z.union([z.literal(""), z.url().startsWith("https://")]),
    active: z.boolean(),
  })
  .strict();
admin.get("/categories", async (_req, res) =>
  res.json({ categories: await Category.find().sort({ name: 1 }).lean() }),
);
async function ownImage(url: string, user: mongoose.Types.ObjectId) {
  if (url && !(await Media.exists({ seller: user, url })))
    throw statusError(400, "Use an image uploaded by your account");
}
admin.post("/categories", async (req: any, res) => {
  const v = categoryInput.parse(req.body);
  await ownImage(v.image, req.user._id);
  res.status(201).json({ category: await Category.create(v) });
});
admin.patch("/categories/:id", async (req: any, res) => {
  const id = objectId.parse(req.params.id);
  const { version, ...v } = categoryInput
    .extend({ version: z.number().int().min(0) })
    .parse(req.body);
  const current = await Category.findById(id).lean();
  if (!current) throw statusError(404, "Category not found");
  if (v.image !== current.image) await ownImage(v.image, req.user._id);
  const category = await Category.findOneAndUpdate(
    { _id: id, __v: version },
    { $set: v, $inc: { __v: 1 } },
    { new: true, runValidators: true },
  );
  if (!category) throw conflict("Category changed. Refresh before editing.");
  res.json({ category });
});
admin.delete("/categories/:id", async (req, res) => {
  const id = objectId.parse(req.params.id);
  await mongoose.connection.transaction(async (session) => {
    if (await Product.exists({ category: id }).session(session))
      throw conflict(
        "Category is referenced by products. Deactivate it instead.",
      );
    const deleted = await Category.findOneAndDelete({ _id: id }).session(
      session,
    );
    if (!deleted) throw statusError(404, "Category not found");
  });
  res.status(204).end();
});
admin.get("/orders", async (req, res) => {
  const v = z
    .object({
      ...paging,
      status: z
        .enum([
          "pending",
          "confirmed",
          "processing",
          "shipped",
          "delivered",
          "cancelled",
        ])
        .optional(),
    })
    .strict()
    .parse(req.query);
  const filter = {
    ...(v.status ? { "groups.status": v.status } : {}),
    ...(v.q
      ? mongoose.isValidObjectId(v.q)
        ? { _id: v.q }
        : { "address.email": { $regex: escape(v.q), $options: "i" } }
      : {}),
  };
  const [orders, total] = await Promise.all([
    Order.find(filter)
      .select("user total groups paymentStatus createdAt cancelledAt")
      .sort({ createdAt: -1, _id: -1 })
      .skip((v.page - 1) * 20)
      .limit(20)
      .lean(),
    Order.countDocuments(filter),
  ]);
  res.json({ orders, total, page: v.page });
});
admin.get("/orders/:id", async (req, res) => {
  const id = objectId.parse(req.params.id);
  const order = await Order.findById(id).lean();
  if (!order) throw statusError(404, "Order not found");
  res.json({
    order,
    disputes: await Dispute.find({ order: id }).sort({ createdAt: -1 }).lean(),
  });
});
admin.post("/orders/:id/cancel", async (req, res) => {
  const id = objectId.parse(req.params.id);
  await cancelOrder(id);
  res.status(204).end();
});
admin.post("/orders/:id/disputes", async (req: any, res) => {
  const id = objectId.parse(req.params.id);
  const v = z
    .object({
      subject: z.string().trim().min(3).max(120),
      notes: z.string().trim().min(10).max(3000),
    })
    .strict()
    .parse(req.body);
  if (!(await Order.exists({ _id: id })))
    throw statusError(404, "Order not found");
  res.status(201).json({
    dispute: await Dispute.create({
      ...v,
      order: id,
      createdBy: req.user._id,
    }),
  });
});
admin.patch("/orders/:id/disputes/:disputeId", async (req: any, res) => {
  const id = objectId.parse(req.params.id),
    disputeId = objectId.parse(req.params.disputeId);
  const v = z
    .object({ notes: z.string().trim().min(10).max(3000) })
    .strict()
    .parse(req.body);
  const dispute = await Dispute.findOneAndUpdate(
    { _id: disputeId, order: id, status: "open" },
    {
      $set: {
        resolution: v.notes,
        status: "resolved",
        resolvedBy: req.user._id,
        resolvedAt: new Date(),
      },
    },
    { new: true },
  );
  if (!dispute) throw conflict("Dispute not found or already resolved");
  res.json({ dispute });
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
}).single("image");
admin.post(
  "/images",
  (req, res, next) =>
    upload(req, res, (e) =>
      e ? next(statusError(400, "Upload one image of at most 5 MB")) : next(),
    ),
  async (req: any, res) => {
    if (!req.file || !imageFormat(req.file.buffer))
      throw statusError(400, "Only PNG, JPEG, and WebP images are allowed");
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    )
      throw statusError(503, "Image storage is not configured");
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    const result = await new Promise<{ secure_url: string; public_id: string }>(
      (resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: `markethub/categories/${req.user.id}`,
            resource_type: "image",
            allowed_formats: ["jpg", "png", "webp"],
            transformation: [{ width: 1200, height: 1200, crop: "limit" }],
          },
          (err, r) =>
            err || !r
              ? reject(statusError(502, "Image upload failed"))
              : resolve(r),
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
      await cloudinary.uploader.destroy(result.public_id).catch(() => {});
      throw e;
    }
    res.status(201).json({ url: result.secure_url });
  },
);
