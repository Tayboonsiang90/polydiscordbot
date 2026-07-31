import { describe, expect, it } from "vitest";
import { buildSnapshotCapturedEmbed } from "../src/embeds.js";
import type { Integration } from "../src/integrations/types.js";
import {
  buildPolymarketMentionScheduleValue,
  extractPolymarketMentionListings,
  getNextTwentyFourHourWindow,
  parsePolymarketMentionRuleSchedule,
  polymarketMentionScheduleAdapter
} from "../src/integrations/polymarketMentionSchedule.js";

const sampleMentionsHtml = `
<html>
  <body>
    <a href="/event/what-will-verizon-say-during-their-next-earnings-call">
      <span>24</span><span>Jul</span>
      <h2>What will Verizon say during their next earnings call?</h2>
      <span>Fri, 12:30 PM</span>
    </a>
    <a href="/event/what-will-be-said-on-the-next-all-in-podcast-july-24">
      <span>24</span><span>Jul</span>
      <h2>What will be said on the next All-In Podcast? (July 24)</h2>
      <span>Fri, 4:00 PM</span>
    </a>
    <a href="/event/what-will-mrbeast-say-during-his-next-youtube-video">
      <span>25</span><span>Jul</span>
      <h2>What will MrBeast say during his next YouTube video?</h2>
      <span>Sat, 3:00 PM</span>
    </a>
  </body>
</html>
`;

describe("Polymarket Mentions schedule adapter", () => {
  it("defines Discord metadata", () => {
    expect(polymarketMentionScheduleAdapter).toMatchObject({
      id: "polymarket-mention-schedule",
      commandName: "mentionsschedule",
      defaultChannelName: "mentions-schedule",
      sourceUrl: "https://polymarket.com/mentions",
      dailySnapshot: {
        timeZone: "Asia/Singapore",
        hour: 18,
        minute: 0,
        alwaysAlert: true
      }
    });
    expect(polymarketMentionScheduleAdapter.shouldAlertOnChange?.(null, "changed")).toBe(false);
  });

  it("parses scheduled rule text with an explicit ET timezone", () => {
    const parsed = parsePolymarketMentionRuleSchedule(
      "This market will resolve based on the next earnings announcement of Verizon currently scheduled to take place on July 24, 2026 at 8:30 AM ET."
    );

    expect(parsed?.scheduledAt.toISOString()).toBe("2026-07-24T12:30:00.000Z");
    expect(parsed?.originalListedTime).toBe("Jul 24, 2026, 8:30 AM ET");
  });

  it("extracts Polymarket card listing times as UTC fallback times", () => {
    const listings = extractPolymarketMentionListings(sampleMentionsHtml, new Date("2026-07-24T00:00:00.000Z"));

    expect(listings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "what-will-be-said-on-the-next-all-in-podcast-july-24",
          listedLabel: "24 Jul, Fri, 4:00 PM",
          listedAt: new Date("2026-07-24T16:00:00.000Z")
        })
      ])
    );
  });

  it("anchors the daily briefing window to 6:00 PM SGT", () => {
    expect(getNextTwentyFourHourWindow(new Date("2026-07-24T10:05:45.000Z"))).toEqual({
      startAt: new Date("2026-07-24T10:00:00.000Z"),
      endAt: new Date("2026-07-25T10:00:00.000Z")
    });
  });

  it("builds a chronological next-24-hours consolidated schedule", () => {
    const value = buildPolymarketMentionScheduleValue(
      [
        {
          slug: "what-will-verizon-say-during-their-next-earnings-call",
          title: "What will Verizon say during their next earnings call?",
          active: true,
          closed: false,
          archived: false,
          description:
            "This market will resolve based on the next earnings announcement of Verizon currently scheduled to take place on July 24, 2026 at 8:30 AM ET."
        },
        {
          slug: "what-will-mrbeast-say-during-his-next-youtube-video",
          title: "What will MrBeast say during his next YouTube video?",
          active: true,
          closed: false,
          archived: false,
          description: "MrBeast releases videos on https://www.youtube.com/@MrBeast."
        },
        {
          slug: "what-will-be-said-on-the-next-all-in-podcast-july-24",
          title: "What will be said on the next All-In Podcast? (July 24)",
          active: true,
          closed: false,
          archived: false,
          description: "The All-In Podcast is scheduled to release episodes every Friday."
        }
      ],
      sampleMentionsHtml,
      new Date("2026-07-24T10:00:00.000Z")
    );

    expect(value).toContain("Window SGT: 2026-07-24 18:00 SGT to 2026-07-25 18:00 SGT");
    expect(value).toContain("Markets scheduled: 2");
    expect(value).toContain(
      "1. **Jul 24, 2026, 8:30 PM SGT — What will Verizon say during their next earnings call?**"
    );
    expect(value).toContain(
      "2. **Jul 25, 2026, 12:00 AM SGT — What will be said on the next All-In Podcast? (July 24)**"
    );
    expect(value).toContain("[Polymarket](https://polymarket.com/event/what-will-verizon-say-during-their-next-earnings-call)");
    expect(value).toContain("Original: Jul 24, 2026, 8:30 AM ET");
    expect(value).not.toContain("MrBeast");
  });

  it("says clearly when no mention markets are scheduled in the next 24 hours", () => {
    const value = buildPolymarketMentionScheduleValue([], sampleMentionsHtml, new Date("2026-07-24T10:00:00.000Z"));

    expect(value).toContain("Window SGT: 2026-07-24 18:00 SGT to 2026-07-25 18:00 SGT");
    expect(value).toContain("Markets scheduled: 0");
    expect(value).toContain("Schedule: none");
  });

  it("renders the scheduled briefing as a compact Discord schedule", () => {
    const snapshotValue = [
      "Metric: Polymarket Mentions next 24 hours schedule",
      "Window SGT: 2026-08-01 18:00 SGT to 2026-08-02 18:00 SGT",
      "Markets scheduled: 1",
      "Schedule:",
      "1. **Aug 1, 2026, 9:00 PM SGT — MrBeast gaming video** · [Polymarket](https://polymarket.com/event/mrbeast)",
      "Source: https://polymarket.com/mentions"
    ].join("\n");
    const integration = {
      adapterId: "polymarket-mention-schedule",
      displayName: "Polymarket Mentions Schedule",
      sourceUrl: "https://polymarket.com/mentions",
      polymarketUrl: null,
      settingsJson: null,
      snapshotCheckedAt: "2026-08-01T10:00:05.000Z",
      status: "active"
    } as Integration;

    const embed = buildSnapshotCapturedEmbed({
      integration,
      snapshotDate: "2026-08-01",
      snapshotValue,
      snapshotLabel: "6:00 PM SGT next-24-hours briefing",
      shouldAlert: true
    }).toJSON();

    expect(embed.title).toBe("Polymarket Mentions Schedule - 6:00 PM SGT next-24-hours briefing");
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Next 24 hours",
          value: expect.stringContaining("2026-08-01 18:00 SGT to 2026-08-02 18:00 SGT")
        }),
        expect.objectContaining({ name: "Schedule", value: expect.stringContaining("MrBeast gaming video") })
      ])
    );
  });
});
