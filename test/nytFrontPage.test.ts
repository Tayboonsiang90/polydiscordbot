import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractNytFrontPageGammaStrikeTerms,
  extractNytFrontPageIssue,
  extractNytStrikeTermsFromQuestion,
  findNytStrikeTermBoxes,
  formatNytHistoricalIssueRows,
  getNytFrontPageMarketIssueDates,
  getNytPolymarketUrlForIssueDate,
  normalizeNytPolymarketEventUrl,
  nytFrontPageAdapter,
  parseNytFrontPageSettings,
  refreshNytFrontPageSettings,
  refreshNytFrontPagePolymarketQueue
} from "../src/integrations/nytFrontPage.js";
import type { Integration } from "../src/integrations/types.js";

function pageHtml(): string {
  return `
    <html>
      <head>
        <meta property="article:published_time" content="2026-05-18" />
        <script type="application/ld+json">
          ${JSON.stringify({
            "@graph": [
              {
                "@type": "PublicationIssue",
                datePublished: "2026-05-18T04:20:00.0000000",
                thumbnailUrl: "https://t.prcdn.co/img?cid=8302&amp;page=1&amp;date=20260531&amp;v=51&amp;ver=0&amp;width=190"
              },
              {
                "@type": "NewsArticle",
                headline: "Prices Test Voters' Patience With Trump's Assurances"
              },
              {
                "@type": "NewsArticle",
                headline: "Ebola Outbreak in Congo and Uganda Is Called Global Emergency"
              }
            ]
          })}
        </script>
      </head>
    </html>
  `;
}

