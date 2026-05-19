import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BotDatabase } from "../src/database.js";

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

function createTestDatabase(): BotDatabase {
  tempDir = mkdtempSync(join(tmpdir(), "polybot-"));
  return new BotDatabase(join(tempDir, "bot.sqlite"));
}

describe("BotDatabase alert role metadata", () => {
  it("stores and finds integration alert role metadata", () => {
    const database = createTestDatabase();
    const integration = database.createIntegration({
      guildId: "guild",
      channelId: "channel",
      adapterId: "bonbast-usd-irr",
      displayName: "Bonbast USD/IRR",
      sourceUrl: "https://www.bonbast.com/graph/usd",
      pollIntervalMinutes: 5
    });

    const updated = database.setAlertRoleMetadata(integration.id, {
      alertRoleId: "role",
      roleMessageId: "message",
      roleChannelId: "role-channel",
      roleEmoji: "💱"
    });
    const found = database.getIntegrationByRoleMessage("message", "💱");

    expect(updated.alertRoleId).toBe("role");
    expect(updated.roleMessageId).toBe("message");
    expect(updated.roleChannelId).toBe("role-channel");
    expect(updated.roleEmoji).toBe("💱");
    expect(found?.id).toBe(integration.id);

    database.close();
  });

  it("stores integration settings JSON", () => {
    const database = createTestDatabase();
    const integration = database.createIntegration({
      guildId: "guild",
      channelId: "kma-channel",
      adapterId: "kma-seoul-precip",
      displayName: "KMA Seoul Precipitation",
      sourceUrl: "https://data.kma.go.kr/climate/RankState/selectRankStatisticsDivisionList.do",
      settingsJson: JSON.stringify({ year: 2026, month: 5 }),
      pollIntervalMinutes: 5
    });

    const updated = database.setSettingsJson(integration.id, JSON.stringify({ year: 2026, month: 6 }));

    expect(integration.settingsJson).toBe(JSON.stringify({ year: 2026, month: 5 }));
    expect(updated.settingsJson).toBe(JSON.stringify({ year: 2026, month: 6 }));

    database.close();
  });

  it("stores daily snapshots separately from regular checks", () => {
    const database = createTestDatabase();
    const integration = database.createIntegration({
      guildId: "guild",
      channelId: "freeappstore",
      adapterId: "free-app-store",
      displayName: "Free App Store Top 2",
      sourceUrl: "https://apps.apple.com/us/charts/iphone",
      pollIntervalMinutes: 5
    });

    const checked = database.recordCheck(integration.id, "regular-value", new Date("2026-05-08T15:55:00.000Z"));
    const snapshotted = database.recordSnapshot(
      integration.id,
      "snapshot-value",
      new Date("2026-05-08T16:00:00.000Z"),
      "2026-05-08"
    );
    const checkedAgain = database.recordCheck(integration.id, "new-regular-value", new Date("2026-05-08T16:10:00.000Z"));

    expect(checked.snapshotValue).toBeNull();
    expect(snapshotted.lastValue).toBe("regular-value");
    expect(snapshotted.snapshotValue).toBe("snapshot-value");
    expect(snapshotted.snapshotDate).toBe("2026-05-08");
    expect(checkedAgain.lastValue).toBe("new-regular-value");
    expect(checkedAgain.snapshotValue).toBe("snapshot-value");

    database.close();
  });

  it("deduplicates market end reminders by integration, URL, and reminder key", () => {
    const database = createTestDatabase();
    const integration = database.createIntegration({
      guildId: "guild",
      channelId: "channel",
      adapterId: "trump-truth",
      displayName: "Trump Truth Social",
      sourceUrl: "https://truthsocial.com/@realDonaldTrump",
      polymarketUrl: "https://polymarket.com/event/what-will-trump-post-this-week-may-4-may-10",
      pollIntervalMinutes: 5
    });

    expect(database.hasMarketEndReminder(integration.id, integration.polymarketUrl!, "12h")).toBe(false);
    database.recordMarketEndReminder(integration.id, integration.polymarketUrl!, "12h", new Date("2026-05-10T15:59:00.000Z"));
    database.recordMarketEndReminder(integration.id, integration.polymarketUrl!, "12h", new Date("2026-05-10T16:00:00.000Z"));

    expect(database.hasMarketEndReminder(integration.id, integration.polymarketUrl!, "12h")).toBe(true);
    expect(database.hasMarketEndReminder(integration.id, integration.polymarketUrl!, "1h")).toBe(false);

    database.clearMarketEndReminders(integration.id, integration.polymarketUrl!);
    expect(database.hasMarketEndReminder(integration.id, integration.polymarketUrl!, "12h")).toBe(false);

    database.close();
  });

  it("stores market end metadata and missing warnings", () => {
    const database = createTestDatabase();
    const integration = database.createIntegration({
      guildId: "guild",
      channelId: "channel",
      adapterId: "fred-ground-beef",
      displayName: "FRED Ground Beef Price",
      sourceUrl: "https://fred.stlouisfed.org/series/APU0000703112",
      polymarketUrl: "https://polymarket.com/event/will-ground-beef-hit-in-2026",
      pollIntervalMinutes: 5
    });

    database.recordMarketEndMetadata(
      integration.id,
      integration.polymarketUrl!,
      new Date("2026-12-31T00:00:00.000Z"),
      new Date("2026-05-08T00:00:00.000Z")
    );
    expect(database.getMarketEndMetadata(integration.id, integration.polymarketUrl!)).toMatchObject({
      endAt: "2026-12-31T00:00:00.000Z",
      missingWarnedAt: null
    });

    database.recordMarketEndMissingWarning(integration.id, integration.polymarketUrl!, new Date("2026-05-08T01:00:00.000Z"));
    expect(database.getMarketEndMetadata(integration.id, integration.polymarketUrl!)).toMatchObject({
      missingWarnedAt: "2026-05-08T01:00:00.000Z"
    });

    database.close();
  });
});

