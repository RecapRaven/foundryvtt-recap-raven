import { requireSecureBrowser } from "./environment";
export const API_ORIGIN = "https://api.recapraven.com";
const BASE = `${API_ORIGIN}/v1/integrations/foundry`;
export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(
      status === 409
        ? "Settings changed elsewhere. Refresh and try again."
        : status === 401 || status === 403
          ? "Access is unavailable. Reconnect using an active Foundry credential."
          : status === 429
            ? "Too many requests. Please try again later."
            : "Recap Raven is unavailable. Please try again.",
    );
  }
}
export abstract class IntegrationClient {
  #credential: string;
  protected constructor(
    credential: string,
    private readonly transport: typeof fetch = fetch,
  ) {
    requireSecureBrowser();
    this.#credential = credential;
  }
  disconnect(): void {
    this.#credential = "";
  }
  protected async request(
    path: string,
    method = "GET",
    body?: unknown,
    timeout = 10_000,
  ): Promise<unknown> {
    try {
      requireSecureBrowser();
    } catch (error) {
      this.disconnect();
      throw error;
    }
    if (!this.#credential) throw new ApiError(401);
    let response: Response;
    try {
      response = await this.transport(`${BASE}${path}`, {
        method,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(timeout),
        headers: {
          Authorization: `Bearer ${this.#credential}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError(0);
    }
    if (!response.ok) throw new ApiError(response.status);
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new Error("Unexpected response format.");
    const text = await response.text();
    if (text.length > 2_000_000)
      throw new Error("Response exceeds the allowed size.");
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("Invalid response format.");
    }
  }
}
