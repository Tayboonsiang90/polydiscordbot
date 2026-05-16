import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://earthquake.usgs.gov/earthquakes/browse/significant.php#sigdef";
const apiUrl =
  "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=5.5&orderby=time&limit=1&starttime=2026-05-04T04:00:00Z&endtime=2026-05-11T03:59:59Z";

type UsgsEarthquakeFeatureCollection = {
  features?: UsgsEarthquakeFeature[];
};

export type UsgsEarthquakeFeature = {
  id?: string;
  properties?: {
    mag?: number | null;
    place?: string | null;
    time?: number | null;
    title?: string | null;
    url?: string | null;
  };
  geometry?: {
    coordinates?: [number, number, number?];
  } | null;
};

export function extractLatestUsgsEarthquakeValue(data: UsgsEarthquakeFeatureCollection): string {
  const feature = data.features?.[0];
  if (!feature) {
    return "No 5.5+ USGS earthquakes found in the May 4-May 10 market window.";
  }

  return formatUsgsEarthquake(feature);
}

export function formatUsgsEarthquake(feature: UsgsEarthquakeFeature): string {
  const magnitude = feature.properties?.mag;
  const place = feature.properties?.place?.trim() || "unknown location";
  const time = feature.properties?.time ? new Date(feature.properties.time).toISOString() : "unknown";
  const url = feature.properties?.url?.trim() || sourceUrl;
  const depth = feature.geometry?.coordinates?.[2];

  if (magnitude === null || magnitude === undefined || magnitude < 5.5) {
    throw new Error("USGS response did not include a qualifying 5.5+ earthquake");
  }

  return [
    `Event ID: ${feature.id ?? "unknown"}`,
    `Magnitude: ${magnitude}`,
    `Location: ${place}`,
    `Time: ${time}`,
    `Depth: ${depth === undefined ? "unknown" : `${depth} km`}`,
    `USGS: ${url}`
  ].join("\n");
}

export const usgsEarthquakesAdapter: WebsiteAdapter = {
  id: "usgs-earthquakes",
  commandName: "earthquake",
  displayName: "USGS 5.5+ Earthquakes",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/how-many-5pt5-or-above-earthquakes-may-4-may-10",
  defaultChannelName: "earthquake",
  alertRoleName: "USGS Earthquake Alerts",
  alertRoleEmoji: "\uD83C\uDF0E",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(apiUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`USGS returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as UsgsEarthquakeFeatureCollection;
    const value = extractLatestUsgsEarthquakeValue(data);
    return {
      value,
      rawValue: value,
      unit: "latest 5.5+ USGS earthquake",
      observedAt: new Date()
    };
  }
};
