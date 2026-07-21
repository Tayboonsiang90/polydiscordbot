import { describe, expect, it } from "vitest";
import {
  extractLatestFdicFailedBank,
  extractLatestFdicFailedBankValue,
  normalizeFdicFailedBanksSearchEvent
} from "../src/integrations/fdicFailedBanks.js";

const sampleHtml = `
  <table>
    <tbody>
      <tr>
        <td><a>Community Bank and Trust - West Georgia</a></td>
        <td>LaGrange</td>
        <td>Georgia</td>
        <td>25796</td>
        <td>Anchor Bank</td>
        <td>May 1, 2026</td>
        <td>10551</td>
      </tr>
    </tbody>
  </table>
`;

describe("FDIC failed banks adapter", () => {
  it("extracts the latest failed bank row", () => {
    expect(extractLatestFdicFailedBank(sampleHtml)).toEqual({
      bankName: "Community Bank and Trust - West Georgia",
      city: "LaGrange",
      state: "Georgia",
      cert: "25796",
      acquiringInstitution: "Anchor Bank",
      closingDate: "May 1, 2026",
      fund: "10551"
    });
  });

  it("formats the latest row as a stable monitor value", () => {
    expect(extractLatestFdicFailedBankValue(sampleHtml)).toContain("Bank: Community Bank and Trust - West Georgia");
    expect(extractLatestFdicFailedBankValue(sampleHtml)).toContain("Closing date: May 1, 2026");
  });

  it("throws when no failed bank row is present", () => {
    expect(() => extractLatestFdicFailedBank("<html></html>")).toThrow("Could not find the latest failed bank row");
  });

  it("normalizes active bank-failure Gamma events using Gamma start/end dates", () => {
    const market = normalizeFdicFailedBanksSearchEvent(
      {
        slug: "us-bank-failure-by-december-31-2026-20260720194747677",
        title: "US bank failure by December 31, 2026?",
        active: true,
        closed: false,
        seriesSlug: "bank-failure",
        startDate: "2026-07-20T19:54:42.528Z",
        endDate: "2027-01-01T04:59:00Z"
      },
      new Date("2026-07-21T00:00:00.000Z")
    );

    expect(market).toEqual({
      url: "https://polymarket.com/event/us-bank-failure-by-december-31-2026-20260720194747677",
      slug: "us-bank-failure-by-december-31-2026-20260720194747677",
      startAt: "2026-07-20T19:54:42.528Z",
      endAt: "2027-01-01T04:59:00.000Z",
      addedAt: "2026-07-21T00:00:00.000Z"
    });
  });

  it("rejects non-bank-failure Gamma events", () => {
    expect(
      normalizeFdicFailedBanksSearchEvent({
        slug: "some-other-market",
        title: "Some other market",
        active: true,
        closed: false,
        seriesSlug: "other"
      })
    ).toBeNull();
  });
});
