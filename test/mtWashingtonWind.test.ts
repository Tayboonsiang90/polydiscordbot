import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMtWashingtonF6PdfUrl,
  extractMtWashingtonWindDay,
  extractMtWashingtonWindReport,
  formatMtWashingtonWindValue,
  getMtWashingtonWindSettings,
  mtWashingtonWindAdapter,
  refreshMtWashingtonWindPolymarketQueue
} from "../src/integrations/mtWashingtonWind.js";
import type { Integration } from "../src/integrations/types.js";

const sampleF6Text = `
WS FORM F-6 STATION
MOUNT WASHINGTON OBSERVATORY
PRELIMINARY LOCAL CLIMATOLOGICAL DATA MONTH YEAR
JULY 2025
DAY MAX MIN AVG NORM DEPART HEAT COOL (EQUIV) ICE GROUND-7AM SPEED SPEED DIR TOTAL % POSS (TENTHS) OCCUR.
1 59 54 57 49 8 8 0 0.36 0.0 0 37.8 64 280 (W) 0 0 10 12
17 61 51 56 50 6 9 0 0.65 0.0 0 36.3 97 290 (W) 135 15 10 123
18 51 37 44 50 -6 21 0 0.49 0.0 0 38.2 91 290 (W) 518 56 8 12
31 50 40 45 50 -5 20 0 0.05 0.0 0 18.4 43 310 (NW) 12 1 10 12
SUM 1782 1463 ----
AVG 57.5 47.2 ----
MISC. -> 97 290 (W) 28530
`;

describe("Mt. Washington wind adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("parses a daily F6 wind row from the fastest mile column", () => {
    expect(extractMtWashingtonWindDay("17 61 51 56 50 6 9 0 0.65 0.0 0 36.3 97 290 (W) 135 15 10 123")).toEqual({
      day: 17,
      averageSpeedMph: 36.3,
      fastestSpeedMph: 97,
      directionDegrees: "290",
      directionLabel: "W"
    });
  });

  it("extracts the highest wind speed and latest reported day", () => {
    expect(extractMtWashingtonWindReport(sampleF6Text, { year: 2025, month: 7 })).toMatchObject({
      year: 2025,
      month: 7,
      monthName: "July",
      latestReportedDay: 31,
      highestSpeedMph: 97,
      highestDay: 17,
      miscFastestSpeedMph: 97,
      miscDirection: "290 (W)"
    });
  });

  it("formats the monitored value with PDF metadata", () => {
    const value = formatMtWashingtonWindValue(
      extractMtWashingtonWindReport(sampleF6Text, { year: 2025, month: 7 }),
      "https://mountwashington.org/uploads/pdf/forms/2025/07.pdf",
      "Sun, 03 Aug 2025 03:48:04 GMT"
    );

    expect(value).toContain("Highest wind speed: 97 mph");
    expect(value).toContain("Highest day: 2025-07-17");
    expect(value).toContain("Latest reported day: 2025-07-31");
    expect(value).toContain("Latest day wind speed: 43 mph on 2025-07-31 (avg 18.4 mph, 310 (NW))");
    expect(value).toContain("Daily wind rows: 2025-07-01=64mph avg 37.8 280(W)");
    expect(value).toContain("2025-07-31=43mph avg 18.4 310(NW)");
    expect(value).toContain("F6 last modified: Sun, 03 Aug 2025 03:48:04 GMT");
  });

  it("uses default July 2026 settings unless the monitor period is configured", () => {
    expect(getMtWashingtonWindSettings()).toEqual({ year: 2026, month: 7 });
    expect(
      getMtWashingtonWindSettings({
        settingsJson: JSON.stringify({ year: 2025, month: 7 })
      } as Integration)
    ).toEqual({ year: 2025, month: 7 });
    expect(buildMtWashingtonF6PdfUrl({ year: 2026, month: 7 })).toBe(
      "https://mountwashington.org/uploads/pdf/forms/2026/07.pdf"
    );
  });

  it("supports period configuration and five-minute polling", () => {
    expect(mtWashingtonWindAdapter.supportsPeriod).toBe(true);
    expect(mtWashingtonWindAdapter.refreshSettings).toBeDefined();
    expect(mtWashingtonWindAdapter.getPollIntervalMinutes?.({} as never)).toBe(5);
  });

  it("auto-discovers and activates the August wind-speed market", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          events: [
            {
              slug: "highest-mtpt-washington-wind-speed-in-august-20260727152349919",
              title: "Highest Mt. Washington wind speed in August?",
              active: true,
              closed: false
            }
          ]
        })
      )
    );

    const result = await refreshMtWashingtonWindPolymarketQueue(
      {
        settingsJson: JSON.stringify({ year: 2026, month: 7 }),
        polymarketUrl: "https://polymarket.com/event/highest-mtpt-washington-wind-speed-in-july-20260626193609212"
      } as Integration,
      new Date("2026-08-03T02:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      year: number;
      month: number;
      polymarketMarkets: Array<{ slug: string }>;
    };

    expect(result.activeUrl).toBe(
      "https://polymarket.com/event/highest-mtpt-washington-wind-speed-in-august-20260727152349919"
    );
    expect(settings).toMatchObject({ year: 2026, month: 8 });
    expect(settings.polymarketMarkets).toEqual([
      expect.objectContaining({ slug: "highest-mtpt-washington-wind-speed-in-august-20260727152349919" })
    ]);
  });
});
