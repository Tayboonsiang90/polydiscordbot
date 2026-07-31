import { describe, expect, it } from "vitest";
import {
  formatPumpFunBuybackValue,
  parsePumpFunBuybackPoints,
  pumpFunBuybacksAdapter,
  shouldAlertOnPumpFunBuybackChange
} from "../src/integrations/pumpFunBuybacks.js";

const fixture = [
  '<script>self.__next_f.push([1,"data:[{\\"date\\":\\"2026-07-28\\",\\"stableRevenue\\":1,\\"revenueUsd\\":2,\\"buybacksSol\\":3,\\"buybacksUsd\\":600000,\\"buybackPercentage\\":4,\\"pumpTokensBought\\":300000000,\\"transactionCount\\":12000,\\"cumulativeUsd\\":415000000},',
  '{\\"date\\":\\"2026-07-29\\",\\"stableRevenue\\":1,\\"revenueUsd\\":2,\\"buybacksSol\\":3,\\"buybacksUsd\\":700000,\\"buybackPercentage\\":4,\\"pumpTokensBought\\":350000000,\\"transactionCount\\":13000,\\"cumulativeUsd\\":415700000},',
  '{\\"date\\":\\"2026-07-30\\",\\"stableRevenue\\":1,\\"revenueUsd\\":2,\\"buybacksSol\\":3,\\"buybacksUsd\\":800000,\\"buybackPercentage\\":4,\\"pumpTokensBought\\":400000000,\\"transactionCount\\":14000,\\"cumulativeUsd\\":416500000}]"])<\\/script>'
].join("");

describe("Pump.fun buybacks adapter", () => {
  it("parses official embedded cumulative buyback points", () => {
    expect(parsePumpFunBuybackPoints(fixture)).toEqual([
      {
        date: "2026-07-28",
        buybacksUsd: 600_000,
        pumpTokensBought: 300_000_000,
        transactionCount: 12_000,
        cumulativeUsd: 415_000_000
      },
      {
        date: "2026-07-29",
        buybacksUsd: 700_000,
        pumpTokensBought: 350_000_000,
        transactionCount: 13_000,
        cumulativeUsd: 415_700_000
      },
      {
        date: "2026-07-30",
        buybacksUsd: 800_000,
        pumpTokensBought: 400_000_000,
        transactionCount: 14_000,
        cumulativeUsd: 416_500_000
      }
    ]);
  });

  it("formats the market target, finalized day, and pace", () => {
    const value = formatPumpFunBuybackValue(parsePumpFunBuybackPoints(fixture));

    expect(value).toContain("Total purchases: $416,500,000.00");
    expect(value).toContain("Target reached: no");
    expect(value).toContain("Remaining: $83,500,000.00");
    expect(value).toContain("Finalized date: 2026-07-29");
    expect(value).toContain("Finalized day purchases: $700,000.00");
    expect(value).toContain("7-day daily average: $650,000.00");
  });

  it("alerts once per finalized day and immediately on the $500M crossing", () => {
    const baseline = formatPumpFunBuybackValue(parsePumpFunBuybackPoints(fixture));
    const sameDayUpdate = baseline.replace("$416,500,000.00", "$416,600,000.00");
    const nextFinalizedDay = baseline.replace("Finalized date: 2026-07-29", "Finalized date: 2026-07-30");
    const targetCrossing = baseline
      .replace("Target reached: no", "Target reached: yes")
      .replace("Remaining: $83,500,000.00", "Remaining: $0.00");

    expect(shouldAlertOnPumpFunBuybackChange(null, baseline)).toBe(false);
    expect(shouldAlertOnPumpFunBuybackChange(baseline, sameDayUpdate)).toBe(false);
    expect(shouldAlertOnPumpFunBuybackChange(baseline, nextFinalizedDay)).toBe(true);
    expect(shouldAlertOnPumpFunBuybackChange(baseline, targetCrossing)).toBe(true);
  });

  it("defines standard monitor metadata", () => {
    expect(pumpFunBuybacksAdapter).toMatchObject({
      id: "pump-fun-buybacks",
      commandName: "pumpbuybacks",
      defaultChannelName: "pumpbuybacks",
      alertRoleName: "Pump Buyback Alerts",
      alertRoleEmoji: "💚"
    });
  });
});
