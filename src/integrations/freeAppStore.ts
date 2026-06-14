import type { AdapterValue, WebsiteAdapter } from "./types.js";
import type { Integration } from "./types.js";
import {
  fetchAppleAppStoreChart,
  refreshAppStorePolymarketQueue,
  upsertAppStorePolymarketMarket,
  type AppStoreChartResponse,
  type AppStoreMarketDiscoveryConfig
} from "./appleAppStore.js";

const sourceUrl = "https://apps.apple.com/us/charts/iphone";
const feedUrl = "https://rss.applemarketingtools.com/api/v2/us/apps/top-free/2/apps.json";
const marketDiscoveryConfig: AppStoreMarketDiscoveryConfig = {
  chartType: "free",
  searchQuery: "free app in the us apple app store",
  lastDiscoveryAtKey: "lastFreeAppStoreMarketDiscoveryAt"
};

type AppStoreChartResult = {
  name?: string;
  artistName?: string;
};

export function extractFreeAppStoreTop2(response: AppStoreChartResponse): string {
  const apps = response.feed?.results?.slice(0, 2) ?? [];
  if (apps.length < 2) {
    throw new Error("Could not find 2 free iPhone apps in the Apple App Store chart response");
  }

  return apps
    .map((app, index) => {
      if (!app.name) {
        throw new Error("Apple App Store chart response included an app without a name");
      }

      return `${index + 1}. ${app.name}`;
    })
    .join("\n");
}

export const freeAppStoreAdapter: WebsiteAdapter = {
  id: "free-app-store",
  commandName: "freeappstore",
  displayName: "Free App Store Top 2",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/1-free-app-in-the-us-apple-app-store-on-may-8",
  defaultChannelName: "freeappstore",
  alertRoleName: "Free App Store Alerts",
  alertRoleEmoji: "\uD83C\uDD93",
  dailySnapshot: {
    timeZone: "America/New_York",
    hour: 12,
    minute: 0,
    windowMinutes: 5,
    label: "12:00 PM ET snapshot"
  },
  getPollIntervalReason(): string {
    return "Regular top-2 free App Store chart checks plus 30-minute daily Polymarket market discovery.";
  },
  async refreshSettings(integration: Integration, options?: { force?: boolean }): Promise<string> {
    return (await refreshAppStorePolymarketQueue(integration, marketDiscoveryConfig, new Date(), options?.force)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async upsertPolymarketMarket(integration: Integration, url: string): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return upsertAppStorePolymarketMarket(integration, url, marketDiscoveryConfig);
  },
  async fetchCurrentValue(): Promise<AdapterValue> {
    const json = await fetchAppleAppStoreChart(feedUrl);
    const value = extractFreeAppStoreTop2(json);
    return {
      value,
      rawValue: value,
      unit: "US iPhone Top Free Apps",
      observedAt: new Date()
    };
  }
};

