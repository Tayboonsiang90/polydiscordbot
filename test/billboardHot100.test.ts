import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractBillboardHot100NumberOneSong,
  formatBillboardHot100Value,
  normalizeBillboardHot100MarketSearchEvent,
  parseBillboardHot100MarketTarget,
  refreshBillboardHot100PolymarketQueue
} from "../src/integrations/billboardHot100.js";
import type { Integration } from "../src/integrations/types.js";

const marketUrl = "https://polymarket.com/event/billboard-hot-100-1-song-week-of-june-13";

function chartHtml(): string {
  return `
    <html>
      <body>
        <button>Week of June 13, 2026</button>
        <ul class="o-chart-results-list-row">
          <li><span class="c-label">1</span></li>
          <li>
            <h3 class="c-title">Janice STFU</h3>
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
    adapterId: "billboard-hot-100-number-one-song",
    displayName: "Billboard Hot 100 #1 Song",
    sourceUrl: "https://www.billboard.com/charts/hot-100/",
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

describe("Billboard Hot 100 adapter", () => {
  it("parses the target chart week from a Polymarket URL", () => {
    expect(parseBillboardHot100MarketTarget(marketUrl, new Date("2026-06-03T00:00:00.000Z"))).toMatchObject({
      chartDate: "2026-06-13",
      chartDateLabel: "Week of June 13, 2026",
      expectedReleaseDate: "2026-06-09",
      fallbackDeadlineDate: "2026-06-27",
      chartUrl: "https://www.billboard.com/charts/hot-100/2026-06-13/"
    });
  });

  it("extracts the #1 song and artist from Billboard chart HTML", () => {
    expect(
      extractBillboardHot100NumberOneSong(chartHtml(), "https://www.billboard.com/charts/hot-100/2026-06-13/")
    ).toEqual({
      title: "Janice STFU",
      artist: "Drake",
      rank: 1,
      chartDateLabel: "Week of June 13, 2026",
      chartUrl: "https://www.billboard.com/charts/hot-100/2026-06-13/"
    });
  });

  it("formats not-published status without alertable published text", () => {
    const target = parseBillboardHot100MarketTarget(marketUrl, new Date("2026-06-03T00:00:00.000Z"));
    const value = formatBillboardHot100Value(target, null, {
      title: "Earlier Song",
      artist: "Earlier Artist",
      rank: 1,
      chartDateLabel: "Week of June 6, 2026",
      chartUrl: "https://www.billboard.com/charts/hot-100/"
    });

    expect(value).toContain("Status: not published yet");
    expect(value).toContain("Expected release: around 2026-06-09 ET");
    expect(value).toContain("Latest available: Week of June 6, 2026 - Earlier Song by Earlier Artist");
  });

  it("normalizes active Billboard Hot 100 weekly markets from Gamma search", () => {
    expect(
      normalizeBillboardHot100MarketSearchEvent(
        {
          slug: "billboard-hot-100-1-song-week-of-june-13",
          title: "Billboard Hot 100 #1 Song Week of June 13",
          active: true,
          closed: false,
          startDate: "2026-06-01T17:54:04.749Z",
          endDate: "2026-06-10T03:59:00Z"
        },
        new Date("2026-06-03T00:00:00.000Z")
      )
    ).toMatchObject({
      slug: "billboard-hot-100-1-song-week-of-june-13",
      url: marketUrl,
      startAt: "2026-06-01T17:54:04.749Z",
      endAt: "2026-06-10T03:59:00.000Z"
    });
  });

  it("auto-discovers the active weekly Billboard Hot 100 market", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "billboard-hot-100-1-song-week-of-june-13",
              title: "Billboard Hot 100 #1 Song Week of June 13",
              active: true,
              closed: false,
              startDate: "2026-06-01T17:54:04.749Z",
              endDate: "2026-06-10T03:59:00Z"
            }
          ]
        })
      })
    );

    const result = await refreshBillboardHot100PolymarketQueue(
      integration({ polymarketUrl: null }),
      new Date("2026-06-03T00:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as { polymarketMarkets: Array<{ slug: string }> };

    expect(result.activeUrl).toBe(marketUrl);
    expect(settings.polymarketMarkets.map((queuedMarket) => queuedMarket.slug)).toEqual([
      "billboard-hot-100-1-song-week-of-june-13"
    ]);
  });
});
