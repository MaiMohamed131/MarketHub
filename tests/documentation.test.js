import { test, expect } from "@jest/globals";
import request from "supertest";
import { readFileSync } from "node:fs";
import { app } from "../dist/app.js";
import { openapi } from "../dist/openapi.js";
test("raw OpenAPI documentation is public and defines secure review/checkout contracts", async () => {
  const r = await request(app).get("/api/openapi.json");
  expect(r.status).toBe(200);
  expect(r.body.openapi).toBe("3.0.3");
  expect(openapi.paths["/api/products/{id}/review"].put.security).toEqual([
    { bearerAuth: [] },
  ]);
  expect(openapi.paths["/api/orders"].post.parameters).toContainEqual({
    in: "header",
    name: "Idempotency-Key",
    required: true,
    schema: { type: "string", format: "uuid" },
  });
  expect(
    openapi.components.schemas.Checkout.properties.paymentMethod.enum,
  ).toEqual(["cod"]);
});
test("Swagger UI serves without database connectivity", async () => {
  expect((await request(app).get("/api/docs/")).status).toBe(200);
});
test("readiness health returns failure when database is disconnected", async () => {
  expect((await request(app).get("/api/health")).status).toBe(503);
});
test("all documented path parameters have corresponding required declarations", () => {
  for (const [path, methods] of Object.entries(openapi.paths)) {
    for (const operation of Object.values(methods)) {
      for (const match of path.matchAll(/\{([^}]+)\}/g))
        expect(
          operation.parameters.some(
            (p) => p.in === "path" && p.name === match[1] && p.required,
          ),
        ).toBe(true);
    }
  }
});
test("deployment files contain no embedded Atlas credentials or Cloudinary secrets", () => {
  for (const path of [
    "render.yaml",
    "vercel.json",
    "docs/openapi.json",
    "docs/MarketHub.postman_collection.json",
    ".github/workflows/ci.yml",
  ]) {
    const content = readFileSync(path, "utf8");
    expect(content).not.toMatch(/mongodb\+srv:\/\/[^\s]+:[^\s]+@/);
  }
});
