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

  it("resolves a Polymarket profile proxy wallet before adding a profile link", async () => {
    const address = "0xcf12f5b99605cb299fb11d5eff4fb304de008d02";
    const proxyWallet = "0x4ad6cadefae3c28f5b2caa32a99ebba3a614464c";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const target = url.toString();
        const parsed = new URL(target);
        if (parsed.origin + parsed.pathname === "https://gamma-api.polymarket.com/public-profile") {
          expect(parsed.searchParams.get("address")).toBe(address);
          return jsonResponse({ proxyWallet, displayUsernamePublic: true, name: "noreasapa", pseudonym: "Unripe-Split" });
        }
        if (parsed.origin + parsed.pathname === "https://data-api.polymarket.com/trades") {
          expect(parsed.searchParams.get("user")).toBe(proxyWallet);
          expect(parsed.searchParams.get("limit")).toBe("1");
          expect(parsed.searchParams.get("takerOnly")).toBe("false");
          return jsonResponse([{ proxyWallet, name: "noreasapa" }]);
        }

        throw new Error(`Unexpected fetch: ${target}`);
      })
    );

    const status = await fetchPolymarketAddressProfileStatus(address);

    expect(status).toMatchObject({
      address,
      profileUrl: "https://polymarket.com/@noreasapa",
      profileName: "noreasapa",
      profileWallet: proxyWallet,
      linkedProfile: true,
      hasTrades: true
    });
    expect(
      formatAddressWithLabel(
        address,
        [{ address, label: "Known Trader" }],
        status
      )
    ).toBe(
      `Known Trader ([Polymarket: noreasapa](https://polymarket.com/@noreasapa))\n${address}`
    );
  });

  it("marks addresses with no public profile or trades as not linked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const target = url.toString();
        const parsed = new URL(target);
        if (parsed.origin + parsed.pathname === "https://gamma-api.polymarket.com/public-profile") {
          return new Response("not found", { status: 404 });
        }
        if (parsed.origin + parsed.pathname === "https://data-api.polymarket.com/trades") {
          return jsonResponse([]);
        }

        throw new Error(`Unexpected fetch: ${target}`);
      })
    );

    const address = "0x3333333333333333333333333333333333333333";
    const status = await fetchPolymarketAddressProfileStatus(address);

    expect(status).toMatchObject({
      address,
      linkedProfile: false,
      hasTrades: false
    });
    expect(formatAddressWithLabel(address, [{ address, label: "Known Trader" }], status)).toBe(
      `Known Trader\n${address}\nPolymarket: no linked profile/trades found`
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
      error: "Polymarket public profile HTTP 503"
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

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
