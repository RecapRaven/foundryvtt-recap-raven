import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  connection,
  page,
  session,
  credential,
  response,
  askConnection,
  askResponse,
  playerCredential,
} from "./fixtures";
import { sha256 } from "../src/journals/import";
class ApplicationStub {
  static DEFAULT_OPTIONS = {};
  static instances: ApplicationStub[] = [];
  constructor() {
    ApplicationStub.instances.push(this);
  }
  element = document.createElement("div");
  async _renderHTML(): Promise<HTMLElement> {
    throw new Error("Override required");
  }
  _replaceHTML(result: HTMLElement, content: HTMLElement) {
    content.replaceChildren(result);
  }
  async render() {
    this._replaceHTML(await this._renderHTML(), this.element);
    return this;
  }
  async close() {
    this.element.replaceChildren();
    return this;
  }
}
let hooks: Map<string, (...args: unknown[]) => void>;
let settings: {
  register: ReturnType<typeof vi.fn>;
  registerMenu: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
};
let transport: ReturnType<typeof vi.fn<typeof fetch>>;
let user: { id: string; isGM: boolean };
let worldValues: Map<string, unknown>;
async function open() {
  await import("../src/main");
  hooks.get("init")!();
  const config = settings.registerMenu.mock.calls.find(
    (call) => call[1] === "setup",
  )![2] as {
    type: typeof ApplicationStub;
  };
  const app = new config.type();
  await app.render();
  return app;
}
function click(app: ApplicationStub, label: string) {
  const button = Array.from(app.element.querySelectorAll("button")).find(
    (b) => b.textContent === label,
  )!;
  expect(button).toBeTruthy();
  button.click();
}
async function connect(app: ApplicationStub, supplied = connection) {
  app.element.querySelector("input")!.value = credential;
  transport.mockResolvedValueOnce(response({ connection: supplied }));
  click(app, "Connect");
  await vi.waitFor(() =>
    expect(app.element.textContent).toContain("Connected."),
  );
}
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("isSecureContext", true);
  hooks = new Map();
  ApplicationStub.instances = [];
  worldValues = new Map();
  user = { id: "gm", isGM: true };
  settings = {
    register: vi.fn(),
    registerMenu: vi.fn(),
    set: vi.fn(async (_namespace: string, key: string, value: unknown) => {
      worldValues.set(key, value);
    }),
    get: vi.fn((_namespace: string, key: string) => worldValues.get(key)),
  };
  transport = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", transport);
  vi.stubGlobal("foundry", {
    applications: { api: { ApplicationV2: ApplicationStub } },
  });
  vi.stubGlobal("Hooks", {
    once: (name: string, callback: () => void) => hooks.set(name, callback),
    on: (name: string, callback: (...args: unknown[]) => void) =>
      hooks.set(name, callback),
  });
  vi.stubGlobal("game", {
    user,
    settings,
    journal: { contents: [], get: vi.fn() },
    folders: { contents: [] },
    i18n: { localize: (s: string) => s },
  });
  vi.stubGlobal("CONFIG", {
    JournalEntry: { documentClass: { create: vi.fn() } },
  });
});
afterEach(() => {
  window.dispatchEvent(new Event("beforeunload"));
  vi.unstubAllGlobals();
});
describe("GM settings and journal entry points", () => {
  it("provides the native AI control and can reopen after closing a healthy panel", async () => {
    const app = await open();
    const gm = { ...connection, mode: "gm" as const };
    transport.mockResolvedValue(
      response({ api_key: playerCredential, connection: askConnection }, 201),
    );
    await connect(app, gm);
    await vi.waitFor(() =>
      expect(app.element.textContent).toContain("Replace Ask access"),
    );
    const controls: Record<
      string,
      { onChange: (event: Event, active: boolean) => void }
    > = {};
    hooks.get("getSceneControlButtons")!(controls);
    expect(controls.recapRaven).toBeTruthy();
    transport.mockResolvedValue(response({ connection: askConnection }));
    controls.recapRaven!.onChange(new Event("click"), true);
    await vi.waitFor(() =>
      expect(
        ApplicationStub.instances.some((instance) =>
          instance.element.querySelector("textarea"),
        ),
      ).toBe(true),
    );
    const panel = ApplicationStub.instances.find((instance) =>
      instance.element.querySelector("textarea"),
    )!;
    await panel.close();
    const reopened: Record<string, unknown> = {};
    hooks.get("getSceneControlButtons")!(reopened);
    expect(reopened.recapRaven).toBeTruthy();
    expect(
      settings.set.mock.calls.some((call) =>
        String(call[2]).startsWith("raven_"),
      ),
    ).toBe(false);
  });
  it("loads shared player access without a management key or issuance relay", async () => {
    user.isGM = false;
    worldValues.set("connection", {
      id: connection.id,
      mode: "all",
      revision: 1,
    });
    worldValues.set("playerAccess", playerCredential);
    transport.mockImplementation(async () =>
      response({ connection: { ...askConnection, mode: "all" } }),
    );
    await import("../src/main");
    hooks.get("init")!();
    hooks.get("ready")!();
    await vi.waitFor(() => {
      const controls: Record<string, unknown> = {};
      hooks.get("getSceneControlButtons")!(controls);
      expect(controls.recapRaven).toBeTruthy();
    });
    expect(
      transport.mock.calls.every(
        ([url, options]) =>
          String(url).endsWith("/connection") && options?.method === "GET",
      ),
    ).toBe(true);
    expect(settings.set).not.toHaveBeenCalled();
    expect(
      [...hooks.keys()].some((name) => name.toLowerCase().includes("socket")),
    ).toBe(false);
    worldValues.set("playerAccess", credential);
    hooks.get("updateSetting")!(
      { key: "recap-raven.playerAccess" },
      {},
      {},
      "forged-gm",
    );
    await vi.waitFor(() => {
      const controls: Record<string, unknown> = {};
      hooks.get("getSceneControlButtons")!(controls);
      expect(controls).toEqual({});
    });
    expect(
      transport.mock.calls.every(
        ([url]) => !String(url).includes("player-access"),
      ),
    ).toBe(true);
  });
  it("keeps cached Ask controls hidden after a restriction succeeds but the world write fails", async () => {
    const app = await open();
    const shared = { ...askConnection, mode: "all" as const };
    worldValues.set("connection", {
      id: connection.id,
      mode: "all",
      revision: 1,
    });
    worldValues.set("playerAccess", playerCredential);
    transport.mockResolvedValue(response({ connection: shared }));
    await connect(app, { ...connection, mode: "all" });
    settings.set.mockRejectedValue(new Error("World write failed"));
    app.element.querySelector("select")!.value = "gm";
    transport.mockResolvedValue(
      response({ connection: { ...connection, mode: "gm", revision: 2 } }),
    );
    click(app, "Save visibility");
    await vi.waitFor(() =>
      expect(app.element.textContent).toContain(
        "Access updated; Foundry display could not be updated",
      ),
    );
    const controls: Record<string, unknown> = {};
    hooks.get("getSceneControlButtons")!(controls);
    expect(controls).toEqual({});
  });
  it("clears an active player answer on a local restriction without publishing it", async () => {
    user.isGM = false;
    worldValues.set("connection", {
      id: connection.id,
      mode: "all",
      revision: 1,
    });
    worldValues.set("playerAccess", playerCredential);
    transport.mockImplementation(async () =>
      response({ connection: { ...askConnection, mode: "all" } }),
    );
    await import("../src/main");
    hooks.get("init")!();
    hooks.get("ready")!();
    const controls: Record<
      string,
      { onChange: (event: Event, active: boolean) => void }
    > = {};
    await vi.waitFor(() => {
      hooks.get("getSceneControlButtons")!(controls);
      expect(controls.recapRaven).toBeTruthy();
    });
    controls.recapRaven!.onChange(new Event("click"), true);
    await vi.waitFor(() =>
      expect(
        ApplicationStub.instances.some((instance) =>
          instance.element.querySelector("textarea"),
        ),
      ).toBe(true),
    );
    const panel = ApplicationStub.instances.find((instance) =>
      instance.element.querySelector("textarea"),
    )!;
    transport.mockImplementation(async (url) =>
      response(
        String(url).endsWith("/ask/player")
          ? askResponse
          : { connection: { ...askConnection, mode: "all" } },
      ),
    );
    panel.element.querySelector("textarea")!.value = "Question";
    panel.element
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() =>
      expect(panel.element.textContent).toContain("Recover the bell."),
    );
    worldValues.set("connection", {
      id: connection.id,
      mode: "gm",
      revision: 2,
    });
    hooks.get("updateSetting")!(
      { key: "recap-raven.connection" },
      {},
      {},
      "gm",
    );
    expect(panel.element.textContent).not.toContain("Recover the bell.");
    expect(settings.set).not.toHaveBeenCalled();
    await panel.close();
  });
  it.each(["insecure", "missing crypto", "missing subtle"])(
    "does not display a credential flow in an %s browser",
    async (environment) => {
      if (environment === "insecure") vi.stubGlobal("isSecureContext", false);
      if (environment === "missing crypto") vi.stubGlobal("crypto", undefined);
      if (environment === "missing subtle") vi.stubGlobal("crypto", {});
      const app = await open();
      expect(app.element.textContent).toContain("HTTPS (or localhost)");
      expect(app.element.querySelector("input")).toBeNull();
      expect(app.element.querySelector("button")).toBeNull();
      expect(transport).not.toHaveBeenCalled();
      expect(settings.set).not.toHaveBeenCalled();
    },
  );
  it("clears a pending credential if secure capability is lost before connect", async () => {
    const app = await open();
    const input = app.element.querySelector("input")!;
    input.value = credential;
    vi.stubGlobal("isSecureContext", false);
    click(app, "Connect");
    await vi.waitFor(() =>
      expect(app.element.textContent).toContain("HTTPS (or localhost)"),
    );
    expect(input.value).toBe("");
    expect(app.element.querySelector("input")).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });
  it("registers a restricted native settings app and journal control without a canvas", async () => {
    const app = await open();
    expect(
      settings.registerMenu.mock.calls.find((call) => call[1] === "setup")![2],
    ).toMatchObject({
      restricted: true,
    });
    expect(settings.register.mock.calls[0]![2]).toMatchObject({
      config: false,
      scope: "world",
    });
    const controls: unknown[] = [];
    hooks.get("getHeaderControlsJournalDirectory")!({}, controls);
    expect(controls).toHaveLength(1);
    expect(controls[0]).toMatchObject({
      action: "recapRavenSetup",
      label: "RECAP_RAVEN.Setup",
    });
    expect(app.element.querySelector("input")?.type).toBe("password");
  });
  it("clears pasted credentials and never saves or renders them", async () => {
    const app = await open();
    await connect(app);
    expect(app.element.innerHTML).not.toContain(credential);
    expect(settings.set).not.toHaveBeenCalled();
    expect(JSON.stringify(settings.register.mock.calls)).not.toContain(
      credential,
    );
    click(app, "Disconnect");
    await vi.waitFor(() =>
      expect(app.element.textContent).toContain("Disconnected."),
    );
    expect(app.element.querySelector("input")?.value).toBe("");
  });
  it("previews titles as text and imports private HTML journals with keepId", async () => {
    const app = await open();
    await connect(app);
    transport
      .mockResolvedValueOnce(response({ connection }))
      .mockResolvedValueOnce(
        response({
          ...page,
          sessions: [
            { ...page.sessions[0], title: "<script>private()</script>" },
          ],
        }),
      );
    click(app, "Preview available recaps");
    await vi.waitFor(() =>
      expect(app.element.textContent).toContain(
        "1 completed recaps available.",
      ),
    );
    expect(app.element.querySelector("script")).toBeNull();
    expect(app.element.textContent).toContain("<script>private()</script>");
    const create = vi.mocked(CONFIG.JournalEntry.documentClass.create);
    create.mockImplementation(async (data) => ({
      id: data._id,
      getFlag: () => data.flags["recap-raven"]!.source,
    }));
    transport.mockResolvedValueOnce(
      response({
        session: { ...session, content_sha256: await sha256(session.markdown) },
      }),
    );
    click(app, "Import selected recaps");
    await vi.waitFor(() =>
      expect(app.element.textContent).toContain("Imported 1;"),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownership: { default: 0 },
        pages: [
          expect.objectContaining({
            type: "text",
            text: expect.objectContaining({ format: 1 }),
          }),
        ],
      }),
      { keepId: true },
    );
  });
  it("identifies a failed session and explains recovery without leaking response data", async () => {
    const app = await open();
    await connect(app);
    transport
      .mockResolvedValueOnce(response({ connection }))
      .mockResolvedValueOnce(response(page));
    click(app, "Preview available recaps");
    await vi.waitFor(() =>
      expect(app.element.textContent).toContain("1 completed recaps"),
    );
    transport.mockResolvedValueOnce(
      response({ secret: "private server details" }, 403),
    );
    click(app, "Import selected recaps");
    await vi.waitFor(() =>
      expect(app.element.textContent).toContain("failed 1"),
    );
    expect(app.element.textContent).toContain(
      "The bridge: Access is unavailable. Reconnect",
    );
    expect(app.element.textContent).not.toContain("private server details");
    expect(CONFIG.JournalEntry.documentClass.create).not.toHaveBeenCalled();
  });
  it("lets players recover shared access and open Ask without a canvas", async () => {
    user.isGM = false;
    await import("../src/main");
    hooks.get("init")!();
    const menu = settings.registerMenu.mock.calls.find(
      (call) => call[1] === "access",
    )![2];
    expect(menu.restricted).toBe(false);
    const app = new (menu.type as typeof ApplicationStub)();
    await app.render();
    expect(app.element.textContent).toContain("Ask is off or unavailable");
    expect(app.element.querySelector("textarea")).toBeNull();
    worldValues.set("connection", {
      id: connection.id,
      mode: "all",
      revision: 1,
    });
    worldValues.set("playerAccess", playerCredential);
    transport.mockImplementation(async () =>
      response({ connection: { ...askConnection, mode: "all" } }),
    );
    click(app, "Refresh access");
    await vi.waitFor(() =>
      expect(app.element.textContent).toContain(
        "campaign questions are available",
      ),
    );
    click(app, "Ask Recap Raven");
    await vi.waitFor(() =>
      expect(
        ApplicationStub.instances.some((instance) =>
          instance.element.querySelector("textarea"),
        ),
      ).toBe(true),
    );
    expect(settings.set).not.toHaveBeenCalled();
    expect(
      transport.mock.calls.every(([url]) =>
        String(url).endsWith("/connection"),
      ),
    ).toBe(true);
  });
  it("keeps world visibility unchanged after a rejected API update", async () => {
    const app = await open();
    await connect(app);
    transport.mockResolvedValueOnce(response({ error: "private" }, 403));
    click(app, "Save visibility");
    await vi.waitFor(() =>
      expect(app.element.textContent).toContain("Access is unavailable."),
    );
    expect(settings.set).not.toHaveBeenCalled();
  });
  it("refuses player setup and hides the journal control", async () => {
    const app = await open();
    user.isGM = false;
    hooks.get("updateUser")!();
    const controls: unknown[] = [];
    hooks.get("getHeaderControlsJournalDirectory")!({}, controls);
    expect(controls).toEqual([]);
    await expect(app.render()).rejects.toThrow("Only a GM");
  });
});
