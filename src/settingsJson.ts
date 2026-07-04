export type SettingsJsonObject = Record<string, unknown>;

export function parseSettingsJson(settingsJson: string | null | undefined): SettingsJsonObject {
  if (!settingsJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(settingsJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as SettingsJsonObject) : {};
  } catch {
    return {};
  }
}

export function stringifySettingsJson(settings: SettingsJsonObject): string {
  return JSON.stringify(settings);
}

export function mergeSettingsJson(settingsJson: string | null | undefined, patch: SettingsJsonObject): string {
  return stringifySettingsJson({
    ...parseSettingsJson(settingsJson),
    ...patch
  });
}

export function deleteSettingsJsonKeys(settingsJson: string | null | undefined, keys: string[]): string {
  const settings = { ...parseSettingsJson(settingsJson) };
  for (const key of keys) {
    delete settings[key];
  }

  return stringifySettingsJson(settings);
}
