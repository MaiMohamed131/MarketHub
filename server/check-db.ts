import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDatabase } from './db.js';

try {
  await connectDatabase();
  await mongoose.connection.db!.admin().ping();
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  console.log(JSON.stringify({ connected: true, transactionsSupported: Boolean(hello.setName || hello.msg === 'isdbgrid') }));
} catch {
  console.error('Atlas connection failed. Check the configured URI, network access, and Atlas access list. Credentials have been omitted.');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
