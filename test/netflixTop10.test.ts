import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildNetflixTop10Signature,
  extractNetflixTop10ChartFromHtml,
  formatNetflixTop10Value,
  netflixTop10Adapter,
  normalizeNetflixMarketSearchEvent,
  refreshNetflixTop10Markets,
  shouldAlertOnNetflixTop10Change
} from "../src/integrations/netflixTop10.js";
import type { Integration } from "../src/integrations/types.js";

const netflixChartConfig = {
  key: "global-movies",
  label: "Global Movies",
  region: "Global" as const,
  mediaType: "Movies" as const,
  url: "https://www.netflix.com/tudum/top10/films"
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Netflix Top 10 parser", () => {
  it("extracts weekly rows with views from a Netflix Top 10 page", () => {
    const chart = extractNetflixTop10ChartFromHtml(buildNetflixHtml({ includeViews: true }), netflixChartConfig);

    expect(chart.weekEndDate).toBe("2026-07-12");
    expect(chart.rows).toHaveLength(10);
    expect(chart.rows[0]).toMatchObject({
      rank: 1,
      title: "Enola Holmes 3",
      views: 12_000_000,
      hoursViewed: 21_600_000,
      runtime: "1:48",
      weeksInTop10: 2
    });
  });

  it("extracts US country rows when views are not shown", () => {
    const chart = extractNetflixTop10ChartFromHtml(
      buildNetflixHtml({ includeViews: false }),
      { ...netflixChartConfig, key: "us-shows", label: "US Shows", region: "US", mediaType: "Shows" }
    );

    expect(chart.rows[0]).toMatchObject({
      rank: 1,
      title: "Enola Holmes 3",
      views: null,
      hoursViewed: null
    });
  });

  it("formats a compact value with #1/#2 and Top 10 lines", () => {
    const chart = extractNetflixTop10ChartFromHtml(buildNetflixHtml({ includeViews: true }), netflixChartConfig);
    const value = formatNetflixTop10Value([chart]);

    expect(value).toContain("Chart week ending: 2026-07-12");
    expect(value).toContain("Global Movies #1: Enola Holmes 3 - 12M views - 2w");
    expect(value).toContain("Global Movies #2: Shipwrecked: Nightmare at Sea - 9M views - 1w");
    expect(value).toContain("Global Movies Top 10: #1 Enola Holmes 3");
  });

  it("alerts only when the chart week or rank order changes", () => {
    const previous = [
      "Metric: Netflix weekly Top 10 rankings",
      "Chart week ending: 2026-07-12",
      "Global Movies Top 10: #1 Enola Holmes 3 (12M views) | #2 Shipwrecked: Nightmare at Sea (9M views)"
    ].join("\n");
    const sameRanks = [
      "Metric: Netflix weekly Top 10 rankings",
      "Chart week ending: 2026-07-12",
      "Global Movies Top 10: #1 Enola Holmes 3 (12.0M views) | #2 Shipwrecked: Nightmare at Sea (8.9M views)"
    ].join("\n");
    const changedWeek = sameRanks.replace("2026-07-12", "2026-07-19");
    const changedRank = sameRanks.replace("Shipwrecked: Nightmare at Sea", "Old Henry");

    expect(buildNetflixTop10Signature(previous)).toBe(buildNetflixTop10Signature(sameRanks));
    expect(shouldAlertOnNetflixTop10Change(previous, sameRanks)).toBe(false);
    expect(shouldAlertOnNetflixTop10Change(previous, changedWeek)).toBe(true);
    expect(shouldAlertOnNetflixTop10Change(previous, changedRank)).toBe(true);
  });
});

