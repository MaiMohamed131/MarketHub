import { Notification } from "../dist/community-models.js";
import { test, expect, jest, afterEach, beforeEach } from "@jest/globals";
import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { SellerApplication } from "../dist/seller-models.js";
import { app } from "../dist/app.js";
import { User } from "../dist/models.js";
import { Basket, Order } from "../dist/commerce-models.js";
import { Product, Category } from "../dist/catalog-models.js";
import {
  calculateOrder,
  canCancel,
  checkoutSchema,
  transitions,
} from "../dist/commerce-service.js";
process.env.JWT_ACCESS_SECRET = "commerce-tests-secret-at-least-32-characters";
const uid = new mongoose.Types.ObjectId(),
  sellerA = new mongoose.Types.ObjectId(),
  sellerB = new mongoose.Types.ObjectId(),
  pid = new mongoose.Types.ObjectId(),
  pid2 = new mongoose.Types.ObjectId();
const product = (id = pid, seller = sellerA, price = 2500) => ({
  _id: id,
  name: "Historical name",
  images: ["https://example.com/a.jpg"],
  price,
  stock: 10,
  active: true,
  category: new mongoose.Types.ObjectId(),
  seller,
  storeName: "Independent store",
});
const address = {
  name: "Test Customer",
  email: "test@example.com",
  phone: "+1 555 555 5555",
  line1: "123 Example Street",
  line2: "",
  city: "Austin",
  postalCode: "78701",
  country: "US",
};
const auth = () =>
  "Bearer " +
  jwt.sign({ version: 0 }, process.env.JWT_ACCESS_SECRET, {
    subject: String(uid),
    issuer: "markethub",
    audience: "markethub-web",
    expiresIn: "10m",
  });
