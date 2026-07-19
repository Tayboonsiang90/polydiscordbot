import { describe, expect, it } from "vitest";
import { parseBnoWhPoolReports, parseForthWhPoolReports } from "../src/integrations/whiteHousePoolUpdates.js";

describe("White House pool updates adapter parsing", () => {
  it("extracts BNO press-pool cards newest first", () => {
    const html = `
      <article class="report-card">
        <h2><a href="/whpool/old">In-town pool report #2 -- gathering</a></h2>
        <time datetime="2026-07-18T17:00:00.000Z">Jul 18, 2026, 01:00 PM EDT</time>
        <span class="sender"> · The Office of Communications</span>
        <p class="excerpt">Pool is gathering.</p>
      </article>
      <article class="report-card">
        <h2><a href="/whpool/new">WH travel pool report 3 — lid</a></h2>
        <time datetime="2026-07-18T19:08:50.000Z">Jul 18, 2026, 03:08 PM EDT</time>
        <span class="sender"> · The Office of Communications</span>
        <p class="excerpt">The White House press office announced a travel photo lid.</p>
      </article>
    `;

    const reports = parseBnoWhPoolReports(html);

    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({
      id: "bno:/whpool/new",
      source: "BNO",
      title: "WH travel pool report 3 — lid",
      url: "https://bnonews.com/whpool/new",
      sender: "The Office of Communications",
      excerpt: "The White House press office announced a travel photo lid."
    });
    expect(reports[0].publishedAt.toISOString()).toBe("2026-07-18T19:08:50.000Z");
  });

  it("extracts Forth press-pool links when the page is accessible", () => {
    const html = `
      <main>
        <article>
          <a href="/lists/whpool/abc123">In-town pool report #6 -- lid</a>
          <time datetime="2026-07-11T22:03:00.000Z">July 11, 2026 at 06:03 PM EDT</time>
          <p>The Office of Communications sent an update.</p>
        </article>
      </main>
    `;

    const reports = parseForthWhPoolReports(html);

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      id: "forth:/lists/whpool/abc123",
      source: "Forth",
      title: "In-town pool report #6 -- lid",
      url: "https://www.forth.news/lists/whpool/abc123"
    });
    expect(reports[0].publishedAt.toISOString()).toBe("2026-07-11T22:03:00.000Z");
  });
});
