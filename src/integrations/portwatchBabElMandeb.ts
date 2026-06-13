import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://portwatch.imf.org/pages/6b1814d64903461b98144a6cc25eb79c";
const apiUrl = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query";
const defaultPolymarketUrl = "https://polymarket.com/event/bab-el-mandeb-strait-effectively-closed-by";
const portId = "chokepoint4";
const userAgent = "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1";

type PortwatchFeatureResponse = {
  features?: Array<{ attributes?: Partial<PortwatchBabElMandebRow> }>;
};

export type PortwatchBabElMandebRow = {
  date: string;
  portid: string;
  portname: string;
  n_total: number;
  ObjectId: number;
};

export const portwatchBabElMandebAdapter: WebsiteAdapter = {
  id: "portwatch-bab-el-mandeb",
  commandName: "babmandeb",
  displayName: "IMF Portwatch Bab el-Mandeb Arrivals",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "babmandeb",
  alertRoleName: "Bab el-Mandeb Alerts",
  alertRoleEmoji: "\uD83D\uDEA2",
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "polls Portwatch every minute for new Bab el-Mandeb arrivals-of-ships data",
  getErrorNoticeWindowMinutes: () => 30,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const rows = await fetchPortwatchBabElMandebRows();
    const value = formatPortwatchBabElMandebValue(rows);
    return {
      value,
      rawValue: value,
      unit: "ship arrivals",
      observedAt: new Date()
    };
  }
};

export async function fetchPortwatchBabElMandebRows(): Promise<PortwatchBabElMandebRow[]> {
  const response = await fetchWithTimeout(buildPortwatchBabElMandebApiUrl(), {
    headers: {
      "user-agent": userAgent
    }
  });

  if (!response.ok) {
    throw new Error(`IMF Portwatch returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as PortwatchFeatureResponse;
  const rows = normalizePortwatchBabElMandebRows(payload);
  if (rows.length === 0) {
    throw new Error("Could not find Bab el-Mandeb Portwatch rows");
  }

  return rows;
}

export function buildPortwatchBabElMandebApiUrl(): string {
  const url = new URL(apiUrl);
  url.searchParams.set("f", "json");
  url.searchParams.set("where", `portid='${portId}'`);
  url.searchParams.set("outFields", "date,portid,portname,n_total,ObjectId");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("resultRecordCount", "60");
  url.searchParams.set("orderByFields", "date DESC");
  return url.toString();
}

export function normalizePortwatchBabElMandebRows(payload: PortwatchFeatureResponse): PortwatchBabElMandebRow[] {
  return (payload.features ?? [])
    .flatMap((feature) => {
      const attributes = feature.attributes;
      if (!attributes || attributes.portid !== portId || !isDateString(attributes.date)) {
        return [];
      }

      const row: PortwatchBabElMandebRow = {
        date: attributes.date,
        portid: portId,
        portname: typeof attributes.portname === "string" ? attributes.portname : "Bab el-Mandeb Strait",
        n_total: normalizeCount(attributes.n_total),
        ObjectId: normalizeCount(attributes.ObjectId)
      };
      return [row];
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function formatPortwatchBabElMandebValue(rows: PortwatchBabElMandebRow[]): string {
  const latestRows = rows.slice(-14);
  const latestRow = latestRows.at(-1) ?? rows.at(-1);
  const average14 = average(latestRows.map((row) => row.n_total));
  const average7 = average(latestRows.slice(-7).map((row) => row.n_total));
  const minimum = latestRows.reduce<PortwatchBabElMandebRow | null>(
    (current, row) => (!current || row.n_total < current.n_total ? row : current),
    null
  );
  const dailyValues = latestRows.map((row) => `${row.date}: ${row.n_total}`).join(" | ");

  return [
    "Metric: IMF Portwatch Bab el-Mandeb arrivals of ships",
    `Latest data date: ${latestRow?.date ?? "none"}`,
    `Latest arrivals: ${latestRow ? formatInteger(latestRow.n_total) : "none"}`,
    `Latest ObjectId: ${latestRow?.ObjectId ?? "none"}`,
    `7-day moving average: ${formatDecimal(average7)}`,
    `14-day average: ${formatDecimal(average14)}`,
    `14-day low: ${minimum ? `${minimum.n_total} on ${minimum.date}` : "none"}`,
    `Last 14 daily arrivals: ${dailyValues || "none"}`,
    `Resolution: ${sourceUrl}`,
    `API: ${buildPortwatchBabElMandebApiUrl()}`
  ].join("\n");
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}
