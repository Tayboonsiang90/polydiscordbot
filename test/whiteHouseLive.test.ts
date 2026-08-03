import { describe, expect, it } from "vitest";
import {
  extractWhiteHouseLiveSnapshot,
  formatWhiteHouseLiveValue,
  whiteHouseLiveAdapter,
  whiteHouseLiveShouldAlertOnChange
} from "../src/integrations/whiteHouseLive.js";

describe("White House Live adapter", () => {
  it("parses the official offline state", () => {
    const snapshot = extractWhiteHouseLiveSnapshot(`
      <div class="wp-block-whitehouse-topper__deck"><p>Monday, August 3, 2026</p></div>
      <div class="wp-block-whitehouse-live-schedule">
        <div class="wp-block-whitehouse-live-schedule__empty">
          <h2>Stay tuned – we'll be live again shortly.</h2>
        </div>
      </div>
    `);

    expect(snapshot).toEqual({
      status: "Offline",
      pageDate: "Monday, August 3, 2026",
      eventTitle: null,
      scheduledAt: null,
      watchUrl: null,
      message: "Stay tuned – we'll be live again shortly."
    });
  });

  it("parses a scheduled livestream", () => {
    const snapshot = extractWhiteHouseLiveSnapshot(`
      <div class="wp-block-whitehouse-topper__deck"><p>Monday, August 3, 2026</p></div>
      <div class="wp-block-whitehouse-live-schedule">
        <article class="wp-block-whitehouse-live-schedule__event">
          <h2>President Trump Delivers Remarks</h2>
          <time datetime="2026-08-03T18:00:00-04:00">6:00 PM</time>
          <a href="https://www.youtube.com/watch?v=example&utm_source=whitehouse">Watch live</a>
        </article>
      </div>
    `);

    expect(snapshot).toMatchObject({
      status: "Scheduled",
      pageDate: "Monday, August 3, 2026",
      eventTitle: "President Trump Delivers Remarks",
      watchUrl: "https://www.youtube.com/watch?v=example"
    });
    expect(snapshot.scheduledAt?.toISOString()).toBe("2026-08-03T22:00:00.000Z");
    expect(formatWhiteHouseLiveValue(snapshot)).toContain("Scheduled at: Aug 03, 2026, 18:00:00 ET");
  });

  it("detects an explicitly live event", () => {
    expect(
      extractWhiteHouseLiveSnapshot(`
        <div class="wp-block-whitehouse-live-schedule is-live" data-status="live">
          <h2>Press Briefing</h2>
          <iframe src="https://www.youtube.com/embed/example"></iframe>
        </div>
      `)
    ).toMatchObject({
      status: "Live",
      eventTitle: "Press Briefing",
      watchUrl: "https://www.youtube.com/embed/example"
    });
  });

  it("alerts for scheduled or live changes but not daily offline text", () => {
    const offlineMonday = "Status: Offline\nEvent: none\nScheduled at: not listed\nWatch: not available\nPage date: Monday";
    const offlineTuesday = "Status: Offline\nEvent: none\nScheduled at: not listed\nWatch: not available\nPage date: Tuesday";
    const scheduled =
      "Status: Scheduled\nEvent: Press Briefing\nScheduled at: Aug 03, 2026, 18:00:00 ET\nWatch: https://www.whitehouse.gov/live/";
    const live =
      "Status: Live\nEvent: Press Briefing\nScheduled at: Aug 03, 2026, 18:00:00 ET\nWatch: https://www.whitehouse.gov/live/";

    expect(whiteHouseLiveShouldAlertOnChange(offlineMonday, offlineTuesday)).toBe(false);
    expect(whiteHouseLiveShouldAlertOnChange(offlineTuesday, scheduled)).toBe(true);
    expect(whiteHouseLiveShouldAlertOnChange(scheduled, live)).toBe(true);
    expect(whiteHouseLiveShouldAlertOnChange(live, offlineTuesday)).toBe(false);
  });

  it("defines the expected monitor metadata", () => {
    expect(whiteHouseLiveAdapter.commandName).toBe("whlive");
    expect(whiteHouseLiveAdapter.defaultChannelName).toBe("whlive");
    expect(whiteHouseLiveAdapter.getPollIntervalMinutes?.({} as never)).toBe(1);
  });
});
