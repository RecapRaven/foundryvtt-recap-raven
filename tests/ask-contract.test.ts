import { describe, it, expect } from "vitest";
import { parseAskResponse, AskError } from "../src/api/ask";
import { askResponse, campaignId, sessionId } from "./fixtures";
describe("Player-safe Ask response allowlist", () => {
  it.each(["answer", "abstain", "clarify", "link"])(
    "accepts %s with exact safe fields",
    (kind) => {
      expect(
        parseAskResponse(
          { ...askResponse, result: { ...askResponse.result, kind } },
          campaignId,
        ).result.kind,
      ).toBe(kind);
    },
  );
  it("accepts absent evidence, confidence and coverage without inventing sources", () => {
    const source = {
      number: 2,
      title: "Campaign lore",
      excerpt: null,
      session_id: null,
    };
    expect(
      parseAskResponse(
        {
          ...askResponse,
          result: {
            ...askResponse.result,
            sources: [source],
            confidence: null,
            coverage: null,
          },
          credits: { used: 0, remaining: null },
        },
        campaignId,
      ).result.sources,
    ).toEqual([source]);
  });
  it.each([
    null,
    [],
    {},
    { ...askResponse, trace: "private" },
    {
      ...askResponse,
      result: { ...askResponse.result, history_id: "private" },
    },
    { ...askResponse, credits: { ...askResponse.credits, cost: 1 } },
  ])("rejects non-contract/private envelope %j", (value) =>
    expect(() => parseAskResponse(value, campaignId)).toThrow(),
  );
  it.each([
    { kind: "unsafe" },
    { confidence: "certain" },
    { confidence: "high" },
    { sources: {} },
    { sources: Array(101).fill(askResponse.result.sources[0]) },
    { answer_markdown: 3 },
    { answer_markdown: "🪶".repeat(100001) },
    { coverage: { sessions_total: 1, sessions_with_memory: 2 } },
    { coverage: { sessions_total: 1.1, sessions_with_memory: 0 } },
    {
      coverage: {
        sessions_total: 2,
        sessions_with_memory: 1,
        private: "hidden",
      },
    },
  ])("rejects invalid result %j", (patch) =>
    expect(() =>
      parseAskResponse(
        { ...askResponse, result: { ...askResponse.result, ...patch } },
        campaignId,
      ),
    ).toThrow(),
  );
  it.each([
    { number: 0 },
    { number: 10001 },
    { number: 1.5 },
    { title: "" },
    { title: "a".repeat(501) },
    { excerpt: "a".repeat(2001) },
    { session_id: "bad" },
    { url: "javascript:alert(1)" },
    { url: `https://evil.example/recaps/${sessionId}` },
    { url: `https://recapraven.com/recaps/${campaignId}` },
    { url: `https://recapraven.com/recaps/${sessionId}?key=secret` },
    { url: `https://recapraven.com/recaps/${sessionId}#secret` },
    {
      url: `https://recapraven.com/campaigns/${sessionId}/transcript/${sessionId}`,
    },
    { private_quote: "hidden" },
  ])("rejects invalid or leaking source %j", (patch) =>
    expect(() =>
      parseAskResponse(
        {
          ...askResponse,
          result: {
            ...askResponse.result,
            sources: [{ ...askResponse.result.sources[0], ...patch }],
          },
        },
        campaignId,
      ),
    ).toThrow(),
  );
  it.each([
    `https://recapraven.com/campaigns/${campaignId}/transcript/${sessionId}`,
    `https://recapraven.com/recaps/${sessionId}`,
  ])("rejects GM website links from Ask sources: %s", (url) => {
    expect(() =>
      parseAskResponse(
        {
          ...askResponse,
          result: {
            ...askResponse.result,
            sources: [{ ...askResponse.result.sources[0], url }],
          },
        },
        campaignId,
      ),
    ).toThrow();
  });
  it("rejects duplicate citation numbers", () =>
    expect(() =>
      parseAskResponse(
        {
          ...askResponse,
          result: {
            ...askResponse.result,
            sources: [
              ...askResponse.result.sources,
              ...askResponse.result.sources,
            ],
          },
        },
        campaignId,
      ),
    ).toThrow());
  it.each([
    { used: -1, remaining: 4 },
    { used: Infinity, remaining: 4 },
    { used: "1", remaining: 4 },
    { used: 1, remaining: -1 },
  ])("rejects invalid credits %j", (credits) =>
    expect(() =>
      parseAskResponse({ ...askResponse, credits }, campaignId),
    ).toThrow(),
  );
  it.each([0, 400, 401, 402, 403, 409, 422, 429, 500])(
    "has an actionable sanitized error for status %s",
    (status) => expect(new AskError(status).message.length).toBeGreaterThan(20),
  );
});