function signed(role = "customer") {
  if (role === "seller")
    jest
      .spyOn(SellerApplication, "findOne")
      .mockResolvedValue({ status: "approved" });
  mongoose.connection._readyState = 1;
  jest.spyOn(User, "findById").mockResolvedValue({
    _id: uid,
    id: String(uid),
    active: true,
    version: 0,
    role,
  });
}
const q = (value) => ({ session: jest.fn().mockResolvedValue(value) });
beforeEach(() => {
  jest.spyOn(Notification, "updateOne").mockResolvedValue({ matchedCount: 1 });
});
afterEach(() => {
  mongoose.connection._readyState = 0;
  jest.restoreAllMocks();
});
test("multi-vendor checkout groups snapshots and calculates shipping per store", () => {
  const a = product(),
    b = product(pid2, sellerB, 6000);
  const order = calculateOrder(
    [
      { product: pid, quantity: 2 },
      { product: pid2, quantity: 2 },
    ],
    [a, b],
  );
  expect(order.groups).toHaveLength(2);
  expect(order.subtotal).toBe(17000);
  expect(order.shipping).toBe(500);
  expect(order.total).toBe(17500);
  a.price = 1;
  a.name = "Changed";
  expect(order.groups[0].items[0]).toMatchObject({
    price: 2500,
    name: "Historical name",
    quantity: 2,
  });
});
test("rejects empty, duplicate, unavailable and insufficient stock carts", () => {
  const p = product();
  for (const items of [
    [],
    [{ product: pid, quantity: 11 }],
    [
      { product: pid, quantity: 1 },
      { product: pid, quantity: 1 },
    ],
    [{ product: pid2, quantity: 1 }],
    [{ product: pid, quantity: 0 }],
  ])
    expect(() => calculateOrder(items, [p])).toThrow();
  p.active = false;
  expect(() => calculateOrder([{ product: pid, quantity: 1 }], [p])).toThrow();
});
test("shipping threshold and integer totals", () => {
  expect(
    calculateOrder([{ product: pid, quantity: 4 }], [product()]),
  ).toMatchObject({ subtotal: 10000, shipping: 0, total: 10000 });
  expect(() =>
    calculateOrder(
      [{ product: pid, quantity: 1 }],
      [product(pid, sellerA, 1.5)],
    ),
  ).toThrow();
});
test("checkout rejects client totals, online payment and unsupported destinations", () => {
  const base = {
    address,
    paymentMethod: "cod",
    revision: 0,
    expectedTotal: 3000,
  };
  expect(checkoutSchema.safeParse(base).success).toBe(true);
  for (const data of [
    { ...base, total: 1 },
    { ...base, paymentMethod: "stripe" },
    { ...base, address: { ...address, country: "EG" } },
    { ...base, revision: -1 },
  ])
    expect(checkoutSchema.safeParse(data).success).toBe(false);
});
test("cancellation and fulfillment state rules prevent skipped states and shipped cancellation", () => {
  expect(canCancel([{ status: "pending" }, { status: "confirmed" }])).toBe(
    true,
  );
  for (const status of ["processing", "shipped", "delivered", "cancelled"])
    expect(canCancel([{ status }])).toBe(false);
  expect(canCancel([])).toBe(false);
  expect(transitions.pending).not.toContain("delivered");
  expect(transitions.delivered).toEqual([]);
});
test("shopping endpoints all require authentication", async () => {
  for (const path of ["/cart", "/wishlist", "/orders", "/seller/orders"])
    expect((await request(app).get("/api" + path)).status).toBe(401);
});
test("authenticated shopping reports offline database", async () => {
  jest.spyOn(User, "findById").mockResolvedValue({
    _id: uid,
    active: true,
    version: 0,
    role: "customer",
  });
  expect(
    (await request(app).get("/api/cart").set("Authorization", auth())).status,
  ).toBe(503);
});
test("customer cannot access seller management", async () => {
  signed();
  expect(
    (await request(app).get("/api/seller/orders").set("Authorization", auth()))
      .status,
  ).toBe(403);
});
test("order lookup always scopes ownership", async () => {
  signed();
  const find = jest
    .spyOn(Order, "findOne")
    .mockReturnValue({ lean: async () => null });
  expect(
    (
      await request(app)
        .get("/api/orders/" + pid)
        .set("Authorization", auth())
    ).status,
  ).toBe(404);
  expect(find.mock.calls[0][0]).toEqual({ _id: String(pid), user: uid });
});
function checkoutMocks({ stockFailure = false } = {}) {
  signed();
  jest.spyOn(Order, "findOne").mockReturnValue(q(null));
  Order.findOne.mockImplementationOnce(async () => null);
  jest
    .spyOn(mongoose.connection, "transaction")
    .mockImplementation(async (cb) => cb({ testSession: true }));
  const b = {
    revision: 0,
    items: [{ product: pid, quantity: 2 }],
    save: jest.fn(async () => {}),
  };
  jest.spyOn(Basket, "findOne").mockReturnValue(q(b));
  jest.spyOn(Product, "findOne").mockReturnValue(q(product()));
  jest.spyOn(Category, "exists").mockReturnValue(q({ _id: pid }));
  jest.spyOn(User, "exists").mockReturnValue(q({ _id: sellerA }));
  jest
    .spyOn(Product, "updateOne")
    .mockResolvedValue({ modifiedCount: stockFailure ? 0 : 1 });
  jest.spyOn(Order, "create").mockResolvedValue([{ _id: pid, total: 5500 }]);
  return b;
}
const body = {
  address,
  paymentMethod: "cod",
  revision: 0,
  expectedTotal: 5500,
};
const place = () =>
  request(app)
    .post("/api/orders")
    .set("Authorization", auth())
    .set("Idempotency-Key", "e8d0ad1a-837a-4b48-b369-51c3d5dbde25")
    .send(body);
