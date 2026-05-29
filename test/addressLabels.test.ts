import { describe, expect, it } from "vitest";
import {
  formatAddressWithLabel,
  getAddressLabelsFromSettingsJson,
  updateAddressLabelsInSettingsJson
} from "../src/addressLabels.js";

describe("address labels", () => {
  it("adds, updates, removes, and preserves other settings", () => {
    const added = updateAddressLabelsInSettingsJson(
      JSON.stringify({ lastScannedBlock: 100 }),
      "add",
      "0x1111111111111111111111111111111111111111",
      "Known Proposer"
    );

    expect(added.changed).toBe(true);
    expect(JSON.parse(added.settingsJson)).toMatchObject({
      lastScannedBlock: 100,
      addressLabels: [{ address: "0x1111111111111111111111111111111111111111", label: "Known Proposer" }]
    });

    const updated = updateAddressLabelsInSettingsJson(
      added.settingsJson,
      "add",
      "0x1111111111111111111111111111111111111111",
      "Updated Proposer"
    );

    expect(updated.addressLabels).toEqual([
      { address: "0x1111111111111111111111111111111111111111", label: "Updated Proposer" }
    ]);
    expect(
      formatAddressWithLabel("0x1111111111111111111111111111111111111111", updated.addressLabels)
    ).toBe("Updated Proposer\n0x1111111111111111111111111111111111111111");

    const removed = updateAddressLabelsInSettingsJson(updated.settingsJson, "remove", "0x1111111111111111111111111111111111111111");

    expect(removed.changed).toBe(true);
    expect(removed.addressLabels).toEqual([]);
  });

  it("normalizes stored labels and rejects invalid addresses", () => {
    expect(() => updateAddressLabelsInSettingsJson(null, "add", "not-an-address", "Nope")).toThrow(/0x-prefixed/);

    expect(
      getAddressLabelsFromSettingsJson(
        JSON.stringify({
          addressLabels: [
            { address: "0x2222222222222222222222222222222222222222", label: "  Known   Disputer  " },
            { address: "invalid", label: "Ignored" }
          ]
        })
      )
    ).toEqual([{ address: "0x2222222222222222222222222222222222222222", label: "Known Disputer" }]);
  });
});
