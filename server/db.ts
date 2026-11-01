import mongoose from "mongoose";

export async function connectDatabase(dbName = "markethub") {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required");
  await mongoose.connect(uri, {
    dbName,
    serverSelectionTimeoutMS: 15000,
    autoIndex: false,
    maxPoolSize: process.env.VERCEL ? 10 : 100,
    minPoolSize: 0,
  });
}
