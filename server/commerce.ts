import { notify } from "./community-models.js";
import { cancelOrder } from "./order-actions.js";
import { approvedSeller } from "./seller.js";
import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Basket, Order } from "./commerce-models.js";
import { Category, Product } from "./catalog-models.js";
import { User } from "./models.js";
import {
  calculateOrder,
  canCancel,
  checkoutSchema,
  conflict,
  objectId,
  quantity,
  transitions,
} from "./commerce-service.js";
export const commerce = Router();
commerce.use((_req, _res, next) => {
  if (mongoose.connection.readyState !== 1)
    return next(
      Object.assign(new Error("Shopping temporarily unavailable"), {
        status: 503,
      }),
    );
  next();
});
async function basket(user: mongoose.Types.ObjectId) {
  const result = await Basket.findOneAndUpdate(
    { user },
    { $setOnInsert: { user } },
    { upsert: true, new: true },
  );
  if (!result) throw conflict("Unable to load cart");
  return result;
}
async function available(id: unknown, session?: mongoose.ClientSession) {
  const p = await Product.findOne({ _id: id, active: true }).session(
    session || null,
  );
  if (
    !p ||
    !(await Category.exists({ _id: p.category, active: true }).session(
      session || null,
    )) ||
    !(await User.exists({
      _id: p.seller,
      active: true,
      role: "seller",
    }).session(session || null))
  )
    throw conflict("Product is unavailable");
  return p;
}
async function snapshot(user: mongoose.Types.ObjectId) {
  const b = await basket(user);
  const products = await Product.find({
    _id: { $in: b.items.map((i) => i.product) },
  })
    .select("name images price stock active category seller storeName")
    .lean();
  const categories = await Category.find({ active: true }).select("_id").lean();
  const sellers = await User.find({
    _id: { $in: products.map((p) => p.seller) },
    active: true,
    role: "seller",
  })
    .select("_id")
    .lean();
  const items = b.items.map((i) => {
    const p = products.find((p) => String(p._id) === String(i.product));
    const valid =
      p &&
      p.active &&
      categories.some((c) => c._id.equals(p.category)) &&
      sellers.some((s) => s._id.equals(p.seller));
    return {
      productId: String(i.product),
      quantity: i.quantity,
      product: p
        ? {
            _id: p._id,
            name: p.name,
            images: p.images,
            price: p.price,
            stock: p.stock,
            storeName: p.storeName,
          }
        : null,
      available: Boolean(valid && p.stock >= i.quantity),
    };
  });
  let quote = null;
  if (items.length && items.every((i) => i.available))
    quote = calculateOrder(b.items, products);
  return { items, revision: b.revision, quote };
}
commerce.get("/cart", async (req: any, res) =>
  res.json(await snapshot(req.user._id)),
);
commerce.put("/cart/items/:id", async (req: any, res) => {
  const id = objectId.parse(req.params.id);
  const v = z
    .object({ quantity, revision: z.number().int().min(0) })
    .strict()
    .parse(req.body);
  const p = await available(id);
  if (p.stock < v.quantity) throw conflict("Insufficient stock");
  const b = await basket(req.user._id);
  if (b.revision !== v.revision)
    throw conflict("Cart changed. Refresh and try again.");
  const existing = b.items.find((i) => String(i.product) === id);
  if (existing) existing.quantity = v.quantity;
  else {
    if (b.items.length >= 50) throw conflict("Cart is full");
    b.items.push({
      product: new mongoose.Types.ObjectId(id),
      quantity: v.quantity,
    });
  }
  const updated = await Basket.updateOne(
    { _id: b._id, revision: v.revision },
    { $set: { items: b.items }, $inc: { revision: 1 } },
  );
  if (!updated.modifiedCount)
    throw conflict("Cart changed. Refresh and try again.");
  res.json(await snapshot(req.user._id));
});
commerce.delete("/cart/items/:id", async (req: any, res) => {
  const id = objectId.parse(req.params.id);
  await Basket.updateOne(
    { user: req.user._id },
    {
      $pull: { items: { product: new mongoose.Types.ObjectId(id) } },
      $inc: { revision: 1 },
    },
  );
  res.status(204).end();
});
commerce.get("/wishlist", async (req: any, res) => {
  const b = await basket(req.user._id);
  const products = await Product.find({
    _id: { $in: b.wishlist },
    active: true,
  })
    .select("name images price stock storeName category")
    .lean();
  const categories = await Category.find({ active: true }).select("_id").lean();
  res.json({
    products: products.filter((p) =>
      categories.some((c) => c._id.equals(p.category)),
    ),
  });
});
commerce.put("/wishlist/:id", async (req: any, res) => {
  const id = objectId.parse(req.params.id);
  await available(id);
  const b = await basket(req.user._id);
  if (b.wishlist.length >= 100 && !b.wishlist.some((p) => String(p) === id))
    throw conflict("Wishlist is full");
  const saved = await Basket.updateOne(
    {
      _id: b._id,
      $or: [
        { wishlist: new mongoose.Types.ObjectId(id) },
        { "wishlist.99": { $exists: false } },
      ],
    },
    { $addToSet: { wishlist: new mongoose.Types.ObjectId(id) } },
  );
  if (!saved.matchedCount) throw conflict("Wishlist is full");
  res.status(204).end();
});
commerce.delete("/wishlist/:id", async (req: any, res) => {
  const id = objectId.parse(req.params.id);
  await Basket.updateOne(
    { user: req.user._id },
    { $pull: { wishlist: new mongoose.Types.ObjectId(id) } },
  );
  res.status(204).end();
});
commerce.post("/wishlist/:id/move", async (req: any, res) => {
  const id = objectId.parse(req.params.id);
  await mongoose.connection.transaction(async (session) => {
    const p = await available(id, session);
    const b = await Basket.findOne({ user: req.user._id }).session(session);
    if (!b?.wishlist.some((p) => String(p) === id))
      throw conflict("Product is not in your wishlist");
    const current = b.items.find((i) => String(i.product) === id);
    const next = (current?.quantity || 0) + 1;
    if (next > 99 || p.stock < next) throw conflict("Insufficient stock");
    if (current) current.quantity = next;
    else {
      if (b.items.length >= 50) throw conflict("Cart is full");
      b.items.push({ product: p._id, quantity: 1 });
    }
    b.wishlist = b.wishlist.filter((id) => !id.equals(p._id));
    b.revision++;
    await b.save({ session });
  });
  res.status(204).end();
});
commerce.post("/orders", async (req: any, res) => {
  const v = checkoutSchema.parse(req.body);
  const key = z.string().uuid().parse(req.headers["idempotency-key"]);
  let order = await Order.findOne({ user: req.user._id, idempotencyKey: key });
  if (order) return res.json({ order });
  try {
    await mongoose.connection.transaction(async (session) => {
      const existing = await Order.findOne({
        user: req.user._id,
        idempotencyKey: key,
      }).session(session);
      if (existing) {
        order = existing;
        return;
      }
      const b = await Basket.findOne({ user: req.user._id }).session(session);
      if (!b || b.revision !== v.revision)
        throw conflict("Cart changed. Review your cart again.");
      const products = [];
      for (const item of b.items)
        products.push(await available(item.product, session));
      const calculated = calculateOrder(b.items, products);
      if (calculated.total !== v.expectedTotal)
        throw conflict("Prices changed. Review your cart again.");
      for (const item of b.items) {
        const updated = await Product.updateOne(
          { _id: item.product, active: true, stock: { $gte: item.quantity } },
          { $inc: { stock: -item.quantity } },
          { session },
        );
        if (!updated.modifiedCount)
          throw conflict("Stock changed. Review your cart again.");
      }
      const [created] = await Order.create(
        [
          {
            user: req.user._id,
            idempotencyKey: key,
            address: v.address,
            paymentMethod: "cod",
            ...calculated,
          },
        ],
        { session },
      );
      order = created;
      await notify(
        req.user._id,
        "Order placed",
        "Your order was placed. Each store will confirm its delivery.",
        "/orders/" + created._id,
        "placed:" + created._id,
        session,
      );
      for (const group of calculated.groups)
        await notify(
          new mongoose.Types.ObjectId(String(group.seller)),
          "New order",
          "A new order contains your products.",
          "/seller/orders",
          "new:" + created._id,
          session,
        );
      for (const item of b.items) {
        const p = products.find((p) => String(p._id) === String(item.product))!;
        if (p.stock - item.quantity <= 5)
          await notify(
            p.seller,
            "Low stock",
            p.name + " has " + (p.stock - item.quantity) + " units remaining.",
            "/seller/products/" + p._id,
            "low:" + created._id + ":" + p._id,
            session,
          );
      }

      b.items.splice(0);
      b.revision++;
      await b.save({ session });
    });
  } catch (error: any) {
    if (error.code === 11000) {
      order = await Order.findOne({ user: req.user._id, idempotencyKey: key });
      if (!order) throw error;
    } else throw error;
  }
  res.status(201).json({ order });
});
commerce.get("/orders", async (req: any, res) => {
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(1)
    .parse(req.query.page);
  const orders = await Order.find({ user: req.user._id })
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * 20)
    .limit(20)
    .lean();
  res.json({ orders, page });
});
commerce.get("/orders/:id", async (req: any, res) => {
  const id = objectId.parse(req.params.id);
  const order = await Order.findOne({ _id: id, user: req.user._id }).lean();
  if (!order)
    throw Object.assign(new Error("Order not found"), { status: 404 });
  res.json({ order });
});
commerce.post("/orders/:id/cancel", async (req: any, res) => {
  const id = objectId.parse(req.params.id);
  await cancelOrder(id, req.user._id);
  res.status(204).end();
});
commerce.get("/seller/orders", approvedSeller, async (req: any, res) => {
  if (req.user.role !== "seller")
    throw Object.assign(new Error("Seller required"), { status: 403 });
  const orders = await Order.find({ "groups.seller": req.user._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.json({
    orders: orders.map((o) => ({
      _id: o._id,
      createdAt: o.createdAt,
      address: o.address,
      groups: o.groups.filter((g) => String(g.seller) === req.user.id),
    })),
  });
});
commerce.patch(
  "/seller/orders/:id/groups/:groupId",
  approvedSeller,
  async (req: any, res) => {
    if (req.user.role !== "seller")
      throw Object.assign(new Error("Seller required"), { status: 403 });
    const id = objectId.parse(req.params.id),
      groupId = objectId.parse(req.params.groupId);
    const { status } = z
      .object({
        status: z.enum(["confirmed", "processing", "shipped", "delivered"]),
      })
      .strict()
      .parse(req.body);
    await mongoose.connection.transaction(async (session) => {
      const order = await Order.findOne({
        _id: id,
        "groups.seller": req.user._id,
      }).session(session);
      const group = order?.groups.id(groupId);
      if (!order || !group || String(group.seller) !== req.user.id)
        throw Object.assign(new Error("Fulfillment not found"), {
          status: 404,
        });
      if (!transitions[group.status]?.includes(status))
        throw conflict("Invalid fulfillment transition");
      group.status = status;
      await order.save({ session });
      await notify(
        order.user,
        "Delivery " + status,
        "Your delivery from " + group.storeName + " is " + status + ".",
        "/orders/" + order._id,
        "status:" + order._id + ":" + group._id + ":" + status,
        session,
      );

      if (status === "delivered")
        for (const item of group.items)
          await Product.updateOne(
            { _id: item.product },
            { $inc: { salesCount: item.quantity } },
            { session },
          );
    });
    res.status(204).end();
  },
);
