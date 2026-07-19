import type { TextChannel } from "discord.js";
import { deleteSettingsJsonKeys, mergeSettingsJson, parseSettingsJson } from "./settingsJson.js";

export type ArchivedChannelMetadata = {
  id: string;
  name: string;
  parentId: string | null;
  topic: string | null;
  deletedAt: string;
};

export type ArchiveMetadata = {
  archivedAt: string | null;
  archiveReason: string | null;
  archivedChannel: ArchivedChannelMetadata | null;
};

export function getArchiveMetadata(settingsJson: string | null | undefined): ArchiveMetadata {
  const settings = parseSettingsJson(settingsJson);
  const archivedChannel = parseArchivedChannelMetadata(settings.archivedChannel);
  return {
    archivedAt: typeof settings.archivedAt === "string" ? settings.archivedAt : null,
    archiveReason: typeof settings.archiveReason === "string" ? settings.archiveReason : null,
    archivedChannel
  };
}

export function isArchivedSettings(settingsJson: string | null | undefined): boolean {
  return Boolean(getArchiveMetadata(settingsJson).archivedAt);
}

export function buildArchiveSettings(
  settingsJson: string | null | undefined,
  channel: TextChannel,
  archivedAt: Date,
  archiveReason?: string
): string {
  return mergeSettingsJson(settingsJson, {
    archivedAt: archivedAt.toISOString(),
    archiveReason: archiveReason?.trim() || undefined,
    archivedChannel: {
      id: channel.id,
      name: channel.name,
      parentId: channel.parentId,
      topic: channel.topic,
      deletedAt: archivedAt.toISOString()
    }
  });
}

export function clearArchiveSettings(settingsJson: string | null | undefined): string {
  return deleteSettingsJsonKeys(settingsJson, ["archivedAt", "archiveReason", "archivedChannel"]);
}

function parseArchivedChannelMetadata(value: unknown): ArchivedChannelMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.name !== "string") {
    return null;
  }

  return {
    id: record.id,
    name: record.name,
    parentId: typeof record.parentId === "string" ? record.parentId : null,
    topic: typeof record.topic === "string" ? record.topic : null,
    deletedAt: typeof record.deletedAt === "string" ? record.deletedAt : ""
  };
}
