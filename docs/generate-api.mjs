import fs from "node:fs";
const paths = {};
for (const [file, base] of [
  ["app", ""],
  ["auth", "/api"],
  ["catalog", "/api"],
  ["commerce", "/api"],
  ["seller", "/api"],
  ["admin", "/api/admin"],
  ["community", "/api"],
]) {
  const source = fs.readFileSync("server/" + file + ".ts", "utf8");
  for (const m of source.matchAll(
    /(?:app|authentication|catalog|commerce|sellers|admin|publicCommunity|community)\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']\s*,/g,
  )) {
    const method = m[1],
      path = (base + m[2]).replace(/:([A-Za-z]+)/g, "{$1}");
    const pub =
      path.includes("/auth/") ||
      path === "/api/health" ||
      path === "/api/openapi.json" ||
      (method === "get" &&
        (path === "/api/products" ||
          path === "/api/categories" ||
          path === "/api/products/{id}" ||
          path === "/api/products/{id}/reviews"));
    const params = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
    }));
    paths[path] ??= {};
    paths[path][method] = {
      summary: method.toUpperCase() + " " + path,
      tags: [
        path.includes("/admin")
          ? "Administration"
          : path.includes("/seller")
            ? "Sellers"
            : path.includes("/auth")
              ? "Authentication"
              : path.includes("review")
                ? "Reviews"
                : path.includes("notification")
                  ? "Notifications"
                  : path.includes("order")
                    ? "Orders"
                    : "Catalog & shopping",
      ],
      security: pub ? [] : [{ bearerAuth: [] }],
      parameters: params,
      responses: {
        [method === "delete" ? "204" : "200"]: {
          description: "Successful response",
        },
        400: { description: "Invalid input" },
        401: { description: "Authentication required" },
        403: { description: "Insufficient permission" },
        404: { description: "Resource not found" },
        409: { description: "Conflict or stale state" },
        503: { description: "Dependency unavailable" },
      },
    };
  }
}
for (const kind of ["verify-email", "reset-password"])
  for (const path of ["/api/auth/request-" + kind, "/api/auth/" + kind])
    paths[path] = {
      post: {
        summary: path,
        security: [],
        responses: {
          200: { description: "Success" },
          400: { description: "Invalid or expired token" },
          503: { description: "SMTP unavailable" },
        },
      },
    };
const string = { type: "string" },
  integer = { type: "integer" };
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const schemas = {
  Credentials: object({
    email: { type: "string", format: "email" },
    password: { type: "string", minLength: 12, maxLength: 72 },
  }),
  Address: object(
    {
      name: string,
      email: { type: "string", format: "email" },
      phone: string,
      line1: string,
      line2: string,
      city: string,
      postalCode: string,
      country: { type: "string", enum: ["US"] },
    },
    ["name", "email", "phone", "line1", "city", "postalCode", "country"],
  ),
  Checkout: object({
    address: { $ref: "#/components/schemas/Address" },
    paymentMethod: { type: "string", enum: ["cod"] },
    revision: integer,
    expectedTotal: { type: "integer", minimum: 0 },
  }),
  Review: object({
    order: string,
    rating: { type: "integer", minimum: 1, maximum: 5 },
    comment: { type: "string", minLength: 3, maxLength: 2000 },
  }),
  Application: object({
    storeName: string,
    description: { type: "string", minLength: 30, maxLength: 2000 },
    email: { type: "string", format: "email" },
    phone: string,
  }),
  Product: object({
    name: string,
    description: string,
    price: { type: "integer", minimum: 1, description: "USD cents" },
    stock: { type: "integer", minimum: 0 },
    category: string,
    images: {
      type: "array",
      items: { type: "string", format: "uri" },
      maxItems: 8,
    },
    active: { type: "boolean" },
  }),
  Category: object({
    name: string,
    slug: string,
    description: string,
    image: string,
    active: { type: "boolean" },
  }),
};
const body = (path, method, schema) => {
  if (paths[path]?.[method])
    paths[path][method].requestBody = {
      required: true,
      content: {
        "application/json": {
          schema:
            typeof schema === "string"
              ? { $ref: "#/components/schemas/" + schema }
              : schema,
        },
      },
    };
};
body("/api/auth/login", "post", "Credentials");
body(
  "/api/auth/register",
  "post",
  object({ ...schemas.Credentials.properties, name: string }),
);
body("/api/orders", "post", "Checkout");
paths["/api/orders"].post.parameters.push({
  in: "header",
  name: "Idempotency-Key",
  required: true,
  schema: { type: "string", format: "uuid" },
});
body("/api/products/{id}/review", "put", "Review");
body("/api/seller/application", "post", "Application");
body("/api/seller/manage/products", "post", "Product");
body(
  "/api/seller/manage/products/{id}",
  "patch",
  object({
    ...Object.fromEntries(
      Object.entries(schemas.Product.properties).filter(([k]) => k !== "stock"),
    ),
    version: integer,
  }),
);
body(
  "/api/seller/manage/products/{id}/inventory",
  "post",
  object({ delta: integer, expectedStock: integer }),
);
body(
  "/api/cart/items/{id}",
  "put",
  object({
    quantity: { type: "integer", minimum: 1, maximum: 99 },
    revision: integer,
  }),
);
body(
  "/api/seller/orders/{id}/groups/{groupId}",
  "patch",
  object({
    status: {
      type: "string",
      enum: ["confirmed", "processing", "shipped", "delivered"],
    },
  }),
);
body(
  "/api/admin/users/{id}/active",
  "patch",
  object({ active: { type: "boolean" }, reason: string }),
);
body(
  "/api/admin/products/{id}",
  "patch",
  object({ active: { type: "boolean" }, version: integer, reason: string }),
);
body("/api/admin/products/{id}", "delete", object({ reason: string }));
body("/api/admin/categories", "post", "Category");
body(
  "/api/admin/categories/{id}",
  "patch",
  object({ ...schemas.Category.properties, version: integer }),
);
body(
  "/api/admin/orders/{id}/disputes",
  "post",
  object({ subject: string, notes: string }),
);
body(
  "/api/admin/orders/{id}/disputes/{disputeId}",
  "patch",
  object({ notes: string }),
);
body(
  "/api/admin/seller-applications/{id}",
  "patch",
  object({
    status: { type: "string", enum: ["approved", "rejected", "suspended"] },
    reason: string,
  }),
);
body("/api/users/me", "patch", object({ name: string }));
body("/api/users/me", "delete", object({ password: string }));
body(
  "/api/users/me/password",
  "post",
  object({ currentPassword: string, newPassword: string }),
);
for (const kind of ["verify-email", "reset-password"]) {
  body(
    "/api/auth/request-" + kind,
    "post",
    object({ email: { type: "string", format: "email" } }),
  );
  body(
    "/api/auth/" + kind,
    "post",
    object({
      token: string,
      ...(kind === "reset-password" ? { password: string } : {}),
    }),
  );
}
for (const path of [
  "/api/admin/images",
  "/api/seller/manage/images",
  "/api/users/me/avatar",
])
  paths[path].post.requestBody = {
    required: true,
    content: {
      "multipart/form-data": {
        schema: object({
          image: {
            type: "string",
            format: "binary",
            description: "PNG/JPEG/WebP, maximum 5 MB",
          },
        }),
      },
    },
  };
