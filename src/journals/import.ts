import { version } from "../../package.json";
import { ImportError } from "./errors";
import type { Session } from "../api/contract";
import { renderRecap } from "./render";
export const MODULE_ID = "recap-raven";
export interface ImportIdentity {
  campaignId: string;
  sessionId: string;
  digest: string;
  importerVersion: string;
}
export interface Journal {
  testUserPermission?(user: unknown, permission: "OBSERVER"): boolean;
  sheet?: { render(options: { force: true }): unknown };
  id: string;
  getFlag(scope: string, key: string): unknown;
}
export interface JournalData {
  _id: string;
  name: string;
  folder: string | null;
  ownership: { default: number };
  flags: Record<string, { source: ImportIdentity }>;
  pages: { name: string; type: "text"; text: { format: 1; content: string } }[];
}
export interface JournalStore {
  all(): Iterable<Journal>;
  get(id: string): Journal | undefined;
  create(data: JournalData): Promise<Journal | undefined>;
}
export async function sha256(text: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function journalId(
  campaignId: string,
  sessionId: string,
): Promise<string> {
  const digest = await sha256(`${MODULE_ID}:${campaignId}:${sessionId}`);
  // Foundry document IDs accept sixteen alphanumeric characters. Collisions fail closed.
  return digest.slice(0, 16);
}
export function matches(
  journal: Journal,
  campaignId: string,
  sessionId: string,
): boolean {
  const flag = journal.getFlag(MODULE_ID, "source");
  return (
    !!flag &&
    typeof flag === "object" &&
    "campaignId" in flag &&
    "sessionId" in flag &&
    flag.campaignId === campaignId &&
    flag.sessionId === sessionId
  );
}
export function findJournal(
  store: JournalStore,
  campaignId: string,
  sessionId: string,
): Journal | undefined {
  return Array.from(store.all()).find((j) => matches(j, campaignId, sessionId));
}
export async function importSession(
  store: JournalStore,
  session: Session,
  options: { folder: string | null; publish: boolean },
): Promise<"created" | "skipped"> {
  if ((await sha256(session.markdown)) !== session.content_sha256)
    throw new ImportError("integrity");
  if (findJournal(store, session.campaign_id, session.id)) return "skipped";
  const id = await journalId(session.campaign_id, session.id);
  const existing = store.get(id);
  if (existing) {
    if (matches(existing, session.campaign_id, session.id)) return "skipped";
    throw new ImportError("collision");
  }
  const name =
    session.title?.trim() || `Session ${session.session_number ?? session.id}`;
  const data: JournalData = {
    _id: id,
    name,
    folder: options.folder,
    ownership: { default: options.publish ? 2 : 0 },
    flags: {
      [MODULE_ID]: {
        source: {
          campaignId: session.campaign_id,
          sessionId: session.id,
          digest: session.content_sha256,
          importerVersion: version,
        },
      },
    },
    pages: [
      {
        name,
        type: "text",
        text: { format: 1, content: renderRecap(session.markdown) },
      },
    ],
  };
  try {
    const created = await store.create(data);
    if (!created || !matches(created, session.campaign_id, session.id))
      throw new ImportError("creation");
  } catch (error) {
    if (findJournal(store, session.campaign_id, session.id)) return "skipped";
    throw error instanceof ImportError ? error : new ImportError("creation");
  }
  return "created";
}
