import { parseSettingsJson, stringifySettingsJson } from "./settingsJson.js";

export type TurboPollingSettings = {
  intervalSeconds: number;
  until: string;
  startedAt?: string;
};

export const minTurboIntervalSeconds = 1;
export const maxTurboIntervalSeconds = 3600;
export const maxTurboDurationMinutes = 1440;

const turboPollingKey = "turboPolling";

export function getTurboPollingSettings(
  settingsJson: string | null | undefined,
  now: Date = new Date()
): TurboPollingSettings | null {
  const settings = parseSettingsJson(settingsJson);
  const raw = settings[turboPollingKey];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  const intervalSeconds = candidate.intervalSeconds;
  const until = candidate.until;
  const startedAt = candidate.startedAt;
  if (typeof intervalSeconds !== "number" || !Number.isInteger(intervalSeconds) || typeof until !== "string") {
    return null;
  }
  if (intervalSeconds < minTurboIntervalSeconds || intervalSeconds > maxTurboIntervalSeconds) {
    return null;
  }

  const untilDate = new Date(until);
  if (Number.isNaN(untilDate.getTime()) || untilDate.getTime() <= now.getTime()) {
    return null;
  }

  return {
    intervalSeconds,
    until,
    startedAt: typeof startedAt === "string" ? startedAt : undefined
  };
}

export function setTurboPollingSettings(
  settingsJson: string | null | undefined,
  intervalSeconds: number,
  durationMinutes: number,
  now: Date = new Date()
): string {
  const settings = parseSettingsJson(settingsJson);
  return stringifySettingsJson({
    ...settings,
    [turboPollingKey]: {
      intervalSeconds,
      startedAt: now.toISOString(),
      until: new Date(now.getTime() + durationMinutes * 60_000).toISOString()
    }
  });
}

export function clearTurboPollingSettings(settingsJson: string | null | undefined): string {
  const settings = { ...parseSettingsJson(settingsJson) };
  delete settings[turboPollingKey];
  return stringifySettingsJson(settings);
}
