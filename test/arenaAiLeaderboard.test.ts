import { describe, expect, it } from "vitest";
import { extractArenaAiTopModels, extractArenaAiTopModelsValue } from "../src/integrations/arenaAiLeaderboard.js";

describe("Arena AI leaderboard parsing", () => {
  const sampleHtml = `
    <table>
      <tbody>
        <tr>
          <td>1</td>
          <td>12</td>
          <td>
            <a href="https://example.com/model" title="claude-opus-4-6-thinking">
              <span>claude-opus-4-6-thinking</span>
            </a>
          </td>
          <td>1501±5</td>
        </tr>
        <tr>
          <td>2</td>
          <td>13</td>
          <td><a title="claude-opus-4-6">claude-opus-4-6</a></td>
          <td>1498±5</td>
        </tr>
        <tr>
          <td>3</td>
          <td>27</td>
          <td><a title="claude-opus-4-7-thinking">claude-opus-4-7-thinking</a></td>
          <td>1487±6</td>
        </tr>
        <tr>
          <td>4</td>
          <td>37</td>
          <td><a title="gemini-3.1-pro-preview">gemini-3.1-pro-preview</a></td>
          <td>1487±4</td>
        </tr>
      </tbody>
    </table>
  `;

  it("extracts the first three ranked models", () => {
    expect(extractArenaAiTopModels(sampleHtml)).toEqual([
      { rank: "1", model: "claude-opus-4-6-thinking" },
      { rank: "2", model: "claude-opus-4-6" },
      { rank: "3", model: "claude-opus-4-7-thinking" }
    ]);
  });

  it("formats a stable monitor value that changes when the top 3 changes", () => {
    expect(extractArenaAiTopModelsValue(sampleHtml)).toBe(
      [
        "Top 3 Models:",
        "1. claude-opus-4-6-thinking",
        "2. claude-opus-4-6",
        "3. claude-opus-4-7-thinking",
        "Resolution: https://arena.ai/leaderboard/text/overall-no-style-control"
      ].join("\n")
    );
  });
});
