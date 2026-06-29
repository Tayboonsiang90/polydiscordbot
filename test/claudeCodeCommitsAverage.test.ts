import { describe, expect, it } from "vitest";
import {
  buildClaudeGithubCommitSearchQuery,
  claudeCodeCommitsAverageAdapter,
  extractClaudeAverageBracketsFromGamma,
  extractClaudeAverageRows,
  formatClaudeAverageValue,
  formatClaudeGithubAlphaLines
} from "../src/integrations/claudeCodeCommitsAverage.js";

const polymarketUrl = "https://polymarket.com/event/claude-code-commits-end-of-june";

describe("Claude Code 7D Avg adapter", () => {
  it("extracts daily rows for 7D average analysis", () => {
    expect(
      extractClaudeAverageRows({
        data: [
          {
            date: "Sun, 21 Jun 2026 00:00:00 GMT",
            claude_code_count: 538705,
            github_total_count: 7634392,
            claude_pct_of_github: 7.056292,
            market_share_pct: 93.653
          },
          {
            date: "Mon, 22 Jun 2026 00:00:00 GMT",
            claude_code_count: "609159",
            github_total_count: "9316619",
            claude_pct_of_github: "6.538413",
            market_share_pct: "93.291"
          }
        ]
      })
    ).toEqual([
      {
        date: "2026-06-21",
        commits: 538705,
        githubTotalCount: 7634392,
        claudePctOfGithub: 7.056292,
        marketSharePct: 93.653
      },
      {
        date: "2026-06-22",
        commits: 609159,
        githubTotalCount: 9316619,
        claudePctOfGithub: 6.538413,
        marketSharePct: 93.291
      }
    ]);
  });

  it("extracts unresolved end-of-June bracket markets from Gamma", () => {
    expect(
      extractClaudeAverageBracketsFromGamma([
        {
          endDate: "2026-06-30T00:00:00Z",
          markets: [
            { groupItemTitle: "<500.0k", active: true, closed: false },
            { groupItemTitle: "550.0-600.0k", active: true, closed: false },
            { groupItemTitle: "750.0k+", question: "Will Claude Code Commits be at least 750.0k on June 30?", active: true, closed: false },
            { groupItemTitle: "500.0-550.0k", active: false, closed: true }
          ]
        }
      ])
    ).toEqual({
      resolutionDate: "2026-06-30",
      brackets: [
        { label: "<500.0k", min: null, max: 500000 },
        { label: "550.0-600.0k", min: 550000, max: 600000 },
        { label: "750.0k+", min: 750000, max: null }
      ]
    });
  });

  it("formats reports with latest stats and final-window worst-case math", () => {
    const rows = extractClaudeAverageRows({
      data: [
        { date: "Tue, 16 Jun 2026 00:00:00 GMT", claude_code_count: 600000 },
        { date: "Wed, 17 Jun 2026 00:00:00 GMT", claude_code_count: 650000 },
        { date: "Thu, 18 Jun 2026 00:00:00 GMT", claude_code_count: 610557, claude_pct_of_github: 3.957875, market_share_pct: 92.783 },
        { date: "Fri, 19 Jun 2026 00:00:00 GMT", claude_code_count: 576248 },
        { date: "Sat, 20 Jun 2026 00:00:00 GMT", claude_code_count: 523710 },
        { date: "Sun, 21 Jun 2026 00:00:00 GMT", claude_code_count: 538705 },
        { date: "Mon, 22 Jun 2026 00:00:00 GMT", claude_code_count: 609159, claude_pct_of_github: 6.538413, market_share_pct: 93.291 }
      ]
    });
    const value = formatClaudeAverageValue({
      rows,
      brackets: [
        { label: "<500.0k", min: null, max: 500000 },
        { label: "550.0-600.0k", min: 550000, max: 600000 },
        { label: "600.0-650.0k", min: 600000, max: 650000 },
        { label: "750.0k+", min: 750000, max: null }
      ],
      sourceUrl: claudeCodeCommitsAverageAdapter.sourceUrl,
      polymarketUrl,
      resolutionDate: "2026-06-30"
    });

    expect(value).toContain("Latest day: 609.2K");
    expect(value).toContain("Day-over-day: +70.5K (+13.1%)");
    expect(value).toContain("% of GitHub: 6.5%");
    expect(value).toContain("AI share: 93.3%");
    expect(value).toContain("7D Avg: 586.9K");
    expect(value).toContain("Final 7D window: 2026-06-24 to 2026-06-30");
    expect(value).toContain("Worst-case final 7D avg if unknown final-window days are 0: 0");
    expect(value).toContain("750.0k+: remaining days must average at least 750K/day");
  });

  it("formats GitHub hourly alpha without replacing the official value", () => {
    const rows = extractClaudeAverageRows({
      data: [
        { date: "Tue, 16 Jun 2026 00:00:00 GMT", claude_code_count: 600000 },
        { date: "Wed, 17 Jun 2026 00:00:00 GMT", claude_code_count: 650000 },
        { date: "Thu, 18 Jun 2026 00:00:00 GMT", claude_code_count: 610557 },
        { date: "Fri, 19 Jun 2026 00:00:00 GMT", claude_code_count: 576248 },
        { date: "Sat, 20 Jun 2026 00:00:00 GMT", claude_code_count: 523710 },
        { date: "Sun, 21 Jun 2026 00:00:00 GMT", claude_code_count: 538705 },
        { date: "Mon, 22 Jun 2026 00:00:00 GMT", claude_code_count: 609159 }
      ]
    });

    const value = formatClaudeAverageValue({
      rows,
      brackets: [{ label: "550.0-600.0k", min: 550000, max: 600000 }],
      sourceUrl: claudeCodeCommitsAverageAdapter.sourceUrl,
      polymarketUrl,
      resolutionDate: "2026-06-30",
      githubAlpha: {
        status: "available",
        query: "\"Co-Authored-By: Claude\"",
        dayStartUtc: "2026-06-29 00:00 UTC",
        checkedAtUtc: "2026-06-29 10:30 UTC",
        daySoFarCount: 664288,
        previousHourStartUtc: "2026-06-29 09:00 UTC",
        previousHourEndUtc: "2026-06-29 10:00 UTC",
        previousHourCount: 16173,
        dailyizedRunRate: 1510000,
        incompleteResults: false
      }
    });

    expect(value).toContain("7D Avg: 586.9K");
    expect(value).toContain("GitHub alpha (not resolution):");
    expect(value).toContain("UTC day so far: 664.3K commits (2026-06-29 00:00 UTC to 2026-06-29 10:30 UTC)");
    expect(value).toContain("Previous full hour: 16.2K commits (2026-06-29 09:00 UTC to 2026-06-29 10:00 UTC)");
    expect(value).toContain("Dailyized alpha run rate: 1.5M/day");
  });

  it("formats unavailable GitHub alpha as non-fatal context", () => {
    expect(
      formatClaudeGithubAlphaLines({
        status: "unavailable",
        query: "\"Co-Authored-By: Claude\"",
        reason: "GitHub commit search returned HTTP 403"
      })
    ).toEqual([
      "GitHub alpha (not resolution):",
      "Query: \"Co-Authored-By: Claude\"",
      "Status: unavailable (GitHub commit search returned HTTP 403)"
    ]);
  });

  it("builds GitHub commit search date windows", () => {
    expect(
      buildClaudeGithubCommitSearchQuery(
        "\"Co-Authored-By: Claude\"",
        new Date("2026-06-29T09:00:00.000Z"),
        new Date("2026-06-29T10:00:00.000Z")
      )
    ).toBe('"Co-Authored-By: Claude" committer-date:2026-06-29T09:00:00Z..2026-06-29T10:00:00Z');
  });

  it("registers hourly polling", () => {
    expect(claudeCodeCommitsAverageAdapter.getPollIntervalMinutes?.({} as never)).toBe(60);
  });
});
