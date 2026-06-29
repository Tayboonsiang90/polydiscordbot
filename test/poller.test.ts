import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BotDatabase } from "../src/database.js";
import {
  activateQueuedPolymarket,
  clearLatestErrorNoticeState,
  captureDailySnapshot,
  formatErrorNoticeDiscordMessage,
  getDueSnapshotDate,
  getEffectivePollIntervalMs,
  getEffectivePollIntervalMinutes,
  getErrorNoticeDecision,
  getErrorNoticeSignature,
  getLatestErrorNoticeState,
  getLatestErrorMessageId,
  getPollIntervalReason,
  formatSchedulerNetworkError,
  hasValueChanged,
  PollScheduler,
  shouldRecordValueChange,
  setLatestErrorNoticeState,
  setLatestErrorMessageId,
  selectNewEventPosts
} from "../src/poller.js";
import type { EventMonitorPost, Integration, WebsiteAdapter } from "../src/integrations/types.js";

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
  vi.unstubAllGlobals();
});

function createTestDatabase(): BotDatabase {
  tempDir = mkdtempSync(join(tmpdir(), "polybot-poller-"));
  return new BotDatabase(join(tempDir, "bot.sqlite"));
}

const snapshotIntegration: Integration = {
  id: 1,
  guildId: "guild",
  channelId: "channel",
  adapterId: "free-app-store",
  displayName: "Free App Store Top 5",
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
  displayName: "Free App Store Top 5",
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

describe("market rollover", () => {
  it("suppresses normal value-change alerts during market rollover", () => {
    expect(
      shouldRecordValueChange("Window: 2026-06-08 to 2026-06-14", "Window: 2026-06-15 to 2026-06-21", {
        previousPolymarketUrl: "https://polymarket.com/event/how-many-ships-transit-the-strait-of-hormuz-week-of-june-8",
        currentPolymarketUrl: "https://polymarket.com/event/how-many-ships-transit-the-strait-of-hormuz-week-of-june-15"
      })
    ).toBe(false);
  });

  it("reports a rollover when the active queued Polymarket URL changes", () => {
    const database = createTestDatabase();
    const previousUrl = "https://polymarket.com/event/how-many-ships-transit-the-strait-of-hormuz-week-of-june-8";
    const currentUrl = "https://polymarket.com/event/how-many-ships-transit-the-strait-of-hormuz-week-of-june-15";
    const integration = database.createIntegration({
      guildId: "guild",
      channelId: "hormuzships",
      adapterId: "portwatch-hormuz-ships",
      displayName: "IMF Portwatch Hormuz Ships",
      sourceUrl: "https://portwatch.imf.org/pages/cb5856222a5b4105adc6ee7e880a1730",
      polymarketUrl: previousUrl,
      settingsJson: JSON.stringify({
        polymarketMarkets: [
          {
            url: previousUrl,
            slug: "how-many-ships-transit-the-strait-of-hormuz-week-of-june-8",
            startAt: "2026-06-08T04:00:00.000Z",
            endAt: "2026-06-15T03:59:00.000Z",
            addedAt: "2026-06-08T04:00:00.000Z"
          },
          {
            url: currentUrl,
            slug: "how-many-ships-transit-the-strait-of-hormuz-week-of-june-15",
            startAt: "2026-06-15T04:00:00.000Z",
            endAt: "2026-06-22T03:59:00.000Z",
            addedAt: "2026-06-12T04:00:00.000Z"
          }
        ]
      }),
      pollIntervalMinutes: 1
    });

    const result = activateQueuedPolymarket(database, integration, new Date("2026-06-15T04:01:00.000Z"));

    expect(result.rollover).toEqual({ previousPolymarketUrl: previousUrl, currentPolymarketUrl: currentUrl });
    expect(result.integration.polymarketUrl).toBe(currentUrl);
    expect(database.getIntegrationById(integration.id).polymarketUrl).toBe(currentUrl);
    database.close();
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

  it("suppresses transient errors with different fetch wording when the signature matches", () => {
    const first = getErrorNoticeDecision(
      undefined,
      "Request failed for https://fred.stlouisfed.org/graph/fredgraph.csv?id=APU0000703112: The operation was aborted due to timeout",
      1_000,
      6 * 60 * 60_000,
      "transient-network-error"
    );
    const second = getErrorNoticeDecision(
      first.nextState,
      "The operation was aborted.",
      60 * 60_000,
      6 * 60 * 60_000,
      "transient-network-error"
    );

    expect(second.shouldSend).toBe(false);
    expect(second.nextState.suppressedCount).toBe(1);
  });
});

describe("getErrorNoticeSignature", () => {
  it("normalizes aborted fetch errors as transient network errors", () => {
    expect(getErrorNoticeSignature(new Error("The operation was aborted."))).toBe("transient-network-error");
  });

  it("normalizes refused connections as transient network errors", () => {
    expect(getErrorNoticeSignature(Object.assign(new Error("connect ECONNREFUSED 129.164.141.233:443"), { code: "ECONNREFUSED" }))).toBe(
      "transient-network-error"
    );
  });
});

describe("latest error message settings", () => {
  it("stores the latest Discord error message id without removing adapter settings", () => {
    const settingsJson = setLatestErrorMessageId(JSON.stringify({ period: { year: 2026, month: 5 } }), "message-2");

    expect(getLatestErrorMessageId(settingsJson)).toBe("message-2");
    expect(JSON.parse(settingsJson)).toMatchObject({
      period: { year: 2026, month: 5 },
      latestErrorMessageId: "message-2"
    });
  });

  it("stores and clears repeated error notice state without removing adapter settings", () => {
    const state = { signature: "transient-network-error", sentAtMs: Date.parse("2026-05-29T03:06:27.000Z"), suppressedCount: 2 };
    const settingsJson = setLatestErrorNoticeState(JSON.stringify({ period: { year: 2026, month: 5 } }), state);

    expect(getLatestErrorNoticeState(settingsJson)).toEqual(state);
    expect(JSON.parse(settingsJson)).toMatchObject({
      period: { year: 2026, month: 5 },
      latestErrorNoticeState: {
        signature: "transient-network-error",
        sentAt: "2026-05-29T03:06:27.000Z",
        suppressedCount: 2
      }
    });

    expect(JSON.parse(clearLatestErrorNoticeState(settingsJson) ?? "{}")).toEqual({ period: { year: 2026, month: 5 } });
  });
});

describe("check failed Discord message delivery", () => {
  it("formats suppressed updates for an existing check-failed post", () => {
    const message = formatErrorNoticeDiscordMessage("The operation was aborted.", {
      shouldSend: false,
      message: "The operation was aborted.",
      nextState: { signature: "transient-network-error", sentAtMs: Date.now(), suppressedCount: 3 }
    });

    expect(message).toContain("The operation was aborted.");
    expect(message).toContain("Repeated failure update: 3 repeated error(s)");
  });

  it("edits the tracked check-failed post instead of sending another one", async () => {
    const database = createTestDatabase();
    const settingsJson = setLatestErrorNoticeState(setLatestErrorMessageId(null, "message-1"), {
      signature: "transient-network-error",
      sentAtMs: Date.now(),
      suppressedCount: 0
    });
    const integration = database.createIntegration({
      guildId: "guild",
      channelId: "eggs-channel",
      adapterId: "fred-egg-price",
      displayName: "FRED Egg Price",
      sourceUrl: "https://fred.stlouisfed.org/series/APU0000708111",
      polymarketUrl: "https://polymarket.com/event/price-of-dozen-eggs-in-april-799",
      settingsJson,
      pollIntervalMinutes: 60
    });
    const edit = vi.fn().mockResolvedValue({});
    const send = vi.fn().mockResolvedValue({ id: "message-2" });
    const fetch = vi.fn().mockResolvedValue({ edit });
    const scheduler = new PollScheduler(
      { channels: { fetch: vi.fn().mockResolvedValue({ send, messages: { fetch } }) } } as never,
      database
    ) as unknown as {
      sendErrorIfDue(channelId: string, integration: Integration, error: unknown): Promise<void>;
    };

    await scheduler.sendErrorIfDue("eggs-channel", integration, new Error("The operation was aborted."));

    expect(fetch).toHaveBeenCalledWith("message-1");
    expect(edit).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    database.close();
  });

  it("sends new check-failed posts to the shared error log channel when available", async () => {
    const database = createTestDatabase();
    const integration = database.createIntegration({
      guildId: "guild",
      channelId: "eggs-channel",
      adapterId: "fred-egg-price",
      displayName: "FRED Egg Price",
      sourceUrl: "https://fred.stlouisfed.org/series/APU0000708111",
      polymarketUrl: "https://polymarket.com/event/price-of-dozen-eggs-in-april-799",
      settingsJson: null,
      pollIntervalMinutes: 60
    });
    const integrationSend = vi.fn().mockResolvedValue({ id: "integration-error-message" });
    const errorLogSend = vi.fn().mockResolvedValue({ id: "error-log-message" });
    const errorLogChannel = { id: "errorlogs-channel", name: "errorlogs", send: errorLogSend };
    const integrationChannel = {
      id: "eggs-channel",
      name: "eggs",
      send: integrationSend,
      guild: {
        channels: {
          cache: new Map([["errorlogs-channel", errorLogChannel]])
        }
      }
    };
    const scheduler = new PollScheduler(
      { channels: { fetch: vi.fn().mockResolvedValue(integrationChannel) } } as never,
      database
    ) as unknown as {
      sendErrorIfDue(channelId: string, integration: Integration, error: unknown): Promise<void>;
    };

    await scheduler.sendErrorIfDue("eggs-channel", integration, new Error("The operation was aborted."));

    expect(errorLogSend).toHaveBeenCalledTimes(1);
    expect(integrationSend).not.toHaveBeenCalled();
    expect(getLatestErrorMessageId(database.getIntegrationById(integration.id).settingsJson)).toBe("error-log-message");
    database.close();
  });

  it("deletes older check-failed posts after updating the tracked one", async () => {
    const database = createTestDatabase();
    const settingsJson = setLatestErrorNoticeState(setLatestErrorMessageId(null, "message-1"), {
      signature: "transient-network-error",
      sentAtMs: Date.now(),
      suppressedCount: 0
    });
    const integration = database.createIntegration({
      guildId: "guild",
      channelId: "eggs-channel",
      adapterId: "fred-egg-price",
      displayName: "FRED Egg Price",
      sourceUrl: "https://fred.stlouisfed.org/series/APU0000708111",
      polymarketUrl: "https://polymarket.com/event/price-of-dozen-eggs-in-april-799",
      settingsJson,
      pollIntervalMinutes: 60
    });
    const edit = vi.fn().mockResolvedValue({});
    const staleDelete = vi.fn().mockResolvedValue({});
    const otherDelete = vi.fn().mockResolvedValue({});
    const messagesPage = {
      values: () =>
        [
          { id: "message-1", embeds: [{ title: "FRED Egg Price - Check failed" }], delete: vi.fn() },
          { id: "message-old", embeds: [{ title: "FRED Egg Price - Check failed" }], delete: staleDelete },
          { id: "message-other", embeds: [{ title: "Bonbast USD/IRR - Check failed" }], delete: otherDelete }
        ].values()
    };
    const fetch = vi.fn().mockImplementation(async (input: unknown) => (typeof input === "string" ? { edit } : messagesPage));
    const scheduler = new PollScheduler(
      { channels: { fetch: vi.fn().mockResolvedValue({ send: vi.fn(), messages: { fetch } }) } } as never,
      database
    ) as unknown as {
      sendErrorIfDue(channelId: string, integration: Integration, error: unknown): Promise<void>;
    };

    await scheduler.sendErrorIfDue("eggs-channel", integration, new Error("The operation was aborted."));

    expect(edit).toHaveBeenCalledTimes(1);
    expect(staleDelete).toHaveBeenCalledTimes(1);
    expect(otherDelete).not.toHaveBeenCalled();
    database.close();
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

describe("captureDailySnapshot", () => {
  it("stores the top 5 snapshot but alerts only when the top 2 change", async () => {
    const database = createTestDatabase();
    const integration = database.createIntegration({
      guildId: "guild",
      channelId: "freeappstore",
      adapterId: "free-app-store",
      displayName: "Free App Store Top 5",
      sourceUrl: "https://apps.apple.com/us/charts/iphone",
      polymarketUrl: "https://polymarket.com/event/1-free-app-in-the-us-apple-app-store-on-may-8",
      pollIntervalMinutes: 5
    });
    const previousSnapshot = ["1. App 1", "2. App 2", "3. App 3", "4. App 4", "5. App 5"].join("\n");
    const currentSnapshot = ["1. App 1", "2. App 2", "3. New App 3", "4. App 4", "5. App 5"].join("\n");
    database.recordSnapshot(integration.id, previousSnapshot, new Date("2026-05-08T16:00:00.000Z"), "2026-05-08");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          feed: {
            results: ["App 1", "App 2", "New App 3", "App 4", "App 5"].map((name) => ({ name }))
          }
        })
      })
    );

    const result = await captureDailySnapshot(database, database.getIntegrationById(integration.id), "2026-05-09");
    const stored = database.getIntegrationById(integration.id);

    expect(result.shouldAlert).toBe(false);
    expect(result.snapshotValue).toBe(currentSnapshot);
    expect(stored.snapshotDate).toBe("2026-05-09");
    expect(stored.snapshotValue).toBe(currentSnapshot);
    database.close();
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

  it("uses active turbo polling before adapter-defined polling", () => {
    const integration = {
      ...snapshotIntegration,
      adapterId: "eia-crude-spr",
      pollIntervalMinutes: 5,
      settingsJson: JSON.stringify({
        turboPolling: {
          intervalSeconds: 10,
          startedAt: "2026-05-12T15:55:00.000Z",
          until: "2026-05-12T16:30:00.000Z"
        }
      })
    };

    expect(getEffectivePollIntervalMs(integration, new Date("2026-05-12T16:00:00.000Z"))).toBe(10_000);
    expect(getEffectivePollIntervalMinutes(integration, new Date("2026-05-12T16:00:00.000Z"))).toBe(1 / 6);
    expect(getPollIntervalReason(integration, new Date("2026-05-12T16:00:00.000Z"))).toContain(
      "Turbo polling every 10 second(s)"
    );
  });

  it("ignores expired turbo polling settings", () => {
    expect(
      getEffectivePollIntervalMinutes(
        {
          ...snapshotIntegration,
          adapterId: "eia-crude-spr",
          pollIntervalMinutes: 5,
          settingsJson: JSON.stringify({
            turboPolling: {
              intervalSeconds: 10,
              startedAt: "2026-05-12T15:30:00.000Z",
              until: "2026-05-12T15:59:59.000Z"
            }
          })
        },
        new Date("2026-05-12T16:00:00.000Z")
      )
    ).toBe(1);
  });
});

