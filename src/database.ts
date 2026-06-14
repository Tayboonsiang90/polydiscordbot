import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { CreateIntegrationInput, EventMonitorPost, Integration, IntegrationStatus } from "./integrations/types.js";

type IntegrationRow = Omit<Integration, "status"> & { status: IntegrationStatus };
type TableInfoRow = { name: string };
type EventAlertStatus = "pending" | "sending" | "sent";
type EventAlertRow = {
  integrationId: number;
  eventId: string;
  postJson: string;
  status: EventAlertStatus;
  lockedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type EventAlert = Omit<EventAlertRow, "postJson"> & {
  post: EventMonitorPost;
};
export type MarketEndMetadata = {
  integrationId: number;
  polymarketUrl: string;
  endAt: string | null;
  checkedAt: string;
  missingWarnedAt: string | null;
};

export type IntegrationUpdateLog = {
  id: number;
  integrationId: number;
  adapterId: string;
  kind: string;
  dedupeKey: string | null;
  title: string;
  summary: string;
  sourceAt: string | null;
  detectedAt: string;
  createdAt: string;
};

export type IntegrationUpdateLogInput = {
  integrationId: number;
  adapterId: string;
  kind: string;
  dedupeKey?: string | null;
  title: string;
  summary: string;
  sourceAt?: Date | string | null;
  detectedAt: Date | string;
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

  recordCheck(id: number, value: string, checkedAt: Date, changedOverride?: boolean): Integration {
    const integration = this.getIntegrationById(id);
    const changed = changedOverride ?? (integration.lastValue !== null && integration.lastValue !== value);
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

  recordUpdateLog(input: IntegrationUpdateLogInput): void {
    const detectedAt = toIsoString(input.detectedAt);
    const sourceAt = input.sourceAt ? toIsoString(input.sourceAt) : null;
    this.db
      .prepare(
        `INSERT OR IGNORE INTO integration_update_logs
          (integrationId, adapterId, kind, dedupeKey, title, summary, sourceAt, detectedAt, createdAt)
         VALUES
          (@integrationId, @adapterId, @kind, @dedupeKey, @title, @summary, @sourceAt, @detectedAt, @detectedAt)`
      )
      .run({
        integrationId: input.integrationId,
        adapterId: input.adapterId,
        kind: input.kind,
        dedupeKey: input.dedupeKey ?? null,
        title: normalizeLogText(input.title, 200),
        summary: normalizeLogText(input.summary, 2000),
        sourceAt,
        detectedAt
      });
  }

  listUpdateLogs(integrationId: number, limit = 20): IntegrationUpdateLog[] {
    return this.db
      .prepare(
        `SELECT id, integrationId, adapterId, kind, dedupeKey, title, summary, sourceAt, detectedAt, createdAt
         FROM integration_update_logs
         WHERE integrationId = ?
         ORDER BY detectedAt DESC, id DESC
         LIMIT ?`
      )
      .all(integrationId, limit) as IntegrationUpdateLog[];
  }

  claimEventAlert(integrationId: number, eventId: string, post: EventMonitorPost, now = new Date()): boolean {
    const timestamp = now.toISOString();
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO event_alerts
          (integrationId, eventId, postJson, status, lockedAt, sentAt, createdAt, updatedAt)
         VALUES
          (?, ?, ?, 'sending', ?, null, ?, ?)`
      )
      .run(integrationId, eventId, serializeEventPost(post), timestamp, timestamp, timestamp);
    if (result.changes <= 0) {
      return false;
    }

    const integration = this.getIntegrationById(integrationId);
    this.recordUpdateLog({
      integrationId,
      adapterId: integration.adapterId,
      kind: "event",
      dedupeKey: eventId,
      title: post.alertTitle ?? post.type,
      summary: formatEventUpdateSummary(post),
      sourceAt: post.postedAt,
      detectedAt: now
    });
    return true;
  }

  claimPendingEventAlerts(
    integrationId: number,
    now = new Date(),
    limit = 20,
    staleAfterMs = 2 * 60_000
  ): EventAlert[] {
    const timestamp = now.toISOString();
    const staleBefore = new Date(now.getTime() - staleAfterMs).toISOString();
    const rows = this.db
      .prepare(
        `SELECT integrationId, eventId, postJson, status, lockedAt, sentAt, createdAt, updatedAt
         FROM event_alerts
         WHERE integrationId = ?
           AND (
             status = 'pending'
             OR (status = 'sending' AND (lockedAt IS NULL OR lockedAt < ?))
           )
         ORDER BY createdAt ASC
         LIMIT ?`
      )
      .all(integrationId, staleBefore, limit) as EventAlertRow[];
    const claimed: EventAlert[] = [];
    const claim = this.db.prepare(
      `UPDATE event_alerts
       SET status = 'sending', lockedAt = ?, updatedAt = ?
       WHERE integrationId = ?
         AND eventId = ?
         AND status != 'sent'
         AND (
           status = 'pending'
           OR (status = 'sending' AND (lockedAt IS NULL OR lockedAt < ?))
         )`
    );

    for (const row of rows) {
      const result = claim.run(timestamp, timestamp, row.integrationId, row.eventId, staleBefore);
      if (result.changes > 0) {
        claimed.push(deserializeEventAlert({ ...row, status: "sending", lockedAt: timestamp, updatedAt: timestamp }));
      }
    }

    return claimed;
  }

  markEventAlertPending(integrationId: number, eventId: string, now = new Date()): void {
    this.db
      .prepare(
        `UPDATE event_alerts
         SET status = 'pending', lockedAt = null, updatedAt = ?
         WHERE integrationId = ? AND eventId = ? AND status != 'sent'`
      )
      .run(now.toISOString(), integrationId, eventId);
  }

  markEventAlertSent(integrationId: number, eventId: string, now = new Date()): void {
    const timestamp = now.toISOString();
    this.db
      .prepare(
        `UPDATE event_alerts
         SET status = 'sent', sentAt = ?, lockedAt = null, updatedAt = ?
         WHERE integrationId = ? AND eventId = ?`
      )
      .run(timestamp, timestamp, integrationId, eventId);
  }

  getEventAlert(integrationId: number, eventId: string): EventAlert | null {
    const row = this.db
      .prepare(
        `SELECT integrationId, eventId, postJson, status, lockedAt, sentAt, createdAt, updatedAt
         FROM event_alerts
         WHERE integrationId = ? AND eventId = ?`
      )
      .get(integrationId, eventId) as EventAlertRow | undefined;
    return row ? deserializeEventAlert(row) : null;
  }

  updateEventAlertPost(integrationId: number, eventId: string, post: EventMonitorPost, now = new Date()): boolean {
    const result = this.db
      .prepare(
        `UPDATE event_alerts
         SET postJson = ?, updatedAt = ?
         WHERE integrationId = ? AND eventId = ?`
      )
      .run(serializeEventPost(post), now.toISOString(), integrationId, eventId);
    return result.changes > 0;
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

      CREATE TABLE IF NOT EXISTS event_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        integrationId INTEGER NOT NULL,
        eventId TEXT NOT NULL,
        postJson TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent')),
        lockedAt TEXT,
        sentAt TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        UNIQUE(integrationId, eventId)
      );

      CREATE INDEX IF NOT EXISTS event_alerts_pending_idx
        ON event_alerts (integrationId, status, lockedAt, createdAt);

      CREATE TABLE IF NOT EXISTS integration_update_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        integrationId INTEGER NOT NULL,
        adapterId TEXT NOT NULL,
        kind TEXT NOT NULL,
        dedupeKey TEXT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        sourceAt TEXT,
        detectedAt TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE(integrationId, kind, dedupeKey)
      );

      CREATE INDEX IF NOT EXISTS integration_update_logs_integration_idx
        ON integration_update_logs (integrationId, detectedAt DESC);
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

function toIsoString(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeLogText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}

function formatEventUpdateSummary(post: EventMonitorPost): string {
  const parts = [
    post.matchedTerms.length ? `Matched: ${post.matchedTerms.join(", ")}` : "",
    post.text,
    post.url
  ].filter(Boolean);
  return parts.join("\n") || post.id;
}

function serializeEventPost(post: EventMonitorPost): string {
  const { imageAttachments: _imageAttachments, ...serializablePost } = post;
  return JSON.stringify({
    ...serializablePost,
    postedAt: post.postedAt.toISOString()
  });
}

function deserializeEventAlert(row: EventAlertRow): EventAlert {
  const { postJson, ...alert } = row;
  const post = JSON.parse(row.postJson) as Omit<EventMonitorPost, "postedAt"> & { postedAt: string };
  return {
    ...alert,
    post: {
      ...post,
      postedAt: new Date(post.postedAt),
      imageUrls: Array.isArray(post.imageUrls) ? post.imageUrls : [],
      imageAttachments: [],
      matchedTerms: Array.isArray(post.matchedTerms) ? post.matchedTerms : [],
      strikeTerms: Array.isArray(post.strikeTerms) ? post.strikeTerms : [],
      imageText: typeof post.imageText === "string" ? post.imageText : ""
    }
  };
}
