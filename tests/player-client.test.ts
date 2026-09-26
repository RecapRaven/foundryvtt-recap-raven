import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { RavenAskClient } from "../src/api/ask-client";
import { RavenClient } from "../src/api/client";
import { parsePlayerAccess } from "../src/api/player-access";
import {
  askConnection,
  askResponse,
  campaignId,
  credential,
  playerCredential,
  connection,
  response,
} from "./fixtures";
beforeEach(() => vi.stubGlobal("isSecureContext", true));
afterEach(() => vi.unstubAllGlobals());
describe("separate management and player-safe capabilities", () => {
  it("rejects management credentials for Ask and Ask credentials for management", () => {
    expect(() => new RavenAskClient(credential)).toThrow();
    expect(() => new RavenClient(playerCredential)).toThrow();
    expect(new RavenClient(credential)).not.toHaveProperty("ask");
    expect(new RavenAskClient(playerCredential)).not.toHaveProperty("settings");
  });
  it("asks only on the player route with an exact question and no identity overrides", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(askResponse));
    await new RavenAskClient(playerCredential, transport).ask(
      "  Question 🪶  ",
      campaignId,
    );
    expect(transport.mock.calls[0]![0]).toBe(
      "https://api.recapraven.com/v1/integrations/foundry/ask/player",
    );
    expect(transport.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      credentials: "omit",
      body: JSON.stringify({ question: "Question 🪶" }),
      headers: { Authorization: `Bearer ${playerCredential}` },
    });
  });
  it("enforces Unicode question bounds before transport", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(askResponse));
    const client = new RavenAskClient(playerCredential, transport);
    await client.ask("🪶".repeat(500), campaignId);
    await expect(
      client.ask("🪶".repeat(501), campaignId),
    ).rejects.toMatchObject({ status: 400 });
    await expect(client.ask(" ", campaignId)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("never retries uncertain Ask outcomes or reveals raw error bodies", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(playerCredential));
    const client = new RavenAskClient(playerCredential, transport);
    await expect(client.ask("Question", campaignId)).rejects.toThrow(
      "Credits may have been used",
    );
    expect(transport).toHaveBeenCalledTimes(1);
    transport.mockResolvedValue(
      response({ ...askResponse, private: "hidden" }),
    );
    await expect(client.ask("Question", campaignId)).rejects.toThrow(
      "Credits may have been used",
    );
    transport.mockResolvedValue(response({ secret: playerCredential }, 402));
    await expect(client.ask("Question", campaignId)).rejects.toMatchObject({
      status: 402,
    });
  });
  it("accepts player-safe Ask access in GM-only mode but never a GM response audience", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ connection: askConnection }));
    const client = new RavenAskClient(playerCredential, transport);
    expect((await client.connection()).mode).toBe("gm");
    transport.mockResolvedValue(response({ connection }));
    await expect(client.connection()).rejects.toThrow();
    transport.mockResolvedValue(
      response({ connection: { ...askConnection, expires_at: null } }),
    );
    await expect(client.connection()).rejects.toThrow();
  });
  it("issues a restricted capability using only management auth and expected revision", async () => {
    const issued = { api_key: playerCredential, connection: askConnection };
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(issued, 201));
    const client = new RavenClient(credential, transport);
    expect(await client.playerAccess(1)).toEqual(issued);
    expect(transport.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      body: '{"revision":1}',
      headers: { Authorization: `Bearer ${credential}` },
    });
    await expect(client.playerAccess(0)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    { api_key: credential, connection: askConnection },
    { api_key: playerCredential, connection },
    {
      api_key: playerCredential,
      connection: { ...askConnection, mode: "off", can_ask: false },
    },
    {
      api_key: playerCredential,
      connection: { ...askConnection, expires_at: null },
    },
    { api_key: playerCredential, connection: askConnection, secret: "extra" },
  ])("rejects malformed or overbroad issuance %j", (value) =>
    expect(() => parsePlayerAccess(value)).toThrow(),
  );
});
