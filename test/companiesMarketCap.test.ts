import { describe, expect, it } from "vitest";
import {
  buildCompaniesMarketCapRankSignature,
  companiesMarketCapAdapter,
  extractCompaniesMarketCapTopRows,
  formatCompaniesMarketCapValue,
  shouldAlertOnCompaniesMarketCapChange
} from "../src/integrations/companiesMarketCap.js";

const sampleCsv = [
  '"Rank","Name","Symbol","marketcap","price (USD)","country"',
  '"1","NVIDIA","NVDA","4912260841472","202.81","United States"',
  '"2","Apple","AAPL","4901757779968","333.74","United States"',
  '"3","Alphabet (Google)","GOOG","4223554551808","346.12","United States"',
  '"4","Microsoft","MSFT","2925466222592","393.82","United States"',
  '"5","Amazon","AMZN","2659480240128","247.23","United States"',
  '"6","TSMC","TSM","2066135646208","398.37","Taiwan"',
  '"7","Broadcom","AVGO","1764229775360","370.825","United States"',
  '"8","Saudi Aramco","2222.SR","1718615783221","7.10444","Saudi Arabia"',
  '"9","Meta Platforms (Facebook)","META","1639846903808","646.01","United States"',
  '"10","SpaceX","SPCX","1633467367424","123.99","United States"',
  '"11","Tesla","TSLA","1430329884672","380.84","United States"'
].join("\n");

describe("CompaniesMarketCap adapter", () => {
  it("parses the CompaniesMarketCap CSV top 10", () => {
    const rows = extractCompaniesMarketCapTopRows(sampleCsv, 10);

    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({ rank: 1, name: "NVIDIA", symbol: "NVDA", marketCap: 4912260841472 });
    expect(rows[8]).toMatchObject({ rank: 9, name: "Meta Platforms (Facebook)", symbol: "META" });
  });

  it("formats a compact top 10 value", () => {
    const value = formatCompaniesMarketCapValue(extractCompaniesMarketCapTopRows(sampleCsv, 10));

    expect(value).toContain("Top 3: #1 NVIDIA (NVDA) | #2 Apple (AAPL) | #3 Alphabet (Google) (GOOG)");
    expect(value).toContain("Rank 1: NVIDIA (NVDA) - $4.91T");
    expect(value).toContain("Rank 10: SpaceX (SPCX) - $1.63T");
    expect(value).toContain("Tracking scope: top 10 rank order only");
  });

  it("alerts only when the company rank order changes", () => {
    const previous = formatCompaniesMarketCapValue(extractCompaniesMarketCapTopRows(sampleCsv, 10));
    const capOnlyChange = previous.replace("$4.91T", "$4.95T");
    const rankChange = previous
      .replace("Rank 1: NVIDIA (NVDA) - $4.91T", "Rank 1: Apple (AAPL) - $4.90T")
      .replace("Rank 2: Apple (AAPL) - $4.90T", "Rank 2: NVIDIA (NVDA) - $4.91T");

    expect(shouldAlertOnCompaniesMarketCapChange(null, previous)).toBe(false);
    expect(shouldAlertOnCompaniesMarketCapChange(previous, capOnlyChange)).toBe(false);
    expect(shouldAlertOnCompaniesMarketCapChange(previous, rankChange)).toBe(true);
  });

  it("builds a rank signature from company order only", () => {
    const value = formatCompaniesMarketCapValue(extractCompaniesMarketCapTopRows(sampleCsv, 3));

    expect(buildCompaniesMarketCapRankSignature(value)).toBe(
      "1:NVIDIA (NVDA)|2:Apple (AAPL)|3:Alphabet (Google) (GOOG)"
    );
  });

  it("polls top 10 rankings every five minutes", () => {
    expect(companiesMarketCapAdapter.getPollIntervalMinutes?.({} as never)).toBe(5);
  });
});
