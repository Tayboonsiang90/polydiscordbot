import type { AdapterValue, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";

const sourceUrl = "https://apps.apple.com/us/charts/iphone";
const feedUrl = "https://rss.applemarketingtools.com/api/v2/us/apps/top-paid/2/apps.json";

type AppStoreChartResponse = {
  feed?: {
    updated?: string;
    results?: AppStoreChartResult[];
  };
};

type AppStoreChartResult = {
  name?: string;
  artistName?: string;
};

export function extractPaidAppStoreTop2(response: AppStoreChartResponse): string {
  const apps = response.feed?.results?.slice(0, 2) ?? [];
  if (apps.length < 2) {
    throw new Error("Could not find 2 paid iPhone apps in the Apple App Store chart response");
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

export const paidAppStoreAdapter: WebsiteAdapter = {
  id: "paid-app-store",
  commandName: "paidappstore",
  displayName: "Paid App Store Top 2",
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
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(feedUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`Apple App Store chart returned HTTP ${response.status}`);
    }

    const json = (await response.json()) as AppStoreChartResponse;
    const value = extractPaidAppStoreTop2(json);
    return {
      value,
      rawValue: value,
      unit: "US iPhone Top Paid Apps",
      observedAt: new Date()
    };
  }
};

