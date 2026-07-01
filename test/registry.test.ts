import { describe, expect, it } from "vitest";
import { getAdapterByCommandName, listAdapters } from "../src/integrations/registry.js";

const expectedCommandIds = [
  ["aaa", "aaa-regular-gas"],
  ["alignedsale", "aligned-layer-sale"],
  ["allin", "all-in-podcast"],
  ["joerogan", "joe-rogan-podcast"],
  ["lemonade", "lemonade-stand-podcast"],
  ["songreleases", "apple-artist-song-releases"],
  ["arenaai", "arena-ai-no-style-control"],
  ["aws", "aws-disrupted-events"],
  ["basedrevenue", "based-revenue"],
  ["bea", "bea-current-releases"],
  ["jisdor", "bi-jisdor-usd-idr"],
  ["billboard200", "billboard-200-number-one-album"],
  ["billboardhot100", "billboard-hot-100-number-one-song"],
  ["blscpi", "bls-cpi-releases"],
  ["jobsadded", "bls-jobs-added"],
  ["bonbast", "bonbast-usd-irr"],
  ["fertility", "cdc-fertility-rate"],
  ["fluhosp", "cdc-flu-hospitalization"],
  ["measles", "cdc-measles"],
  ["durablegoods", "census-durable-goods"],
  ["claudeavg", "claude-code-commits-average"],
  ["claudecommits", "claude-code-commits"],
  ["claudedown", "claude-downtime"],
  ["cloudflare", "cloudflare-critical-incidents"],
  ["arb", "cross-platform-arbitrage"],
  ["discord", "discord-critical-incidents"],
  ["ecdsafail", "ecdsa-fail"],
  ["eia", "eia-crude-spr"],
  ["ethgasmonthly", "ethereum-gas-monthly-average"],
  ["elonx", "elon-x-strikes"],
  ["fdic", "fdic-failed-banks"],
  ["eggs", "fred-egg-price"],
  ["beef", "fred-ground-beef"],
  ["freeappstore", "free-app-store"],
  ["hkprecip", "hk-precip"],
  ["iswmap", "isw-ukraine-map"],
  ["ismpmi", "ism-services-pmi"],
  ["kaitomindshare", "kaito-polymarket-mindshare"],
  ["kpopreleases", "apple-kpop-song-releases"],
  ["koreaprecip", "kma-seoul-precip"],
  ["londonprecip", "met-office-london-precip"],
  ["mtwind", "mt-washington-wind"],
  ["mrbeastgaming", "mrbeast-gaming-video"],
  ["mrbeastsubs", "mrbeast-subscribers"],
  ["mrbeastviews", "mrbeast-views"],
  ["nbs", "nbs-press-release"],
  ["gistemp", "nasa-gistemp-temperature"],
  ["tornadoes", "ncei-tornadoes"],
  ["nytfront", "nyt-front-page"],
  ["anthropicvaluation", "npm-anthropic-valuation"],
  ["andurilvaluation", "npm-anduril-valuation"],
  ["bytedancevaluation", "npm-bytedance-valuation"],
  ["canvavaluation", "npm-canva-valuation"],
  ["databricksvaluation", "npm-databricks-valuation"],
  ["epicgamesvaluation", "npm-epic-games-valuation"],
  ["gleanvaluation", "npm-glean-valuation"],
  ["krakenvaluation", "npm-kraken-valuation"],
  ["lambdavaluation", "npm-lambda-valuation"],
  ["neuralinkvaluation", "npm-neuralink-valuation"],
  ["openaivaluation", "npm-openai-valuation"],
  ["perplexityvaluation", "npm-perplexity-valuation"],
  ["revolutvaluation", "npm-revolut-valuation"],
  ["stripevaluation", "npm-stripe-valuation"],
  ["atlantarain", "noaa-atlanta-rain"],
  ["bostonrain", "noaa-boston-rain"],
  ["dallasrain", "noaa-dallas-rain"],
  ["denverrain", "noaa-denver-rain"],
  ["nycprecip", "noaa-nyc-precip"],
  ["sfrain", "noaa-san-francisco-rain"],
  ["seattleprecip", "noaa-seattle-precip"],
  ["chatgptoutage", "openai-chatgpt-outages"],
  ["ornnb200", "ornn-b200-index"],
  ["ornnh100", "ornn-h100-index"],
  ["ornnh200", "ornn-h200-index"],
  ["paidappstore", "paid-app-store"],
  ["parisheat", "paris-heat-wave"],
  ["dchomevalue", "parcl-dc-home-value"],
  ["nychomevalue", "parcl-nyc-home-value"],
  ["pboc", "pboc-rate-change"],
  ["powerball", "powerball-jackpot"],
  ["pumpgo", "pump-fun-go"],
  ["mentions", "polymarket-mention-markets"],
  ["umaclarifications", "polymarket-clarifications"],
  ["umadispute", "polymarket-disputes"],
  ["umaproposals", "polymarket-proposals"],
  ["resolvable", "polymarket-resolvable"],
  ["polymarketstatus", "polymarket-status"],
  ["babmandeb", "portwatch-bab-el-mandeb"],
  ["hormuzships", "portwatch-hormuz-ships"],
  ["umacommits", "uma-vote-commits"],
  ["umareveals", "uma-vote-reveals"],
  ["umarocks", "uma-voting-committee"],
  ["ngprice", "pyth-natural-gas-strikes"],
  ["wti", "pyth-wti-strikes"],
  ["xagusd", "pyth-xagusd-strikes"],
  ["xauusd", "pyth-xauusd-strikes"],
  ["rwatotal", "rwa-total-value"],
  ["trumpapproval", "silver-trump-approval"],
  ["spiderman", "spider-man-trailer"],
  ["spotifyglobal", "spotify-top-50-global"],
  ["spotifyusa", "spotify-top-50-usa"],
  ["strategybtc", "strategy-bitcoin-purchases"],
  ["tesla", "tesla-deliveries"],
  ["trumpgetty", "trump-getty-photos"],
  ["trumpschedule", "trump-schedule"],
  ["trumptruth", "trump-truth"],
  ["tsa", "tsa-passengers"],
  ["treasurymts", "treasury-mts-deficit"],
  ["umichsentiment", "umich-consumer-sentiment"],
  ["earthquake", "usgs-earthquakes"],
  ["earthquake65", "usgs-earthquakes-6-5"],
  ["earthquake7", "usgs-earthquakes-7-plus"],
  ["earthquake2026", "usgs-earthquakes-7-plus-2026"],
  ["bviv", "volmex-bviv-low-strikes"],
  ["eviv", "volmex-eviv-high-strikes"],
  ["aliennyc", "white-house-aliens-nyc"],
  ["whbriefings", "white-house-briefings"],
  ["fulllid", "white-house-full-lid"],
  ["whitehousetweets", "white-house-tweets"]
] as const;

