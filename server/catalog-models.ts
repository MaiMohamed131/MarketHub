import { Schema, model } from "mongoose";
const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true },
    description: { type: String, default: "" },
    image: { type: String, default: "" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, bufferCommands: false },
);
export const Category = model("Category", categorySchema);
const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, required: true, maxlength: 12000 },
    price: {
      type: Number,
      required: true,
      min: 0,
      max: 100000000,
      validate: Number.isSafeInteger,
    },
    brand: { type: String, default: "", maxlength: 80 },
    originalPrice: { type: Number, min: 0, validate: Number.isSafeInteger },
    demoKey: { type: String },
    specifications: { type: Map, of: String },
    currency: { type: String, enum: ["USD"], default: "USD" },
    stock: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
    category: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    seller: { type: Schema.Types.ObjectId, ref: "User", required: true },
    storeName: { type: String, required: true, maxlength: 100 },
    images: { type: [String], default: [] },
    active: { type: Boolean, default: false },
    moderationBlocked: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },
    featured: { type: Boolean, default: false },
    salesCount: { type: Number, default: 0, min: 0 },
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, bufferCommands: false },
);
productSchema.index({ active: 1, category: 1, createdAt: -1, _id: -1 });
productSchema.index({ seller: 1, deleted: 1, createdAt: -1 });
productSchema.index({ active: 1, price: 1, _id: 1 });
productSchema.index({ active: 1, salesCount: -1, _id: -1 });
productSchema.index({ demoKey: 1 }, { unique: true, sparse: true });
export const Product = model("Product", productSchema);