test("order creation uses guarded stock deduction and clears cart in same session", async () => {
  const b = checkoutMocks();
  const r = await place();
  expect(r.status).toBe(201);
  expect(Product.updateOne.mock.calls[0][0]).toMatchObject({
    stock: { $gte: 2 },
    active: true,
  });
  expect(Product.updateOne.mock.calls[0][1]).toEqual({ $inc: { stock: -2 } });
  expect(Product.updateOne.mock.calls[0][2].session).toBeDefined();
  expect(b.items).toHaveLength(0);
  expect(b.save).toHaveBeenCalled();
  expect(Order.create.mock.calls[0][0][0]).toMatchObject({
    total: 5500,
    paymentMethod: "cod",
    subtotal: 5000,
    shipping: 500,
  });
});
test("concurrent stock loss prevents order creation and cart clearing", async () => {
  const b = checkoutMocks({ stockFailure: true });
  expect((await place()).status).toBe(409);
  expect(Order.create).not.toHaveBeenCalled();
  expect(b.items).toHaveLength(1);
  expect(b.save).not.toHaveBeenCalled();
});
test("checkout rejects changed price without inventory mutation", async () => {
  checkoutMocks();
  const r = await request(app)
    .post("/api/orders")
    .set("Authorization", auth())
    .set("Idempotency-Key", "e8d0ad1a-837a-4b48-b369-51c3d5dbde25")
    .send({ ...body, expectedTotal: 1 });
  expect(r.status).toBe(409);
  expect(Product.updateOne).not.toHaveBeenCalled();
});
test("idempotent checkout returns existing order without deducting stock", async () => {
  signed();
  jest.spyOn(Order, "findOne").mockResolvedValue({ _id: pid, total: 5500 });
  const tx = jest.spyOn(mongoose.connection, "transaction");
  expect((await place()).status).toBe(200);
  expect(tx).not.toHaveBeenCalled();
});
test("cancellation restores quantity and records terminal state inside transaction", async () => {
  signed();
  const order = {
    groups: [{ status: "pending", items: [{ product: pid, quantity: 2 }] }],
    save: jest.fn(async () => {}),
  };
  jest.spyOn(Order, "findOne").mockReturnValue(q(order));
  jest
    .spyOn(mongoose.connection, "transaction")
    .mockImplementation(async (cb) => cb({ testSession: true }));
  jest.spyOn(Product, "updateOne").mockResolvedValue({ matchedCount: 1 });
  expect(
    (
      await request(app)
        .post("/api/orders/" + pid + "/cancel")
        .set("Authorization", auth())
    ).status,
  ).toBe(204);
  expect(Product.updateOne.mock.calls[0][1]).toEqual({ $inc: { stock: 2 } });
  expect(order.groups[0].status).toBe("cancelled");
  expect(order.cancelledAt).toBeInstanceOf(Date);
});
test("repeat cancellation does not restore stock twice", async () => {
  signed();
  jest.spyOn(Order, "findOne").mockReturnValue(q({ cancelledAt: new Date() }));
  jest
    .spyOn(mongoose.connection, "transaction")
    .mockImplementation(async (cb) => cb({}));
  const update = jest.spyOn(Product, "updateOne");
  expect(
    (
      await request(app)
        .post("/api/orders/" + pid + "/cancel")
        .set("Authorization", auth())
    ).status,
  ).toBe(204);
  expect(update).not.toHaveBeenCalled();
});
test("seller cannot update another sellers group", async () => {
  signed("seller");
  jest
    .spyOn(mongoose.connection, "transaction")
    .mockImplementation(async (cb) => cb({}));
  jest
    .spyOn(Order, "findOne")
    .mockReturnValue(
      q({ groups: { id: () => ({ seller: sellerB, status: "pending" }) } }),
    );
  expect(
    (
      await request(app)
        .patch("/api/seller/orders/" + pid + "/groups/" + pid2)
        .set("Authorization", auth())
        .send({ status: "confirmed" })
    ).status,
  ).toBe(404);
});
test("cart update rejects insufficient stock before basket mutation", async () => {
  signed();
  jest.spyOn(Product, "findOne").mockReturnValue(q({ ...product(), stock: 1 }));
  jest.spyOn(Category, "exists").mockReturnValue(q({ _id: pid }));
  jest.spyOn(User, "exists").mockReturnValue(q({ _id: sellerA }));
  const update = jest.spyOn(Basket, "updateOne");
  expect(
    (
      await request(app)
        .put("/api/cart/items/" + pid)
        .set("Authorization", auth())
        .send({ quantity: 2, revision: 0 })
    ).status,
  ).toBe(409);
  expect(update).not.toHaveBeenCalled();
});
test("cart rejects fractional quantity and ignores no submitted price", async () => {
  signed();
  for (const payload of [
    { quantity: 1.5, revision: 0 },
    { quantity: 1, revision: 0, price: 1 },
  ])
    expect(
      (
        await request(app)
          .put("/api/cart/items/" + pid)
          .set("Authorization", auth())
          .send(payload)
      ).status,
    ).toBe(400);
});
test("removing wishlist item scopes database update to authenticated user", async () => {
  signed();
  jest.spyOn(Basket, "updateOne").mockResolvedValue({ modifiedCount: 1 });
  expect(
    (
      await request(app)
        .delete("/api/wishlist/" + pid)
        .set("Authorization", auth())
    ).status,
  ).toBe(204);
  expect(Basket.updateOne.mock.calls[0][0]).toEqual({ user: uid });
  expect(Basket.updateOne.mock.calls[0][1].$pull.wishlist).toEqual(pid);
});
test("moving wishlist item never removes it when stock unavailable", async () => {
  signed();
  jest
    .spyOn(mongoose.connection, "transaction")
    .mockImplementation(async (cb) => cb({}));
  jest.spyOn(Product, "findOne").mockReturnValue(q({ ...product(), stock: 0 }));
  jest.spyOn(Category, "exists").mockReturnValue(q({ _id: pid }));
  jest.spyOn(User, "exists").mockReturnValue(q({ _id: sellerA }));
  const b = { wishlist: [pid], items: [], save: jest.fn() };
  jest.spyOn(Basket, "findOne").mockReturnValue(q(b));
  expect(
    (
      await request(app)
        .post("/api/wishlist/" + pid + "/move")
        .set("Authorization", auth())
    ).status,
  ).toBe(409);
  expect(b.wishlist).toEqual([pid]);
  expect(b.save).not.toHaveBeenCalled();
});
test("seller listing omits other fulfillment groups and customer order total", async () => {
  signed("seller");
  jest.spyOn(Order, "find").mockReturnValue({
    sort: () => ({
      limit: () => ({
        lean: async () => [
          {
            _id: pid,
            total: 9000,
            address,
            groups: [
              { seller: uid, storeName: "Own store" },
              { seller: sellerB, storeName: "Private other store" },
            ],
          },
        ],
      }),
    }),
  });
  const r = await request(app)
    .get("/api/seller/orders")
    .set("Authorization", auth());
  expect(r.status).toBe(200);
  expect(r.body.orders[0].groups).toHaveLength(1);
  expect(r.body.orders[0].total).toBeUndefined();
  expect(JSON.stringify(r.body)).not.toContain("Private other store");
});
test("unsupported transactions fail instead of performing nontransactional checkout", async () => {
  checkoutMocks();
  mongoose.connection.transaction.mockRejectedValue(
    new Error("Transactions unavailable"),
  );
  expect((await place()).status).toBe(500);
  expect(Product.updateOne).not.toHaveBeenCalled();
  expect(Order.create).not.toHaveBeenCalled();
});
test("checkout emits customer and seller events in the same transaction", async () => {
  checkoutMocks();
  expect((await place()).status).toBe(201);
  const entries = Notification.updateOne.mock.calls.map(
    (c) => c[1].$setOnInsert,
  );
  expect(
    entries.some(
      (n) => n.title === "Order placed" && String(n.user) === String(uid),
    ),
  ).toBe(true);
  expect(
    entries.some(
      (n) => n.title === "New order" && String(n.user) === String(sellerA),
    ),
  ).toBe(true);
  expect(
    Notification.updateOne.mock.calls.every((c) => c[2].session?.testSession),
  ).toBe(true);
});
test("checkout emits low-stock alert after final stock deduction", async () => {
  checkoutMocks();
  Product.findOne.mockReturnValue(q({ ...product(), stock: 2 }));
  expect((await place()).status).toBe(201);
  expect(
    Notification.updateOne.mock.calls.some(
      (c) => c[1].$setOnInsert.title === "Low stock",
    ),
  ).toBe(true);
});
test("notification failure prevents checkout from clearing cart", async () => {
  const b = checkoutMocks();
  Notification.updateOne.mockRejectedValue(
    new Error("Notification persistence failed"),
  );
  expect((await place()).status).toBe(500);
  expect(b.save).not.toHaveBeenCalled();
  expect(b.items).toHaveLength(1);
});
test("seller shipping updates customer notification with owning order link", async () => {
  signed("seller");
  jest
    .spyOn(mongoose.connection, "transaction")
    .mockImplementation(async (cb) => cb({ testSession: true }));
  const g = {
    _id: pid2,
    seller: uid,
    status: "processing",
    storeName: "Own store",
  };
  const order = {
    _id: pid,
    user: sellerB,
    groups: { id: () => g },
    save: jest.fn(async () => {}),
  };
  jest.spyOn(Order, "findOne").mockReturnValue(q(order));
  expect(
    (
      await request(app)
        .patch("/api/seller/orders/" + pid + "/groups/" + pid2)
        .set("Authorization", auth())
        .send({ status: "shipped" })
    ).status,
  ).toBe(204);
  expect(Notification.updateOne.mock.calls[0][1].$setOnInsert).toMatchObject({
    user: sellerB,
    title: "Delivery shipped",
    path: "/orders/" + pid,
  });
});
