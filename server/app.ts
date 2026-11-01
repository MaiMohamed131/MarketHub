import { clientOrigin } from "./environment.js";
import { auth, authentication } from "./auth.js";
import swaggerUi from "swagger-ui-express";
import { openapi } from "./openapi.js";
import { community, publicCommunity } from "./community.js";
import { admin } from "./admin.js";
import { sellers } from "./seller.js";
import { commerce } from "./commerce.js";
import { catalog } from "./catalog.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";

import { z } from "zod";

import mongoose from "mongoose";

const fail = (status: number, message: string) =>
  Object.assign(new Error(message), { status });
export const app = express();
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.use(
  helmet(),
  cors({
    origin: clientOrigin(),
    credentials: true,
  }),
  express.json({ limit: "32kb" }),
  cookieParser(),
);
app.use("/api", rateLimit({ windowMs: 60000, limit: 100 }));
app.get("/api/openapi.json", (_req, res) => res.json(openapi));
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapi));

app.use("/api/auth", rateLimit({ windowMs: 15 * 60000, limit: 50 }));
app.use((req, res, next) => {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers.origin &&
    req.headers.origin !== clientOrigin()
  )
    return next(fail(403, "Origin not allowed"));
  next();
});
app.get("/api/health", (_q, r) =>
  r.status(mongoose.connection.readyState === 1 ? 200 : 503).json({
    status: mongoose.connection.readyState === 1 ? "ready" : "unavailable",
  }),
);
app.use("/api", authentication);
app.use("/api", publicCommunity);
app.use("/api", catalog);
app.use("/api", (req, res, next) => {
  if (
    req.path.startsWith("/notifications") ||
    req.path === "/reviews/mine" ||
    /^\/products\/[^/]+\/review$/.test(req.path)
  )
    return auth(req, res, (error?: unknown) =>
      error ? next(error) : community(req, res, next),
    );
  next();
});
app.use("/api/admin", auth, admin);
app.use("/api", auth, sellers);
app.use("/api", auth, commerce);
app.use((_q, _r, next) => next(fail(404, "Not found")));
app.use((err: any, _req: any, res: any, _next: any) => {
  const status =
    err instanceof z.ZodError
      ? 400
      : err.code === 11000
        ? 409
        : err.name === "VersionError"
          ? 409
          : err.name?.startsWith("Mongo") ||
              err.message?.includes("bufferCommands = false")
            ? 503
            : err.status || 500;
  res.status(status).json({
    error:
      status === 500
        ? "Internal server error"
        : status === 503
          ? "Service temporarily unavailable"
          : status === 409
            ? err.code === 11000
              ? "A record already exists"
              : err.message
            : err instanceof z.ZodError
              ? "Invalid input"
              : err.message,
  });
});
