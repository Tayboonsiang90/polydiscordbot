import { describe, expect, it } from "vitest";
import {
  claudeCodeCommitsAdapter,
  claudeCommitsShouldAlertOnChange,
  extractClaudeCommitRows,
  extractClaudeCommitTargetsFromGamma,
  filterNewClaudeCommitHits,
  findClaudeCommitHits,
  formatClaudeCommitsMonitorValue
} from "../src/integrations/claudeCodeCommits.js";

const polymarketUrl = "https://polymarket.com/event/claude-code-commits-hit-by-june-30";

describe("Claude Code Commits adapter", () => {
  it("extracts daily rows from tracker JSON", () => {
    expect(
      extractClaudeCommitRows({
        status: "ok",
        data: [
          {
            date: "Wed, 27 May 2026 00:00:00 GMT",
            claude_code_count: 1_288_671,
            github_total_count: 8_169_446,
            claude_pct_of_github: 15.774276,
            market_share_pct: 96.477,
            updated_at: "Thu, 28 May 2026 07:01:59 GMT",
            collected_at: "Thu, 28 May 2026 07:01:59 GMT"
          },
          {
            date: "Tue, 26 May 2026 00:00:00 GMT",
            claude_code_count: "556097"
          }
        ]
      })
    ).toEqual([
      {
        date: "2026-05-26",
        commits: 556097,
        githubTotalCount: null,
        claudePctOfGithub: null,
        marketSharePct: null,
        updatedAt: null,
        collectedAt: null
      },
      {
        date: "2026-05-27",
        commits: 1288671,
        githubTotalCount: 8169446,
        claudePctOfGithub: 15.774276,
        marketSharePct: 96.477,
        updatedAt: "Thu, 28 May 2026 07:01:59 GMT",
        collectedAt: "Thu, 28 May 2026 07:01:59 GMT"
      }
    ]);
  });

  it("extracts unresolved high and low targets from Gamma", () => {
    expect(
      extractClaudeCommitTargetsFromGamma([
        {
          startDate: "2026-05-26T23:05:34.961224Z",
          endDate: "2026-06-30T00:00:00Z",
          markets: [
            {
              question: "Will Claude Code Commits hit (HIGH) 750.0k by June 30?",
              groupItemTitle: "↑ 750.0k",
              closed: true,
              outcomes: '["Yes","No"]',
              outcomePrices: '["1","0"]'
            },
            {
              question: "Will Claude Code Commits hit (LOW) 400.0k by June 30?",
              groupItemTitle: "↓ 400.0k",
              active: true,
              closed: false,
              outcomes: '["Yes","No"]',
              outcomePrices: '["0.24","0.76"]'
            },
            {
              question: "Will Claude Code Commits hit (HIGH) 900.0k by June 30?",
              groupItemTitle: "↑ 900.0k",
              active: true,
              closed: false,
              outcomes: '["Yes","No"]',
              outcomePrices: '["0.24","0.76"]'
            }
          ]
        }
      ])
    ).toEqual({
      targets: [
        { label: "↓ 400.0k", direction: "low", threshold: 400000 },
        { label: "↑ 900.0k", direction: "high", threshold: 900000 }
      ],
      windowStartDate: "2026-05-26",
      windowEndDate: "2026-06-30"
    });
  });

  it("finds high and low target hits inside the market window", () => {
    const rows = extractClaudeCommitRows({
      data: [
        { date: "Mon, 25 May 2026 00:00:00 GMT", claude_code_count: 200000 },
        { date: "Wed, 27 May 2026 00:00:00 GMT", claude_code_count: 950000 },
        { date: "Thu, 28 May 2026 00:00:00 GMT", claude_code_count: 390000 }
      ]
    });

    expect(
      findClaudeCommitHits(
        rows,
        [
          { label: "↓ 400.0k", direction: "low", threshold: 400000 },
          { label: "↑ 900.0k", direction: "high", threshold: 900000 }
        ],
        { startDate: "2026-05-26", endDate: "2026-06-30" }
      )
    ).toEqual([
      {
        target: { label: "↓ 400.0k", direction: "low", threshold: 400000 },
        row: expect.objectContaining({ date: "2026-05-28", commits: 390000 })
      },
      {
        target: { label: "↑ 900.0k", direction: "high", threshold: 900000 },
        row: expect.objectContaining({ date: "2026-05-27", commits: 950000 })
      }
    ]);
  });

  it("formats one-shot hit alerts", () => {
    const rows = extractClaudeCommitRows({
      data: [
        { date: "Wed, 27 May 2026 00:00:00 GMT", claude_code_count: 950000 },
        { date: "Thu, 28 May 2026 00:00:00 GMT", claude_code_count: 390000 }
      ]
    });
    const targets = [
      { label: "↓ 400.0k", direction: "low" as const, threshold: 400000 },
      { label: "↑ 900.0k", direction: "high" as const, threshold: 900000 }
    ];
    const hits = findClaudeCommitHits(rows, targets, { startDate: "2026-05-26", endDate: "2026-06-30" });
    const filtered = filterNewClaudeCommitHits(null, polymarketUrl, hits);
    const value = formatClaudeCommitsMonitorValue({
      rows,
      targets,
      hits: filtered.hits,
      alertedTargets: filtered.alertedTargets,
      sourceUrl: "https://claude-commits.polymarket.com/",
      polymarketUrl,
      windowStartDate: "2026-05-26",
      windowEndDate: "2026-06-30"
    });

    expect(value).toContain("Latest commits: 390,000");
    expect(value).toContain("↓ 400.0k hit low at 390,000 on 2026-05-28");
    expect(value).toContain("↑ 900.0k hit high at 950,000 on 2026-05-27");
    expect(claudeCommitsShouldAlertOnChange(null, value)).toBe(true);
    expect(filterNewClaudeCommitHits(value, polymarketUrl, hits).hits).toEqual([]);
  });

  it("registers hourly polling and strike support", () => {
    expect(claudeCodeCommitsAdapter.getPollIntervalMinutes?.({} as never)).toBe(60);
    expect(claudeCodeCommitsAdapter.supportsStrikes).toBe(true);
  });
});
