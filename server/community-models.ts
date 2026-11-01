import { Schema, model, type ClientSession, Types } from "mongoose";
export const Review = model(
  "Review",
  new Schema(
    {
      user: { type: Schema.Types.ObjectId, required: true },
      product: { type: Schema.Types.ObjectId, required: true },
      order: { type: Schema.Types.ObjectId, required: true },
      rating: {
        type: Number,
        min: 1,
        max: 5,
        required: true,
        validate: Number.isInteger,
      },
      comment: { type: String, required: true, maxlength: 2000 },
      displayName: { type: String, required: true },
    },
    { timestamps: true, bufferCommands: false },
  ),
);
Review.schema.index({ user: 1, product: 1, order: 1 }, { unique: true });
Review.schema.index({ product: 1, createdAt: -1 });
export const Notification = model(
  "Notification",
  new Schema(
    {
      user: { type: Schema.Types.ObjectId, required: true },
      title: { type: String, required: true },
      message: { type: String, required: true },
      path: { type: String, required: true },
      eventKey: { type: String, required: true },
      readAt: { type: Date, default: null },
    },
    { timestamps: true, bufferCommands: false },
  ),
);
Notification.schema.index({ user: 1, eventKey: 1 }, { unique: true });
Notification.schema.index({ user: 1, readAt: 1, createdAt: -1 });
export async function notify(
  user: Types.ObjectId,
  title: string,
  message: string,
  path: string,
  eventKey: string,
  session: ClientSession,
) {
  await Notification.updateOne(
    { user, eventKey },
    { $setOnInsert: { user, title, message, path, eventKey } },
    { upsert: true, session },
  );
}
