import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase } from "./db.js";
import "./models.js";
import "./catalog-models.js";
import "./commerce-models.js";
import "./seller-models.js";
import "./admin-models.js";
import "./community-models.js";
if (process.env.ALLOW_CREATE_INDEXES !== "true")
  throw Error(
    "Set ALLOW_CREATE_INDEXES=true to explicitly create declared indexes. Existing indexes are never dropped.",
  );
try {
  await connectDatabase();
  for (const model of Object.values(mongoose.models))
    await model.createIndexes();
  console.log("Declared indexes created. Existing indexes were not dropped.");
} catch {
  console.error(
    "Index creation failed. Check connectivity, permissions, and duplicate records manually. No automatic data repair was attempted.",
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
