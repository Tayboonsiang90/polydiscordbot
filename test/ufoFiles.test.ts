import { describe, expect, it } from "vitest";
import {
  buildUfoFilesFingerprint,
  extractUfoFileRecordsFromHtml,
  extractUfoFileRecordsFromMarkdown,
  formatUfoFilesValue,
  parseUfoFilesDeadlines,
  ufoFilesAdapter,
  type UfoFileRecord
} from "../src/integrations/ufoFiles.js";

const source = {
  name: "NARA UAP Bulk Downloads",
  displayUrl: "https://www.archives.gov/research/catalog/catalog-bulk-downloads/uap-bulk-download",
  fetchUrl: "https://www.archives.gov/research/catalog/catalog-bulk-downloads/uap-bulk-download",
  mode: "html" as const
};

describe("UFO files adapter", () => {
  it("extracts tracked file and catalog links from NARA HTML", () => {
    const html = `
      <a href="https://catalog.archives.gov/id/123456">Catalog Record 123456</a>
      <a href="https://s3.amazonaws.com/NARAprodstorage/opastorage/live/1/234/uaps/uap-batch.zip">UAP ZIP</a>
      <a href="/research/topics/uaps/rg-615">Record Group 615</a>
      <a href="/about">Unrelated NARA page</a>
    `;

    const records = extractUfoFileRecordsFromHtml(html, source.displayUrl, source.name);

    expect(records.map((record) => record.url)).toEqual([
      "https://catalog.archives.gov/id/123456",
      "https://www.archives.gov/research/topics/uaps/rg-615",
      "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/1/234/uaps/uap-batch.zip"
    ]);
  });

  it("extracts tracked AARO and FBI links from markdown mirrors", () => {
    const markdown = `
      [Annual UAP Report](https://www.aaro.mil/Portals/136/PDFs/UAP_Annual_Report.pdf)
      https://vault.fbi.gov/UFO/ufo-part-01/view
      [About](https://www.aaro.mil/About-AARO/)
    `;

    const records = extractUfoFileRecordsFromMarkdown(markdown, "https://www.aaro.mil/UAP-Records/", "AARO UAP Records");

    expect(records.map((record) => record.url)).toEqual([
      "https://www.aaro.mil/Portals/136/PDFs/UAP_Annual_Report.pdf",
      "https://vault.fbi.gov/UFO/ufo-part-01/view"
    ]);
  });

  it("builds a stable fingerprint independent of source ordering", () => {
    const records: UfoFileRecord[] = [
      { source: "AARO", title: "Report", url: "https://www.aaro.mil/report.pdf" },
      { source: "NARA", title: "Catalog", url: "https://catalog.archives.gov/id/123" }
    ];

    expect(buildUfoFilesFingerprint(records)).toBe(buildUfoFilesFingerprint([...records].reverse()));
    expect(buildUfoFilesFingerprint(records)).not.toBe(buildUfoFilesFingerprint([...records, { source: "FBI", title: "UFO", url: "https://vault.fbi.gov/UFO" }]));
  });

  it("formats source counts, deadlines, and fingerprint for Discord output", () => {
    const value = formatUfoFilesValue(
      [
        {
          source,
          records: [
            { source: source.name, title: "Catalog Record 123456", url: "https://catalog.archives.gov/id/123456" }
          ]
        }
      ],
      ["July 17", "2026-07-31"],
      "https://polymarket.com/event/trump-declassifies-new-ufo-files-byptptpt-20260710184334563"
    );

    expect(value).toContain("Metric: Official UFO/UAP file inventory");
    expect(value).toContain("Tracked files: 1");
    expect(value).toMatch(/^Fingerprint: [a-f0-9]{16}$/m);
    expect(value).toContain("Polymarket deadlines: July 17, 2026-07-31");
    expect(value).toContain("NARA UAP Bulk Downloads: 1 tracked file link(s)");
    expect(value).toContain("https://catalog.archives.gov/id/123456");
  });

  it("alerts only after an existing stored fingerprint changes", () => {
    const previousValue = ["Metric: Official UFO/UAP file inventory", "Fingerprint: abc123def456abcd"].join("\n");
    const sameValue = ["Metric: Official UFO/UAP file inventory", "Fingerprint: abc123def456abcd"].join("\n");
    const changedValue = ["Metric: Official UFO/UAP file inventory", "Fingerprint: fff123def456abcd"].join("\n");

    expect(ufoFilesAdapter.shouldAlertOnChange?.(null, changedValue)).toBe(false);
    expect(ufoFilesAdapter.shouldAlertOnChange?.(previousValue, sameValue)).toBe(false);
    expect(ufoFilesAdapter.shouldAlertOnChange?.(previousValue, changedValue)).toBe(true);
  });

  it("parses active market deadline labels from Gamma markets", () => {
    expect(
      parseUfoFilesDeadlines([
        { question: "Trump declassifies new UFO files by July 17?", active: true, closed: false, endDate: "2026-07-17T00:00:00Z" },
        { groupItemTitle: "July 31", active: true, closed: false, endDate: "2026-07-31T00:00:00Z" },
        { question: "Trump declassifies new UFO files by July 3?", active: false, closed: true, endDate: "2026-07-03T00:00:00Z" }
      ])
    ).toEqual(["July 17 (2026-07-17)", "July 31 (2026-07-31)"]);
  });
});
