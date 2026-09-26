# Recap Raven for Foundry Virtual Tabletop

Bring your campaign memory to the table. Import [Recap Raven](https://recapraven.com) session recaps as native Foundry journals, ask player-safe campaign questions, and explore the supporting excerpts without leaving your game.

- **Recaps you keep.** Imported journals remain available offline and after disconnecting.
- **Answers with evidence.** Ask about your campaign and open the matching local session journal.
- **You control access.** Journals start GM-only. Enable player reading and shared Ask when you choose.
- **Your edits stay yours.** Imports never overwrite existing journals, even if a remote recap changes.

## Install

Requires **Foundry Virtual Tabletop 14**, a Recap Raven account with a campaign, and a browser with Web Crypto enabled. Open Foundry over **HTTPS**, or use **localhost** on the same computer. Remote HTTP addresses cannot connect to Recap Raven.

1. From Foundry's Setup screen, open **Add-on Modules → Install Module**.
2. Paste this address into **Manifest URL** and select **Install**:

   ```text
   https://github.com/RecapRaven/foundryvtt-recap-raven/releases/latest/download/module.json
   ```

3. Open your world and enable **Recap Raven** in **Manage Modules**.

For manual installation, download `recap-raven.zip` from [the latest release](https://github.com/RecapRaven/foundryvtt-recap-raven/releases/latest), extract its contents into your Foundry user data's `modules/recap-raven` directory, and restart Foundry. Docker and development tools are only needed when building from source.

## Connect your campaign

1. Sign in to [Recap Raven](https://recapraven.com) and create a dedicated **Foundry connection** for your campaign in your account's API key settings. Copy its **Foundry GM credential**.
2. As a GM in Foundry, open **Game Settings → Configure Settings → Recap Raven → Connection and recap journals**.
3. Paste the credential and select **Connect**. It stays in browser memory; reconnect after reloading Foundry.
4. Select **Preview available recaps**, choose sessions and a destination folder, then **Import selected recaps**.

Journals default to **GM only**. Choose **Players can read (Observer)** when importing to share them with your table. The journal directory header also provides a Recap Raven entry; settings work without a scene or canvas.

Imports skip recaps already imported, including journals you have renamed, moved, or edited. Markdown formatting is retained; active HTML, images, external links, and Foundry inline commands are removed or rendered inert.

## Ask about your campaign

Choose **Off**, **GM only**, or **GM and players** under **Ask visibility**, then select **Save visibility**. Open Ask using the sparkles icon in the scene controls or **Recap Raven → Campaign access** in Game Settings. Connected GMs can also open Ask from the connection panel.

Ask a complete question of up to 500 characters. Expand evidence cards to read supporting excerpts; **Open session recap** opens a matching imported journal when your Foundry permissions allow it. Answers appear in your browser, never in Foundry chat.

**All answers are player-safe, including answers to GMs.** Each question is independent and uses the campaign owner's player Ask credits. A timed-out question may already have used credits and is never retried automatically.

Shared Ask lets players participate without Recap Raven accounts. Its restricted credential expires within eight hours; use **Replace Ask access** to renew access and revoke previous copies. See [Ask access, credits, and limits](docs/ask.md) for details.

## Troubleshooting

| What you see                     | What to do                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTPS or Web Crypto warning      | Open Foundry over HTTPS, or localhost on the host computer, in a browser with Web Crypto enabled.                                                        |
| Credential rejected              | Use a dedicated Foundry GM credential, rather than a website or other integration key. Reconnect if it has expired or been revoked.                      |
| No available recaps              | Check that you connected the intended campaign and its session recaps have finished processing.                                                          |
| Ask unavailable                  | Ask the GM to connect, enable the appropriate visibility, and replace expired Ask access. Then select **Refresh access** in Campaign access.             |
| Import failed                    | Follow the reason shown beside the session name. Resolve access, connection, or storage problems before retrying; successful imports are skipped safely. |
| No **Open session recap** button | Import the matching session and give the current user Observer access to its journal. Evidence excerpts remain readable without a local journal.         |

For help, [open an issue](https://github.com/RecapRaven/foundryvtt-recap-raven/issues) with your Foundry and module versions and steps to reproduce the problem. Keep credentials and private campaign material out of reports. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Privacy

GM credentials stay in browser memory. Enabling **GM and players** stores a restricted player-safe Ask credential in a world setting, readable by world users and potentially included in backups. Other installed modules share the browser context; install only modules you trust. Read [how credentials and imported content are handled](docs/privacy.md).

## Development

With Docker and Make installed, run `make check` to install locked dependencies, lint, test all runtime source with coverage, typecheck, build, and verify the release archive. `make test` runs coverage tests. Build output is in `dist/`; release archives contain only runtime assets and licenses, with no source maps or development files.

This project is owner-maintained. See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed Foundry software is not included.

MIT licensed. Foundry Virtual Tabletop is a separate product; this module is not affiliated with Foundry Gaming LLC.
