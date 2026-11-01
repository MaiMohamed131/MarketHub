import { Audit } from "./admin-models.js";
import { notify } from "./community-models.js";
import { randomUUID } from "node:crypto";
import type { ClientSession, Types } from "mongoose";
export async function recordAudit(
  entries: {
    actor: Types.ObjectId;
    action: string;
    target: Types.ObjectId;
    reason: string;
  }[],
  options: { session: ClientSession },
) {
  const events = await Audit.create(entries, options);
  for (const entry of entries)
    await notify(
      entry.actor,
      "Management event: " + entry.action,
      entry.reason,
      "/admin",
      "admin:" + randomUUID(),
      options.session,
    );
  return events;
}
