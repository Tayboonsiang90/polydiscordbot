import { describe, expect, it } from "vitest";
import {
  extractNytFrontPageGammaStrikeTerms,
  extractNytFrontPageIssue,
  extractNytStrikeTermsFromQuestion,
  parseNytFrontPageSettings
} from "../src/integrations/nytFrontPage.js";

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
                thumbnailUrl: "https://t.prcdn.co/img?cid=8302&amp;page=1&amp;date=20260518&amp;width=190"
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
});
