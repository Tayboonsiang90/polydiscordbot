import { describe, expect, it } from "vitest";
import { buildCategoryAlertRoleName, getCategoryAlertRoleEmoji, groupAlertRoleEntries } from "../src/provisioner.js";

type AlertRoleEntry = Parameters<typeof groupAlertRoleEntries>[0][number];

function buildEntry(id: string, roleMessageId: string | null, emoji: string, adapterEmoji = emoji): AlertRoleEntry {
  return {
    integration: {
      id: Number(id.replace(/\D/g, "")) || 1,
      guildId: "guild",
      channelId: "channel",
      adapterId: `adapter-${id}`,
      displayName: `Adapter ${id}`,
      sourceUrl: "https://example.com",
      polymarketUrl: null,
      alertRoleId: `role-${id}`,
      roleMessageId,
      roleChannelId: "role-channel",
      roleEmoji: emoji,
      settingsJson: null,
      pollIntervalMinutes: 5,
      status: "active",
      lastValue: null,
      lastCheckedAt: null,
      lastChangedAt: null,
      snapshotValue: null,
      snapshotCheckedAt: null,
      snapshotDate: null,
      createdAt: "2026-05-30T00:00:00.000Z",
      updatedAt: "2026-05-30T00:00:00.000Z"
    },
    adapter: {
      id: `adapter-${id}`,
      commandName: `adapter${id}`,
      displayName: `Adapter ${id}`,
      sourceUrl: "https://example.com",
      defaultChannelName: `adapter-${id}`,
      alertRoleName: `Adapter ${id} Alerts`,
      alertRoleEmoji: adapterEmoji,
      fetchCurrentValue: async () => ({
        value: "value",
        rawValue: "value",
        observedAt: new Date()
      })
    },
    role: {} as AlertRoleEntry["role"],
    displayName: `Adapter ${id}`,
    commandName: `adapter${id}`,
    roleId: `role-${id}`,
    roleName: `Adapter ${id} Alerts`,
    emoji,
    roleChannelName: "market-alert-roles",
    roleGroupTitle: "Market Alert Roles"
  };
}

describe("alert role selector grouping", () => {
  it("keeps existing selector message groups stable when new entries are inserted", () => {
    const groups = groupAlertRoleEntries([
      buildEntry("new", null, "🆕"),
      buildEntry("1", "message-a", "💱"),
      buildEntry("2", "message-a", "⛽"),
      buildEntry("3", "message-b", "📰")
    ]);

    expect(groups.map((group) => group.map((entry) => entry.integration.adapterId))).toEqual([
      ["adapter-1", "adapter-2", "adapter-new"],
      ["adapter-3"]
    ]);
  });

  it("does not place duplicate stored reaction emojis on the same selector message", () => {
    const groups = groupAlertRoleEntries([
      buildEntry("1", "message-a", "🔴"),
      buildEntry("2", "message-a", "🔴"),
      buildEntry("3", "message-a", "📰")
    ]);

    expect(groups.map((group) => group.map((entry) => entry.integration.adapterId))).toEqual([
      ["adapter-1", "adapter-3"],
      ["adapter-2"]
    ]);
  });

  it("groups category entries by the shared category emoji instead of stale integration emojis", () => {
    const categoryEntry = {
      ...buildEntry("1", "message-a", "💱"),
      emoji: "🔴",
      integrations: [
        buildEntry("1", "message-a", "💱").integration,
        buildEntry("2", "message-b", "⛽").integration
      ]
    };
    const groups = groupAlertRoleEntries([categoryEntry, buildEntry("3", "message-a", "🔴")]);

    expect(groups.map((group) => group.map((entry) => entry.integration.adapterId))).toEqual([
      ["adapter-1"],
      ["adapter-3"]
    ]);
  });

  it("normalizes category alert role names and emojis", () => {
    expect(buildCategoryAlertRoleName("Services Down Bots")).toBe("Services Down Bots Alerts");
    expect(buildCategoryAlertRoleName("Mention Alerts")).toBe("Mention Alerts");
    expect(getCategoryAlertRoleEmoji("Uncategorized")).toBe("📌");
    expect(getCategoryAlertRoleEmoji("Services Down Bots")).toBe(getCategoryAlertRoleEmoji("Services Down Bots"));
  });
});
