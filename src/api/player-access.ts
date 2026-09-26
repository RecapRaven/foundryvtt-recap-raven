import { objectWithExactKeys, ContractValidationError } from "./contract";
import { parseConnection, type Connection } from "./connection";
export const PLAYER_KEY = /^raven_fpl_[A-Za-z0-9_-]{43}$/u;
export interface PlayerAccess {
  api_key: string;
  connection: Connection;
}
export function parsePlayerAccess(value: unknown): PlayerAccess {
  const data = objectWithExactKeys(
    value,
    ["api_key", "connection"],
    "Ask access",
  );
  if (typeof data.api_key !== "string" || !PLAYER_KEY.test(data.api_key))
    throw new ContractValidationError("Invalid Ask credential.");
  const connection = parseConnection({ connection: data.connection });
  if (
    connection.audience !== "player" ||
    connection.mode === "off" ||
    connection.expires_at === null
  )
    throw new ContractValidationError("Invalid Ask capability.");
  return { api_key: data.api_key, connection };
}
