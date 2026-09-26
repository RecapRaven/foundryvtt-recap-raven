# Privacy

Only the dedicated HTTPS Foundry integration routes are called. Requests use bearer authorization without cookies. GM management credentials and GM-only Ask credentials never enter world settings, document flags, local storage, chat, or sockets. Shared Ask credentials are stored only as described above. Disconnect clears the in-memory credential. Other installed modules share the browser context; install only modules you trust.

Journals contain player-safe recap content and source identifiers. Their Foundry ownership controls who can read them. Export credentials cannot grant additional website permissions. Revoke a lost credential in Recap Raven.

[Read about shared Ask access](ask.md) · [Back to setup](../README.md)
