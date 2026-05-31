import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { AdapterValue, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";

const sourceUrl = "https://sale.alignedlayer.com/";
const defaultPolymarketUrl = "https://polymarket.com/event/aligned-layer-fdv-above-one-day-after-launch";
const userAgent = "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1";

export function extractAlignedLayerSaleAssetUrls(html: string, baseUrl = sourceUrl): string[] {
  const $ = cheerio.load(html);
  const urls = [
    ...$("script[src]")
      .map((_, element) => $(element).attr("src"))
      .get(),
    ...$("link[href]")
      .filter((_, element) => {
        const rel = ($(element).attr("rel") ?? "").toLowerCase();
        return rel.includes("stylesheet");
      })
      .map((_, element) => $(element).attr("href"))
      .get()
  ];

  return uniqueStrings(
    urls
      .filter((url): url is string => Boolean(url))
      .map((url) => new URL(url, baseUrl).toString())
  );
}

export function extractAlignedLayerSaleValue(html: string, assetContents: string[] = []): string {
  const $ = cheerio.load(html);
  const title = normalizeText($("title").first().text()) || "not found";
  const assetUrls = extractAlignedLayerSaleAssetUrls(html);
  const visibleText = extractVisibleText(html);
  const salePhrases = extractSalePhrases([visibleText, ...assetContents]);
  const status = classifyAlignedLayerSaleStatus([title, visibleText, ...salePhrases].join(" "));
  const fingerprintSource = [
    title,
    visibleText,
    assetUrls.join("\n"),
    ...salePhrases,
    ...assetContents.map((content) => createHash("sha256").update(content).digest("hex"))
  ].join("\n");
  const fingerprint = createHash("sha256").update(fingerprintSource).digest("hex").slice(0, 16);

  return [
    `Sale status: ${status}`,
    `Title: ${title}`,
    `Sale page text: ${salePhrases.length ? salePhrases.join(" | ") : visibleText || "none detected in HTML shell"}`,
    `Assets: ${assetUrls.map((url) => new URL(url).pathname).join(", ") || "none detected"}`,
    `Content fingerprint: ${fingerprint}`
  ].join("\n");
}

export function classifyAlignedLayerSaleStatus(text: string): string {
  const normalized = normalizeText(text).toLowerCase();
  if (/\b(sale is on hold|currently on hold|sale paused|paused|suspended)\b/.test(normalized)) {
    return "on hold";
  }
  if (/\b(sale (has )?(resumed|opened)|sale is (live|open|active)|token sale is live|purchase align|buy align)\b/.test(normalized)) {
    return "possibly resumed/open";
  }
  if (/\b(sale (has )?ended|sale is closed|closed|ended)\b/.test(normalized)) {
    return "closed/ended";
  }
  return "unknown";
}

export const alignedLayerSaleAdapter: WebsiteAdapter = {
  id: "aligned-layer-sale",
  commandName: "alignedsale",
  displayName: "Aligned Layer Sale",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "alignedsale",
  alertRoleName: "Aligned Sale Alerts",
  alertRoleEmoji: "\u23F8\uFE0F",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const html = await fetchText(sourceUrl, "Aligned Layer sale page");
    const assetUrls = extractAlignedLayerSaleAssetUrls(html).filter((url) => url.endsWith(".js")).slice(0, 1);
    const assetContents = await Promise.all(assetUrls.map((url) => fetchText(url, "Aligned Layer sale app asset")));
    const value = extractAlignedLayerSaleValue(html, assetContents);

    return {
      value,
      rawValue: value,
      unit: "sale page state",
      observedAt: new Date()
    };
  }
};

async function fetchText(url: string, label: string): Promise<string> {
  const response = await fetchWithTimeout(url, {
    headers: {
      "user-agent": userAgent
    }
  });

  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }

  return response.text();
}

function extractVisibleText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, path, meta, link").remove();
  return normalizeText($("body").text());
}

function extractSalePhrases(texts: string[]): string[] {
  const phrases: string[] = [];
  for (const text of texts) {
    for (const literal of extractQuotedStrings(text)) {
      const phrase = normalizeText(unescapeJsLiteral(literal));
      const lower = phrase.toLowerCase();
      if (
        phrase.length >= 4 &&
        phrase.length <= 180 &&
        lower.includes("sale") &&
        /\b(hold|paused|pause|resume|resumed|open|live|active|closed|ended|currently|updates|official channels|patience)\b/.test(
          lower
        )
      ) {
        phrases.push(phrase);
      }
    }
  }

  return uniqueStrings(phrases).slice(0, 6);
}

function extractQuotedStrings(text: string): string[] {
  const values: string[] = [];
  const pattern = /"((?:\\.|[^"\\]){1,240})"|'((?:\\.|[^'\\]){1,240})'/g;
  for (const match of text.matchAll(pattern)) {
    values.push(match[1] ?? match[2] ?? "");
  }
  return values;
}

function unescapeJsLiteral(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\n|\\r|\\t/g, " ")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
