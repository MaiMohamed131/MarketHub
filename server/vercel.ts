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
  } catch (error: any) {
    // Log diagnostic codes only; never log connection strings or credentials.
    const servers = error?.reason?.servers;
    console.error("MarketHub database connection failed", {
      name: error?.name,
      code: error?.code,
      networkCodes:
        servers instanceof Map
          ? [...servers.values()]
              .map(
                (server: any) =>
                  server.error?.cause?.code ||
                  server.error?.code ||
                  server.error?.name,
              )
              .filter(Boolean)
          : [],
    });
    connecting = undefined;
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Service temporarily unavailable" }));
  }
}
