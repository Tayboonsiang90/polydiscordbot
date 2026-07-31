import { describe, expect, it } from "vitest";
import {
  extractTrumpSchedule,
  formatTrumpScheduleValue,
  getTrumpSchedulePollIntervalMinutes
} from "../src/integrations/trumpSchedule.js";

const sampleCalendarHtml = `
  <table>
    <tr><td><span>Friday,</span><span>May 29, 2026</span></td></tr>
    <tr>
      <td class="flex">
        <div class="hidden sm:flex"><div data-tooltip="Official Schedule"></div><div class="text-sm font-light">8:00 AM</div></div>
        <div class="flex-1">
          <div class="text-sm font-light text-gray-600 mt-2">The President participates in Executive Time</div>
          <div class="inline mr-2">The White House</div>
          <div class="inline">In-Town Pool</div>
        </div>
      </td>
    </tr>
    <tr>
      <td class="flex">
        <div class="hidden sm:flex"><div data-tooltip="Official Schedule"></div><div class="text-sm font-light">11:00 AM</div></div>
        <div class="flex-1">
          <div class="text-sm font-light text-gray-600 mt-2">The President receives his Intelligence Briefing</div>
          <div class="inline mr-2">The White House</div>
          <div class="inline">Closed Press</div>
        </div>
      </td>
    </tr>
    <tr><td><span>Thursday,</span><span>May 28, 2026</span></td></tr>
    <tr>
      <td class="flex">
        <div class="hidden sm:flex"><div data-tooltip="Press Briefing"></div><div class="text-sm font-light">2:00 PM</div></div>
        <div class="flex-1">
          <div class="text-sm font-light text-gray-600 mt-2">Press Briefing by the Press Secretary</div>
          <div class="inline mr-2">James S. Brady Press Briefing Room</div>
          <div class="inline">On Camera</div>
        </div>
      </td>
    </tr>
  </table>
`;

describe("Trump schedule monitor", () => {
  it("extracts schedule items for the target ET date only", () => {
    const schedule = extractTrumpSchedule(sampleCalendarHtml, "2026-05-29");

    expect(schedule.items).toEqual([
      {
        timeEt: "8:00 AM",
        type: "Official Schedule",
        detail: "The President participates in Executive Time",
        location: "The White House",
        press: "In-Town Pool"
      },
      {
        timeEt: "11:00 AM",
        type: "Official Schedule",
        detail: "The President receives his Intelligence Briefing",
        location: "The White House",
        press: "Closed Press"
      }
    ]);
  });

  it("formats a compact daily digest value", () => {
    const value = formatTrumpScheduleValue(
      extractTrumpSchedule(sampleCalendarHtml, "2026-05-29"),
      new Date("2026-05-29T13:30:00.000Z")
    );

    expect(value).toContain("Date ET: 2026-05-29");
    expect(value).toContain("Items: 2");
    expect(value).toContain("Flags: lid: none | travel: no | press: yes | remarks: no");
    expect(value).toContain("Next item: 11:00 AM - The President receives his Intelligence Briefing");
    expect(value).toContain("8:00 AM - The President participates in Executive Time | The White House | In-Town Pool | Official Schedule");
  });

  it("uses active daytime polling and slower off-hours polling", () => {
    expect(getTrumpSchedulePollIntervalMinutes({} as never, new Date("2026-05-29T13:00:00.000Z"))).toBe(15);
    expect(getTrumpSchedulePollIntervalMinutes({} as never, new Date("2026-05-29T03:00:00.000Z"))).toBe(60);
  });
});