describe("Netflix Top 10 market discovery", () => {
  it("normalizes active #1/#2 US/global show/movie events", () => {
    const market = normalizeNetflixMarketSearchEvent({
      slug: "what-will-be-the-2-global-netflix-movie-this-week-20260715153657937",
      title: "What will be the #2 Global Netflix Movie this week?",
      active: true,
      closed: false,
      tags: [{ slug: "top-netflix" }],
      startDate: "2026-07-15T16:00:00Z",
      endDate: "2026-07-21T23:59:00Z"
    });

    expect(market).toMatchObject({
      rank: 2,
      region: "Global",
      mediaType: "Movies",
      startAt: "2026-07-15T16:00:00.000Z",
      endAt: "2026-07-21T23:59:00.000Z"
    });
  });

  it("discovers and stores active Netflix markets in settings.markets", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/events?slug=")) {
        const slug = decodeURIComponent(url.match(/slug=([^&]+)/)?.[1] ?? "");
        return new Response(JSON.stringify([buildGammaEvent(slug, titleFromSlug(slug))]));
      }

      if (url.includes("/public-search")) {
        return new Response(
          JSON.stringify({
            events: [
              buildGammaEvent(
                "what-will-be-the-top-global-netflix-show-this-week-20260715162306637",
                "What will be the top Global Netflix Show this week?"
              ),
              buildGammaEvent(
                "not-a-netflix-market",
                "Will something unrelated happen?"
              )
            ]
          })
        );
      }

      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const refreshed = await refreshNetflixTop10Markets(buildIntegration(), new Date("2026-07-18T12:00:00.000Z"), {
      force: true
    });
    const settings = JSON.parse(refreshed.settingsJson) as { markets: Array<{ url: string; endAt: string | null }> };

    expect(settings.markets.some((market) => market.url.includes("top-us-netflix-show"))).toBe(true);
    expect(settings.markets.some((market) => market.url.includes("top-global-netflix-show"))).toBe(true);
    expect(settings.markets.every((market) => market.endAt === "2026-07-21T23:59:00.000Z")).toBe(true);
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("events_tag=top-netflix");
  });

  it("uses weekly Netflix release-window polling", () => {
    expect(netflixTop10Adapter.getPollIntervalMinutes?.({} as never, new Date("2026-07-21T18:00:00.000Z"))).toBe(60);
    expect(netflixTop10Adapter.getPollIntervalMinutes?.({} as never, new Date("2026-07-21T18:30:00.000Z"))).toBe(5);
  });
});

function buildNetflixHtml(options: { includeViews: boolean }): string {
  const titles = [
    "Enola Holmes 3",
    "Shipwrecked: Nightmare at Sea",
    "Voicemails for Isabelle",
    "The Doorman",
    "Little Brother",
    "Rust Creek",
    "F9: The Fast Saga",
    "Old Henry",
    "The Boss Baby",
    "Killer Elite"
  ];
  const rows = titles
    .map((title, index) => {
      const rank = index + 1;
      const views = options.includeViews
        ? `<td class="views" data-uia="top10-table-row-views">${formatInteger(rank === 1 ? 12_000_000 : 10_000_000 - rank * 500_000)}</td><td class="desktop-only" data-uia="top10-table-row-runtime">1:48</td><td class="desktop-only" data-uia="top10-table-row-hours">${formatInteger(rank === 1 ? 21_600_000 : 18_000_000 - rank * 500_000)}</td>`
        : "";
      return `<tr><td class="title" data-uia="top10-table-row-title"><span class="rank">${String(rank).padStart(2, "0")}</span><button>${title}</button></td><td data-uia="top10-table-row-weeks">${rank === 1 ? 2 : 1}</td>${views}</tr>`;
    })
    .join("");

  return `<html><body><script>{"weekEndDate":"2026-07-05"}{"weekEndDate":"2026-07-12"}</script><table><tbody>${rows}</tbody></table></body></html>`;
}

function buildIntegration(): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "netflix-top-10",
    displayName: "Netflix Top 10",
    sourceUrl: "https://top10.netflix.com/",
    polymarketUrl: "https://polymarket.com/event/what-will-be-the-top-us-netflix-show-this-week-20260715162849089",
    alertRoleId: null,
    roleMessageId: null,
    roleChannelId: null,
    roleEmoji: null,
    settingsJson: "{}",
    pollIntervalMinutes: 60,
    status: "active",
    lastValue: null,
    lastCheckedAt: null,
    lastChangedAt: null,
    snapshotValue: null,
    snapshotCheckedAt: null,
    snapshotDate: null,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z"
  };
}

function buildGammaEvent(slug: string, title: string): Record<string, unknown> {
  return {
    slug,
    title,
    active: true,
    closed: false,
    archived: false,
    tags: [{ slug: "top-netflix" }, { slug: "netflix" }],
    startDate: "2026-07-15T16:00:00Z",
    endDate: "2026-07-21T23:59:00Z"
  };
}

function titleFromSlug(slug: string): string {
  return slug.replace(/-\d{12,}$/, "").replace(/-/g, " ");
}

function formatInteger(value: number): string {
  return value.toLocaleString("en-US");
}
