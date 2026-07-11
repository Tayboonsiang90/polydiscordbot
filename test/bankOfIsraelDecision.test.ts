import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBankOfIsraelDecisionValue,
  extractBankOfIsraelDecisionDetail,
  extractBankOfIsraelSchedule,
  extractLatestBankOfIsraelInterestRateAnnouncement,
  findNextBankOfIsraelPublicationDate,
  getBankOfIsraelDecisionPollIntervalMinutes,
  refreshBankOfIsraelDecisionPolymarketQueue,
  shouldAlertOnBankOfIsraelDecisionChange
} from "../src/integrations/bankOfIsraelDecision.js";
import type { Integration } from "../src/integrations/types.js";

const augustMarketUrl = "https://polymarket.com/event/bank-of-israel-decision-in-august";
const septemberMarketUrl = "https://polymarket.com/event/bank-of-israel-decision-in-september-20260710022159182";

function integration(input: Partial<Integration> = {}): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "bank-of-israel-decision",
    displayName: "Bank of Israel Decision",
    sourceUrl: "https://www.boi.org.il/en/economic-roles/monetary-policy/interest-rate-announcement-dates-2025-2026/",
    polymarketUrl: augustMarketUrl,
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
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...input
  };
}

describe("Bank of Israel decision adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts the latest interest-rate announcement from BOI markdown", () => {
    const markdown = `
      ## Press Releases
      [09/07/2026 The Bank of Israel Monetary Committee met with private forecasters](https://www.boi.org.il/en/communication-and-publications/press-releases/private-forecasters/)
      [06/07/2026 * Interest Rate Announcements The Monetary Committee decides on July 6, 2026 to lower the interest rate to 3.5 percent.](https://www.boi.org.il/en/communication-and-publications/press-releases/the-monetary-committee-decides-on-july-6-2026-to-lower-the-interest-rate-to-35-percent/ "The Monetary Committee decides on July 6, 2026 to lower the interest rate to 3.5 percent.")
    `;

    expect(extractLatestBankOfIsraelInterestRateAnnouncement(markdown)).toEqual({
      date: "06/07/2026",
      title: "The Monetary Committee decides on July 6, 2026 to lower the interest rate to 3.5 percent.",
      url: "https://www.boi.org.il/en/communication-and-publications/press-releases/the-monetary-committee-decides-on-july-6-2026-to-lower-the-interest-rate-to-35-percent/"
    });
  });

  it("extracts decision direction, rate, document, and summary from the decision page", () => {
    const detail = extractBankOfIsraelDecisionDetail(`
      Title: The Monetary Committee decides on July 6, 2026 to lower the interest rate to 3.5 percent.
      Markdown Content:
      [To view this press release click here](https://www.boi.org.il/media/cpchclgz/july-6-2026.docx)
      * The inflation rate in May remained stable around the midpoint of the target range.
      **The Monetary Committee's policy is focusing on price stability.**
    `);

    expect(detail).toMatchObject({
      decision: "Decrease",
      rate: "3.5%",
      documentUrl: "https://www.boi.org.il/media/cpchclgz/july-6-2026.docx"
    });
    expect(detail.summary).toContain("The inflation rate in May remained stable");
  });

  it("parses the BOI 2026 schedule and finds the next publication date", () => {
    const schedule = extractBankOfIsraelSchedule(`
      **Press conference****Research Department Staff Forecast****Maintenance period Start Date****Start Date****Publication Date**
      06/07/2026 06/07/2026 09/07/2026 09/07/2026 06/07/2026
      03/09/2026 03/09/2026 01/09/2026
      21/10/2026 21/10/2026 22/10/2026 25/10/2026 21/10/2026
      [Interest rate announcement dates 2027 to april 2028](https://www.boi.org.il/en/bank-of-israel/interest-rate-announcement-dates-2027-2028/)
    `);

    expect(schedule.map((entry) => entry.publicationDateIso)).toEqual(["2026-07-06", "2026-09-01", "2026-10-21"]);
    expect(findNextBankOfIsraelPublicationDate(schedule, new Date("2026-07-11T12:00:00.000Z"))?.publicationDateIso).toBe("2026-09-01");
  });

  it("formats latest decision state and suppresses first-run alert", () => {
    const value = buildBankOfIsraelDecisionValue(
      {
        date: "06/07/2026",
        title: "The Monetary Committee decides on July 6, 2026 to lower the interest rate to 3.5 percent.",
        url: "https://www.boi.org.il/en/communication-and-publications/press-releases/the-monetary-committee-decides-on-july-6-2026-to-lower-the-interest-rate-to-35-percent/"
      },
      {
        decision: "Decrease",
        rate: "3.5%",
        documentUrl: "https://www.boi.org.il/media/cpchclgz/july-6-2026.docx",
        summary: "The Monetary Committee lowered the interest rate."
      },
      {
        publicationDate: "01/09/2026",
        publicationDateIso: "2026-09-01",
        rawLine: "03/09/2026 03/09/2026 01/09/2026"
      },
      augustMarketUrl
    );

    expect(value).toContain("Decision: Decrease");
    expect(value).toContain("Rate: 3.5%");
    expect(value).toContain("Next scheduled publication: 2026-09-01 16:00 Israel time");
    expect(shouldAlertOnBankOfIsraelDecisionChange(null, value)).toBe(false);
    expect(shouldAlertOnBankOfIsraelDecisionChange(value, value.replace("july-6-2026", "new-release"))).toBe(true);
  });

  it("polls every minute on the day before and day of the next scheduled BOI publication", () => {
    const lastValue = "Next scheduled publication: 2026-09-01 16:00 Israel time";

    expect(getBankOfIsraelDecisionPollIntervalMinutes(integration({ lastValue }), new Date("2026-08-30T16:00:00.000Z"))).toBe(60);
    expect(getBankOfIsraelDecisionPollIntervalMinutes(integration({ lastValue }), new Date("2026-08-31T16:00:00.000Z"))).toBe(1);
    expect(getBankOfIsraelDecisionPollIntervalMinutes(integration({ lastValue }), new Date("2026-09-01T16:00:00.000Z"))).toBe(1);
  });

  it("auto-discovers active monthly BOI decision markets from Gamma search", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "bank-of-israel-decision-in-august",
              title: "Bank of Israel decision in August?",
              active: true,
              closed: false,
              tags: [{ slug: "boi" }]
            },
            {
              slug: "bank-of-israel-decision-in-september-20260710022159182",
              title: "Bank of Israel Decision in September?",
              active: true,
              closed: false,
              tags: [{ slug: "boi" }]
            }
          ]
        })
      })
    );

    const result = await refreshBankOfIsraelDecisionPolymarketQueue(
      integration({ polymarketUrl: null }),
      new Date("2026-07-11T12:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as { polymarketMarkets?: Array<{ slug: string }> };

    expect(settings.polymarketMarkets?.map((market) => market.slug)).toEqual([
      "bank-of-israel-decision-in-august",
      "bank-of-israel-decision-in-september-20260710022159182"
    ]);
    expect(result.activeUrl).toBeNull();
  });
});
