import { describe, expect, it } from "vitest";
import {
  formatMetaDaoCredibleFundraiseValue,
  parseMetaDaoFundraisePageSnapshot
} from "../src/integrations/metadaoCredibleFundraise.js";

describe("MetaDAO Credible fundraise adapter", () => {
  it("parses visible official page totals instead of on-chain fallback zeros", () => {
    const snapshot = parseMetaDaoFundraisePageSnapshot(`
      Credible Finance
      $21,006,692 committed
      Active
      1050%of $2,000,000 minimum
      $250,000 allowance
      Loading contributors...
      491
      Contributors
    `);

    expect(snapshot.totalCommittedAmount).toBe(21_006_692_000_000n);
    expect(snapshot.contributorCount).toBe(491);
    expect(snapshot.state).toBe("Active");
    expect(snapshot.minimumRaiseAmount).toBe(2_000_000_000_000n);
    expect(snapshot.allowanceAmount).toBe(250_000_000_000n);
  });

  it("formats the Discord value around committed total and contributors", () => {
    const value = formatMetaDaoCredibleFundraiseValue({
      minimumRaiseAmount: 2_000_000_000_000n,
      totalCommittedAmount: 21_006_692_000_000n,
      contributorCount: 491,
      state: "Active",
      dataSource: "Official MetaDAO fundraise page",
      allowanceAmount: 250_000_000_000n
    });

    expect(value).toContain("Total committed: $21,006,692.00");
    expect(value).toContain("Contributors: 491");
    expect(value).toContain("Status: Active");
    expect(value).toContain("Progress to minimum: 1,050.33%");
    expect(value).toContain("Allowance: $250,000.00");
    expect(value).toContain("Data source: Official MetaDAO fundraise page");
    expect(value).not.toContain("Launch account:");
  });

  it("throws on Vercel checkpoint text instead of emitting a zero value", () => {
    expect(() =>
      parseMetaDaoFundraisePageSnapshot("Vercel Security Checkpoint We're verifying your browser Enable JavaScript to continue")
    ).toThrow("refusing to emit a zero committed value");
  });
});
