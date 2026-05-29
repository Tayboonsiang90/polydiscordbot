import { describe, expect, it } from "vitest";
import {
  extractPowerballJackpotSnapshot,
  extractPowerballJackpotValue,
  powerballJackpotAdapter
} from "../src/integrations/powerballJackpot.js";

const sampleNextDrawingHtml = `
<div class="card h-100 next-card next-powerball scheduled">
  <h5 class="card-title title-date">Sat, May 30, 2026</h5>
  <div id="nextDraw" data-drawdateutc="2026-05-31T02:59:00.0000000Z"></div>
  <div class="row game-detail-group mb-3">
    <span class="game-title">Estimated Jackpot</span>
    <span class="game-jackpot-number">$172 Million</span>
  </div>
  <div class="row winners-group mb-3">
    <span class="game-title">Cash Value</span>
    <span class="game-jackpot-number">$75.6 Million</span>
  </div>
</div>`;

describe("Powerball jackpot adapter", () => {
  it("parses the official next-drawing card", () => {
    const snapshot = extractPowerballJackpotSnapshot(sampleNextDrawingHtml, new Date("2026-05-29T16:00:00.000Z"));

    expect(snapshot).toEqual({
      reportDateEt: "2026-05-29",
      nextDrawingDate: "Sat, May 30, 2026",
      nextDrawingUtc: "2026-05-31T02:59:00.000Z",
      estimatedJackpot: "$172 Million",
      estimatedJackpotMillions: 172,
      cashValue: "$75.6 Million",
      cashValueMillions: 75.6
    });
  });

  it("formats daily trend value with target progress", () => {
    expect(extractPowerballJackpotValue(sampleNextDrawingHtml, new Date("2026-05-29T16:00:00.000Z"))).toBe(
      [
        "Report date (ET): 2026-05-29",
        "Estimated jackpot: $172 Million",
        "Target: $1 Billion",
        "Target status: below target (17.2%, $828 Million to go)",
        "Cash value: $75.6 Million",
        "Next drawing: Sat, May 30, 2026",
        "Draw time UTC: 2026-05-31T02:59:00.000Z"
      ].join("\n")
    );
  });

  it("marks jackpot values above the target", () => {
    const value = extractPowerballJackpotValue(
      sampleNextDrawingHtml.replace("$172 Million", "$1.2 Billion"),
      new Date("2026-07-01T16:00:00.000Z")
    );

    expect(value).toContain("Estimated jackpot: $1.2 Billion");
    expect(value).toContain("Target status: at/above target (120.0%, $200 Million above)");
  });

  it("uses a fixed daily poll interval", () => {
    expect(powerballJackpotAdapter.getPollIntervalMinutes?.({} as never)).toBe(1_440);
    expect(powerballJackpotAdapter.getPollIntervalReason?.({} as never)).toContain("daily");
  });
});
