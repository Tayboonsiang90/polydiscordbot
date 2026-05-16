import { describe, expect, it } from "vitest";
import { extractPaidAppStoreTop2 } from "../src/integrations/paidAppStore.js";

describe("Paid App Store adapter", () => {
  it("extracts the top 2 paid app names in rank order", () => {
    const value = extractPaidAppStoreTop2({
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
        "2. Paid App 2"
      ].join("\n")
    );
  });

  it("throws when fewer than 2 apps are returned", () => {
    expect(() => extractPaidAppStoreTop2({ feed: { results: [{ name: "Only App" }] } })).toThrow(
      "Could not find 2 paid iPhone apps"
    );
  });
});
