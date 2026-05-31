import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exportAddressLabelsCsv,
  fetchPolymarketAddressProfileStatus,
  formatAddressWithLabel,
  getAddressLabelsFromSettingsJson,
  importAddressLabelsInSettingsJson,
  testOnlyAddressLabelHelpers,
  updateAddressLabelsInSettingsJson
} from "../src/addressLabels.js";

afterEach(() => {
  vi.restoreAllMocks();
  testOnlyAddressLabelHelpers.resetProfileCache();
});

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

  it("previews and applies bulk address label imports", () => {
    const existingSettingsJson = JSON.stringify({
      lastScannedBlock: 100,
      addressLabels: [
        { address: "0x1111111111111111111111111111111111111111", label: "Old Maker" },
        { address: "0x5555555555555555555555555555555555555555", label: "Existing Only" }
      ]
    });
    const importText = [
      "name,address",
      "Wintermute,0x2222222222222222222222222222222222222222",
      "0x1111111111111111111111111111111111111111, Updated Maker",
      "not valid",
      "0x3333333333333333333333333333333333333333",
      "GSR = 0x4444444444444444444444444444444444444444",
      "Dupe One 0x2222222222222222222222222222222222222222",
      "Dupe Final 0x2222222222222222222222222222222222222222"
    ].join("\n");

    const preview = importAddressLabelsInSettingsJson(existingSettingsJson, importText);

    expect(preview.changed).toBe(false);
    expect(preview.addressLabels).toEqual([
      { address: "0x5555555555555555555555555555555555555555", label: "Existing Only" },
      { address: "0x1111111111111111111111111111111111111111", label: "Old Maker" }
    ]);
    expect(preview.importSummary).toMatchObject({
      dryRun: true,
      totalRows: 7,
      validRows: 5,
      uniqueLabels: 3,
      added: 2,
      updated: 1,
      unchanged: 0
    });
    expect(preview.importSummary?.invalidRows.map((row) => row.reason)).toEqual(["missing 0x address", "missing nickname"]);
    expect(preview.importSummary?.duplicateRows).toHaveLength(2);

    const applied = importAddressLabelsInSettingsJson(existingSettingsJson, importText, { dryRun: false });

    expect(applied.changed).toBe(true);
    expect(JSON.parse(applied.settingsJson)).toMatchObject({ lastScannedBlock: 100 });
    expect(applied.addressLabels).toEqual([
      { address: "0x2222222222222222222222222222222222222222", label: "Dupe Final" },
      { address: "0x5555555555555555555555555555555555555555", label: "Existing Only" },
      { address: "0x4444444444444444444444444444444444444444", label: "GSR" },
      { address: "0x1111111111111111111111111111111111111111", label: "Updated Maker" }
    ]);
  });

  it("exports address labels as CSV", () => {
    expect(
      exportAddressLabelsCsv([
        { address: "0x1111111111111111111111111111111111111111", label: 'Maker, "One"' },
        { address: "0x2222222222222222222222222222222222222222", label: "Simple Maker" }
      ])
    ).toBe('name,address\n"Maker, ""One""",0x1111111111111111111111111111111111111111\nSimple Maker,0x2222222222222222222222222222222222222222\n');
  });

  it("checks Polymarket Data API trades before adding a profile link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const target = url.toString();
        const parsed = new URL(target);
        expect(parsed.origin + parsed.pathname).toBe("https://data-api.polymarket.com/trades");
        expect(parsed.searchParams.get("user")).toBe("0x3333333333333333333333333333333333333333");
        expect(parsed.searchParams.get("limit")).toBe("1");
        expect(parsed.searchParams.get("takerOnly")).toBe("false");
        return new Response(JSON.stringify([{ proxyWallet: "0x3333333333333333333333333333333333333333" }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const status = await fetchPolymarketAddressProfileStatus("0x3333333333333333333333333333333333333333");

    expect(status).toMatchObject({
      address: "0x3333333333333333333333333333333333333333",
      profileUrl: "https://polymarket.com/0x3333333333333333333333333333333333333333",
      hasTrades: true
    });
    expect(
      formatAddressWithLabel(
        "0x3333333333333333333333333333333333333333",
        [{ address: "0x3333333333333333333333333333333333333333", label: "Known Trader" }],
        status
      )
    ).toBe(
      "Known Trader ([Polymarket](https://polymarket.com/0x3333333333333333333333333333333333333333))\n0x3333333333333333333333333333333333333333"
    );
  });

  it("does not show transient Polymarket profile check failures in alert address fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("service unavailable", { status: 503 }))
    );

    const status = await fetchPolymarketAddressProfileStatus("0x4444444444444444444444444444444444444444");

    expect(status).toMatchObject({
      address: "0x4444444444444444444444444444444444444444",
      error: "HTTP 503"
    });
    expect(
      formatAddressWithLabel(
        "0x4444444444444444444444444444444444444444",
        [{ address: "0x4444444444444444444444444444444444444444", label: "Known Trader" }],
        status
      )
    ).toBe("Known Trader\n0x4444444444444444444444444444444444444444");
  });
});
