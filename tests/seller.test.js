import { Notification } from "../dist/community-models.js";
import { test, expect, jest, afterEach } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { app } from "../dist/app.js";
import { User } from "../dist/models.js";
import { SellerApplication, Media } from "../dist/seller-models.js";
import { Product, Category } from "../dist/catalog-models.js";
import {
  applicationSchema,
  productInput,
  productEdit,
  inventoryInput,
  imageFormat,
} from "../dist/seller-validation.js";
const uid = new mongoose.Types.ObjectId(),
  pid = new mongoose.Types.ObjectId(),
  cid = new mongoose.Types.ObjectId();
process.env.JWT_ACCESS_SECRET =
  "seller-test-secret-at-least-thirty-two-characters";
const auth = () =>
  "Bearer " +
  jwt.sign({ version: 0 }, process.env.JWT_ACCESS_SECRET, {
    subject: String(uid),
    issuer: "markethub",
    audience: "markethub-web",
    expiresIn: "10m",
  });
function signed(role = "seller", approved = true) {
  jest.spyOn(Notification, "updateOne").mockResolvedValue({ matchedCount: 1 });
  mongoose.connection._readyState = 1;
  jest.spyOn(Product, "findOne").mockReturnValue({
    select: () => ({ lean: async () => ({ images: [] }) }),
  });
  jest.spyOn(Category, "updateOne").mockResolvedValue({ matchedCount: 1 });
  jest
    .spyOn(mongoose.connection, "transaction")
    .mockImplementation(async (cb) => cb({}));
  jest
    .spyOn(SellerApplication, "updateOne")
    .mockResolvedValue({ matchedCount: 1 });
  jest.spyOn(User, "findById").mockResolvedValue({
    _id: uid,
    id: String(uid),
    role,
    active: true,
    version: 0,
  });
  jest
    .spyOn(SellerApplication, "findOne")
    .mockResolvedValue(
      approved ? { storeName: "Own store", status: "approved" } : null,
    );
}
const valid = {
  name: "Ceramic cup",
  description: "A beautifully handmade ceramic coffee cup.",
  price: 2500,
  stock: 10,
  category: String(cid),
  images: [],
  active: false,
};
afterEach(() => {
  mongoose.connection._readyState = 0;
  jest.restoreAllMocks();
});
test("seller application validates business fields and rejects privilege injection", () => {
  const v = {
    storeName: "Studio",
    description: "An independent business selling handmade ceramics.",
    email: "business@example.com",
    phone: "+1 555 555 5555",
  };
  expect(applicationSchema.safeParse(v).success).toBe(true);
  expect(
    applicationSchema.safeParse({ ...v, status: "approved" }).success,
  ).toBe(false);
  expect(
    applicationSchema.safeParse({ ...v, description: "short" }).success,
  ).toBe(false);
});
test("product inputs require integer money, stock, category and safe image URLs", () => {
  expect(productInput.safeParse(valid).success).toBe(true);
  for (const v of [
    { ...valid, price: 1.5 },
    { ...valid, stock: -1 },
    { ...valid, seller: String(uid) },
    { ...valid, images: ["javascript:alert(1)"] },
    { ...valid, category: { $ne: null } },
    { ...valid, salesCount: 100 },
  ])
    expect(productInput.safeParse(v).success).toBe(false);
});
test("product edit cannot overwrite stock and inventory validates integer adjustments", () => {
  const { stock, ...rest } = valid;
  expect(productEdit.safeParse({ ...rest, version: 0 }).success).toBe(true);
  expect(productEdit.safeParse({ ...valid, version: 0 }).success).toBe(false);
  for (const delta of [0, 0.5, 1000001])
    expect(inventoryInput.safeParse({ delta, expectedStock: 10 }).success).toBe(
      false,
    );
});
test("upload validates bytes instead of trusting filename or MIME type", () => {
  expect(imageFormat(Buffer.from('<svg onload="alert(1)">'))).toBe(null);
  expect(imageFormat(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(
    "png",
  );
  expect(imageFormat(Buffer.from([255, 216, 255, 0]))).toBe("jpg");
  expect(imageFormat(Buffer.from("RIFF1234WEBP"))).toBe("webp");
});
test("seller workspace requires authentication", async () =>
  expect((await request(app).get("/api/seller/manage/products")).status).toBe(
    401,
  ));
test("customer cannot manage products; unapproved seller cannot publish", async () => {
  signed("customer");
  expect(
    (
      await request(app)
        .post("/api/seller/manage/products")
        .set("Authorization", auth())
        .send(valid)
    ).status,
  ).toBe(403);
});
test("seller role alone is insufficient without approved application", async () => {
  signed("seller", false);
  expect(
    (
      await request(app)
        .get("/api/seller/manage/overview")
        .set("Authorization", auth())
    ).status,
  ).toBe(403);
});
test("customers cannot review applications", async () => {
  signed("customer");
  expect(
    (
      await request(app)
        .patch("/api/admin/seller-applications/" + pid)
        .set("Authorization", auth())
        .send({ status: "approved", reason: "Approved for launch" })
    ).status,
  ).toBe(403);
});
test("application is tied to authenticated customer and defaults cannot be overridden", async () => {
  signed("customer", false);
  jest
    .spyOn(SellerApplication, "create")
    .mockResolvedValue({ _id: pid, status: "pending" });
  const v = {
    storeName: "Studio",
    description: "An independent business selling handmade ceramics.",
    email: "business@example.com",
    phone: "+1 555 555 5555",
  };
  expect(
    (
      await request(app)
        .post("/api/seller/application")
        .set("Authorization", auth())
        .send(v)
    ).status,
  ).toBe(201);
  expect(SellerApplication.create.mock.calls[0][0].user).toEqual(uid);
  expect(SellerApplication.create.mock.calls[0][0].status).toBeUndefined();
});
test("product creation assigns seller and store exclusively on server", async () => {
  signed();
  jest.spyOn(Category, "exists").mockResolvedValue({ _id: cid });
  jest.spyOn(Media, "countDocuments").mockResolvedValue(0);
  jest.spyOn(Product, "create").mockResolvedValue([{ _id: pid, ...valid }]);
  expect(
    (
      await request(app)
        .post("/api/seller/manage/products")
        .set("Authorization", auth())
        .send(valid)
    ).status,
  ).toBe(201);
  expect(Product.create.mock.calls[0][0][0]).toMatchObject({
    seller: uid,
    storeName: "Own store",
  });
});
test("published products need an owned uploaded image", async () => {
  signed();
  jest.spyOn(Category, "exists").mockResolvedValue({ _id: cid });
  jest.spyOn(Media, "countDocuments").mockResolvedValue(0);
  expect(
    (
      await request(app)
        .post("/api/seller/manage/products")
        .set("Authorization", auth())
        .send({ ...valid, active: true })
    ).status,
  ).toBe(409);
  expect(
    (
      await request(app)
        .post("/api/seller/manage/products")
        .set("Authorization", auth())
        .send({
          ...valid,
          active: true,
          images: ["https://example.com/not-owned.jpg"],
        })
    ).status,
  ).toBe(400);
});
test("inventory update is scoped to owner and current stock", async () => {
  signed();
  jest
    .spyOn(Product, "findOneAndUpdate")
    .mockResolvedValue({ _id: pid, stock: 13 });
  expect(
    (
      await request(app)
        .post("/api/seller/manage/products/" + pid + "/inventory")
        .set("Authorization", auth())
        .send({ delta: 3, expectedStock: 10 })
    ).status,
  ).toBe(200);
  expect(Product.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
    _id: String(pid),
    seller: uid,
    stock: 10,
    deleted: { $ne: true },
  });
  expect(Product.findOneAndUpdate.mock.calls[0][1]).toEqual({
    $inc: { stock: 3, __v: 1 },
  });
});
test("inventory cannot go negative or overwrite stale stock", async () => {
  signed();
  jest.spyOn(Product, "findOneAndUpdate").mockResolvedValue(null);
  expect(
    (
      await request(app)
        .post("/api/seller/manage/products/" + pid + "/inventory")
        .set("Authorization", auth())
        .send({ delta: -11, expectedStock: 10 })
    ).status,
  ).toBe(409);
  expect(Product.findOneAndUpdate).not.toHaveBeenCalled();
  expect(
    (
      await request(app)
        .post("/api/seller/manage/products/" + pid + "/inventory")
        .set("Authorization", auth())
        .send({ delta: 2, expectedStock: 10 })
    ).status,
  ).toBe(409);
});
test("archiving keeps product record and scopes ownership", async () => {
  signed();
  jest.spyOn(Product, "updateOne").mockResolvedValue({ matchedCount: 1 });
  expect(
    (
      await request(app)
        .delete("/api/seller/manage/products/" + pid)
        .set("Authorization", auth())
    ).status,
  ).toBe(204);
  expect(Product.updateOne.mock.calls[0][0].seller).toEqual(uid);
  expect(Product.updateOne.mock.calls[0][1]).toEqual({
    $set: { deleted: true, active: false },
    $inc: { __v: 1 },
  });
});
test("another sellers product cannot be read", async () => {
  signed();
  jest.spyOn(Product, "findOne").mockReturnValue({ lean: async () => null });
  expect(
    (
      await request(app)
        .get("/api/seller/manage/products/" + pid)
        .set("Authorization", auth())
    ).status,
  ).toBe(404);
  expect(Product.findOne.mock.calls[0][0].seller).toEqual(uid);
});
test("invalid image upload is rejected before Cloudinary", async () => {
  signed();
  expect(
    (
      await request(app)
        .post("/api/seller/manage/images")
        .set("Authorization", auth())
        .attach("image", Buffer.from("<svg>bad</svg>"), "fake.png")
    ).status,
  ).toBe(400);
});
test("missing Cloudinary configuration is explicit", async () => {
  signed();
  expect(
    (
      await request(app)
        .post("/api/seller/manage/images")
        .set("Authorization", auth())
        .attach(
          "image",
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
          "test.png",
        )
    ).status,
  ).toBe(503);
});
function reviewMocks(status) {
  signed("admin");
  const a = { user: uid, status, save: jest.fn(async () => {}) };
  jest
    .spyOn(SellerApplication, "findById")
    .mockReturnValue({ session: async () => a });
  const u = { role: "customer", save: jest.fn(async () => {}) };
  jest.spyOn(User, "findOne").mockReturnValue({ session: async () => u });
  return { a, u };
}
test("admin approval promotes applicant and records reviewer in transaction", async () => {
  const { a, u } = reviewMocks("pending");
  expect(
    (
      await request(app)
        .patch("/api/admin/seller-applications/" + pid)
        .set("Authorization", auth())
        .send({ status: "approved", reason: "Business application reviewed" })
    ).status,
  ).toBe(204);
  expect(a.status).toBe("approved");
  expect(a.reviewedBy).toEqual(uid);
  expect(a.reviewedAt).toBeInstanceOf(Date);
  expect(u.role).toBe("seller");
  expect(u.save).toHaveBeenCalledWith({ session: {} });
});
test("rejection leaves customer role intact", async () => {
  const { a, u } = reviewMocks("pending");
  expect(
    (
      await request(app)
        .patch("/api/admin/seller-applications/" + pid)
        .set("Authorization", auth())
        .send({
          status: "rejected",
          reason: "Business description needs more detail",
        })
    ).status,
  ).toBe(204);
  expect(a.status).toBe("rejected");
  expect(u.role).toBe("customer");
  expect(u.save).not.toHaveBeenCalled();
});
test("suspending seller deactivates only their listings", async () => {
  const { a } = reviewMocks("approved");
  jest.spyOn(Product, "updateMany").mockResolvedValue({ modifiedCount: 2 });
  expect(
    (
      await request(app)
        .patch("/api/admin/seller-applications/" + pid)
        .set("Authorization", auth())
        .send({
          status: "suspended",
          reason: "Store requires administrator review",
        })
    ).status,
  ).toBe(204);
  expect(a.status).toBe("suspended");
  expect(Product.updateMany.mock.calls[0][0]).toEqual({ seller: uid });
  expect(Product.updateMany.mock.calls[0][1].$set.active).toBe(false);
});
test("invalid application transition fails without changing account", async () => {
  const { u } = reviewMocks("rejected");
  expect(
    (
      await request(app)
        .patch("/api/admin/seller-applications/" + pid)
        .set("Authorization", auth())
        .send({ status: "approved", reason: "Invalid transition attempt" })
    ).status,
  ).toBe(409);
  expect(u.save).not.toHaveBeenCalled();
});
test("suspension race prevents product creation inside transaction", async () => {
  signed();
  jest.spyOn(Category, "exists").mockResolvedValue({ _id: cid });
  jest.spyOn(Media, "countDocuments").mockResolvedValue(0);
  SellerApplication.updateOne.mockResolvedValue({ matchedCount: 0 });
  const create = jest.spyOn(Product, "create");
  expect(
    (
      await request(app)
        .post("/api/seller/manage/products")
        .set("Authorization", auth())
        .send(valid)
    ).status,
  ).toBe(403);
  expect(create).not.toHaveBeenCalled();
});
test("product editing uses owner and version guards and excludes inventory", async () => {
  signed();
  jest.spyOn(Category, "exists").mockResolvedValue({ _id: cid });
  jest.spyOn(Media, "countDocuments").mockResolvedValue(0);
  jest.spyOn(Product, "findOneAndUpdate").mockResolvedValue({ _id: pid });
  const { stock, ...v } = valid;
  expect(
    (
      await request(app)
        .patch("/api/seller/manage/products/" + pid)
        .set("Authorization", auth())
        .send({ ...v, version: 3 })
    ).status,
  ).toBe(200);
  expect(Product.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
    seller: uid,
    __v: 3,
  });
  expect(Product.findOneAndUpdate.mock.calls[0][1].$set.stock).toBeUndefined();
});
test("oversize uploads are rejected", async () => {
  signed();
  expect(
    (
      await request(app)
        .post("/api/seller/manage/images")
        .set("Authorization", auth())
        .attach("image", Buffer.alloc(5 * 1024 * 1024 + 1), "large.png")
    ).status,
  ).toBe(400);
});
test("manual inventory reduction emits a transactional low-stock alert", async () => {
  signed();
  jest
    .spyOn(Product, "findOneAndUpdate")
    .mockResolvedValue({ _id: pid, name: "Ceramic cup", stock: 3, __v: 5 });
  expect(
    (
      await request(app)
        .post("/api/seller/manage/products/" + pid + "/inventory")
        .set("Authorization", auth())
        .send({ delta: -7, expectedStock: 10 })
    ).status,
  ).toBe(200);
  expect(Notification.updateOne.mock.calls[0][1].$setOnInsert).toMatchObject({
    user: uid,
    title: "Low stock",
    path: "/seller/products/" + pid,
  });
  expect(Product.findOneAndUpdate.mock.calls[0][2].session).toBeDefined();
});
test("discarding an unsaved image cannot access another owners metadata", async () => {
  signed();
  jest.spyOn(Media, "findOneAndUpdate").mockResolvedValue(null);
  expect(
    (
      await request(app)
        .delete("/api/seller/manage/images")
        .set("Authorization", auth())
        .send({ url: "https://example.com/other-image.png" })
    ).status,
  ).toBe(404);
  expect(Media.findOneAndUpdate.mock.calls[0][0].seller).toEqual(uid);
});
test("discard endpoint refuses a referenced image", async () => {
  signed();
  jest
    .spyOn(Media, "findOneAndUpdate")
    .mockResolvedValue({
      _id: pid,
      url: "https://example.com/owned.png",
      publicId: "markethub/products/owned",
    });
  jest.spyOn(Product, "exists").mockResolvedValue({ _id: pid });
  jest.spyOn(Media, "updateOne").mockResolvedValue({});
  expect(
    (
      await request(app)
        .delete("/api/seller/manage/images")
        .set("Authorization", auth())
        .send({ url: "https://example.com/owned.png" })
    ).status,
  ).toBe(409);
});
