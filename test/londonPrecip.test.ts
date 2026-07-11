import { describe, expect, it } from "vitest";
import {
  buildLondonPrecipitationAlphaValue,
  extractHeathrowClimateRows,
  extractInfoclimatLondonMonthlyPrecipitation,
  extractLondonPrecipitationOfficialValue,
  extractLondonPrecipitationValue,
  extractWeatherComPwsDailyPrecipitation,
  getLondonPrecipSettings,
  isValidLondonPrecipPeriod,
  londonPrecipShouldAlertOnChange
} from "../src/integrations/londonPrecip.js";
import type { Integration } from "../src/integrations/types.js";

const sampleText = `
Heathrow (London Airport)
   yyyy  mm   tmax    tmin      af    rain     sun
   2026   4   17.8     6.8       0     4.8   223.1#  Provisional
   2026   5   19.4    10.1       0    42.6   180.0#  Provisional
`;

const infoclimatHtml = `
  <table>
    <tr><th></th><th>janv.2026</th><th>fev.2026</th><th>mars2026</th><th>avr.2026</th><th>mai2026</th></tr>
    <tr><td>CumulPrécips</td><td>104,6</td><td>44,4</td><td>1,0</td><td>0,0</td><td>12,4</td></tr>
    <tr><td>Mise àjour</td><td>2026-02-02 09:21:01</td><td>2026-03-02 09:20:39</td><td>2026-04-02 08:21:01</td><td>2026-05-02 08:21:07</td><td>2026-05-29 10:37:13</td></tr>
  </table>
`;

const londonIntegration: Integration = {
  id: 1,
  guildId: "guild",
  channelId: "channel",
  adapterId: "met-office-london-precip",
  displayName: "Met Office London Precipitation",
  sourceUrl: "https://www.metoffice.gov.uk/pub/data/weather/uk/climate/stationdata/heathrowdata.txt",
  polymarketUrl: null,
  alertRoleId: null,
  roleMessageId: null,
  roleChannelId: null,
  roleEmoji: null,
  settingsJson: JSON.stringify({ year: 2026, month: 6 }),
  pollIntervalMinutes: 5,
  status: "active",
  lastValue: null,
  lastCheckedAt: null,
  lastChangedAt: null,
  snapshotValue: null,
  snapshotCheckedAt: null,
  snapshotDate: null,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z"
};

