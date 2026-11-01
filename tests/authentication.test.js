import { test, expect, jest, afterEach } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { app } from "../dist/app.js";
import { User, Session, SessionFamily, Action } from "../dist/models.js";
import { passwordSchema, hashToken, sendAction } from "../dist/auth.js";
const uid = new mongoose.Types.ObjectId(),
  family = "f".repeat(64),
  raw = "a".repeat(64),
  secret = "authentication-tests-secret-at-least-32-characters";
process.env.JWT_ACCESS_SECRET = secret;
const hashed = await bcrypt.hash("StrongPassword123", 12);
function query(value) {
  const q = {};
  for (const k of ["select", "session"]) q[k] = jest.fn(() => q);
  q.then = (resolve, reject) => Promise.resolve(value).then(resolve, reject);
  return q;
}
const user = () => ({
  _id: uid,
  id: String(uid),
  name: "Customer",
  email: "customer@example.com",
  role: "customer",
  active: true,
  verified: true,
  version: 0,
  password: hashed,
  save: jest.fn(async () => {}),
});
function tx() {
  mongoose.connection._readyState = 1;
  jest
    .spyOn(mongoose.connection, "transaction")
    .mockImplementation(async (cb) => cb({ testSession: true }));
}
const bearer = (payload = {}) =>
  "Bearer " +
  jwt.sign({ version: 0, ...payload }, secret, {
    subject: String(uid),
    issuer: "markethub",
    audience: "markethub-web",
    expiresIn: "10m",
  });
afterEach(() => {
  mongoose.connection._readyState = 0;
  jest.restoreAllMocks();
  delete process.env.SMTP_HOST;
  delete process.env.MAIL_FROM;
});
test("password validation accounts for bcrypt UTF-8 byte limit", () => {
  expect(passwordSchema.safeParse("StrongPassword123").success).toBe(true);
  expect(passwordSchema.safeParse("😀".repeat(25)).success).toBe(false);
});
test("registration hashes password and returns safe customer profile only", async () => {
  tx();
  let stored;
  jest.spyOn(User, "create").mockImplementation(async (v) => {
    stored = v;
    return {
      ...v,
      _id: uid,
      id: String(uid),
      role: "customer",
      active: true,
      verified: false,
      version: 0,
    };
  });
  const r = await request(app).post("/api/auth/register").send({
    email: "TEST@EXAMPLE.COM",
    name: "Test Customer",
    password: "StrongPassword123",
  });
  expect(r.status).toBe(201);
  expect(stored.email).toBe("test@example.com");
  expect(stored.password).not.toBe("StrongPassword123");
  expect(await bcrypt.compare("StrongPassword123", stored.password)).toBe(true);
  expect(r.body.user.password).toBeUndefined();
});
test("login rejects incorrect, unverified and inactive accounts", async () => {
  tx();
  const u = user();
  jest.spyOn(User, "findOne").mockReturnValue(query(u));
  const login = (p) =>
    request(app).post("/api/auth/login").send({ email: u.email, password: p });
  expect((await login("WrongPassword123")).status).toBe(401);
  u.verified = false;
  expect((await login("StrongPassword123")).status).toBe(403);
  u.active = false;
  expect((await login("StrongPassword123")).status).toBe(401);
});
test("login creates hashed refresh token and a revocable access family", async () => {
  tx();
  const u = user();
  jest.spyOn(User, "findOne").mockReturnValue(query(u));
  jest.spyOn(User, "updateOne").mockResolvedValue({ matchedCount: 1 });
  jest.spyOn(SessionFamily, "create").mockResolvedValue([]);
  jest.spyOn(Session, "create").mockResolvedValue([]);
  const r = await request(app)
    .post("/api/auth/login")
    .send({ email: u.email, password: "StrongPassword123" });
  expect(r.status).toBe(200);
  const claims = jwt.verify(r.body.accessToken, secret);
  expect(claims.exp - claims.iat).toBe(600);
  expect(claims.family).toHaveLength(64);
  const cookie = r.headers["set-cookie"][0];
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Strict");
  const cookieToken = cookie.match(/refresh=([^;]+)/)[1];
  expect(Session.create.mock.calls[0][0][0].hash).toBe(hashToken(cookieToken));
  expect(JSON.stringify(r.body)).not.toContain(cookieToken);
});
test("refresh atomically consumes token and issues different hashed successor", async () => {
  tx();
  const old = {
    user: uid,
    family,
    expires: new Date(Date.now() + 60000),
    used: false,
    save: jest.fn(async () => {}),
  };
  jest.spyOn(Session, "findOne").mockReturnValue(query(old));
  jest
    .spyOn(SessionFamily, "findOneAndUpdate")
    .mockResolvedValue({ _id: family });
  jest.spyOn(User, "findById").mockReturnValue(query(user()));
  jest.spyOn(Session, "create").mockResolvedValue([]);
  const r = await request(app)
    .post("/api/auth/refresh")
    .set("Cookie", "refresh=" + raw);
  expect(r.status).toBe(200);
  expect(old.used).toBe(true);
  expect(old.save).toHaveBeenCalledWith({ session: { testSession: true } });
  expect(Session.create.mock.calls[0][0][0].hash).not.toBe(hashToken(raw));
});
test("replayed refresh token commits family revocation before returning 401", async () => {
  tx();
  const f = { revoked: false, save: jest.fn(async () => {}) };
  jest
    .spyOn(Session, "findOne")
    .mockReturnValue(
      query({ family, used: true, expires: new Date(Date.now() + 60000) }),
    );
  jest.spyOn(SessionFamily, "findOneAndUpdate").mockResolvedValue(f);
  const create = jest.spyOn(Session, "create");
  const r = await request(app)
    .post("/api/auth/refresh")
    .set("Cookie", "refresh=" + raw);
  expect(r.status).toBe(401);
  expect(f.revoked).toBe(true);
  expect(f.save).toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});
