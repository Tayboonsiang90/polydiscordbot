import { describe, expect, it } from "vitest";
import { extractLatestAllInEpisode, extractLatestAllInEpisodeValue } from "../src/integrations/allInPodcast.js";

const sampleHtml = `
  <div>
    <a href="https://youtube.com/v/10MdOvK-aG4"><img alt=""></a>
    <div>[  5/8/2026  ]</div>
    <div><a href="https://youtube.com/v/10MdOvK-aG4">Episode #272</a></div>
    <div>The episode kicks off with a discussion...</div>
  </div>
`;

describe("All-In Podcast adapter", () => {
  it("extracts the latest episode from allin.com", () => {
    expect(extractLatestAllInEpisode(sampleHtml)).toEqual({
      title: "Episode #272",
      date: "5/8/2026",
      url: "https://www.youtube.com/watch?v=10MdOvK-aG4"
    });
  });

  it("formats the latest episode as a stable monitor value", () => {
    const value = extractLatestAllInEpisodeValue(sampleHtml);
    expect(value).toContain("Title: Episode #272");
    expect(value).toContain("Date: 5/8/2026");
    expect(value).toContain("URL: https://www.youtube.com/watch?v=10MdOvK-aG4");
  });

  it("throws when no latest episode is present", () => {
    expect(() => extractLatestAllInEpisode("<html></html>")).toThrow("Could not find the latest All-In episode");
  });
});
