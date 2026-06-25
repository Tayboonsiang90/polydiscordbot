import { describe, expect, it } from "vitest";
import { formatEasternDateTime, formatSingaporeDateTime } from "../src/time.js";

describe("formatSingaporeDateTime", () => {
  it("formats ISO timestamps in Singapore time", () => {
    expect(formatSingaporeDateTime("2026-05-06T01:02:03.000Z")).toBe("06/05/2026, 09:02:03 SGT");
  });

  it("uses 00 instead of 24 for midnight hour", () => {
    expect(formatSingaporeDateTime("2026-05-30T16:16:28.000Z")).toBe("31/05/2026, 00:16:28 SGT");
  });

  it("returns never for missing timestamps", () => {
    expect(formatSingaporeDateTime(null)).toBe("never");
  });

  it("handles invalid timestamps", () => {
    expect(formatSingaporeDateTime("not-a-date")).toBe("invalid date");
  });
});

describe("formatEasternDateTime", () => {
  it("formats ISO timestamps in Eastern time", () => {
    expect(formatEasternDateTime("2026-05-06T01:02:03.000Z")).toBe("May 05, 2026, 21:02:03 ET");
  });

  it("returns never for missing timestamps", () => {
    expect(formatEasternDateTime(null)).toBe("never");
  });

  it("handles invalid timestamps", () => {
    expect(formatEasternDateTime("not-a-date")).toBe("invalid date");
  });
});
