import { requireSecureBrowser } from "../api/environment";
import type { RavenClient } from "../api/client";
import { RavenAskClient } from "../api/ask-client";
import { PLAYER_KEY } from "../api/player-access";
import type { Connection, AskMode } from "../api/connection";
import type { AskController, AskClient } from "./controller";
import { ApiError } from "../api/transport";
export interface SharedMirror {
  id: string;
  mode: AskMode;
  revision: number;
}
interface AccessHost {
  isGM(): boolean;
  identity(): string;
  shared(): unknown;
  mirror(): unknown;
  writeShared(credential: string): Promise<void>;
  writeMirror(value: SharedMirror): Promise<void>;
  confirmed(value: Connection): void;
}
type Reader = AskClient & { disconnect(): void };
type Management = Pick<RavenClient, "connection" | "settings" | "playerAccess">;
export class AskAccess {
  #management: Management | undefined;
  #connection: Connection | undefined;
  #reader: Reader | undefined;
  #readerConnection: Connection | undefined;
  #identity = "";
  #generation = 0;
  #writing = 0;
  get writing(): boolean {
    return this.#writing > 0;
  }
  private async write(action: () => Promise<void>): Promise<void> {
    this.#writing++;
    try {
      await action();
    } finally {
      this.#writing--;
    }
  }
  constructor(
    private readonly controller: AskController,
    private readonly host: AccessHost,
    private readonly readerFactory: (credential: string) => Reader = (
      credential,
    ) => new RavenAskClient(credential),
  ) {}
  get eligible(): boolean {
    return (
      this.#identity === this.host.identity() &&
      !!this.#readerConnection &&
      (this.#readerConnection.mode === "all" ||
        (this.#readerConnection.mode === "gm" && this.host.isGM()))
    );
  }
  clear(): void {
    this.#generation++;
    this.#reader?.disconnect();
    this.#reader = undefined;
    this.#readerConnection = undefined;
    this.#identity = "";
    this.controller.configure(undefined, undefined);
  }
  disconnect(): void {
    this.clear();
    this.#management = undefined;
    this.#connection = undefined;
  }
  private requireGM(): void {
    if (!this.host.isGM() || !this.#management || !this.#connection)
      throw new Error("A connected GM must manage Ask access.");
  }
  private adopt(reader: Reader, connection: Connection): void {
    this.#reader?.disconnect();
    this.#reader = reader;
    this.#readerConnection = connection;
    this.#identity = this.host.identity();
    this.controller.configure(reader, connection);
  }
  async connect(management: Management, connection: Connection): Promise<void> {
    if (!this.host.isGM() || connection.audience !== "gm")
      throw new Error("GM management access is required.");
    this.disconnect();
    this.#management = management;
    this.#connection = connection;
    this.host.confirmed(connection);
    const epoch = this.#generation;
    if (connection.mode === "off") return;
    if (connection.mode === "all" && (await this.restoreShared())) return;
    if (epoch !== this.#generation) return;
    await this.replace();
  }
  async restoreShared(): Promise<boolean> {
    try {
      requireSecureBrowser();
    } catch (error) {
      this.controller.invalidate((error as Error).message);
      return false;
    }
    const raw = this.host.shared();
    const mirror = this.host.mirror();
    const epoch = this.#generation;
    const identity = this.host.identity();
    if (
      typeof raw !== "string" ||
      !PLAYER_KEY.test(raw) ||
      !mirror ||
      typeof mirror !== "object" ||
      !("id" in mirror) ||
      !("mode" in mirror) ||
      !("revision" in mirror) ||
      !Number.isSafeInteger(mirror.revision) ||
      Number(mirror.revision) < 1 ||
      mirror.mode !== "all"
    )
      return false;
    let reader: Reader | undefined;
    try {
      reader = this.readerFactory(raw);
      const connection = await reader.connection();
      if (
        epoch !== this.#generation ||
        identity !== this.host.identity() ||
        this.host.shared() !== raw ||
        connection.audience !== "player" ||
        connection.mode !== "all" ||
        connection.id !== mirror.id ||
        connection.revision !== mirror.revision ||
        !connection.can_ask ||
        (this.#connection &&
          (connection.id !== this.#connection.id ||
            connection.campaign.id !== this.#connection.campaign.id))
      ) {
        reader.disconnect();
        return false;
      }
      this.adopt(reader, connection);
      return true;
    } catch {
      reader?.disconnect();
      return false;
    }
  }
  async sharedChanged(): Promise<void> {
    const mirror = this.host.mirror();
    if (
      this.#readerConnection?.mode === "gm" &&
      this.host.isGM() &&
      mirror &&
      typeof mirror === "object" &&
      "id" in mirror &&
      mirror.id === this.#readerConnection.id &&
      "mode" in mirror &&
      mirror.mode === "gm"
    ) {
      this.controller.invalidate("Checking access…");
      await this.controller.refresh();
      return;
    }
    this.clear();
    if (!(await this.restoreShared()))
      this.controller.invalidate(
        "Ask the GM to reconnect or replace expired Ask access.",
      );
  }
  async saveMode(mode: AskMode): Promise<void> {
    this.requireGM();
    const management = this.#management!;
    const previous = this.#connection!;
    const identity = this.host.identity();
    this.clear();
    const epoch = this.#generation;
    let updated: Connection;
    try {
      updated = await management.settings(mode, previous.revision);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        epoch === this.#generation
      ) {
        const current = await management.connection();
        if (epoch === this.#generation && identity === this.host.identity()) {
          this.#connection = current;
          this.host.confirmed(current);
        }
      }
      throw error;
    }
    if (
      epoch !== this.#generation ||
      identity !== this.host.identity() ||
      !this.host.isGM()
    )
      return;
    if (
      updated.id !== previous.id ||
      updated.campaign.id !== previous.campaign.id ||
      updated.audience !== "gm"
    )
      throw new Error("Connection changed. Reconnect before updating access.");
    this.#connection = updated;
    this.host.confirmed(updated);
    try {
      await this.write(() =>
        this.host.writeMirror({
          id: updated.id,
          mode: updated.mode,
          revision: updated.revision,
        }),
      );
      if (epoch !== this.#generation || identity !== this.host.identity())
        return;
      if (updated.mode !== "all")
        await this.write(() => this.host.writeShared(""));
    } catch {
      throw new Error(
        "Access updated; Foundry display could not be updated. Reconnect or replace Ask access.",
      );
    }
    if (epoch !== this.#generation || identity !== this.host.identity()) return;
    if (updated.mode !== "off") await this.replace();
  }
  async replace(): Promise<void> {
    this.requireGM();
    const management = this.#management!;
    const expected = this.#connection!;
    if (expected.mode === "off")
      throw new Error("Enable Ask before replacing access.");
    this.clear();
    const epoch = this.#generation;
    const identity = this.host.identity();
    const issued = await management.playerAccess(expected.revision);
    if (
      epoch !== this.#generation ||
      identity !== this.host.identity() ||
      !this.host.isGM()
    )
      return;
    const connection = issued.connection;
    if (
      connection.id !== expected.id ||
      connection.campaign.id !== expected.campaign.id ||
      connection.mode !== expected.mode ||
      connection.revision !== expected.revision ||
      connection.audience !== "player" ||
      !PLAYER_KEY.test(issued.api_key)
    )
      throw new Error("Access changed. Refresh before replacing Ask access.");
    const reader = this.readerFactory(issued.api_key);
    this.adopt(reader, connection);
    if (connection.mode === "all") {
      try {
        await this.write(() =>
          this.host.writeMirror({
            id: connection.id,
            mode: connection.mode,
            revision: connection.revision,
          }),
        );
        if (
          epoch !== this.#generation ||
          identity !== this.host.identity() ||
          !this.host.isGM()
        )
          return;
        await this.write(() => this.host.writeShared(issued.api_key));
      } catch {
        this.clear();
        throw new Error(
          "Ask access was replaced, but sharing failed. Use Replace Ask access to recover.",
        );
      }
    }
  }
}
