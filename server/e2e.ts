import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import request from "supertest";
import { connectDatabase } from "./db.js";
import { User } from "./models.js";
import { Product, Category } from "./catalog-models.js";
import { SellerApplication, Media } from "./seller-models.js";
import "./community-models.js";
import "./admin-models.js";
import "./commerce-models.js";
if (process.env.NODE_ENV === "production")
  throw Error("Integration tests cannot run in production");
const dbName = "markethub_e2e_" + Date.now() + "_" + randomUUID().slice(0, 8);
const password = "E2E-" + randomUUID();
const mails: string[] = [];
const smtp = createServer((socket) => {
  socket.write("220 localhost test SMTP\r\n");
  let data = "",
    inData = false,
    mail = "";
  socket.on("data", (chunk) => {
    data += chunk.toString();
    let n;
    while ((n = data.indexOf("\r\n")) >= 0) {
      const line = data.slice(0, n);
      data = data.slice(n + 2);
      if (inData) {
        if (line === ".") {
          mails.push(mail);
          mail = "";
          inData = false;
          socket.write("250 accepted\r\n");
        } else mail += line + "\r\n";
      } else if (/^(EHLO|HELO)/.test(line))
        socket.write("250-localhost\r\n250 SIZE 1048576\r\n");
      else if (/^DATA/.test(line)) {
        inData = true;
        socket.write("354 End with dot\r\n");
      } else if (/^QUIT/.test(line)) {
        socket.end("221 Bye\r\n");
      } else socket.write("250 OK\r\n");
    }
  });
});
let connected = false;
try {
  await connectDatabase(dbName);
  connected = true;
  for (const model of Object.values(mongoose.models))
    await model.createIndexes();
  await new Promise<void>((resolve) => smtp.listen(0, "127.0.0.1", resolve));
  process.env.NODE_ENV = "test";
  process.env.CLIENT_ORIGIN = "http://localhost:5173";
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = String((smtp.address() as { port: number }).port);
  process.env.MAIL_FROM = "test@markethub.example";
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;
  const { app } = await import("./app.js");
  const check = (r: any, status: number, label: string) => {
    assert.equal(r.status, status, label + ": " + r.status);
    return r;
  };
  async function createAccount(label: string) {
    const email = label + "@markethub.example";
    check(
      await request(app)
        .post("/api/auth/register")
        .send({ email, name: label, password }),
      201,
      "register",
    );
    check(
      await request(app).post("/api/auth/request-verify-email").send({ email }),
      200,
      "send verification via local SMTP",
    );
    const raw = mails
      .at(-1)!
      .replace(/=\r\n/g, "")
      .replace(/=3D/g, "=")
      .match(/token=([a-f0-9]{64})/)?.[1];
    assert.ok(raw, "verification delivered to test mailbox");
    check(
      await request(app).post("/api/auth/verify-email").send({ token: raw }),
      200,
      "verify",
    );
    const agent = request.agent(app);
    const login = check(
      await agent.post("/api/auth/login").send({ email, password }),
      200,
      "login",
    );
    return {
      email,
      agent,
      access: login.body.accessToken,
      user: login.body.user,
    };
  }
  const buyer = await createAccount("buyer"),
    a = await createAccount("seller-a"),
    b = await createAccount("seller-b");
  const adminUser = await User.create({
    email: "admin@markethub.example",
    name: "Test Administrator",
    password: await bcrypt.hash(password, 12),
    role: "admin",
    verified: true,
  });
  const administrator = request.agent(app);
  const adminLogin = check(
    await administrator
      .post("/api/auth/login")
      .send({ email: adminUser.email, password }),
    200,
    "admin login",
  );
  const adminToken = adminLogin.body.accessToken;
  for (const seller of [a, b]) {
    const application = check(
      await request(app)
        .post("/api/seller/application")
        .set("Authorization", "Bearer " + seller.access)
        .send({
          storeName: seller.user.name,
          description:
            "Independent integration test store for marketplace verification.",
          email: seller.email,
          phone: "+1 555 555 5555",
        }),
      201,
      "application",
    );
    check(
      await request(app)
        .patch(
          "/api/admin/seller-applications/" + application.body.application._id,
        )
        .set("Authorization", "Bearer " + adminToken)
        .send({
          status: "approved",
          reason: "Isolated integration test approval",
        }),
      204,
      "approve",
    );
  }
  const cat = check(
    await request(app)
      .post("/api/admin/categories")
      .set("Authorization", "Bearer " + adminToken)
      .send({
        name: "Integration finds",
        slug: "integration-finds",
        description: "Isolated test category",
        image: "",
        active: true,
      }),
    201,
    "category",
  ).body.category;
  const products = [];
  for (const seller of [a, b]) {
    const image = "https://example.com/test-only-" + seller.user.id + ".png";
    await Media.create({
      seller: seller.user.id,
      url: image,
      publicId: "isolated-test-fixture",
    });
    const r = check(
      await request(app)
        .post("/api/seller/manage/products")
        .set("Authorization", "Bearer " + seller.access)
        .send({
          name: "Test product " + seller.user.name,
          description:
            "Isolated test fixture product, not production catalog data.",
          price: 2500,
          stock: 10,
          category: cat._id,
          images: [image],
          active: true,
        }),
      201,
      "seller product",
    );
    products.push(r.body.product);
  }
  check(
    await request(app).get("/api/products").query({ q: "Test product" }),
    200,
    "catalog",
  );
  check(
    await request(app)
      .get("/api/seller/manage/products/" + products[0]._id)
      .set("Authorization", "Bearer " + b.access),
    404,
    "seller ownership",
  );
  check(
    await request(app)
      .put("/api/wishlist/" + products[0]._id)
      .set("Authorization", "Bearer " + buyer.access),
    204,
    "wishlist add",
  );
  check(
    await request(app)
      .post("/api/wishlist/" + products[0]._id + "/move")
      .set("Authorization", "Bearer " + buyer.access),
    204,
    "wishlist move",
  );
  let cart = check(
    await request(app)
      .get("/api/cart")
      .set("Authorization", "Bearer " + buyer.access),
    200,
    "cart",
  ).body;
  cart = check(
    await request(app)
      .put("/api/cart/items/" + products[1]._id)
      .set("Authorization", "Bearer " + buyer.access)
      .send({ quantity: 2, revision: cart.revision }),
    200,
    "multivendor cart",
  ).body;
  const address = {
    name: "Test Buyer",
    email: buyer.email,
    phone: "+1 555 555 5555",
    line1: "123 Test Street",
    line2: "",
    city: "Austin",
    postalCode: "78701",
    country: "US",
  };
  async function place(cart: any, key = randomUUID()) {
    return request(app)
      .post("/api/orders")
      .set("Authorization", "Bearer " + buyer.access)
      .set("Idempotency-Key", key)
      .send({
        address,
        paymentMethod: "cod",
        revision: cart.revision,
        expectedTotal: cart.quote.total,
      });
  }
  const key = randomUUID(),
    first = check(await place(cart, key), 201, "checkout").body.order;
  assert.equal(first.groups.length, 2);
  assert.equal(first.total, 8500);
  check(await place(cart, key), 200, "idempotent replay");
  for (let i = 0; i < 2; i++)
    check(
      await request(app)
        .post("/api/orders/" + first._id + "/cancel")
        .set("Authorization", "Bearer " + buyer.access),
      204,
      "cancel replay",
    );
  assert.equal((await Product.findById(products[0]._id))!.stock, 10);
  cart = check(
    await request(app)
      .get("/api/cart")
      .set("Authorization", "Bearer " + buyer.access),
    200,
    "empty cart",
  ).body;
  cart = check(
    await request(app)
      .put("/api/cart/items/" + products[0]._id)
      .set("Authorization", "Bearer " + buyer.access)
      .send({ quantity: 1, revision: cart.revision }),
    200,
    "new cart",
  ).body;
  const order = check(await place(cart), 201, "second checkout").body.order;
  for (const status of ["confirmed", "processing", "shipped", "delivered"])
    check(
      await request(app)
        .patch(
          "/api/seller/orders/" + order._id + "/groups/" + order.groups[0]._id,
        )
        .set("Authorization", "Bearer " + a.access)
        .send({ status }),
      204,
      "fulfillment " + status,
    );
  check(
    await request(app)
      .put("/api/products/" + products[0]._id + "/review")
      .set("Authorization", "Bearer " + buyer.access)
      .send({
        order: order._id,
        rating: 5,
        comment: "Verified integration purchase review",
      }),
    200,
    "review",
  );
  check(
    await request(app)
      .put("/api/products/" + products[0]._id + "/review")
      .set("Authorization", "Bearer " + buyer.access)
      .send({
        order: order._id,
        rating: 4,
        comment: "Updated verified integration review",
      }),
    200,
    "update review",
  );
  const rated = await Product.findById(products[0]._id);
  assert.equal(rated!.reviewCount, 1);
  assert.equal(rated!.averageRating, 4);
  const notifications = check(
    await request(app)
      .get("/api/notifications")
      .set("Authorization", "Bearer " + buyer.access),
    200,
    "notifications",
  ).body;
  assert.ok(notifications.unread >= 4);
  check(
    await request(app)
      .patch("/api/notifications/read-all")
      .set("Authorization", "Bearer " + buyer.access),
    204,
    "read notifications",
  );
  check(
    await request(app)
      .get("/api/admin/overview")
      .set("Authorization", "Bearer " + adminToken),
    200,
    "admin overview",
  );
  const competitor = await createAccount("competing-buyer");
  check(
    await request(app)
      .post("/api/seller/manage/products/" + products[1]._id + "/inventory")
      .set("Authorization", "Bearer " + b.access)
      .send({ delta: -9, expectedStock: 10 }),
    200,
    "limited inventory",
  );
  const getCart = async (account: any) =>
    (
      await request(app)
        .get("/api/cart")
        .set("Authorization", "Bearer " + account.access)
    ).body;
  const left = await getCart(buyer),
    right = await getCart(competitor);
  const cartLeft = check(
    await request(app)
      .put("/api/cart/items/" + products[1]._id)
      .set("Authorization", "Bearer " + buyer.access)
      .send({ quantity: 1, revision: left.revision }),
    200,
    "limited cart A",
  ).body;
  const cartRight = check(
    await request(app)
      .put("/api/cart/items/" + products[1]._id)
      .set("Authorization", "Bearer " + competitor.access)
      .send({ quantity: 1, revision: right.revision }),
    200,
    "limited cart B",
  ).body;
  const raced = await Promise.all([
    place(cartLeft),
    request(app)
      .post("/api/orders")
      .set("Authorization", "Bearer " + competitor.access)
      .set("Idempotency-Key", randomUUID())
      .send({
        address: { ...address, email: competitor.email },
        paymentMethod: "cod",
        revision: cartRight.revision,
        expectedTotal: cartRight.quote.total,
      }),
  ]);
  assert.deepEqual(
    raced.map((r) => r.status).sort(),
    [201, 409],
    "one winner for final unit",
  );
  assert.equal((await Product.findById(products[1]._id))!.stock, 0);
  const old = buyer.access;
  check(await buyer.agent.post("/api/auth/refresh"), 200, "rotate refresh");
  check(
    await request(app)
      .patch("/api/users/me")
      .set("Authorization", "Bearer " + old)
      .send({ name: "Updated Buyer" }),
    200,
    "profile",
  );
  check(
    await request(app)
      .post("/api/users/me/password")
      .set("Authorization", "Bearer " + old)
      .send({ currentPassword: password, newPassword: "Updated-" + password }),
    204,
    "change password",
  );
  check(
    await request(app)
      .get("/api/users/me")
      .set("Authorization", "Bearer " + old),
    401,
    "old access revoked",
  );
  check(
    await buyer.agent.post("/api/auth/refresh"),
    401,
    "old refresh revoked",
  );
  check(
    await request(app)
      .post("/api/auth/request-reset-password")
      .send({ email: buyer.email }),
    200,
    "request reset",
  );
  const resetToken = mails
    .at(-1)!
    .replace(/=\r\n/g, "")
    .replace(/=3D/g, "=")
    .match(/token=([a-f0-9]{64})/)?.[1];
  assert.ok(resetToken);
  check(
    await request(app)
      .post("/api/auth/reset-password")
      .send({ token: resetToken, password: "Reset-" + password }),
    200,
    "reset password",
  );
  check(
    await request(app)
      .post("/api/auth/reset-password")
      .send({ token: resetToken, password: "Reset-" + password }),
    400,
    "reset replay",
  );
  const afterReset = check(
    await buyer.agent
      .post("/api/auth/login")
      .send({ email: buyer.email, password: "Reset-" + password }),
    200,
    "login after reset",
  );
  check(await buyer.agent.post("/api/auth/logout"), 204, "logout");
  check(
    await request(app)
      .get("/api/users/me")
      .set("Authorization", "Bearer " + afterReset.body.accessToken),
    401,
    "logout access revoked",
  );
  check(
    await request(app)
      .delete("/api/users/me")
      .set("Authorization", "Bearer " + competitor.access)
      .send({ password }),
    204,
    "deactivate",
  );
  check(
    await competitor.agent
      .post("/api/auth/login")
      .send({ email: competitor.email, password }),
    401,
    "inactive login blocked",
  );
  console.log(
    "Atlas API integration passed: authentication, local SMTP verification, multi-vendor checkout, idempotency, ownership, cancellation restoration, fulfillment, reviews, notifications, admin, and password revocation.",
  );
  console.log(
    "Isolated test database retained: " +
      dbName +
      ". No existing application data was modified. External Cloudinary/SMTP and browser UI were not tested.",
  );
} catch (e) {
  console.error(
    connected
      ? "Integration failed after connecting; isolated test database retained: " +
          dbName
      : "Integration blocked before writes: Atlas TLS/network connection failed.",
  );
  console.error(
    e instanceof assert.AssertionError
      ? e.message
      : "Error type: " + (e as Error).name,
  );
  process.exitCode = 1;
} finally {
  if (smtp.listening)
    await new Promise<void>((resolve) => smtp.close(() => resolve()));
  await mongoose.disconnect();
}
