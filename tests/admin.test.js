import { Notification } from "../dist/community-models.js";
import { test, expect, jest, afterEach, beforeEach } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { app } from "../dist/app.js";
import { User, Session } from "../dist/models.js";
import { Product, Category } from "../dist/catalog-models.js";
import { SellerApplication, Media } from "../dist/seller-models.js";
import { Order } from "../dist/commerce-models.js";
import { Audit, Dispute } from "../dist/admin-models.js";
import { categoryInput } from "../dist/admin.js";
const uid = new mongoose.Types.ObjectId(),
  target = new mongoose.Types.ObjectId(),
  pid = new mongoose.Types.ObjectId();
process.env.JWT_ACCESS_SECRET =
  "admin-tests-secret-at-least-thirty-two-characters";
const auth = () =>
  "Bearer " +
  jwt.sign({ version: 0 }, process.env.JWT_ACCESS_SECRET, {
    subject: String(uid),
    issuer: "markethub",
    audience: "markethub-web",
    expiresIn: "10m",
  });
function signed(role = "admin") {
  mongoose.connection._readyState = 1;
  jest
    .spyOn(Product, "findById")
    .mockReturnValue({
      select: () => ({ lean: async () => ({ images: [] }) }),
    });
  jest.spyOn(User, "findById").mockResolvedValue({
    _id: uid,
    id: String(uid),
    role,
    active: true,
    version: 0,
  });
  jest
    .spyOn(mongoose.connection, "transaction")
    .mockImplementation(async (cb) => cb({ testSession: true }));
}
const session = (value) => ({ session: async () => value });
function chain(value) {
  const c = {};
  for (const key of ["select", "sort", "skip", "limit"])
    c[key] = jest.fn(() => c);
  c.lean = async () => value;
  return c;
}
beforeEach(() => {
  jest.spyOn(Notification, "updateOne").mockResolvedValue({ matchedCount: 1 });
});
afterEach(() => {
  mongoose.connection._readyState = 0;
  jest.restoreAllMocks();
});
test("all admin sections require login", async () => {
  for (const path of [
    "overview",
    "users",
    "sellers",
    "products",
    "categories",
    "orders",
  ])
    expect((await request(app).get("/api/admin/" + path)).status).toBe(401);
});
test("customers and sellers are denied platform management", async () => {
  signed("seller");
  for (const path of [
    "overview",
    "users",
    "sellers",
    "products",
    "categories",
    "orders",
  ])
    expect(
      (
        await request(app)
          .get("/api/admin/" + path)
          .set("Authorization", auth())
      ).status,
    ).toBe(403);
});
test("query input validation rejects injection and invalid pagination", async () => {
  signed();
  for (const url of [
    "users?page=0",
    "users?role=superadmin",
    "users?q[$ne]=a",
    "products?active=maybe",
    "products?seller=bad",
    "orders?status=paid",
    "sellers?status=unknown",
  ])
    expect(
      (
        await request(app)
          .get("/api/admin/" + url)
          .set("Authorization", auth())
      ).status,
    ).toBe(400);
});
test("user list has explicit safe projection, escaped search and pagination", async () => {
  signed();
  const c = chain([{ _id: target, name: "Customer" }]);
  jest.spyOn(User, "find").mockReturnValue(c);
  jest.spyOn(User, "countDocuments").mockResolvedValue(21);
  const r = await request(app)
    .get("/api/admin/users?q=.*&role=customer&page=2")
    .set("Authorization", auth());
  expect(r.status).toBe(200);
  expect(r.body.total).toBe(21);
  expect(c.select).toHaveBeenCalledWith(
    "name email role active verified createdAt avatar",
  );
  expect(c.skip).toHaveBeenCalledWith(20);
  expect(User.find.mock.calls[0][0].$or[0].name.$regex).toBe("\\.\\*");
});
test("administrator cannot deactivate own account", async () => {
  signed();
  expect(
    (
      await request(app)
        .patch("/api/admin/users/" + uid + "/active")
        .set("Authorization", auth())
        .send({ active: false, reason: "Test deactivation" })
    ).status,
  ).toBe(409);
});
test("deactivation revokes sessions, hides seller products and audits atomically", async () => {
  signed();
  const user = {
    _id: target,
    role: "seller",
    active: true,
    version: 2,
    save: jest.fn(async () => {}),
  };
  User.findById
    .mockReturnValueOnce(
      Promise.resolve({
        _id: uid,
        id: String(uid),
        role: "admin",
        active: true,
        version: 0,
      }),
    )
    .mockReturnValueOnce(session(user));
  jest.spyOn(Session, "deleteMany").mockResolvedValue({});
  jest.spyOn(Product, "updateMany").mockResolvedValue({});
  jest
    .spyOn(SellerApplication, "updateOne")
    .mockResolvedValue({ matchedCount: 1 });
  jest.spyOn(Audit, "create").mockResolvedValue([]);
  expect(
    (
      await request(app)
        .patch("/api/admin/users/" + target + "/active")
        .set("Authorization", auth())
        .send({ active: false, reason: "Account requires review" })
    ).status,
  ).toBe(204);
  expect(user.active).toBe(false);
  expect(user.version).toBe(3);
  expect(Session.deleteMany.mock.calls[0][0]).toEqual({ user: target });
  expect(Product.updateMany.mock.calls[0][0]).toEqual({ seller: target });
  expect(Audit.create.mock.calls[0][0][0].action).toBe("user.deactivated");
});
test("category schema rejects unsafe slugs, images and extra fields", () => {
  const v = {
    name: "Home",
    slug: "home-living",
    description: "Everyday essentials",
    image: "",
    active: true,
  };
  expect(categoryInput.safeParse(v).success).toBe(true);
  for (const x of [
    { ...v, slug: "../admin" },
    { ...v, image: "javascript:alert(1)" },
    { ...v, featured: true },
  ])
    expect(categoryInput.safeParse(x).success).toBe(false);
});
test("category creation rejects arbitrary unowned image URLs", async () => {
  signed();
  jest.spyOn(Media, "exists").mockResolvedValue(null);
  expect(
    (
      await request(app)
        .post("/api/admin/categories")
        .set("Authorization", auth())
        .send({
          name: "Home",
          slug: "home",
          description: "Essentials",
          image: "https://example.com/random.jpg",
          active: true,
        })
    ).status,
  ).toBe(400);
});
test("referenced categories cannot be deleted", async () => {
  signed();
  jest.spyOn(Product, "exists").mockReturnValue(session({ _id: pid }));
  const del = jest.spyOn(Category, "findOneAndDelete");
  expect(
    (
      await request(app)
        .delete("/api/admin/categories/" + target)
        .set("Authorization", auth())
    ).status,
  ).toBe(409);
  expect(del).not.toHaveBeenCalled();
});
test("unused category deletion runs inside transaction", async () => {
  signed();
  jest.spyOn(Product, "exists").mockReturnValue(session(null));
  jest
    .spyOn(Category, "findOneAndDelete")
    .mockReturnValue(session({ _id: target }));
  expect(
    (
      await request(app)
        .delete("/api/admin/categories/" + target)
        .set("Authorization", auth())
    ).status,
  ).toBe(204);
  expect(Category.findOneAndDelete.mock.calls[0][0]).toEqual({
    _id: String(target),
  });
});
test("category edit uses optimistic version guard", async () => {
  signed();
  jest
    .spyOn(Category, "findById")
    .mockReturnValue(chain({ _id: target, image: "" }));
  jest.spyOn(Category, "findOneAndUpdate").mockResolvedValue(null);
  expect(
    (
      await request(app)
        .patch("/api/admin/categories/" + target)
        .set("Authorization", auth())
        .send({
          name: "Home",
          slug: "home",
          description: "Essentials",
          image: "",
          active: true,
          version: 2,
        })
    ).status,
  ).toBe(409);
  expect(Category.findOneAndUpdate.mock.calls[0][0]).toEqual({
    _id: String(target),
    __v: 2,
  });
});
test("blocking product persists moderation lock and audit", async () => {
  signed();
  const p = { _id: pid, __v: 1, active: true, save: jest.fn(async () => {}) };
  jest.spyOn(Product, "findOne").mockReturnValue(session(p));
  jest.spyOn(Audit, "create").mockResolvedValue([]);
  expect(
    (
      await request(app)
        .patch("/api/admin/products/" + pid)
        .set("Authorization", auth())
        .send({
          active: false,
          version: 1,
          reason: "Listing violates marketplace rules",
        })
    ).status,
  ).toBe(204);
  expect(p.active).toBe(false);
  expect(p.moderationBlocked).toBe(true);
  expect(p.__v).toBe(2);
  expect(Audit.create.mock.calls[0][0][0].action).toBe("product.blocked");
});
test("archiving product preserves record for inventory restoration", async () => {
  signed();
  jest.spyOn(Product, "updateOne").mockResolvedValue({ matchedCount: 1 });
  jest.spyOn(Audit, "create").mockResolvedValue([]);
  expect(
    (
      await request(app)
        .delete("/api/admin/products/" + pid)
        .set("Authorization", auth())
        .send({ reason: "Remove inappropriate listing" })
    ).status,
  ).toBe(204);
  expect(Product.updateOne.mock.calls[0][1].$set).toEqual({
    active: false,
    deleted: true,
    moderationBlocked: true,
  });
});
test("admin order cancellation uses same guarded stock restoration", async () => {
  signed();
  const order = {
    groups: [{ status: "confirmed", items: [{ product: pid, quantity: 3 }] }],
    save: jest.fn(async () => {}),
  };
  jest.spyOn(Order, "findOne").mockReturnValue(session(order));
  jest.spyOn(Product, "updateOne").mockResolvedValue({ matchedCount: 1 });
  expect(
    (
      await request(app)
        .post("/api/admin/orders/" + target + "/cancel")
        .set("Authorization", auth())
    ).status,
  ).toBe(204);
  expect(Product.updateOne.mock.calls[0][1]).toEqual({ $inc: { stock: 3 } });
  expect(order.groups[0].status).toBe("cancelled");
});
test("admin cannot cancel already shipped order", async () => {
  signed();
  jest
    .spyOn(Order, "findOne")
    .mockReturnValue(session({ groups: [{ status: "shipped" }] }));
  const update = jest.spyOn(Product, "updateOne");
  expect(
    (
      await request(app)
        .post("/api/admin/orders/" + target + "/cancel")
        .set("Authorization", auth())
    ).status,
  ).toBe(409);
  expect(update).not.toHaveBeenCalled();
});
test("dispute creation requires an existing order and accepts no spoofed actor", async () => {
  signed();
  jest.spyOn(Order, "exists").mockResolvedValue({ _id: target });
  jest.spyOn(Dispute, "create").mockResolvedValue({ _id: pid });
  const body = {
    subject: "Missing delivery",
    notes: "Customer reported a missing parcel",
  };
  expect(
    (
      await request(app)
        .post("/api/admin/orders/" + target + "/disputes")
        .set("Authorization", auth())
        .send(body)
    ).status,
  ).toBe(201);
  expect(Dispute.create.mock.calls[0][0].createdBy).toEqual(uid);
  expect(
    (
      await request(app)
        .post("/api/admin/orders/" + target + "/disputes")
        .set("Authorization", auth())
        .send({ ...body, status: "resolved" })
    ).status,
  ).toBe(400);
});
test("dispute resolution scoped to order and open case with resolver metadata", async () => {
  signed();
  jest
    .spyOn(Dispute, "findOneAndUpdate")
    .mockResolvedValue({ _id: pid, status: "resolved" });
  expect(
    (
      await request(app)
        .patch("/api/admin/orders/" + target + "/disputes/" + pid)
        .set("Authorization", auth())
        .send({ notes: "Parcel located and delivery confirmed" })
    ).status,
  ).toBe(200);
  expect(Dispute.findOneAndUpdate.mock.calls[0][0]).toEqual({
    _id: String(pid),
    order: String(target),
    status: "open",
  });
  expect(Dispute.findOneAndUpdate.mock.calls[0][1].$set.resolvedBy).toEqual(
    uid,
  );
  expect(Dispute.findOneAndUpdate.mock.calls[0][1].$set.notes).toBeUndefined();
});
test("admin uploads reject executable content before storage access", async () => {
  signed();
  expect(
    (
      await request(app)
        .post("/api/admin/images")
        .set("Authorization", auth())
        .attach("image", Buffer.from('<svg onload="alert(1)">'), "image.png")
    ).status,
  ).toBe(400);
});
test("overview reports actual delivered sales aggregates and zero-safe counts", async () => {
  signed();
  jest.spyOn(User, "aggregate").mockResolvedValue([
    { _id: "customer", count: 4 },
    { _id: "seller", count: 2 },
  ]);
  jest.spyOn(Product, "countDocuments").mockResolvedValue(8);
  jest.spyOn(Order, "countDocuments").mockResolvedValue(3);
  jest.spyOn(SellerApplication, "countDocuments").mockResolvedValue(1);
  jest
    .spyOn(Order, "aggregate")
    .mockResolvedValue([{ _id: "2026-10", revenue: 12500, groups: 2 }]);
  jest.spyOn(Order, "find").mockReturnValue(chain([]));
  jest.spyOn(Audit, "find").mockReturnValue(chain([]));
  const r = await request(app)
    .get("/api/admin/overview")
    .set("Authorization", auth());
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({
    products: 8,
    orders: 3,
    revenue: 12500,
    pendingApplications: 1,
  });
  expect(Order.aggregate.mock.calls[0][0][1]).toEqual({
    $match: { "groups.status": "delivered" },
  });
});
test("admin publication rejects product without images", async () => {
  signed();
  jest
    .spyOn(Product, "findOne")
    .mockReturnValue(session({ _id: pid, __v: 1, images: [] }));
  expect(
    (
      await request(app)
        .patch("/api/admin/products/" + pid)
        .set("Authorization", auth())
        .send({ active: true, version: 1, reason: "Approve this listing" })
    ).status,
  ).toBe(409);
});
test("order filters use fulfillment status and literal customer email search", async () => {
  signed();
  jest.spyOn(Order, "find").mockReturnValue(chain([]));
  jest.spyOn(Order, "countDocuments").mockResolvedValue(0);
  const r = await request(app)
    .get("/api/admin/orders?q=customer%40example.com&status=shipped")
    .set("Authorization", auth());
  expect(r.status).toBe(200);
  expect(Order.find.mock.calls[0][0]).toEqual({
    "groups.status": "shipped",
    "address.email": { $regex: "customer@example\\.com", $options: "i" },
  });
});
