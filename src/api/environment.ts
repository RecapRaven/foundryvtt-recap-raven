export function requireSecureBrowser(): void {
  if (
    globalThis.isSecureContext !== true ||
    typeof globalThis.crypto?.subtle?.digest !== "function"
  ) {
    throw new Error(
      "Open Foundry over HTTPS (or localhost) in a browser with Web Crypto enabled before connecting to Recap Raven.",
    );
  }
}
