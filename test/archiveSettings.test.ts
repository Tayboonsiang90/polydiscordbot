import { describe, expect, it } from "vitest";
import { buildArchiveSettings, clearArchiveSettings, getArchiveMetadata, isArchivedSettings } from "../src/archiveSettings.js";

describe("archive settings", () => {
  it("stores deleted channel metadata without dropping adapter settings", () => {
    const channel = {
      id: "channel-1",
      name: "bonbast-usd-irr",
      parentId: "category-1",
      topic: "Polymarket resolution monitor"
    };

    const settingsJson = buildArchiveSettings(
      JSON.stringify({ year: 2026 }),
      channel as never,
      new Date("2026-05-06T01:02:03.000Z"),
      "market ended"
    );

    expect(JSON.parse(settingsJson)).toEqual({
      year: 2026,
      archivedAt: "2026-05-06T01:02:03.000Z",
      archiveReason: "market ended",
      archivedChannel: {
        id: "channel-1",
        name: "bonbast-usd-irr",
        parentId: "category-1",
        topic: "Polymarket resolution monitor",
        deletedAt: "2026-05-06T01:02:03.000Z"
      }
    });
    expect(isArchivedSettings(settingsJson)).toBe(true);
    expect(getArchiveMetadata(settingsJson).archivedChannel?.name).toBe("bonbast-usd-irr");
  });

  it("clears archive metadata without dropping adapter settings", () => {
    const settingsJson = clearArchiveSettings(
      JSON.stringify({
        year: 2026,
        archivedAt: "2026-05-06T01:02:03.000Z",
        archiveReason: "market ended",
        archivedChannel: { id: "channel-1", name: "bonbast-usd-irr" }
      })
    );

    expect(settingsJson).toBe(JSON.stringify({ year: 2026 }));
    expect(isArchivedSettings(settingsJson)).toBe(false);
  });
});
