import { describe, expect, it } from "vitest";
import {
  extractPumpGoStatusKey,
  formatPumpGoValue,
  isPumpGoHtmlFeaturePresent,
  parsePumpGoStats,
  parsePumpGoTaskList,
  pumpFunGoAdapter,
  shouldAlertOnPumpGoChange,
  type PumpGoSnapshot
} from "../src/integrations/pumpFunGo.js";

function buildSnapshot(overrides: Partial<PumpGoSnapshot> = {}): PumpGoSnapshot {
  return {
    statusKey: "available",
    statusLabel: "available",
    pageStatus: "HTTP 200",
    pageHasGoMarkers: true,
    statsStatus: "HTTP 200",
    tasksStatus: "HTTP 200",
    stats: {
      liveCount: 233,
      submissionCount: 1_723,
      unclaimedRewardTotalUsd: 224_491.72,
      paidOutTotalUsd: 611_091.54
    },
    tasks: {
      items: [
        {
          taskId: "task-1",
          title: "pour mustard on yourself",
          status: "PUBLISHED",
          publishedAt: "2026-06-29T06:46:44.151Z",
          expiresAt: "2026-06-30T06:46:44.151Z"
        }
      ]
    },
    checkedAt: new Date("2026-06-29T08:00:00.000Z"),
    ...overrides
  };
}

describe("Pump.fun GO adapter", () => {
  it("parses GO stats and task list responses", () => {
    expect(
      parsePumpGoStats({
        liveCount: 233,
        unclaimedRewardTotalUsd: 224491.725,
        submissionCount: 1723,
        paidOutTotalUsd: 611091.544
      })
    ).toEqual({
      liveCount: 233,
      unclaimedRewardTotalUsd: 224491.725,
      submissionCount: 1723,
      paidOutTotalUsd: 611091.544
    });

    expect(
      parsePumpGoTaskList({
        items: [{ taskId: "abc", title: "Create a viral bounty", status: "PUBLISHED", publishedAt: "2026-06-29T00:00:00Z" }]
      }).items[0]
    ).toMatchObject({
      taskId: "abc",
      title: "Create a viral bounty",
      status: "PUBLISHED",
      publishedAt: "2026-06-29T00:00:00Z"
    });
  });

  it("detects GO feature markers in the page HTML", () => {
    expect(isPumpGoHtmlFeaturePresent("<script>BOUNTY_DEVELOPER_PORTAL</script>")).toBe(true);
    expect(isPumpGoHtmlFeaturePresent('<a href="/go/bounties">Bounties</a>')).toBe(true);
    expect(isPumpGoHtmlFeaturePresent("<main>pump swap only</main>")).toBe(false);
  });

  it("formats a stable status key with live GO context", () => {
    const value = formatPumpGoValue(buildSnapshot());

    expect(extractPumpGoStatusKey(value)).toBe("available");
    expect(value).toContain("GO status: available");
    expect(value).toContain("Live bounties: 233");
    expect(value).toContain("Latest open bounty: pour mustard on yourself");
    expect(value).toContain("Market: https://predict.fun/market/will-pump-fun-disable-go-before-july-2026");
  });

  it("alerts only when the GO availability status changes", () => {
    const previous = formatPumpGoValue(buildSnapshot());
    const countOnlyChange = formatPumpGoValue(
      buildSnapshot({
        stats: {
          liveCount: 240,
          submissionCount: 1_800,
          unclaimedRewardTotalUsd: 230_000,
          paidOutTotalUsd: 612_000
        }
      })
    );
    const disabledChange = formatPumpGoValue(
      buildSnapshot({
        statusKey: "possibly-disabled",
        statusLabel: "possibly disabled - GO page is reachable but GO markers/API are missing",
        stats: null,
        tasks: null,
        statsStatus: "HTTP 404 - HTTP 404",
        tasksStatus: "HTTP 404 - HTTP 404",
        pageHasGoMarkers: false
      })
    );

    expect(shouldAlertOnPumpGoChange(previous, countOnlyChange)).toBe(false);
    expect(shouldAlertOnPumpGoChange(previous, disabledChange)).toBe(true);
  });

  it("uses one-minute polling and thirty-minute error suppression", () => {
    expect(pumpFunGoAdapter.getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(pumpFunGoAdapter.getErrorNoticeWindowMinutes?.({} as never)).toBe(30);
  });
});
