import { describe, expect, it } from "vitest";
import { deleteSettingsJsonKeys, mergeSettingsJson, parseSettingsJson } from "../src/settingsJson.js";

describe("settingsJson helpers", () => {
  it("parses only JSON objects and falls back to an empty object", () => {
    expect(parseSettingsJson(JSON.stringify({ year: 2026 }))).toEqual({ year: 2026 });
    expect(parseSettingsJson("[1,2,3]")).toEqual({});
    expect(parseSettingsJson("not json")).toEqual({});
    expect(parseSettingsJson(null)).toEqual({});
  });

  it("merges new keys without dropping existing adapter settings", () => {
    expect(mergeSettingsJson(JSON.stringify({ year: 2026, month: 5 }), { latestErrorMessageId: "message-1" })).toBe(
      JSON.stringify({ year: 2026, month: 5, latestErrorMessageId: "message-1" })
    );
  });

  it("deletes selected keys without dropping existing adapter settings", () => {
    expect(
      deleteSettingsJsonKeys(JSON.stringify({ year: 2026, month: 5, archivedAt: "2026-05-06T01:02:03.000Z" }), [
        "archivedAt",
        "archiveReason"
      ])
    ).toBe(JSON.stringify({ year: 2026, month: 5 }));
  });
});
