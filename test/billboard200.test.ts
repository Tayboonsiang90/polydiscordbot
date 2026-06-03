import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractBillboard200NumberOneAlbum,
  formatBillboard200Value,
  normalizeBillboard200MarketSearchEvent,
  parseBillboard200MarketTarget,
  refreshBillboard200PolymarketQueue
} from "../src/integrations/billboard200.js";
import type { Integration } from "../src/integrations/types.js";

const marketUrl = "https://polymarket.com/event/billboard-200-1-album-week-of-june-13";

function chartHtml(): string {
  return `
    <html>
      <body>
        <button>Week of June 13, 2026</button>
        <ul class="o-chart-results-list-row">
          <li><span class="c-label">1</span></li>
          <li>
            <h3 class="c-title">ICEMAN</h3>
            <span class="c-label">Drake</span>
          </li>
          <li><span class="c-label">1</span><span class="c-label">1</span><span class="c-label">2</span></li>
        </ul>
      </body>
    </html>
  `;
}

function integration(input: Partial<Integration> = {}): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "billboard-200-number-one-album",
    displayName: "Billboard 200 #1 Album",
    sourceUrl: "https://www.billboard.com/charts/billboard-200/",
    polymarketUrl: marketUrl,
    alertRoleId: null,
    roleMessageId: null,
    roleChannelId: null,
    roleEmoji: null,
    settingsJson: null,
    pollIntervalMinutes: 60,
    status: "active",
    lastValue: null,
    lastCheckedAt: null,
    lastChangedAt: null,
    snapshotValue: null,
    snapshotCheckedAt: null,
    snapshotDate: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...input
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Billboard 200 adapter", () => {
  it("parses the target chart week from a Polymarket URL", () => {
    expect(parseBillboard200MarketTarget(marketUrl, new Date("2026-06-03T00:00:00.000Z"))).toMatchObject({
      chartDate: "2026-06-13",
      chartDateLabel: "Week of June 13, 2026",
      expectedReleaseDate: "2026-06-09",
      fallbackDeadlineDate: "2026-06-27",
      chartUrl: "https://www.billboard.com/charts/billboard-200/2026-06-13/"
    });
  });

  it("extracts the #1 album and artist from Billboard chart HTML", () => {
    expect(
      extractBillboard200NumberOneAlbum(chartHtml(), "https://www.billboard.com/charts/billboard-200/2026-06-13/")
    ).toEqual({
      title: "ICEMAN",
      artist: "Drake",
      rank: 1,
      chartDateLabel: "Week of June 13, 2026",
      chartUrl: "https://www.billboard.com/charts/billboard-200/2026-06-13/"
    });
  });

  it("formats not-published status without alertable published text", () => {
    const target = parseBillboard200MarketTarget(marketUrl, new Date("2026-06-03T00:00:00.000Z"));
    const value = formatBillboard200Value(target, null, {
      title: "Earlier Album",
      artist: "Earlier Artist",
      rank: 1,
      chartDateLabel: "Week of June 6, 2026",
      chartUrl: "https://www.billboard.com/charts/billboard-200/"
    });

    expect(value).toContain("Status: not published yet");
    expect(value).toContain("Expected release: around 2026-06-09 ET");
    expect(value).toContain("Latest available: Week of June 6, 2026 — Earlier Album by Earlier Artist");
  });

  it("normalizes active Billboard weekly markets from Gamma search", () => {
    expect(
      normalizeBillboard200MarketSearchEvent(
        {
          slug: "billboard-200-1-album-week-of-june-13",
          title: "Billboard 200 #1 Album Week of June 13",
          active: true,
          closed: false,
          startDate: "2026-06-01T17:54:04.756Z",
          endDate: "2026-06-10T03:59:00Z"
        },
        new Date("2026-06-03T00:00:00.000Z")
      )
    ).toMatchObject({
      slug: "billboard-200-1-album-week-of-june-13",
      url: marketUrl,
      startAt: "2026-06-01T17:54:04.756Z",
      endAt: "2026-06-10T03:59:00.000Z"
    });
  });

  it("auto-discovers the active weekly Billboard 200 market", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "billboard-200-1-album-week-of-june-13",
              title: "Billboard 200 #1 Album Week of June 13",
              active: true,
              closed: false,
              startDate: "2026-06-01T17:54:04.756Z",
              endDate: "2026-06-10T03:59:00Z"
            }
          ]
        })
      })
    );

    const result = await refreshBillboard200PolymarketQueue(
      integration({ polymarketUrl: null }),
      new Date("2026-06-03T00:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as { polymarketMarkets: Array<{ slug: string }> };

    expect(result.activeUrl).toBe(marketUrl);
    expect(settings.polymarketMarkets.map((queuedMarket) => queuedMarket.slug)).toEqual([
      "billboard-200-1-album-week-of-june-13"
    ]);
  });
});
