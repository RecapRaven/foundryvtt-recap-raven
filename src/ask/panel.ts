import type { AskController } from "./controller";
import type { AskSource } from "../api/ask";
import { renderRecap } from "../journals/render";
import { findJournal, type JournalStore } from "../journals/import";

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}
export function sourceCard(
  source: AskSource,
  campaignId: string,
  store: JournalStore,
): HTMLElement {
  const card = element("details");
  const title = element("summary", `[${source.number}] ${source.title}`);
  card.append(title);
  if (source.excerpt !== null)
    card.append(element("blockquote", source.excerpt));
  if (source.session_id !== null) {
    const sessionId = source.session_id;
    const journal = findJournal(store, campaignId, sessionId);
    if (journal?.testUserPermission?.(game.user, "OBSERVER") && journal.sheet) {
      const open = element("button", "Open session recap");
      open.type = "button";
      open.addEventListener("click", () => {
        const current = findJournal(store, campaignId, sessionId);
        if (current?.testUserPermission?.(game.user, "OBSERVER"))
          void current.sheet?.render({ force: true });
      });
      card.append(open);
    }
  }
  return card;
}
export function createAskPanel(controller: AskController, store: JournalStore) {
  return class RavenAsk extends foundry.applications.api.ApplicationV2 {
    static override DEFAULT_OPTIONS = {
      id: "recap-raven-ask",
      classes: ["recap-raven"],
      window: {
        title: "Ask Recap Raven",
        icon: "fa-solid fa-wand-magic-sparkles",
      },
      position: { width: 640, height: 700 },
    };
    #draft = "";
    #renderedState = "";
    #unsubscribe: (() => void) | undefined;
    async open(): Promise<void> {
      this.#unsubscribe ??= controller.subscribe(() => {
        if (!controller.state.authorized) {
          this.#renderedState = "";
          this.#draft = "";
          this.element?.querySelector(".rr-content")?.replaceChildren();
        }
        if (controller.state.active) void this.render({ force: true });
      });
      await controller.open();
      if (controller.state.active) await this.render({ force: true });
    }
    override async close(): Promise<this> {
      this.#unsubscribe?.();
      this.#unsubscribe = undefined;
      this.#renderedState = "";
      this.#draft = "";
      this.element?.querySelector(".rr-content")?.replaceChildren();
      controller.close();
      return super.close();
    }
    protected override async _renderHTML(): Promise<HTMLElement> {
      return this.content();
    }
    protected override _replaceHTML(
      _result: HTMLElement,
      content: HTMLElement,
    ): void {
      // Revalidate at replacement time. Unchanged polling results must not
      // replace focused inputs, collapse evidence, or reset scroll positions.
      const state = JSON.stringify([
        controller.state,
        controller.canOpen,
        controller.connection?.campaign.id,
      ]);
      if (state === this.#renderedState && content.firstChild) return;
      this.#renderedState = state;
      const input = content.querySelector("textarea");
      const focused = input && document.activeElement === input;
      const selection = input
        ? ([input.selectionStart, input.selectionEnd] as const)
        : undefined;
      content.replaceChildren(this.content());
      const replacement = content.querySelector("textarea");
      if (focused && replacement && !replacement.disabled && selection) {
        replacement.focus({ preventScroll: true });
        replacement.setSelectionRange(...selection);
      }
    }
    private content(): HTMLElement {
      const state = controller.state;
      const content = element("div");
      content.className = "rr-content";
      content.append(
        element(
          "p",
          "Player-safe campaign answers — visible only in this browser.",
        ),
      );
      const status = element("p", state.status);
      status.setAttribute("role", "status");
      status.className = "rr-status";
      content.append(status);
      if (!state.authorized || !controller.canOpen) return content;
      const form = element("form");
      const label = element("label", "Campaign question");
      const input = element("textarea");
      input.rows = 3;
      input.value = this.#draft;
      input.disabled = state.pending;
      input.placeholder = "What did we promise the ferryman?";
      input.setAttribute("aria-describedby", "recap-raven-question-hint");
      input.addEventListener("input", () => {
        this.#draft = input.value;
      });
      label.append(input);
      form.append(label);
      const hint = element(
        "p",
        "Up to 500 characters. Each submission is a new question.",
      );
      hint.id = "recap-raven-question-hint";
      form.append(hint);
      const submit = element(
        "button",
        state.pending ? "Asking…" : "Ask Recap Raven",
      );
      submit.type = "submit";
      submit.disabled = state.pending;
      form.append(submit);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!state.pending) void controller.submit(input.value);
      });
      content.append(form);
      if (state.result) {
        const answer = element("section");
        answer.className = "rr-answer";
        answer.setAttribute("aria-label", "Answer");
        const result = state.result.result;
        const kind = {
          answer: "Answer",
          abstain: "Not enough evidence",
          clarify: "Please clarify",
          link: "Campaign source",
        }[result.kind];
        answer.append(element("h2", kind));
        const markdown = element("div");
        markdown.innerHTML = renderRecap(result.answer_markdown);
        answer.append(markdown);
        if (result.kind === "clarify")
          answer.append(
            element("p", "Rephrase and submit a complete new question."),
          );
        if (result.coverage)
          answer.append(
            element(
              "p",
              `Campaign memory covers ${result.coverage.sessions_with_memory} of ${result.coverage.sessions_total} sessions.`,
            ),
          );
        if (result.confidence)
          answer.append(element("p", `Confidence: ${result.confidence}.`));
        for (const source of result.sources)
          answer.append(
            sourceCard(source, controller.connection!.campaign.id, store),
          );
        const credits = state.result.credits;
        answer.append(
          element(
            "p",
            `Credits used: ${credits.used}.${credits.remaining === null ? "" : ` Remaining: ${credits.remaining}.`}`,
          ),
        );
        content.append(answer);
      }
      return content;
    }
  };
}
