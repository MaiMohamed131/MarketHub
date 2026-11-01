import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import nodemailer from "nodemailer";
import request from "supertest";
import { connectDatabase } from "./db.js";
import { User, Session, SessionFamily, Action } from "./models.js";
import { hashToken } from "./auth.js";
import { z } from "zod";
if (process.env.NODE_ENV === "production")
  throw Error("Live auth tests require a non-production execution environment");
const email = z.email().parse(process.env.SMTP_TEST_TO);
const database = "mh_auth_" + Date.now() + "_" + randomUUID().slice(0, 6);
const initial = "Initial-" + randomUUID(),
  replacement = "Reset-" + randomUUID(),
  changed = "Changed-" + randomUUID();
const sent: { subject: string; text: string }[] = [];
const original = nodemailer.createTransport;
let connected = false;
try {
  await connectDatabase(database);
  connected = true;
  for (const model of [User, Session, SessionFamily, Action])
    await model.createIndexes();
  (nodemailer as any).createTransport = (...args: any[]) => {
    const transport = (original as any)(...args);
    const send = transport.sendMail.bind(transport);
    transport.sendMail = async (options: any) => {
      const result = await send(options);
      assert.ok(result.accepted?.length, "SMTP recipient accepted");
      sent.push({ subject: options.subject, text: options.text });
      return result;
    };
    return transport;
  };
  const { app } = await import("./app.js");
  const check = (r: any, status: number, label: string) => {
    assert.equal(r.status, status, label + " returned " + r.status);
    console.log("PASS " + label);
    return r;
  };
  const post = (path: string, body: Record<string, unknown>) =>
    request(app)
      .post("/api/auth/" + path)
      .send(body);
  check(
    await post("register", {
      email,
      name: "MarketHub live email test",
      password: initial,
    }),
    201,
    "isolated account registration",
  );
  check(
    await post("login", { email, password: initial }),
    403,
    "unverified login blocked",
  );
  check(
    await post("request-verify-email", { email }),
    200,
    "real verification email accepted",
  );
  const getToken = () => {
    const body = sent.at(-1)!.text;
    const link = body.match(/https?:\/\/\S+/)?.[0];
    assert.ok(link, "email contains URL");
    assert.equal(
      new URL(link).origin,
      new URL(process.env.CLIENT_ORIGIN || "http://localhost:5173").origin,
    );
    const value = new URL(link).searchParams.get("token");
    assert.match(value!, /^[a-f0-9]{64}$/);
    return value!;
  };
  const verification = getToken();
  const record = await Action.findOne({ hash: hashToken(verification) });
  assert.ok(record);
  assert.notEqual(record.hash, verification);
  assert.equal((await User.findOne({ email }))!.verified, false);
  const verified = await Promise.all([
    post("verify-email", { token: verification }),
    post("verify-email", { token: verification }),
  ]);
  assert.deepEqual(verified.map((r) => r.status).sort(), [200, 400]);
  console.log("PASS verification link single-use under concurrent requests");
  check(
    await post("verify-email", { token: verification }),
    400,
    "verification replay denied",
  );
  const first = request.agent(app),
    second = request.agent(app);
  const one = check(
      await first.post("/api/auth/login").send({ email, password: initial }),
      200,
      "session A login",
    ),
    two = check(
      await second.post("/api/auth/login").send({ email, password: initial }),
      200,
      "session B login",
    );
  const firstAccess = one.body.accessToken,
    secondAccess = two.body.accessToken;
  const previousCookie = one.headers["set-cookie"][0].split(";")[0];
  check(await first.post("/api/auth/refresh"), 200, "refresh token rotated");
  check(
    await request(app).post("/api/auth/refresh").set("Cookie", previousCookie),
    401,
    "refresh replay denied",
  );
  check(
    await request(app)
      .get("/api/users/me")
      .set("Authorization", "Bearer " + firstAccess),
    401,
    "replayed family access revoked",
  );
  check(
    await first.post("/api/auth/refresh"),
    401,
    "successor refresh revoked by replay",
  );
  check(
    await request(app)
      .get("/api/users/me")
      .set("Authorization", "Bearer " + secondAccess),
    200,
    "unrelated session remains valid before reset",
  );
  check(
    await post("request-reset-password", { email }),
    200,
    "real password reset email accepted",
  );
  const reset = getToken();
  const newPwd = { token: reset, password: replacement };
  const resetRace = await Promise.all([
    post("reset-password", newPwd),
    post("reset-password", newPwd),
  ]);
  assert.deepEqual(resetRace.map((r) => r.status).sort(), [200, 400]);
  console.log("PASS reset link single-use under concurrent requests");
  check(
    await post("reset-password", { token: reset, password: changed }),
    400,
    "reset replay denied",
  );
  check(
    await request(app)
      .get("/api/users/me")
      .set("Authorization", "Bearer " + secondAccess),
    401,
    "reset revokes other session access",
  );
  check(
    await second.post("/api/auth/refresh"),
    401,
    "reset revokes other session refresh",
  );
  check(
    await post("login", { email, password: initial }),
    401,
    "old password rejected",
  );
  const fresh = request.agent(app);
  const login = check(
    await fresh.post("/api/auth/login").send({ email, password: replacement }),
    200,
    "reset password works",
  );
  check(
    await request(app)
      .post("/api/users/me/password")
      .set("Authorization", "Bearer " + login.body.accessToken)
      .send({ currentPassword: replacement, newPassword: changed }),
    204,
    "authenticated password change",
  );
  check(
    await request(app)
      .get("/api/users/me")
      .set("Authorization", "Bearer " + login.body.accessToken),
    401,
    "password change revokes access",
  );
  check(
    await fresh.post("/api/auth/refresh"),
    401,
    "password change revokes refresh",
  );
  const final = request.agent(app);
  const finalLogin = check(
    await final.post("/api/auth/login").send({ email, password: changed }),
    200,
    "changed password works",
  );
  check(await final.post("/api/auth/logout"), 204, "logout");
  check(
    await request(app)
      .get("/api/users/me")
      .set("Authorization", "Bearer " + finalLogin.body.accessToken),
    401,
    "logout revokes access",
  );
  check(await final.post("/api/auth/refresh"), 401, "logout revokes refresh");
  assert.equal(await Action.countDocuments(), 0);
  assert.equal(await Session.countDocuments(), 0);
  assert.equal(await SessionFamily.countDocuments({ revoked: false }), 0);
  console.log("PASS no reusable action tokens or active sessions remain");
  console.log(
    "Real SMTP auth integration passed; " +
      sent.length +
      " authentication emails sent. Links were consumed automatically and should now report invalid/expired if opened.",
  );
  console.log(
    "Isolated test database retained: " +
      database +
      ". Existing marketplace accounts/passwords were not modified.",
  );
} catch (e) {
  console.error(
    "Live auth integration failed: " +
      (e instanceof assert.AssertionError
        ? e.message
        : "service error " + String((e as any)?.code || (e as Error).name)),
  );
  if (connected) console.error("Isolated database retained: " + database);
  process.exitCode = 1;
} finally {
  nodemailer.createTransport = original;
  await mongoose.disconnect();
}
