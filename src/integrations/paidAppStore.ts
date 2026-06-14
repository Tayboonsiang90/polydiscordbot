import type { AdapterValue, WebsiteAdapter } from "./types.js";
import type { Integration } from "./types.js";
import {
  extractAppStoreTopApps,
  fetchAppleAppStoreChart,
  refreshAppStorePolymarketQueue,
  shouldAlertOnAppStoreTop2Change,
  upsertAppStorePolymarketMarket,
  type AppStoreChartResponse,
  type AppStoreMarketDiscoveryConfig
} from "./appleAppStore.js";

const sourceUrl = "https://apps.apple.com/us/charts/iphone";
const feedUrl = "https://rss.applemarketingtools.com/api/v2/us/apps/top-paid/5/apps.json";
const marketDiscoveryConfig: AppStoreMarketDiscoveryConfig = {
  chartType: "paid",
  searchQuery: "paid app in the us apple app store",
  lastDiscoveryAtKey: "lastPaidAppStoreMarketDiscoveryAt"
};

export function extractPaidAppStoreTop5(response: AppStoreChartResponse): string {
  return extractAppStoreTopApps(response, 5, "paid iPhone");
}

export const paidAppStoreAdapter: WebsiteAdapter = {
  id: "paid-app-store",
  commandName: "paidappstore",
  displayName: "Paid App Store Top 5",
  sourceUrl,
  defaultPolymarketUrl: "https://polymarket.com/event/1-paid-app-in-the-us-apple-app-store-on-may-8-666",
  defaultChannelName: "paidappstore",
  alertRoleName: "Paid App Store Alerts",
  alertRoleEmoji: "\uD83D\uDCB0",
  dailySnapshot: {
    timeZone: "America/New_York",
    hour: 12,
    minute: 0,
    windowMinutes: 5,
    label: "12:00 PM ET snapshot"
  },
  shouldAlertOnChange: shouldAlertOnAppStoreTop2Change,
  getPollIntervalReason(): string {
    return "Regular top-5 paid App Store chart checks; alerts only when top 2 change; 30-minute daily Polymarket market discovery.";
  },
  async refreshSettings(integration: Integration, options?: { force?: boolean }): Promise<string> {
    return (await refreshAppStorePolymarketQueue(integration, marketDiscoveryConfig, new Date(), options?.force)).settingsJson ?? integration.settingsJson ?? "{}";
  },
  async upsertPolymarketMarket(integration: Integration, url: string): Promise<{ settingsJson: string | null; activeUrl: string | null }> {
    return upsertAppStorePolymarketMarket(integration, url, marketDiscoveryConfig);
  },
  async fetchCurrentValue(): Promise<AdapterValue> {
    const json = await fetchAppleAppStoreChart(feedUrl);
    const value = extractPaidAppStoreTop5(json);
    return {
      value,
      rawValue: value,
      unit: "US iPhone Top Paid Apps",
      observedAt: new Date()
    };
  }
};