describe("NYT front page adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the revived June 15-21 market as the default URL", () => {
    const defaultUrl = nytFrontPageAdapter.defaultPolymarketUrl;
    expect(defaultUrl).toBe(
      "https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-june-15-june-21-20260612213503327"
    );
    expect(getNytFrontPageMarketIssueDates(defaultUrl!)).toEqual([
      "2026-06-15",
      "2026-06-16",
      "2026-06-17",
      "2026-06-18",
      "2026-06-19",
      "2026-06-20",
      "2026-06-21"
    ]);
  });

  it("extracts strike terms from NYT Gamma questions", () => {
    expect(extractNytStrikeTermsFromQuestion('Will the NYT front page headlines say "Federal Reserve" this week?')).toEqual([
      "Federal Reserve"
    ]);
  });

  it("removes Gamma markets that already resolved Yes", () => {
    expect(
      extractNytFrontPageGammaStrikeTerms([
        {
          question: 'Will the NYT front page headlines say "City" this week?',
          closed: true,
          outcomes: '["Yes","No"]',
          outcomePrices: '["1","0"]'
        },
        {
          question: 'Will the NYT front page headlines say "Regime" this week?',
          closed: false,
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.4","0.6"]'
        }
      ])
    ).toEqual(["Regime"]);
  });

  it("extracts page-one issue metadata from PressReader JSON-LD", () => {
    expect(extractNytFrontPageIssue(pageHtml(), "https://nytimes.pressreader.com/the-new-york-times/20260518/page/1")).toEqual({
      id: "nyt-front-page-2026-05-18",
      date: "2026-05-18",
      pageUrl: "https://nytimes.pressreader.com/the-new-york-times/20260518/page/1",
      pageImageUrl: "https://t.prcdn.co/img?cid=8302&page=1&date=20260518&width=1200",
      headlines: [
        "Prices Test Voters' Patience With Trump's Assurances",
        "Ebola Outbreak in Congo and Uganda Is Called Global Emergency"
      ]
    });
  });

  it("extracts issue metadata from PressReader RDFa when page headlines are absent", () => {
    expect(
      extractNytFrontPageIssue(
        `
        <html>
          <head>
            <meta property="article:published_time" content="2026-05-21" />
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@graph": [
                  {
                    "@type": "PublicationIssue",
                    "datePublished": "2026-05-21T02:07:00.0000000",
                    "thumbnailUrl": "https://t.prcdn.co/img?cid=8302&page=1&date=20260521&width=190"
                  },
                ]
              }
            </script>
          </head>
          <body>
            <div vocab="https://schema.org/">
              <p typeof="PublicationIssue">
                <p property="datePublished">2026-05-21T02:07:00.0000000</p>
                <p property="thumbnailUrl">
                  <img src="https://t.prcdn.co/img?cid=8302&page=1&date=20260521&width=190">
                </p>
              </p>
            </div>
          </body>
        </html>
        `,
        "https://nytimes.pressreader.com/the-new-york-times/20260521/page/1"
      )
    ).toEqual({
      id: "nyt-front-page-2026-05-21",
      date: "2026-05-21",
      pageUrl: "https://nytimes.pressreader.com/the-new-york-times/20260521/page/1",
      pageImageUrl: "https://t.prcdn.co/img?cid=8302&page=1&date=20260521&width=1200",
      headlines: []
    });
  });

  it("falls back to the PressReader URL date and image endpoint when metadata is absent", () => {
    expect(
      extractNytFrontPageIssue(
        "<!DOCTYPE html><html><head><title>The New York Times Replica Edition</title></head><body></body></html>",
        "https://nytimes.pressreader.com/the-new-york-times/20260518/page/1"
      )
    ).toEqual({
      id: "nyt-front-page-2026-05-18",
      date: "2026-05-18",
      pageUrl: "https://nytimes.pressreader.com/the-new-york-times/20260518/page/1",
      pageImageUrl: "https://t.prcdn.co/img?cid=8302&page=1&date=20260518&width=1200",
      headlines: []
    });
  });

  it("reads stored NYT strike settings", () => {
    expect(
      parseNytFrontPageSettings(
        JSON.stringify({
          nytStrikeTerms: ["Regime"],
          nytParsedFromUrl: "https://polymarket.com/event/test",
          nytLastParsedAt: "2026-05-18T00:00:00.000Z"
        })
      )
    ).toEqual({
      nytStrikeTerms: ["Regime"],
      nytParsedFromUrl: "https://polymarket.com/event/test",
      nytLastParsedAt: "2026-05-18T00:00:00.000Z"
    });
  });

  it("discovers and queues the next weekly NYT market when the active week is near expiry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "what-will-the-nyt-front-page-headlines-say-this-week-may-25-may-31",
              title: "What will the NYT front-page headlines say this week? (May 25 - May 31)",
              active: true,
              closed: false
            },
            {
              slug: "what-will-the-nyt-front-page-headlines-say-this-week-may-18-may-24",
              title: "What will the NYT front-page headlines say this week? (May 18 - May 24)",
              active: true,
              closed: false
            }
          ]
        })
      })
    );

    const result = await refreshNytFrontPagePolymarketQueue(
      {
        settingsJson: JSON.stringify({
          polymarketMarkets: [
            {
              url: "https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-may-18-may-24",
              slug: "what-will-the-nyt-front-page-headlines-say-this-week-may-18-may-24",
              startAt: "2026-05-18T04:00:00.000Z",
              endAt: "2026-05-25T03:59:00.000Z",
              addedAt: "2026-05-18T04:00:00.000Z"
            }
          ]
        }),
        polymarketUrl: "https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-may-18-may-24"
      } as Integration,
      new Date("2026-05-23T12:00:00.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      lastNytDiscoveryAt?: string;
      polymarketMarkets?: Array<{ slug: string }>;
    };

    expect(settings.lastNytDiscoveryAt).toBe("2026-05-23T12:00:00.000Z");
    expect(settings.polymarketMarkets?.map((market) => market.slug)).toEqual([
      "what-will-the-nyt-front-page-headlines-say-this-week-may-18-may-24",
      "what-will-the-nyt-front-page-headlines-say-this-week-may-25-may-31"
    ]);
    expect(result.activeUrl).toBe("https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-may-18-may-24");
  });

  it("derives all issue dates from a weekly NYT Polymarket URL", () => {
    expect(
      getNytFrontPageMarketIssueDates(
        "https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-may-25-may-31",
        new Date("2026-05-31T12:00:00.000Z")
      )
    ).toEqual(["2026-05-25", "2026-05-26", "2026-05-27", "2026-05-28", "2026-05-29", "2026-05-30", "2026-05-31"]);
  });

  it("normalizes nested NYT outcome URLs to the parent weekly event URL", () => {
    const nestedUrl =
      "https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-july-20-july-26-20260718184724813/will-ai-or-artificial-intelligence-be-in-the-headlines-this-week-20260718184512816";
    expect(normalizeNytPolymarketEventUrl(nestedUrl)).toBe(
      "https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-july-20-july-26-20260718184724813"
    );
    expect(getNytFrontPageMarketIssueDates(nestedUrl, new Date("2026-07-21T00:00:00.000Z"))).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
      "2026-07-25",
      "2026-07-26"
    ]);
  });

  it("maps an early PressReader edition to its upcoming weekly market by issue date", () => {
    const upcomingUrl =
      "https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-july-27-august-2-20260724154704322";
    expect(
      getNytPolymarketUrlForIssueDate(
        [
          {
            url: "https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-july-20-july-26-20260718184724813",
            slug: "what-will-the-nyt-front-page-headlines-say-this-week-july-20-july-26-20260718184724813",
            startAt: "2026-07-20T04:00:00.000Z",
            endAt: "2026-07-27T03:59:00.000Z",
            addedAt: "2026-07-20T04:00:00.000Z"
          },
          {
            url: upcomingUrl,
            slug: "what-will-the-nyt-front-page-headlines-say-this-week-july-27-august-2-20260724154704322",
            startAt: "2026-07-27T04:00:00.000Z",
            endAt: "2026-08-03T03:59:00.000Z",
            addedAt: "2026-07-24T20:06:00.000Z"
          }
        ],
        "2026-07-27"
      )
    ).toBe(upcomingUrl);
  });

  it("uses an upcoming market's strikes as soon as its dated edition is published", async () => {
    const previousUrl =
      "https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-july-20-july-26-20260718184724813";
    const upcomingUrl =
      "https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-july-27-august-2-20260724154704322";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const target = String(input);
        if (target === "https://nytimes.pressreader.com/the-new-york-times/") {
          return new Response("<h1>The New York Times - July 27, 2026</h1>", { status: 200 });
        }
        if (target.startsWith("https://gamma-api.polymarket.com/events?slug=")) {
          return Response.json([
            {
              markets: [
                {
                  question: 'Will the NYT front page headlines say "Fear" this week?',
                  closed: false
                }
              ]
            }
          ]);
        }
        if (target === "https://nytimes.pressreader.com/the-new-york-times/20260727/page/1") {
          return new Response(
            `
              <meta property="article:published_time" content="2026-07-27" />
              <script type="application/ld+json">
                ${JSON.stringify({
                  "@graph": [
                    { "@type": "PublicationIssue", datePublished: "2026-07-27" },
                    { "@type": "NewsArticle", headline: "Industries Fear New Trade Curbs" }
                  ]
                })}
              </script>
            `,
            { status: 200 }
          );
        }
        throw new Error(`Unexpected URL: ${target}`);
      })
    );

    const result = await nytFrontPageAdapter.fetchEventUpdates!(
      {
        settingsJson: JSON.stringify({
          nytStrikeTerms: ["Senate"],
          nytParsedFromUrl: previousUrl,
          polymarketMarkets: [
            {
              url: previousUrl,
              slug: "what-will-the-nyt-front-page-headlines-say-this-week-july-20-july-26-20260718184724813",
              startAt: "2026-07-20T04:00:00.000Z",
              endAt: "2026-07-27T03:59:00.000Z",
              addedAt: "2026-07-20T04:00:00.000Z"
            },
            {
              url: upcomingUrl,
              slug: "what-will-the-nyt-front-page-headlines-say-this-week-july-27-august-2-20260724154704322",
              startAt: "2026-07-27T04:00:00.000Z",
              endAt: "2026-08-03T03:59:00.000Z",
              addedAt: "2026-07-24T20:06:00.000Z"
            }
          ]
        }),
        polymarketUrl: previousUrl
      } as Integration
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as {
      nytLatestIssueDate?: string;
      nytParsedFromUrl?: string;
      nytStrikeTerms?: string[];
    };

    expect(result.polymarketUrl).toBe(upcomingUrl);
    expect(result.strikeTerms).toEqual(["Fear"]);
    expect(result.posts[0].matchedTerms).toEqual(["Fear"]);
    expect(result.posts[0].polymarketUrl).toBe(upcomingUrl);
    expect(settings).toMatchObject({
      nytLatestIssueDate: "2026-07-27",
      nytParsedFromUrl: upcomingUrl,
      nytStrikeTerms: ["Fear"]
    });
  });

  it("formats historical NYT checked dates with weekdays and no-match rows", () => {
    expect(
      formatNytHistoricalIssueRows([
        {
          id: "nyt-front-page-2026-05-28",
          type: "NYT front page",
          text: "",
          qualifyingText: "",
          postedAt: new Date("2026-05-28T04:20:00.000Z"),
          url: "https://nytimes.pressreader.com/the-new-york-times/20260528/page/1",
          imageUrls: [],
          imageText: "",
          matchedTerms: [],
          strikeTerms: ["Garden"]
        },
        {
          id: "nyt-front-page-2026-05-31",
          type: "NYT front page",
          text: "",
          qualifyingText: "",
          postedAt: new Date("2026-05-31T04:20:00.000Z"),
          url: "https://nytimes.pressreader.com/the-new-york-times/20260531/page/1",
          imageUrls: [],
          imageText: "",
          matchedTerms: ["Border", "Senate"],
          strikeTerms: ["Border", "Senate"]
        }
      ])
    ).toBe(
      [
        "2026-05-28 (Thursday) - no matches",
        "https://nytimes.pressreader.com/the-new-york-times/20260528/page/1",
        "2026-05-31 (Sunday) - Border, Senate",
        "https://nytimes.pressreader.com/the-new-york-times/20260531/page/1"
      ].join("\n")
    );
  });

  it("discovers and activates the current NYT market after the stored week expires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "what-will-the-nyt-front-page-headlines-say-this-week-may-25-may-31",
              title: "What will the NYT front-page headlines say this week? (May 25 - May 31)",
              active: true,
              closed: false
            }
          ]
        })
      })
    );

    const result = await refreshNytFrontPagePolymarketQueue(
      {
        settingsJson: JSON.stringify({
          polymarketMarkets: [
            {
              url: "https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-may-18-may-24",
              slug: "what-will-the-nyt-front-page-headlines-say-this-week-may-18-may-24",
              startAt: "2026-05-18T04:00:00.000Z",
              endAt: "2026-05-25T03:59:00.000Z",
              addedAt: "2026-05-18T04:00:00.000Z"
            }
          ]
        }),
        polymarketUrl: "https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-may-18-may-24"
      } as Integration,
      new Date("2026-05-25T12:00:00.000Z")
    );

    expect(result.activeUrl).toBe("https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-may-25-may-31");
  });

  it("discovers the current NYT market from Gamma series fallback when public search is stale", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const target = String(url);
        if (target.includes("/public-search")) {
          return {
            ok: true,
            json: async () => ({
              events: [
                {
                  slug: "what-will-the-nyt-front-page-headlines-say-this-week-july-13-july-19-20260710201146834",
                  title: "What will the NYT front-page headlines say this week? (July 13 - July 19)",
                  active: true,
                  closed: false
                }
              ]
            })
          };
        }

        return {
          ok: true,
          json: async () => [
            {
              slug: "what-will-the-nyt-front-page-headlines-say-this-week-july-20-july-26-20260718184724813",
              title: "What will the NYT front-page headlines say this week? (July 20 - July 26)",
              active: true,
              closed: false
            }
          ]
        };
      })
    );

    const result = await refreshNytFrontPagePolymarketQueue(
      {
        settingsJson: JSON.stringify({
          polymarketMarkets: [
            {
              url: "https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-july-13-july-19-20260710201146834",
              slug: "what-will-the-nyt-front-page-headlines-say-this-week-july-13-july-19-20260710201146834",
              startAt: "2026-07-13T04:00:00.000Z",
              endAt: "2026-07-20T03:59:00.000Z",
              addedAt: "2026-07-13T04:00:00.000Z"
            }
          ]
        }),
        polymarketUrl: "https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-july-13-july-19-20260710201146834"
      } as Integration,
      new Date("2026-07-20T08:00:00.000Z")
    );

    expect(result.activeUrl).toBe(
      "https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-july-20-july-26-20260718184724813"
    );
  });

  it("keeps a legacy stored URL as fallback after that week expires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ events: [] })
      })
    );

    const result = await refreshNytFrontPagePolymarketQueue(
      {
        settingsJson: null,
        polymarketUrl: "https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-may-18-may-24"
      } as Integration,
      new Date("2026-06-03T02:04:30.000Z")
    );
    const settings = JSON.parse(result.settingsJson ?? "{}") as { polymarketMarkets?: unknown[] };

    expect(result.activeUrl).toBe("https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-may-18-may-24");
    expect(settings.polymarketMarkets).toEqual([]);
  });

  it("keeps expired NYT strike terms when the expired market remains attached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ events: [] })
      })
    );

    const settings = await refreshNytFrontPageSettings(
      {
        settingsJson: JSON.stringify({
          nytStrikeTerms: ["Ukraine"],
          nytParsedFromUrl: "https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-may-18-may-24",
          nytLastParsedAt: "2026-05-24T00:00:00.000Z"
        }),
        polymarketUrl: "https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-may-18-may-24"
      } as Integration,
      false,
      new Date("2026-06-03T02:04:30.000Z")
    );

    expect(settings.nytStrikeTerms).toEqual(["Ukraine"]);
    expect(settings.nytParsedFromUrl).toBe("https://polymarket.com/event/what-will-the-nyt-front-page-headlines-say-this-week-may-18-may-24");
    expect(settings.polymarketMarkets).toEqual([]);
  });

  it("finds OCR boxes for single and multi-word strike terms", () => {
    expect(
      findNytStrikeTermBoxes(
        [
          { text: "Federal", bbox: { x0: 10, y0: 20, x1: 50, y1: 40 } },
          { text: "Reserve", bbox: { x0: 55, y0: 20, x1: 100, y1: 40 } },
          { text: "Trump's", bbox: { x0: 15, y0: 60, x1: 75, y1: 80 } }
        ],
        ["Federal Reserve", "Trump"]
      )
    ).toEqual([
      { term: "Federal Reserve", x0: 10, y0: 20, x1: 100, y1: 40 },
      { term: "Trump", x0: 15, y0: 60, x1: 75, y1: 80 }
    ]);
  });
});
