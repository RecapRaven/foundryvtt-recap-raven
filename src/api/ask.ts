import {
  objectWithExactKeys,
  uuidValue,
  ContractValidationError,
} from "./contract";
export interface AskSource {
  number: number;
  title: string;
  excerpt: string | null;
  session_id: string | null;
}
export interface AskResponse {
  result: {
    kind: "answer" | "abstain" | "clarify" | "link";
    answer_markdown: string;
    sources: AskSource[];
    confidence: "medium" | "low" | null;
    coverage: { sessions_total: number; sessions_with_memory: number } | null;
  };
  credits: { used: number; remaining: number | null };
}
function bounded(value: unknown, max: number, min = 0): string {
  if (
    typeof value !== "string" ||
    Array.from(value).length > max ||
    Array.from(value).length < min
  )
    throw new ContractValidationError("Invalid Ask text.");
  return value;
}
function nonnegative(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new ContractValidationError("Invalid Ask number.");
  return value;
}
export function parseAskResponse(
  value: unknown,
  campaignId: string,
): AskResponse {
  uuidValue(campaignId, "campaignId");
  const envelope = objectWithExactKeys(
    value,
    ["result", "credits"],
    "Ask response",
  );
  const result = objectWithExactKeys(
    envelope.result,
    ["kind", "answer_markdown", "sources", "confidence", "coverage"],
    "Ask result",
  );
  const credits = objectWithExactKeys(
    envelope.credits,
    ["used", "remaining"],
    "Ask credits",
  );
  if (
    !["answer", "abstain", "clarify", "link"].includes(String(result.kind)) ||
    ![null, "medium", "low"].includes(result.confidence as null | string) ||
    !Array.isArray(result.sources) ||
    result.sources.length > 100
  )
    throw new ContractValidationError("Invalid Ask result.");
  const numbers = new Set<number>();
  const sources = result.sources.map((value): AskSource => {
    const source = objectWithExactKeys(
      value,
      ["number", "title", "excerpt", "session_id"],
      "Ask source",
    );
    const number = nonnegative(source.number);
    if (
      !Number.isInteger(number) ||
      number < 1 ||
      number > 10000 ||
      numbers.has(number)
    )
      throw new ContractValidationError("Invalid source number.");
    numbers.add(number);
    const sessionId =
      source.session_id === null
        ? null
        : uuidValue(source.session_id, "source.session_id");
    return {
      number,
      title: bounded(source.title, 500, 1),
      excerpt: source.excerpt === null ? null : bounded(source.excerpt, 2000),
      session_id: sessionId,
    };
  });
  let coverage: AskResponse["result"]["coverage"] = null;
  if (result.coverage !== null) {
    const c = objectWithExactKeys(
      result.coverage,
      ["sessions_total", "sessions_with_memory"],
      "Ask coverage",
    );
    const total = nonnegative(c.sessions_total);
    const withMemory = nonnegative(c.sessions_with_memory);
    if (
      !Number.isSafeInteger(total) ||
      !Number.isSafeInteger(withMemory) ||
      withMemory > total
    )
      throw new ContractValidationError("Invalid Ask coverage.");
    coverage = { sessions_total: total, sessions_with_memory: withMemory };
  }
  return {
    result: {
      kind: result.kind as AskResponse["result"]["kind"],
      answer_markdown: bounded(result.answer_markdown, 100000),
      sources,
      confidence: result.confidence as AskResponse["result"]["confidence"],
      coverage,
    },
    credits: {
      used: nonnegative(credits.used),
      remaining:
        credits.remaining === null ? null : nonnegative(credits.remaining),
    },
  };
}
export class AskError extends Error {
  constructor(public readonly status: number) {
    super(
      status === 0
        ? "The result could not be confirmed. Credits may have been used. Your question was not retried; submit a new question only when ready."
        : status === 401 || status === 403
          ? "Ask access is unavailable. Reconnect in module settings."
          : status === 402
            ? "There are not enough Ask credits. Check your Recap Raven account."
            : status === 409
              ? "Another question is being processed. Wait before submitting a new question."
              : status === 429
                ? "Too many questions. Wait before submitting a new question."
                : status === 400 || status === 422
                  ? "The question could not be accepted. Enter a complete question of up to 500 characters."
                  : "Recap Raven could not complete this question. Try a new question later.",
    );
  }
}
