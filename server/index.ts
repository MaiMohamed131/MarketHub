import "dotenv/config";
import { connectDatabase } from "./db.js";
import { app } from "./app.js";
try {
  await connectDatabase();
  const server = app.listen(Number(process.env.PORT || 4000), () =>
    console.log("MarketHub API ready"),
  );
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
} catch {
  console.error("Startup failed; check database and environment configuration");
  process.exitCode = 1;
}
