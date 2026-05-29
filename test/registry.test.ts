import { describe, expect, it } from "vitest";
import { getAdapterByCommandName, listAdapters } from "../src/integrations/registry.js";

const expectedCommandIds = [
  ["aaa", "aaa-regular-gas"],
  ["allin", "all-in-podcast"],
  ["songreleases", "apple-artist-song-releases"],
  ["arenaai", "arena-ai-no-style-control"],
  ["aws", "aws-disrupted-events"],
  ["basedrevenue", "based-revenue"],
  ["bea", "bea-current-releases"],
  ["blscpi", "bls-cpi-releases"],
  ["bonbast", "bonbast-usd-irr"],
  ["fertility", "cdc-fertility-rate"],
  ["measles", "cdc-measles"],
  ["claudecommits", "claude-code-commits"],
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
  ["tornadoes", "ncei-tornadoes"],
  ["nycprecip", "noaa-nyc-precip"],
  ["seattleprecip", "noaa-seattle-precip"],
  ["nytfront", "nyt-front-page"],
  ["ornnb200", "ornn-b200-index"],
  ["ornnh200", "ornn-h200-index"],
  ["paidappstore", "paid-app-store"],
  ["powerball", "powerball-jackpot"],
  ["umaclarifications", "polymarket-clarifications"],
  ["umadispute", "polymarket-disputes"],
  ["umaproposals", "polymarket-proposals"],
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
  ["fulllid", "white-house-full-lid"]
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
    expect(getAdapterByCommandName("hkprecip").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("koreaprecip").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("londonprecip").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("nycprecip").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("seattleprecip").refreshSettings).toBeDefined();
    expect(getAdapterByCommandName("trumptruth").supportsStrikes).toBe(true);
    expect(getAdapterByCommandName("claudecommits").supportsStrikes).toBe(true);
    expect(getAdapterByCommandName("nytfront").supportsStrikes).toBe(true);
    expect(getAdapterByCommandName("umaproposals").searchTags).toBeDefined();
    expect(getAdapterByCommandName("umaproposals").updateTagFilters).toBeDefined();
    expect(getAdapterByCommandName("umadispute").updateAddressLabels).toBeDefined();
    expect(getAdapterByCommandName("eia").getPollIntervalMinutes?.({} as never, new Date("2026-05-12T16:00:00.000Z"))).toBe(1);
    expect(getAdapterByCommandName("ismpmi").getPollIntervalMinutes?.({} as never, new Date("2026-06-02T16:00:00.000Z"))).toBe(1);
    expect(getAdapterByCommandName("trumpschedule").getPollIntervalMinutes?.({} as never, new Date("2026-05-29T13:00:00.000Z"))).toBe(15);
    expect(getAdapterByCommandName("powerball").getPollIntervalMinutes?.({} as never)).toBe(1_440);
    expect(getAdapterByCommandName("claudecommits").getPollIntervalMinutes?.({} as never)).toBe(60);
    expect(getAdapterByCommandName("ngprice").getErrorNoticeWindowMinutes?.({} as never)).toBe(30);
  });
});
