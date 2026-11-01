import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase } from "./db.js";
import { Media } from "./seller-models.js";
import { cleanupImages } from "./media-lifecycle.js";
if (process.env.ALLOW_MEDIA_CLEANUP !== "true")
  throw Error(
    "Set ALLOW_MEDIA_CLEANUP=true to delete unreferenced MarketHub images.",
  );
try {
  await connectDatabase();
  const assets = await Media.find({
    publicId: { $regex: "^markethub/" },
    $or: [
      { status: "deleting" },
      { createdAt: { $lt: new Date(Date.now() - 24 * 3600000) } },
    ],
  })
    .select("url")
    .limit(100)
    .lean();
  const results = await cleanupImages(assets.map((a) => a.url));
  console.log(
    JSON.stringify({
      checked: results.length,
      deleted: results.filter((r) => r.status === "deleted").length,
      pending: results.filter((r) => r.status === "pending").length,
    }),
  );
} finally {
  await mongoose.disconnect();
}
