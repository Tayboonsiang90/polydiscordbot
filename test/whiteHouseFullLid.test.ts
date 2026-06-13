import { afterEach, describe, expect, it, vi } from "vitest";
import type { Integration } from "../src/integrations/types.js";
import {
  extractForthFullLid,
  extractRollCallFullLid,
  formatFullLidValue,
  fullLidShouldAlertOnChange,
  getWhiteHouseFullLidPollIntervalMinutes,
  refreshWhiteHouseFullLidPolymarketQueue
} from "../src/integrations/whiteHouseFullLid.js";

describe("White House full lid monitor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("discovers and activates the June 1-6 Full Lid Polymarket market", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          events: [
            {
              slug: "will-the-white-house-call-a-full-lid-by-630-pm-june-1-6",
              title: "Will the White House call a full lid by 6:30 PM? (June 1 - 6)",
              active: true,
              closed: false,
              tags: [{ slug: "lid" }, { slug: "trump-daily" }]
            }
          ]
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshWhiteHouseFullLidPolymarketQueue(
      buildIntegration({
        polymarketUrl: "https://polymarket.com/event/will-the-white-house-call-a-full-lid-by-630-pm-may-11-16"
      }),
      new Date("2026-06-05T16:00:00.000Z")
    );

    expect(result.activeUrl).toBe("https://polymarket.com/event/will-the-white-house-call-a-full-lid-by-630-pm-june-1-6");
    const settings = JSON.parse(result.settingsJson ?? "{}");
    expect(settings.lastFullLidDiscoveryAt).toBe("2026-06-05T16:00:00.000Z");
    expect(settings.polymarketMarkets).toEqual([
      {
        url: "https://polymarket.com/event/will-the-white-house-call-a-full-lid-by-630-pm-june-1-6",
        slug: "will-the-white-house-call-a-full-lid-by-630-pm-june-1-6",
        startAt: "2026-06-01T04:00:00.000Z",
        endAt: "2026-06-07T03:59:00.000Z",
        addedAt: "2026-06-05T16:00:00.000Z"
      }
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const searchUrl = String(fetchMock.mock.calls[0][0]);
    expect(searchUrl).toContain("q=full+lid");
    expect(searchUrl).toContain("events_tag=lid");
  });

  it("discovers single-day Full Lid markets with compact 630pm slugs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          events: [
            {
              slug: "will-the-white-house-call-a-full-lid-by-630pm-on-june-20-20260612215749899",
              title: "Will the White House call a full lid by 6:30PM on June 20?",
              active: true,
              closed: false,
              tags: [{ slug: "lid" }]
            }
          ]
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshWhiteHouseFullLidPolymarketQueue(buildIntegration(), new Date("2026-06-13T12:00:00.000Z"));
    const settings = JSON.parse(result.settingsJson ?? "{}");

    expect(settings.polymarketMarkets).toEqual([
      {
        url: "https://polymarket.com/event/will-the-white-house-call-a-full-lid-by-630pm-on-june-20-20260612215749899",
        slug: "will-the-white-house-call-a-full-lid-by-630pm-on-june-20-20260612215749899",
        startAt: "2026-06-20T04:00:00.000Z",
        endAt: "2026-06-21T03:59:00.000Z",
        addedAt: "2026-06-13T12:00:00.000Z"
      }
    ]);
  });
});

function buildIntegration(overrides: Partial<Integration> = {}): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "white-house-full-lid",
    displayName: "White House Full Lid",
    sourceUrl: "https://rollcall.com/factbase/trump/calendar/",
    polymarketUrl: null,
    alertRoleId: null,
    roleMessageId: null,
    roleChannelId: null,
    roleEmoji: null,
    settingsJson: null,
    pollIntervalMinutes: 1,
    status: "active",
    lastValue: null,
    lastCheckedAt: null,
    lastChangedAt: null,
    snapshotValue: null,
    snapshotCheckedAt: null,
    snapshotDate: null,
    createdAt: "2026-06-05T16:00:00.000Z",
    updatedAt: "2026-06-05T16:00:00.000Z",
    ...overrides
  };
}
