import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Review, Notification } from "./community-models.js";
import { Product, Category } from "./catalog-models.js";
import { Order } from "./commerce-models.js";
import { objectId, conflict } from "./commerce-service.js";
import { statusError } from "./seller-validation.js";
export const reviewInput = z
  .object({
    order: objectId,
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().min(3).max(2000),
  })
  .strict();
export function eligible(
  groups: { status?: string | null; items: { product: unknown }[] }[],
  product: string,
) {
  return groups.some(
    (g) =>
      g.status === "delivered" &&
      g.items.some((i) => String(i.product) === product),
  );
}
export const publicCommunity = Router(),
  community = Router();
const ready = (_req: any, _res: any, next: any) =>
  mongoose.connection.readyState === 1
    ? next()
    : next(statusError(503, "Community services temporarily unavailable"));
publicCommunity.get("/products/:id/reviews", ready, async (req, res) => {
  const id = objectId.parse(req.params.id);
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(1)
    .parse(req.query.page);
  const p = await Product.findOne({ _id: id, active: true });
  if (!p || !(await Category.exists({ _id: p.category, active: true })))
    throw statusError(404, "Product not found");
  const [reviews, total] = await Promise.all([
    Review.find({ product: id })
      .select("rating comment displayName createdAt updatedAt")
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * 10)
      .limit(10)
      .lean(),
    Review.countDocuments({ product: id }),
  ]);
  res.json({ reviews, total, page });
});
community.use(ready);
community.get("/reviews/mine", async (req: any, res) => {
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(1)
    .parse(req.query.page);
  res.json({
    reviews: await Review.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .skip((page - 1) * 20)
      .limit(20)
      .lean(),
  });
});
community.put("/products/:id/review", async (req: any, res) => {
  const id = objectId.parse(req.params.id);
  const v = reviewInput.parse(req.body);
  if (req.user.role !== "customer")
    throw statusError(403, "Customer account required");
  let review;
  await mongoose.connection.transaction(async (session) => {
    const order = await Order.findOne({
      _id: v.order,
      user: req.user._id,
    }).session(session);
    if (!order || !eligible(order.groups, id))
      throw statusError(
        403,
        "A delivered purchase of this product is required",
      );
    const product = await Product.findById(id).session(session);
    if (!product || product.deleted)
      throw statusError(404, "Product not found");
    review = await Review.findOneAndUpdate(
      { user: req.user._id, product: id, order: v.order },
      {
        $set: {
          rating: v.rating,
          comment: v.comment,
          displayName: req.user.name,
        },
        $setOnInsert: { user: req.user._id, product: id, order: v.order },
      },
      { upsert: true, new: true, session, runValidators: true },
    );
    const stats = await Review.aggregate([
      { $match: { product: new mongoose.Types.ObjectId(id) } },
      {
        $group: { _id: null, average: { $avg: "$rating" }, count: { $sum: 1 } },
      },
    ]).session(session);
    product.averageRating = stats[0]?.average || 0;
    product.reviewCount = stats[0]?.count || 0;
    product.__v++;
    await product.save({ session });
  });
  res.json({ review });
});
community.get("/notifications", async (req: any, res) => {
  const v = z
    .object({
      page: z.coerce.number().int().min(1).max(10000).default(1),
      unread: z.enum(["true", "false"]).optional(),
    })
    .strict()
    .parse(req.query);
  const filter = {
    user: req.user._id,
    ...(v.unread === "true" ? { readAt: null } : {}),
  };
  const [notifications, total, unread] = await Promise.all([
    Notification.find(filter)
      .select("title message path readAt createdAt")
      .sort({ createdAt: -1, _id: -1 })
      .skip((v.page - 1) * 20)
      .limit(20)
      .lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: req.user._id, readAt: null }),
  ]);
  res.json({ notifications, total, unread, page: v.page });
});
community.patch("/notifications/read-all", async (req: any, res) => {
  await Notification.updateMany(
    { user: req.user._id, readAt: null },
    { $set: { readAt: new Date() } },
  );
  res.status(204).end();
});
community.patch("/notifications/:id/read", async (req: any, res) => {
  const id = objectId.parse(req.params.id);
  const result = await Notification.updateOne(
    { _id: id, user: req.user._id },
    { $set: { readAt: new Date() } },
  );
  if (!result.matchedCount) throw statusError(404, "Notification not found");
  res.status(204).end();
});
