export function clientOrigin() {
  if (process.env.CLIENT_ORIGIN)
    return process.env.CLIENT_ORIGIN.replace(/\/$/, "");
  const domain = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return domain ? `https://${domain}` : "http://localhost:5173";
}
