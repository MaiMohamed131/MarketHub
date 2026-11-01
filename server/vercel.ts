import type { Request, Response } from "express";
import mongoose from "mongoose";
import { app } from "./app.js";
import { connectDatabase } from "./db.js";

let connecting: Promise<void> | undefined;

// Reuse the MongoDB connection across requests in a warm Vercel function.
export default async function handler(req: Request, res: Response) {
  try {
    if (mongoose.connection.readyState !== 1) {
      connecting ??= connectDatabase().catch((error) => {
        connecting = undefined;
        throw error;
      });
      await connecting;
      connecting = undefined;
    }
    app(req, res);
  } catch {
    connecting = undefined;
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Service temporarily unavailable" }));
  }
}
