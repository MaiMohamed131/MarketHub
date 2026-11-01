import mongoose, { Schema } from "mongoose";
const userSchema = new Schema(
  {
    email: { type: String, unique: true, required: true },
    name: { type: String, required: true },
    password: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["customer", "seller", "admin"],
      default: "customer",
    },
    active: { type: Boolean, default: true },
    verified: { type: Boolean, default: false },
    version: { type: Number, default: 0 },
    avatar: String,
  },
  { timestamps: true, bufferCommands: false, optimisticConcurrency: true },
);
export const User = mongoose.model("User", userSchema);
export const Session = mongoose.model(
  "Session",
  new Schema(
    {
      user: { type: Schema.Types.ObjectId, required: true },
      hash: { type: String, unique: true, required: true },
      family: { type: String, required: true, index: true },
      used: { type: Boolean, default: false },
      expires: { type: Date, index: { expires: 0 } },
    },
    { bufferCommands: false },
  ),
);
export const SessionFamily = mongoose.model(
  "SessionFamily",
  new Schema(
    {
      _id: { type: String, required: true },
      user: { type: Schema.Types.ObjectId, required: true, index: true },
      revoked: { type: Boolean, default: false },
      revision: { type: Number, default: 0 },
      expires: { type: Date, index: { expires: 0 } },
    },
    { bufferCommands: false },
  ),
);
export const Action = mongoose.model(
  "Action",
  new Schema(
    {
      user: { type: Schema.Types.ObjectId, required: true },
      hash: { type: String, unique: true, required: true },
      kind: {
        type: String,
        enum: ["verify-email", "reset-password"],
        required: true,
      },
      expires: { type: Date, index: { expires: 0 } },
    },
    { bufferCommands: false },
  ),
);
