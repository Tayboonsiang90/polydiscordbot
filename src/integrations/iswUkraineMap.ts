import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

export const sourceUrl = "https://storymaps.arcgis.com/stories/36a7f6a6f5a9448496de641cf64bd375";
const storyMapItemDataUrl = "https://www.arcgis.com/sharing/rest/content/items/36a7f6a6f5a9448496de641cf64bd375/data?f=json";
const iswFetchTimeoutMs = 10_000;

export type IswUkraineMapNotice = {
  notice: string;
  assessedMapText: string | null;
  publishedAt: string | null;
};

export function extractIswUkraineMapValue(html: string): string {
  const notice = extractIswUkraineMapNotice(html);
  return formatIswUkraineMapValue(notice);
}

export function extractIswUkraineMapValueFromStoryData(data: unknown): string {
  const notice = extractIswUkraineMapNoticeFromStoryData(data);
  return formatIswUkraineMapValue(notice);
}

export function extractIswUkraineMapNotice(html: string): IswUkraineMapNotice {
  return extractIswUkraineMapNoticeFromTextFields(extractStoryMapTextFields(html), extractMetaContent(html, "article:published_time"));
}

export function extractIswUkraineMapNoticeFromStoryData(data: unknown): IswUkraineMapNotice {
  return extractIswUkraineMapNoticeFromTextFields(extractStoryMapTextFieldsFromData(data), null);
}

export function formatIswUkraineMapValue(notice: IswUkraineMapNotice): string {
  return [
    `Notice: ${notice.notice}`,
    notice.assessedMapText ? `Map status: ${notice.assessedMapText}` : "",
    notice.publishedAt ? `Story published at: ${notice.publishedAt}` : "",
    `Resolution: ${sourceUrl}`
  ]
    .filter(Boolean)
    .join("\n");
}

export const iswUkraineMapAdapter: WebsiteAdapter = {
  id: "isw-ukraine-map",
  commandName: "iswmap",
  displayName: "ISW Ukraine Map",
  sourceUrl,
  defaultChannelName: "iswmap",
  alertRoleName: "ISW Map Alerts",
  alertRoleEmoji: "\uD83D\uDDFA\uFE0F",
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "Fixed 1-minute check for ISW StoryMaps frontline geometry notice changes",
  getErrorNoticeWindowMinutes: () => 30,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const value = await fetchIswUkraineMapValue();
    return {
      value,
      rawValue: value,
      unit: "ISW frontline geometry notice",
      observedAt: new Date()
    };
  }
};

function extractIswUkraineMapNoticeFromTextFields(textFields: string[], publishedAt: string | null): IswUkraineMapNotice {
  const notice = textFields.find((text) => /ISW\b/i.test(text) && /frontline geometry/i.test(text));
  const assessedMapText =
    textFields.find((text) => /Assessed Control of Terrain in Ukraine/i.test(text) && /\bas of\b/i.test(text)) ??
    textFields.find((text) => /Assessed Control of Terrain in Ukraine/i.test(text)) ??
    null;
  if (!notice) {
    throw new Error("Could not find the ISW frontline geometry update notice");
  }

  return {
    notice,
    assessedMapText,
    publishedAt
  };
}

async function fetchIswUkraineMapValue(): Promise<string> {
  let jsonError: unknown;
  try {
    const response = await fetchWithTimeout(
      storyMapItemDataUrl,
      {
        headers: {
          accept: "application/json",
          "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
        }
      },
      iswFetchTimeoutMs
    );

    if (!response.ok) {
      throw new Error(`ArcGIS item data returned HTTP ${response.status}`);
    }

    return extractIswUkraineMapValueFromStoryData(await response.json());
  } catch (error) {
    jsonError = error;
  }

  try {
    const response = await fetchWithTimeout(
      sourceUrl,
      {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "curl/8.5.0 PolymarketResolutionMonitorBot/0.1"
        }
      },
      iswFetchTimeoutMs
    );

    if (!response.ok) {
      throw new Error(`ISW StoryMap returned HTTP ${response.status}`);
    }

    return extractIswUkraineMapValue(await response.text());
  } catch (htmlError) {
    throw new Error(`ISW StoryMap fetch failed. ArcGIS JSON: ${formatError(jsonError)}; StoryMaps HTML: ${formatError(htmlError)}`);
  }
}

function extractStoryMapTextFields(html: string): string[] {
  const fields: string[] = [];
  const textFieldPattern = /"text":"((?:\\.|[^"\\])*)"/g;
  for (const match of html.matchAll(textFieldPattern)) {
    const text = parseJsonString(match[1]);
    if (text) {
      fields.push(normalizeText(stripHtml(text)));
    }
  }
  return fields.filter(Boolean);
}

function extractStoryMapTextFieldsFromData(data: unknown): string[] {
  const fields: string[] = [];
  collectTextFields(data, fields);
  return fields.map((text) => normalizeText(stripHtml(text))).filter(Boolean);
}

function collectTextFields(value: unknown, fields: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextFields(item, fields);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    if (key === "text" && typeof item === "string") {
      fields.push(item);
      continue;
    }

    collectTextFields(item, fields);
  }
}

function parseJsonString(value: string): string | null {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return null;
  }
}

function extractMetaContent(html: string, property: string): string | null {
  const pattern = new RegExp(`<meta[^>]+property=["']${escapeRegExp(property)}["'][^>]+content=["']([^"']+)["']`, "i");
  return html.match(pattern)?.[1] ?? null;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