describe("Met Office London precipitation adapter", () => {
  it("extracts Heathrow monthly rain from Met Office station data", () => {
    expect(extractHeathrowClimateRows(sampleText)).toEqual([
      { year: 2026, month: 4, rainText: "4.8", provisional: true },
      { year: 2026, month: 5, rainText: "42.6", provisional: true }
    ]);

    expect(extractLondonPrecipitationValue(sampleText, { year: 2026, month: 5 })).toBe(
      [
        "Metric: Met Office Heathrow precipitation",
        "Period: 2026-05",
        "Current total: 42.6 mm",
        "Data status: official Met Office station data",
        "Official Met Office row: 42.6 mm (Provisional)",
        "Alpha Infoclimat cumulative: not available"
      ].join("\n")
    );
  });

  it("returns a stable not-published value before the monthly row appears", () => {
    expect(extractLondonPrecipitationValue(sampleText, { year: 2026, month: 6 })).toContain("Current total: not published yet");
    expect(extractLondonPrecipitationValue(sampleText, { year: 2026, month: 6 })).toContain(
      "Latest official Met Office row: 2026-05 = 42.6 mm"
    );
  });

  it("extracts and uses Infoclimat alpha cumulative precipitation", () => {
    const official = extractLondonPrecipitationOfficialValue(
      sampleText.replace("   2026   5   19.4    10.1       0    42.6   180.0#  Provisional", ""),
      { year: 2026, month: 5 }
    );
    const alpha = extractInfoclimatLondonMonthlyPrecipitation(infoclimatHtml, { year: 2026, month: 5 }, "https://example.com");

    expect(alpha).toEqual({
      totalText: "12.4",
      total: 12.4,
      updatedAt: "2026-05-29 10:37:13",
      sourceName: "Infoclimat",
      sourceUrl: "https://example.com"
    });
    expect(buildLondonPrecipitationAlphaValue(official, alpha, { year: 2026, month: 5 })).toContain(
      "Current total: 12.4 mm"
    );
    expect(buildLondonPrecipitationAlphaValue(official, alpha, { year: 2026, month: 5 })).toContain(
      "Data status: alpha Infoclimat"
    );
  });

  it("reports Infoclimat daily alpha from cumulative changes", () => {
    const official = extractLondonPrecipitationOfficialValue(
      sampleText.replace("   2026   5   19.4    10.1       0    42.6   180.0#  Provisional", ""),
      { year: 2026, month: 5 }
    );
    const alpha = extractInfoclimatLondonMonthlyPrecipitation(infoclimatHtml, { year: 2026, month: 5 }, "https://example.com");
    const previousValue = [
      "Metric: Met Office Heathrow precipitation",
      "Period: 2026-05",
      "Current total: 10.0 mm",
      "Alpha Infoclimat cumulative: 10.0 mm (updated 2026-05-28 10:00:00)"
    ].join("\n");

    const value = buildLondonPrecipitationAlphaValue(official, alpha, { year: 2026, month: 5 }, previousValue);

    expect(value).toContain("Alpha daily estimate: 2.4 mm since previous alpha update");
    expect(value).toContain("Alpha previous cumulative: 10.0 mm (updated 2026-05-28 10:00:00)");
  });

  it("extracts Weather.com PWS daily precipitation fallback values", () => {
    expect(
      extractWeatherComPwsDailyPrecipitation(
        {
          observations: [
            {
              stationID: "ILONDON513",
              obsTimeLocal: "2026-07-10 23:59:49",
              metric: {
                precipTotal: 2.4
              }
            }
          ]
        },
        "2026-07-10"
      )
    ).toEqual({ date: "2026-07-10", precipitation: 2.4 });
  });

  it("alerts when Infoclimat publishes a zero-rainfall daily update", () => {
    expect(
      londonPrecipShouldAlertOnChange(
        [
          "Metric: Met Office Heathrow precipitation",
          "Period: 2026-05",
          "Current total: 12.4 mm",
          "Alpha Infoclimat cumulative: 12.4 mm (updated 2026-05-28 10:00:00)"
        ].join("\n"),
        [
          "Metric: Met Office Heathrow precipitation",
          "Period: 2026-05",
          "Current total: 12.4 mm",
          "Alpha Weather.com PWS near Heathrow cumulative: 12.4 mm (updated 2026-05-29)",
          "Alpha daily estimate: 0.0 mm since previous alpha update"
        ].join("\n")
      )
    ).toBe(true);
  });

  it("alerts only when the displayed value changes", () => {
    expect(
      londonPrecipShouldAlertOnChange(
        "Metric: Met Office Heathrow precipitation\nCurrent total: 42.6 mm\nStatus: Provisional",
        "Metric: Met Office Heathrow precipitation\nCurrent total: 42.6 mm\nStatus: Final"
      )
    ).toBe(false);
    expect(londonPrecipShouldAlertOnChange("Current total: not published yet", "Current total: 42.6 mm")).toBe(true);
  });

  it("reads stored year and month settings", () => {
    expect(getLondonPrecipSettings(londonIntegration)).toEqual({ year: 2026, month: 6 });
  });

  it("validates supported periods", () => {
    expect(isValidLondonPrecipPeriod(2026, 5)).toBe(true);
    expect(isValidLondonPrecipPeriod(1947, 12)).toBe(false);
    expect(isValidLondonPrecipPeriod(2026, 13)).toBe(false);
  });
});
