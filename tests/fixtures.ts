import type { Connection } from "../src/api/connection";
import type { Session } from "../src/api/contract";
export const campaignId = "11111111-1111-4111-8111-111111111111";
export const sessionId = "22222222-2222-4222-8222-222222222222";
export const connection: Connection = {
  id: "33333333-3333-4333-8333-333333333333",
  campaign: { id: campaignId, name: "Example campaign" },
  mode: "off",
  revision: 1,
  audience: "gm",
  expires_at: null,
  can_ask: false,
};
export const summary = {
  id: sessionId,
  campaign_id: campaignId,
  session_number: 1,
  title: "The bridge",
  recorded_at: null,
  ready_at: "2026-01-01T00:00:00Z",
  artifact_created_at: "2026-01-01T00:00:00Z",
  source_url: `https://recapraven.com/recaps/${sessionId}`,
};
export const session: Session = {
  ...summary,
  content_type: "text/markdown",
  markdown: "# The bridge",
  content_sha256: "0".repeat(64),
};
export const page = {
  sessions: [summary],
  has_more: false,
  next_cursor: null,
  page_size: 100,
};
export const credential = `raven_fgm_${"x".repeat(43)}`;
export function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
export const askResponse = {
  result: {
    kind: "answer" as const,
    answer_markdown: "The ferryman asked for his bell.",
    sources: [
      {
        number: 1,
        title: "The bridge",
        excerpt: "Recover the bell.",
        session_id: sessionId,
      },
    ],
    confidence: "medium" as const,
    coverage: { sessions_total: 2, sessions_with_memory: 1 },
  },
  credits: { used: 1, remaining: 4 },
};
export const askConnection = {
  ...connection,
  audience: "player" as const,
  mode: "gm" as const,
  can_ask: true,
  expires_at: "2026-09-09T23:00:00Z",
};

export const playerCredential = `raven_fpl_${"p".repeat(43)}`;
