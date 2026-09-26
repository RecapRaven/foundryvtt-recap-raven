import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { AskAccess } from "../src/ask/access";
import { AskController } from "../src/ask/controller";
import { ApiError } from "../src/api/transport";
import {
  connection,
  askConnection,
  playerCredential,
  askResponse,
} from "./fixtures";
import type { AskMode } from "../src/api/connection";
function fixture(mode: AskMode = "off") {
  let shared: unknown = "";
  let mirror: unknown = { id: connection.id, mode, revision: 1 };
  const host = {
    isGM: vi.fn(() => true),
    identity: vi.fn(() => "world:gm"),
    shared: () => shared,
    mirror: () => mirror,
    writeShared: vi.fn(async (value: string) => {
      shared = value;
    }),
    writeMirror: vi.fn(async (value: unknown) => {
      mirror = value;
    }),
    confirmed: vi.fn(),
  };
  const controller = new AskController(() => true, vi.fn());
  const reader = {
    connection: vi.fn().mockResolvedValue({ ...askConnection, mode: "all" }),
    ask: vi.fn().mockResolvedValue(askResponse),
    disconnect: vi.fn(),
  };
  const factory = vi.fn(() => reader);
  const access = new AskAccess(controller, host, factory);
  const management = {
    connection: vi.fn().mockResolvedValue({ ...connection, mode }),
    settings: vi.fn(async (next: AskMode) => ({
      ...connection,
      mode: next,
      revision: 2,
    })),
    playerAccess: vi.fn(async (revision: number) => ({
      api_key: playerCredential,
      connection: { ...askConnection, mode, revision },
    })),
  };
  return {
    access,
    controller,
    reader,
    factory,
    host,
    management,
    seed: (token: unknown, value: unknown = mirror) => {
      shared = token;
      mirror = value;
    },
  };
}
beforeEach(() => vi.stubGlobal("isSecureContext", true));
afterEach(() => vi.unstubAllGlobals());
describe("role visibility and restricted capability distribution", () => {
  it.each(["off", "gm", "all"] as const)(
    "connects in %s mode without ever sharing a GM capability",
    async (mode) => {
      const f = fixture(mode);
      await f.access.connect(f.management, { ...connection, mode });
      expect(
        f.host.writeShared.mock.calls.every(
          ([value]) => value === "" || value.startsWith("raven_fpl_"),
        ),
      ).toBe(true);
      expect(f.management.playerAccess).toHaveBeenCalledTimes(
        mode === "off" ? 0 : 1,
      );
      expect(f.host.writeShared).toHaveBeenCalledTimes(mode === "all" ? 1 : 0);
      expect(f.access.eligible).toBe(mode !== "off");
    },
  );
  it("does not read a world credential or create a client in an insecure browser", async () => {
    const f = fixture("all");
    const read = vi.spyOn(f.host, "shared");
    vi.stubGlobal("isSecureContext", false);
    expect(await f.access.restoreShared()).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(f.factory).not.toHaveBeenCalled();
  });
  it("preserves GM-only memory access when its matching local metadata is refreshed", async () => {
    const f = fixture("gm");
    f.reader.connection.mockResolvedValue({ ...askConnection, mode: "gm" });
    await f.access.connect(f.management, { ...connection, mode: "gm" });
    await f.access.sharedChanged();
    expect(f.access.eligible).toBe(true);
    expect(f.host.writeShared).not.toHaveBeenCalled();
  });
  it("rejects a replaced world credential while validation is still in flight", async () => {
    const f = fixture("all");
    f.seed(playerCredential);
    let resolve!: (
      value: Omit<typeof askConnection, "mode"> & { mode: "all" },
    ) => void;
    f.reader.connection.mockImplementation(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const restore = f.access.restoreShared();
    f.seed("raven_fpl_" + "z".repeat(43));
    resolve({ ...askConnection, mode: "all" });
    expect(await restore).toBe(false);
    expect(f.access.eligible).toBe(false);
  });
  it("does not publish a key after an intervening restriction during mirror persistence", async () => {
    const f = fixture("off");
    await f.access.connect(f.management, connection);
    f.management.playerAccess.mockImplementation(async (revision) => ({
      api_key: playerCredential,
      connection: { ...askConnection, mode: "all", revision },
    }));
    let release!: () => void;
    f.host.writeMirror
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
    const save = f.access.saveMode("all");
    await vi.waitFor(() =>
      expect(f.management.playerAccess).toHaveBeenCalled(),
    );
    await vi.waitFor(() => expect(f.access.writing).toBe(true));
    f.access.disconnect();
    release();
    await save;
    expect(f.host.writeShared).not.toHaveBeenCalled();
    expect(f.controller.canOpen).toBe(false);
  });
  it("reuses an existing valid shared capability without replacing other clients", async () => {
    const f = fixture("all");
    f.seed(playerCredential);
    await f.access.connect(f.management, { ...connection, mode: "all" });
    expect(f.management.playerAccess).not.toHaveBeenCalled();
    expect(f.host.writeShared).not.toHaveBeenCalled();
    expect(f.access.eligible).toBe(true);
  });
  for (const initial of ["off", "gm", "all"] as const)
    for (const next of ["off", "gm", "all"] as const)
      it(`updates ${initial} → ${next} on the API before issuing or publishing`, async () => {
        const f = fixture(initial);
        await f.access.connect(f.management, { ...connection, mode: initial });
        vi.clearAllMocks();
        const order: string[] = [];
        f.management.settings.mockImplementation(async () => {
          order.push("api");
          return { ...connection, mode: next, revision: 2 };
        });
        f.management.playerAccess.mockImplementation(async (revision) => {
          order.push("issue");
          return {
            api_key: playerCredential,
            connection: { ...askConnection, mode: next, revision },
          };
        });
        await f.access.saveMode(next);
        expect(order[0]).toBe("api");
        expect(order.filter((step) => step === "issue")).toHaveLength(
          next === "off" ? 0 : 1,
        );
        if (next !== "all")
          expect(
            f.host.writeShared.mock.calls.every(([value]) => value === ""),
          ).toBe(true);
        else expect(f.host.writeShared).toHaveBeenCalledWith(playerCredential);
        expect(f.access.eligible).toBe(next !== "off");
      });
  it("retains server restrictions when mirroring fails and never issues against stale visibility", async () => {
    const f = fixture("all");
    await f.access.connect(f.management, { ...connection, mode: "all" });
    f.management.playerAccess.mockClear();
    f.host.writeMirror.mockRejectedValue(new Error("offline"));
    await expect(f.access.saveMode("gm")).rejects.toThrow("Access updated");
    expect(f.host.confirmed).toHaveBeenLastCalledWith({
      ...connection,
      mode: "gm",
      revision: 2,
    });
    expect(f.management.playerAccess).not.toHaveBeenCalled();
    expect(f.access.eligible).toBe(false);
  });
  it("fails closed when sharing newly issued access fails and offers explicit recovery", async () => {
    const f = fixture("all");
    await f.access.connect(f.management, { ...connection, mode: "all" });
    f.host.writeShared.mockRejectedValue(new Error("offline"));
    await expect(f.access.replace()).rejects.toThrow("sharing failed");
    expect(f.access.eligible).toBe(false);
  });
  it("refreshes on a revision conflict without issuing a key", async () => {
    const f = fixture("off");
    await f.access.connect(f.management, connection);
    f.management.settings.mockRejectedValue(new ApiError(409));
    await expect(f.access.saveMode("all")).rejects.toThrow();
    expect(f.management.connection).toHaveBeenCalledTimes(1);
    expect(f.management.playerAccess).not.toHaveBeenCalled();
  });
  it("never gives players management, issuance, or a GM-only shared key", async () => {
    const f = fixture("all");
    f.host.isGM.mockReturnValue(false);
    f.seed(playerCredential);
    expect(await f.access.restoreShared()).toBe(true);
    await expect(f.access.replace()).rejects.toThrow("connected GM");
    await expect(f.access.saveMode("all")).rejects.toThrow("connected GM");
    await expect(f.access.connect(f.management, connection)).rejects.toThrow();
    expect(f.management.playerAccess).not.toHaveBeenCalled();
    f.reader.connection.mockResolvedValue({ ...askConnection, mode: "gm" });
    await f.access.sharedChanged();
    expect(f.access.eligible).toBe(false);
  });
  it.each(["malformed", "foreign", "expired", "wrong mode"])(
    "rejects %s world capability data",
    async (kind) => {
      const f = fixture("all");
      f.seed(
        kind === "malformed" ? "raven_fgm_" + "x".repeat(43) : playerCredential,
      );
      if (kind === "foreign")
        f.reader.connection.mockResolvedValue({
          ...askConnection,
          mode: "all",
          id: askConnection.campaign.id,
        });
      if (kind === "expired")
        f.reader.connection.mockRejectedValue(new Error("expired"));
      if (kind === "wrong mode")
        f.seed(playerCredential, {
          id: connection.id,
          mode: "gm",
          revision: 1,
        });
      expect(await f.access.restoreShared()).toBe(false);
      expect(f.access.eligible).toBe(false);
    },
  );
  it("discards a late issuance after disconnect, role loss, or world change", async () => {
    for (const loss of ["disconnect", "role", "world"]) {
      const f = fixture("off");
      await f.access.connect(f.management, connection);
      let resolve!: (
        value: Awaited<ReturnType<typeof f.management.playerAccess>>,
      ) => void;
      f.management.playerAccess.mockImplementation(
        () =>
          new Promise((yes) => {
            resolve = yes;
          }),
      );
      const save = f.access.saveMode("all");
      await vi.waitFor(() =>
        expect(f.management.playerAccess).toHaveBeenCalled(),
      );
      if (loss === "disconnect") f.access.disconnect();
      if (loss === "role") f.host.isGM.mockReturnValue(false);
      if (loss === "world") f.host.identity.mockReturnValue("different");
      resolve({
        api_key: playerCredential,
        connection: { ...askConnection, mode: "all", revision: 2 },
      });
      await save;
      expect(
        f.host.writeShared.mock.calls.every(([value]) => value === ""),
      ).toBe(true);
      expect(f.access.eligible).toBe(false);
    }
  });
});
