import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { fetchWithTimeout } from "../http.js";
import { resolveIntegrationPolymarketQueue, upsertPolymarketQueueUrl } from "../polymarketQueue.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const noStyleControlUrl = "https://arena.ai/leaderboard/text/overall-no-style-control";
const styleControlOnUrl = "https://arena.ai/leaderboard/text/overall";
const mathUrl = "https://arena.ai/leaderboard/text/math-no-style-control";
const codeWebdevUrl = "https://arena.ai/leaderboard/code/webdev";
const textToImageUrl = "https://arena.ai/leaderboard/text-to-image";
const textToVideoUrl = "https://arena.ai/leaderboard/text-to-video";

const chineseCompanies = new Set([
  "Alibaba",
  "Alibaba-ATH",
  "Baidu",
  "Bytedance",
  "DeepSeek",
  "Meituan",
  "MiniMax",
  "Moonshot",
  "StepFun",
  "Tencent",
  "Xiaomi",
  "Z.ai"
]);

type ArenaAiLeaderboardConfig = {
  id: string;
  commandName: string;
  displayName: string;
  sourceUrl: string;
  leaderboardName: string;
  defaultChannelName: string;
  alertRoleName: string;
  alertRoleEmoji: string;
  unit: string;
  polymarketUrls: string[];
  rowFilter?: (row: ArenaAiRankedModel) => boolean;
  topCompanyLabel?: string;
};

export type ArenaAiRankedModel = {
  rank: string;
  rankSpread: string;
  model: string;
  company: string;
  score: string;
  votes: string;
};

const noStyleControlPolymarketUrls = [
  "https://polymarket.com/event/best-ai-model-on-july-25-20260717010053151",
  "https://polymarket.com/event/best-ai-model-on-august-1-20260717010751015",
  "https://polymarket.com/event/which-company-has-best-ai-model-end-of-august-20260717015626546"
];

const configs: ArenaAiLeaderboardConfig[] = [
  {
    id: "arena-ai-no-style-control",
    commandName: "arenaai",
    displayName: "Arena AI No Style Control",
    sourceUrl: noStyleControlUrl,
    leaderboardName: "Text Arena Overall (Style Control Off)",
    defaultChannelName: "arenaai",
    alertRoleName: "Arena AI Alerts",
    alertRoleEmoji: "🤖",
    unit: "top Arena AI no-style-control models",
    polymarketUrls: noStyleControlPolymarketUrls
  },
  {
    id: "arena-ai-style-control-on",
    commandName: "arenaaistyle",
    displayName: "Arena AI Style Control On",
    sourceUrl: styleControlOnUrl,
    leaderboardName: "Text Arena Overall (Style Control On)",
    defaultChannelName: "arenaaistyle",
    alertRoleName: "Arena Style Alerts",
    alertRoleEmoji: "🤖",
    unit: "top Arena AI style-control-on models",
    polymarketUrls: [
      "https://polymarket.com/event/which-company-has-1-ai-model-end-of-august-style-control-on-20260717021043100"
    ]
  },
  {
    id: "arena-ai-math",
    commandName: "arenaaimath",
    displayName: "Arena AI Math",
    sourceUrl: mathUrl,
    leaderboardName: "Text Arena Math (Style Control Off)",
    defaultChannelName: "arenaaimath",
    alertRoleName: "Arena Math Alerts",
    alertRoleEmoji: "🧮",
    unit: "top Arena AI math models",
    polymarketUrls: [
      "https://polymarket.com/event/which-company-has-the-best-text-arena-math-ai-model-end-of-august-20260717012538240"
    ]
  },
  {
    id: "arena-ai-code-webdev",
    commandName: "arenawebdev",
    displayName: "Arena AI Code WebDev",
    sourceUrl: codeWebdevUrl,
    leaderboardName: "Code Arena WebDev",
    defaultChannelName: "arenawebdev",
    alertRoleName: "Arena WebDev Alerts",
    alertRoleEmoji: "💻",
    unit: "top Arena AI code WebDev models",
    polymarketUrls: [
      "https://polymarket.com/event/which-company-has-the-best-code-arena-webdev-ai-model-end-of-july-20260715140712903",
      "https://polymarket.com/event/which-company-has-the-best-code-arena-webdev-ai-model-end-of-august-20260716213053775"
    ]
  },
  {
    id: "arena-ai-text-to-image",
    commandName: "arenaimage",
    displayName: "Arena AI Text-to-Image",
    sourceUrl: textToImageUrl,
    leaderboardName: "Text-to-Image Arena",
    defaultChannelName: "arenaimage",
    alertRoleName: "Arena Image Alerts",
    alertRoleEmoji: "🎨",
    unit: "top Arena AI text-to-image models",
    polymarketUrls: [
      "https://polymarket.com/event/which-company-has-the-best-text-to-image-ai-end-of-august-20260716212635678"
    ]
  },
  {
    id: "arena-ai-text-to-video",
    commandName: "arenavideo",
    displayName: "Arena AI Text-to-Video",
    sourceUrl: textToVideoUrl,
    leaderboardName: "Text-to-Video Arena",
    defaultChannelName: "arenavideo",
    alertRoleName: "Arena Video Alerts",
    alertRoleEmoji: "🎬",
    unit: "top Arena AI text-to-video models",
    polymarketUrls: [
      "https://polymarket.com/event/which-company-has-the-best-text-to-video-ai-end-of-august-20260717022544476"
    ]
  },
  {
    id: "arena-ai-chinese-company",
    commandName: "arenachina",
    displayName: "Arena AI Chinese Company",
    sourceUrl: noStyleControlUrl,
    leaderboardName: "Text Arena Overall (Chinese companies only)",
    defaultChannelName: "arenachina",
    alertRoleName: "Arena China Alerts",
    alertRoleEmoji: "🇨🇳",
    unit: "top Arena AI Chinese-company models",
    polymarketUrls: ["https://polymarket.com/event/best-chinese-ai-company-end-of-august-20260717004241592"],
    rowFilter: (row) => chineseCompanies.has(row.company),
    topCompanyLabel: "Top qualifying company"
  }
];

