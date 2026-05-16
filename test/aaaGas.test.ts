import { describe, expect, it } from "vitest";
import { extractAaaRegularGasCurrentAvg } from "../src/integrations/aaaGas.js";

describe("extractAaaRegularGasCurrentAvg", () => {
  it("extracts Regular from the Current Avg. table row", () => {
    const html = `
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Regular</th>
            <th>Mid-Grade</th>
            <th>Premium</th>
            <th>Diesel</th>
            <th>E85</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Current Avg.</th>
            <td>$4.483</td>
            <td>$4.967</td>
            <td>$5.341</td>
            <td>$5.659</td>
            <td>$3.627</td>
          </tr>
        </tbody>
      </table>
    `;

    expect(extractAaaRegularGasCurrentAvg(html)).toBe("4.483");
  });

  it("extracts Regular from normalized page text", () => {
    const html = `
      <html>
        <body>
          <h1>National average gas prices</h1>
          Regular Mid-Grade Premium Diesel E85
          Current Avg. $4.483 $4.967 $5.341 $5.659 $3.627
        </body>
      </html>
    `;

    expect(extractAaaRegularGasCurrentAvg(html)).toBe("4.483");
  });

  it("throws when no current average is present", () => {
    expect(() => extractAaaRegularGasCurrentAvg("<html><body>No gas price here</body></html>")).toThrow(
      "Could not find AAA Current Avg. Regular gas price"
    );
  });
});
