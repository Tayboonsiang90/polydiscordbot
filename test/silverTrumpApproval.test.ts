import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractSilverApprovalSingleTargetDate,
  extractSilverApprovalUpDownReferenceDates,
  extractSilverTrumpApprovalMultiMarketValue,
  extractSilverTrumpApprovalValue,
  getSilverTrumpApprovalPollIntervalMinutes,
  normalizeSilverApprovalSearchEvent,
  parseSilverApprovalRows,
  resolveSilverDatawrapperDatasetUrl,
  silverTrumpApprovalAdapter,
  silverTrumpApprovalShouldAlertOnChange,
  stabilizeSilverApprovalValue,
  type SilverApprovalMarketMetadata
} from "../src/integrations/silverTrumpApproval.js";
import type { Integration } from "../src/integrations/types.js";

const datasetUrl = "https://datawrapper.dwcdn.net/kSCt4/5965/dataset.csv";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
    expect(finalized).toContain("Tracked approval rows: Target 2026-06-05: 2026-06-05 = 38.6% approval, 57.4% disapproval");
  });

  it("resolves the latest Datawrapper dataset URL from redirect HTML", () => {
    expect(
      resolveSilverDatawrapperDatasetUrl(
        "<script>window.location.href='https://datawrapper.dwcdn.net/kSCt4/5965/'+window.location.search;</script>"
      )
    ).toBe(datasetUrl);
  });

  it("prefers the latest versioned Datawrapper dataset over the static CSV", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "<script>window.location.href='https://datawrapper.dwcdn.net/kSCt4/6710/'+window.location.search;</script>"
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => ["modeldate,approve,disapprove", "6/5/2026,39.6,57.0", "6/6/2026,39.7,56.9"].join("\n")
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await silverTrumpApprovalAdapter.fetchCurrentValue();

    expect(result.value).toContain("Chart data: https://datawrapper.dwcdn.net/kSCt4/6710/dataset.csv");
    expect(result.value).toContain("Approval: 39.6%");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not let stale fallback data overwrite a newer stored approval state", () => {
    const previous = [
      "Metric: Silver Bulletin Trump approval Up/Down",
      "Reference dates: 2026-07-10 vs 2026-07-17",
      "Status: tentative; waiting for a data point after 2026-07-17 to finalize",
      "Result: Tentative Down",
      "Latest available: 2026-07-17 = 39.6% approval, 57.0% disapproval"
    ].join("\n");
    const stale = [
      "Metric: Silver Bulletin Trump approval Up/Down",
      "Reference dates: 2026-07-10 vs 2026-07-17",
      "Status: pending; waiting for 2026-07-17 data or fallback deadline 2026-07-20T16:00:00.000Z",
      "Result: Pending",
      "Latest available: 2026-07-16 = 39.7% approval, 57.0% disapproval"
    ].join("\n");

    expect(stabilizeSilverApprovalValue(previous, stale)).toBe(previous);
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

  it("alerts when a tracked published approval row is revised", () => {
    const previous = [
      "Metric: Silver Bulletin Trump approval rating",
      "Target date: 2026-07-17",
      "Target status: finalized",
      "Approval: 40.1%",
      "Tracked approval rows: Target 2026-07-17: 2026-07-17 = 40.1% approval, 56.9% disapproval"
    ].join("\n");
    const current = previous
      .replace("Approval: 40.1%", "Approval: 40.2%")
      .replace("2026-07-17 = 40.1% approval", "2026-07-17 = 40.2% approval");

    expect(silverTrumpApprovalShouldAlertOnChange(previous, current)).toBe(true);
    expect(silverTrumpApprovalShouldAlertOnChange(current, current)).toBe(false);
  });

  it("does not alert once just because old stored values lack tracked rows", () => {
    const previous = [
      "Metric: Silver Bulletin Trump approval rating",
      "Target date: 2026-07-17",
      "Target status: finalized",
      "Approval: 40.1%"
    ].join("\n");
    const current = [
      previous,
      "Tracked approval rows: Target 2026-07-17: 2026-07-17 = 40.1% approval, 56.9% disapproval"
    ].join("\n");

    expect(silverTrumpApprovalShouldAlertOnChange(previous, current)).toBe(false);
  });

  it("does not alert just because a newly discovered pending market adds tracked row labels", () => {
    const previous = [
      "Metric: Silver Bulletin Trump approval Up/Down",
      "Reference dates: 2026-07-10 vs 2026-07-17",
      "Status: tentative; waiting for a data point after 2026-07-17 to finalize",
      "Result: Tentative Down",
      "Tracked approval rows: First 2026-07-10: 2026-07-10 = 39.7% approval, 57.0% disapproval | Second 2026-07-17: 2026-07-17 = 39.6% approval, 57.0% disapproval"
    ].join("\n");
    const current = [
      "Metric: Silver Bulletin Trump approval markets",
      "Active markets: 2",
      "",
      "Tracked market 1: Trump approval Up or Down this week?",
      previous,
      "",
      "Tracked market 2: Trump approval Up or Down this week?",
      "Metric: Silver Bulletin Trump approval Up/Down",
      "Reference dates: 2026-07-17 vs 2026-07-24",
      "Status: pending; waiting for 2026-07-24 data or fallback deadline 2026-07-27T16:00:00.000Z",
      "Result: Pending",
      "Tracked approval rows: First 2026-07-17: 2026-07-17 = 39.6% approval, 57.0% disapproval | Second 2026-07-24: not published yet"
    ].join("\n");

    expect(silverTrumpApprovalShouldAlertOnChange(previous, current)).toBe(false);
  });

  it("does not alert when the same Up/Down state moves into a multi-market container", () => {
    const previous = [
      "Metric: Silver Bulletin Trump approval Up/Down",
      "Reference dates: 2026-07-10 vs 2026-07-17",
      "Status: tentative; waiting for a data point after 2026-07-17 to finalize",
      "Result: Tentative Down"
    ].join("\n");
    const current = [
      "Metric: Silver Bulletin Trump approval markets",
      "Active markets: 1",
      "",
      "Tracked market 1: Trump approval Up or Down this week?",
      previous
    ].join("\n");

    expect(silverTrumpApprovalShouldAlertOnChange(previous, current)).toBe(false);
  });

  it("alerts when an Up/Down market first has a tentative result", () => {
    const pending = [
      "Metric: Silver Bulletin Trump approval Up/Down",
      "Reference dates: 2026-06-19 vs 2026-06-26",
      "Status: pending; waiting for 2026-06-26 data",
      "Result: Pending"
    ].join("\n");
    const tentative = [
      "Metric: Silver Bulletin Trump approval Up/Down",
      "Reference dates: 2026-06-19 vs 2026-06-26",
      "Status: tentative; waiting for a data point after 2026-06-26 to finalize",
      "Result: Tentative Up"
    ].join("\n");

    expect(silverTrumpApprovalShouldAlertOnChange(pending, tentative)).toBe(true);
    expect(silverTrumpApprovalShouldAlertOnChange(tentative, tentative)).toBe(false);
  });

  it("alerts when an Up/Down tentative result finalizes", () => {
    const tentative = [
      "Metric: Silver Bulletin Trump approval Up/Down",
      "Reference dates: 2026-06-19 vs 2026-06-26",
      "Status: tentative; waiting for a data point after 2026-06-26 to finalize",
      "Result: Tentative Up"
    ].join("\n");
    const finalized = [
      "Metric: Silver Bulletin Trump approval Up/Down",
      "Reference dates: 2026-06-19 vs 2026-06-26",
      "Status: finalized",
      "Result: Final Up"
    ].join("\n");

    expect(silverTrumpApprovalShouldAlertOnChange(tentative, finalized)).toBe(true);
  });

  it("alerts for a new Up/Down reference window even when the direction matches", () => {
    const previousFinal = [
      "Metric: Silver Bulletin Trump approval Up/Down",
      "Reference dates: 2026-06-12 vs 2026-06-19",
      "Status: finalized",
      "Result: Final Up"
    ].join("\n");
    const currentTentative = [
      "Metric: Silver Bulletin Trump approval Up/Down",
      "Reference dates: 2026-06-19 vs 2026-06-26",
      "Status: tentative; waiting for a data point after 2026-06-26 to finalize",
      "Result: Tentative Up"
    ].join("\n");

    expect(silverTrumpApprovalShouldAlertOnChange(previousFinal, currentTentative)).toBe(true);
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

  it("extracts a single-date approval target from Polymarket rules", () => {
    expect(
      extractSilverApprovalSingleTargetDate(
        "This market will resolve according to Silver Bulletin's approval rating for Donald Trump on July 17, 2026."
      )
    ).toBe("2026-07-17");
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

  it("normalizes active single-date approval markets from Gamma search", () => {
    expect(
      normalizeSilverApprovalSearchEvent(
        {
          slug: "trump-approval-rating-on-july-17-20260710154118611",
          title: "Trump approval rating on July 17?",
          description:
            "This market will resolve according to Silver Bulletin's approval rating for Donald Trump on July 17, 2026.",
          active: true,
          closed: false,
          archived: false,
          startDate: "2026-07-10T22:36:49.523932Z"
        },
        new Date("2026-07-11T00:00:00.000Z")
      )
    ).toMatchObject({
      slug: "trump-approval-rating-on-july-17-20260710154118611",
      url: "https://polymarket.com/event/trump-approval-rating-on-july-17-20260710154118611",
      kind: "single-date",
      targetDate: "2026-07-17",
      endAt: "2026-07-22T16:00:00.000Z"
    });
  });

  it("checks the configured single-date approval market target instead of the old default", () => {
    const value = extractSilverTrumpApprovalValue(
      [
        "modeldate,approve,disapprove",
        "6/5/2026,38.567,57.4",
        "7/17/2026,40.123,56.9",
        "7/18/2026,40.2,56.8"
      ].join("\n"),
      datasetUrl,
      buildSingleDateMarket("2026-07-17")
    );

    expect(value).toContain("Target date: 2026-07-17");
    expect(value).toContain("Approval: 40.1%");
    expect(value).toContain("Finalized by next data point: 2026-07-18");
  });

  it("checks overlapping single-date and Up/Down markets together", () => {
    const value = extractSilverTrumpApprovalMultiMarketValue(
      [
        "modeldate,approve,disapprove",
        "7/10/2026,39.6,56.6",
        "7/17/2026,40.123,56.9",
        "7/18/2026,40.2,56.8"
      ].join("\n"),
      datasetUrl,
      [buildUpDownMarket("2026-07-10", "2026-07-17"), buildSingleDateMarket("2026-07-17")],
      new Date("2026-07-18T20:00:00.000Z")
    );

    expect(value).toContain("Active markets: 2");
    expect(value).toContain("Reference dates: 2026-07-10 vs 2026-07-17");
    expect(value).toContain("Result: Final Up");
    expect(value).toContain("Tracked approval rows: First 2026-07-10: 2026-07-10 = 39.6% approval, 56.6% disapproval | Second 2026-07-17: 2026-07-17 = 40.1% approval, 56.9% disapproval");
    expect(value).toContain("Target date: 2026-07-17");
    expect(value).toContain("Approval: 40.1%");
  });

  it("alerts for new actionable states inside overlapping market output", () => {
    const pending = [
      "Metric: Silver Bulletin Trump approval markets",
      "Active markets: 2",
      "",
      "Tracked market 1: Trump approval Up or Down this week?",
      "Metric: Silver Bulletin Trump approval Up/Down",
      "Reference dates: 2026-07-10 vs 2026-07-17",
      "Status: pending; waiting for 2026-07-17 data or fallback deadline 2026-07-20T16:00:00.000Z",
      "Result: Pending",
      "",
      "Tracked market 2: Trump approval rating on July 17?",
      "Metric: Silver Bulletin Trump approval rating",
      "Target date: 2026-07-17",
      "Target status: not published yet",
      "Approval: not published yet"
    ].join("\n");
    const actionable = pending
      .replace("Status: pending; waiting for 2026-07-17 data or fallback deadline 2026-07-20T16:00:00.000Z", "Status: finalized")
      .replace("Result: Pending", "Result: Final Up")
      .replace("Target status: not published yet", "Target status: finalized")
      .replace("Approval: not published yet", "Approval: 40.1%");

    expect(silverTrumpApprovalShouldAlertOnChange(pending, actionable)).toBe(true);
    expect(silverTrumpApprovalShouldAlertOnChange(actionable, actionable)).toBe(false);
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

function buildSingleDateMarket(targetDate: string): SilverApprovalMarketMetadata {
  return {
    slug: "trump-approval-rating-on-july-17-20260710154118611",
    url: "https://polymarket.com/event/trump-approval-rating-on-july-17-20260710154118611",
    kind: "single-date",
    title: "Trump approval rating on July 17?",
    targetDate,
    startAt: "2026-07-10T22:36:49.523Z",
    endAt: "2026-07-22T16:00:00.000Z",
    addedAt: "2026-07-10T22:36:49.523Z"
  };
}
