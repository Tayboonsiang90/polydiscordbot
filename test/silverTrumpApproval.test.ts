import { describe, expect, it } from "vitest";
import {
  extractSilverApprovalUpDownReferenceDates,
  extractSilverTrumpApprovalValue,
  getSilverTrumpApprovalPollIntervalMinutes,
  normalizeSilverApprovalSearchEvent,
  parseSilverApprovalRows,
  resolveSilverDatawrapperDatasetUrl,
  silverTrumpApprovalShouldAlertOnChange,
  type SilverApprovalMarketMetadata
} from "../src/integrations/silverTrumpApproval.js";
import type { Integration } from "../src/integrations/types.js";

const datasetUrl = "https://datawrapper.dwcdn.net/kSCt4/5965/dataset.csv";

describe("Silver Bulletin Trump approval adapter", () => {
  it("parses approval trend-line CSV rows", () => {
    expect(
      parseSilverApprovalRows(
        [
          "modeldate,approve,disapprove,approve_lo,approve_hi",
          "6/4/2026,38.234,57.8,33,43",
          "6/5/2026,38.567,57.4,33,43"
        ].join("\n")
      )
    ).toEqual([
      { date: "2026-06-04", approve: 38.234, disapprove: 57.8 },
      { date: "2026-06-05", approve: 38.567, disapprove: 57.4 }
    ]);
  });

  it("waits for the next data point before treating the target date as finalized", () => {
    const waiting = extractSilverTrumpApprovalValue(
      ["modeldate,approve,disapprove", "6/5/2026,38.567,57.4"].join("\n"),
      datasetUrl
    );
    const finalized = extractSilverTrumpApprovalValue(
      ["modeldate,approve,disapprove", "6/5/2026,38.567,57.4", "6/6/2026,38.7,57.2"].join("\n"),
      datasetUrl
    );

    expect(waiting).toContain("Target status: published; waiting for next data point to finalize");
    expect(finalized).toContain("Target status: finalized");
    expect(finalized).toContain("Approval: 38.6%");
    expect(finalized).toContain("Finalized by next data point: 2026-06-06");
  });

  it("resolves the latest Datawrapper dataset URL from redirect HTML", () => {
    expect(
      resolveSilverDatawrapperDatasetUrl(
        "<script>window.location.href='https://datawrapper.dwcdn.net/kSCt4/5965/'+window.location.search;</script>"
      )
    ).toBe(datasetUrl);
  });

  it("polls daily before target date, per minute during finalization watch, then daily after finalized", () => {
    expect(getSilverTrumpApprovalPollIntervalMinutes(buildIntegration(), new Date("2026-06-04T16:00:00.000Z"))).toBe(1_440);
    expect(getSilverTrumpApprovalPollIntervalMinutes(buildIntegration(), new Date("2026-06-05T16:00:00.000Z"))).toBe(1);
    expect(
      getSilverTrumpApprovalPollIntervalMinutes(buildIntegration("Target status: finalized"), new Date("2026-06-06T16:00:00.000Z"))
    ).toBe(1_440);
  });

  it("alerts only when the target date becomes finalized", () => {
    const waiting = "Target status: published; waiting for next data point to finalize";
    const finalized = "Target status: finalized\nApproval: 38.6%";

    expect(silverTrumpApprovalShouldAlertOnChange(waiting, finalized)).toBe(true);
    expect(silverTrumpApprovalShouldAlertOnChange(waiting, waiting)).toBe(false);
  });

  it("extracts Up/Down reference dates from Polymarket rules", () => {
    expect(
      extractSilverApprovalUpDownReferenceDates(
        [
          'This market will resolve to "Up" if Donald Trump\'s Silver Bulletin approval rating is higher on June 12, 2026, than on June 5, 2026.',
          'This market will resolve to "Down" if Donald Trump\'s Silver Bulletin approval rating is higher on June 5, 2026, than on June 12, 2026.'
        ].join("\n\n")
      )
    ).toEqual({ firstDate: "2026-06-05", secondDate: "2026-06-12" });
  });

  it("normalizes active Up/Down markets from Gamma search", () => {
    expect(
      normalizeSilverApprovalSearchEvent(
        {
          slug: "trump-approval-up-or-down-this-week-741",
          title: "Trump approval Up or Down this week?",
          description:
            'This market will resolve to "Up" if Donald Trump\'s Silver Bulletin approval rating is higher on June 12, 2026, than on June 5, 2026.',
          active: true,
          closed: false,
          archived: false,
          startDate: "2026-06-05T19:56:28.556228Z"
        },
        new Date("2026-06-06T00:00:00.000Z")
      )
    ).toMatchObject({
      slug: "trump-approval-up-or-down-this-week-741",
      url: "https://polymarket.com/event/trump-approval-up-or-down-this-week-741",
      kind: "up-down",
      firstDate: "2026-06-05",
      secondDate: "2026-06-12",
      endAt: "2026-06-15T16:00:00.000Z"
    });
  });

  it("returns a tentative Up result until the second reference date is finalized", () => {
    const value = extractSilverTrumpApprovalValue(
      [
        "modeldate,approve,disapprove",
        "5/29/2026,38.47689,57.855",
        "6/5/2026,38.98804,57.45648"
      ].join("\n"),
      datasetUrl,
      buildUpDownMarket("2026-05-29", "2026-06-05"),
      new Date("2026-06-06T14:00:00.000Z")
    );

    expect(value).toContain("Status: tentative; waiting for a data point after 2026-06-05 to finalize");
    expect(value).toContain("Result: Tentative Up");
    expect(value).toContain("Comparison: 38.5% vs 39.0% after one-decimal rounding");
  });

  it("returns a final Up result once a later data point finalizes the second reference date", () => {
    const value = extractSilverTrumpApprovalValue(
      [
        "modeldate,approve,disapprove",
        "5/29/2026,38.47689,57.855",
        "6/5/2026,38.98804,57.45648",
        "6/6/2026,39.1,57.0"
      ].join("\n"),
      datasetUrl,
      buildUpDownMarket("2026-05-29", "2026-06-05"),
      new Date("2026-06-06T20:00:00.000Z")
    );

    expect(value).toContain("Status: finalized");
    expect(value).toContain("Result: Final Up");
  });

  it("uses the most recent prior day when the first reference date is missing", () => {
    const value = extractSilverTrumpApprovalValue(
      [
        "modeldate,approve,disapprove",
        "5/28/2026,38.3,57.9",
        "6/5/2026,38.98804,57.45648",
        "6/6/2026,39.1,57.0"
      ].join("\n"),
      datasetUrl,
      buildUpDownMarket("2026-05-29", "2026-06-05"),
      new Date("2026-06-06T20:00:00.000Z")
    );

    expect(value).toContain("First reference: 2026-05-28 = 38.3% approval (fallback for missing 2026-05-29)");
    expect(value).toContain("Result: Final Up");
  });
});

function buildIntegration(lastValue: string | null = null): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "silver-trump-approval",
    displayName: "Silver Trump Approval",
    sourceUrl: "https://www.natesilver.net/p/trump-approval-ratings-nate-silver-bulletin",
    polymarketUrl: "https://polymarket.com/event/trump-approval-rating-on-june-5",
    alertRoleId: null,
    roleMessageId: null,
    roleChannelId: null,
    roleEmoji: null,
    settingsJson: null,
    pollIntervalMinutes: 5,
    status: "active",
    lastValue,
    lastCheckedAt: null,
    lastChangedAt: null,
    snapshotValue: null,
    snapshotCheckedAt: null,
    snapshotDate: null,
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z"
  };
}

function buildUpDownMarket(firstDate: string, secondDate: string): SilverApprovalMarketMetadata {
  return {
    slug: "trump-approval-up-or-down-this-week-741",
    url: "https://polymarket.com/event/trump-approval-up-or-down-this-week-741",
    kind: "up-down",
    title: "Trump approval Up or Down this week?",
    firstDate,
    secondDate,
    startAt: "2026-06-05T19:56:28.556Z",
    endAt: "2026-06-08T16:00:00.000Z",
    addedAt: "2026-06-05T19:56:28.556Z"
  };
}
