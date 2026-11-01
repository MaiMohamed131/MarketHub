import { test, expect, jest, afterEach } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { app } from "../dist/app.js";
import { User } from "../dist/models.js";
import { Order } from "../dist/commerce-models.js";
import { Product, Category } from "../dist/catalog-models.js";
import { Review, Notification, notify } from "../dist/community-models.js";
import { eligible, reviewInput } from "../dist/community.js";
const user = new mongoose.Types.ObjectId(),
  pid = new mongoose.Types.ObjectId(),
  oid = new mongoose.Types.ObjectId();
process.env.JWT_ACCESS_SECRET =
  "community-tests-secret-at-least-thirty-two-characters";
const auth = () =>
  "Bearer " +
  jwt.sign({ version: 0 }, process.env.JWT_ACCESS_SECRET, {
    subject: String(user),
    issuer: "markethub",
    audience: "markethub-web",
    expiresIn: "10m",
  });
function signed(role = "customer") {
  mongoose.connection._readyState = 1;
  jest
    .spyOn(User, "findById")
    .mockResolvedValue({
      _id: user,
      id: String(user),
      role,
      name: "Test Customer",
      active: true,
      version: 0,
    });
  jest
    .spyOn(mongoose.connection, "transaction")
    .mockImplementation(async (cb) => cb({}));
}
const session = (value) => ({ session: async () => value });
function chain(value) {
  const c = {};
  for (const k of ["select", "sort", "skip", "limit"]) c[k] = jest.fn(() => c);
  c.lean = async () => value;
  return c;
}
afterEach(() => {
  mongoose.connection._readyState = 0;
  jest.restoreAllMocks();
});
test("review eligibility requires delivered group containing this product", () => {
  expect(
    eligible([{ status: "delivered", items: [{ product: pid }] }], String(pid)),
  ).toBe(true);
  for (const status of [
    "pending",
    "confirmed",
    "processing",
    "shipped",
    "cancelled",
  ])
    expect(eligible([{ status, items: [{ product: pid }] }], String(pid))).toBe(
      false,
    );
  expect(
    eligible([{ status: "delivered", items: [{ product: oid }] }], String(pid)),
  ).toBe(false);
});
test("review validates integer ratings, bounded comments and no ownership overrides", () => {
  const v = { order: String(oid), rating: 5, comment: "Excellent find" };
  expect(reviewInput.safeParse(v).success).toBe(true);
  for (const x of [
    { ...v, rating: 0 },
    { ...v, rating: 6 },
    { ...v, rating: 2.5 },
    { ...v, comment: " " },
    { ...v, user: String(user) },
    { ...v, comment: "a".repeat(2001) },
  ])
    expect(reviewInput.safeParse(x).success).toBe(false);
});
test("review uniqueness index covers purchaser, product and order", () => {
  expect(Review.schema.indexes()).toContainEqual([
    { user: 1, product: 1, order: 1 },
    { unique: true },
  ]);
});
test("review and notification mutations require authentication", async () => {
  expect(
    (
      await request(app)
        .put("/api/products/" + pid + "/review")
        .send({})
    ).status,
  ).toBe(401);
  expect((await request(app).get("/api/notifications")).status).toBe(401);
});
test("seller cannot review products", async () => {
  signed("seller");
  expect(
    (
      await request(app)
        .put("/api/products/" + pid + "/review")
        .set("Authorization", auth())
        .send({ order: String(oid), rating: 5, comment: "Nice item" })
    ).status,
  ).toBe(403);
});
test("review rejects another purchasers order without writing", async () => {
  signed();
  jest.spyOn(Order, "findOne").mockReturnValue(session(null));
  const write = jest.spyOn(Review, "findOneAndUpdate");
  expect(
    (
      await request(app)
        .put("/api/products/" + pid + "/review")
        .set("Authorization", auth())
        .send({ order: String(oid), rating: 5, comment: "Nice item" })
    ).status,
  ).toBe(403);
  expect(Order.findOne.mock.calls[0][0]).toEqual({ _id: String(oid), user });
  expect(write).not.toHaveBeenCalled();
});
test("review rejects undelivered purchase", async () => {
  signed();
  jest
    .spyOn(Order, "findOne")
    .mockReturnValue(
      session({ groups: [{ status: "shipped", items: [{ product: pid }] }] }),
    );
  expect(
    (
      await request(app)
        .put("/api/products/" + pid + "/review")
        .set("Authorization", auth())
        .send({ order: String(oid), rating: 5, comment: "Nice item" })
    ).status,
  ).toBe(403);
});
test("review upsert recalculates aggregate rating inside same transaction", async () => {
  signed();
  jest
    .spyOn(Order, "findOne")
    .mockReturnValue(
      session({ groups: [{ status: "delivered", items: [{ product: pid }] }] }),
    );
  const p = { _id: pid, deleted: false, __v: 1, save: jest.fn(async () => {}) };
  jest.spyOn(Product, "findById").mockReturnValue(session(p));
  jest
    .spyOn(Review, "findOneAndUpdate")
    .mockResolvedValue({ _id: oid, rating: 4 });
  jest
    .spyOn(Review, "aggregate")
    .mockReturnValue(session([{ average: 4.5, count: 2 }]));
  expect(
    (
      await request(app)
        .put("/api/products/" + pid + "/review")
        .set("Authorization", auth())
        .send({ order: String(oid), rating: 4, comment: "Very good item" })
    ).status,
  ).toBe(200);
  expect(Review.findOneAndUpdate.mock.calls[0][0]).toEqual({
    user,
    product: String(pid),
    order: String(oid),
  });
  expect(Review.findOneAndUpdate.mock.calls[0][2]).toMatchObject({
    upsert: true,
    session: {},
  });
  expect(p.averageRating).toBe(4.5);
  expect(p.reviewCount).toBe(2);
  expect(p.save).toHaveBeenCalledWith({ session: {} });
});
test("public reviews expose no customer email, order or purchaser ID", async () => {
  mongoose.connection._readyState = 1;
  jest.spyOn(Product, "findOne").mockResolvedValue({ category: oid });
  jest.spyOn(Category, "exists").mockResolvedValue({ _id: oid });
  const c = chain([{ rating: 5, comment: "Good", displayName: "Customer" }]);
  jest.spyOn(Review, "find").mockReturnValue(c);
  jest.spyOn(Review, "countDocuments").mockResolvedValue(1);
  expect(
    (await request(app).get("/api/products/" + pid + "/reviews")).status,
  ).toBe(200);
  expect(c.select).toHaveBeenCalledWith(
    "rating comment displayName createdAt updatedAt",
  );
});
test("public review list does not expose inactive or missing products", async () => {
  mongoose.connection._readyState = 1;
  jest.spyOn(Product, "findOne").mockResolvedValue(null);
  expect(
    (await request(app).get("/api/products/" + pid + "/reviews")).status,
  ).toBe(404);
});
test("notification creation is idempotent and participates in transaction", async () => {
  jest.spyOn(Notification, "updateOne").mockResolvedValue({});
  await notify(
    user,
    "Shipped",
    "Your parcel is on the way",
    "/orders/" + oid,
    "shipped:" + oid,
    {},
  );
  expect(Notification.updateOne.mock.calls[0][0]).toEqual({
    user,
    eventKey: "shipped:" + oid,
  });
  expect(Notification.updateOne.mock.calls[0][1].$setOnInsert.title).toBe(
    "Shipped",
  );
  expect(Notification.updateOne.mock.calls[0][2]).toEqual({
    upsert: true,
    session: {},
  });
});
test("notification listing is scoped and paginated with unread count", async () => {
  signed();
  const c = chain([]);
  jest.spyOn(Notification, "find").mockReturnValue(c);
  jest.spyOn(Notification, "countDocuments").mockResolvedValue(0);
  expect(
    (
      await request(app)
        .get("/api/notifications?page=2&unread=true")
        .set("Authorization", auth())
    ).status,
  ).toBe(200);
  expect(Notification.find.mock.calls[0][0]).toEqual({ user, readAt: null });
  expect(c.skip).toHaveBeenCalledWith(20);
});
test("notification cannot be marked read by a different user", async () => {
  signed();
  jest.spyOn(Notification, "updateOne").mockResolvedValue({ matchedCount: 0 });
  expect(
    (
      await request(app)
        .patch("/api/notifications/" + oid + "/read")
        .set("Authorization", auth())
    ).status,
  ).toBe(404);
  expect(Notification.updateOne.mock.calls[0][0]).toEqual({
    _id: String(oid),
    user,
  });
});
test("mark all read never touches other recipients", async () => {
  signed();
  jest.spyOn(Notification, "updateMany").mockResolvedValue({});
  expect(
    (
      await request(app)
        .patch("/api/notifications/read-all")
        .set("Authorization", auth())
    ).status,
  ).toBe(204);
  expect(Notification.updateMany.mock.calls[0][0]).toEqual({
    user,
    readAt: null,
  });
});
test("notification query injection and invalid IDs rejected", async () => {
  signed();
  expect(
    (
      await request(app)
        .get("/api/notifications?user[$ne]=x")
        .set("Authorization", auth())
    ).status,
  ).toBe(400);
  expect(
    (
      await request(app)
        .patch("/api/notifications/bad/read")
        .set("Authorization", auth())
    ).status,
  ).toBe(400);
});
