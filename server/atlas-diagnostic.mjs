import "dotenv/config";
import mongoose from "mongoose";
try {
  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: "markethub",
    autoIndex: false,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 7000,
  });
  console.log("Authenticated Atlas connection succeeded");
} catch (e) {
  process.exitCode = 1;
  const scrub = (s) =>
    String(s || "")
      .replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, "[redacted URI]")
      .replace(/(?<=password[=: ]).+/gi, "[redacted]");
  console.log(
    JSON.stringify({
      name: e.name,
      code: e.code,
      servers: [...(e.reason?.servers?.values() || [])].map((v) => ({
        host: v.address,
        type: v.type,
        error: v.error?.name,
        message: scrub(v.error?.message),
        cause: scrub(v.error?.cause?.message),
        code: v.error?.cause?.code,
      })),
    }),
  );
} finally {
  await mongoose.disconnect();
}
