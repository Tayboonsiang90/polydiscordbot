import { describe, expect, it } from "vitest";
import {
  buildPolymarketMentionScheduleValue,
  extractPolymarketMentionListings,
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
      sourceUrl: "https://polymarket.com/mentions"
    });
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

  it("builds a chronological tomorrow-SGT consolidated schedule", () => {
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
      new Date("2026-07-24T02:00:00.000Z")
    );

    expect(value).toContain("Tomorrow SGT date: 2026-07-25");
    expect(value).toContain("Markets scheduled: 2");
    expect(value).toContain("1. 2026-07-25 00:00 SGT — What will be said on the next All-In Podcast? (July 24)");
    expect(value).toContain("2. 2026-07-25 23:00 SGT — What will MrBeast say during his next YouTube video?");
    expect(value).toContain("Original: 24 Jul, Fri, 4:00 PM (timezone not shown on Polymarket card; treated as UTC)");
    expect(value).not.toContain("Verizon");
  });

  it("says clearly when no mention markets are scheduled tomorrow in Singapore", () => {
    const value = buildPolymarketMentionScheduleValue([], sampleMentionsHtml, new Date("2026-07-24T02:00:00.000Z"));

    expect(value).toContain("Tomorrow SGT date: 2026-07-25");
    expect(value).toContain("Markets scheduled: 0");
    expect(value).toContain("Schedule: none");
  });
});
