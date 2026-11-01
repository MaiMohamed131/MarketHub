import { v2 as cloudinary } from "cloudinary";
import { statusError } from "./seller-validation.js";
export function configuredCloudinary() {
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME?.trim(),
    api_key = process.env.CLOUDINARY_API_KEY?.trim(),
    api_secret = process.env.CLOUDINARY_API_SECRET?.trim();
  if (!cloud_name || !api_key || !api_secret)
    throw statusError(503, "Image storage is not configured");
  cloudinary.config({ cloud_name, api_key, api_secret, secure: true });
  return cloudinary;
}
export async function destroyProjectImage(publicId: string) {
  if (!publicId.startsWith("markethub/") || publicId.includes(".."))
    throw statusError(400, "Image does not belong to MarketHub");
  const result = await configuredCloudinary().uploader.destroy(publicId, {
    resource_type: "image",
    invalidate: true,
  });
  if (!["ok", "not found"].includes(result.result))
    throw statusError(502, "Image deletion failed");
}
