import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { AskController } from "../src/ask/controller";
import { createAskPanel, sourceCard } from "../src/ask/panel";
import { askConnection, askResponse, campaignId } from "./fixtures";
import type { JournalStore, Journal } from "../src/journals/import";
class ApplicationStub {
  static DEFAULT_OPTIONS = {};
  element = document.createElement("div");
  async _renderHTML(): Promise<HTMLElement> {
    throw new Error("Override");
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
const emptyStore: JournalStore = {
  all: () => [],
  get: () => undefined,
  create: async () => undefined,
};
beforeEach(() => {
  vi.stubGlobal("foundry", {
    applications: { api: { ApplicationV2: ApplicationStub } },
  });
  vi.stubGlobal("game", { user: { id: "gm", isGM: true } });
});
afterEach(() => vi.unstubAllGlobals());
describe("private Ask panel and evidence cards", () => {
  it("shows safe evidence without disclosing restricted local journal metadata", () => {
    const render = vi.fn();
    const journal: Journal = {
      id: "private-local",
      getFlag: () => ({
        campaignId,
        sessionId: askResponse.result.sources[0]!.session_id,
      }),
      testUserPermission: () => false,
      sheet: { render },
    };
    const store = { ...emptyStore, all: () => [journal] };
    const card = sourceCard(askResponse.result.sources[0]!, campaignId, store);
    expect(card.textContent).toContain("Recover the bell.");
    expect(card.querySelector("button")).toBeNull();
    expect(card.innerHTML).not.toContain("private-local");
    expect(card.querySelector("a")).toBeNull();
    expect(render).not.toHaveBeenCalled();
  });
  it("checks journal permission again when opening the imported recap", () => {
    const permission = vi.fn(() => true);
    const render = vi.fn();
    const journal: Journal = {
      id: "local",
      getFlag: () => ({
        campaignId,
        sessionId: askResponse.result.sources[0]!.session_id,
      }),
      testUserPermission: permission,
      sheet: { render },
    };
    const card = sourceCard(askResponse.result.sources[0]!, campaignId, {
      ...emptyStore,
      all: () => [journal],
    });
    const button = card.querySelector("button")!;
    expect(button.textContent).toBe("Open session recap");
    button.click();
    expect(render).toHaveBeenCalledTimes(1);
    permission.mockReturnValue(false);
    button.click();
    expect(render).toHaveBeenCalledTimes(1);
  });
  it("keeps non-session sources as evidence cards without fabricating a journal target", () => {
    const card = sourceCard(
      { number: 1, title: "Lore", excerpt: null, session_id: null },
      campaignId,
      emptyStore,
    );
    expect(card.textContent).toBe("[1] Lore");
    expect(card.querySelector("a,button")).toBeNull();
  });
  it("renders sanitized answers and clears the DOM synchronously after access loss", async () => {
    const client = {
      connection: vi.fn().mockResolvedValue(askConnection),
      ask: vi.fn().mockResolvedValue({
        ...askResponse,
        result: {
          ...askResponse.result,
          answer_markdown:
            '**Bell** <img src="https://tracking.example"> [[1d20]]',
        },
      }),
    };
    const controller = new AskController(() => true, vi.fn());
    controller.configure(client, askConnection);
    const Panel = createAskPanel(controller, emptyStore);
    const panel = new Panel();
    await panel.open();
    await controller.submit("Question");
    await panel.render({ force: true });
    expect(panel.element.textContent).toContain("Player-safe campaign answers");
    expect(panel.element.querySelector("strong")?.textContent).toBe("Bell");
    expect(panel.element.querySelector("img")).toBeNull();
    expect(panel.element.textContent).toContain(
      "Campaign memory covers 1 of 2 sessions.",
    );
    const old = await (panel as unknown as ApplicationStub)._renderHTML();
    controller.invalidate();
    expect(panel.element.querySelector(".rr-answer")).toBeNull();
    (panel as unknown as ApplicationStub)._replaceHTML(old, panel.element);
    expect(panel.element.textContent).not.toContain("Recover the bell");
    await panel.close();
  });
  it("preserves focus, selection, evidence and scroll during background refresh", async () => {
    const client = {
      connection: vi.fn().mockResolvedValue(askConnection),
      ask: vi.fn().mockResolvedValue(askResponse),
    };
    const controller = new AskController(() => true, vi.fn());
    controller.configure(client, askConnection);
    const Panel = createAskPanel(controller, emptyStore);
    const panel = new Panel();
    document.body.append(panel.element);
    try {
      await panel.open();
      await controller.submit("First question");
      await panel.render({ force: true });
      const input = panel.element.querySelector("textarea")!;
      input.value = "My next question";
      input.dispatchEvent(new Event("input"));
      input.focus();
      input.setSelectionRange(3, 7);
      const evidence = panel.element.querySelector("details")!;
      evidence.open = true;
      const content = panel.element.querySelector(".rr-content")!;
      content.scrollTop = 75;
      await controller.refresh();
      await panel.render({ force: true });
      expect(panel.element.querySelector("textarea")).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("My next question");
      expect([input.selectionStart, input.selectionEnd]).toEqual([3, 7]);
      expect(evidence.open).toBe(true);
      expect(content.scrollTop).toBe(75);
      controller.invalidate();
      expect(panel.element.querySelector("textarea")).toBeNull();
      expect(panel.element.querySelector("details")).toBeNull();
    } finally {
      await panel.close();
      panel.element.remove();
    }
  });
  it("keeps the draft selection when displaying question validation feedback", async () => {
    const client = {
      connection: vi.fn().mockResolvedValue(askConnection),
      ask: vi.fn(),
    };
    const controller = new AskController(() => true, vi.fn());
    controller.configure(client, askConnection);
    const Panel = createAskPanel(controller, emptyStore);
    const panel = new Panel();
    document.body.append(panel.element);
    try {
      await panel.open();
      const input = panel.element.querySelector("textarea")!;
      input.value = "x".repeat(501);
      input.dispatchEvent(new Event("input"));
      input.focus();
      input.setSelectionRange(490, 501);
      await controller.submit(input.value);
      await panel.render({ force: true });
      const replacement = panel.element.querySelector("textarea")!;
      expect(document.activeElement).toBe(replacement);
      expect(replacement.value).toHaveLength(501);
      expect([replacement.selectionStart, replacement.selectionEnd]).toEqual([
        490, 501,
      ]);
      expect(panel.element.textContent).toContain("between 1 and 500");
      expect(client.ask).not.toHaveBeenCalled();
    } finally {
      await panel.close();
      panel.element.remove();
    }
  });
  it("renders all result kinds and accepts keyboard form submission", async () => {
    for (const kind of ["answer", "abstain", "clarify", "link"] as const) {
      const client = {
        connection: vi.fn().mockResolvedValue(askConnection),
        ask: vi.fn().mockResolvedValue({
          ...askResponse,
          result: {
            ...askResponse.result,
            kind,
            confidence: null,
            coverage: null,
            sources: [],
          },
          credits: { used: 0, remaining: null },
        }),
      };
      const controller = new AskController(() => true, vi.fn());
      controller.configure(client, askConnection);
      const Panel = createAskPanel(controller, emptyStore);
      const panel = new Panel();
      await panel.open();
      const input = panel.element.querySelector("textarea")!;
      input.value = "Question";
      input.dispatchEvent(new Event("input"));
      panel.element
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { cancelable: true }));
      await vi.waitFor(() =>
        expect(controller.state.result?.result.kind).toBe(kind),
      );
      await panel.render({ force: true });
      if (kind === "clarify")
        expect(panel.element.textContent).toContain("Rephrase and submit");
      expect(panel.element.querySelector(".rr-answer")).not.toBeNull();
      await panel.close();
    }
  });
});
