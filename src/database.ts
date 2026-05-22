import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { CreateIntegrationInput, Integration, IntegrationStatus } from "./integrations/types.js";

type IntegrationRow = Omit<Integration, "status"> & { status: IntegrationStatus };
type TableInfoRow = { name: string };
export type MarketEndMetadata = {
  integrationId: number;
  polymarketUrl: string;
  endAt: string | null;
  checkedAt: string;
  missingWarnedAt: string | null;
};

export type AlertRoleMetadataInput = {
  alertRoleId: string;
  roleMessageId: string;
  roleChannelId: string;
  roleEmoji: string;
};

export type IntegrationMetadataInput = {
  displayName: string;
  sourceUrl: string;
};

export class BotDatabase {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
    this.normalizeAppStoreTop2State();
  }

  close(): void {
    this.db.close();
  }

  createIntegration(input: CreateIntegrationInput): Integration {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO integrations
          (guildId, channelId, adapterId, displayName, sourceUrl, polymarketUrl, settingsJson, pollIntervalMinutes, status, createdAt, updatedAt)
         VALUES
          (@guildId, @channelId, @adapterId, @displayName, @sourceUrl, @polymarketUrl, @settingsJson, @pollIntervalMinutes, 'active', @now, @now)`
      )
      .run({ ...input, polymarketUrl: input.polymarketUrl ?? null, settingsJson: input.settingsJson ?? null, now });

    return this.getIntegrationById(Number(result.lastInsertRowid));
  }

  getIntegrationById(id: number): Integration {
    const row = this.db.prepare("SELECT * FROM integrations WHERE id = ?").get(id) as IntegrationRow | undefined;
    if (!row) {
      throw new Error(`Integration not found: ${id}`);
    }
    return row;
  }

  getIntegrationByChannel(guildId: string, channelId: string): Integration | null {
    const row = this.db
      .prepare("SELECT * FROM integrations WHERE guildId = ? AND channelId = ?")
      .get(guildId, channelId) as IntegrationRow | undefined;
    return row ?? null;
  }

  getIntegrationByAdapter(guildId: string, adapterId: string): Integration | null {
    const row = this.db
      .prepare("SELECT * FROM integrations WHERE guildId = ? AND adapterId = ?")
      .get(guildId, adapterId) as IntegrationRow | undefined;
    return row ?? null;
  }

  listActiveIntegrations(): Integration[] {
    return this.db.prepare("SELECT * FROM integrations WHERE status = 'active'").all() as Integration[];
  }

  listIntegrations(): Integration[] {
    return this.db.prepare("SELECT * FROM integrations ORDER BY id ASC").all() as Integration[];
  }

  setIntervalMinutes(id: number, pollIntervalMinutes: number): Integration {
    this.db
      .prepare("UPDATE integrations SET pollIntervalMinutes = ?, updatedAt = ? WHERE id = ?")
      .run(pollIntervalMinutes, new Date().toISOString(), id);
    return this.getIntegrationById(id);
  }

  setStatus(id: number, status: IntegrationStatus): Integration {
    this.db
      .prepare("UPDATE integrations SET status = ?, updatedAt = ? WHERE id = ?")
      .run(status, new Date().toISOString(), id);
    return this.getIntegrationById(id);
  }

  setPolymarketUrl(id: number, polymarketUrl: string | null): Integration {
    this.db
      .prepare("UPDATE integrations SET polymarketUrl = ?, updatedAt = ? WHERE id = ?")
      .run(polymarketUrl, new Date().toISOString(), id);
    return this.getIntegrationById(id);
  }

  setSettingsJson(id: number, settingsJson: string): Integration {
    this.db
      .prepare("UPDATE integrations SET settingsJson = ?, updatedAt = ? WHERE id = ?")
      .run(settingsJson, new Date().toISOString(), id);
    return this.getIntegrationById(id);
  }

  setAlertRoleMetadata(id: number, input: AlertRoleMetadataInput): Integration {
    this.db
      .prepare(
        `UPDATE integrations
         SET alertRoleId = ?, roleMessageId = ?, roleChannelId = ?, roleEmoji = ?, updatedAt = ?
         WHERE id = ?`
      )
      .run(
        input.alertRoleId,
        input.roleMessageId,
        input.roleChannelId,
        input.roleEmoji,
        new Date().toISOString(),
        id
      );
    return this.getIntegrationById(id);
  }

  syncIntegrationMetadata(id: number, input: IntegrationMetadataInput): Integration {
    const integration = this.getIntegrationById(id);
    if (integration.displayName === input.displayName && integration.sourceUrl === input.sourceUrl) {
      return integration;
    }

    this.db
      .prepare("UPDATE integrations SET displayName = ?, sourceUrl = ?, updatedAt = ? WHERE id = ?")
      .run(input.displayName, input.sourceUrl, new Date().toISOString(), id);
    return this.getIntegrationById(id);
  }

  getIntegrationByRoleMessage(roleMessageId: string, roleEmoji: string): Integration | null {
    const row = this.db
      .prepare("SELECT * FROM integrations WHERE roleMessageId = ? AND roleEmoji = ?")
      .get(roleMessageId, roleEmoji) as IntegrationRow | undefined;
    return row ?? null;
  }

  updateIntegrationChannel(id: number, channelId: string): Integration {
    this.db
      .prepare("UPDATE integrations SET channelId = ?, updatedAt = ? WHERE id = ?")
      .run(channelId, new Date().toISOString(), id);
    return this.getIntegrationById(id);
  }

  recordCheck(id: number, value: string, checkedAt: Date): Integration {
    const integration = this.getIntegrationById(id);
    const changed = integration.lastValue !== null && integration.lastValue !== value;
    this.db
      .prepare(
        `UPDATE integrations
         SET lastValue = ?, lastCheckedAt = ?, lastChangedAt = ?, updatedAt = ?
         WHERE id = ?`
      )
      .run(
        value,
        checkedAt.toISOString(),
        changed ? checkedAt.toISOString() : integration.lastChangedAt,
        checkedAt.toISOString(),
        id
      );
    return this.getIntegrationById(id);
  }

  recordSnapshot(id: number, value: string, checkedAt: Date, snapshotDate: string): Integration {
    this.db
      .prepare(
        `UPDATE integrations
         SET snapshotValue = ?, snapshotCheckedAt = ?, snapshotDate = ?, updatedAt = ?
         WHERE id = ?`
      )
      .run(value, checkedAt.toISOString(), snapshotDate, checkedAt.toISOString(), id);
    return this.getIntegrationById(id);
  }

  hasMarketEndReminder(integrationId: number, polymarketUrl: string, reminderKey: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM market_end_reminders
         WHERE integrationId = ? AND polymarketUrl = ? AND reminderKey = ?`
      )
      .get(integrationId, polymarketUrl, reminderKey);
    return Boolean(row);
  }

  recordMarketEndReminder(integrationId: number, polymarketUrl: string, reminderKey: string, sentAt: Date): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO market_end_reminders
          (integrationId, polymarketUrl, reminderKey, sentAt)
         VALUES (?, ?, ?, ?)`
      )
      .run(integrationId, polymarketUrl, reminderKey, sentAt.toISOString());
  }

  clearMarketEndReminders(integrationId: number, polymarketUrl: string): void {
    this.db
      .prepare(
        `DELETE FROM market_end_reminders
         WHERE integrationId = ? AND polymarketUrl = ?`
      )
      .run(integrationId, polymarketUrl);
  }

  getMarketEndMetadata(integrationId: number, polymarketUrl: string): MarketEndMetadata | null {
    const row = this.db
      .prepare(
        `SELECT integrationId, polymarketUrl, endAt, checkedAt, missingWarnedAt
         FROM market_end_metadata
         WHERE integrationId = ? AND polymarketUrl = ?`
      )
      .get(integrationId, polymarketUrl) as MarketEndMetadata | undefined;
    return row ?? null;
  }

  recordMarketEndMetadata(integrationId: number, polymarketUrl: string, endAt: Date | null, checkedAt: Date): void {
    this.db
      .prepare(
        `INSERT INTO market_end_metadata
          (integrationId, polymarketUrl, endAt, checkedAt, missingWarnedAt)
         VALUES (?, ?, ?, ?, null)
         ON CONFLICT(integrationId, polymarketUrl)
         DO UPDATE SET endAt = excluded.endAt, checkedAt = excluded.checkedAt`
      )
      .run(integrationId, polymarketUrl, endAt?.toISOString() ?? null, checkedAt.toISOString());
  }

  recordMarketEndMissingWarning(integrationId: number, polymarketUrl: string, warnedAt: Date): void {
    this.db
      .prepare(
        `UPDATE market_end_metadata
         SET missingWarnedAt = ?
         WHERE integrationId = ? AND polymarketUrl = ?`
      )
      .run(warnedAt.toISOString(), integrationId, polymarketUrl);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS integrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guildId TEXT NOT NULL,
        channelId TEXT NOT NULL,
        adapterId TEXT NOT NULL,
        displayName TEXT NOT NULL,
        sourceUrl TEXT NOT NULL,
        polymarketUrl TEXT,
        alertRoleId TEXT,
        roleMessageId TEXT,
        roleChannelId TEXT,
        roleEmoji TEXT,
        settingsJson TEXT,
        pollIntervalMinutes INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
        lastValue TEXT,
        lastCheckedAt TEXT,
        lastChangedAt TEXT,
        snapshotValue TEXT,
        snapshotCheckedAt TEXT,
        snapshotDate TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        UNIQUE(guildId, channelId)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS integrations_guild_adapter_idx
        ON integrations (guildId, adapterId);

      CREATE TABLE IF NOT EXISTS market_end_reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        integrationId INTEGER NOT NULL,
        polymarketUrl TEXT NOT NULL,
        reminderKey TEXT NOT NULL,
        sentAt TEXT NOT NULL,
        UNIQUE(integrationId, polymarketUrl, reminderKey)
      );

      CREATE TABLE IF NOT EXISTS market_end_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        integrationId INTEGER NOT NULL,
        polymarketUrl TEXT NOT NULL,
        endAt TEXT,
        checkedAt TEXT NOT NULL,
        missingWarnedAt TEXT,
        UNIQUE(integrationId, polymarketUrl)
      );
    `);

    if (!this.hasColumn("integrations", "polymarketUrl")) {
      this.db.exec("ALTER TABLE integrations ADD COLUMN polymarketUrl TEXT;");
    }
    if (!this.hasColumn("integrations", "alertRoleId")) {
      this.db.exec("ALTER TABLE integrations ADD COLUMN alertRoleId TEXT;");
    }
    if (!this.hasColumn("integrations", "roleMessageId")) {
      this.db.exec("ALTER TABLE integrations ADD COLUMN roleMessageId TEXT;");
    }
    if (!this.hasColumn("integrations", "roleChannelId")) {
      this.db.exec("ALTER TABLE integrations ADD COLUMN roleChannelId TEXT;");
    }
    if (!this.hasColumn("integrations", "roleEmoji")) {
      this.db.exec("ALTER TABLE integrations ADD COLUMN roleEmoji TEXT;");
    }
    if (!this.hasColumn("integrations", "settingsJson")) {
      this.db.exec("ALTER TABLE integrations ADD COLUMN settingsJson TEXT;");
    }
    if (!this.hasColumn("integrations", "snapshotValue")) {
      this.db.exec("ALTER TABLE integrations ADD COLUMN snapshotValue TEXT;");
    }
    if (!this.hasColumn("integrations", "snapshotCheckedAt")) {
      this.db.exec("ALTER TABLE integrations ADD COLUMN snapshotCheckedAt TEXT;");
    }
    if (!this.hasColumn("integrations", "snapshotDate")) {
      this.db.exec("ALTER TABLE integrations ADD COLUMN snapshotDate TEXT;");
    }
  }

  private hasColumn(tableName: string, columnName: string): boolean {
    const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as TableInfoRow[];
    return rows.some((row) => row.name === columnName);
  }

  private normalizeAppStoreTop2State(): void {
    const updates = [
      { adapterId: "free-app-store", displayName: "Free App Store Top 2" },
      { adapterId: "paid-app-store", displayName: "Paid App Store Top 2" }
    ];

    const select = this.db.prepare("SELECT id, displayName, lastValue, snapshotValue FROM integrations WHERE adapterId = ?");
    const update = this.db.prepare(
      `UPDATE integrations
       SET displayName = ?, lastValue = ?, snapshotValue = ?, updatedAt = ?
       WHERE id = ?`
    );

    for (const item of updates) {
      const rows = select.all(item.adapterId) as Array<{
        id: number;
        displayName: string;
        lastValue: string | null;
        snapshotValue: string | null;
      }>;
      for (const row of rows) {
        const lastValue = keepFirstTwoLines(row.lastValue);
        const snapshotValue = keepFirstTwoLines(row.snapshotValue);
        if (row.displayName === item.displayName && row.lastValue === lastValue && row.snapshotValue === snapshotValue) {
          continue;
        }

        update.run(
          item.displayName,
          lastValue,
          snapshotValue,
          new Date().toISOString(),
          row.id
        );
      }
    }
  }
}

function keepFirstTwoLines(value: string | null): string | null {
  if (!value) {
    return value;
  }

  return value.split(/\r?\n/).slice(0, 2).join("\n");
}
