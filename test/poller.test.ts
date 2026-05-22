import { describe, expect, it } from "vitest";
import {
  getDueSnapshotDate,
  getEffectivePollIntervalMinutes,
  getErrorNoticeDecision,
  getPollIntervalReason,
  formatSchedulerNetworkError,
  hasValueChanged,
  selectNewEventPosts
} from "../src/poller.js";
import type { EventMonitorPost, Integration, WebsiteAdapter } from "../src/integrations/types.js";

const snapshotIntegration: Integration = {
  id: 1,
  guildId: "guild",
  channelId: "channel",
  adapterId: "free-app-store",
  displayName: "Free App Store Top 2",
  sourceUrl: "https://apps.apple.com/us/charts/iphone",
  polymarketUrl: null,
  alertRoleId: null,
  roleMessageId: null,
  roleChannelId: null,
  roleEmoji: null,
  settingsJson: null,
  pollIntervalMinutes: 5,
  status: "active",
  lastValue: null,
  lastCheckedAt: null,
  lastChangedAt: null,
  snapshotValue: null,
  snapshotCheckedAt: null,
  snapshotDate: null,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z"
};

const snapshotAdapter: WebsiteAdapter = {
  id: "free-app-store",
  commandName: "freeappstore",
  displayName: "Free App Store Top 2",
  sourceUrl: "https://apps.apple.com/us/charts/iphone",
  defaultChannelName: "freeappstore",
  alertRoleName: "Free App Store Alerts",
  alertRoleEmoji: "\uD83C\uDD93",
  dailySnapshot: {
    timeZone: "America/New_York",
    hour: 12,
    minute: 0,
    windowMinutes: 5,
    label: "12:00 PM ET snapshot"
  },
  async fetchCurrentValue() {
    return { value: "1. Test", rawValue: "1. Test", observedAt: new Date() };
  }
};

describe("hasValueChanged", () => {
  it("does not alert on first observation", () => {
    expect(hasValueChanged(null, "612500")).toBe(false);
  });

  it("does not alert when value is unchanged", () => {
    expect(hasValueChanged("612500", "612500")).toBe(false);
  });

  it("alerts when value changes", () => {
    expect(hasValueChanged("612500", "612900")).toBe(true);
  });
});

describe("getErrorNoticeDecision", () => {
  it("uses a 30-minute default repeat window", () => {
    const first = getErrorNoticeDecision(undefined, "timeout", 1_000);
    const second = getErrorNoticeDecision(first.nextState, "timeout", 29 * 60_000);
    const third = getErrorNoticeDecision(second.nextState, "timeout", 31 * 60_000);

    expect(second.shouldSend).toBe(false);
    expect(third.shouldSend).toBe(true);
    expect(third.message).toContain("previous 30 minute(s)");
  });

  it("suppresses identical errors inside the repeat window", () => {
    const first = getErrorNoticeDecision(undefined, "timeout", 1_000, 60_000);
    expect(first.shouldSend).toBe(true);

    const second = getErrorNoticeDecision(first.nextState, "timeout", 30_000, 60_000);
    expect(second.shouldSend).toBe(false);
    expect(second.nextState.suppressedCount).toBe(1);

    const third = getErrorNoticeDecision(second.nextState, "timeout", 70_000, 60_000);
    expect(third.shouldSend).toBe(true);
    expect(third.message).toContain("Suppressed 1 repeated error");
    expect(third.nextState.suppressedCount).toBe(0);
  });

  it("sends immediately when the error changes", () => {
    const first = getErrorNoticeDecision(undefined, "timeout", 1_000, 60_000);
    const second = getErrorNoticeDecision(first.nextState, "HTTP 503", 30_000, 60_000);

    expect(second.shouldSend).toBe(true);
    expect(second.message).toBe("HTTP 503");
    expect(second.nextState.signature).toBe("HTTP 503");
  });
});

describe("formatSchedulerNetworkError", () => {
  it("formats transient Discord DNS failures without a full stack", () => {
    const error = Object.assign(new Error("getaddrinfo EAI_AGAIN discord.com"), {
      code: "EAI_AGAIN",
      hostname: "discord.com"
    });

    expect(formatSchedulerNetworkError(error)).toBe(
      "Discord/network send failed (EAI_AGAIN): getaddrinfo EAI_AGAIN discord.com. This is usually Pi DNS/VPN/router access to Discord; scheduler will retry."
    );
  });
});

describe("selectNewEventPosts", () => {
  it("detects archive backfilled posts below the latest seen post", () => {
    const posts = [
      buildEventPost("newest"),
      buildEventPost("already-seen"),
      buildEventPost("backfilled"),
      buildEventPost("older-seen")
    ];

    const result = selectNewEventPosts(
      posts,
      "newest",
      JSON.stringify({ eventSeenPostIds: ["newest", "already-seen", "older-seen"] })
    );

    expect(result.newPosts.map((post) => post.id)).toEqual(["backfilled"]);
    expect(result.nextSeenPostIds.slice(0, 4)).toEqual(["newest", "already-seen", "backfilled", "older-seen"]);
  });

  it("keeps the lastValue boundary behavior before a seen-id set exists", () => {
    const posts = [buildEventPost("newest"), buildEventPost("middle"), buildEventPost("last-seen"), buildEventPost("older")];
    const result = selectNewEventPosts(posts, "last-seen", null);

    expect(result.newPosts.map((post) => post.id)).toEqual(["middle", "newest"]);
  });

  it("seeds seen ids without alerting on the first event check", () => {
    const posts = [buildEventPost("newest"), buildEventPost("older")];
    const result = selectNewEventPosts(posts, null, null);

    expect(result.newPosts).toEqual([]);
    expect(result.nextSeenPostIds).toEqual(["newest", "older"]);
  });
});

describe("getDueSnapshotDate", () => {
  it("returns the ET date inside the noon snapshot window", () => {
    expect(getDueSnapshotDate(snapshotIntegration, snapshotAdapter, new Date("2026-05-08T16:02:00.000Z"))).toBe(
      "2026-05-08"
    );
  });

  it("does not return a date after the snapshot window", () => {
    expect(getDueSnapshotDate(snapshotIntegration, snapshotAdapter, new Date("2026-05-08T16:06:00.000Z"))).toBeNull();
  });

  it("does not return a date already captured that ET day", () => {
    expect(
      getDueSnapshotDate(
        { ...snapshotIntegration, snapshotDate: "2026-05-08" },
        snapshotAdapter,
        new Date("2026-05-08T16:02:00.000Z")
      )
    ).toBeNull();
  });
});

function buildEventPost(id: string): EventMonitorPost {
  return {
    id,
    type: "Truth",
    text: id,
    qualifyingText: id,
    postedAt: new Date("2026-05-12T00:00:00.000Z"),
    url: `https://truthsocial.com/@realDonaldTrump/${id}`,
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

describe("getEffectivePollIntervalMinutes", () => {
  it("uses adapter-defined dynamic polling when present", () => {
    expect(
      getEffectivePollIntervalMinutes(
        { ...snapshotIntegration, adapterId: "eia-crude-spr", pollIntervalMinutes: 5 },
        new Date("2026-05-12T16:00:00.000Z")
      )
    ).toBe(1);
  });

  it("describes adapter-defined dynamic polling", () => {
    expect(
      getPollIntervalReason(
        { ...snapshotIntegration, adapterId: "eia-crude-spr", pollIntervalMinutes: 5 },
        new Date("2026-05-12T16:00:00.000Z")
      )
    ).toBe("EIA release watch: Tuesday/Wednesday ET");
  });
});

