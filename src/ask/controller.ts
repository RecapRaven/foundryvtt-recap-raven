import type { Connection } from "../api/connection";
import { AskError, type AskResponse } from "../api/ask";

export interface AskClient {
  connection(): Promise<Connection>;
  ask(question: string, campaignId: string): Promise<AskResponse>;
}
export interface AskState {
  active: boolean;
  authorized: boolean;
  pending: boolean;
  question: string;
  result: AskResponse | null;
  status: string;
}

export class AskController {
  readonly state: AskState = {
    active: false,
    authorized: false,
    pending: false,
    question: "",
    result: null,
    status: "Connect to Recap Raven in module settings.",
  };
  #available = false;
  #client: AskClient | undefined;
  #connection: Connection | undefined;
  #generation = 0;
  #refreshPromise:
    { generation: number; promise: Promise<boolean> } | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #listeners = new Set<() => void>();
  constructor(
    private readonly eligible: () => boolean,
    private readonly confirmed: (connection: Connection) => void,
  ) {}

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  private notify(): void {
    for (const listener of this.#listeners) listener();
  }
  get connection(): Connection | undefined {
    return this.#connection;
  }
  get canOpen(): boolean {
    return (
      this.#available &&
      this.eligible() &&
      !!this.#client &&
      !!this.#connection?.can_ask &&
      this.#connection.audience === "player" &&
      this.#connection.mode !== "off"
    );
  }
  configure(
    client: AskClient | undefined,
    connection: Connection | undefined,
  ): void {
    const previous = this.#connection;
    const changed =
      client !== this.#client ||
      previous?.id !== connection?.id ||
      previous?.campaign.id !== connection?.campaign.id ||
      previous?.mode !== connection?.mode ||
      previous?.audience !== connection?.audience ||
      previous?.can_ask !== connection?.can_ask;
    this.#client = client;
    this.#connection = connection;
    if (changed)
      this.invalidate(
        connection
          ? "Access changed. Open Ask again to continue."
          : "Connect to Recap Raven in module settings.",
      );
    this.#available = !!connection?.can_ask;
    this.notify();
  }
  invalidate(
    status = "Ask is unavailable. Reconnect in module settings.",
  ): void {
    this.#available = false;
    this.#generation++;
    Object.assign(this.state, {
      authorized: false,
      pending: false,
      question: "",
      result: null,
      status,
    });
    this.notify();
  }
  async open(): Promise<void> {
    this.state.active = true;
    this.invalidate("Checking access…");
    if (!this.#timer)
      this.#timer = setInterval(() => {
        if (this.eligible()) void this.refresh();
        else this.invalidate("Ask is paused.");
      }, 30_000);
    await this.refresh();
  }
  close(): void {
    const canReopen = this.canOpen;
    this.state.active = false;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    this.invalidate("Ask closed.");
    this.#available = canReopen;
    this.notify();
  }
  refresh(): Promise<boolean> {
    if (this.#refreshPromise?.generation === this.#generation)
      return this.#refreshPromise.promise;
    const generation = this.#generation;
    const promise = this.performRefresh();
    const entry = { generation, promise };
    this.#refreshPromise = entry;
    void promise.finally(() => {
      if (this.#refreshPromise === entry) this.#refreshPromise = undefined;
    });
    return promise;
  }
  private async performRefresh(): Promise<boolean> {
    const client = this.#client;
    const previous = this.#connection;
    if (!client || !previous || !this.eligible()) {
      this.invalidate();
      return false;
    }
    const generation = this.#generation;
    try {
      const connection = await client.connection();
      if (generation !== this.#generation) return false;
      if (
        !this.eligible() ||
        client !== this.#client ||
        connection.id !== previous.id ||
        connection.campaign.id !== previous.campaign.id ||
        connection.audience !== "player"
      ) {
        this.invalidate();
        return false;
      }
      this.configure(client, connection);
      this.confirmed(connection);
      if (!this.canOpen) {
        this.invalidate("Ask is off or unavailable for this connection.");
        return false;
      }
      this.state.authorized = true;
      if (!this.state.pending && !this.state.result)
        this.state.status = "Player-safe answers. Ask about your campaign.";
      this.notify();
      return true;
    } catch {
      if (generation === this.#generation) this.invalidate();
      return false;
    }
  }
  async submit(question: string): Promise<void> {
    if (this.state.pending || !this.state.active) return;
    const normalized = question.trim();
    if (!normalized || Array.from(normalized).length > 500) {
      this.state.status = "Enter a question between 1 and 500 characters.";
      this.notify();
      return;
    }
    // Mark pending before refreshing so repeated clicks cannot race the preflight.
    this.state.pending = true;
    this.state.result = null;
    this.state.question = normalized;
    this.state.status = "Checking access…";
    this.notify();
    const initialGeneration = this.#generation;
    if (
      !(await this.refresh()) ||
      initialGeneration !== this.#generation ||
      !this.state.active
    )
      return;
    const generation = this.#generation;
    const client = this.#client!;
    this.state.status = "Asking Recap Raven…";
    this.notify();
    try {
      const result = await client.ask(
        normalized,
        this.#connection!.campaign.id,
      );
      if (
        generation !== this.#generation ||
        !this.state.active ||
        !this.eligible()
      )
        return;
      // Revalidate before exposing the result; the server independently checks before delivery.
      if (!(await this.refresh()) || generation !== this.#generation) return;
      this.state.result = result;
      this.state.status = "";
    } catch (error) {
      if (generation !== this.#generation) return;
      if (
        error instanceof AskError &&
        (error.status === 401 || error.status === 403)
      ) {
        this.invalidate(error.message);
        return;
      }
      this.state.status =
        error instanceof Error
          ? error.message
          : "The question could not be completed.";
    } finally {
      if (generation === this.#generation) {
        this.state.pending = false;
        this.notify();
      }
    }
  }
}
