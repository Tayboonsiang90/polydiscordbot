import { describe, expect, it } from "vitest";
import {
  extractLatestTreasuryMtsMonth,
  extractTreasuryMtsMonth,
  formatTreasuryMtsValue,
  treasuryMtsDeficitAdapter
} from "../src/integrations/treasuryMtsDeficit.js";

const sampleRows = {
  data: [
    {
      record_date: "2026-05-31",
      classification_desc: "FY 2025",
      data_type_cd: "S",
      record_type_cd: "SL",
      sequence_number_cd: "1"
    },
    {
      record_date: "2026-05-31",
      classification_desc: "May",
      current_month_gross_rcpt_amt: "300000000000.00",
      current_month_gross_outly_amt: "600000000000.00",
      current_month_dfct_sur_amt: "300000000000.00",
      data_type_cd: "D",
      record_type_cd: "MTH",
      sequence_number_cd: "1.8"
    },
    {
      record_date: "2026-05-31",
      classification_desc: "FY 2026",
      data_type_cd: "S",
      record_type_cd: "SL",
      sequence_number_cd: "2"
    },
    {
      record_date: "2026-05-31",
      classification_desc: "May",
      current_month_gross_rcpt_amt: "335512183227.42",
      current_month_gross_outly_amt: "628160645311.16",
      current_month_dfct_sur_amt: "292648462083.74",
      data_type_cd: "D",
      record_type_cd: "MTH",
      sequence_number_cd: "2.8"
    }
  ]
};

const baselineRows = {
  data: [
    {
      record_date: "2025-09-30",
      classification_desc: "FY 2024",
      data_type_cd: "S",
      record_type_cd: "SL",
      sequence_number_cd: "1"
    },
    {
      record_date: "2025-09-30",
      classification_desc: "September",
      current_month_dfct_sur_amt: "-80288798313.57",
      data_type_cd: "D",
      record_type_cd: "MTH",
      sequence_number_cd: "1.12"
    },
    {
      record_date: "2025-09-30",
      classification_desc: "FY 2025",
      data_type_cd: "S",
      record_type_cd: "SL",
      sequence_number_cd: "2"
    },
    {
      record_date: "2025-09-30",
      classification_desc: "September",
      current_month_dfct_sur_amt: "-197949630362.16",
      data_type_cd: "D",
      record_type_cd: "MTH",
      sequence_number_cd: "2.12"
    }
  ]
};

describe("Treasury MTS deficit integration", () => {
  it("extracts the latest current-month row from the newest fiscal year section", () => {
    expect(extractLatestTreasuryMtsMonth(sampleRows)).toEqual({
      reportDate: "2026-05-31",
      reportMonth: "May 2026",
      fiscalYearSection: "FY 2026",
      deficitSurplusAmount: 292648462083.74,
      receiptsAmount: 335512183227.42,
      outlaysAmount: 628160645311.16
    });
  });

  it("extracts the September 2025 baseline from the FY 2025 section", () => {
    expect(extractTreasuryMtsMonth(baselineRows, "2025-09-30", "September")).toMatchObject({
      reportDate: "2025-09-30",
      reportMonth: "September 2025",
      fiscalYearSection: "FY 2025",
      deficitSurplusAmount: -197949630362.16
    });
  });

  it("formats latest report and market comparison context", () => {
    const value = formatTreasuryMtsValue(
      extractLatestTreasuryMtsMonth(sampleRows),
      extractTreasuryMtsMonth(baselineRows, "2025-09-30", "September")
    );

    expect(value).toContain("Metric: Monthly Treasury Statement current month deficit/surplus");
    expect(value).toContain("Latest report: May 2026");
    expect(value).toContain("Current Month Deficit/Surplus Amount: $292.65B deficit ($292,648,462,083.74)");
    expect(value).toContain("September 2025 baseline: $197.95B surplus (-$197,949,630,362.16)");
    expect(value).toContain("December 2026 must report a lower monthly deficit than September 2025.");
  });

  it("defines expected Discord metadata", () => {
    expect(treasuryMtsDeficitAdapter).toMatchObject({
      id: "treasury-mts-deficit",
      commandName: "treasurymts",
      defaultChannelName: "treasurymts",
      alertRoleName: "Treasury MTS Alerts"
    });
  });
});
