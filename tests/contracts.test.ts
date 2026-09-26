import { describe, it, expect } from "vitest";
import { parseConnection } from "../src/api/connection";
import {
  parseSessionPage,
  parseSessionResponse,
  assertUuid,
} from "../src/api/contract";
import { connection, page, session, summary } from "./fixtures";
describe("strict public contracts", () => {
  it("accepts exact connection, session and pagination shapes", () => {
    expect(parseConnection({ connection })).toEqual(connection);
    expect(parseSessionPage(page)).toEqual(page);
    expect(parseSessionResponse({ session })).toEqual(session);
    expect(
      parseConnection({
        connection: {
          ...connection,
          mode: "all",
          audience: "player",
          can_ask: true,
          expires_at: "2026-01-01T00:00:00Z",
        },
      }).audience,
    ).toBe("player");
  });
  it.each([null, [], {}, "data", { connection, secret: "never" }])(
    "rejects invalid connection envelope %j",
    (value) => expect(() => parseConnection(value)).toThrow(),
  );
  it.each([
    { mode: "admin" },
    { revision: 0 },
    { revision: 1.5 },
    { audience: "owner" },
    { can_ask: "yes" },
    { can_ask: true },
    { mode: "gm", audience: "gm", can_ask: true },
    { expires_at: "today" },
    { campaign: { ...connection.campaign, name: "" } },
    { campaign: { ...connection.campaign, id: "other" } },
    { id: "other" },
    { trace: "private" },
    { campaign: { ...connection.campaign, secret: "hidden" } },
  ])("rejects connection changes %j", (patch) =>
    expect(() =>
      parseConnection({ connection: { ...connection, ...patch } }),
    ).toThrow(),
  );
  it.each([
    { sessions: {} },
    { sessions: Array(101).fill(summary) },
    { sessions: [summary, summary] },
    { next_cursor: "!" },
    { next_cursor: 1 },
    { has_more: true },
    { has_more: "yes" },
    { next_cursor: "valid" },
    { page_size: 20 },
    { trace: "hidden" },
  ])("rejects malformed pagination %j", (patch) =>
    expect(() => parseSessionPage({ ...page, ...patch })).toThrow(),
  );
  it.each([
    { content_type: "text/html" },
    { markdown: "" },
    { markdown: 2 },
    { markdown: "x".repeat(262145) },
    { content_sha256: "bad" },
    { source_url: "https://evil.example/recap" },
    { source_url: "not a URL" },
    { source_url: summary.source_url + "?token=hidden" },
    { id: "bad" },
    { campaign_id: 42 },
    { session_number: -1 },
    { session_number: 10000 },
    { session_number: 1.5 },
    { title: 4 },
    { recorded_at: "yesterday" },
    { ready_at: "2026-15-99T00:00:00Z" },
    { artifact_created_at: null },
    { secret: "hidden" },
  ])("rejects malformed or overbroad session %j", (patch) =>
    expect(() =>
      parseSessionResponse({ session: { ...session, ...patch } }),
    ).toThrow(),
  );
  it("accepts nullable and optional-value fields", () =>
    expect(
      parseSessionResponse({
        session: {
          ...session,
          title: null,
          session_number: null,
          recorded_at: "2026-01-01T01:00:00+01:00",
        },
      }).session_number,
    ).toBeNull());
  it("rejects malformed UUID", () => expect(() => assertUuid("bad")).toThrow());
});
