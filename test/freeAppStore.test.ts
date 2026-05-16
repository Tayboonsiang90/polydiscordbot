import { describe, expect, it } from "vitest";
import { extractFreeAppStoreTop2 } from "../src/integrations/freeAppStore.js";

describe("Free App Store adapter", () => {
  it("extracts the top 2 free app names in rank order", () => {
    const value = extractFreeAppStoreTop2({
      feed: {
        results: Array.from({ length: 10 }, (_, index) => ({
          name: `App ${index + 1}`,
          artistName: `Publisher ${index + 1}`
        }))
      }
    });

    expect(value).toBe(
      [
        "1. App 1",
        "2. App 2"
      ].join("\n")
    );
  });

  it("throws when fewer than 2 apps are returned", () => {
    expect(() => extractFreeAppStoreTop2({ feed: { results: [{ name: "Only App" }] } })).toThrow(
      "Could not find 2 free iPhone apps"
    );
  });
});
