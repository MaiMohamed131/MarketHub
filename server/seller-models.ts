import { Schema, model } from "mongoose";
const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, required: true, unique: true },
    storeName: { type: String, required: true },
    description: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "suspended"],
      default: "pending",
    },
    reason: { type: String, default: "" },
    reviewedBy: Schema.Types.ObjectId,
    reviewedAt: Date,
  },
  { timestamps: true, bufferCommands: false },
);
schema.index({ status: 1, createdAt: -1 });
export const SellerApplication = model("SellerApplication", schema);
export const Media = model(
  "Media",
  new Schema(
    {
      seller: { type: Schema.Types.ObjectId, required: true },
      url: { type: String, required: true, unique: true },
      publicId: { type: String, required: true },
      status: { type: String, enum: ["ready", "deleting"], default: "ready" },
      cleanupError: String,
    },
    { timestamps: true, bufferCommands: false },
  ),
);
