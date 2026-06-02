import { describe, expect, it } from "vitest";
import {
  buildCensusDurableGoodsValue,
  censusDurableGoodsShouldAlertOnChange,
  extractCensusDurableGoodsReport,
  getCensusDurableGoodsPollIntervalMinutes,
  parseDurableGoodsPercentChange
} from "../src/integrations/censusDurableGoods.js";
import type { Integration } from "../src/integrations/types.js";

const aprilReportHtml = `
  <main>
    <h4>FOR IMMEDIATE RELEASE: Thursday, May 28, 2026</h4>
    <h1>Monthly Advance Report on Durable Goods Manufacturers' Shipments Inventories and Orders</h1>
    <p>
      New orders for manufactured durable goods in April, up two consecutive months,
      increased $25.5 billion or 7.9 percent to $346.0 billion, the U.S. Census Bureau announced today.
    </p>
  </main>
`;

const mayReportHtml = `
  <main>
    <h4>FOR IMMEDIATE RELEASE: Thursday, June 25, 2026</h4>
    <h1>Monthly Advance Report on Durable Goods Manufacturers' Shipments Inventories and Orders</h1>
    <p>
      New orders for manufactured durable goods in May, down following two consecutive monthly increases,
      decreased $3.5 billion or 1.1 percent to $342.5 billion, the U.S. Census Bureau announced today.
    </p>
  </main>
`;

describe("Census durable goods adapter", () => {
  it("extracts the latest report period and signed percent change", () => {
    expect(extractCensusDurableGoodsReport(aprilReportHtml, "https://example.com/current")).toEqual({
      period: "April 2026",
      value: "7.9",
      direction: "increased",
      releaseDate: "May 28, 2026",
      reportUrl: "https://example.com/current"
    });

    expect(extractCensusDurableGoodsReport(mayReportHtml)?.value).toBe("-1.1");
  });

  it("formats waiting and published values", () => {
    const latestReport = extractCensusDurableGoodsReport(aprilReportHtml);
    const targetReport = extractCensusDurableGoodsReport(mayReportHtml);

    expect(buildCensusDurableGoodsValue(null, latestReport)).toContain("Target status: not published yet");
    expect(buildCensusDurableGoodsValue(null, latestReport)).toContain("Latest available: April 2026 = +7.9%");
    expect(buildCensusDurableGoodsValue(targetReport, latestReport)).toContain("Target status: published");
    expect(buildCensusDurableGoodsValue(targetReport, latestReport)).toContain("Value: -1.1%");
  });

  it("parses unchanged, increased, and decreased report phrasing", () => {
    expect(parseDurableGoodsPercentChange("increased $1.0 billion or 0.3 percent to $300.0 billion")).toEqual({
      value: "0.3",
      direction: "increased"
    });
    expect(parseDurableGoodsPercentChange("decreased $1.0 billion or 0.3 percent to $300.0 billion")).toEqual({
      value: "-0.3",
      direction: "decreased"
    });
    expect(parseDurableGoodsPercentChange("virtually unchanged at $300.0 billion")).toEqual({
      value: "0.0",
      direction: "unchanged"
    });
  });

  it("polls daily before release, per minute on release day, and hourly if late", () => {
    expect(getCensusDurableGoodsPollIntervalMinutes(buildIntegration(), new Date("2026-06-24T16:00:00.000Z"))).toBe(1_440);
    expect(getCensusDurableGoodsPollIntervalMinutes(buildIntegration(), new Date("2026-06-25T13:00:00.000Z"))).toBe(1);
    expect(getCensusDurableGoodsPollIntervalMinutes(buildIntegration(), new Date("2026-06-26T16:00:00.000Z"))).toBe(60);
    expect(
      getCensusDurableGoodsPollIntervalMinutes(
        buildIntegration("Target status: published\nValue: -1.1%"),
        new Date("2026-06-26T16:00:00.000Z")
      )
    ).toBe(1_440);
  });

  it("alerts only when the target report first publishes or its value changes", () => {
    const waiting = "Target status: not published yet\nValue: not published yet";
    const published = "Target status: published\nValue: -1.1%";
    const revised = "Target status: published\nValue: -1.2%";

    expect(censusDurableGoodsShouldAlertOnChange(waiting, published)).toBe(true);
    expect(censusDurableGoodsShouldAlertOnChange(published, revised)).toBe(true);
    expect(censusDurableGoodsShouldAlertOnChange(waiting, waiting)).toBe(false);
    expect(censusDurableGoodsShouldAlertOnChange(published, published)).toBe(false);
  });
});

function buildIntegration(lastValue: string | null = null): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "census-durable-goods",
    displayName: "Census Durable Goods Orders",
    sourceUrl: "https://www.census.gov/manufacturing/m3/adv/current/index.html",
    polymarketUrl: "https://polymarket.com/event/durable-goods-orders-mom-may-2026",
    alertRoleId: null,
    roleMessageId: null,
    roleChannelId: null,
    roleEmoji: null,
    settingsJson: null,
    pollIntervalMinutes: 5,
    status: "active",
    lastValue,
    lastCheckedAt: null,
    lastChangedAt: null,
    snapshotValue: null,
    snapshotCheckedAt: null,
    snapshotDate: null,
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z"
  };
}
