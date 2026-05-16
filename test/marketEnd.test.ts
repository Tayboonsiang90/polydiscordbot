import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotDatabase } from "../src/database.js";
import {
  fetchPolymarketEndDateFromGamma,
  getDueMarketEndReminders,
  getPolymarketSlug,
  getStoredOrFetchPolymarketEndDate,
  parseManualEasternDateTime,
  parseGammaEndDate
} from "../src/marketEnd.js";
import type { Integration } from "../src/integrations/types.js";

const integration = {
  id: 1,
  polymarketUrl: "https://polymarket.com/event/will-ground-beef-hit-in-2026"
} as Integration;

afterEach(() => {
  vi.restoreAllMocks();
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

let tempDir: string | null = null;

function createTestDatabase(): BotDatabase {
  tempDir = mkdtempSync(join(tmpdir(), "polybot-"));
  return new BotDatabase(join(tempDir, "bot.sqlite"));
}

function createIntegration(database: BotDatabase, polymarketUrl = integration.polymarketUrl): Integration {
  return database.createIntegration({
    guildId: "guild",
    channelId: "channel",
    adapterId: "fred-ground-beef",
    displayName: "FRED Ground Beef Price",
    sourceUrl: "https://fred.stlouisfed.org/series/APU0000703112",
    polymarketUrl,
    pollIntervalMinutes: 5
  });
}

describe("Polymarket market end reminders", () => {
  it("extracts Polymarket slugs", () => {
    expect(getPolymarketSlug("https://polymarket.com/event/will-ground-beef-hit-in-2026")).toBe(
      "will-ground-beef-hit-in-2026"
    );
    expect(getPolymarketSlug("https://example.com/event/test")).toBeNull();
  });

  it("parses Gamma API end dates exactly", () => {
    expect(parseGammaEndDate([{ endDate: "2026-12-31T00:00:00Z" }])?.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(parseGammaEndDate([])).toBeNull();
  });

  it("parses manual ET market end datetimes", () => {
    expect(parseManualEasternDateTime("2026-05-10 23:59")?.toISOString()).toBe("2026-05-11T03:59:00.000Z");
    expect(parseManualEasternDateTime("2026-05-10 11:59 PM")?.toISOString()).toBe("2026-05-11T03:59:00.000Z");
    expect(parseManualEasternDateTime("not a date")).toBeNull();
  });

  it("fetches end dates from the Gamma API by slug", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([{ endDate: "2026-12-31T00:00:00Z" }]), { status: 200 }))
    );

    await expect(fetchPolymarketEndDateFromGamma(integration.polymarketUrl)).resolves.toEqual(
      new Date("2026-12-31T00:00:00.000Z")
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://gamma-api.polymarket.com/events?slug=will-ground-beef-hit-in-2026",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("returns due reminders only after their Gamma due time", async () => {
    const database = createTestDatabase();
    const storedIntegration = createIntegration(database);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([{ endDate: "2026-05-11T03:59:00Z" }]), { status: 200 }))
    );

    await expect(
      getDueMarketEndReminders(database, storedIntegration, new Date("2026-05-10T03:58:59.000Z")).then((items) => items.map((item) => item.key))
    ).resolves.toEqual([]);
    await expect(
      getDueMarketEndReminders(database, storedIntegration, new Date("2026-05-10T03:59:00.000Z")).then((items) => items.map((item) => item.key))
    ).resolves.toEqual(["24h"]);
    await expect(
      getDueMarketEndReminders(database, storedIntegration, new Date("2026-05-10T15:59:00.000Z")).then((items) => items.map((item) => item.key))
    ).resolves.toEqual(["24h", "12h"]);
    await expect(
      getDueMarketEndReminders(database, storedIntegration, new Date("2026-05-11T03:59:00.000Z")).then((items) => items.map((item) => item.key))
    ).resolves.toEqual(["24h", "12h", "1h", "end"]);
    expect(fetch).toHaveBeenCalledTimes(1);

    database.close();
  });

  it("uses stored end dates without calling Gamma again", async () => {
    const database = createTestDatabase();
    const storedIntegration = createIntegration(database);
    database.recordMarketEndMetadata(
      storedIntegration.id,
      storedIntegration.polymarketUrl!,
      new Date("2026-12-31T00:00:00.000Z"),
      new Date("2026-05-08T00:00:00.000Z")
    );
    vi.stubGlobal("fetch", vi.fn());

    await expect(getStoredOrFetchPolymarketEndDate(database, storedIntegration)).resolves.toEqual({
      endAt: new Date("2026-12-31T00:00:00.000Z"),
      missingWarningDue: false
    });
    expect(fetch).not.toHaveBeenCalled();

    database.close();
  });

  it("marks missing Gamma end dates for one warning", async () => {
    const database = createTestDatabase();
    const storedIntegration = createIntegration(database, "https://polymarket.com/event/no-end-date-test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));

    await expect(getStoredOrFetchPolymarketEndDate(database, storedIntegration)).resolves.toEqual({
      endAt: null,
      missingWarningDue: true
    });
    database.recordMarketEndMissingWarning(storedIntegration.id, storedIntegration.polymarketUrl!, new Date("2026-05-08T00:00:00.000Z"));
    await expect(getStoredOrFetchPolymarketEndDate(database, storedIntegration)).resolves.toEqual({
      endAt: null,
      missingWarningDue: false
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    database.close();
  });
});
