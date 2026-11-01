import type { ClientSession, Types } from "mongoose";
import { Media } from "./seller-models.js";
import { Product, Category } from "./catalog-models.js";
import { Order } from "./commerce-models.js";
import { destroyProjectImage } from "./cloudinary.js";
import { conflict } from "./commerce-service.js";
export async function claimProductImages(
  urls: string[],
  seller: Types.ObjectId,
  session: ClientSession,
) {
  if (!urls.length) return;
  const result = await Media.updateMany(
    { seller, url: { $in: urls }, status: { $ne: "deleting" } },
    { $inc: { __v: 1 } },
    { session },
  );
  if (result.matchedCount !== urls.length)
    throw conflict("An image is unavailable. Upload it again before saving.");
}
export async function cleanupImages(urls: string[], seller?: Types.ObjectId) {
  const outcomes: { url: string; status: string }[] = [];
  for (const url of new Set(urls)) {
    try {
      const media = await Media.findOneAndUpdate(
        {
          url,
          ...(seller ? { seller } : {}),
          publicId: { $regex: "^markethub/" },
        },
        { $set: { status: "deleting" } },
        { returnDocument: "after" },
      );
      if (!media) continue;
      try {
        const referenced =
          (await Product.exists({ images: url, deleted: { $ne: true } })) ||
          (await Category.exists({ image: url })) ||
          (await Order.exists({ "groups.items.image": url }));
        if (referenced) {
          await Media.updateOne(
            { _id: media._id },
            { $set: { status: "ready" }, $unset: { cleanupError: 1 } },
          );
          outcomes.push({ url, status: "retained" });
          continue;
        }
        await destroyProjectImage(media.publicId);
        await Media.deleteOne({ _id: media._id, status: "deleting" });
        outcomes.push({ url, status: "deleted" });
      } catch {
        await Media.updateOne(
          { _id: media._id },
          {
            $set: {
              status: "deleting",
              cleanupError: "Cleanup failed; retry required",
            },
          },
        ).catch(() => {});
        outcomes.push({ url, status: "pending" });
      }
    } catch {
      outcomes.push({ url, status: "pending" });
    }
  }
  return outcomes;
}
