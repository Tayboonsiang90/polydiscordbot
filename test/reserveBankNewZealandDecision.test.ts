import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildReserveBankNewZealandDecisionValue,
  extractReserveBankNewZealandDecisions,
  extractReserveBankNewZealandOcrEvents,
  extractReserveBankNewZealandOcrStatus,
  getReserveBankNewZealandDecisionPollIntervalMinutes,
  refreshReserveBankNewZealandDecisionPolymarketQueue,
  shouldAlertOnReserveBankNewZealandDecisionChange
} from "../src/integrations/reserveBankNewZealandDecision.js";
import type { Integration } from "../src/integrations/types.js";

const septemberMarketUrl = "https://polymarket.com/event/reserve-bank-of-new-zealand-decision-in-september-20260710022000963";

function integration(input: Partial<Integration> = {}): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "reserve-bank-new-zealand-decision",
    displayName: "Reserve Bank of New Zealand Decision",
    sourceUrl: "https://www.rbnz.govt.nz/news-and-events/events",
    polymarketUrl: septemberMarketUrl,
    alertRoleId: null,
    roleMessageId: null,
    roleChannelId: null,
    roleEmoji: null,
    settingsJson: null,
    pollIntervalMinutes: 60,
    status: "active",
    lastValue: null,
    lastCheckedAt: null,
    lastChangedAt: null,
    snapshotValue: null,
    snapshotCheckedAt: null,
    snapshotDate: null,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    ...input
  };
}

describe("Reserve Bank of New Zealand decision adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts the latest OCR decisions from RBNZ markdown", () => {
    const decisions = extractReserveBankNewZealandDecisions(`
      **2026**
      8 July 2026 2.5[Media release](https://www.rbnz.govt.nz/news-and-events/news/2026/07/ocr-increased-to-2-50-to-return-inflation-to-2-percent)
      27 May 2026 2.25[Media release](https://www.rbnz.govt.nz/news-and-events/news/2026/05/ocr-held-at-2-25-percent)
      8 April 2026 2.25[Media release](https://www.rbnz.govt.nz/news-and-events/news/2026/04/ocr-on-hold-at-2-25)
    `);

    expect(decisions.slice(0, 2)).toEqual([
      {
        date: "8 July 2026",
        dateIso: "2026-07-08",
        rate: "2.5%",
        url: "https://www.rbnz.govt.nz/news-and-events/news/2026/07/ocr-increased-to-2-50-to-return-inflation-to-2-percent"
      },
      {
        date: "27 May 2026",
        dateIso: "2026-05-27",
        rate: "2.25%",
        url: "https://www.rbnz.govt.nz/news-and-events/news/2026/05/ocr-held-at-2-25-percent"
      }
    ]);
  });

  it("extracts OCR status and upcoming OCR event from RBNZ pages", () => {
    expect(
      extractReserveBankNewZealandOcrStatus(`
        Last updated:
        08 July 2026
        ### Official Cash Rate
        2.5  %
        Updated: 2:00pm, 08 Jul 2026
        Next update: 2:00pm, 02 Sep 2026
      `)
    ).toEqual({
      currentRate: "2.5%",
      lastUpdated: "08 July 2026",
      updatedAt: "2:00pm, 08 Jul 2026",
      updatedAtEt: "2026-07-07 22:00 ET",
      nextUpdate: "2:00pm, 02 Sep 2026",
      nextUpdateDateIso: "2026-09-02",
      nextUpdateEt: "2026-09-01 22:00 ET",
      nextUpdateEtDateIso: "2026-09-01"
    });

    expect(
      extractReserveBankNewZealandOcrEvents(`
        13 Jul 2026 Mon 9:30pm - 11:30pm
        ## Post OCR media interview schedule

        02 Sep 2026 Wed 2:00am - 4:00am
        ## Monetary Policy Statement and OCR September 2026
      `)
    ).toEqual([
      {
        dateIso: "2026-09-02",
        title: "Monetary Policy Statement and OCR September 2026",
        rawLine: "02 Sep 2026 Wed 2:00am - 4:00am"
      }
    ]);
  });

  it("formats decision state and suppresses first-run alerts", () => {
    const value = buildReserveBankNewZealandDecisionValue(
      {
        date: "8 July 2026",
        dateIso: "2026-07-08",
        rate: "2.5%",
        url: "https://www.rbnz.govt.nz/news-and-events/news/2026/07/ocr-increased-to-2-50-to-return-inflation-to-2-percent"
      },
      {
        date: "27 May 2026",
        dateIso: "2026-05-27",
        rate: "2.25%",
        url: "https://www.rbnz.govt.nz/news-and-events/news/2026/05/ocr-held-at-2-25-percent"
      },
      {
        currentRate: "2.5%",
        lastUpdated: "08 July 2026",
        updatedAt: "2:00pm, 08 Jul 2026",
        updatedAtEt: "2026-07-07 22:00 ET",
        nextUpdate: "2:00pm, 02 Sep 2026",
        nextUpdateDateIso: "2026-09-02",
        nextUpdateEt: "2026-09-01 22:00 ET",
        nextUpdateEtDateIso: "2026-09-01"
      },
      {
        dateIso: "2026-09-02",
        title: "Monetary Policy Statement and OCR September 2026",
        rawLine: "02 Sep 2026 Wed 2:00am - 4:00am"
      },
      septemberMarketUrl
    );

    expect(value).toContain("Decision direction: Increase");
    expect(value).toContain("OCR after latest decision: 2.5%");
    expect(value).toContain("Next OCR update: 2026-09-01 22:00 ET");
    expect(shouldAlertOnReserveBankNewZealandDecisionChange(null, value)).toBe(false);
    expect(shouldAlertOnReserveBankNewZealandDecisionChange(value, value.replace("2026-07-08|2.5%", "2026-09-02|2.75%"))).toBe(true);
  });

  it("polls every minute on the day before and day of the next RBNZ update", () => {
    const lastValue = "Next OCR update: 2026-09-01 22:00 ET";

    expect(getReserveBankNewZealandDecisionPollIntervalMinutes(integration({ lastValue }), new Date("2026-08-30T16:00:00.000Z"))).toBe(60);
    expect(getReserveBankNewZealandDecisionPollIntervalMinutes(integration({ lastValue }), new Date("2026-08-31T16:00:00.000Z"))).toBe(1);
    expect(getReserveBankNewZealandDecisionPollIntervalMinutes(integration({ lastValue }), new Date("2026-09-01T16:00:00.000Z"))).toBe(1);
    expect(getReserveBankNewZealandDecisionPollIntervalMinutes(integration({ lastValue }), new Date("2026-09-02T16:00:00.000Z"))).toBe(60);
  });

  it("auto-discovers active monthly RBNZ decision markets from Gamma search", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "reserve-bank-of-new-zealand-decision-in-september-20260710022000963",
              title: "Reserve Bank of New Zealand decision in September?",
              active: true,
              closed: false,
              tags: []
            }
          ]
        })
      })
    );

    const result = await refreshReserveBankNewZealandDecisionPolymarketQueue(
      integration({ polymarketUrl: null }),
      new Date("2026-07-11T12:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as { polymarketMarkets?: Array<{ slug: string }> };

    expect(settings.polymarketMarkets?.map((market) => market.slug)).toEqual([
      "reserve-bank-of-new-zealand-decision-in-september-20260710022000963"
    ]);
    expect(result.activeUrl).toBeNull();
  });
});
