import { describe, expect, it } from "vitest";
import {
  buildHendonMobTopThreeSignature,
  extractHendonMobMoneyListRows,
  formatHendonMobMoneyListValue,
  hendonMobMoneyListAdapter,
  shouldAlertOnHendonMobMoneyListChange
} from "../src/integrations/hendonMobMoneyList.js";

const sampleHtml = `
  <table class="table table--ranking-list">
    <tbody>
      <tr>
        <td>1st</td>
        <td><img alt="Spain" /></td>
        <td><a href="/player.php?a=r&n=164690">Adrian Mateos</a></td>
        <td>US$ 7,909,707</td>
      </tr>
      <tr>
        <td>2nd</td>
        <td><img title="United States" /></td>
        <td><a href="/player.php?a=r&n=281">Bryn Kenney</a></td>
        <td>US$ 6,988,180</td>
      </tr>
      <tr>
        <td>3rd</td>
        <td>Latvia</td>
        <td><a href="/player.php?a=r&n=542900">Aleksejs Ponakovs</a></td>
        <td>US$ 5,123,456</td>
      </tr>
      <tr>
        <td>4th</td>
        <td>Finland</td>
        <td><a href="/player.php?a=r&n=500000">Eelis Pärssinen</a></td>
        <td>US$ 4,000,000</td>
      </tr>
    </tbody>
  </table>
`;

describe("Hendon Mob Money List adapter", () => {
  it("parses Hendon Mob money-list rows", () => {
    const rows = extractHendonMobMoneyListRows(sampleHtml, 3);

    expect(rows).toEqual([
      { rank: 1, player: "Adrian Mateos", country: "Spain", winnings: "US$7,909,707" },
      { rank: 2, player: "Bryn Kenney", country: "United States", winnings: "US$6,988,180" },
      { rank: 3, player: "Aleksejs Ponakovs", country: "Latvia", winnings: "US$5,123,456" }
    ]);
  });

  it("formats top-three context plus the wider top-list rows", () => {
    const value = formatHendonMobMoneyListValue(extractHendonMobMoneyListRows(sampleHtml, 4));

    expect(value).toContain("Top 3: #1 Adrian Mateos (Spain) | #2 Bryn Kenney (United States) | #3 Aleksejs Ponakovs (Latvia)");
    expect(value).toContain("Rank 4: Eelis Pärssinen (Finland) - US$4,000,000");
    expect(value).toContain("Tracking scope: top 3 rank order only");
  });

  it("alerts only when top-three rank order changes", () => {
    const previous = formatHendonMobMoneyListValue(extractHendonMobMoneyListRows(sampleHtml, 4));
    const winningsOnlyChange = previous.replace("US$7,909,707", "US$8,100,000");
    const rankChange = previous
      .replace("Rank 2: Bryn Kenney (United States)", "Rank 2: Aleksejs Ponakovs (Latvia)")
      .replace("Rank 3: Aleksejs Ponakovs (Latvia)", "Rank 3: Bryn Kenney (United States)");

    expect(shouldAlertOnHendonMobMoneyListChange(null, previous)).toBe(false);
    expect(shouldAlertOnHendonMobMoneyListChange(previous, winningsOnlyChange)).toBe(false);
    expect(shouldAlertOnHendonMobMoneyListChange(previous, rankChange)).toBe(true);
  });

  it("builds a top-three signature", () => {
    const value = formatHendonMobMoneyListValue(extractHendonMobMoneyListRows(sampleHtml, 4));

    expect(buildHendonMobTopThreeSignature(value)).toBe(
      "1:Adrian Mateos (Spain)|2:Bryn Kenney (United States)|3:Aleksejs Ponakovs (Latvia)"
    );
  });

  it("polls hourly", () => {
    expect(hendonMobMoneyListAdapter.getPollIntervalMinutes?.({} as never)).toBe(60);
  });
});
