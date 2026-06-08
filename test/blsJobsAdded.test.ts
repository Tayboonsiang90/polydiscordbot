import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractBlsEmploymentSituationReport,
  extractBlsJobsAddedValue,
  getBlsJobsAddedPollIntervalMinutes,
  getJobsAddedScheduledReleaseDate,
  parseJobsAddedMarketPeriod,
  refreshBlsJobsAddedPolymarketQueue,
  upsertBlsJobsAddedPolymarketQueueUrl
} from "../src/integrations/blsJobsAdded.js";
import type { Integration } from "../src/integrations/types.js";

const mayMarketUrl = "https://polymarket.com/event/how-many-jobs-added-in-may-945";
const juneMarketUrl = "https://polymarket.com/event/how-many-jobs-added-in-june-20260605153057140";

function reportHtml(period: string, releaseDate: string, phrase: string): string {
  return `
    <html>
      <body>
        USDL-26-0000 8:30 a.m. (ET) Friday, ${releaseDate}
        THE EMPLOYMENT SITUATION -- ${period}
        ${phrase}
      </body>
    </html>
  `;
}

function integration(input: Partial<Integration> = {}): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "bls-jobs-added",
    displayName: "BLS Jobs Added",
    sourceUrl: "https://www.bls.gov/bls/newsrels.htm",
    polymarketUrl: mayMarketUrl,
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
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...input
  };
}

describe("BLS jobs added adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses total nonfarm payroll change from the Employment Situation Summary", () => {
    expect(
      extractBlsEmploymentSituationReport(
        reportHtml(
          "MAY 2026",
          "June 5, 2026",
          "Total nonfarm payroll employment increased by 177,000 in May, and the unemployment rate was unchanged."
        ),
        "https://www.bls.gov/news.release/archives/empsit_06052026.htm"
      )
    ).toMatchObject({
      period: { year: 2026, month: 5, label: "May 2026" },
      changeJobs: 177000,
      releaseDate: "June 5, 2026"
    });
  });

  it("formats not-published status until the target month report exists", () => {
    const value = extractBlsJobsAddedValue(
      new Map([
        [
          "https://www.bls.gov/news.release/empsit.nr0.htm",
          reportHtml(
            "APRIL 2026",
            "May 8, 2026",
            "Total nonfarm payroll employment edged up by 115,000 in April, and the unemployment rate was unchanged."
          )
        ]
      ]),
      mayMarketUrl,
      new Date("2026-05-31T12:00:00.000Z")
    );

    expect(value).toContain("Period: May 2026");
    expect(value).toContain("Status: not published yet");
    expect(value).toContain("Latest available: April 2026 = +115,000 jobs");
  });

  it("computes Employment Situation release-watch dates", () => {
    expect(getJobsAddedScheduledReleaseDate(parseJobsAddedMarketPeriod(mayMarketUrl, new Date("2026-05-31T00:00:00.000Z")))).toBe(
      "2026-06-05"
    );
    expect(
      getJobsAddedScheduledReleaseDate(
        parseJobsAddedMarketPeriod("https://polymarket.com/event/how-many-jobs-added-in-april-296", new Date("2026-05-01T00:00:00.000Z"))
      )
    ).toBe("2026-05-08");
    expect(getBlsJobsAddedPollIntervalMinutes(integration(), new Date("2026-06-04T16:00:00.000Z"))).toBe(1);
    expect(getBlsJobsAddedPollIntervalMinutes(integration(), new Date("2026-05-31T16:00:00.000Z"))).toBe(60);
  });

  it("parses timestamped monthly jobs-added market slugs", () => {
    expect(parseJobsAddedMarketPeriod(juneMarketUrl, new Date("2026-06-06T00:00:00.000Z"))).toEqual({
      year: 2026,
      month: 6,
      label: "June 2026"
    });
  });

  it("queues jobs markets through the scheduled release day instead of month end", () => {
    const result = upsertBlsJobsAddedPolymarketQueueUrl(integration({ polymarketUrl: null }), mayMarketUrl, new Date("2026-05-31T12:00:00.000Z"));
    const settings = JSON.parse(result.settingsJson ?? "{}") as { polymarketMarkets: Array<{ startAt: string; endAt: string }> };

    expect(result.activeUrl).toBe(mayMarketUrl);
    expect(settings.polymarketMarkets[0]).toMatchObject({
      startAt: "2026-05-01T04:00:00.000Z",
      endAt: "2026-06-06T03:59:00.000Z"
    });
  });

  it("auto-discovers the timestamped June monthly jobs market from Gamma search", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "how-many-jobs-added-in-june-20260605153057140",
              title: "How many jobs added in June?",
              active: true,
              closed: false,
              tags: [{ slug: "nfp" }, { slug: "economy" }, { slug: "nonfarm-payroll" }]
            }
          ]
        })
      })
    );

    const result = await refreshBlsJobsAddedPolymarketQueue(integration({ polymarketUrl: null }), new Date("2026-06-06T03:00:00.000Z"));
    const settings = JSON.parse(result.settingsJson ?? "{}") as { polymarketMarkets: Array<{ slug: string }> };

    expect(result.activeUrl).toBe(juneMarketUrl);
    expect(settings.polymarketMarkets.map((market) => market.slug)).toEqual(["how-many-jobs-added-in-june-20260605153057140"]);
    expect(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain("events_tag=nonfarm-payroll");
  });

  it("keeps the previous monthly jobs market active through release day, then activates the discovered month", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "how-many-jobs-added-in-june-20260605153057140",
              title: "How many jobs added in June?",
              active: true,
              closed: false,
              tags: [{ slug: "nonfarm-payroll" }]
            }
          ]
        })
      })
    );

    const beforeMayExpiry = await refreshBlsJobsAddedPolymarketQueue(
      integration({
        polymarketUrl: mayMarketUrl,
        settingsJson: JSON.stringify({
          polymarketMarkets: [
            {
              url: mayMarketUrl,
              slug: "how-many-jobs-added-in-may-945",
              startAt: "2026-05-01T04:00:00.000Z",
              endAt: "2026-06-06T03:59:00.000Z",
              addedAt: "2026-05-01T04:00:00.000Z"
            }
          ]
        })
      }),
      new Date("2026-06-06T03:00:00.000Z")
    );

    expect(beforeMayExpiry.activeUrl).toBe(mayMarketUrl);

    const afterMayExpiry = await refreshBlsJobsAddedPolymarketQueue(
      integration({
        polymarketUrl: mayMarketUrl,
        settingsJson: beforeMayExpiry.settingsJson
      }),
      new Date("2026-06-06T04:00:00.000Z")
    );

    expect(afterMayExpiry.activeUrl).toBe(juneMarketUrl);
    const settings = JSON.parse(afterMayExpiry.settingsJson ?? "{}") as { polymarketMarkets: Array<{ slug: string }> };
    expect(settings.polymarketMarkets.map((market) => market.slug)).toEqual(["how-many-jobs-added-in-june-20260605153057140"]);
  });
});
