import bcrypt from "bcryptjs";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import request from "supertest";
import { configuredCloudinary, destroyProjectImage } from "./cloudinary.js";
import { connectDatabase } from "./db.js";
import { User } from "./models.js";
import { SellerApplication, Media } from "./seller-models.js";
import { Category, Product } from "./catalog-models.js";
const dbName = "mh_media_" + Date.now() + "_" + randomUUID().slice(0, 8);
const ownedAssets: string[] = [];
let connected = false;
try {
  const cloud = configuredCloudinary();
  await cloud.api.ping();
  console.log("Cloudinary credentials verified.");
  await connectDatabase(dbName);
  connected = true;
  for (const model of [User, SellerApplication, Media, Category, Product])
    await model.createIndexes();
  const seller = await User.create({
    name: "Media test seller",
    email: "media-test@markethub.example",
    password: await bcrypt.hash(randomUUID(), 12),
    role: "seller",
    verified: true,
  });
  await SellerApplication.create({
    user: seller._id,
    storeName: "Media test store",
    description: "Isolated Cloudinary product lifecycle test store.",
    email: seller.email,
    phone: "+1 555 555 5555",
    status: "approved",
  });
  const category = await Category.create({
    name: "Media test category",
    slug: "media-test",
    active: true,
  });
  const bearer =
    "Bearer " +
    jwt.sign({ version: 0 }, process.env.JWT_ACCESS_SECRET!, {
      subject: seller.id,
      issuer: "markethub",
      audience: "markethub-web",
      expiresIn: "10m",
    });
  const { app } = await import("./app.js");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=",
    "base64",
  );
  const upload = await request(app)
    .post("/api/seller/manage/images")
    .set("Authorization", bearer)
    .attach("image", png, "generated-test.png");
  assert.equal(upload.status, 201, "product image upload");
  assert.ok(upload.body.url.startsWith("https://"));
  const media = await Media.findOne({ url: upload.body.url });
  assert.ok(media);
  ownedAssets.push(media.publicId);
  assert.ok(media.publicId.startsWith("markethub/"));
  assert.ok((await cloud.api.resource(media.publicId)).secure_url);
  const input = {
    name: "Cloudinary lifecycle test",
    description: "Generated fixture for isolated product image verification.",
    price: 1000,
    stock: 2,
    category: category.id,
    images: [upload.body.url],
    active: true,
  };
  const first = await request(app)
    .post("/api/seller/manage/products")
    .set("Authorization", bearer)
    .send(input);
  assert.equal(first.status, 201, "create product with uploaded secure URL");
  assert.deepEqual((await Product.findById(first.body.product._id))!.images, [
    upload.body.url,
  ]);
  const second = await request(app)
    .post("/api/seller/manage/products")
    .set("Authorization", bearer)
    .send({ ...input, name: "Shared image product" });
  assert.equal(second.status, 201);
  const { stock, ...edit } = input;
  const changed = await request(app)
    .patch("/api/seller/manage/products/" + first.body.product._id)
    .set("Authorization", bearer)
    .send({
      ...edit,
      active: false,
      images: [],
      version: first.body.product.__v,
    });
  assert.equal(changed.status, 200, "remove product image");
  assert.equal(
    changed.body.imageCleanup[0].status,
    "retained",
    "shared image retained",
  );
  assert.ok(await cloud.api.resource(media.publicId));
  const archived = await request(app)
    .delete("/api/seller/manage/products/" + second.body.product._id)
    .set("Authorization", bearer);
  assert.equal(archived.status, 204, "archive final referencing product");
  assert.equal(await Media.countDocuments({ url: upload.body.url }), 0);
  assert.equal(
    (await cloud.uploader.destroy(media.publicId)).result,
    "not found",
    "cloud asset removed",
  );
  console.log(
    "Passed: real upload, markethub folder, secure URL persistence in Atlas, shared-reference protection, update cleanup, and archive cleanup.",
  );
  console.log(
    "Isolated test database retained: " +
      dbName +
      ". Existing project data and old Cloudinary assets were not changed.",
  );
} catch (e) {
  const safeMessage = String((e as Error)?.message || "").replace(
    /mongodb(?:\+srv)?:\/\/[^\s]+/g,
    "[redacted URI]",
  );
  console.error(
    "Diagnostic: " + safeMessage + "; code " + String((e as any)?.code || ""),
  );
  console.error(
    "Cloudinary integration test failed: " +
      (e instanceof assert.AssertionError
        ? e.message
        : "service error; code " +
          String(
            (e as any)?.http_code || (e as any)?.status || (e as Error)?.name,
          )),
  );
  if (connected) console.error("Isolated test database retained: " + dbName);
  process.exitCode = 1;
} finally {
  for (const id of ownedAssets)
    await destroyProjectImage(id).catch(() => {
      console.error("Generated test asset needs cleanup: " + id);
      process.exitCode = 1;
    });
  await mongoose.disconnect();
}
