import { describe, expect, it } from "vitest";
import type { Integration } from "../src/integrations/types.js";
import {
  createNpmPrivateValuationAdapter,
  extractNpmValuationSnapshot,
  extractNpmValuationSnapshotFromApi,
  formatNpmValuationValue,
  getNpmValuationPollIntervalMinutes,
  isNpmValuationBurstWindow,
  normalizeNpmValuationMarketSearchEvent,
  type NpmValuationConfig
} from "../src/integrations/npmPrivateValuations.js";

const config: NpmValuationConfig = {
  id: "npm-databricks-valuation",
  commandName: "databricksvaluation",
  displayName: "NPM Databricks Valuation",
  companyName: "Databricks",
  sourceUrl: "https://fe.secondmarket.com/companies/company-53787f17-a704-47a9-895a-cb54833bdb1f/data",
  defaultPolymarketUrl: "https://polymarket.com/event/will-databricks-valuation-hit-by-june-30",
  defaultChannelName: "npm-databricks-valuation",
  alertRoleName: "NPM Databricks Valuation Alerts",
  alertRoleEmoji: "🧱",
  slugCompanyPart: "databricks",
  autoDiscoverMonthlyMarkets: true
};

const integration = { settingsJson: null } as Integration;

describe("NPM private valuation adapters", () => {
  it("extracts the rendered SecondMarket valuation snapshot", () => {
    const snapshot = extractNpmValuationSnapshot(
      [
        "## Anthropic",
        "",
        "The NPM Price updates at 1:00PM ET Daily 1",
        "",
        "As of Jun 29, 2026",
        "",
        "Valuation",
        "",
        "## $1.097T",
        "",
        "Price Per Share",
        "",
        "## $669.86"
      ].join("\n"),
      "https://fe.secondmarket.com/companies/company-3e197763-4ff8-4d8c-bd1f-cc2792937757/data"
    );

    expect(snapshot).toEqual({
      companyName: "Anthropic",
      asOf: "Jun 29, 2026",
      valuation: "$1.097T",
      pricePerShare: "$669.86",
      sourceUrl: "https://fe.secondmarket.com/companies/company-3e197763-4ff8-4d8c-bd1f-cc2792937757/data"
    });
  });

  it("extracts the public NPM API valuation snapshot", () => {
    const snapshot = extractNpmValuationSnapshotFromApi(
      {
        latest_npm_price: {
          date: "2026-06-29",
          price: 346.85941623,
          implied_valuation: 12171580993.372587
        },
        company: {
          dba_name: "Epic Games"
        }
      },
      "https://fe.secondmarket.com/companies/company-625e5f47-7ff7-45c4-be95-0305665164bd/data"
    );

    expect(snapshot).toEqual({
      companyName: "Epic Games",
      asOf: "Jun 29, 2026",
      valuation: "$12.172B",
      pricePerShare: "$346.86",
      sourceUrl: "https://fe.secondmarket.com/companies/company-625e5f47-7ff7-45c4-be95-0305665164bd/data"
    });
  });

  it("formats stable alert values without rendered-page noise", () => {
    expect(
      formatNpmValuationValue({
        companyName: "OpenAI",
        asOf: "Jun 29, 2026",
        valuation: "$877.304B",
        pricePerShare: "$709.78",
        sourceUrl: "https://fe.secondmarket.com/companies/company-30839e0b-2730-4495-839f-1bf638fa9cca/data"
      })
    ).toContain("Expected update: 1:00 PM ET on NPM business days");
  });

  it("uses 10-second polling during the 1 PM ET release window", () => {
    expect(isNpmValuationBurstWindow(new Date("2026-07-01T16:49:59.000Z"))).toBe(false);
    expect(isNpmValuationBurstWindow(new Date("2026-07-01T16:50:00.000Z"))).toBe(true);
    expect(isNpmValuationBurstWindow(new Date("2026-07-01T17:10:00.000Z"))).toBe(true);
    expect(isNpmValuationBurstWindow(new Date("2026-07-01T17:10:01.000Z"))).toBe(false);
    expect(getNpmValuationPollIntervalMinutes(integration, new Date("2026-07-01T17:00:00.000Z"))).toBe(10 / 60);
    expect(getNpmValuationPollIntervalMinutes(integration, new Date("2026-07-01T18:00:00.000Z"))).toBe(1);
  });

  it("normalizes monthly Polymarket discovery candidates and excludes yearly markets", () => {
    const july = normalizeNpmValuationMarketSearchEvent(
      {
        slug: "will-databricks-valuation-hit-by-july-31-20260629172513776",
        title: "Will Databricks' valuation hit __ by July 31?",
        active: true,
        closed: false,
        archived: false,
        createdAt: "2026-06-29T17:25:13.776Z"
      },
      config,
      new Date("2026-07-01T00:00:00.000Z")
    );
    const december = normalizeNpmValuationMarketSearchEvent(
      {
        slug: "will-databricks-valuation-hit-by-december-31",
        title: "Will Databricks' valuation hit __ by December 31?",
        active: true,
        closed: false,
        archived: false
      },
      config,
      new Date("2026-07-01T00:00:00.000Z")
    );

    expect(july).toMatchObject({
      slug: "will-databricks-valuation-hit-by-july-31-20260629172513776",
      url: "https://polymarket.com/event/will-databricks-valuation-hit-by-july-31-20260629172513776",
      startAt: "2026-06-29T17:25:13.776Z"
    });
    expect(july?.endAt).toBe("2026-08-01T17:10:00.000Z");
    expect(december).toBeNull();
  });

  it("builds auto-discovery adapters for monthly valuation markets", () => {
    const adapter = createNpmPrivateValuationAdapter(config);
    expect(adapter.refreshSettings).toBeDefined();
    expect(adapter.upsertPolymarketMarket).toBeDefined();
  });
});
