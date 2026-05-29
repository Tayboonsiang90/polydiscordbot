import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.whitehouse.gov/aliens/";
const tableDataUrl =
  "https://www.whitehouse.gov/wp-content/themes/whitehouse/static-assets/flourish/flourish-geo-embed/table/index.html";
const targetNeighborhood = "New York, NY";

type FlourishTableData = {
  rows?: Array<{
    columns?: unknown[];
  }>;
};

export type AlienArrestsCityRow = {
  neighborhood: string;
  totalArrests: number;
  datesOfArrest: string;
  criminalCharges: string;
  countriesOfOrigin: string;
  gangAffiliation: string;
};

export function extractWhiteHouseAliensNycValue(html: string): string {
  const row = extractWhiteHouseAliensCityRow(html, targetNeighborhood);
  return [
    `City: ${row.neighborhood}`,
    `Total Arrests: ${row.totalArrests}`,
    `Dates of Arrest: ${row.datesOfArrest}`,
    `Gang Affiliation: ${row.gangAffiliation || "not listed"}`,
    `Criminal Charges: ${truncateField(row.criminalCharges)}`,
    `Countries of Origin: ${truncateField(row.countriesOfOrigin)}`
  ].join("\n");
}

export function extractWhiteHouseAliensCityRow(html: string, neighborhood: string): AlienArrestsCityRow {
  const data = extractFlourishTableData(html);
  const matchingRow = data.rows?.find((row) => String(row.columns?.[0] ?? "").toLowerCase() === neighborhood.toLowerCase());
  const columns = matchingRow?.columns;

  if (!columns || columns.length < 6) {
    throw new Error(`Could not find ${neighborhood} in the White House aliens table`);
  }

  const totalArrests = Number(columns[1]);
  if (!Number.isFinite(totalArrests) || totalArrests < 0) {
    throw new Error(`Invalid ${neighborhood} Total Arrests value: ${String(columns[1])}`);
  }

  return {
    neighborhood: String(columns[0]),
    totalArrests,
    datesOfArrest: String(columns[2] ?? ""),
    criminalCharges: String(columns[3] ?? ""),
    countriesOfOrigin: String(columns[4] ?? ""),
    gangAffiliation: String(columns[5] ?? "")
  };
}

export const whiteHouseAliensNycAdapter: WebsiteAdapter = {
  id: "white-house-aliens-nyc",
  commandName: "aliennyc",
  displayName: "White House Alien Arrests NYC",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/will-alien-arrests-in-new-york-hit-by-june-30",
  defaultChannelName: "aliennyc",
  alertRoleName: "Alien NYC Arrests Alerts",
  alertRoleEmoji: "\uD83D\uDEF8",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(tableDataUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`White House aliens table returned HTTP ${response.status}`);
    }

    const value = extractWhiteHouseAliensNycValue(await response.text());
    return {
      value,
      rawValue: value,
      unit: "Total Arrests",
      observedAt: new Date()
    };
  }
};

function extractFlourishTableData(html: string): FlourishTableData {
  const marker = "_Flourish_data = ";
  const start = html.indexOf(marker);
  if (start === -1) {
    throw new Error("Could not find White House aliens Flourish table data");
  }

  const jsonStart = start + marker.length;
  const jsonEnd = html.indexOf(",\n\t\t\t\t_Flourish_visualisation_id", jsonStart);
  if (jsonEnd === -1) {
    throw new Error("Could not find the end of White House aliens Flourish table data");
  }

  return JSON.parse(html.slice(jsonStart, jsonEnd).trim()) as FlourishTableData;
}

function truncateField(value: string): string {
  return value.length > 900 ? `${value.slice(0, 897)}...` : value || "not listed";
}