const query = (path, name, schema) => {
  if (paths[path]?.get)
    paths[path].get.parameters.push({ in: "query", name, schema });
};
for (const path of Object.keys(paths).filter((p) =>
  [
    "/api/products",
    "/api/reviews/mine",
    "/api/notifications",
    "/api/orders",
    "/api/admin/users",
    "/api/admin/products",
    "/api/admin/sellers",
    "/api/admin/orders",
    "/api/admin/seller-applications",
    "/api/seller/manage/products",
    "/api/products/{id}/reviews",
  ].includes(p),
))
  query(path, "page", { type: "integer", minimum: 1, default: 1 });
for (const path of [
  "/api/products",
  "/api/admin/users",
  "/api/admin/products",
  "/api/admin/sellers",
  "/api/admin/orders",
  "/api/seller/manage/products",
])
  query(path, "q", { type: "string", maxLength: 100 });
for (const key of [
  "category",
  "minPrice",
  "maxPrice",
  "sort",
  "featured",
  "limit",
])
  query("/api/products", key, { type: "string" });
query("/api/products", "brand", { type: "string", maxLength: 80 });
query("/api/products", "minRating", { type: "number", minimum: 0, maximum: 5 });
query("/api/products", "inStock", { type: "string", enum: ["true", "false"] });
query("/api/products", "deals", { type: "string", enum: ["true", "false"] });
query("/api/notifications", "unread", {
  type: "string",
  enum: ["true", "false"],
});
for (const path of ["/api/admin/sellers", "/api/admin/orders"])
  query(path, "status", string);
query("/api/admin/users", "role", string);
query("/api/admin/users", "active", string);
query("/api/admin/products", "active", string);
query("/api/admin/products", "seller", string);
query("/api/admin/products", "category", string);
query("/api/seller/manage/products", "low", string);
body(
  "/api/seller/manage/images",
  "delete",
  object({ url: { type: "string", format: "uri" } }),
);
const spec = {
  openapi: "3.0.3",
  info: {
    title: "MarketHub API",
    version: "0.6.0",
    description:
      "Portfolio marketplace. Phase 1 remains deferred. Amounts are integer USD cents except catalog price filters, which are USD decimal strings. Atlas integration and live service verification remain pending. See README for response contracts and operational limits.",
  },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas,
  },
  paths,
};
fs.writeFileSync("docs/openapi.json", JSON.stringify(spec, null, 2));
const items = Object.entries(paths).flatMap(([p, methods]) =>
  Object.keys(methods).map((method) => ({
    name: method.toUpperCase() + " " + p,
    request: {
      method: method.toUpperCase(),
      header: [],
      url: {
        raw: "{{baseUrl}}" + p.replace(/\{([^}]+)\}/g, ":$1"),
        host: ["{{baseUrl}}"],
        path: p
          .slice(1)
          .replace(/\{([^}]+)\}/g, ":$1")
          .split("/"),
      },
      auth: methods[method].security?.length
        ? {
            type: "bearer",
            bearer: [
              { key: "token", value: "{{accessToken}}", type: "string" },
            ],
          }
        : { type: "noauth" },
    },
  })),
);
fs.writeFileSync(
  "docs/MarketHub.postman_collection.json",
  JSON.stringify(
    {
      info: {
        name: "MarketHub API",
        schema:
          "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      variable: [
        { key: "baseUrl", value: "http://localhost:4000" },
        { key: "accessToken", value: "" },
      ],
      item: items,
    },
    null,
    2,
  ),
);

// Product draft-image discard uses the URL returned by the upload endpoint.
