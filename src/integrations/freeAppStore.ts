import type { AdapterValue, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";

const sourceUrl = "https://apps.apple.com/us/charts/iphone";
const feedUrl = "https://rss.applemarketingtools.com/api/v2/us/apps/top-free/2/apps.json";

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
    const value = extractFreeAppStoreTop2(json);
    return {
      value,
      rawValue: value,
      unit: "US iPhone Top Free Apps",
      observedAt: new Date()
    };
  }
};

