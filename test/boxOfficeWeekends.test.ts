import { describe, expect, it } from "vitest";
import {
  buildWeekendSnapshot,
  extractBoxOfficeBondableMap,
  extractBoxOfficeStateMap,
  formatBoxOfficeWeekendValue,
  normalizeBoxOfficeGammaEvent,
  parseDailyBoxOfficeRows,
  shouldAlertOnBoxOfficeStateChange
} from "../src/integrations/boxOfficeWeekends.js";

describe("Box Office weekend adapter", () => {
  it("normalizes Gamma market metadata and weekend windows", () => {
    const market = normalizeBoxOfficeGammaEvent({
      slug: "moana-2026-opening-weekend-box-office-20260706135043555",
      title: "\"Moana (2026)\" Opening Weekend Box Office",
      description:
        "This market will resolve according to how much \"Moana\" (2026) Opening Weekend Box Office will gross domestically on its opening weekend. The \"Daily Box Office Performance\" figures found on the “Box Office” tab on this movie's The Numbers (https://www.the-numbers.com/) page will be used to resolve this market once the values for the 3-day opening weekend (July 10 - July 12) are final (i.e., not studio estimates).",
      active: true,
      closed: false,
      endDate: "2026-07-13T12:00:00Z",
      tags: [{ slug: "box-office" }],
      markets: [
        { groupItemTitle: "<29m", active: true, closed: false, outcomePrices: "[\"0.5\",\"0.5\"]" },
        { groupItemTitle: "29-34m", active: true, closed: false, outcomePrices: "[\"1\",\"0\"]" },
        { groupItemTitle: "34-39m", active: true, closed: false, outcomePrices: "[\"0.5\",\"0.5\"]" }
      ]
    });

    expect(market).toMatchObject({
      slug: "moana-2026-opening-weekend-box-office-20260706135043555",
      title: "Moana",
      releaseYear: 2026,
      weekendLabel: "opening",
      startDate: "2026-07-10",
      endDate: "2026-07-12",
      includePreview: true,
      bracketLabels: ["<29m", "34-39m"]
    });
  });

  it("parses The Numbers daily table and includes opening preview rows", () => {
    const rows = parseDailyBoxOfficeRows(`
## Daily Box Office Performance

| Date | Rank | Gross | %Change | Theaters | Per Theater | Total Gross | Days |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [Jul 9,2026](https://www.the-numbers.com/box-office-chart/daily/2026/07/09) | P | $4,500,000 |  | 0 |  | $4,500,000 |  |
| [Jul 10,2026](https://www.the-numbers.com/box-office-chart/daily/2026/07/10) | 2 | $12,000,000 |  | 3,500 | $3,428 | $16,500,000 | 1 |
| [Jul 11,2026](https://www.the-numbers.com/box-office-chart/daily/2026/07/11) | 2 | $14,000,000 | +17% | 3,500 | $4,000 | $30,500,000 | 2 |
`);

    const snapshot = buildWeekendSnapshot(
      {
        url: "https://polymarket.com/event/moana",
        slug: "moana",
        title: "Moana",
        releaseYear: 2026,
        weekendLabel: "opening",
        startDate: "2026-07-10",
        endDate: "2026-07-12",
        includePreview: true,
        bracketLabels: ["<29m", "29-34m", "34-39m"],
        endAt: "2026-07-13T12:00:00.000Z",
        movieUrl: "https://www.the-numbers.com/movie/Moana-%282026%29",
        addedAt: "2026-07-01T00:00:00.000Z"
      },
      rows,
      "https://www.the-numbers.com/movie/Moana-%282026%29"
    );

    expect(rows).toHaveLength(3);
    expect(snapshot).toMatchObject({
      totalGross: 30_500_000,
      status: "partial",
      reportedWindowDays: 2,
      expectedWindowDays: 3,
      previewGross: 4_500_000,
      currentBracket: "29-34m"
    });
  });

  it("alerts only when a market becomes bondable", () => {
    const previous = "State: abc=30500000:2:partial; def=pending";
    expect(shouldAlertOnBoxOfficeStateChange(null, previous)).toBe(false);
    expect(shouldAlertOnBoxOfficeStateChange(previous, previous)).toBe(false);
    expect(shouldAlertOnBoxOfficeStateChange(previous, "Bondable: abc=29-34m\nState: abc=30500000:3:complete; def=pending")).toBe(true);
    expect(shouldAlertOnBoxOfficeStateChange(previous, "State: abc=30500000:2:partial; def=1000000:1:partial")).toBe(false);
    expect(extractBoxOfficeStateMap(previous).get("abc")).toBe("30500000:2:partial");
  });

  it("does not re-alert for fetch recovery after a market is already complete", () => {
    const previousCompleteWithoutBondable = "State: abc=30500000:3:complete";
    const currentBondable = "Bondable: abc=29-34m\nState: abc=30500000:3:complete";
    const previousBondableError = "Bondable: abc=29-34m\nState: abc=error";

    expect(shouldAlertOnBoxOfficeStateChange(previousCompleteWithoutBondable, currentBondable)).toBe(false);
    expect(shouldAlertOnBoxOfficeStateChange(previousBondableError, currentBondable)).toBe(false);
    expect(shouldAlertOnBoxOfficeStateChange(currentBondable, "Bondable: abc=34-39m\nState: abc=35000000:3:complete")).toBe(true);
  });

  it("keeps prior bondable bracket visible during transient fetch errors", () => {
    const value = formatBoxOfficeWeekendValue(
      [
        {
          market: {
            url: "https://polymarket.com/event/moana",
            slug: "moana",
            title: "Moana",
            releaseYear: 2026,
            weekendLabel: "opening",
            startDate: "2026-07-10",
            endDate: "2026-07-12",
            includePreview: true,
            bracketLabels: ["<29m", "29-34m", "34-39m"],
            endAt: "2026-07-13T12:00:00.000Z",
            movieUrl: "https://www.the-numbers.com/movie/Moana-%282026%29",
            addedAt: "2026-07-01T00:00:00.000Z"
          },
          sourceUrl: "https://www.the-numbers.com/movie/Moana-%282026%29",
          totalGross: null,
          status: "error",
          reportedWindowDays: 0,
          expectedWindowDays: 3,
          previewGross: null,
          rows: [],
          currentBracket: null,
          error: "fetch failed"
        }
      ],
      new Map([["1pyiuq", "29-34m"]])
    );

    expect(value).toContain("fetch failed, kept bondable 29-34m");
    expect(extractBoxOfficeBondableMap(value).get("1pyiuq")).toBe("29-34m");
  });
});
