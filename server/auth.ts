import { clientOrigin } from "./environment.js";
import { createMailTransport } from "./mail.js";
import { Router, type RequestHandler, type Response } from "express";
import mongoose, { type ClientSession } from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes, createHash } from "node:crypto";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { z } from "zod";
import { User, Session, SessionFamily, Action } from "./models.js";
import { Product } from "./catalog-models.js";
import { SellerApplication } from "./seller-models.js";
import { imageFormat, statusError } from "./seller-validation.js";
export const authentication = Router();
export const hashToken = (v: string) =>
  createHash("sha256").update(v).digest("hex");
const token = () => randomBytes(32).toString("hex");
const secret = () => {
  const v = process.env.JWT_ACCESS_SECRET;
  if (!v || v.length < 32)
    throw Error("JWT_ACCESS_SECRET must contain at least 32 characters");
  return v;
};
export const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/api/auth",
  maxAge: 7 * 86400000,
});
export const passwordSchema = z
  .string()
  .min(12)
  .max(72)
  .refine(
    (v) => Buffer.byteLength(v, "utf8") <= 72,
    "Password must use at most 72 UTF-8 bytes",
  );
const credentials = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: passwordSchema,
  })
  .strict();
export const profile = (u: any) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  verified: u.verified,
  active: u.active,
  avatar: u.avatar,
});
export const auth: RequestHandler = async (req: any, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer "))
      throw statusError(401, "Authentication required");
    let p: any;
    try {
      p = jwt.verify(header.slice(7), secret(), {
        algorithms: ["HS256"],
        issuer: "markethub",
        audience: "markethub-web",
      });
    } catch {
      throw statusError(401, "Authentication required");
    }
    if (!mongoose.isValidObjectId(p.sub))
      throw statusError(401, "Authentication required");
    const u = await User.findById(p.sub);
    if (!u?.active || u.version !== p.version)
      throw statusError(401, "Authentication required");
    if (
      p.family &&
      !(await SessionFamily.exists({
        _id: p.family,
        user: u._id,
        revoked: false,
        expires: { $gt: new Date() },
      }))
    )
      throw statusError(401, "Session expired");
    req.user = u;
    next();
  } catch (e) {
    next(e);
  }
};
function access(u: any, family: string) {
  return jwt.sign({ version: u.version, family }, secret(), {
    subject: u.id,
    expiresIn: "10m",
    issuer: "markethub",
    audience: "markethub-web",
  });
}
async function createSession(u: any, session: ClientSession, family: string) {
  const raw = token();
  await Session.create(
    [
      {
        user: u._id,
        hash: hashToken(raw),
        family,
        expires: new Date(Date.now() + 7 * 86400000),
      },
    ],
    { session },
  );
  return raw;
}
export async function revokeUser(
  user: mongoose.Types.ObjectId,
  session: ClientSession,
) {
  await SessionFamily.updateMany(
    { user },
    { $set: { revoked: true } },
    { session },
  );
  await Session.deleteMany({ user }, { session });
}
export async function sendAction(
  u: any,
  kind: "verify-email" | "reset-password",
) {
  if (!process.env.SMTP_HOST || !process.env.MAIL_FROM)
    throw statusError(503, "Email delivery is not configured");
  const raw = token();
  const hash = hashToken(raw);
  await Action.create({
    user: u._id,
    hash,
    kind,
    expires: new Date(Date.now() + 3600000),
  });
  try {
    await createMailTransport().sendMail({
      from: process.env.MAIL_FROM,
      to: u.email,
      subject: `MarketHub ${kind}`,
      text: `${clientOrigin()}/${kind}?token=${raw}`,
    });
  } catch {
    await Action.deleteOne({ hash }).catch(() => {});
    throw statusError(
      503,
      "Email could not be delivered. Please try again later.",
    );
  }
}
authentication.post("/auth/register", async (req, res) => {
  const v = credentials
    .extend({ name: z.string().trim().min(2).max(80) })
    .parse(req.body);
  const u = await User.create({
    ...v,
    password: await bcrypt.hash(v.password, 12),
  });
  res.status(201).json({
    user: profile(u),
    message: "Account created. Request email verification before signing in.",
  });
});
authentication.post("/auth/login", async (req, res) => {
  const v = credentials.parse(req.body);
  const u = await User.findOne({ email: v.email }).select("+password");
  const valid = await bcrypt.compare(
    v.password,
    u?.password ||
      "$2b$12$C6UzMDM.H6dfI/f/IKcEe.5TP3EiVCnOcYjzNSUpS6V8CxK7bV72K",
  );
  if (!u || !valid || !u.active) throw statusError(401, "Invalid credentials");
  if (!u.verified) throw statusError(403, "Verify your email first");
  const family = token();
  let raw = "";
  await mongoose.connection.transaction(async (session) => {
    const live = await User.findOne({
      _id: u._id,
      active: true,
      verified: true,
      version: u.version,
    }).session(session);
    if (!live) throw statusError(401, "Account changed");
    await User.updateOne(
      { _id: u._id, version: u.version },
      { $inc: { __v: 1 } },
      { session },
    );
    await SessionFamily.create(
      [
        {
          _id: family,
          user: u._id,
          expires: new Date(Date.now() + 7 * 86400000),
        },
      ],
      { session },
    );
    raw = await createSession(u, session, family);
  });
  res
    .cookie("refresh", raw, cookieOptions())
    .json({ user: profile(u), accessToken: access(u, family) });
});
authentication.post("/auth/refresh", async (req, res) => {
  const raw = req.cookies.refresh;
  if (typeof raw !== "string" || !/^[a-f0-9]{64}$/.test(raw))
    throw statusError(401, "Invalid session");
  let result: { raw: string; accessToken: string } | null = null;
  await mongoose.connection.transaction(async (session) => {
    const old = await Session.findOne({ hash: hashToken(raw) }).session(
      session,
    );
    if (!old) return;
    const family = await SessionFamily.findOneAndUpdate(
      { _id: old.family, revoked: false, expires: { $gt: new Date() } },
      { $inc: { revision: 1 } },
      { new: true, session },
    );
    if (!family) return;
    if (old.used || !old.expires || old.expires <= new Date()) {
      family.revoked = true;
      await family.save({ session });
      return;
    }
    const u = await User.findById(old.user).session(session);
    if (!u?.active || !u.verified) {
      family.revoked = true;
      await family.save({ session });
      return;
    }
    old.used = true;
    await old.save({ session });
    result = {
      raw: await createSession(u, session, old.family),
      accessToken: access(u, old.family),
    };
  });
  if (!result) {
    res.clearCookie("refresh", cookieOptions());
    throw statusError(401, "Invalid session");
  }
  const issued = result as { raw: string; accessToken: string };
  res
    .cookie("refresh", issued.raw, cookieOptions())
    .json({ accessToken: issued.accessToken });
});
authentication.post("/auth/logout", async (req, res) => {
  const raw = req.cookies.refresh;
  if (typeof raw === "string" && /^[a-f0-9]{64}$/.test(raw))
    await mongoose.connection.transaction(async (session) => {
      const s = await Session.findOne({ hash: hashToken(raw) }).session(
        session,
      );
      if (s) {
        await SessionFamily.updateOne(
          { _id: s.family },
          { $set: { revoked: true } },
          { session },
        );
        await Session.deleteMany({ family: s.family }, { session });
      }
    });
  res.clearCookie("refresh", cookieOptions()).status(204).end();
});
for (const kind of ["verify-email", "reset-password"] as const) {
  authentication.post("/auth/request-" + kind, async (req, res) => {
    const { email } = z
      .object({
        email: z
          .email()
          .max(254)
          .transform((v) => v.toLowerCase()),
      })
      .strict()
      .parse(req.body);
    if (!process.env.SMTP_HOST || !process.env.MAIL_FROM)
      throw statusError(503, "Email delivery is not configured");
    const u = await User.findOne({ email, active: true });
    if (u && (kind !== "verify-email" || !u.verified))
      await sendAction(u, kind);
    res.json({ message: "If eligible, an email has been sent." });
  });
  authentication.post("/auth/" + kind, async (req, res) => {
    const v = z
      .object({
        token: z.string().regex(/^[a-f0-9]{64}$/),
        password:
          kind === "reset-password" ? passwordSchema : z.undefined().optional(),
      })
      .strict()
      .parse(req.body);
    const hashed =
      kind === "reset-password"
        ? await bcrypt.hash(v.password!, 12)
        : undefined;
    await mongoose.connection.transaction(async (session) => {
      const a = await Action.findOneAndDelete({
        hash: hashToken(v.token),
        kind,
        expires: { $gt: new Date() },
      }).session(session);
      if (!a) throw statusError(400, "Invalid or expired token");
      const u = await User.findOne({ _id: a.user, active: true })
        .select("+password")
        .session(session);
      if (!u) throw statusError(400, "Invalid or expired token");
      if (kind === "verify-email") u.verified = true;
      else {
        u.password = hashed!;
        u.version++;
        await revokeUser(u._id, session);
      }
      await u.save({ session });
      await Action.deleteMany({ user: a.user, kind }, { session });
    });
    res.json({ message: "Success" });
  });
}
authentication.get("/users/me", auth, (req: any, res) =>
  res.json({ user: profile(req.user) }),
);
authentication.patch("/users/me", auth, async (req: any, res) => {
  const { name } = z
    .object({ name: z.string().trim().min(2).max(80) })
    .strict()
    .parse(req.body);
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $set: { name } },
    { new: true, runValidators: true },
  );
  if (!user?.active) throw statusError(401, "Authentication required");
  res.json({ user: profile(user) });
});
authentication.post("/users/me/password", auth, async (req: any, res) => {
  const v = z
    .object({ currentPassword: passwordSchema, newPassword: passwordSchema })
    .strict()
    .parse(req.body);
  await mongoose.connection.transaction(async (session) => {
    const u = await User.findById(req.user._id)
      .select("+password")
      .session(session);
    if (!u || !(await bcrypt.compare(v.currentPassword, u.password)))
      throw statusError(400, "Current password is incorrect");
    u.password = await bcrypt.hash(v.newPassword, 12);
    u.version++;
    await u.save({ session });
    await revokeUser(u._id, session);
    await Action.deleteMany(
      { user: u._id, kind: "reset-password" },
      { session },
    );
  });
  res.clearCookie("refresh", cookieOptions()).status(204).end();
});
authentication.delete("/users/me", auth, async (req: any, res) => {
  const { password } = z
    .object({ password: passwordSchema })
    .strict()
    .parse(req.body);
  if (req.user.role === "admin")
    throw statusError(
      403,
      "Administrator accounts require separate account governance",
    );
  await mongoose.connection.transaction(async (session) => {
    const u = await User.findById(req.user._id)
      .select("+password")
      .session(session);
    if (!u || !(await bcrypt.compare(password, u.password)))
      throw statusError(400, "Password is incorrect");
    u.active = false;
    u.version++;
    await u.save({ session });
    await revokeUser(u._id, session);
    await Action.deleteMany({ user: u._id }, { session });
    await SellerApplication.updateOne(
      { user: u._id, status: "approved" },
      {
        $set: { status: "suspended", reason: "Account deactivated" },
        $inc: { __v: 1 },
      },
      { session },
    );
    await Product.updateMany(
      { seller: u._id },
      { $set: { active: false }, $inc: { __v: 1 } },
      { session },
    );
  });
  res.clearCookie("refresh", cookieOptions()).status(204).end();
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 0 },
}).single("image");
authentication.post(
  "/users/me/avatar",
  auth,
  (req, res, next) =>
    upload(req, res, (e) =>
      e ? next(statusError(400, "Upload one image of at most 4 MB")) : next(),
    ),
  async (req: any, res) => {
    if (!req.file || !imageFormat(req.file.buffer))
      throw statusError(400, "Only PNG, JPEG, and WebP images are allowed");
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    )
      throw statusError(503, "Image storage is not configured");
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    const image = await new Promise<{ secure_url: string; public_id: string }>(
      (resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: `markethub/avatars/${req.user.id}`,
            resource_type: "image",
            allowed_formats: ["jpg", "png", "webp"],
            transformation: [{ width: 320, height: 320, crop: "fill" }],
          },
          (err, r) =>
            err || !r
              ? reject(statusError(502, "Image upload failed"))
              : resolve(r),
        );
        stream.end(req.file.buffer);
      },
    );
    try {
      const user = await User.findOneAndUpdate(
        { _id: req.user._id, active: true },
        { $set: { avatar: image.secure_url } },
        { new: true },
      );
      if (!user) throw statusError(401, "Account unavailable");
      res.json({ user: profile(user) });
    } catch (e) {
      await cloudinary.uploader.destroy(image.public_id).catch(() => {});
      throw e;
    }
  },
);