export function extractArenaAiTopModelsValue(html: string): string {
  return formatArenaAiLeaderboardValue(
    {
      sourceUrl: noStyleControlUrl,
      leaderboardName: "Text Arena Overall (Style Control Off)"
    },
    extractArenaAiTopModels(html)
  );
}

export function extractArenaAiTopModels(html: string, limit = 5): ArenaAiRankedModel[] {
  return extractArenaAiLeaderboardRows(html).slice(0, limit);
}

export function extractArenaAiLeaderboardRows(html: string): ArenaAiRankedModel[] {
  const $ = cheerio.load(html);
  const rows = $("tr")
    .map((_, row) => parseArenaAiTableRow($, row))
    .get()
    .filter((row): row is ArenaAiRankedModel => Boolean(row));

  if (rows.length === 0) {
    throw new Error("Could not find Arena AI leaderboard models");
  }

  return rows;
}

export function formatArenaAiLeaderboardValue(
  config: Pick<ArenaAiLeaderboardConfig, "leaderboardName" | "sourceUrl" | "rowFilter" | "topCompanyLabel">,
  rows: ArenaAiRankedModel[],
  limit = 5
): string {
  const filteredRows = (config.rowFilter ? rows.filter(config.rowFilter) : rows).slice(0, limit);
  const leader = filteredRows[0];
  if (!leader) {
    throw new Error(`Could not find qualifying Arena AI rows for ${config.leaderboardName}`);
  }

  return [
    "Metric: Arena AI leaderboard",
    `Leaderboard: ${config.leaderboardName}`,
    `Top model: #${leader.rank} ${leader.model}`,
    `${config.topCompanyLabel ?? "Top company"}: ${leader.company}`,
    "Top 5:",
    ...filteredRows.map(formatArenaAiRow),
    `Resolution: ${config.sourceUrl}`
  ].join("\n");
}

export const arenaAiLeaderboardAdapters = configs.map(createArenaAiLeaderboardAdapter);
export const arenaAiLeaderboardAdapter = arenaAiLeaderboardAdapters[0];
export const arenaAiStyleControlOnAdapter = arenaAiLeaderboardAdapters[1];
export const arenaAiMathAdapter = arenaAiLeaderboardAdapters[2];
export const arenaAiCodeWebdevAdapter = arenaAiLeaderboardAdapters[3];
export const arenaAiTextToImageAdapter = arenaAiLeaderboardAdapters[4];
export const arenaAiTextToVideoAdapter = arenaAiLeaderboardAdapters[5];
export const arenaAiChineseCompanyAdapter = arenaAiLeaderboardAdapters[6];

