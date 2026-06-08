import { afterEach, describe, expect, it, vi } from "vitest";
import Tesseract from "tesseract.js";
import {
  extractPolymarketStrikeTerms,
  extractTrumpTruthGammaStrikeTerms,
  trumpTruthAdapter,
  findMatchedStrikeTerms,
  getActiveTrumpTruthMarket,
  enrichTrumpTruthPostWithOcr,
  matchesStrikeTerm,
  normalizeTrumpTruthArchiveItem,
  normalizeTruthSocialStatus,
  buildTrumpTruthArchiveSearchUrl,
  parseTrumpTruthMarketWindow,
  parseTrumpTruthArchiveFeed,
  parseTrumpTruthArchiveSearchResults,
  parseTrumpTruthSettings,
  refreshTrumpTruthSettings,
  isPostInTrumpTruthMarketWindow,
  upsertTrumpTruthPolymarketMarket
} from "../src/integrations/trumpTruth.js";
import type { Integration } from "../src/integrations/types.js";

vi.mock("tesseract.js", () => ({
  default: {
    recognize: vi.fn()
  }
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Trump Truth strike parser", () => {
  it("extracts quoted strike terms and slash alternatives from Polymarket HTML", () => {
    const html = [
      'Will Trump post "King" on Truth Social this week?',
      'Will Trump post "Ass / Shit" on Truth Social this week?',
      "Will Trump post “Ceasefire” or “Cease-fire” on Truth Social this week?",
      "Will Trump post Paper Tiger on Truth Social this week?"
    ].join("\n");

    expect(extractPolymarketStrikeTerms(html)).toEqual(["Ass", "Cease-fire", "Ceasefire", "King", "Paper Tiger", "Shit"]);
  });

  it("extracts JSON-escaped quoted alternatives from Polymarket HTML", () => {
    const html = [
      'Will Trump post \\"TrumpIRA\\" or \\"TrumpIRA.gov\\" on Truth Social this week',
      'Will Trump post \\"Jimmy\\" or \\"Kimmel\\" on Truth Social this week',
      'Will Trump post \\"Ceasefire\\" or \\"Cease-fire\\" or \\"Cease fire\\" on Truth Social this week'
    ].join("\n");

    expect(extractPolymarketStrikeTerms(html)).toEqual([
      "Cease fire",
      "Cease-fire",
      "Ceasefire",
      "Jimmy",
      "Kimmel",
      "TrumpIRA",
      "TrumpIRA.gov"
    ]);
  });

  it("reads stored strike settings", () => {
    expect(parseTrumpTruthSettings(JSON.stringify({ strikeTerms: ["King"], parsedFromUrl: "url", lastParsedAt: "time" }))).toEqual({
      strikeTerms: ["King"],
      parsedFromUrl: "url",
      lastParsedAt: "time"
    });
  });

  it("force-refreshes strike settings from the current Polymarket URL using Gamma", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          markets: [
            {
              question: 'Will Trump post "FBI" on Truth Social this week?',
              closed: false,
              outcomes: '["Yes","No"]',
              outcomePrices: '["0.4","0.6"]'
            }
          ]
        }
      ]
    });
    vi.stubGlobal("fetch", fetchMock);

    const integration = {
      settingsJson: JSON.stringify({ strikeTerms: ["King"], parsedFromUrl: "https://polymarket.com/event/test" }),
      polymarketUrl: "https://polymarket.com/event/what-will-trump-post-this-week-may-4-may-10"
    } as Integration;
    const now = new Date("2026-05-06T12:00:00.000Z");

    await expect(refreshTrumpTruthSettings(integration, true, now)).resolves.toMatchObject({ strikeTerms: ["FBI"] });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("parses weekly windows from Trump Truth Polymarket URLs", () => {
    expect(
      parseTrumpTruthMarketWindow(
        "https://polymarket.com/event/what-will-trump-post-this-week-may-4-may-10",
        new Date("2026-05-06T12:00:00.000Z")
      )
    ).toMatchObject({
      slug: "what-will-trump-post-this-week-may-4-may-10",
      startAt: "2026-05-04T04:00:00.000Z",
      endAt: "2026-05-11T03:59:00.000Z"
    });

    expect(
      parseTrumpTruthMarketWindow(
        "https://polymarket.com/event/what-will-trump-post-this-week-may-11-may-17",
        new Date("2026-05-11T12:00:00.000Z")
      )
    ).toMatchObject({
      slug: "what-will-trump-post-this-week-may-11-may-17",
      startAt: "2026-05-11T04:00:00.000Z",
      endAt: "2026-05-18T03:59:00.000Z"
    });

    expect(
      parseTrumpTruthMarketWindow(
        "https://polymarket.com/event/what-will-trump-post-this-week-may-24",
        new Date("2026-05-18T12:00:00.000Z")
      )
    ).toMatchObject({
      slug: "what-will-trump-post-this-week-may-24",
      startAt: "2026-05-18T04:00:00.000Z",
      endAt: "2026-05-25T03:59:00.000Z"
    });
  });

  it("removes Gamma child markets that already resolved Yes", () => {
    expect(
      extractTrumpTruthGammaStrikeTerms([
        {
          question: 'Will Trump post "King" on Truth Social this week?',
          closed: true,
          outcomes: '["Yes","No"]',
          outcomePrices: '["1","0"]'
        },
        {
          question: 'Will Trump post "Venezuela" on Truth Social this week?',
          closed: false,
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.22","0.78"]'
        },
        {
          question: 'Will Trump post "Hell" on Truth Social this week?',
          closed: true,
          outcomes: '["Yes","No"]',
          outcomePrices: '["1","0"]'
        },
        {
          question: 'Will Trump post "Senior" on Truth Social this week?',
          closed: true,
          outcomes: '["Yes","No"]',
          outcomePrices: '["1","0"]'
        }
      ])
    ).toEqual({
      strikeTerms: ["Hell", "King", "Senior", "Venezuela"],
      resolvedTerms: ["Hell", "King", "Senior"],
      activeStrikeTerms: ["Venezuela"]
    });
  });

  it("activates the correct stored market by ET date", () => {
    const settings = parseTrumpTruthSettings(
      JSON.stringify({
        markets: [
          {
            url: "https://polymarket.com/event/what-will-trump-post-this-week-may-4-may-10",
            slug: "what-will-trump-post-this-week-may-4-may-10",
            startAt: "2026-05-04T04:00:00.000Z",
            endAt: "2026-05-11T03:59:00.000Z",
            strikeTerms: ["King"],
            resolvedTerms: [],
            activeStrikeTerms: ["King"],
            lastParsedAt: "2026-05-04T04:00:00.000Z"
          },
          {
            url: "https://polymarket.com/event/what-will-trump-post-this-week-may-11-may-17",
            slug: "what-will-trump-post-this-week-may-11-may-17",
            startAt: "2026-05-11T04:00:00.000Z",
            endAt: "2026-05-18T03:59:00.000Z",
            strikeTerms: ["Trust"],
            resolvedTerms: [],
            activeStrikeTerms: ["Trust"],
            lastParsedAt: "2026-05-11T04:00:00.000Z"
          }
        ]
      }),
      new Date("2026-05-11T12:00:00.000Z")
    );

    expect(settings.strikeTerms).toEqual(["Trust"]);
    expect(settings.parsedFromUrl).toBe("https://polymarket.com/event/what-will-trump-post-this-week-may-11-may-17");
    expect(getActiveTrumpTruthMarket(settings.markets ?? [], new Date("2026-05-06T12:00:00.000Z"))?.activeStrikeTerms).toEqual(["King"]);
  });

  it("upserts new weekly markets while preserving older stored markets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            markets: [
              {
                question: 'Will Trump post "Trust" on Truth Social this week?',
                closed: false,
                outcomes: '["Yes","No"]',
                outcomePrices: '["0.4","0.6"]'
              }
            ]
          }
        ]
      })
    );

    const settings = await upsertTrumpTruthPolymarketMarket(
      {
        settingsJson: JSON.stringify({
          markets: [
            {
              url: "https://polymarket.com/event/what-will-trump-post-this-week-may-4-may-10",
              slug: "what-will-trump-post-this-week-may-4-may-10",
              startAt: "2026-05-04T04:00:00.000Z",
              endAt: "2026-05-11T03:59:00.000Z",
              strikeTerms: ["King"],
              resolvedTerms: [],
              activeStrikeTerms: ["King"]
            }
          ]
        }),
        polymarketUrl: "https://polymarket.com/event/what-will-trump-post-this-week-may-4-may-10"
      } as Integration,
      "https://polymarket.com/event/what-will-trump-post-this-week-may-11-may-17",
      new Date("2026-05-11T12:00:00.000Z")
    );

    expect(settings.markets).toHaveLength(2);
    expect(settings.strikeTerms).toEqual(["Trust"]);
    expect(settings.parsedFromUrl).toBe("https://polymarket.com/event/what-will-trump-post-this-week-may-11-may-17");
  });

  it("discovers and queues the next Trump Truth market when the active week is near expiry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "what-will-trump-post-this-week-may-11-may-17",
              title: "What will Trump post this week? (May 11 - May 17)",
              active: true,
              closed: false,
              tags: [{ slug: "trump" }, { slug: "mention-markets" }]
            },
            {
              slug: "what-will-trump-post-this-week-may-24",
              title: "What will Trump post this week? (May 24)",
              active: true,
              closed: false,
              tags: [{ slug: "trump" }, { slug: "mention-markets" }]
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            markets: [
              {
                question: 'Will Trump post "Harvard" on Truth Social this week?',
                closed: false,
                outcomes: '["Yes","No"]',
                outcomePrices: '["0.4","0.6"]'
              }
            ]
          }
        ]
      });
    vi.stubGlobal("fetch", fetchMock);

    const settings = await refreshTrumpTruthSettings(
      {
        settingsJson: JSON.stringify({
          markets: [
            {
              url: "https://polymarket.com/event/what-will-trump-post-this-week-may-11-may-17",
              slug: "what-will-trump-post-this-week-may-11-may-17",
              startAt: "2026-05-11T04:00:00.000Z",
              endAt: "2026-05-18T03:59:00.000Z",
              strikeTerms: ["King"],
              resolvedTerms: [],
              activeStrikeTerms: ["King"],
              lastParsedAt: "2026-05-16T12:00:00.000Z"
            }
          ]
        }),
        polymarketUrl: "https://polymarket.com/event/what-will-trump-post-this-week-may-11-may-17"
      } as Integration,
      false,
      new Date("2026-05-16T12:00:00.000Z")
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("public-search");
    expect(settings.markets?.map((market) => market.slug)).toEqual([
      "what-will-trump-post-this-week-may-11-may-17",
      "what-will-trump-post-this-week-may-24"
    ]);
    expect(settings.strikeTerms).toEqual(["King"]);
    expect(settings.lastDiscoveryAt).toBe("2026-05-16T12:00:00.000Z");
  });

  it("discovers the active Trump Truth market when the stored market is expired", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          events: [
            {
              slug: "what-will-trump-post-this-week-may-24",
              title: "What will Trump post this week? (May 24)",
              active: true,
              closed: false,
              tags: [{ slug: "trump" }, { slug: "mention-markets" }]
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            markets: [
              {
                question: 'Will Trump post "Harvard" on Truth Social this week?',
                closed: false,
                outcomes: '["Yes","No"]',
                outcomePrices: '["0.4","0.6"]'
              }
            ]
          }
        ]
      });
    vi.stubGlobal("fetch", fetchMock);

    const settings = await refreshTrumpTruthSettings(
      {
        settingsJson: JSON.stringify({
          markets: [
            {
              url: "https://polymarket.com/event/what-will-trump-post-this-week-may-11-may-17",
              slug: "what-will-trump-post-this-week-may-11-may-17",
              startAt: "2026-05-11T04:00:00.000Z",
              endAt: "2026-05-18T03:59:00.000Z",
              strikeTerms: ["King"],
              resolvedTerms: [],
              activeStrikeTerms: ["King"],
              lastParsedAt: "2026-05-16T00:00:00.000Z"
            }
          ]
        }),
        polymarketUrl: "https://polymarket.com/event/what-will-trump-post-this-week-may-11-may-17"
      } as Integration,
      false,
      new Date("2026-05-18T12:00:00.000Z")
    );

    expect(settings.parsedFromUrl).toBe("https://polymarket.com/event/what-will-trump-post-this-week-may-24");
    expect(settings.strikeTerms).toEqual(["Harvard"]);
  });
});

