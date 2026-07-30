import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

export const frontierMathOpenProblemsUrl = "https://epoch.ai/frontiermath/open-problems";
export const frontierMathSolvedMarketUrl =
  "https://polymarket.com/event/another-frontier-math-problem-solved-byptptpt-20260728180222350";

const baselineSolvedSlugs = new Set(["ramsey-hypergraphs", "q2-absolute-galois"]);
const baselineSolvedTitles = new Set([
  normalizeProblemTitle("A Ramsey-style Problem on Hypergraphs"),
  normalizeProblemTitle("The 2-adic Absolute Galois Group")
]);

export type FrontierMathSolvedProblem = {
  title: string;
  url: string;
  slug: string;
  notability: string;
};

export const frontierMathOpenProblemsAdapter: WebsiteAdapter = {
  id: "frontiermath-open-problems",
  commandName: "frontiermathsolved",
  displayName: "FrontierMath Open Problems",
  sourceUrl: frontierMathOpenProblemsUrl,
  defaultPolymarketUrl: frontierMathSolvedMarketUrl,
  defaultChannelName: "frontiermath-solved",
  alertRoleName: "FrontierMath Solved Alerts",
  alertRoleEmoji: "🧮",
  getPollIntervalMinutes(): number {
    return 5;
  },
  getPollIntervalReason(): string {
    return "Checks Epoch AI's official solved classifications every 5 minutes";
  },
  shouldAlertOnChange(previousValue: string | null, currentValue: string): boolean {
    if (!previousValue) {
      return false;
    }

    const previousUrls = new Set(extractAdditionalSolvedUrls(previousValue));
    return extractAdditionalSolvedUrls(currentValue).some((url) => !previousUrls.has(url));
  },
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(frontierMathOpenProblemsUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });
    if (!response.ok) {
      throw new Error(`Epoch AI FrontierMath returned HTTP ${response.status}`);
    }

    const solvedProblems = extractFrontierMathSolvedProblems(await response.text());
    const value = formatFrontierMathSolvedValue(solvedProblems);
    return {
      value,
      rawValue: JSON.stringify(solvedProblems.map((problem) => problem.url)),
      unit: "Epoch-confirmed solved open problems",
      observedAt: new Date()
    };
  }
};

export function extractFrontierMathSolvedProblems(html: string): FrontierMathSolvedProblem[] {
  const $ = cheerio.load(html);
  const cards = $(".open-problem");
  if (cards.length === 0) {
    throw new Error("Could not find Epoch AI FrontierMath open-problem cards");
  }

  const solvedProblems = cards
    .map((_, card) => {
      const element = $(card);
      if (!element.find(".open-problem-status").hasClass("solved")) {
        return null;
      }

      const title = normalizeWhitespace(element.find(".display-5").first().text());
      const href = element.find("a.cover-link").first().attr("href");
      if (!title || !href) {
        throw new Error("Epoch AI returned a solved FrontierMath card without a title or link");
      }

      const url = new URL(href, frontierMathOpenProblemsUrl).toString();
      return {
        title,
        url,
        slug: getProblemSlug(url),
        notability: normalizeWhitespace(element.find(".notability-tag").first().text()) || "not listed"
      };
    })
    .get()
    .filter((problem): problem is FrontierMathSolvedProblem => problem !== null);

  return [...new Map(solvedProblems.map((problem) => [problem.url, problem])).values()].sort((left, right) =>
    left.title.localeCompare(right.title)
  );
}

export function formatFrontierMathSolvedValue(solvedProblems: FrontierMathSolvedProblem[]): string {
  const additionalProblems = solvedProblems.filter((problem) => !isIssuanceBaselineProblem(problem));
  return [
    `Qualifying additional solved: ${additionalProblems.length}`,
    `Status: ${additionalProblems.length ? "QUALIFYING EPOCH SOLUTION DETECTED" : "No additional Epoch-confirmed solution"}`,
    `Epoch solved total: ${solvedProblems.length}`,
    "Additional solved problems:",
    ...(additionalProblems.length ? additionalProblems.map(formatProblem) : ["none"]),
    "All Epoch solved problems:",
    ...(solvedProblems.length ? solvedProblems.map(formatProblem) : ["none"]),
    `Resolution: ${frontierMathOpenProblemsUrl}`
  ].join("\n");
}

export function extractAdditionalSolvedUrls(value: string): string[] {
  const section = value.match(/Additional solved problems:\n([\s\S]*?)\nAll Epoch solved problems:/)?.[1] ?? "";
  return [...section.matchAll(/https:\/\/epoch\.ai\/frontiermath\/open-problems\/[^\s)]+/g)].map((match) => match[0]);
}

function isIssuanceBaselineProblem(problem: FrontierMathSolvedProblem): boolean {
  return baselineSolvedSlugs.has(problem.slug) || baselineSolvedTitles.has(normalizeProblemTitle(problem.title));
}

function formatProblem(problem: FrontierMathSolvedProblem): string {
  return `- ${problem.title} (${problem.notability}) — ${problem.url}`;
}

function getProblemSlug(url: string): string {
  return new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "";
}

function normalizeProblemTitle(value: string): string {
  return normalizeWhitespace(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
