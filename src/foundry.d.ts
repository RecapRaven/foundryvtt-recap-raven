import type { Journal, JournalData } from "./journals/import";
declare global {
  const Hooks: {
    once(event: string, callback: () => void): void;
    on(event: string, callback: (...args: unknown[]) => void): void;
  };
  const foundry: {
    applications: { api: { ApplicationV2: typeof ApplicationBase } };
  };
  class ApplicationBase {
    static DEFAULT_OPTIONS: Record<string, unknown>;
    element: HTMLElement;
    render(options?: { force?: boolean }): Promise<this>;
    close(): Promise<this>;
    protected _renderHTML(
      context: unknown,
      options: unknown,
    ): Promise<HTMLElement>;
    protected _replaceHTML(
      result: HTMLElement,
      content: HTMLElement,
      options: unknown,
    ): void;
  }
  const ui: { controls?: { render(): unknown } };
  const game: {
    world?: { id: string };
    user?: { id: string; isGM: boolean };
    journal: { contents: Journal[]; get(id: string): Journal | undefined };
    folders: { contents: { id: string; name: string; type: string }[] };
    settings: {
      get(namespace: string, key: string): unknown;
      register(
        namespace: string,
        key: string,
        data: Record<string, unknown>,
      ): void;
      registerMenu(
        namespace: string,
        key: string,
        data: Record<string, unknown>,
      ): void;
      set(namespace: string, key: string, value: unknown): Promise<unknown>;
    };
    i18n: { localize(key: string): string };
  };
  const CONFIG: {
    JournalEntry: {
      documentClass: {
        create(
          data: JournalData,
          options: { keepId: true },
        ): Promise<Journal | undefined>;
      };
    };
  };
}
export {};
