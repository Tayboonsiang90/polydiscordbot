import { describe, expect, it } from "vitest";
import { getAdapterByCommandName, listAdapters } from "../src/integrations/registry.js";

const expectedCommandIds = [
  ["aaa", "aaa-regular-gas"],
  ["alignedsale", "aligned-layer-sale"],
  ["allin", "all-in-podcast"],
  ["songreleases", "apple-artist-song-releases"],
  ["arenaai", "arena-ai-no-style-control"],
  ["aws", "aws-disrupted-events"],
  ["basedrevenue", "based-revenue"],
  ["bea", "bea-current-releases"],
  ["blscpi", "bls-cpi-releases"],
  ["jobsadded", "bls-jobs-added"],
  ["bonbast", "bonbast-usd-irr"],
  ["fertility", "cdc-fertility-rate"],
  ["measles", "cdc-measles"],
  ["claudecommits", "claude-code-commits"],
  ["claudedown", "claude-downtime"],
  ["cloudflare", "cloudflare-critical-incidents"],
  ["discord", "discord-critical-incidents"],
  ["eia", "eia-crude-spr"],
  ["fdic", "fdic-failed-banks"],
  ["eggs", "fred-egg-price"],
  ["beef", "fred-ground-beef"],
  ["freeappstore", "free-app-store"],
  ["hkprecip", "hk-precip"],
  ["ismpmi", "ism-services-pmi"],
  ["kaitomindshare", "kaito-polymarket-mindshare"],
  ["kpopreleases", "apple-kpop-song-releases"],
  ["koreaprecip", "kma-seoul-precip"],
  ["londonprecip", "met-office-london-precip"],
  ["mrbeastsubs", "mrbeast-subscribers"],
  ["mrbeastviews", "mrbeast-views"],
  ["nbs", "nbs-press-release"],
  ["gistemp", "nasa-gistemp-temperature"],
  ["tornadoes", "ncei-tornadoes"],
  ["nycprecip", "noaa-nyc-precip"],
  ["seattleprecip", "noaa-seattle-precip"],
  ["nytfront", "nyt-front-page"],
  ["chatgptoutage", "openai-chatgpt-outages"],
  ["ornnb200", "ornn-b200-index"],
  ["ornnh100", "ornn-h100-index"],
  ["ornnh200", "ornn-h200-index"],
  ["paidappstore", "paid-app-store"],
  ["powerball", "powerball-jackpot"],
  ["umaclarifications", "polymarket-clarifications"],
  ["umadispute", "polymarket-disputes"],
  ["umaproposals", "polymarket-proposals"],
  ["umacommits", "uma-vote-commits"],
  ["umareveals", "uma-vote-reveals"],
  ["umavotes", "uma-voting-committee"],
  ["ngprice", "pyth-natural-gas-strikes"],
  ["wti", "pyth-wti-strikes"],
  ["xagusd", "pyth-xagusd-strikes"],
  ["xauusd", "pyth-xauusd-strikes"],
  ["spotifyglobal", "spotify-top-50-global"],
  ["spotifyusa", "spotify-top-50-usa"],
  ["strategybtc", "strategy-bitcoin-purchases"],
  ["tesla", "tesla-deliveries"],
  ["trumpschedule", "trump-schedule"],
  ["trumptruth", "trump-truth"],
  ["tsa", "tsa-passengers"],
  ["earthquake", "usgs-earthquakes"],
  ["aliennyc", "white-house-aliens-nyc"],
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
    expect(getAdapterByCommandName("nycprecip").supportsPeriod).toBe(true);
    expect(getAdapterByCommandName("seattleprecip").supportsPeriod).toBe(true);
    expect(getAdapterByCommandName("claudedown").supportsPeriod).toBe(true);
    expect(getAdapterByCommandName("gistemp").supportsPeriod).toBe(true);
    expect(getAdapterByCommandName("chatgptoutage").supportsPeriod).toBe(true);
    expect(getAdapterByCommandName("hkprecip").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("koreaprecip").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("londonprecip").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("nycprecip").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("seattleprecip").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("claudedown").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("chatgptoutage").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("discord").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("trumptruth").supportsStrikes).toBe(true);
    expect(getAdapterByCommandName("claudecommits").supportsStrikes).toBe(true);
    expect(getAdapterByCommandName("nytfront").supportsStrikes).toBe(true);
    expect(getAdapterByCommandName("umaproposals").searchTags).toBeDefined();
    expect(getAdapterByCommandName("umaproposals").updateTagFilters).toBeDefined();
    expect(getAdapterByCommandName("umadispute").updateAddressLabels).toBeDefined();
    expect(getAdapterByCommandName("eia").getPollIntervalMinutes?.({} as never, new Date("2026-05-12T16:00:00.000Z"))).toBe(1);
    expect(getAdapterByCommandName("jobsadded").getPollIntervalMinutes?.({ polymarketUrl: "https://polymarket.com/event/how-many-jobs-added-in-may-945" } as never, new Date("2026-06-04T16:00:00.000Z"))).toBe(1);
    expect(getAdapterByCommandName("ismpmi").getPollIntervalMinutes?.({} as never, new Date("2026-06-02T16:00:00.000Z"))).toBe(1);
    expect(getAdapterByCommandName("trumpschedule").getPollIntervalMinutes?.({} as never, new Date("2026-05-29T13:00:00.000Z"))).toBe(15);
    expect(getAdapterByCommandName("powerball").getPollIntervalMinutes?.({} as never)).toBe(1_440);
    expect(getAdapterByCommandName("claudecommits").getPollIntervalMinutes?.({} as never)).toBe(60);
    expect(getAdapterByCommandName("claudedown").getPollIntervalMinutes?.({} as never)).toBe(60);
    expect(getAdapterByCommandName("ornnh100").getPollIntervalMinutes?.({} as never)).toBe(60);
    expect(getAdapterByCommandName("ornnh100").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("ornnh200").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("ornnb200").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("ngprice").getErrorNoticeWindowMinutes?.({} as never)).toBe(30);
    expect(getAdapterByCommandName("whitehousetweets").getPollIntervalMinutes?.({} as never)).toBe(5);
    expect(getAdapterByCommandName("whitehousetweets").upsertPolymarketMarket).toBeDefined();
    expect(getAdapterByCommandName("umacommits").updateThreshold).toBeDefined();
    expect(getAdapterByCommandName("umacommits").getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(getAdapterByCommandName("umareveals").updateThreshold).toBeDefined();
    expect(getAdapterByCommandName("umareveals").getPollIntervalMinutes?.({} as never)).toBe(1);
    expect(getAdapterByCommandName("umavotes").getPollIntervalMinutes?.({} as never)).toBe(10);
  });
});
