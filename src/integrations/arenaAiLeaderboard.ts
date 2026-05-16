import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://arena.ai/leaderboard/text/overall-no-style-control";

export type ArenaAiRankedModel = {
  rank: string;
  model: string;
};

export function extractArenaAiTopModelsValue(html: string): string {
  const models = extractArenaAiTopModels(html);
  return [
    "Top 3 Models:",
    ...models.map((model) => `${model.rank}. ${model.model}`),
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function extractArenaAiTopModels(html: string, limit = 3): ArenaAiRankedModel[] {
  const $ = cheerio.load(html);
  const models = $("tr a[title]")
    .map((_, anchor) => {
      const link = $(anchor);
      const model = normalizeText(link.attr("title") ?? link.text());
      const rank = normalizeText(link.closest("tr").find("td").first().text());
      return model && rank ? { rank, model } : null;
    })
    .get()
    .filter((model): model is ArenaAiRankedModel => Boolean(model))
    .slice(0, limit);

  if (models.length === 0) {
    throw new Error("Could not find Arena AI leaderboard models");
  }

  return models;
}

export const arenaAiLeaderboardAdapter: WebsiteAdapter = {
  id: "arena-ai-no-style-control",
  commandName: "arenaai",
  displayName: "Arena AI No Style Control",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/best-ai-model-on-may-16-style-control-off",
  defaultChannelName: "arenaai",
  alertRoleName: "Arena AI Alerts",
  alertRoleEmoji: "\uD83E\uDD16",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(sourceUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`Arena AI returned HTTP ${response.status}`);
    }

    const value = extractArenaAiTopModelsValue(await response.text());
    return {
      value,
      rawValue: value,
      unit: "top 3 Arena AI models",
      observedAt: new Date()
    };
  }
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
