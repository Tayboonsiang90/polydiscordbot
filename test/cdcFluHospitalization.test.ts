import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractCdcFluHospitalizationReport,
  formatCdcFluHospitalizationValue,
  parseFluHospitalizationMarketPeriod,
  refreshFluHospitalizationPolymarketQueue,
  shouldAlertOnCdcFluHospitalizationChange,
  upsertFluHospitalizationPolymarketQueueUrl
} from "../src/integrations/cdcFluHospitalization.js";
import type { Integration } from "../src/integrations/types.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const integration = {
  settingsJson: null,
  polymarketUrl: "https://polymarket.com/event/flu-hospitalization-rate-week-20-2026"
} as Integration;

describe("CDC flu hospitalization adapter", () => {
  it("parses CDC week/year from Polymarket slugs", () => {
    expect(parseFluHospitalizationMarketPeriod("https://polymarket.com/event/flu-hospitalization-rate-week-20-2026")).toEqual({
      year: 2026,
      week: 20,
      label: "Week 20, 2026",
      weekStartDate: "2026-05-17",
      weekEndDate: "2026-05-23"
    });
  });

  it("extracts the FluSurv-NET cumulative hospitalization rate from a CDC weekly report", () => {
    const report = extractCdcFluHospitalizationReport(
      `
      <html>
        <body>
          <time class="cdc-page-title-bar__item--date">May 29, 2026</time>
          <h1>Weekly US Influenza Surveillance Report: Key Updates for Week 20, ending May 23, 2026</h1>
          <p>The cumulative hospitalization rate observed in Week 20 was 87.2 per 100,000 population.</p>
        </body>
      </html>
      `,
      "https://www.cdc.gov/fluview/surveillance/2026-week-20.html"
    );

    expect(report).toMatchObject({
      rate: 87.2,
      reportDate: "May 29, 2026",
      reportUrl: "https://www.cdc.gov/fluview/surveillance/2026-week-20.html",
      period: {
        year: 2026,
        week: 20,
        weekStartDate: "2026-05-17",
        weekEndDate: "2026-05-23"
      }
    });
  });

  it("formats published and not-published target weeks", () => {
    const targetPeriod = parseFluHospitalizationMarketPeriod(
      "https://polymarket.com/event/flu-hospitalization-rate-week-21-2026"
    );
    const latestReport = {
      period: parseFluHospitalizationMarketPeriod("https://polymarket.com/event/flu-hospitalization-rate-week-20-2026"),
      rate: 87.2,
      reportDate: "May 29, 2026",
      reportUrl: "https://www.cdc.gov/fluview/surveillance/2026-week-20.html"
    };

    expect(formatCdcFluHospitalizationValue(targetPeriod, null, latestReport)).toContain("Status: not published yet");
    expect(formatCdcFluHospitalizationValue(targetPeriod, null, latestReport)).toContain(
      "Latest available: Week 20, 2026 = 87.2 per 100,000"
    );
    expect(formatCdcFluHospitalizationValue(targetPeriod, { ...latestReport, period: targetPeriod }, latestReport)).toContain(
      "Status: published"
    );
  });

  it("alerts only when the target week is published or revised", () => {
    expect(shouldAlertOnCdcFluHospitalizationChange("Status: not published yet", "Status: not published yet")).toBe(false);
    expect(
      shouldAlertOnCdcFluHospitalizationChange("Status: not published yet", "Status: published\nValue: 87.2 per 100,000")
    ).toBe(true);
    expect(
      shouldAlertOnCdcFluHospitalizationChange("Status: published\nValue: 87.2 per 100,000", "Status: published\nValue: 87.2 per 100,000")
    ).toBe(false);
    expect(
      shouldAlertOnCdcFluHospitalizationChange("Status: published\nValue: 87.2 per 100,000", "Status: published\nValue: 87.3 per 100,000")
    ).toBe(true);
  });

  it("auto-discovers active weekly flu hospitalization markets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          events: [
            {
              slug: "flu-hospitalization-rate-week-21-2026",
              title: "Flu Hospitalization Rate Week 21, 2026?",
              active: true,
              closed: false,
              endDate: "2026-06-05T16:00:00Z",
              tags: [{ slug: "flu" }]
            },
            {
              slug: "unrelated-flu-market",
              title: "Unrelated flu market",
              active: true,
              closed: false
            }
          ]
        })
      })
    );

    const result = await refreshFluHospitalizationPolymarketQueue(integration, new Date("2026-06-02T12:00:00.000Z"));
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      lastFluHospitalizationDiscoveryAt?: string;
      polymarketMarkets?: Array<{ slug: string; startAt: string; endAt: string }>;
    };

    expect(result.activeUrl).toBe("https://polymarket.com/event/flu-hospitalization-rate-week-21-2026");
    expect(settings.lastFluHospitalizationDiscoveryAt).toBe("2026-06-02T12:00:00.000Z");
    expect(settings.polymarketMarkets).toEqual([
      {
        url: "https://polymarket.com/event/flu-hospitalization-rate-week-21-2026",
        slug: "flu-hospitalization-rate-week-21-2026",
        startAt: "2026-05-24T04:00:00.000Z",
        endAt: "2026-06-06T03:59:00.000Z",
        addedAt: "2026-06-02T12:00:00.000Z"
      }
    ]);
    expect(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain("events_tag=flu");
  });

  it("auto-discovers and activates the week 22 flu hospitalization market after week 21 expires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          events: [
            {
              slug: "flu-hospitalization-rate-week-22-2026",
              title: "Flu Hospitalization Rate Week 22, 2026?",
              active: true,
              closed: false,
              endDate: "2026-06-12T00:00:00Z",
              tags: [{ slug: "flu" }, { slug: "influenza" }]
            }
          ]
        })
      })
    );

    const result = await refreshFluHospitalizationPolymarketQueue(
      {
        ...integration,
        polymarketUrl: "https://polymarket.com/event/flu-hospitalization-rate-week-21-2026",
        settingsJson: JSON.stringify({
          polymarketMarkets: [
            {
              url: "https://polymarket.com/event/flu-hospitalization-rate-week-21-2026",
              slug: "flu-hospitalization-rate-week-21-2026",
              startAt: "2026-05-24T04:00:00.000Z",
              endAt: "2026-06-06T03:59:00.000Z",
              addedAt: "2026-06-02T12:00:00.000Z"
            }
          ]
        })
      },
      new Date("2026-06-06T04:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      lastFluHospitalizationDiscoveryAt?: string;
      polymarketMarkets?: Array<{ slug: string; startAt: string; endAt: string }>;
    };

    expect(result.activeUrl).toBe("https://polymarket.com/event/flu-hospitalization-rate-week-22-2026");
    expect(settings.lastFluHospitalizationDiscoveryAt).toBe("2026-06-06T04:00:00.000Z");
    expect(settings.polymarketMarkets).toEqual([
      {
        url: "https://polymarket.com/event/flu-hospitalization-rate-week-22-2026",
        slug: "flu-hospitalization-rate-week-22-2026",
        startAt: "2026-05-31T04:00:00.000Z",
        endAt: "2026-06-13T03:59:00.000Z",
        addedAt: "2026-06-06T04:00:00.000Z"
      }
    ]);
  });

  it("queues manually entered weekly markets with MMWR windows", () => {
    const result = upsertFluHospitalizationPolymarketQueueUrl(
      integration,
      "https://polymarket.com/event/flu-hospitalization-rate-week-19-2026",
      new Date("2026-05-20T12:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      polymarketMarkets?: Array<{ slug: string; startAt: string; endAt: string }>;
    };

    expect(result.activeUrl).toBe("https://polymarket.com/event/flu-hospitalization-rate-week-19-2026");
    expect(settings.polymarketMarkets?.[0]).toMatchObject({
      slug: "flu-hospitalization-rate-week-19-2026",
      startAt: "2026-05-10T04:00:00.000Z",
      endAt: "2026-05-27T03:59:00.000Z"
    });
  });
});
