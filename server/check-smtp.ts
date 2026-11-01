import "dotenv/config";
import { z } from "zod";
import { createMailTransport } from "./mail.js";
const required = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "MAIL_FROM",
];
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) {
  console.error("Missing backend environment variables: " + missing.join(", "));
  process.exitCode = 1;
} else {
  const transport = createMailTransport();
  try {
    await transport.verify();
    console.log("SMTP connection, TLS negotiation, and authentication passed.");
    const recipient = process.env.SMTP_TEST_TO;
    if (!recipient) {
      console.log(
        "No mail sent. Add SMTP_TEST_TO to send an explicitly addressed delivery test.",
      );
    } else {
      z.email().parse(recipient);
      const result = await transport.sendMail({
        from: process.env.MAIL_FROM,
        to: recipient,
        subject: "MarketHub SMTP delivery test",
        text: "This is a real SMTP delivery test from your MarketHub backend. No password, verification token, or reset token is included. Please confirm that you received this message, checking your spam folder as well.",
      });
      if (!result.accepted?.length || result.rejected?.length)
        throw Error("RECIPIENT_REJECTED");
      console.log(
        "SMTP server accepted the test email. Inbox receipt still requires recipient confirmation.",
      );
    }
  } catch (e) {
    const err = e as { code?: string; responseCode?: number };
    console.error(
      "SMTP check failed. Code: " +
        (err.code || "DELIVERY_ERROR") +
        "; server status: " +
        (err.responseCode || "unavailable") +
        ". Credentials and server response text omitted.",
    );
    process.exitCode = 1;
  } finally {
    transport.close();
  }
}
