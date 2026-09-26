import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/transport";
import { ContractValidationError } from "../src/api/contract";
import { ImportError, importFailureMessage } from "../src/journals/errors";

describe("safe import diagnostics", () => {
  it.each([
    [401, "Reconnect"],
    [403, "Reconnect"],
    [404, "Refresh"],
    [429, "Wait"],
    [500, "retry later"],
    [0, "Check your connection"],
  ])("offers recovery for HTTP status %s", (status, guidance) => {
    expect(importFailureMessage(new ApiError(status))).toContain(guidance);
  });
  it.each(["integrity", "collision", "creation"] as const)(
    "explains %s failures",
    (reason) => {
      const error = new ImportError(reason);
      expect(importFailureMessage(error)).toBe(error.message);
    },
  );
  it("does not expose raw errors or response data", () => {
    const privateMessage = "private credential and campaign data";
    for (const error of [new Error(privateMessage), privateMessage, null]) {
      expect(importFailureMessage(error)).not.toContain(privateMessage);
      expect(importFailureMessage(error)).toContain("contact support");
    }
    const message = importFailureMessage(
      new ContractValidationError(privateMessage),
    );
    expect(message).not.toContain(privateMessage);
    expect(message).toContain("unexpected recap format");
  });
});
