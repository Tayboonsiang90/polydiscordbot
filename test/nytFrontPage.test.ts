import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractNytFrontPageGammaStrikeTerms,
  extractNytFrontPageIssue,
  extractNytStrikeTermsFromQuestion,
  findNytStrikeTermBoxes,
  getNytFrontPageMarketIssueDates,
  parseNytFrontPageSettings,
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
