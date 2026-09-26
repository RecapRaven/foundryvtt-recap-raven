import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { AskController } from "../src/ask/controller";
import { AskError } from "../src/api/ask";
import { askConnection, askResponse, connection } from "./fixtures";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const client = {
    connection: vi.fn().mockResolvedValue(askConnection),
    ask: vi.fn().mockResolvedValue(askResponse),
  };
  const eligible = vi.fn(() => true);
  const confirmed = vi.fn();
  const controller = new AskController(eligible, confirmed);
  controller.configure(client, askConnection);
  return { client, eligible, confirmed, controller };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("transient player-safe Ask authorization lifecycle", () => {
  it("refreshes before opening, before a question and before displaying its result", async () => {
    const { controller, client } = fixture();
    await controller.open();
    await controller.submit("  Where is the bell?  ");
    expect(client.connection).toHaveBeenCalledTimes(3);
    expect(client.ask).toHaveBeenCalledWith(
      "Where is the bell?",
      askConnection.campaign.id,
    );
    expect(controller.state.result).toEqual(askResponse);
    expect(controller.state.pending).toBe(false);
    controller.close();
  });
  it("keeps a healthy entry point on close but not after failed authorization", async () => {
    const { controller, client } = fixture();
    await controller.open();
    await controller.submit("Question");
    controller.close();
    expect(controller.canOpen).toBe(true);
    expect(controller.state.result).toBeNull();
    expect(controller.state.question).toBe("");
    await controller.open();
    expect(controller.state.authorized).toBe(true);
    client.connection.mockRejectedValue(new Error("revoked"));
    await controller.refresh();
    controller.close();
    expect(controller.canOpen).toBe(false);
  });
  it("polls every 30 seconds while active and stops on close", async () => {
    const { controller, client } = fixture();
    await controller.open();
    await vi.advanceTimersByTimeAsync(30000);
    expect(client.connection).toHaveBeenCalledTimes(2);
    controller.close();
    await vi.advanceTimersByTimeAsync(60000);
    expect(client.connection).toHaveBeenCalledTimes(2);
    expect(controller.state.question).toBe("");
  });
  it.each(["role", "off", "disconnect", "hidden", "world"])(
    "discards an in-flight result after %s loss",
    async (loss) => {
      const { controller, client, eligible } = fixture();
      await controller.open();
      const pending = deferred<typeof askResponse>();
      client.ask.mockReturnValue(pending.promise);
      const request = controller.submit("Question");
      await vi.advanceTimersByTimeAsync(0);
      expect(client.ask).toHaveBeenCalledTimes(1);
      if (loss === "off") controller.configure(client, connection);
      else if (loss === "disconnect")
        controller.configure(undefined, undefined);
      else {
        eligible.mockReturnValue(false);
        controller.invalidate();
      }
      pending.resolve(askResponse);
      await request;
      expect(controller.state.result).toBeNull();
      expect(controller.state.question).toBe("");
      expect(controller.state.authorized).toBe(false);
      controller.close();
    },
  );
  it("denies stale refreshes after disconnect and clears results after a failed poll", async () => {
    const { controller, client } = fixture();
    await controller.open();
    await controller.submit("Question");
    client.connection.mockRejectedValue(new Error("offline"));
    await controller.refresh();
    expect(controller.state.result).toBeNull();
    expect(controller.state.authorized).toBe(false);
    const pending = deferred<typeof askConnection>();
    client.connection.mockReturnValue(pending.promise);
    const refresh = controller.refresh();
    controller.configure(undefined, undefined);
    pending.resolve(askConnection);
    expect(await refresh).toBe(false);
    controller.close();
  });
  it("coalesces concurrent refreshes and blocks duplicate submissions including preflight", async () => {
    const { controller, client } = fixture();
    await controller.open();
    const pending = deferred<typeof askConnection>();
    client.connection.mockReturnValueOnce(pending.promise);
    const first = controller.submit("First");
    await controller.submit("Second");
    const refresh = controller.refresh();
    expect(client.connection).toHaveBeenCalledTimes(2);
    pending.resolve(askConnection);
    await Promise.all([first, refresh]);
    expect(client.ask).toHaveBeenCalledTimes(1);
    controller.close();
  });
  it("never retries a chargeable timeout and preserves its uncertainty message", async () => {
    const { controller, client } = fixture();
    await controller.open();
    client.ask.mockRejectedValue(new AskError(0));
    await controller.submit("Question");
    expect(client.ask).toHaveBeenCalledTimes(1);
    expect(controller.state.status).toContain("Credits may have been used");
    controller.close();
  });
  it("clears question and disables Ask after direct authorization denial", async () => {
    const { controller, client } = fixture();
    await controller.open();
    client.ask.mockRejectedValue(new AskError(403));
    await controller.submit("Question");
    expect(controller.state.authorized).toBe(false);
    expect(controller.state.question).toBe("");
    controller.close();
  });
  it("rejects empty, oversized and inactive questions locally", async () => {
    const { controller, client } = fixture();
    await controller.submit("Before open");
    await controller.open();
    await controller.submit(" ");
    await controller.submit("🪶".repeat(501));
    expect(client.ask).not.toHaveBeenCalled();
    controller.close();
  });
  it("denies switched campaign/audience and off connections", async () => {
    for (const modified of [
      connection,
      {
        ...askConnection,
        campaign: { ...askConnection.campaign, id: askConnection.id },
      },
      { ...askConnection, audience: "gm" as const },
    ]) {
      const { controller, client } = fixture();
      client.connection.mockResolvedValue(modified);
      await controller.open();
      expect(controller.state.authorized).toBe(false);
      controller.close();
    }
  });
  it("does not poll a hidden or ineligible client", async () => {
    const { controller, eligible, client } = fixture();
    await controller.open();
    eligible.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(30000);
    expect(client.connection).toHaveBeenCalledTimes(1);
    expect(controller.state.authorized).toBe(false);
    controller.close();
  });
});