describe("Trump Truth strike matcher", () => {
  it("matches case variants, plurals, possessives, and sigils", () => {
    expect(matchesStrikeTerm("KING", "king")).toBe(true);
    expect(matchesStrikeTerm("the kings arrived", "king")).toBe(true);
    expect(matchesStrikeTerm("king's order", "king")).toBe(true);
    expect(matchesStrikeTerm("king’s order", "king")).toBe(true);
    expect(matchesStrikeTerm("#king", "king")).toBe(true);
  });

  it("rejects symbol-inserted, misspelled, and embedded terms", () => {
    expect(matchesStrikeTerm("k!ng", "king")).toBe(false);
    expect(matchesStrikeTerm("kinng", "king")).toBe(false);
    expect(matchesStrikeTerm("makingdom", "king")).toBe(false);
    expect(matchesStrikeTerm("Ambassador", "Ass")).toBe(false);
  });
});

describe("Trump Truth post normalization", () => {
  it("marks qualifying text strikes and includes image URLs", () => {
    const post = normalizeTruthSocialStatus(
      {
        id: "1",
        created_at: "2026-05-06T00:00:00.000Z",
        url: "https://truthsocial.com/@realDonaldTrump/1",
        content: "<p>Hello King</p>",
        media_attachments: [{ type: "image", url: "https://example.com/image.jpg" }]
      },
      ["King"]
    );

    expect(post?.matchedTerms).toEqual(["King"]);
    expect(post?.imageUrls).toEqual(["https://example.com/image.jpg"]);
    expect(post?.imageText).toBe("");
    expect(post?.type).toBe("Truth");
  });

  it("does not count reTruth text as qualifying", () => {
    const post = normalizeTruthSocialStatus(
      {
        id: "retruth",
        created_at: "2026-05-06T00:00:00.000Z",
        content: "",
        reblog: {
          id: "original",
          created_at: "2026-05-06T00:00:00.000Z",
          content: "<p>King</p>",
          url: "https://truthsocial.com/@someone/1"
        }
      },
      ["King"]
    );

    expect(post?.type).toBe("ReTruth");
    expect(post?.matchedTerms).toEqual([]);
  });

  it("finds multiple matched terms", () => {
    expect(findMatchedStrikeTerms("King and FBI", ["King", "FBI", "No Card"])).toEqual(["King", "FBI"]);
  });
});

