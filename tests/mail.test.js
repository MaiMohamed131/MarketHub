import { test, expect, jest, afterEach } from "@jest/globals";
import nodemailer from "nodemailer";
import { createMailTransport } from "../dist/mail.js";
const keys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD"];
const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
afterEach(() => {
  jest.restoreAllMocks();
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
function setup(host = "smtp.example.com", port = "587") {
  process.env.SMTP_HOST = host;
  process.env.SMTP_PORT = port;
  process.env.SMTP_USER = "test-user";
  process.env.SMTP_PASSWORD = "test-only-password";
  return jest.spyOn(nodemailer, "createTransport").mockReturnValue({});
}
test("port 587 requires STARTTLS and reads authentication from backend environment", () => {
  const spy = setup();
  createMailTransport();
  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "test-user", pass: "test-only-password" },
    }),
  );
  expect(spy.mock.calls[0][0].tls?.rejectUnauthorized).not.toBe(false);
});
test("port 465 enables implicit TLS", () => {
  const spy = setup("smtp.example.com", "465");
  createMailTransport();
  expect(spy.mock.calls[0][0].secure).toBe(true);
});
test("localhost SMTP test harness remains usable without TLS", () => {
  const spy = setup("127.0.0.1", "2525");
  createMailTransport();
  expect(spy.mock.calls[0][0].requireTLS).toBe(false);
});
test("invalid port and incomplete authentication fail before connecting", () => {
  const spy = setup();
  process.env.SMTP_PORT = "not-a-port";
  expect(() => createMailTransport()).toThrow();
  process.env.SMTP_PORT = "587";
  delete process.env.SMTP_PASSWORD;
  expect(() => createMailTransport()).toThrow();
  expect(spy).not.toHaveBeenCalled();
});
