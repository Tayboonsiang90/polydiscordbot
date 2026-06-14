import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeAppStoreMarketSearchEvent,
  refreshAppStorePolymarketQueue,
  type AppStoreMarketDiscoveryConfig
} from "../src/integrations/appleAppStore.js";
import type { Integration } from "../src/integrations/types.js";

const freeConfig: AppStoreMarketDiscoveryConfig = {
  chartType: "free",
  searchQuery: "free app in the us apple app store",
  lastDiscoveryAtKey: "lastFreeAppStoreMarketDiscoveryAt"
};

const paidConfig: AppStoreMarketDiscoveryConfig = {
  chartType: "paid",
  searchQuery: "paid app in the us apple app store",
  lastDiscoveryAtKey: "lastPaidAppStoreMarketDiscoveryAt"
};

const integration: Integration = {
  id: 1,
  guildId: "guild",
  channelId: "channel",
  adapterId: "free-app-store",
  displayName: "Free App Store Top 5",
  sourceUrl: "https://apps.apple.com/us/charts/iphone",
  polymarketUrl: "https://polymarket.com/event/1-free-app-in-the-us-apple-app-store-on-may-8",
  alertRoleId: null,
  roleMessageId: null,
  roleChannelId: null,
  roleEmoji: null,
  settingsJson: null,
  pollIntervalMinutes: 5,
  status: "active",
  lastValue: null,
  lastCheckedAt: null,
  lastChangedAt: null,
  snapshotValue: null,
  snapshotCheckedAt: null,
  snapshotDate: null,
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z"
};

describe("App Store market discovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes #1 and #2 free App Store markets from Gamma search", () => {
    const now = new Date("2026-06-14T00:00:00.000Z");

    expect(
      normalizeAppStoreMarketSearchEvent(
        buildGammaEvent("1-free-app-in-the-us-apple-app-store-on-june-19-20260612142717681", "#1 Free App in the US Apple App Store on June 19?"),
        freeConfig,
        now
      )
    ).toMatchObject({
      slug: "1-free-app-in-the-us-apple-app-store-on-june-19-20260612142717681",
      url: "https://polymarket.com/event/1-free-app-in-the-us-apple-app-store-on-june-19-20260612142717681",
      startAt: "2026-06-12T18:01:50.794Z",
      endAt: "2026-06-20T03:59:00.000Z"
    });

    expect(
      normalizeAppStoreMarketSearchEvent(
        buildGammaEvent("2-free-app-in-the-us-apple-app-store-on-june-19-20260612142946547", "#2 Free App in the US Apple App Store on June 19?"),
        freeConfig,
        now
      )?.slug
    ).toBe("2-free-app-in-the-us-apple-app-store-on-june-19-20260612142946547");
  });

  it("keeps free and paid discovery separate", () => {
    const paidMarket = buildGammaEvent("1-paid-app-in-the-us-apple-app-store-on-june-19-20260612143508067", "#1 Paid App in the US Apple App Store on June 19?");
    const freeMarket = buildGammaEvent("1-free-app-in-the-us-apple-app-store-on-june-19-20260612142717681", "#1 Free App in the US Apple App Store on June 19?");

    expect(normalizeAppStoreMarketSearchEvent(paidMarket, freeConfig)).toBeNull();
    expect(normalizeAppStoreMarketSearchEvent(freeMarket, paidConfig)).toBeNull();
    expect(normalizeAppStoreMarketSearchEvent(paidMarket, paidConfig)?.slug).toBe("1-paid-app-in-the-us-apple-app-store-on-june-19-20260612143508067");
  });

  it("discovers and queues active daily free App Store markets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          events: [
            buildGammaEvent("1-free-app-in-the-us-apple-app-store-on-june-15-20260609160709063", "#1 Free App in the US Apple App Store on June 15?", {
              startDate: "2026-06-09T18:04:34.470791Z",
              endDate: "2026-06-15T16:00:00Z"
            }),
            buildGammaEvent("2-free-app-in-the-us-apple-app-store-on-june-15-20260609160936914", "#2 Free App in the US Apple App Store on June 15?", {
              startDate: "2026-06-09T18:14:40.843583Z",
              endDate: "2026-06-15T16:00:00Z"
            }),
            buildGammaEvent("1-paid-app-in-the-us-apple-app-store-on-june-15-20260609161759460", "#1 Paid App in the US Apple App Store on June 15?")
          ]
        })
      )
    );

    const result = await refreshAppStorePolymarketQueue(integration, freeConfig, new Date("2026-06-14T00:00:00.000Z"), true);
    const settings = JSON.parse(result.settingsJson ?? "{}") as { polymarketMarkets: Array<{ slug: string }> };

    expect(result.activeUrl).toBe("https://polymarket.com/event/1-free-app-in-the-us-apple-app-store-on-june-15-20260609160709063");
    expect(settings.polymarketMarkets.map((market) => market.slug)).toEqual([
      "1-free-app-in-the-us-apple-app-store-on-june-15-20260609160709063",
      "2-free-app-in-the-us-apple-app-store-on-june-15-20260609160936914"
    ]);
  });
});

function buildGammaEvent(slug: string, title: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug,
    title,
    active: true,
    closed: false,
    archived: false,
    startDate: "2026-06-12T18:01:50.794121Z",
    endDate: "2026-06-20T03:59:00Z",
    tags: [{ slug: "app-store" }, { slug: "tech" }],
    ...overrides
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
