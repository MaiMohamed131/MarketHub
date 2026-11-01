import { readFileSync } from "node:fs";
export const openapi = JSON.parse(
  readFileSync(new URL("../docs/openapi.json", import.meta.url), "utf8"),
);
