import { deleteSettingsJsonKeys, mergeSettingsJson, parseSettingsJson } from "./settingsJson.js";

export type ErrorNoticeState = {
  signature: string;
  sentAtMs: number;
  suppressedCount: number;
};

export const defaultRepeatedErrorNoticeWindowMs = 30 * 60_000;
export const transientRepeatedErrorNoticeWindowMs = 6 * 60 * 60_000;
export const transientNetworkErrorSignature = "transient-network-error";

export function getErrorNoticeDecision(
  existing: ErrorNoticeState | undefined,
  message: string,
  nowMs: number,
  windowMs = defaultRepeatedErrorNoticeWindowMs,
  signature = message
): { shouldSend: boolean; message: string; nextState: ErrorNoticeState } {
  if (!existing || existing.signature !== signature) {
    return {
      shouldSend: true,
      message,
      nextState: { signature, sentAtMs: nowMs, suppressedCount: 0 }
    };
  }

  if (nowMs - existing.sentAtMs < windowMs) {
    return {
      shouldSend: false,
      message,
      nextState: { ...existing, suppressedCount: existing.suppressedCount + 1 }
    };
  }

  const suppressedSummary =
    existing.suppressedCount > 0
      ? `\n\nSuppressed ${existing.suppressedCount} repeated error(s) in the previous ${Math.round(windowMs / 60_000)} minute(s).`
      : "";

  return {
    shouldSend: true,
    message: `${message}${suppressedSummary}`,
    nextState: { signature, sentAtMs: nowMs, suppressedCount: 0 }
  };
}

export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getErrorNoticeSignature(error: unknown): string {
  return isTransientNetworkError(error) ? transientNetworkErrorSignature : formatErrorMessage(error);
}

export function formatSchedulerNetworkError(error: unknown): string {
  const codes = [...new Set(collectErrorCodes(error))].join(", ");
  const codeText = codes ? ` (${codes})` : "";
  return `Discord/network send failed${codeText}: ${formatErrorMessage(error)}. This is usually Pi DNS/VPN/router access to Discord; scheduler will retry.`;
}

export function getLatestErrorMessageId(settingsJson: string | null): string | null {
  const settings = parseSettingsJson(settingsJson);
  return typeof settings.latestErrorMessageId === "string" ? settings.latestErrorMessageId : null;
}

export function setLatestErrorMessageId(settingsJson: string | null, messageId: string): string {
  return mergeSettingsJson(settingsJson, { latestErrorMessageId: messageId });
}

export function getLatestErrorNoticeState(settingsJson: string | null): ErrorNoticeState | undefined {
  const state = parseSettingsJson(settingsJson).latestErrorNoticeState;
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return undefined;
  }

  const signature = "signature" in state ? state.signature : undefined;
  const sentAt = "sentAt" in state ? state.sentAt : undefined;
  const suppressedCount = "suppressedCount" in state ? state.suppressedCount : undefined;
  const sentAtMs = typeof sentAt === "string" ? Date.parse(sentAt) : Number.NaN;
  if (typeof signature !== "string" || !Number.isFinite(sentAtMs)) {
    return undefined;
  }

  return {
    signature,
    sentAtMs,
    suppressedCount: typeof suppressedCount === "number" && Number.isFinite(suppressedCount) ? suppressedCount : 0
  };
}

export function setLatestErrorNoticeState(settingsJson: string | null, state: ErrorNoticeState): string {
  return mergeSettingsJson(settingsJson, {
    latestErrorNoticeState: {
      signature: state.signature,
      sentAt: new Date(state.sentAtMs).toISOString(),
      suppressedCount: state.suppressedCount
    }
  });
}

export function clearLatestErrorNoticeState(settingsJson: string | null): string | null {
  const settings = parseSettingsJson(settingsJson);
  if (!Object.prototype.hasOwnProperty.call(settings, "latestErrorNoticeState")) {
    return settingsJson;
  }

  return deleteSettingsJsonKeys(settingsJson, ["latestErrorNoticeState"]);
}

export function isTransientNetworkError(error: unknown): boolean {
  const codes = collectErrorCodes(error);
  const message = formatErrorMessage(error).toLowerCase();
  return (
    codes.some((code) =>
      [
        "ABORT_ERR",
        "EAI_AGAIN",
        "ECONNREFUSED",
        "ECONNRESET",
        "ECONNABORTED",
        "EHOSTUNREACH",
        "ETIMEDOUT",
        "UND_ERR_ABORTED",
        "UND_ERR_CONNECT_TIMEOUT"
      ].includes(code)
    ) ||
    message.includes("aborterror") ||
    message.includes("aborted") ||
    message.includes("eai_again") ||
    message.includes("econnrefused") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("connection reset")
  );
}

function collectErrorCodes(error: unknown): string[] {
  if (!error || typeof error !== "object") {
    return [];
  }

  const codes: string[] = [];
  const maybeCode = "code" in error ? error.code : undefined;
  if (typeof maybeCode === "string") {
    codes.push(maybeCode);
  }

  const maybeCause = "cause" in error ? error.cause : undefined;
  codes.push(...collectErrorCodes(maybeCause));
  return codes;
}
