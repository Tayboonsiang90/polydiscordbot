import { describe, expect, it } from "vitest";
import {
  extractWhiteHouseVideos,
  formatWhiteHouseVideoValue,
  whiteHouseVideosAdapter
} from "../src/integrations/whiteHouseVideos.js";

describe("White House Videos adapter", () => {
  it("parses and sorts official video cards", () => {
    const videos = extractWhiteHouseVideos(`
      <ul>
        ${buildVideoCard({
          classes: "past_event_type-live",
          slug: "cabinet-meeting",
          title: "President Trump Hosts a Cabinet Meeting",
          datetime: "2026-07-31T16:33:04+00:00",
          duration: "57:09",
          youtubeUrl: "https://www.youtube.com/watch?v=V6vuYip9SWo"
        })}
        ${buildVideoCard({
          classes: "past_event_type-short",
          slug: "camp-david",
          title: "Trump Administration Cabinet Meeting at Camp David",
          datetime: "2026-08-01T20:47:22+00:00",
          duration: "00:58",
          youtubeUrl: "https://www.youtube.com/watch?v=IVW9-YQRAXg"
        })}
      </ul>
    `);

    expect(videos).toHaveLength(2);
    expect(videos[0]).toMatchObject({
      id: "camp-david",
      title: "Trump Administration Cabinet Meeting at Camp David",
      url: "https://www.whitehouse.gov/videos/camp-david/",
      duration: "00:58",
      format: "Short",
      youtubeUrl: "https://www.youtube.com/watch?v=IVW9-YQRAXg"
    });
    expect(videos[0]?.publishedAt.toISOString()).toBe("2026-08-01T20:47:22.000Z");
    expect(videos[1]?.format).toBe("Livestream");
  });

  it("deduplicates repeated featured and grid cards", () => {
    const card = buildVideoCard({
      classes: "",
      slug: "latest-video",
      title: "Latest Video",
      datetime: "2026-08-02T21:49:09+00:00",
      duration: "08:05",
      youtubeUrl: "https://www.youtube.com/watch?v=LlovJ4qKe68"
    });

    expect(extractWhiteHouseVideos(`<ul>${card}${card}</ul>`)).toHaveLength(1);
  });

  it("rejects pages without valid video cards", () => {
    expect(() => extractWhiteHouseVideos("<html><main>No videos</main></html>")).toThrow(
      "Could not find White House video posts"
    );
  });

  it("formats concise alert details in ET", () => {
    const value = formatWhiteHouseVideoValue({
      id: "latest-video",
      title: "Latest Video",
      url: "https://www.whitehouse.gov/videos/latest-video/",
      publishedAt: new Date("2026-08-02T21:49:09.000Z"),
      duration: "08:05",
      format: "Video",
      youtubeUrl: "https://www.youtube.com/watch?v=LlovJ4qKe68"
    });

    expect(value).toContain("Title: Latest Video");
    expect(value).toContain("Format: Video");
    expect(value).toContain("Published at: Aug 02, 2026, 17:49:09 ET");
    expect(value).toContain("Duration: 08:05");
    expect(value).toContain("YouTube: https://www.youtube.com/watch?v=LlovJ4qKe68");
  });

  it("defines the expected monitor metadata", () => {
    expect(whiteHouseVideosAdapter.commandName).toBe("whvideos");
    expect(whiteHouseVideosAdapter.defaultChannelName).toBe("whvideos");
    expect(whiteHouseVideosAdapter.getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(whiteHouseVideosAdapter.fetchEventUpdates).toBeTypeOf("function");
  });
});

function buildVideoCard(input: {
  classes: string;
  slug: string;
  title: string;
  datetime: string;
  duration: string;
  youtubeUrl: string;
}): string {
  const url = `https://www.whitehouse.gov/videos/${input.slug}/`;
  return `
    <li class="wp-block-post ${input.classes}">
      <div class="wp-block-whitehouse-past-event">
        <div class="wp-block-whitehouse-past-event__thumbnail">
          <span class="wp-block-whitehouse-past-event__duration">${input.duration}</span>
        </div>
        <div class="wp-block-whitehouse-past-event__content">
          <h3 class="wp-block-whitehouse-past-event__title"><a href="${url}">${input.title}</a></h3>
          <div class="wp-block-whitehouse-past-event__datetime"><time datetime="${input.datetime}"></time></div>
        </div>
        <script type="application/ld+json">${JSON.stringify({
          "@context": "https://schema.org",
          "@type": "VideoObject",
          embedUrl: input.youtubeUrl
        })}</script>
      </div>
    </li>
  `;
}
