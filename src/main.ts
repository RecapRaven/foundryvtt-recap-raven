import { AskController } from "./ask/controller";
import { createAskPanel } from "./ask/panel";
import { requireSecureBrowser } from "./api/environment";
import { RavenClient } from "./api/client";
import type { AskMode, Connection } from "./api/connection";
import type { SessionSummary } from "./api/contract";
import {
  MODULE_ID,
  importSession,
  findJournal,
  type JournalStore,
} from "./journals/import";
import { importFailureMessage } from "./journals/errors";
import { AskAccess } from "./ask/access";

const store: JournalStore = {
  all: () => game.journal.contents,
  get: (id) => game.journal.get(id),
  create: (data) =>
    CONFIG.JournalEntry.documentClass.create(data, { keepId: true }),
};
let client: RavenClient | undefined;
let connection: Connection | undefined;
let generation = 0;
let connectedIdentity: string | undefined;
function currentIdentity(): string {
  return `${game.world?.id ?? ""}:${game.user?.id ?? ""}`;
}
const ask: AskController = new AskController(
  () => !document.hidden && access.eligible,
  () => updateControls(),
);
const access: AskAccess = new AskAccess(ask, {
  isGM: () => !!game.user?.isGM,
  identity: currentIdentity,
  shared: () => game.settings.get(MODULE_ID, "playerAccess"),
  mirror: () => game.settings.get(MODULE_ID, "connection"),
  writeShared: async (value) => {
    await game.settings.set(MODULE_ID, "playerAccess", value);
  },
  writeMirror: async (value) => {
    await game.settings.set(MODULE_ID, "connection", value);
  },
  confirmed: confirmConnection,
});
ask.subscribe(updateControls);
const AskPanel = createAskPanel(ask, store);
let askPanel: InstanceType<typeof AskPanel> | undefined;
function updateControls(): void {
  if (typeof ui !== "undefined") ui.controls?.render();
}
function confirmConnection(value: Connection): void {
  if (
    connection &&
    (connection.id !== value.id || connection.mode !== value.mode)
  )
    ask.invalidate("Access changed. Open Ask again to continue.");
  connection = value;
  updateControls();
}
async function openAsk(): Promise<void> {
  askPanel ??= new AskPanel();
  await askPanel.open();
}
function disconnect(): void {
  generation++;
  client?.disconnect();
  client = undefined;
  connection = undefined;
  connectedIdentity = undefined;
  access.disconnect();
  ask.close();
  void askPanel?.close();
  updateControls();
}
function requireGM(): void {
  if (!game.user?.isGM) {
    disconnect();
    throw new Error("Only a GM can manage Recap Raven.");
  }
}
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

