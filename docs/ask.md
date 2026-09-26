# Player-safe Ask

**Everyone receives the same player-safe answers, including GMs.** GM-only visibility changes who can use the interface; it does not grant access to GM-only campaign knowledge.

Ask a complete campaign question of up to 500 characters. Each submission is independent; clarification responses ask you to rephrase a complete new question. Answers stay in the current browser and are never posted to Foundry chat or written to world settings. Expand evidence cards to read their approved excerpts. **Open session recap** opens a matching local journal only if your current Foundry permissions allow it. A recap provides context; it is not presented as the exact evidence excerpt. Missing or restricted journals remain safe evidence cards without revealing their titles. Ask does not expose website transcript, lore, or recap links.

- **Off:** Ask is unavailable to everyone.
- **GM only:** the GM receives a separate, restricted Ask credential held only in browser memory.
- **GM and players:** the same restricted Ask credential is shared through a world setting, allowing players to ask without Recap Raven accounts.

A GM connecting to an already shared world reuses valid matching access when possible. **Replace Ask access** explicitly issues a new credential and revokes previous copies. Restricted credentials expire within eight hours, or earlier when the GM management credential expires. There is no silent renewal; ask the GM to reconnect or replace expired access. Restricting visibility revokes previously shared access at the API before a fresh GM-only credential can be issued. Failed Foundry setting writes never roll back the server restriction; reconnect or replace access to recover.

Shared Ask credentials are intentionally readable by world users and may appear in world backups. They grant only player-safe Ask and connection checks, never GM answers, history, recap exports, management, or account access. They identify the shared table capability, not an individual player.

The active panel refreshes access every 30 seconds with a ten-second timeout, and validates before opening, submitting, and displaying results. It clears transient questions and answers on lost access or a hidden tab and revalidates when you return. Foreground clients normally detect remote revocation within 40 seconds; suspended browsers cannot guarantee background timers. Already-read or copied answers cannot be recalled.

Questions share the campaign owner's player Ask credit pool and execution limits, including other Foundry connections and Discord. Each connected table shares a limit of 25 Ask attempts per hour, subject to owner-wide limits and available player credits. This is an aggregate table limit, not a separate allowance for each player. A timed-out request is **never retried automatically** and may already have used credits. Submit a new question only when ready. Closing the panel does not guarantee cancellation or a refund.

[Back to setup and troubleshooting](../README.md)
