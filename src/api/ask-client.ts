import { IntegrationClient, ApiError } from "./transport";
import { parseConnection } from "./connection";
import { parseAskResponse, AskError } from "./ask";
import { PLAYER_KEY } from "./player-access";
import { assertUuid } from "./contract";
export class RavenAskClient extends IntegrationClient {
  constructor(credential: string, transport: typeof fetch = fetch) {
    super(credential, transport);
    if (!PLAYER_KEY.test(credential))
      throw new Error("A restricted Ask credential is required.");
  }
  async connection() {
    const result = parseConnection(await this.request("/connection"));
    if (result.audience !== "player" || result.expires_at === null)
      throw new Error("Invalid Ask access.");
    return result;
  }
  async ask(question: string, campaignId: string) {
    const normalized = question.trim();
    if (!normalized || Array.from(normalized).length > 500)
      throw new AskError(400);
    assertUuid(campaignId);
    try {
      return parseAskResponse(
        await this.request(
          "/ask/player",
          "POST",
          { question: normalized },
          120_000,
        ),
        campaignId,
      );
    } catch (error) {
      throw new AskError(error instanceof ApiError ? error.status : 0);
    }
  }
}
