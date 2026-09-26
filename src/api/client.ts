import { parseConnection, type AskMode } from "./connection";
import {
  assertUuid,
  parseSessionPage,
  parseSessionResponse,
  type SessionSummary,
} from "./contract";
import { IntegrationClient } from "./transport";
import { parsePlayerAccess } from "./player-access";
export { ApiError, API_ORIGIN } from "./transport";
export class RavenClient extends IntegrationClient {
  constructor(credential: string, transport: typeof fetch = fetch) {
    super(credential, transport);
    if (!/^raven_fgm_[A-Za-z0-9_-]{43}$/u.test(credential))
      throw new Error("Enter a dedicated Foundry GM credential.");
  }
  async connection() {
    const connection = parseConnection(await this.request("/connection"));
    if (connection.audience !== "gm")
      throw new Error("GM management access is required.");
    return connection;
  }
  async settings(mode: AskMode, revision: number) {
    if (
      !["off", "gm", "all"].includes(mode) ||
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      revision > 2147483646
    )
      throw new Error("Invalid settings.");
    return parseConnection(
      await this.request("/settings", "PATCH", { mode, revision }),
    );
  }
  async playerAccess(revision: number) {
    if (
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      revision > 2147483646
    )
      throw new Error("Invalid revision.");
    return parsePlayerAccess(
      await this.request("/player-access", "POST", { revision }),
    );
  }
  async sessions(campaignId: string): Promise<SessionSummary[]> {
    assertUuid(campaignId);
    const sessions: SessionSummary[] = [];
    const cursors = new Set<string>();
    const ids = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = parseSessionPage(
        await this.request(
          `/sessions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        ),
      );
      for (const session of page.sessions) {
        if (session.campaign_id !== campaignId || ids.has(session.id))
          throw new Error("Inconsistent session list.");
        ids.add(session.id);
        sessions.push(session);
      }
      cursor = page.next_cursor;
      if (cursor && cursors.has(cursor))
        throw new Error("Repeated pagination cursor.");
      if (cursor) cursors.add(cursor);
      if (cursors.size > 1000) throw new Error("Too many session pages.");
    } while (cursor);
    return sessions;
  }
  async session(id: string, campaignId: string) {
    assertUuid(id);
    assertUuid(campaignId);
    const session = parseSessionResponse(await this.request(`/sessions/${id}`));
    if (session.id !== id || session.campaign_id !== campaignId)
      throw new Error("Session does not belong to this campaign.");
    return session;
  }
}
