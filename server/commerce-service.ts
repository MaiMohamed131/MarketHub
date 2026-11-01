import { z } from "zod";
export const objectId = z.string().regex(/^[a-f\d]{24}$/i);
export const quantity = z.number().int().min(1).max(99);
export const addressSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z.email().max(254),
    phone: z
      .string()
      .trim()
      .regex(/^[+\d ()-]{7,25}$/),
    line1: z.string().trim().min(5).max(200),
    line2: z.string().trim().max(200).default(""),
    city: z.string().trim().min(2).max(80),
    postalCode: z.string().trim().min(2).max(20),
    country: z.literal("US"),
  })
  .strict();
export const checkoutSchema = z
  .object({
    address: addressSchema,
    paymentMethod: z.literal("cod"),
    revision: z.number().int().min(0),
    expectedTotal: z.number().int().min(0),
  })
  .strict();
export const conflict = (message: string) =>
  Object.assign(new Error(message), { status: 409 });
export type PurchaseProduct = {
  _id: unknown;
  name: string;
  images: string[];
  price: number;
  stock: number;
  active: boolean;
  category: unknown;
  seller: unknown;
  storeName: string;
};
export function calculateOrder(
  items: { product: unknown; quantity: number }[],
  products: PurchaseProduct[],
) {
  if (!items.length) throw conflict("Your cart is empty");
  if (items.length > 50)
    throw conflict("A cart can contain at most 50 products");
  const grouped = new Map<
    string,
    {
      seller: unknown;
      storeName: string;
      items: {
        product: unknown;
        name: string;
        image: string;
        price: number;
        quantity: number;
      }[];
      subtotal: number;
      shipping: number;
      status: "pending";
    }
  >();
  const seen = new Set<string>();
  for (const item of items) {
    quantity.parse(item.quantity);
    const key = String(item.product);
    if (seen.has(key)) throw conflict("Duplicate cart product");
    seen.add(key);
    const p = products.find((p) => String(p._id) === key);
    if (!p?.active) throw conflict("A product is no longer available");
    if (p.stock < item.quantity)
      throw conflict(`${p.name} has insufficient stock`);
    if (!Number.isSafeInteger(p.price) || p.price < 0)
      throw conflict("Invalid product price");
    const seller = String(p.seller);
    let g = grouped.get(seller);
    if (!g) {
      g = {
        seller: p.seller,
        storeName: p.storeName,
        items: [],
        subtotal: 0,
        shipping: 0,
        status: "pending",
      };
      grouped.set(seller, g);
    }
    g.items.push({
      product: p._id,
      name: p.name,
      image: p.images[0] || "",
      price: p.price,
      quantity: item.quantity,
    });
    g.subtotal += p.price * item.quantity;
  }
  const groups = [...grouped.values()];
  for (const g of groups) g.shipping = g.subtotal >= 10000 ? 0 : 500;
  const subtotal = groups.reduce((s, g) => s + g.subtotal, 0),
    shipping = groups.reduce((s, g) => s + g.shipping, 0);
  if (!Number.isSafeInteger(subtotal + shipping))
    throw conflict("Order total is too large");
  return {
    groups,
    subtotal,
    shipping,
    total: subtotal + shipping,
    currency: "USD",
  };
}
export const transitions: Record<string, string[]> = {
  pending: ["confirmed"],
  confirmed: ["processing"],
  processing: ["shipped"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};
export function canCancel(groups: { status?: string | null }[]) {
  return (
    groups.length > 0 &&
    groups.every((g) => g.status === "pending" || g.status === "confirmed")
  );
}
