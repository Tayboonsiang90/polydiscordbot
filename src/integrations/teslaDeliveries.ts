import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://ir.tesla.com/press";
const secSubmissionsUrl = "https://data.sec.gov/submissions/CIK0001318605.json";
const secArchiveBaseUrl = "https://www.sec.gov/Archives/edgar/data/1318605";
const secUserAgent = "PolymarketResolutionMonitorBot/0.1 tesla-deliveries-monitor";

export type TeslaDeliveryRelease = {
  title: string;
  date: string;
  pressUrl: string;
  filingUrl: string;
  totalDeliveries: string | null;
};

type SecRecentFilings = {
  filings?: {
    recent?: {
      accessionNumber?: unknown[];
      filingDate?: unknown[];
      form?: unknown[];
      primaryDocument?: unknown[];
      items?: unknown[];
    };
  };
};

type SecFilingCandidate = {
  accessionNumber: string;
  accessionPath: string;
  filingDate: string;
};

export function extractLatestTeslaDeliveryReleaseFromFilings(data: unknown): SecFilingCandidate[] {
  const recent = (data as SecRecentFilings | null)?.filings?.recent;
  if (!recent) {
    return [];
  }

  const forms = recent.form ?? [];
  return forms
    .map((form, index) => {
      const accessionNumber = recent.accessionNumber?.[index];
      const filingDate = recent.filingDate?.[index];
      const items = recent.items?.[index];
      if (form !== "8-K" || typeof accessionNumber !== "string" || typeof filingDate !== "string") {
        return null;
      }

      if (typeof items === "string" && !items.includes("2.02")) {
        return null;
      }

      return {
        accessionNumber,
        accessionPath: accessionNumber.replace(/-/g, ""),
        filingDate
      };
    })
    .filter((candidate): candidate is SecFilingCandidate => Boolean(candidate));
}

export function extractTeslaDeliveryReleaseFromExhibit(html: string, filingDate: string, filingUrl: string): TeslaDeliveryRelease | null {
  const $ = cheerio.load(html);
  const text = normalizeText($("body").text());
  const title = extractDeliveryTitle(text);
  if (!title) {
    return null;
  }

  return {
    title,
    date: filingDate,
    pressUrl: `https://ir.tesla.com/press-release/${slugifyTeslaPressTitle(title)}`,
    filingUrl,
    totalDeliveries: extractTotalDeliveries($, text)
  };
}

export function formatTeslaDeliveryReleaseValue(release: TeslaDeliveryRelease): string {
  return [
    `Title: ${release.title}`,
    `Date: ${release.date}`,
    `Total Deliveries: ${release.totalDeliveries ?? "not parsed"}`,
    `Press URL: ${release.pressUrl}`,
    `SEC Filing: ${release.filingUrl}`
  ].join("\n");
}

export const teslaDeliveriesAdapter: WebsiteAdapter = {
  id: "tesla-deliveries",
  commandName: "tesla",
  displayName: "Tesla Deliveries",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/how-many-tesla-deliveries-in-q2-2026",
  defaultChannelName: "tesla",
  alertRoleName: "Tesla Deliveries Alerts",
  alertRoleEmoji: "\uD83D\uDE97",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const filingsResponse = await fetchWithTimeout(secSubmissionsUrl, {
      headers: {
        "user-agent": secUserAgent
      }
    });
    if (!filingsResponse.ok) {
      throw new Error(`SEC submissions returned HTTP ${filingsResponse.status}`);
    }

    const candidates = extractLatestTeslaDeliveryReleaseFromFilings(await filingsResponse.json());
    for (const candidate of candidates.slice(0, 12)) {
      const release = await fetchReleaseFromCandidate(candidate);
      if (release) {
        const value = formatTeslaDeliveryReleaseValue(release);
        return {
          value,
          rawValue: value,
          unit: "latest Tesla deliveries release",
          observedAt: new Date()
        };
      }
    }

    throw new Error("Could not find a recent Tesla production and deliveries press release in SEC filings");
  }
};

async function fetchReleaseFromCandidate(candidate: SecFilingCandidate): Promise<TeslaDeliveryRelease | null> {
  const filingDirectoryUrl = `${secArchiveBaseUrl}/${candidate.accessionPath}`;
  const indexResponse = await fetchWithTimeout(`${filingDirectoryUrl}/index.json`, {
    headers: {
      "user-agent": secUserAgent
    }
  });
  if (!indexResponse.ok) {
    throw new Error(`SEC filing index returned HTTP ${indexResponse.status}`);
  }

  const indexData = (await indexResponse.json()) as { directory?: { item?: { name?: unknown }[] } };
  const exhibitNames = (indexData.directory?.item ?? [])
    .map((item) => item.name)
    .filter((name): name is string => typeof name === "string" && /^exhibit.*\.htm$/i.test(name));

  for (const exhibitName of exhibitNames) {
    const exhibitUrl = `${filingDirectoryUrl}/${exhibitName}`;
    const exhibitResponse = await fetchWithTimeout(exhibitUrl, {
      headers: {
        "user-agent": secUserAgent
      }
    });
    if (!exhibitResponse.ok) {
      throw new Error(`SEC exhibit returned HTTP ${exhibitResponse.status}`);
    }

    const release = extractTeslaDeliveryReleaseFromExhibit(await exhibitResponse.text(), candidate.filingDate, exhibitUrl);
    if (release) {
      return release;
    }
  }

  return null;
}

function extractDeliveryTitle(text: string): string | null {
  return (
    text.match(/Tesla\s+(?:First|Second|Third|Fourth)\s+Quarter\s+20\d{2}\s+Production,\s+Deliveries\s+(?:&|and)\s+Deployments/i)?.[0] ??
    text.match(/Tesla\s+Vehicle\s+Production\s+&\s+Deliveries[^.]+/i)?.[0] ??
    null
  );
}

function extractTotalDeliveries($: cheerio.CheerioAPI, text: string): string | null {
  for (const row of $("tr").toArray()) {
    const cells = $(row)
      .find("td,th")
      .map((_, cell) => normalizeText($(cell).text()))
      .get()
      .filter(Boolean);
    if (cells[0] === "Total" && cells[2]) {
      return cells[2];
    }
  }

  return text.match(/Total\s*((?:\d{1,3},)+\d{3})\s*((?:\d{1,3},)+\d{3})\s*\d+%/)?.[2] ?? null;
}

function slugifyTeslaPressTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
