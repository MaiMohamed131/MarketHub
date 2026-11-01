import { Schema, model } from "mongoose";
export const Audit = model(
  "Audit",
  new Schema(
    {
      actor: { type: Schema.Types.ObjectId, required: true },
      action: { type: String, required: true },
      target: { type: Schema.Types.ObjectId, required: true },
      reason: { type: String, required: true },
    },
    { timestamps: true, bufferCommands: false },
  ),
);
export const Dispute = model(
  "Dispute",
  new Schema(
    {
      order: { type: Schema.Types.ObjectId, required: true },
      subject: { type: String, required: true },
      notes: { type: String, required: true },
      resolution: { type: String, default: "" },
      status: { type: String, enum: ["open", "resolved"], default: "open" },
      createdBy: Schema.Types.ObjectId,
      resolvedBy: Schema.Types.ObjectId,
      resolvedAt: Date,
    },
    { timestamps: true, bufferCommands: false },
  ),
);
