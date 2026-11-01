import { z } from "zod";
import { objectId } from "./commerce-service.js";
export const applicationSchema = z
  .object({
    storeName: z.string().trim().min(2).max(100),
    description: z.string().trim().min(30).max(2000),
    email: z.email().max(254),
    phone: z
      .string()
      .trim()
      .regex(/^[+\d ()-]{7,25}$/),
  })
  .strict();
export const productInput = z
  .object({
    name: z.string().trim().min(3).max(160),
    description: z.string().trim().min(20).max(12000),
    price: z.number().int().min(1).max(100000000),
    stock: z.number().int().min(0).max(1000000),
    category: objectId,
    images: z.array(z.url().startsWith("https://")).max(8),
    active: z.boolean(),
  })
  .strict();
export const productEdit = productInput
  .omit({ stock: true })
  .extend({ version: z.number().int().min(0) });
export const inventoryInput = z
  .object({
    delta: z
      .number()
      .int()
      .min(-1000000)
      .max(1000000)
      .refine((v) => v !== 0),
    expectedStock: z.number().int().min(0).max(1000000),
  })
  .strict();
export const statusError = (status: number, message: string) =>
  Object.assign(new Error(message), { status });
export function imageFormat(buffer: Buffer) {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (
    buffer.length >= 3 &&
    buffer[0] === 255 &&
    buffer[1] === 216 &&
    buffer[2] === 255
  )
    return "jpg";
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  return null;
}
