import { describe, expect, it } from "vitest";
import { extractBonbastUsdIrrValue } from "../src/integrations/bonbast.js";

describe("extractBonbastUsdIrrValue", () => {
  it("extracts a currency-like number from page text", () => {
    const html = `
      <html>
        <body>
          <h1>USD</h1>
          <span>Last price</span>
          <strong>612,500</strong>
        </body>
      </html>
    `;

    expect(extractBonbastUsdIrrValue(html)).toBe("612500");
  });

  it("extracts a currency-like number from chart scripts", () => {
    const html = `
      <html>
        <body></body>
        <script>
          const chartData = [[1710000000000, 601200], [1710000100000, 602100]];
        </script>
      </html>
    `;

    expect(extractBonbastUsdIrrValue(html)).toBe("602100");
  });

  it("throws when no plausible value exists", () => {
    expect(() => extractBonbastUsdIrrValue("<html><body>No values</body></html>")).toThrow(
      "Could not find a Bonbast USD/IRR value"
    );
  });
});