describe("adapter registry", () => {
  it.each(expectedCommandIds)("resolves /%s to %s", (commandName, adapterId) => {
    expect(getAdapterByCommandName(commandName).id).toBe(adapterId);
  });

  it("does not reuse command names or adapter ids", () => {
    const adapters = listAdapters();
    expect(adapters).toHaveLength(expectedCommandIds.length);
    expect(new Set(adapters.map((adapter) => adapter.commandName)).size).toBe(adapters.length);
    expect(new Set(adapters.map((adapter) => adapter.id)).size).toBe(adapters.length);
  });

  it("defines required Discord metadata for every adapter", () => {
    for (const adapter of listAdapters()) {
      expect(adapter.id).toMatch(/^[a-z0-9-]+$/);
      expect(adapter.commandName).toMatch(/^[a-z0-9]+$/);
      expect(adapter.displayName).toBeTruthy();
      expect(adapter.sourceUrl).toMatch(/^https?:\/\//);
      expect(adapter.defaultChannelName).toMatch(/^[a-z0-9-]+$/);
      expect(adapter.alertRoleName).toBeTruthy();
      expect(adapter.alertRoleEmoji).toBeTruthy();
    }
  });

  it("keeps known dynamic polling and special-command capabilities", () => {
    expect(getAdapterByCommandName("freeappstore").dailySnapshot).toMatchObject({ timeZone: "America/New_York" });
    expect(getAdapterByCommandName("paidappstore").dailySnapshot).toMatchObject({ timeZone: "America/New_York" });
    expect(getAdapterByCommandName("hkprecip").supportsPeriod).toBe(true);
    expect(getAdapterByCommandName("koreaprecip").supportsPeriod).toBe(true);
    expect(getAdapterByCommandName("londonprecip").supportsPeriod).toBe(true);
    expect(getAdapterByCommandName("mtwind").supportsPeriod).toBe(true);
    expect(getAdapterByCommandName("nycprecip").supportsPeriod).toBe(true);
    expect(getAdapterByCommandName("seattleprecip").supportsPeriod).toBe(true);
    expect(getAdapterByCommandName("claudedown").supportsPeriod).toBe(true);
    expect(getAdapterByCommandName("gistemp").supportsPeriod).toBe(true);
    expect(getAdapterByCommandName("chatgptoutage").supportsPeriod).toBe(true);
    expect(getAdapterByCommandName("hkprecip").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("koreaprecip").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("londonprecip").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("mtwind").getPollIntervalMinutes?.({} as never)).toBe(5);
    expect(getAdapterByCommandName("nycprecip").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("seattleprecip").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("claudedown").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("chatgptoutage").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("discord").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("elonx").supportsStrikes).toBe(true);
    expect(getAdapterByCommandName("elonx").getPollIntervalMinutes?.({ polymarketUrl: "https://polymarket.com/event/what-will-elon-post-this-week-june-15-21-20260612141418431", settingsJson: null } as never, new Date("2026-06-15T16:00:00.000Z"))).toBe(1);
    expect(getAdapterByCommandName("allin").getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(getAdapterByCommandName("joerogan").getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(getAdapterByCommandName("joerogan").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("lemonade").getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(getAdapterByCommandName("lemonade").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("trumptruth").supportsStrikes).toBe(true);
    expect(getAdapterByCommandName("claudeavg").getPollIntervalMinutes?.({} as never)).toBe(60);
    expect(getAdapterByCommandName("claudecommits").supportsStrikes).toBe(true);
    expect(getAdapterByCommandName("umaproposals").searchTags).toBeDefined();
    expect(getAdapterByCommandName("umaproposals").updateTagFilters).toBeDefined();
    expect(getAdapterByCommandName("umadispute").updateAddressLabels).toBeDefined();
    expect(getAdapterByCommandName("resolvable").updateResolvableWatchlist).toBeDefined();
    expect(getAdapterByCommandName("resolvable").fetchEventUpdates).toBeDefined();
    expect(getAdapterByCommandName("resolvable").getPollIntervalMinutes?.({ settingsJson: null } as never)).toBe(1);
    expect(getAdapterByCommandName("polymarketstatus").getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(getAdapterByCommandName("eia").getPollIntervalMinutes?.({} as never, new Date("2026-05-12T16:00:00.000Z"))).toBe(1);
    expect(getAdapterByCommandName("ethgasmonthly").getPollIntervalMinutes?.({} as never)).toBe(60);
    expect(getAdapterByCommandName("jobsadded").getPollIntervalMinutes?.({ polymarketUrl: "https://polymarket.com/event/how-many-jobs-added-in-may-945" } as never, new Date("2026-06-04T16:00:00.000Z"))).toBe(1);
    expect(getAdapterByCommandName("ismpmi").getPollIntervalMinutes?.({} as never, new Date("2026-06-02T16:00:00.000Z"))).toBe(1);
    expect(getAdapterByCommandName("durablegoods").getPollIntervalMinutes?.({} as never, new Date("2026-06-25T13:00:00.000Z"))).toBe(1);
    expect(getAdapterByCommandName("umichsentiment").getPollIntervalMinutes?.({} as never, new Date("2026-07-31T14:00:00.000Z"))).toBe(1);
    expect(getAdapterByCommandName("trumpschedule").getPollIntervalMinutes?.({} as never, new Date("2026-05-29T13:00:00.000Z"))).toBe(15);
    expect(getAdapterByCommandName("powerball").getPollIntervalMinutes?.({} as never)).toBe(1_440);
    expect(getAdapterByCommandName("pumpgo").getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(getAdapterByCommandName("pumpgo").getErrorNoticeWindowMinutes?.({} as never)).toBe(30);
    expect(getAdapterByCommandName("claudecommits").getPollIntervalMinutes?.({} as never)).toBe(60);
    expect(getAdapterByCommandName("claudedown").getPollIntervalMinutes?.({} as never)).toBe(60);
    expect(getAdapterByCommandName("arb").prepareArbitrageSetup).toBeDefined();
    expect(getAdapterByCommandName("arb").configureArbitrageWatch).toBeDefined();
    expect(getAdapterByCommandName("arb").getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(getAdapterByCommandName("fluhosp").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("fluhosp").getPollIntervalMinutes?.({} as never)).toBe(60);
    expect(getAdapterByCommandName("mrbeastgaming").getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(getAdapterByCommandName("mrbeastsubs").getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(getAdapterByCommandName("mrbeastviews").getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(getAdapterByCommandName("mrbeastviews").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("ornnh100").getPollIntervalMinutes?.({} as never)).toBe(60);
    expect(getAdapterByCommandName("ornnh100").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("ornnh200").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("ornnb200").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("dchomevalue").getPollIntervalMinutes?.({} as never, new Date("2026-06-30T16:00:00.000Z"))).toBe(1);
    expect(getAdapterByCommandName("nychomevalue").getPollIntervalMinutes?.({} as never, new Date("2026-06-30T16:00:00.000Z"))).toBe(1);
    expect(getAdapterByCommandName("pboc").getPollIntervalMinutes?.({} as never)).toBe(15);
    expect(getAdapterByCommandName("billboard200").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("billboard200").getPollIntervalMinutes?.({} as never)).toBe(60);
    expect(getAdapterByCommandName("billboardhot100").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("billboardhot100").getPollIntervalMinutes?.({} as never)).toBe(60);
    expect(getAdapterByCommandName("parisheat").getPollIntervalMinutes?.({} as never)).toBe(5);
    expect(getAdapterByCommandName("ngprice").getErrorNoticeWindowMinutes?.({} as never)).toBe(30);
    expect(getAdapterByCommandName("whitehousetweets").getPollIntervalMinutes?.({} as never)).toBe(5);
    expect(getAdapterByCommandName("whbriefings").getPollIntervalMinutes?.({} as never)).toBe(15);
    expect(getAdapterByCommandName("hormuzships").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("hormuzships").getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(getAdapterByCommandName("whitehousetweets").upsertPolymarketMarket).toBeDefined();
    expect(getAdapterByCommandName("umacommits").updateThreshold).toBeDefined();
    expect(getAdapterByCommandName("umacommits").getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(getAdapterByCommandName("umacommits").maxEventPostAgeMinutes).toBe(10);
    expect(getAdapterByCommandName("umareveals").updateThreshold).toBeDefined();
    expect(getAdapterByCommandName("umareveals").getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(getAdapterByCommandName("umareveals").maxEventPostAgeMinutes).toBe(10);
    expect(getAdapterByCommandName("umarocks").getPollIntervalMinutes?.({} as never)).toBe(10);
    expect(getAdapterByCommandName("bviv").getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(getAdapterByCommandName("bviv").getErrorNoticeWindowMinutes?.({} as never)).toBe(30);
    expect(getAdapterByCommandName("eviv").getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(getAdapterByCommandName("eviv").getErrorNoticeWindowMinutes?.({} as never)).toBe(30);
    expect(getAdapterByCommandName("rwatotal").getPollIntervalMinutes?.({} as never)).toBe(60);
    expect(getAdapterByCommandName("trumpapproval").getPollIntervalMinutes?.({} as never, new Date("2026-06-05T16:00:00.000Z"))).toBe(1);
    expect(getAdapterByCommandName("spiderman").fetchEventUpdates).toBeDefined();
    expect(getAdapterByCommandName("spiderman").getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(getAdapterByCommandName("nytfront").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("nytfront").supportsStrikes).toBe(true);
    expect(getAdapterByCommandName("nytfront").getPollIntervalMinutes?.({} as never)).toBe(60);
    expect(getAdapterByCommandName("databricksvaluation").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("databricksvaluation").getPollIntervalMinutes?.({} as never, new Date("2026-07-01T17:00:00.000Z"))).toBe(10 / 60);
    expect(getAdapterByCommandName("openaivaluation").getPollIntervalMinutes?.({} as never, new Date("2026-07-01T18:00:00.000Z"))).toBe(1);
    expect(getAdapterByCommandName("spotifyglobal").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("spotifyusa").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("strategybtc").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("trumpgetty").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("trumpgetty").getPollIntervalMinutes?.({} as never)).toBe(60);
    expect(getAdapterByCommandName("fulllid").refreshSettings).toBeDefined();
  });
});
