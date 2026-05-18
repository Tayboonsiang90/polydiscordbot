import { fetchWithTimeout } from "../http.js";

export type AppStoreChartResponse = {
  feed?: {
    updated?: string;
    results?: AppStoreChartResult[];
  };
};

type AppStoreChartResult = {
  name?: string;
  artistName?: string;
};

const appleAppStoreTimeoutMs = 45_000;
const appleAppStoreAttempts = 3;

export async function fetchAppleAppStoreChart(feedUrl: string): Promise<AppStoreChartResponse> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= appleAppStoreAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        feedUrl,
        {
          headers: {
            accept: "application/json",
            "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
          }
        },
        appleAppStoreTimeoutMs
      );

      if (!response.ok) {
        throw new Error(`Apple App Store chart returned HTTP ${response.status}`);
      }

      return (await response.json()) as AppStoreChartResponse;
    } catch (error) {
      lastError = error;
      if (attempt < appleAppStoreAttempts) {
        await delay(attempt * 2_000);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
