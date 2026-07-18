import { describe, expect, it } from "vitest";
import {
  arenaAiLeaderboardAdapter,
  extractArenaAiLeaderboardRows,
  extractArenaAiTopModels,
  extractArenaAiTopModelsValue,
  formatArenaAiLeaderboardValue
} from "../src/integrations/arenaAiLeaderboard.js";

describe("Arena AI leaderboard parsing", () => {
  const sampleHtml = `
    <table>
      <tbody>
        <tr>
          <th>Rank</th>
          <th>Rank Spread</th>
          <th>Model</th>
          <th>Score</th>
          <th>Votes</th>
        </tr>
        <tr>
          <td>1</td>
          <td>12</td>
          <td>
            <svg><title>Anthropic</title></svg>
            <span title="claude-opus-4-6-thinking">claude-opus-4-6-thinking</span>
            <span>Anthropic · Proprietary</span>
          </td>
          <td>1501±5</td>
          <td>61,003</td>
        </tr>
        <tr>
          <td>2</td>
          <td>13</td>
          <td><span title="claude-opus-4-6">claude-opus-4-6</span><span>Anthropic · Proprietary</span></td>
          <td>1498±5</td>
          <td>64,747</td>
        </tr>
        <tr>
          <td>3</td>
          <td>27</td>
          <td><span title="claude-opus-4-7-thinking">claude-opus-4-7-thinking</span><span>Anthropic · Proprietary</span></td>
          <td>1487±6</td>
          <td>48,292</td>
        </tr>
        <tr>
          <td>4</td>
          <td>37</td>
          <td><span title="gemini-3.1-pro-preview">gemini-3.1-pro-preview</span><span>Google · Proprietary</span></td>
          <td>1487±4</td>
          <td>12,345</td>
        </tr>
        <tr>
          <td>5</td>
          <td>42</td>
          <td><a title="kimi-k3">kimi-k3</a></td>
          <td>1480±4</td>
          <td>11,111</td>
        </tr>
      </tbody>
    </table>
  `;

  it("extracts ranked model rows from the current Arena table shape", () => {
    expect(extractArenaAiTopModels(sampleHtml, 3)).toEqual([
      {
        rank: "1",
        rankSpread: "12",
        model: "claude-opus-4-6-thinking",
        company: "Anthropic",
        score: "1501±5",
        votes: "61,003"
      },
      {
        rank: "2",
        rankSpread: "13",
        model: "claude-opus-4-6",
        company: "Anthropic",
        score: "1498±5",
        votes: "64,747"
      },
      {
        rank: "3",
        rankSpread: "27",
        model: "claude-opus-4-7-thinking",
        company: "Anthropic",
        score: "1487±6",
        votes: "48,292"
      }
    ]);
  });

  it("formats a stable monitor value that changes when the top 5 ranking changes", () => {
    expect(extractArenaAiTopModelsValue(sampleHtml)).toBe(
      [
        "Metric: Arena AI leaderboard",
        "Leaderboard: Text Arena Overall (Style Control Off)",
        "Top model: #1 claude-opus-4-6-thinking",
        "Top company: Anthropic",
        "Top 5:",
        "#1 Anthropic - claude-opus-4-6-thinking (score 1501±5)",
        "#2 Anthropic - claude-opus-4-6 (score 1498±5)",
        "#3 Anthropic - claude-opus-4-7-thinking (score 1487±6)",
        "#4 Google - gemini-3.1-pro-preview (score 1487±4)",
        "#5 unknown - kimi-k3 (score 1480±4)",
        "Resolution: https://arena.ai/leaderboard/text/overall-no-style-control"
      ].join("\n")
    );
  });

  it("can format a filtered company leaderboard view", () => {
    const rows = extractArenaAiLeaderboardRows(sampleHtml);

    expect(
      formatArenaAiLeaderboardValue(
        {
          leaderboardName: "Text Arena Overall (Chinese companies only)",
          sourceUrl: "https://arena.ai/leaderboard/text/overall-no-style-control",
          rowFilter: (row) => row.company === "Google" || row.model === "kimi-k3",
          topCompanyLabel: "Top qualifying company"
        },
        rows
      )
    ).toBe(
      [
        "Metric: Arena AI leaderboard",
        "Leaderboard: Text Arena Overall (Chinese companies only)",
        "Top model: #4 gemini-3.1-pro-preview",
        "Top qualifying company: Google",
        "Top 5:",
        "#4 Google - gemini-3.1-pro-preview (score 1487±4)",
        "#5 unknown - kimi-k3 (score 1480±4)",
        "Resolution: https://arena.ai/leaderboard/text/overall-no-style-control"
      ].join("\n")
    );
  });

  it("suppresses alerts when only Arena scores change", () => {
    const previousValue = extractArenaAiTopModelsValue(sampleHtml);
    const currentValue = previousValue.replace("score 1501±5", "score 1502±4");

    expect(arenaAiLeaderboardAdapter.shouldAlertOnChange?.(previousValue, currentValue)).toBe(false);
  });
});
