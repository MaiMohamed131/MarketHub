import nodemailer from "nodemailer";
import { statusError } from "./seller-validation.js";
export function createMailTransport() {
  const host = process.env.SMTP_HOST?.trim(),
    port = Number(process.env.SMTP_PORT || 587),
    user = process.env.SMTP_USER?.trim(),
    pass = process.env.SMTP_PASSWORD;
  if (
    !host ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    Boolean(user) !== Boolean(pass)
  )
    throw statusError(503, "Email delivery is not configured");
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: !["localhost", "127.0.0.1", "::1"].includes(host),
    auth: user ? { user, pass } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}
