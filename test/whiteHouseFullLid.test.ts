import { describe, expect, it } from "vitest";
import {
  extractForthFullLid,
  extractRollCallFullLid,
  formatFullLidValue,
  fullLidShouldAlertOnChange,
  getWhiteHouseFullLidPollIntervalMinutes
} from "../src/integrations/whiteHouseFullLid.js";

describe("White House full lid monitor", () => {
  it("extracts the first Roll Call full lid for the target ET date", () => {
    const html = `
      <table>
        <tr><td><span>Monday,</span><span>May 11, 2026</span></td></tr>
        <tr><td><div>8:00 PM</div><div>White House Press Office: Full lid called</div></td></tr>
        <tr><td><span>Tuesday,</span><span>May 12, 2026</span></td></tr>
        <tr><td><div>6:15 PM</div><div>White House Press Office: Full lid called</div></td></tr>
        <tr><td><div>7:00 PM</div><div>White House Press Office: Full lid called again</div></td></tr>
      </table>`;

    expect(extractRollCallFullLid(html, "2026-05-12")).toMatchObject({
      source: "Roll Call",
      dateEt: "2026-05-12",
      timeEt: "6:15 PM",
      minutesEt: 18 * 60 + 15
    });
  });

  it("extracts a Forth full lid from page text", () => {
    const html = `<main><article><time>2026-05-12</time><p>At 6:05 PM the White House called a full lid.</p></article></main>`;

    expect(extractForthFullLid(html, "2026-05-12")).toMatchObject({
      source: "Forth",
      dateEt: "2026-05-12",
      timeEt: "6:05 PM",
      minutesEt: 18 * 60 + 5
    });
  });

  it("alerts once per ET date when a lid is found", () => {
    const previousValue = formatFullLidValue({
      dateEt: "2026-05-12",
      found: true,
      source: "Roll Call",
      timeEt: "6:05 PM",
      detail: "White House Press Office: Full lid called",
      beforeCutoff: true,
      rollCallStatus: "full lid found at 6:05 PM",
      forthStatus: "unavailable HTTP 429"
    });
    const duplicateValue = previousValue.replace("6:05 PM", "6:10 PM");
    const nextDayValue = previousValue.replaceAll("2026-05-12", "2026-05-13");

    expect(fullLidShouldAlertOnChange(null, previousValue)).toBe(true);
    expect(fullLidShouldAlertOnChange(previousValue, duplicateValue)).toBe(false);
    expect(fullLidShouldAlertOnChange(previousValue, nextDayValue)).toBe(true);
  });

  it("uses one-minute polling during the ET watch window", () => {
    expect(getWhiteHouseFullLidPollIntervalMinutes({}, new Date("2026-05-12T12:00:00.000Z"))).toBe(1);
    expect(getWhiteHouseFullLidPollIntervalMinutes({}, new Date("2026-05-12T03:00:00.000Z"))).toBe(60);
  });
});