describe("Trump Truth archive feed", () => {
  it("builds archive search URLs with ET date filters", () => {
    expect(
      buildTrumpTruthArchiveSearchUrl(
        "King",
        new Date("2026-05-04T04:00:00.000Z"),
        new Date("2026-05-11T03:59:00.000Z")
      )
    ).toBe("https://www.trumpstruth.org/search?query=King&start_date=2026-05-04&end_date=2026-05-10&removed=include&per_page=100");
  });

  it("parses archive search results for a strike term", () => {
    const result = parseTrumpTruthArchiveSearchResults(
      `
      <h2 class="search-page__heading">2 results for 'King'</h2>
      <div class="search-result" data-status-url="https://www.trumpstruth.org/statuses/1">
        <div class="status-info__meta">
          <a class="status-info__meta-item">@realDonaldTrump</a>
          <a class="status-info__meta-item">May 6, 2026, 1:00 PM</a>
        </div>
        <div class="search-result__body">
          <div class="snippet-content">Hello <em>King</em>.</div>
        </div>
      </div>
      <div class="search-result" data-status-url="/statuses/2">
        <div class="status-info__meta">
          <a class="status-info__meta-item">@realDonaldTrump</a>
          <a class="status-info__meta-item">May 7, 2026, 2:00 PM</a>
        </div>
        <div class="search-result__body">
          <div class="snippet-content">makingdom should not match.</div>
        </div>
      </div>
      `,
      "King"
    );

    expect(result.totalResults).toBe(1);
    expect(result.hits).toEqual([
      {
        url: "https://www.trumpstruth.org/statuses/1",
        postedAt: "May 6, 2026, 1:00 PM",
        snippet: "Hello King."
      }
    ]);
  });

  it("parses archive feed items with original Truth Social metadata", () => {
    const items = parseTrumpTruthArchiveFeed(`
      <rss xmlns:truth="https://truthsocial.com/ns"><channel><item>
        <title>Post</title>
        <link>https://www.trumpstruth.org/statuses/1</link>
        <description><![CDATA[<p>Hello King</p><img src="https://example.com/image.jpg">]]></description>
        <pubDate>Wed, 06 May 2026 03:10:26 +0000</pubDate>
        <truth:originalUrl>https://truthsocial.com/@realDonaldTrump/123</truth:originalUrl>
        <truth:originalId>123</truth:originalId>
      </item></channel></rss>
    `);

    expect(items[0]).toMatchObject({
      id: "123",
      archiveUrl: "https://www.trumpstruth.org/statuses/1",
      originalUrl: "https://truthsocial.com/@realDonaldTrump/123",
      originalId: "123"
    });
  });

  it("detects archive RT items as ReTruths", () => {
    const items = parseTrumpTruthArchiveFeed(`
      <rss xmlns:truth="https://truthsocial.com/ns"><channel><item>
        <title>RT @NewtGingrichAfter spending this week reviewing Israel</title>
        <link>https://www.trumpstruth.org/statuses/1</link>
        <description><![CDATA[<p>RT <span>@NewtGingrich</span>Israel</p>]]></description>
        <pubDate>Sun, 31 May 2026 14:13:18 +0000</pubDate>
        <truth:originalUrl>https://truthsocial.com/@realDonaldTrump/116669598824791805</truth:originalUrl>
        <truth:originalId>116669598824791805</truth:originalId>
      </item></channel></rss>
    `);

    expect(items[0]).toMatchObject({ isReTruth: true });
  });

  it("normalizes archive items into event posts with text strikes and images", () => {
    const post = normalizeTrumpTruthArchiveItem(
      {
        id: "123",
        archiveUrl: "https://www.trumpstruth.org/statuses/1",
        originalUrl: "https://truthsocial.com/@realDonaldTrump/123",
        originalId: "123",
        postedAt: new Date("2026-05-06T03:10:26.000Z"),
        html: '<p>Hello King</p><a class="status-attachment__link" href="https://example.com/image.jpg"></a><img src="https://example.com/image.jpg">',
        title: "Post"
      },
      ["King"]
    );

    expect(post.id).toBe("123");
    expect(post.url).toBe("https://truthsocial.com/@realDonaldTrump/123");
    expect(post.matchedTerms).toEqual(["King"]);
    expect(post.imageUrls).toEqual(["https://example.com/image.jpg"]);
  });

  it("does not count archive ReTruth text as qualifying", () => {
    const post = normalizeTrumpTruthArchiveItem(
      {
        id: "123",
        archiveUrl: "https://www.trumpstruth.org/statuses/1",
        originalUrl: "https://truthsocial.com/@realDonaldTrump/123",
        originalId: "123",
        postedAt: new Date("2026-05-31T14:13:18.000Z"),
        html: "<p>RT @NewtGingrich Israel</p>",
        title: "RT @NewtGingrichIsrael",
        isReTruth: true
      },
      ["Israel"]
    );

    expect(post.type).toBe("ReTruth");
    expect(post.text).toContain("Israel");
    expect(post.qualifyingText).toBe("");
    expect(post.matchedTerms).toEqual([]);
  });

  it("checks archive posts against the active market window", () => {
    const market = {
      startAt: "2026-05-25T04:00:00.000Z",
      endAt: "2026-06-01T03:59:00.000Z"
    };
    const insidePost = normalizeTrumpTruthArchiveItem(
      {
        id: "123",
        archiveUrl: "https://www.trumpstruth.org/statuses/1",
        originalUrl: "https://truthsocial.com/@realDonaldTrump/123",
        originalId: "123",
        postedAt: new Date("2026-05-31T14:13:18.000Z"),
        html: "<p>Hello</p>",
        title: "Post"
      },
      []
    );
    const outsidePost = { ...insidePost, postedAt: new Date("2026-06-01T04:00:00.000Z") };

    expect(isPostInTrumpTruthMarketWindow(insidePost, market)).toBe(true);
    expect(isPostInTrumpTruthMarketWindow(outsidePost, market)).toBe(false);
  });

  it("deduplicates archive full-size images and thumbnails for the same attachment", () => {
    const post = normalizeTrumpTruthArchiveItem(
      {
        id: "123",
        archiveUrl: "https://www.trumpstruth.org/statuses/1",
        originalUrl: "https://truthsocial.com/@realDonaldTrump/123",
        originalId: "123",
        postedAt: new Date("2026-05-12T02:53:01.000Z"),
        html: `
          <div class="status__attachments">
            <a class="status-attachment__link" href="https://truth-archive.example/attachments/16198/53c7a1811e48bca3.png">
              <img src="https://truth-archive.example/attachments/16198/53c7a1811e48bca3.png">
            </a>
          </div>
          <div class="status-details-attachment__media">
            <a href="https://truth-archive.example/attachments/16198/53c7a1811e48bca3.png">
              <img src="https://static-assets.example/media_attachments/files/116/559/334/488/788/491/small/53c7a1811e48bca3.png">
            </a>
          </div>
          <video src="https://static-assets.example/media_attachments/files/116/559/330/698/197/972/original/video.mp4"></video>
        `,
        title: "Post"
      },
      []
    );

    expect(post.imageUrls).toEqual(["https://truth-archive.example/attachments/16198/53c7a1811e48bca3.png"]);
  });

  it("matches strike terms from archive image descriptions", () => {
    const post = normalizeTrumpTruthArchiveItem(
      {
        id: "123",
        archiveUrl: "https://www.trumpstruth.org/statuses/1",
        originalUrl: "https://truthsocial.com/@realDonaldTrump/123",
        originalId: "123",
        postedAt: new Date("2026-05-06T03:10:26.000Z"),
        html: '<p></p><img src="https://example.com/image.jpg" alt="A screenshot that mentions King">',
        title: "Post"
      },
      ["King"]
    );

    expect(post.text).toBe("");
    expect(post.imageUrls).toEqual(["https://example.com/image.jpg"]);
    expect(post.imageText).toBe("A screenshot that mentions King");
    expect(post.matchedTerms).toEqual(["King"]);
  });

  it("matches strike terms from archive attachment detail text", () => {
    const post = normalizeTrumpTruthArchiveItem(
      {
        id: "123",
        archiveUrl: "https://www.trumpstruth.org/statuses/1",
        originalUrl: "https://truthsocial.com/@realDonaldTrump/123",
        originalId: "123",
        postedAt: new Date("2026-05-06T03:10:26.000Z"),
        html: '<div class="status-details-attachment__text">Screenshot text says FBI</div>',
        title: "Post"
      },
      ["FBI"]
    );

    expect(post.imageText).toBe("Screenshot text says FBI");
    expect(post.matchedTerms).toEqual(["FBI"]);
  });

  it("matches strike terms from OCR text when archive image text misses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
      })
    );
    vi.mocked(Tesseract.recognize).mockResolvedValue({
      data: { text: "Jimmy Kimmel screenshot" }
    } as Awaited<ReturnType<typeof Tesseract.recognize>>);

    const post = await enrichTrumpTruthPostWithOcr(
      normalizeTrumpTruthArchiveItem(
        {
          id: "123",
          archiveUrl: "https://www.trumpstruth.org/statuses/1",
          originalUrl: "https://truthsocial.com/@realDonaldTrump/123",
          originalId: "123",
          postedAt: new Date("2026-05-06T03:10:26.000Z"),
          html: '<p></p><img src="https://example.com/image.jpg" alt="unrelated image description">',
          title: "Post"
        },
        ["Jimmy", "Kimmel"]
      ),
      ["Jimmy", "Kimmel"]
    );

    expect(post.imageText).toContain("unrelated image description");
    expect(post.imageText).toContain("Jimmy Kimmel screenshot");
    expect(post.matchedTerms).toEqual(["Jimmy", "Kimmel"]);
  });

  it("still OCRs image posts after archive text already matched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
      })
    );
    vi.mocked(Tesseract.recognize).mockResolvedValue({
      data: { text: "Kimmel screenshot" }
    } as Awaited<ReturnType<typeof Tesseract.recognize>>);

    const post = await enrichTrumpTruthPostWithOcr(
      normalizeTrumpTruthArchiveItem(
        {
          id: "124",
          archiveUrl: "https://www.trumpstruth.org/statuses/2",
          originalUrl: "https://truthsocial.com/@realDonaldTrump/124",
          originalId: "124",
          postedAt: new Date("2026-05-06T03:10:26.000Z"),
          html: '<p></p><img src="https://example.com/already-matched.jpg" alt="King screenshot">',
          title: "Post"
        },
        ["King", "Kimmel"]
      ),
      ["King", "Kimmel"]
    );

    expect(post.matchedTerms).toEqual(["King", "Kimmel"]);
  });

  it("does not run OCR or count image text for ReTruths", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const post = await enrichTrumpTruthPostWithOcr(
      normalizeTrumpTruthArchiveItem(
        {
          id: "126",
          archiveUrl: "https://www.trumpstruth.org/statuses/3",
          originalUrl: "https://truthsocial.com/@realDonaldTrump/126",
          originalId: "126",
          postedAt: new Date("2026-05-31T14:13:18.000Z"),
          html: '<p>RT @NewtGingrich</p><img src="https://example.com/retruth.jpg" alt="Israel screenshot">',
          title: "RT @NewtGingrich",
          isReTruth: true
        },
        ["Israel"]
      ),
      ["Israel"]
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(post.qualifyingText).toBe("");
    expect(post.matchedTerms).toEqual([]);
  });

  it("retries OCR after a transient image fetch failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(Tesseract.recognize).mockResolvedValue({
      data: { text: "Jimmy screenshot" }
    } as Awaited<ReturnType<typeof Tesseract.recognize>>);
    const basePost = normalizeTrumpTruthArchiveItem(
      {
        id: "125",
        archiveUrl: "https://www.trumpstruth.org/statuses/1",
        originalUrl: "https://truthsocial.com/@realDonaldTrump/125",
        originalId: "125",
        postedAt: new Date("2026-05-06T03:10:26.000Z"),
        html: '<p></p><img src="https://example.com/transient-failure.jpg" alt="unrelated">',
        title: "Post"
      },
      ["Jimmy"]
    );

    await expect(enrichTrumpTruthPostWithOcr(basePost, ["Jimmy"])).resolves.toMatchObject({ matchedTerms: [] });
    await expect(enrichTrumpTruthPostWithOcr(basePost, ["Jimmy"])).resolves.toMatchObject({ matchedTerms: ["Jimmy"] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the archive URL when original Truth Social metadata is missing", () => {
    const post = normalizeTrumpTruthArchiveItem(
      {
        id: "123",
        archiveUrl: "https://www.trumpstruth.org/statuses/1",
        originalUrl: "",
        originalId: "",
        postedAt: new Date("2026-05-06T03:10:26.000Z"),
        html: "<p>Hello</p>",
        title: "Post"
      },
      []
    );

    expect(post.url).toBe("https://www.trumpstruth.org/statuses/1");
  });

  it("falls back to RSS content when archive detail fetch times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          text: async () => `
            <rss xmlns:truth="https://truthsocial.com/ns"><channel><item>
              <title>Post</title>
              <link>https://www.trumpstruth.org/statuses/1</link>
              <description><![CDATA[<p>Hello King</p>]]></description>
              <pubDate>Wed, 06 May 2026 03:10:26 +0000</pubDate>
              <truth:originalUrl>https://truthsocial.com/@realDonaldTrump/123</truth:originalUrl>
              <truth:originalId>123</truth:originalId>
            </item></channel></rss>
          `
        })
        .mockRejectedValueOnce(new Error("Request failed for detail: timeout"))
    );

    expect(trumpTruthAdapter.fetchEventUpdates).toBeDefined();
    const result = await trumpTruthAdapter.fetchEventUpdates!({
      settingsJson: JSON.stringify({
        markets: [
          {
            url: "https://polymarket.com/event/what-will-trump-post-this-week-may-11-may-17",
            slug: "what-will-trump-post-this-week-may-11-may-17",
            startAt: "2026-05-01T04:00:00.000Z",
            endAt: "2100-01-01T00:00:00.000Z",
            strikeTerms: ["King"],
            resolvedTerms: [],
            activeStrikeTerms: ["King"],
            lastParsedAt: "2100-01-01T00:00:00.000Z"
          }
        ]
      }),
      polymarketUrl: "https://polymarket.com/event/what-will-trump-post-this-week-may-4-may-10"
    } as Integration);

    expect(result.posts[0]).toMatchObject({
      id: "123",
      text: "Hello King",
      matchedTerms: ["King"]
    });
  });

  it("shows archive and market diagnostics when no compatible active market exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          text: async () => `
            <rss xmlns:truth="https://truthsocial.com/ns"><channel><item>
              <title>Post</title>
              <link>https://www.trumpstruth.org/statuses/2</link>
              <description><![CDATA[<p>Latest archive post</p>]]></description>
              <pubDate>Sat, 06 Jun 2026 20:24:17 +0000</pubDate>
              <truth:originalUrl>https://truthsocial.com/@realDonaldTrump/116705031438300324</truth:originalUrl>
              <truth:originalId>116705031438300324</truth:originalId>
            </item></channel></rss>
          `
        })
        .mockResolvedValueOnce({ ok: false })
    );

    expect(trumpTruthAdapter.fetchEventUpdates).toBeDefined();
    const result = await trumpTruthAdapter.fetchEventUpdates!({
      settingsJson: JSON.stringify({
        lastDiscoveryAt: "2100-01-01T00:00:00.000Z",
        markets: [
          {
            url: "https://polymarket.com/event/what-will-trump-post-this-week-may-31",
            slug: "what-will-trump-post-this-week-may-31",
            startAt: "2026-05-25T04:00:00.000Z",
            endAt: "2026-06-01T03:59:00.000Z",
            strikeTerms: ["Israel"],
            resolvedTerms: [],
            activeStrikeTerms: ["Israel"],
            lastParsedAt: "2026-05-31T00:00:00.000Z"
          }
        ]
      }),
      polymarketUrl: "https://polymarket.com/event/what-will-trump-post-this-week-may-31"
    } as Integration);

    expect(result.posts).toEqual([]);
    expect(result.checkFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Active Polymarket market",
          value: expect.stringContaining("none found")
        }),
        expect.objectContaining({
          name: "Latest archive feed post",
          value: expect.stringContaining("116705031438300324")
        })
      ])
    );
  });
});
