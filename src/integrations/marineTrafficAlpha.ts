import { fetchWithTimeout } from "../http.js";

export type MarineTrafficAlphaArea = "hormuz" | "bab";

export type MarineTrafficAlphaSnapshot = {
  areaLabel: string;
  sourceUrl: string;
  vesselCount: number;
  latestTimestamp: string | null;
  typeSummary: string;
  sampleVessels: string;
};

type MarineTrafficVessel = {
  MMSI?: unknown;
  IMO?: unknown;
  SHIP_ID?: unknown;
  SHIPNAME?: unknown;
  TYPE_NAME?: unknown;
  AIS_TYPE_SUMMARY?: unknown;
  TIMESTAMP?: unknown;
};

const areaConfig: Record<MarineTrafficAlphaArea, { label: string; urlEnv: string }> = {
  hormuz: {
    label: "Strait of Hormuz",
    urlEnv: "MARINETRAFFIC_HORMUZ_ALPHA_URL"
  },
  bab: {
    label: "Bab el-Mandeb",
    urlEnv: "MARINETRAFFIC_BAB_ALPHA_URL"
  }
};

export async function fetchOptionalMarineTrafficAlpha(area: MarineTrafficAlphaArea): Promise<MarineTrafficAlphaSnapshot | null> {
  const config = areaConfig[area];
  const sourceUrl = process.env[config.urlEnv];
  if (!sourceUrl) {
    return null;
  }

  let response: Awaited<ReturnType<typeof fetchWithTimeout>>;
  try {
    response = await fetchWithTimeout(sourceUrl, {
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  try {
    return extractMarineTrafficAlphaSnapshot(await response.json(), config.label, sourceUrl);
  } catch {
    return null;
  }
}

export function extractMarineTrafficAlphaSnapshot(
  data: unknown,
  areaLabel: string,
  sourceUrl = "https://www.marinetraffic.com/"
): MarineTrafficAlphaSnapshot {
  const vessels = extractMarineTrafficVessels(data);
  const uniqueVessels = dedupeVessels(vessels);
  const timestamps = uniqueVessels.map((vessel) => normalizeString(vessel.TIMESTAMP)).filter((timestamp): timestamp is string => Boolean(timestamp));

  return {
    areaLabel,
    sourceUrl,
    vesselCount: uniqueVessels.length,
    latestTimestamp: timestamps.sort().at(-1) ?? null,
    typeSummary: formatTypeSummary(uniqueVessels),
    sampleVessels: formatSampleVessels(uniqueVessels)
  };
}

export function formatMarineTrafficAlphaSnapshot(snapshot: MarineTrafficAlphaSnapshot | null): string[] {
  if (!snapshot) {
    return [];
  }

  return [
    "MarineTraffic alpha:",
    `Area: ${snapshot.areaLabel}`,
    `Live AIS vessels: ${snapshot.vesselCount}`,
    `Latest AIS timestamp: ${snapshot.latestTimestamp ?? "none"}`,
    `Type summary: ${snapshot.typeSummary}`,
    `Sample vessels: ${snapshot.sampleVessels}`,
    `MarineTraffic source: ${snapshot.sourceUrl}`
  ];
}

function extractMarineTrafficVessels(data: unknown): MarineTrafficVessel[] {
  if (Array.isArray(data)) {
    return data.filter(isRecord);
  }

  if (!isRecord(data)) {
    return [];
  }

  const dataRows = data.DATA;
  if (Array.isArray(dataRows)) {
    return dataRows.filter(isRecord);
  }

  const rows = data.rows;
  if (Array.isArray(rows)) {
    return rows.filter(isRecord);
  }

  return [];
}

function dedupeVessels(vessels: MarineTrafficVessel[]): MarineTrafficVessel[] {
  const seen = new Set<string>();
  return vessels.filter((vessel) => {
    const id = normalizeString(vessel.SHIP_ID) ?? normalizeString(vessel.MMSI) ?? normalizeString(vessel.IMO);
    if (!id || seen.has(id)) {
      return false;
    }

    seen.add(id);
    return true;
  });
}

function formatTypeSummary(vessels: MarineTrafficVessel[]): string {
  if (!vessels.length) {
    return "none";
  }

  const counts = new Map<string, number>();
  for (const vessel of vessels) {
    const type = normalizeString(vessel.AIS_TYPE_SUMMARY) ?? normalizeString(vessel.TYPE_NAME) ?? "Unknown";
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([type, count]) => `${type} ${count}`)
    .join("; ");
}

function formatSampleVessels(vessels: MarineTrafficVessel[]): string {
  if (!vessels.length) {
    return "none";
  }

  return vessels
    .slice(0, 5)
    .map((vessel) => normalizeString(vessel.SHIPNAME) ?? normalizeString(vessel.MMSI) ?? normalizeString(vessel.SHIP_ID) ?? "unknown")
    .join("; ");
}

function normalizeString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
