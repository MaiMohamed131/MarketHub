import { test, expect, jest, afterEach } from "@jest/globals";
import request from "supertest";
import express from "express";
import mongoose from "mongoose";
import handler from "../dist/vercel.js";
import { clientOrigin } from "../dist/environment.js";
import { Product } from "../dist/catalog-models.js";
const oldUri = process.env.MONGODB_URI;
const oldOrigin = process.env.CLIENT_ORIGIN;
const oldDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL;
afterEach(() => {
  if(oldUri===undefined)delete process.env.MONGODB_URI;else process.env.MONGODB_URI=oldUri;
  mongoose.connection._readyState = 0;
  jest.restoreAllMocks();
  if (oldOrigin === undefined) delete process.env.CLIENT_ORIGIN;
  else process.env.CLIENT_ORIGIN = oldOrigin;
  if (oldDomain === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  else process.env.VERCEL_PROJECT_PRODUCTION_URL = oldDomain;
});
test("production links use the explicit origin or Vercel production domain", () => {
  delete process.env.CLIENT_ORIGIN;
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "markethub.vercel.app";
  expect(clientOrigin()).toBe("https://markethub.vercel.app");
  process.env.CLIENT_ORIGIN = "https://shop.example.com/";
  expect(clientOrigin()).toBe("https://shop.example.com");
  delete process.env.CLIENT_ORIGIN;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  expect(clientOrigin()).toBe("http://localhost:5173");
});
test("Vercel handler preserves existing API routes with a warm database connection", async () => {
  mongoose.connection._readyState = 1;
  const app = express().use(handler);
  expect((await request(app).get("/api/health")).body).toEqual({
    status: "ready",
  });
  expect((await request(app).get("/api/products?sort=invalid")).status).toBe(
    400,
  );
  expect((await request(app).get("/api/cart")).status).toBe(401);
});
test("cold-start database failure returns a generic response and retries next request", async () => {
  process.env.MONGODB_URI = "mongodb://not-used";
  const connect = jest
    .spyOn(mongoose, "connect")
    .mockRejectedValue(Error("sensitive database information"));
  const app = express().use(handler);
  for (let i = 0; i < 2; i++) {
    const r = await request(app).get("/api/health");
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: "Service temporarily unavailable" });
  }
  expect(connect).toHaveBeenCalledTimes(2);
  delete process.env.MONGODB_URI;
});

test("Vercel query metadata cannot replace the original URL filters", async () => {
  mongoose.connection._readyState = 1;
  const find = jest.spyOn(Product, "find").mockImplementation(() => {
    throw Error("Invalid URL filters must fail before reading products");
  });
  const server = express().use((req, res, next) => {
    Object.defineProperty(req, "query", { configurable: true, writable: true,
      value: { path: "products", sort: "newest" } });
    next();
  }).use(handler);
  const response = await request(server).get("/api/products?sort=invalid");
  expect(response.status).toBe(400);
  expect(find).not.toHaveBeenCalled();
});
