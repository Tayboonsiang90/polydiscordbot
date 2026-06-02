import { describe, expect, it } from "vitest";
import {
  extractSilverTrumpApprovalValue,
  getSilverTrumpApprovalPollIntervalMinutes,
  parseSilverApprovalRows,
  resolveSilverDatawrapperDatasetUrl,
  silverTrumpApprovalShouldAlertOnChange
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
