import "dotenv/config";
import { connectDatabase } from "./db.js";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User } from "./models.js";
import { SellerApplication } from "./seller-models.js";
import { Category, Product } from "./catalog-models.js";
import { app } from "./app.js";
if (process.env.NODE_ENV === "production")
  throw Error("Browser fixtures cannot run in production");
const database = "mh_browser_" + Date.now();
try {
  await connectDatabase(database);
  for (const model of Object.values(mongoose.models))
    await model.createIndexes();
  const password = await bcrypt.hash("IsolatedBrowserTest123!", 12);
  const users: InstanceType<typeof User>[] = [];
  for (const [name, role] of [
    ["Browser Customer", "customer"],
    ["Browser Seller", "seller"],
    ["Second Seller", "seller"],
    ["Browser Admin", "admin"],
  ])
    users.push(
      await User.create({
        name,
        email:
          role === "seller"
            ? (users.length === 1 ? "seller" : "seller2") + "@browser.example"
            : role + "@browser.example",
        role: role as "customer" | "seller" | "admin",
        password,
        verified: true,
      }),
    );
  for (const user of users.filter((u) => u.role === "seller"))
    await SellerApplication.create({
      user: user._id,
      storeName: user.name,
      description: "Isolated browser testing store for MarketHub.",
      email: user.email,
      phone: "+1 555 555 5555",
      status: "approved",
    });
  const category = await Category.create({
    name: "Browser test collection",
    slug: "browser-test",
    description: "Isolated UI fixtures",
    active: true,
  });
  for (const [i, user] of users.filter((u) => u.role === "seller").entries())
    await Product.create({
      name: i ? "Linen Carry Tote" : "Ceramic Coffee Cup",
      description:
        "A thoughtfully made everyday essential for isolated browser testing.",
      price: i ? 3200 : 2400,
      stock: 12,
      category: category._id,
      seller: user._id,
      storeName: user.name,
      active: true,
      featured: true,
      images: [],
    });
  app.listen(4000, "127.0.0.1", () =>
    console.log("Isolated browser API ready; database " + database),
  );
  process.on("SIGINT", async () => {
    await mongoose.disconnect();
    process.exit();
  });
} catch (e) {
  console.error("Browser fixture startup failed: " + (e as Error).name);
  process.exitCode = 1;
  await mongoose.disconnect();
}
