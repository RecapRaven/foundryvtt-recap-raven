import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { RavenClient, ApiError } from "../src/api/client";
import {
  connection,
  session,
  summary,
  page,
  campaignId,
  sessionId,
  credential,
  response,
} from "./fixtures";
beforeEach(() => vi.stubGlobal("isSecureContext", true));
afterEach(() => vi.unstubAllGlobals());
describe("credential isolation and transport", () => {
  it.each(["insecure", "missing crypto", "missing subtle"])(
    "rejects credentials before network access in %s environments",
    (environment) => {
      const transport = vi.fn<typeof fetch>();
      if (environment === "insecure") vi.stubGlobal("isSecureContext", false);
      if (environment === "missing crypto") vi.stubGlobal("crypto", undefined);
      if (environment === "missing subtle") vi.stubGlobal("crypto", {});
      expect(() => new RavenClient(credential, transport)).toThrow(
        "HTTPS (or localhost)",
      );
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it("clears the credential and denies requests after secure capability loss", async () => {
    const transport = vi.fn<typeof fetch>();
    const client = new RavenClient(credential, transport);
    vi.stubGlobal("isSecureContext", false);
    await expect(client.connection()).rejects.toThrow("HTTPS (or localhost)");
    vi.stubGlobal("isSecureContext", true);
    await expect(client.connection()).rejects.toMatchObject({ status: 401 });
    expect(transport).not.toHaveBeenCalled();
  });
  it("sends only a bearer to the dedicated origin and omits browser credentials", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ connection }));
    const client = new RavenClient(credential, transport);
    await client.connection();
    const [url, options] = transport.mock.calls[0]!;
    expect(url).toBe(
      "https://api.recapraven.com/v1/integrations/foundry/connection",
    );
    expect(options).toMatchObject({
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Authorization: `Bearer ${credential}` },
    });
    expect(JSON.stringify(client)).not.toContain(credential);
    client.disconnect();
    await expect(client.connection()).rejects.toMatchObject({ status: 401 });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    "raven_mcp_" + "x".repeat(43),
    "raven_fpl_" + "x".repeat(43),
    "bad",
    credential + "\n",
  ])("rejects other credentials", (key) =>
    expect(() => new RavenClient(key)).toThrow(),
  );
  it.each([401, 403, 409, 429, 500])(
    "does not expose raw error bodies (%s)",
    async (status) => {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(response({ secret: credential }, status));
      await expect(
        new RavenClient(credential, transport).connection(),
      ).rejects.toBeInstanceOf(ApiError);
      try {
        await new RavenClient(credential, transport).connection();
      } catch (error) {
        expect(String(error)).not.toContain(credential);
      }
    },
  );
  it("does not expose network errors or retry", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(credential));
    await expect(
      new RavenClient(credential, transport).connection(),
    ).rejects.toMatchObject({ status: 0 });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("rejects content type, malformed JSON and oversized responses", async () => {
    for (const res of [
      new Response("{}"),
      new Response("{", { headers: { "Content-Type": "application/json" } }),
      new Response("x".repeat(2000001), {
        headers: { "Content-Type": "application/json" },
      }),
    ]) {
      await expect(
        new RavenClient(
          credential,
          vi.fn<typeof fetch>().mockResolvedValue(res),
        ).connection(),
      ).rejects.toThrow();
    }
  });
  it("patches only mode and revision", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ connection }));
    const client = new RavenClient(credential, transport);
    await client.settings("off", 1);
    expect(transport.mock.calls[0]![1]).toMatchObject({
      method: "PATCH",
      body: '{"mode":"off","revision":1}',
    });
    await expect(client.settings("gm", 0)).rejects.toThrow();
  });
  it("validates session identities", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ session }));
    const client = new RavenClient(credential, transport);
    expect(await client.session(sessionId, campaignId)).toEqual(session);
    transport.mockResolvedValue(
      response({ session: { ...session, campaign_id: sessionId } }),
    );
    await expect(client.session(sessionId, campaignId)).rejects.toThrow(
      "belong",
    );
  });
  it("collects multiple pages", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ ...page, has_more: true, next_cursor: "cursor_1" }),
      )
      .mockResolvedValueOnce(response({ ...page, sessions: [] }));
    expect(
      await new RavenClient(credential, transport).sessions(campaignId),
    ).toEqual([summary]);
    expect(transport.mock.calls[1]![0]).toContain("?cursor=cursor_1");
  });
  it("rejects cross campaign, repeated items and looping cursors", async () => {
    for (const pages of [
      [{ ...page, sessions: [{ ...summary, campaign_id: sessionId }] }],
      [{ ...page, has_more: true, next_cursor: "next" }, page],
      [
        { ...page, sessions: [], has_more: true, next_cursor: "next" },
        { ...page, sessions: [], has_more: true, next_cursor: "next" },
      ],
    ]) {
      const transport = vi.fn<typeof fetch>();
      for (const p of pages) transport.mockResolvedValueOnce(response(p));
      await expect(
        new RavenClient(credential, transport).sessions(campaignId),
      ).rejects.toThrow();
    }
  });
});
