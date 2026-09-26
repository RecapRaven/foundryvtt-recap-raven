import { ApiError } from "../api/transport";
import { ContractValidationError } from "../api/contract";

const messages = {
  integrity:
    "Recap integrity check failed. Refresh the recap list; if this repeats, contact Recap Raven support.",
  collision:
    "Journal ID collision. No journal was changed. Contact Recap Raven support before retrying.",
  creation:
    "Journal creation could not be confirmed. Check your Foundry permissions, destination folder, and server storage, then retry.",
};

export class ImportError extends Error {
  constructor(reason: keyof typeof messages) {
    super(messages[reason]);
  }
}

/** Only display messages we control; server errors may contain private data. */
export function importFailureMessage(error: unknown): string {
  if (error instanceof ImportError) return error.message;
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403)
      return "Access is unavailable. Reconnect with an active Foundry GM credential, then retry.";
    if (error.status === 404)
      return "This recap is no longer available. Refresh the recap list.";
    if (error.status === 429)
      return "Too many requests. Wait before retrying this recap.";
    return "Recap Raven could not be reached or could not complete the request. Check your connection and retry later.";
  }
  if (error instanceof ContractValidationError)
    return "Recap Raven returned an unexpected recap format. Refresh the list; if this repeats, contact support.";
  return "The recap could not be imported. Refresh the list and reconnect; if this repeats, contact support.";
}
