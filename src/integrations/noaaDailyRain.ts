import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";
import { parseSettingsJson } from "../settingsJson.js";

const apiUrl = "https://data.rcc-acis.org/StnData";
const defaultYear = 2026;
const defaultMonth = 6;
const defaultDay = 9;
const defaultPolymarketUrl = "https://polymarket.com/event/where-will-it-rain-on-june-9";

type NoaaDailyRainSettings = {
  year: number;
  month: number;
  day: number;
};

type NoaaDailyRainConfig = {
  id: string;
  commandName: string;
  displayName: string;
  defaultChannelName: string;
  alertRoleName: string;
  sourceUrl: string;
  stationId: string;
  locationLabel: string;
};

type NoaaDailyRainResponse = {
  data?: Array<[string, string]>;
  error?: string;
};

export function createNoaaDailyRainAdapter(config: NoaaDailyRainConfig): WebsiteAdapter {
  return {
    id: config.id,
    commandName: config.commandName,
    displayName: config.displayName,
    sourceUrl: config.sourceUrl,
    defaultPolymarketUrl,
    defaultChannelName: config.defaultChannelName,
    alertRoleName: config.alertRoleName,
    alertRoleEmoji: "\u2614",
    defaultSettings: { year: defaultYear, month: defaultMonth, day: defaultDay },
    async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
      const settings = getNoaaDailyRainSettings(integration);
      const response = await fetchWithTimeout(apiUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
        },
        body: buildNoaaDailyRainRequestBody(config.stationId, settings)
      });

      if (!response.ok) {
        throw new Error(`NOAA returned HTTP ${response.status}`);
      }

      const json = (await response.json()) as NoaaDailyRainResponse;
      const value = extractNoaaDailyRainValue(json, settings, config.locationLabel);
      return {
        value,
        rawValue: value,
        unit: "daily precipitation",
        observedAt: new Date()
      };
    }
  };
}

export const noaaSanFranciscoRainAdapter = createNoaaDailyRainAdapter({
  id: "noaa-san-francisco-rain",
  commandName: "sfrain",
  displayName: "NOAA San Francisco Rain",
  defaultChannelName: "sfrain",
  alertRoleName: "NOAA SF Rain Alerts",
  sourceUrl: "https://www.weather.gov/wrh/Climate?wfo=mtr",
  stationId: "SFOC1",
  locationLabel: "San Francisco City, CA"
});

export const noaaDenverRainAdapter = createNoaaDailyRainAdapter({
  id: "noaa-denver-rain",
  commandName: "denverrain",
  displayName: "NOAA Denver Rain",
  defaultChannelName: "denverrain",
  alertRoleName: "NOAA Denver Rain Alerts",
  sourceUrl: "https://www.weather.gov/wrh/Climate?wfo=bou",
  stationId: "DENthr",
  locationLabel: "Denver Area"
});

export const noaaDallasRainAdapter = createNoaaDailyRainAdapter({
  id: "noaa-dallas-rain",
  commandName: "dallasrain",
  displayName: "NOAA Dallas Rain",
  defaultChannelName: "dallasrain",
  alertRoleName: "NOAA Dallas Rain Alerts",
  sourceUrl: "https://www.weather.gov/wrh/Climate?wfo=fwd",
  stationId: "DFWthr",
  locationLabel: "Dallas Area"
});

export const noaaBostonRainAdapter = createNoaaDailyRainAdapter({
  id: "noaa-boston-rain",
  commandName: "bostonrain",
  displayName: "NOAA Boston Rain",
  defaultChannelName: "bostonrain",
  alertRoleName: "NOAA Boston Rain Alerts",
  sourceUrl: "https://www.weather.gov/wrh/Climate?wfo=box",
  stationId: "BOSthr",
  locationLabel: "Boston Area"
});

export const noaaAtlantaRainAdapter = createNoaaDailyRainAdapter({
  id: "noaa-atlanta-rain",
  commandName: "atlantarain",
  displayName: "NOAA Atlanta Rain",
  defaultChannelName: "atlantarain",
  alertRoleName: "NOAA Atlanta Rain Alerts",
  sourceUrl: "https://www.weather.gov/wrh/Climate?wfo=ffc",
  stationId: "ATLthr",
  locationLabel: "Atlanta Area"
});

export function getNoaaDailyRainSettings(integration?: Integration): NoaaDailyRainSettings {
  const settings = parseSettingsJson(integration?.settingsJson ?? null) as Partial<NoaaDailyRainSettings>;
  const year = Number(settings.year);
  const month = Number(settings.month);
  const day = Number(settings.day);
  if (isValidNoaaDailyRainDate(year, month, day)) {
    return { year, month, day };
  }

  return { year: defaultYear, month: defaultMonth, day: defaultDay };
}

export function extractNoaaDailyRainValue(
  response: NoaaDailyRainResponse,
  settings: NoaaDailyRainSettings,
  locationLabel: string
): string {
  if (response.error) {
    throw new Error(`NOAA returned error: ${response.error}`);
  }

  const row = response.data?.[0];
  const rawValue = row?.[1];
  const date = row?.[0] ?? formatNoaaDailyRainDate(settings);
  const prefix = [`Metric: NOAA daily precipitation`, `Location: ${locationLabel}`, `Date: ${date}`];
  if (!rawValue || rawValue === "M") {
    return [...prefix, "Value: pending", "Status: not finalized on NOAA yet"].join("\n");
  }

  const normalizedValue = normalizePrecipitationValue(rawValue);
  return [...prefix, `Value: ${normalizedValue} inches`, "Status: NOAA value available"].join("\n");
}

export function isValidNoaaDailyRainDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  if (year < 1900 || year > 2100 || month < 1 || month > 12) {
    return false;
  }

  return day >= 1 && day <= new Date(year, month, 0).getDate();
}

function buildNoaaDailyRainRequestBody(stationId: string, settings: NoaaDailyRainSettings): URLSearchParams {
  const params = {
    sid: stationId,
    date: formatNoaaDailyRainDate(settings),
    elems: [{ name: "pcpn" }]
  };

  return new URLSearchParams({
    params: JSON.stringify(params),
    output: "json"
  });
}

function normalizePrecipitationValue(value: string): string {
  if (value === "T") {
    return "T";
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue >= 100) {
    throw new Error(`Invalid NOAA daily precipitation value: ${value}`);
  }

  return numericValue.toFixed(2);
}

function formatNoaaDailyRainDate(settings: NoaaDailyRainSettings): string {
  return `${settings.year}-${String(settings.month).padStart(2, "0")}-${String(settings.day).padStart(2, "0")}`;
}
