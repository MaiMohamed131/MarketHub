import { notify } from "./community-models.js";
import mongoose from "mongoose";
import { Order } from "./commerce-models.js";
import { Product } from "./catalog-models.js";
import { canCancel, conflict } from "./commerce-service.js";
export async function cancelOrder(id: string, user?: mongoose.Types.ObjectId) {
  await mongoose.connection.transaction(async (session) => {
    const order = await Order.findOne({
      _id: id,
      ...(user ? { user } : {}),
    }).session(session);
    if (!order)
      throw Object.assign(new Error("Order not found"), { status: 404 });
    if (order.cancelledAt) return;
    if (!canCancel(order.groups))
      throw conflict("This order can no longer be cancelled");
    for (const group of order.groups) {
      for (const item of group.items) {
        const result = await Product.updateOne(
          { _id: item.product },
          { $inc: { stock: item.quantity } },
          { session },
        );
        if (!result.matchedCount)
          throw conflict("Unable to restore inventory. Contact support.");
      }
      group.status = "cancelled";
      await notify(
        group.seller,
        "Order cancelled",
        "A customer order was cancelled. Inventory was restored.",
        "/seller/orders",
        "cancel:" + order._id + ":" + group.seller,
        session,
      );
    }
    order.cancelledAt = new Date();
    await order.save({ session });
    await notify(
      order.user,
      "Order cancelled",
      "Your order was cancelled.",
      "/orders/" + order._id,
      "cancel:" + order._id,
      session,
    );
  });
}
