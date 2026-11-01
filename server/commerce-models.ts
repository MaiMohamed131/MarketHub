import { Schema, model } from "mongoose";
const ref = { type: Schema.Types.ObjectId, required: true };
const line = new Schema(
  {
    product: ref,
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: 99,
      validate: Number.isInteger,
    },
  },
  { _id: false },
);
export const Basket = model(
  "Basket",
  new Schema(
    {
      user: { ...ref, unique: true },
      items: { type: [line], default: [] },
      wishlist: { type: [Schema.Types.ObjectId], default: [] },
      revision: { type: Number, default: 0 },
    },
    { bufferCommands: false },
  ),
);
const snapshot = new Schema(
  {
    product: ref,
    name: { type: String, required: true },
    image: String,
    price: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: 99,
      validate: Number.isInteger,
    },
  },
  { _id: false },
);
const group = new Schema(
  {
    seller: ref,
    storeName: String,
    items: [snapshot],
    subtotal: Number,
    shipping: Number,
    status: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
      ],
      default: "pending",
    },
  },
  { _id: true },
);
const orderSchema = new Schema(
  {
    user: ref,
    idempotencyKey: { type: String, required: true },
    address: {
      name: String,
      email: String,
      phone: String,
      line1: String,
      line2: String,
      city: String,
      postalCode: String,
      country: String,
    },
    groups: [group],
    subtotal: Number,
    shipping: Number,
    total: Number,
    currency: { type: String, default: "USD" },
    paymentMethod: { type: String, enum: ["cod"], default: "cod" },
    paymentStatus: { type: String, default: "unpaid" },
    cancelledAt: Date,
  },
  { timestamps: true, bufferCommands: false },
);
orderSchema.index({ user: 1, idempotencyKey: 1 }, { unique: true });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ "groups.seller": 1, createdAt: -1 });
export const Order = model("Order", orderSchema);
