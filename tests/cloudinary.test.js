import { test, expect, jest, afterEach } from "@jest/globals";
import { v2 as cloudinary } from "cloudinary";
import { Types } from "mongoose";
import { Media } from "../dist/seller-models.js";
import { Product, Category } from "../dist/catalog-models.js";
import { Order } from "../dist/commerce-models.js";
import {
  configuredCloudinary,
  destroyProjectImage,
} from "../dist/cloudinary.js";
import { claimProductImages, cleanupImages } from "../dist/media-lifecycle.js";
const seller = new Types.ObjectId(),
  id = new Types.ObjectId(),
  url =
    "https://res.cloudinary.com/test/image/upload/markethub/products/test.png";
const saved = { ...process.env };
afterEach(() => {
  jest.restoreAllMocks();
  for (const key of [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});
function config() {
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
}
function media() {
  jest
    .spyOn(Media, "findOneAndUpdate")
    .mockResolvedValue({ _id: id, publicId: "markethub/products/test", url });
  jest.spyOn(Media, "updateOne").mockResolvedValue({});
  jest.spyOn(Media, "deleteOne").mockResolvedValue({});
  jest.spyOn(Product, "exists").mockResolvedValue(null);
  jest.spyOn(Category, "exists").mockResolvedValue(null);
  jest.spyOn(Order, "exists").mockResolvedValue(null);
}
test("missing credentials fail without configuring SDK", () => {
  delete process.env.CLOUDINARY_API_SECRET;
  expect(() => configuredCloudinary()).toThrow(
    "Image storage is not configured",
  );
});
test("SDK credentials come exclusively from backend environment", () => {
  config();
  const spy = jest.spyOn(cloudinary, "config");
  configuredCloudinary();
  expect(spy).toHaveBeenCalledWith({
    cloud_name: "test-cloud",
    api_key: "test-key",
    api_secret: "test-secret",
    secure: true,
  });
});
test("deletion rejects assets outside the project namespace", async () => {
  const spy = jest.spyOn(cloudinary.uploader, "destroy");
  await expect(destroyProjectImage("old-project/photo")).rejects.toMatchObject({
    status: 400,
  });
  expect(spy).not.toHaveBeenCalled();
});
test("unreferenced owned asset is destroyed and metadata deleted", async () => {
  config();
  media();
  jest
    .spyOn(cloudinary.uploader, "destroy")
    .mockResolvedValue({ result: "ok" });
  expect(await cleanupImages([url], seller)).toEqual([
    { url, status: "deleted" },
  ]);
  expect(Media.findOneAndUpdate.mock.calls[0][0].seller).toEqual(seller);
  expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(
    "markethub/products/test",
    { resource_type: "image", invalidate: true },
  );
  expect(Media.deleteOne).toHaveBeenCalled();
});
test("shared images remain while another product still references them", async () => {
  media();
  Product.exists.mockResolvedValue({ _id: id });
  const destroy = jest.spyOn(cloudinary.uploader, "destroy");
  expect(await cleanupImages([url], seller)).toEqual([
    { url, status: "retained" },
  ]);
  expect(destroy).not.toHaveBeenCalled();
  expect(Media.deleteOne).not.toHaveBeenCalled();
});
test("order-history image snapshots are retained", async () => {
  media();
  Order.exists.mockResolvedValue({ _id: id });
  const destroy = jest.spyOn(cloudinary.uploader, "destroy");
  expect(await cleanupImages([url], seller)).toEqual([
    { url, status: "retained" },
  ]);
  expect(destroy).not.toHaveBeenCalled();
});
test("Cloudinary failure retains retryable metadata rather than losing the asset ID", async () => {
  config();
  media();
  jest
    .spyOn(cloudinary.uploader, "destroy")
    .mockRejectedValue(Error("Cloud service unavailable"));
  expect(await cleanupImages([url], seller)).toEqual([
    { url, status: "pending" },
  ]);
  expect(Media.deleteOne).not.toHaveBeenCalled();
  expect(Media.updateOne.mock.calls.at(-1)[1].$set.status).toBe("deleting");
});
test("already-deleted cloud asset is an idempotent cleanup success", async () => {
  config();
  jest
    .spyOn(cloudinary.uploader, "destroy")
    .mockResolvedValue({ result: "not found" });
  await expect(
    destroyProjectImage("markethub/products/test"),
  ).resolves.toBeUndefined();
});
test("image attachment locks owned metadata in product transaction", async () => {
  jest.spyOn(Media, "updateMany").mockResolvedValue({ matchedCount: 1 });
  await claimProductImages([url], seller, {});
  expect(Media.updateMany.mock.calls[0][0]).toEqual({
    seller,
    url: { $in: [url] },
    status: { $ne: "deleting" },
  });
  expect(Media.updateMany.mock.calls[0][2]).toEqual({ session: {} });
  Media.updateMany.mockResolvedValue({ matchedCount: 0 });
  await expect(claimProductImages([url], seller, {})).rejects.toMatchObject({
    status: 409,
  });
});
test("metadata acquisition failure does not turn a committed product change into a failed response", async () => {
  jest
    .spyOn(Media, "findOneAndUpdate")
    .mockRejectedValue(Error("Database temporarily unavailable"));
  await expect(cleanupImages([url], seller)).resolves.toEqual([
    { url, status: "pending" },
  ]);
});
