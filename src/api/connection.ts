import {
  objectWithExactKeys,
  uuidValue,
  dateTimeValue,
  ContractValidationError,
} from "./contract";
export type AskMode = "off" | "gm" | "all";
export interface Connection {
  id: string;
  campaign: { id: string; name: string };
  mode: AskMode;
  revision: number;
  audience: "gm" | "player";
  expires_at: string | null;
  can_ask: boolean;
}
export function parseConnection(value: unknown): Connection {
  const envelope = objectWithExactKeys(value, ["connection"], "response");
  const c = objectWithExactKeys(
    envelope.connection,
    ["id", "campaign", "mode", "revision", "audience", "expires_at", "can_ask"],
    "connection",
  );
  const campaign = objectWithExactKeys(c.campaign, ["id", "name"], "campaign");
  if (
    typeof campaign.name !== "string" ||
    !campaign.name.trim() ||
    campaign.name.length > 500 ||
    !["off", "gm", "all"].includes(String(c.mode)) ||
    !Number.isSafeInteger(c.revision) ||
    Number(c.revision) < 1 ||
    !["gm", "player"].includes(String(c.audience)) ||
    typeof c.can_ask !== "boolean"
  ) {
    throw new ContractValidationError("Invalid connection.");
  }
  if (c.can_ask && (c.mode === "off" || c.audience === "gm")) {
    throw new ContractValidationError("Inconsistent permissions.");
  }
  return {
    id: uuidValue(c.id, "connection.id"),
    campaign: {
      id: uuidValue(campaign.id, "campaign.id"),
      name: campaign.name,
    },
    mode: c.mode as AskMode,
    revision: Number(c.revision),
    audience: c.audience as Connection["audience"],
    expires_at:
      c.expires_at === null ? null : dateTimeValue(c.expires_at, "expires_at"),
    can_ask: c.can_ask,
  };
}