class RavenSetup extends foundry.applications.api.ApplicationV2 {
  static override DEFAULT_OPTIONS = {
    id: "recap-raven-setup",
    classes: ["recap-raven"],
    window: { title: "Recap Raven", icon: "fa-solid fa-crow" },
    position: { width: 620, height: 650 },
  };
  #sessions: SessionSummary[] = [];
  #busy = false;
  #status = "";
  protected override async _renderHTML(): Promise<HTMLElement> {
    requireGM();
    const content = element("div");
    content.className = "rr-content";
    try {
      requireSecureBrowser();
    } catch (error) {
      disconnect();
      this.#sessions = [];
      const guidance = element("p", (error as Error).message);
      guidance.setAttribute("role", "status");
      content.append(guidance);
      return content;
    }
    const status = element(
      "p",
      this.#status ||
        (connection
          ? `Connected to ${connection.campaign.name}`
          : "Connect with your dedicated Foundry GM credential."),
    );
    status.className = "rr-status";
    status.setAttribute("role", "status");
    content.append(status);
    if (!client || !connection) {
      const label = element("label", "Foundry GM credential");
      const input = element("input");
      input.type = "password";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.maxLength = 266;
      label.append(input);
      content.append(
        label,
        element(
          "p",
          "Your GM credential stays in this browser session. Reconnect after reloading Foundry.",
        ),
      );
      content.append(
        this.button("Connect", async () => {
          disconnect();
          try {
            requireSecureBrowser();
          } catch (error) {
            input.value = "";
            throw error;
          }
          const token = input.value.trim();
          input.value = "";
          const candidate = new RavenClient(token);
          const epoch = generation;
          try {
            const result = await candidate.connection();
            requireGM();
            if (epoch !== generation) {
              candidate.disconnect();
              return;
            }
            if (result.audience !== "gm")
              throw new Error("A GM connection is required.");
            client = candidate;
            connectedIdentity = currentIdentity();
            confirmConnection(result);
            this.#sessions = [];
            this.#status = "Connected.";
            try {
              await access.connect(candidate, result);
            } catch (error) {
              this.#status = `Connected. ${error instanceof Error ? error.message : "Ask access could not be initialized."}`;
            }
          } catch (error) {
            candidate.disconnect();
            throw error;
          }
        }),
      );
      return content;
    }
    content.append(
      this.button("Disconnect", async () => {
        disconnect();
        this.#sessions = [];
        this.#status = "Disconnected. Existing journals are unchanged.";
      }),
    );
    if (ask.canOpen) content.append(this.button("Ask Recap Raven", openAsk));
    if (connection.mode !== "off")
      content.append(
        this.button("Replace Ask access", async () => {
          await access.replace();
          this.#status =
            "Ask access replaced. Previous Ask credentials are revoked.";
        }),
      );
    const current = connection;
    const modeLabel = element("label", "Ask visibility");
    const mode = element("select");
    for (const [value, label] of [
      ["off", "Off"],
      ["gm", "GM only"],
      ["all", "GM and players"],
    ]) {
      const option = element("option", label);
      option.value = value!;
      option.selected = value === current.mode;
      mode.append(option);
    }
    modeLabel.append(mode);
    content.append(
      modeLabel,
      this.button("Save visibility", async () => {
        await access.saveMode(mode.value as AskMode);
        this.#status = "Visibility updated.";
      }),
    );
    content.append(
      this.button("Preview available recaps", async () => {
        const epoch = generation;
        const active = client!;
        const refreshed = await active.connection();
        requireGM();
        if (epoch !== generation) return;
        if (refreshed.id !== current.id || refreshed.audience !== "gm") {
          disconnect();
          throw new Error("Connection changed. Reconnect.");
        }
        confirmConnection(refreshed);
        const sessions = await active.sessions(current.campaign.id);
        if (epoch === generation) {
          this.#sessions = sessions;
          this.#status = `${sessions.length} completed recaps available.`;
        }
      }),
    );
    if (!this.#sessions.length) return content;
    const folderLabel = element("label", "Destination folder");
    const folder = element("select");
    const root = element("option", "Journal directory");
    root.value = "";
    folder.append(root);
    for (const f of game.folders.contents.filter(
      (f) => f.type === "JournalEntry",
    )) {
      const option = element("option", f.name);
      option.value = f.id;
      folder.append(option);
    }
    folderLabel.append(folder);
    content.append(folderLabel);
    const visibilityLabel = element("label", "Journal visibility");
    const visibility = element("select");
    for (const [value, label] of [
      ["private", "GM only"],
      ["publish", "Players can read (Observer)"],
    ]) {
      const o = element("option", label);
      o.value = value!;
      visibility.append(o);
    }
    visibilityLabel.append(visibility);
    content.append(visibilityLabel);
    const list = element("div");
    list.className = "rr-sessions";
    const selected = new Set<string>();
    for (const session of this.#sessions) {
      const imported = !!findJournal(store, current.campaign.id, session.id);
      const row = element("label");
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.disabled = imported;
      checkbox.checked = !imported;
      if (!imported) selected.add(session.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(session.id);
        else selected.delete(session.id);
      });
      row.append(
        checkbox,
        document.createTextNode(
          `${session.title || `Session ${session.session_number ?? session.id}`} — ${session.recorded_at?.slice(0, 10) ?? session.ready_at.slice(0, 10)}${imported ? " (already imported)" : ""}`,
        ),
      );
      list.append(row);
    }
    content.append(
      list,
      this.button("Import selected recaps", async () => {
        const epoch = generation;
        const active = client!;
        const campaignId = current.campaign.id;
        const chosen = [...selected];
        let created = 0;
        let skipped = 0;
        const failures: string[] = [];
        for (const id of chosen) {
          requireGM();
          if (epoch !== generation) break;
          try {
            const session = await active.session(id, campaignId);
            requireGM();
            if (epoch !== generation) break;
            const result = await importSession(store, session, {
              folder: folder.value || null,
              publish: visibility.value === "publish",
            });
            if (result === "created") created++;
            else skipped++;
          } catch (error) {
            const session = this.#sessions.find((entry) => entry.id === id);
            const label =
              session?.title || `Session ${session?.session_number ?? id}`;
            failures.push(`${label}: ${importFailureMessage(error)}`);
          }
        }
        this.#status = [
          `Imported ${created}; already imported ${skipped}; failed ${failures.length}.`,
          ...failures,
        ].join("\n");
      }),
    );
    return content;
  }
  protected override _replaceHTML(
    result: HTMLElement,
    content: HTMLElement,
  ): void {
    content.replaceChildren(result);
  }
  private button(
    label: string,
    action: () => Promise<void>,
  ): HTMLButtonElement {
    const button = element("button", label);
    button.type = "button";
    button.disabled = this.#busy;
    button.addEventListener("click", () => {
      if (this.#busy) return;
      this.#busy = true;
      for (const control of this.element.querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement
      >("button,input,select"))
        control.disabled = true;
      void (async () => {
        try {
          requireGM();
          await action();
        } catch (error) {
          this.#status =
            error instanceof Error ? error.message : "The operation failed.";
        } finally {
          this.#busy = false;
          if (game.user?.isGM) await this.render({ force: true });
          else await this.close();
        }
      })();
    });
    return button;
  }
}
Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "connection", {
    scope: "world",
    config: false,
    type: Object,
    default: { id: null, mode: "off", revision: 0 },
    restricted: true,
  });
  game.settings.register(MODULE_ID, "playerAccess", {
    scope: "world",
    config: false,
    type: String,
    default: "",
    restricted: true,
  });
  class CampaignAccess extends foundry.applications.api.ApplicationV2 {
    static override DEFAULT_OPTIONS = {
      id: "recap-raven-access",
      classes: ["recap-raven"],
      window: { title: "Recap Raven" },
      position: { width: 420, height: "auto" },
    };
    protected override async _renderHTML(): Promise<HTMLElement> {
      const content = element("div");
      content.className = "rr-content";
      content.append(
        element(
          "p",
          ask.canOpen
            ? "Player-safe campaign questions are available."
            : "Ask is off or unavailable. Ask the GM to connect or replace expired access.",
        ),
      );
      const refresh = element("button", "Refresh access");
      refresh.type = "button";
      refresh.addEventListener("click", () => {
        void (async () => {
          await refreshAccess();
          await this.render({ force: true });
        })();
      });
      content.append(refresh);
      if (ask.canOpen) {
        const button = element("button", "Ask Recap Raven");
        button.type = "button";
        button.addEventListener("click", () => {
          void openAsk();
        });
        content.append(button);
      }
      return content;
    }
    protected override _replaceHTML(
      result: HTMLElement,
      content: HTMLElement,
    ): void {
      content.replaceChildren(result);
    }
  }
  game.settings.registerMenu(MODULE_ID, "access", {
    name: "Recap Raven",
    label: "Campaign access",
    hint: "View player-safe campaign access.",
    icon: "fa-solid fa-crow",
    type: CampaignAccess,
    restricted: false,
  });
  game.settings.registerMenu(MODULE_ID, "setup", {
    name: "RECAP_RAVEN.Setup",
    label: "RECAP_RAVEN.Title",
    hint: "RECAP_RAVEN.SetupHint",
    icon: "fa-solid fa-crow",
    type: RavenSetup,
    restricted: true,
  });
});
Hooks.on("getHeaderControlsJournalDirectory", (_app, controls) => {
  if (game.user?.isGM && Array.isArray(controls))
    controls.push({
      action: "recapRavenSetup",
      icon: "fa-solid fa-crow",
      label: "RECAP_RAVEN.Setup",
      onClick: () => {
        void new RavenSetup().render({ force: true });
      },
    });
});
Hooks.on("updateUser", (user) => {
  if (
    user &&
    typeof user === "object" &&
    "id" in user &&
    user.id !== game.user?.id
  )
    return;
  if (client && (!game.user?.isGM || currentIdentity() !== connectedIdentity)) {
    disconnect();
    void access.restoreShared();
  } else {
    ask.invalidate("Checking access…");
    void ask.refresh();
  }
});
Hooks.on("getSceneControlButtons", (controls) => {
  if (!controls || typeof controls !== "object" || !ask.canOpen) return;
  const record = controls as Record<string, unknown>;
  record.recapRaven = {
    name: "recapRaven",
    title: "Ask Recap Raven",
    icon: "fa-solid fa-wand-magic-sparkles",
    order: Object.keys(record).length,
    visible: true,
    activeTool: "ask",
    onChange: (_event: Event, active: boolean) => {
      if (active) void openAsk();
    },
    tools: {
      ask: {
        name: "ask",
        title: "Ask Recap Raven",
        icon: "fa-solid fa-crow",
        order: 0,
        button: true,
        onChange: () => {
          void openAsk();
        },
      },
    },
  };
});
Hooks.on("updateSetting", (setting, _changes, _options, userId) => {
  if (
    setting &&
    typeof setting === "object" &&
    "key" in setting &&
    [`${MODULE_ID}.connection`, `${MODULE_ID}.playerAccess`].includes(
      String(setting.key),
    )
  ) {
    if (access.writing && userId === game.user?.id) return;
    void access.sharedChanged();
    updateControls();
  }
});
Hooks.once("ready", () => {
  void access.restoreShared();
});
async function refreshAccess(): Promise<void> {
  if (!access.eligible) await access.restoreShared();
  await ask.refresh();
}
window.addEventListener("focus", () => {
  void refreshAccess();
});
window.addEventListener("online", () => {
  void refreshAccess();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden)
    ask.invalidate("Ask is paused while this tab is hidden.");
  else void refreshAccess();
});
window.addEventListener("beforeunload", disconnect);
