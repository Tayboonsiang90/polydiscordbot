import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

export const sourceUrl = "https://storymaps.arcgis.com/stories/36a7f6a6f5a9448496de641cf64bd375";

export type IswUkraineMapNotice = {
  notice: string;
  assessedMapText: string | null;
  publishedAt: string | null;
};

export function extractIswUkraineMapValue(html: string): string {
  const notice = extractIswUkraineMapNotice(html);
  return formatIswUkraineMapValue(notice);
}

export function extractIswUkraineMapNotice(html: string): IswUkraineMapNotice {
  const textFields = extractStoryMapTextFields(html);
  const notice = textFields.find((text) => /ISW\b/i.test(text) && /frontline geometry/i.test(text));
  const assessedMapText = textFields.find((text) => /Assessed Control of Terrain in Ukraine/i.test(text)) ?? null;
  const publishedAt = extractMetaContent(html, "article:published_time");

  if (!notice) {
    throw new Error("Could not find the ISW frontline geometry update notice");
  }

  return {
    notice,
    assessedMapText,
    publishedAt
  };
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
  alertRoleEmoji: "🗺️",
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "Fixed 1-minute check for ISW StoryMaps frontline geometry notice changes",
  getErrorNoticeWindowMinutes: () => 30,
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`ISW StoryMap returned HTTP ${response.status}`);
    }

    const value = extractIswUkraineMapValue(await response.text());
    return {
      value,
      rawValue: value,
      unit: "ISW frontline geometry notice",
      observedAt: new Date()
    };
  }
};

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
