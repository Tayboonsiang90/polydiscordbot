import { describe, expect, it } from "vitest";
import { shouldAlertOnAppStoreTop2Change } from "../src/integrations/appleAppStore.js";
import { extractPaidAppStoreTop5 } from "../src/integrations/paidAppStore.js";

describe("Paid App Store adapter", () => {
  it("extracts the top 5 paid app names in rank order", () => {
    const value = extractPaidAppStoreTop5({
      feed: {
        results: Array.from({ length: 10 }, (_, index) => ({
          name: `Paid App ${index + 1}`,
          artistName: `Publisher ${index + 1}`
        }))
      }
    });

    expect(value).toBe(
      [
        "1. Paid App 1",
        "2. Paid App 2",
        "3. Paid App 3",
        "4. Paid App 4",
        "5. Paid App 5"
      ].join("\n")
    );
  });

  it("throws when fewer than 5 apps are returned", () => {
    expect(() => extractPaidAppStoreTop5({ feed: { results: [{ name: "Only App" }] } })).toThrow(
      "Could not find 5 paid iPhone apps"
    );
  });

  it("alerts only when the top 2 paid apps change", () => {
    const previous = ["1. Paid App 1", "2. Paid App 2", "3. Paid App 3", "4. Paid App 4", "5. Paid App 5"].join("\n");
    const changedThird = ["1. Paid App 1", "2. Paid App 2", "3. New Paid App", "4. Paid App 4", "5. Paid App 5"].join("\n");
    const changedSecond = ["1. Paid App 1", "2. New Paid App", "3. Paid App 3", "4. Paid App 4", "5. Paid App 5"].join("\n");

    expect(shouldAlertOnAppStoreTop2Change(previous, changedThird)).toBe(false);
    expect(shouldAlertOnAppStoreTop2Change(previous, changedSecond)).toBe(true);
  });
});
