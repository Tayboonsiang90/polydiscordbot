import { describe, expect, it } from "vitest";
import { extractLatestFdicFailedBank, extractLatestFdicFailedBankValue } from "../src/integrations/fdicFailedBanks.js";

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
});