function createArenaAiLeaderboardAdapter(config: ArenaAiLeaderboardConfig): WebsiteAdapter {
  return {
    id: config.id,
    commandName: config.commandName,
    displayName: config.displayName,
    sourceUrl: config.sourceUrl,
    defaultPolymarketUrl: config.polymarketUrls[0],
    defaultChannelName: config.defaultChannelName,
    alertRoleName: config.alertRoleName,
    alertRoleEmoji: config.alertRoleEmoji,
    async refreshSettings(integration: Integration): Promise<string> {
      return seedArenaPolymarketMarkets(integration, config.polymarketUrls).settingsJson ?? integration.settingsJson ?? "{}";
    },
    upsertPolymarketMarket(integration: Integration, url: string): { settingsJson: string | null; activeUrl: string | null } {
      return upsertPolymarketQueueUrl(integration, url);
    },
    shouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
      return buildArenaRankSignature(previousValue) !== buildArenaRankSignature(currentValue);
    },
    async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
      const response = await fetchWithTimeout(config.sourceUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
        }
      });

      if (!response.ok) {
        throw new Error(`Arena AI returned HTTP ${response.status}`);
      }

      const rows = extractArenaAiLeaderboardRows(await response.text());
      const value = formatArenaAiLeaderboardValue(config, rows);
      return {
        value,
        rawValue: value,
        unit: config.unit,
        observedAt: new Date()
      };
    }
  };
}

function seedArenaPolymarketMarkets(
  integration: Integration,
  urls: string[],
  now = new Date()
): { settingsJson: string | null; activeUrl: string | null } {
  let resolved = resolveIntegrationPolymarketQueue(integration, now);
  let workingIntegration: Integration = {
    ...integration,
    settingsJson: resolved.settingsJson,
    polymarketUrl: resolved.activeUrl ?? integration.polymarketUrl
  };

  for (const url of urls) {
    resolved = upsertPolymarketQueueUrl(workingIntegration, url, now);
    workingIntegration = {
      ...workingIntegration,
      settingsJson: resolved.settingsJson,
      polymarketUrl: resolved.activeUrl ?? workingIntegration.polymarketUrl
    };
  }

  return resolved;
}

function parseArenaAiTableRow($: cheerio.CheerioAPI, row: AnyNode): ArenaAiRankedModel | null {
  const cells = $(row).find("td");
  if (cells.length < 4) {
    return null;
  }

  const rank = normalizeText($(cells[0]).text());
  if (!/^\d+$/.test(rank)) {
    return null;
  }

  const modelCell = $(cells[2]);
  const model = extractModelName(modelCell);
  if (!model) {
    return null;
  }

  return {
    rank,
    rankSpread: normalizeText($(cells[1]).text()) || "unknown",
    model,
    company: extractCompanyName($, modelCell),
    score: normalizeText($(cells[3]).text()).replace(/\s*Preliminary\s*$/i, " Preliminary"),
    votes: cells.length >= 5 ? normalizeText($(cells[4]).text()) : "unknown"
  };
}

function extractModelName(modelCell: cheerio.Cheerio<AnyNode>): string {
  const titled = modelCell.find("span[title], a[title]").first();
  return normalizeText(titled.attr("title") ?? titled.text());
}

function extractCompanyName($: cheerio.CheerioAPI, modelCell: cheerio.Cheerio<AnyNode>): string {
  const ownershipLine = modelCell
    .find("span")
    .toArray()
    .map((element) => normalizeText($(element).text()))
    .find((text) => text.includes("·"));
  const company = ownershipLine?.split("·")[0]?.trim() || normalizeText(modelCell.find("svg title, title").first().text());
  return company || "unknown";
}

function formatArenaAiRow(row: ArenaAiRankedModel): string {
  return `#${row.rank} ${row.company} - ${row.model} (score ${row.score})`;
}

function buildArenaRankSignature(value: string | null): string {
  if (!value) {
    return "";
  }

  const rows = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^#\d+\s+/.test(line))
    .map((line) => line.replace(/\s+\(score .+\)$/, ""));
  if (rows.length) {
    return rows.join("|");
  }

  return value;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
