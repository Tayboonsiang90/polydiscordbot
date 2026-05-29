import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractNceiReleaseScheduleText,
  extractNceiTornadoValue,
  parseTornadoMarketPeriod,
  refreshTornadoPolymarketQueue,
  shouldAlertOnTornadoChange
} from "../src/integrations/nceiTornadoes.js";
import type { Integration } from "../src/integrations/types.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const integration = {
  settingsJson: null,
  polymarketUrl: "https://polymarket.com/event/how-many-tornadoes-in-the-us-in-may"
} as Integration;

describe("NCEI tornadoes adapter", () => {
  it("parses the month from monthly Polymarket tornado slugs", () => {
    expect(
      parseTornadoMarketPeriod(
        "https://polymarket.com/event/how-many-tornadoes-in-the-us-in-april-522",
        new Date("2026-05-29T00:00:00.000Z")
      )
    ).toMatchObject({
      year: 2026,
      month: 4,
      dataKey: "202604",
      label: "2026-04"
    });
  });

  it("formats a preliminary monthly tornado count", () => {
    const value = extractNceiTornadoValue(
      { tornadoes: { "202604": "304*", "202504": 313 } },
      { year: 2026, month: 4, dataKey: "202604", label: "2026-04" },
      "April U.S. Release: Fri, 8 May 2026, 11:00 AM EDT"
    );

    expect(value).toContain("Value: 304 tornadoes");
    expect(value).toContain("Preliminary: yes");
    expect(value).toContain("Release schedule: April U.S. Release");
  });

  it("formats not-published monthly data with the latest same-month value", () => {
    const value = extractNceiTornadoValue(
      { tornadoes: { "202405": 536, "202505": 278 } },
      { year: 2026, month: 5, dataKey: "202605", label: "2026-05" },
      "May U.S. Release: Mon, 8 Jun 2026, 11:00 AM EDT"
    );

    expect(value).toContain("Value: not published yet");
    expect(value).toContain("Latest available for month: 2025-05 = 278 tornadoes");
  });

  it("extracts the NCEI next release text from the release page", () => {
    expect(
      extractNceiReleaseScheduleText(
        '<div class="ncei-footer-third-width" id="next-release"><a href="/access/monitoring/dyk/monthly-releases">May U.S. Release: Mon, 8 Jun 2026, 11:00 AM EDT</a></div>'
      )
    ).toBe("May U.S. Release: Mon, 8 Jun 2026, 11:00 AM EDT");
  });

  it("alerts only when a target month first becomes published", () => {
    expect(shouldAlertOnTornadoChange("Value: not published yet", "Value: 304 tornadoes")).toBe(true);
    expect(shouldAlertOnTornadoChange("Value: 304 tornadoes", "Value: 305 tornadoes")).toBe(false);
  });

  it("auto-discovers active monthly tornado markets and keeps overlap on the older month", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "how-many-tornadoes-in-the-us-in-may",
              title: "How many Tornadoes in the US in May?",
              active: true,
              closed: false,
              endDate: "2026-06-08T00:00:00Z",
              tags: [{ slug: "tornadoes" }]
            },
            {
              slug: "how-many-tornadoes-in-the-us-in-june",
              title: "How many Tornadoes in the US in June?",
              active: true,
              closed: false,
              endDate: "2026-07-08T00:00:00Z",
              tags: [{ slug: "tornadoes" }]
            },
            {
              slug: "how-many-tornadoes-in-the-us-in-2026",
              title: "How many Tornadoes in the US in 2026?",
              active: true,
              closed: false,
              endDate: "2027-01-10T00:00:00Z",
              tags: [{ slug: "tornadoes" }]
            }
          ]
        })
      })
    );

    const result = await refreshTornadoPolymarketQueue(integration, new Date("2026-05-29T12:00:00.000Z"));
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      lastTornadoDiscoveryAt?: string;
      polymarketMarkets?: Array<{ slug: string; startAt: string; endAt: string }>;
    };

    expect(result.activeUrl).toBe("https://polymarket.com/event/how-many-tornadoes-in-the-us-in-may");
    expect(settings.lastTornadoDiscoveryAt).toBe("2026-05-29T12:00:00.000Z");
    expect(settings.polymarketMarkets?.map((market) => market.slug)).toEqual([
      "how-many-tornadoes-in-the-us-in-may",
      "how-many-tornadoes-in-the-us-in-june"
    ]);
    expect(settings.polymarketMarkets?.[0]).toMatchObject({
      startAt: "2026-05-01T04:00:00.000Z",
      endAt: "2026-06-09T03:59:00.000Z"
    });
  });
});
