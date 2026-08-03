import { describe, expect, it } from "vitest";
import {
  extractWhiteHouseYoutubeStreams,
  formatWhiteHouseYoutubeStreamValue,
  shouldAlertOnWhiteHouseYoutubeStreamChange,
  whiteHouseYoutubeStreamsAdapter
} from "../src/integrations/whiteHouseYoutubeStreams.js";

describe("White House YouTube Streams adapter", () => {
  it("parses current YouTube lockup stream cards", () => {
    const streams = extractWhiteHouseYoutubeStreams(
      buildYoutubePage({
        contents: [
          {
            lockupViewModel: {
              contentId: "V6vuYip9SWo",
              metadata: {
                lockupMetadataViewModel: {
                  title: { content: "President Trump Hosts a Cabinet Meeting" },
                  metadata: {
                    contentMetadataViewModel: {
                      metadataRows: [
                        {
                          metadataParts: [
                            { text: { content: "233K views" } },
                            { text: { content: "Streamed 2 days ago" } }
                          ]
                        }
                      ]
                    }
                  }
                }
              },
              contentImage: {
                thumbnailViewModel: {
                  overlays: [
                    {
                      thumbnailBottomOverlayViewModel: {
                        badges: [{ thumbnailBadgeViewModel: { text: "57:09", badgeStyle: "THUMBNAIL_OVERLAY_BADGE_STYLE_DEFAULT" } }]
                      }
                    }
                  ]
                }
              }
            }
          }
        ]
      })
    );

    expect(streams).toEqual([
      {
        videoId: "V6vuYip9SWo",
        title: "President Trump Hosts a Cabinet Meeting",
        status: "Streamed",
        scheduledAt: null,
        listedText: "Streamed 2 days ago",
        url: "https://www.youtube.com/watch?v=V6vuYip9SWo"
      }
    ]);
  });

  it("detects scheduled and live stream states", () => {
    const streams = extractWhiteHouseYoutubeStreams(
      buildYoutubePage({
        items: [
          {
            videoRenderer: {
              videoId: "abcdefghijk",
              title: { runs: [{ text: "Upcoming Remarks" }] },
              publishedTimeText: { simpleText: "Scheduled for Aug 4, 2026" },
              upcomingEventData: { startTime: "1785880800" },
              thumbnailOverlays: [
                { thumbnailOverlayTimeStatusRenderer: { style: "UPCOMING", text: { simpleText: "UPCOMING" } } }
              ]
            }
          },
          {
            gridVideoRenderer: {
              videoId: "lmnopqrstuv",
              title: { simpleText: "Live Press Briefing" },
              badges: [{ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_LIVE_NOW", label: "LIVE" } }]
            }
          }
        ]
      })
    );

    expect(streams[0]).toMatchObject({
      videoId: "abcdefghijk",
      status: "Scheduled",
      listedText: "Scheduled for Aug 4, 2026"
    });
    expect(streams[0]?.scheduledAt?.toISOString()).toBe("2026-08-04T22:00:00.000Z");
    expect(streams[1]).toMatchObject({ videoId: "lmnopqrstuv", status: "Live" });
  });

  it("ignores relative age text but alerts for meaningful stream changes", () => {
    const previous = [
      "Status: Streamed",
      "Title: Cabinet Meeting",
      "Scheduled at: not listed",
      "Listed: Streamed 2 days ago",
      "URL: https://www.youtube.com/watch?v=V6vuYip9SWo"
    ].join("\n");
    const ageOnly = previous.replace("2 days", "3 days");
    const nowLive = previous.replace("Status: Streamed", "Status: Live");
    const newStream = previous.replace("V6vuYip9SWo", "abcdefghijk");

    expect(shouldAlertOnWhiteHouseYoutubeStreamChange(previous, ageOnly)).toBe(false);
    expect(shouldAlertOnWhiteHouseYoutubeStreamChange(previous, nowLive)).toBe(true);
    expect(shouldAlertOnWhiteHouseYoutubeStreamChange(previous, newStream)).toBe(true);
  });

  it("formats a concise stream value", () => {
    const value = formatWhiteHouseYoutubeStreamValue({
      videoId: "abcdefghijk",
      title: "Upcoming Remarks",
      status: "Scheduled",
      scheduledAt: new Date("2026-08-04T18:00:00.000Z"),
      listedText: "Scheduled for Aug 4, 2026",
      url: "https://www.youtube.com/watch?v=abcdefghijk"
    });

    expect(value).toContain("Status: Scheduled");
    expect(value).toContain("Title: Upcoming Remarks");
    expect(value).toContain("Scheduled at:");
    expect(value).toContain("URL: https://www.youtube.com/watch?v=abcdefghijk");
  });

  it("defines the expected monitor metadata", () => {
    expect(whiteHouseYoutubeStreamsAdapter.commandName).toBe("whstreams");
    expect(whiteHouseYoutubeStreamsAdapter.defaultChannelName).toBe("whstreams");
    expect(whiteHouseYoutubeStreamsAdapter.getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(whiteHouseYoutubeStreamsAdapter.fetchEventUpdates).toBeTypeOf("function");
  });
});

function buildYoutubePage(initialData: unknown): string {
  return `<html><script>var ytInitialData = ${JSON.stringify(initialData)};</script></html>`;
}