test("revoked access-token family is denied immediately", async () => {
  tx();
  jest.spyOn(User, "findById").mockResolvedValue(user());
  jest.spyOn(SessionFamily, "exists").mockResolvedValue(null);
  expect(
    (
      await request(app)
        .get("/api/users/me")
        .set("Authorization", bearer({ family }))
    ).status,
  ).toBe(401);
});
test("logout revokes refresh family and removes its tokens", async () => {
  tx();
  jest.spyOn(Session, "findOne").mockReturnValue(query({ family }));
  jest.spyOn(SessionFamily, "updateOne").mockResolvedValue({});
  jest.spyOn(Session, "deleteMany").mockResolvedValue({});
  expect(
    (
      await request(app)
        .post("/api/auth/logout")
        .set("Cookie", "refresh=" + raw)
    ).status,
  ).toBe(204);
  expect(SessionFamily.updateOne.mock.calls[0][1]).toEqual({
    $set: { revoked: true },
  });
});
test("email actions store only token hash and send link to mailbox", async () => {
  tx();
  process.env.SMTP_HOST = "smtp.test";
  process.env.MAIL_FROM = "noreply@example.com";
  jest.spyOn(Action, "create").mockResolvedValue({});
  const mail = jest.fn(async () => {});
  jest.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail: mail });
  await sendAction(user(), "verify-email");
  const text = mail.mock.calls[0][0].text;
  const raw = text.match(/token=([a-f0-9]{64})/)[1];
  expect(Action.create.mock.calls[0][0].hash).toBe(hashToken(raw));
  expect(mail.mock.calls[0][0].to).toBe("customer@example.com");
});
test("failed email delivery removes the unusable action token and reports failure", async () => {
  tx();
  process.env.SMTP_HOST = "smtp.test";
  process.env.MAIL_FROM = "noreply@example.com";
  jest.spyOn(Action, "create").mockResolvedValue({});
  jest.spyOn(Action, "deleteOne").mockResolvedValue({});
  jest.spyOn(nodemailer, "createTransport").mockReturnValue({
    sendMail: async () => {
      throw Error("SMTP down");
    },
  });
  await expect(sendAction(user(), "reset-password")).rejects.toMatchObject({
    status: 503,
  });
  expect(Action.deleteOne).toHaveBeenCalled();
});
test("password reset consumes token, hashes password, invalidates all sessions", async () => {
  tx();
  const u = user();
  jest.spyOn(Action, "findOneAndDelete").mockReturnValue(query({ user: uid }));
  jest.spyOn(User, "findOne").mockReturnValue(query(u));
  jest.spyOn(SessionFamily, "updateMany").mockResolvedValue({});
  jest.spyOn(Session, "deleteMany").mockResolvedValue({});
  jest.spyOn(Action, "deleteMany").mockResolvedValue({});
  const r = await request(app)
    .post("/api/auth/reset-password")
    .send({ token: raw, password: "UpdatedPassword123" });
  expect(r.status).toBe(200);
  expect(await bcrypt.compare("UpdatedPassword123", u.password)).toBe(true);
  expect(u.version).toBe(1);
  expect(SessionFamily.updateMany.mock.calls[0][1]).toEqual({
    $set: { revoked: true },
  });
});
test("used or expired email action cannot be consumed again", async () => {
  tx();
  jest.spyOn(Action, "findOneAndDelete").mockReturnValue(query(null));
  expect(
    (await request(app).post("/api/auth/verify-email").send({ token: raw }))
      .status,
  ).toBe(400);
});
test("profile mutation rejects role escalation", async () => {
  tx();
  jest.spyOn(User, "findById").mockResolvedValue(user());
  expect(
    (
      await request(app)
        .patch("/api/users/me")
        .set("Authorization", bearer())
        .send({ name: "Updated", role: "admin" })
    ).status,
  ).toBe(400);
});
test("avatar upload rejects executable contents", async () => {
  tx();
  jest.spyOn(User, "findById").mockResolvedValue(user());
  expect(
    (
      await request(app)
        .post("/api/users/me/avatar")
        .set("Authorization", bearer())
        .attach("image", Buffer.from('<svg onload="alert(1)">'), "avatar.png")
    ).status,
  ).toBe(400);
});
test("password change revokes families only after current password matches", async () => {
  tx();
  const u = user();
  jest.spyOn(User, "findById").mockImplementation(() => query(u));
  jest.spyOn(SessionFamily, "updateMany").mockResolvedValue({});
  jest.spyOn(Session, "deleteMany").mockResolvedValue({});
  jest.spyOn(Action, "deleteMany").mockResolvedValue({});
  expect(
    (
      await request(app)
        .post("/api/users/me/password")
        .set("Authorization", bearer())
        .send({
          currentPassword: "WrongPassword123",
          newPassword: "UpdatedPassword123",
        })
    ).status,
  ).toBe(400);
  expect(SessionFamily.updateMany).not.toHaveBeenCalled();
  expect(
    (
      await request(app)
        .post("/api/users/me/password")
        .set("Authorization", bearer())
        .send({
          currentPassword: "StrongPassword123",
          newPassword: "UpdatedPassword123",
        })
    ).status,
  ).toBe(204);
  expect(u.version).toBe(1);
  expect(await bcrypt.compare("UpdatedPassword123", u.password)).toBe(true);
});
test("email verification updates active account without returning action token", async () => {
  tx();
  const u = user();
  u.verified = false;
  jest.spyOn(Action, "findOneAndDelete").mockReturnValue(query({ user: uid }));
  jest.spyOn(User, "findOne").mockReturnValue(query(u));
  jest.spyOn(Action, "deleteMany").mockResolvedValue({});
  const r = await request(app)
    .post("/api/auth/verify-email")
    .send({ token: raw });
  expect(r.status).toBe(200);
  expect(u.verified).toBe(true);
  expect(u.save).toHaveBeenCalled();
  expect(JSON.stringify(r.body)).not.toContain(raw);
});
test("administrator cannot self-deactivate through customer account endpoint", async () => {
  tx();
  jest.spyOn(User, "findById").mockResolvedValue({ ...user(), role: "admin" });
  expect(
    (
      await request(app)
        .delete("/api/users/me")
        .set("Authorization", bearer())
        .send({ password: "StrongPassword123" })
    ).status,
  ).toBe(403);
});
