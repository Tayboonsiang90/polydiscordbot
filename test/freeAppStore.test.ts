import { describe, expect, it } from "vitest";
import { shouldAlertOnAppStoreTop2Change } from "../src/integrations/appleAppStore.js";
import { extractFreeAppStoreTop5 } from "../src/integrations/freeAppStore.js";

describe("Free App Store adapter", () => {
  it("extracts the top 5 free app names in rank order", () => {
    const value = extractFreeAppStoreTop5({
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
        "2. App 2",
        "3. App 3",
        "4. App 4",
        "5. App 5"
      ].join("\n")
    );
  });

  it("throws when fewer than 5 apps are returned", () => {
    expect(() => extractFreeAppStoreTop5({ feed: { results: [{ name: "Only App" }] } })).toThrow(
      "Could not find 5 free iPhone apps"
    );
  });

  it("only alerts when one of the top 2 apps changes", () => {
    expect(
      shouldAlertOnAppStoreTop2Change(
        ["1. App 1", "2. App 2", "3. Old App"].join("\n"),
        ["1. App 1", "2. App 2", "3. New App"].join("\n")
      )
    ).toBe(false);
    expect(
      shouldAlertOnAppStoreTop2Change(
        ["1. App 1", "2. App 2", "3. Old App"].join("\n"),
        ["1. App 1", "2. New App", "3. Old App"].join("\n")
      )
    ).toBe(true);
  });
});
