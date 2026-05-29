import { describe, expect, it } from "vitest";
import {
  extractWhiteHouseAliensCityRow,
  extractWhiteHouseAliensNycValue
} from "../src/integrations/whiteHouseAliensNyc.js";

function buildFlourishHtml(rows: Array<{ columns: unknown[] }>): string {
  return [
    "<html><script>",
    `_Flourish_data = ${JSON.stringify({ rows })},`,
    "\t\t\t\t_Flourish_visualisation_id = 12345",
    "</script></html>"
  ].join("\n");
}

describe("White House aliens NYC adapter parsing", () => {
  it("extracts the exact New York, NY row from the embedded Flourish table", () => {
    const html = buildFlourishHtml([
      { columns: ["New York City, NY", 12, "11/12/25 - 03/05/26", "Older charges", "CHINA", ""] },
      { columns: ["New York, NY", 4697, "01/22/25 - 05/20/26", "Immigration charges", "MEXICO", "✅"] }
    ]);

    expect(extractWhiteHouseAliensCityRow(html, "New York, NY")).toEqual({
      neighborhood: "New York, NY",
      totalArrests: 4697,
      datesOfArrest: "01/22/25 - 05/20/26",
      criminalCharges: "Immigration charges",
      countriesOfOrigin: "MEXICO",
      gangAffiliation: "✅"
    });
  });

  it("formats the NYC counter value for storage and Discord display", () => {
    const html = buildFlourishHtml([
      { columns: ["New York, NY", 4697, "01/22/25 - 05/20/26", "Immigration charges", "MEXICO", "✅"] }
    ]);

    expect(extractWhiteHouseAliensNycValue(html)).toContain("Total Arrests: 4697");
    expect(extractWhiteHouseAliensNycValue(html)).toContain("City: New York, NY");
  });

  it("throws when the target city is missing", () => {
    const html = buildFlourishHtml([{ columns: ["Los Angeles, CA", 100, "01/01/26 - 01/02/26", "", "", ""] }]);

    expect(() => extractWhiteHouseAliensCityRow(html, "New York, NY")).toThrow(
      "Could not find New York, NY in the White House aliens table"
    );
  });
});
