import { describe, expect, it } from "vitest";
import {
  extractLatestWhiteHouseBriefingValue,
  extractWhiteHouseBriefings,
  whiteHouseBriefingsAdapter
} from "../src/integrations/whiteHouseBriefings.js";

const sampleHtml = `
  <main>
    <li class="wp-block-post post-42587 post type-post status-publish hentry category-briefings-statements">
      <h2 class="wp-block-post-title">
        <a href="https://www.whitehouse.gov/briefings-statements/2026/05/congressional-bill-s-4530-signed-into-law/">
          Congressional Bill S. 4530 Signed into Law
        </a>
      </h2>
      <div class="taxonomy-category">Briefings &amp; Statements</div>
      <time datetime="2026-05-29T17:54:28-04:00">May 29, 2026</time>
    </li>
    <li class="wp-block-post post-42211 post type-post status-publish hentry category-briefings-statements">
      <h2 class="wp-block-post-title">
        <a href="/briefings-statements/2026/05/presidential-message-on-pentecost/">Presidential Message on Pentecost</a>
      </h2>
      <div class="taxonomy-category">Briefings &amp; Statements</div>
      <time datetime="2026-05-24T16:26:47-04:00">May 24, 2026</time>
    </li>
  </main>
`;

describe("White House briefings adapter", () => {
  it("extracts listing posts newest first", () => {
    expect(extractWhiteHouseBriefings(sampleHtml)).toEqual([
      {
        id: "/briefings-statements/2026/05/congressional-bill-s-4530-signed-into-law",
        title: "Congressional Bill S. 4530 Signed into Law",
        category: "Briefings & Statements",
        publishedAt: new Date("2026-05-29T21:54:28.000Z"),
        url: "https://www.whitehouse.gov/briefings-statements/2026/05/congressional-bill-s-4530-signed-into-law/"
      },
      {
        id: "/briefings-statements/2026/05/presidential-message-on-pentecost",
        title: "Presidential Message on Pentecost",
        category: "Briefings & Statements",
        publishedAt: new Date("2026-05-24T20:26:47.000Z"),
        url: "https://www.whitehouse.gov/briefings-statements/2026/05/presidential-message-on-pentecost/"
      }
    ]);
  });

  it("formats the latest post as a stable monitor value", () => {
    expect(extractLatestWhiteHouseBriefingValue(sampleHtml)).toBe(
      [
        "Title: Congressional Bill S. 4530 Signed into Law",
        "Category: Briefings & Statements",
        "Published at: 2026-05-29T21:54:28.000Z",
        "URL: https://www.whitehouse.gov/briefings-statements/2026/05/congressional-bill-s-4530-signed-into-law/"
      ].join("\n")
    );
  });

  it("uses event polling so every unseen statement can alert", () => {
    expect(whiteHouseBriefingsAdapter.fetchEventUpdates).toBeDefined();
    expect(whiteHouseBriefingsAdapter.getPollIntervalMinutes?.({} as never)).toBe(15);
  });

  it("throws when no listing posts are present", () => {
    expect(() => extractWhiteHouseBriefings("<html></html>")).toThrow("Could not find White House briefing or statement posts");
  });
});
