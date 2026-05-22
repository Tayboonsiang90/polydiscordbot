import { describe, expect, it } from "vitest";
import {
  buildAdapterCommands,
  buildBotCommands,
  buildSimulatedAlertResult,
  formatPolymarketLine,
  normalizePolymarketUrl
} from "../src/commands.js";
import { buildAlertMessagePayload } from "../src/poller.js";
import {
  buildCheckEmbed,
  buildEventPostMessagePayload,
  buildGroupedRoleSelectorEmbed,
  buildIntegrationSummaryEmbeds,
  buildLastEmbed,
  buildMarketEndManualUpdatedEmbed,
  buildStrikeSearchEmbed,
  buildStatusEmbed
} from "../src/embeds.js";
import type { EventMonitorPost, Integration } from "../src/integrations/types.js";

const checkedIntegration: Integration = {
  id: 1,
  guildId: "guild",
  channelId: "channel",
  adapterId: "bonbast-usd-irr",
  displayName: "Bonbast USD/IRR",
  sourceUrl: "https://www.bonbast.com/graph/usd",
  polymarketUrl: "https://polymarket.com/event/will-usd-hit-iranian-rials-by-may-31",
  alertRoleId: "role",
  roleMessageId: "message",
  roleChannelId: "role-channel",
  settingsJson: null,
  roleEmoji: "💱",
  pollIntervalMinutes: 5,
  status: "active",
  lastValue: "612500",
  lastCheckedAt: "2026-05-06T01:02:03.000Z",
  lastChangedAt: "2026-05-06T01:02:03.000Z",
  snapshotValue: null,
  snapshotCheckedAt: null,
  snapshotDate: null,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T01:03:04.000Z"
};

describe("adapter commands", () => {
  it("registers bot summarize as a global bot command", () => {
    expect(buildBotCommands()[0].toJSON()).toMatchObject({
      name: "bot",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "summarize" }),
        expect.objectContaining({ name: "clearroles" })
      ])
    });
  });

  it("registers last and polymarket as adapter subcommands", () => {
    const aaaCommand = buildAdapterCommands().find((command) => command.name === "aaa");
    const allInCommand = buildAdapterCommands().find((command) => command.name === "allin");
    const basedRevenueCommand = buildAdapterCommands().find((command) => command.name === "basedrevenue");
    const bonbastCommand = buildAdapterCommands().find((command) => command.name === "bonbast");
    const beaCommand = buildAdapterCommands().find((command) => command.name === "bea");
    const blsCpiCommand = buildAdapterCommands().find((command) => command.name === "blscpi");

    expect(aaaCommand?.toJSON()).toMatchObject({
      name: "aaa",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    expect(allInCommand?.toJSON()).toMatchObject({
      name: "allin",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const arenaAiCommand = buildAdapterCommands().find((command) => command.name === "arenaai");
    expect(arenaAiCommand?.toJSON()).toMatchObject({
      name: "arenaai",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    expect(basedRevenueCommand?.toJSON()).toMatchObject({
      name: "basedrevenue",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const awsCommand = buildAdapterCommands().find((command) => command.name === "aws");
    expect(awsCommand?.toJSON()).toMatchObject({
      name: "aws",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    expect(beaCommand?.toJSON()).toMatchObject({
      name: "bea",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    expect(blsCpiCommand?.toJSON()).toMatchObject({
      name: "blscpi",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    expect(bonbastCommand?.toJSON()).toMatchObject({
      name: "bonbast",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "last" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "clear" }),
        expect.objectContaining({ name: "enddate" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const cloudflareCommand = buildAdapterCommands().find((command) => command.name === "cloudflare");
    expect(cloudflareCommand?.toJSON()).toMatchObject({
      name: "cloudflare",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const fertilityCommand = buildAdapterCommands().find((command) => command.name === "fertility");
    expect(fertilityCommand?.toJSON()).toMatchObject({
      name: "fertility",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const measlesCommand = buildAdapterCommands().find((command) => command.name === "measles");
    expect(measlesCommand?.toJSON()).toMatchObject({
      name: "measles",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const discordCommand = buildAdapterCommands().find((command) => command.name === "discord");
    expect(discordCommand?.toJSON()).toMatchObject({
      name: "discord",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const eiaCommand = buildAdapterCommands().find((command) => command.name === "eia");
    expect(eiaCommand?.toJSON()).toMatchObject({
      name: "eia",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const fdicCommand = buildAdapterCommands().find((command) => command.name === "fdic");
    expect(fdicCommand?.toJSON()).toMatchObject({
      name: "fdic",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const eggsCommand = buildAdapterCommands().find((command) => command.name === "eggs");
    expect(eggsCommand?.toJSON()).toMatchObject({
      name: "eggs",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const beefCommand = buildAdapterCommands().find((command) => command.name === "beef");
    expect(beefCommand?.toJSON()).toMatchObject({
      name: "beef",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const freeAppStoreCommand = buildAdapterCommands().find((command) => command.name === "freeappstore");
    expect(freeAppStoreCommand?.toJSON()).toMatchObject({
      name: "freeappstore",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "snapshot" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const fullLidCommand = buildAdapterCommands().find((command) => command.name === "fulllid");
    expect(fullLidCommand?.toJSON()).toMatchObject({
      name: "fulllid",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const paidAppStoreCommand = buildAdapterCommands().find((command) => command.name === "paidappstore");
    expect(paidAppStoreCommand?.toJSON()).toMatchObject({
      name: "paidappstore",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "snapshot" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const kmaCommand = buildAdapterCommands().find((command) => command.name === "koreaprecip");
    expect(kmaCommand?.toJSON()).toMatchObject({
      name: "koreaprecip",
      options: expect.arrayContaining([expect.objectContaining({ name: "period" })])
    });

    const mrBeastCommand = buildAdapterCommands().find((command) => command.name === "mrbeastviews");
    expect(mrBeastCommand?.toJSON()).toMatchObject({
      name: "mrbeastviews",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const mrBeastSubsCommand = buildAdapterCommands().find((command) => command.name === "mrbeastsubs");
    expect(mrBeastSubsCommand?.toJSON()).toMatchObject({
      name: "mrbeastsubs",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const hkPrecipCommand = buildAdapterCommands().find((command) => command.name === "hkprecip");
    expect(hkPrecipCommand?.toJSON()).toMatchObject({
      name: "hkprecip",
      options: expect.arrayContaining([expect.objectContaining({ name: "period" })])
    });

    const kaitoMindshareCommand = buildAdapterCommands().find((command) => command.name === "kaitomindshare");
    expect(kaitoMindshareCommand?.toJSON()).toMatchObject({
      name: "kaitomindshare",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const noaaNycCommand = buildAdapterCommands().find((command) => command.name === "nycprecip");
    expect(noaaNycCommand?.toJSON()).toMatchObject({
      name: "nycprecip",
      options: expect.arrayContaining([expect.objectContaining({ name: "period" })])
    });

    const nbsCommand = buildAdapterCommands().find((command) => command.name === "nbs");
    expect(nbsCommand?.toJSON()).toMatchObject({
      name: "nbs",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const noaaSeattleCommand = buildAdapterCommands().find((command) => command.name === "seattleprecip");
    expect(noaaSeattleCommand?.toJSON()).toMatchObject({
      name: "seattleprecip",
      options: expect.arrayContaining([expect.objectContaining({ name: "period" })])
    });

    const nytFrontCommand = buildAdapterCommands().find((command) => command.name === "nytfront");
    expect(nytFrontCommand?.toJSON()).toMatchObject({
      name: "nytfront",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "strikes" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const ornnB200Command = buildAdapterCommands().find((command) => command.name === "ornnb200");
    expect(ornnB200Command?.toJSON()).toMatchObject({
      name: "ornnb200",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const ornnH200Command = buildAdapterCommands().find((command) => command.name === "ornnh200");
    expect(ornnH200Command?.toJSON()).toMatchObject({
      name: "ornnh200",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const umaAlertCommand = buildAdapterCommands().find((command) => command.name === "umaclarifications");
    expect(umaAlertCommand?.toJSON()).toMatchObject({
      name: "umaclarifications",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const umaDisputeCommand = buildAdapterCommands().find((command) => command.name === "umadispute");
    expect(umaDisputeCommand?.toJSON()).toMatchObject({
      name: "umadispute",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const ngPriceCommand = buildAdapterCommands().find((command) => command.name === "ngprice");
    expect(ngPriceCommand?.toJSON()).toMatchObject({
      name: "ngprice",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const wtiCommand = buildAdapterCommands().find((command) => command.name === "wti");
    expect(wtiCommand?.toJSON()).toMatchObject({
      name: "wti",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const xagusdCommand = buildAdapterCommands().find((command) => command.name === "xagusd");
    expect(xagusdCommand?.toJSON()).toMatchObject({
      name: "xagusd",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const xauusdCommand = buildAdapterCommands().find((command) => command.name === "xauusd");
    expect(xauusdCommand?.toJSON()).toMatchObject({
      name: "xauusd",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const spotifyUsaCommand = buildAdapterCommands().find((command) => command.name === "spotifyusa");
    expect(spotifyUsaCommand?.toJSON()).toMatchObject({
      name: "spotifyusa",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const spotifyGlobalCommand = buildAdapterCommands().find((command) => command.name === "spotifyglobal");
    expect(spotifyGlobalCommand?.toJSON()).toMatchObject({
      name: "spotifyglobal",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const strategyBtcCommand = buildAdapterCommands().find((command) => command.name === "strategybtc");
    expect(strategyBtcCommand?.toJSON()).toMatchObject({
      name: "strategybtc",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const teslaCommand = buildAdapterCommands().find((command) => command.name === "tesla");
    expect(teslaCommand?.toJSON()).toMatchObject({
      name: "tesla",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const trumpTruthCommand = buildAdapterCommands().find((command) => command.name === "trumptruth");
    expect(trumpTruthCommand?.toJSON()).toMatchObject({
      name: "trumptruth",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "search" }),
        expect.objectContaining({ name: "strikes" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });

    const tsaCommand = buildAdapterCommands().find((command) => command.name === "tsa");
    expect(tsaCommand?.toJSON()).toMatchObject({
      name: "tsa",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });
    expect(tsaCommand?.toJSON().options).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "analysis" })]));

    const earthquakeCommand = buildAdapterCommands().find((command) => command.name === "earthquake");
    expect(earthquakeCommand?.toJSON()).toMatchObject({
      name: "earthquake",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "check" }),
        expect.objectContaining({ name: "test" }),
        expect.objectContaining({ name: "polymarket" })
      ])
    });
  });

  it("formats the last stored value with retrieval time", () => {
    const embed = buildLastEmbed(checkedIntegration).toJSON();

    expect(embed.title).toBe("Bonbast USD/IRR - Last stored value");
    expect(embed.description).toBeUndefined();
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Value", value: "612500" }),
        expect.objectContaining({ name: "Retrieved at", value: "06/05/2026, 09:02:03 SGT" }),
        expect.objectContaining({
          name: "Links",
          value:
            "Resolution: https://www.bonbast.com/graph/usd\nPolymarket: https://polymarket.com/event/will-usd-hit-iranian-rials-by-may-31"
        })
      ])
    );
  });

  it("formats missing last values without fetching", () => {
    const embed = buildLastEmbed({ ...checkedIntegration, lastValue: null, lastCheckedAt: null }).toJSON();

    expect(embed.description).toBeUndefined();
    expect(embed.fields).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Value", value: "not checked yet" })]));
  });

  it("formats manually set market end dates", () => {
    const embed = buildMarketEndManualUpdatedEmbed(checkedIntegration, new Date("2026-05-11T03:59:00.000Z")).toJSON();

    expect(embed.title).toBe("Bonbast USD/IRR - Market end manually set");
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Market ends ET", value: "May 10, 2026, 23:59" }),
        expect.objectContaining({ name: "Market ends SGT", value: "11/05/2026, 11:59:00 SGT" })
      ])
    );
  });

  it("formats check results with current and last stored timestamps", () => {
    const embed = buildCheckEmbed({
      integration: { ...checkedIntegration, lastValue: "181300", lastCheckedAt: "2026-05-06T02:43:30.000Z" },
      previousValue: "181200",
      previousCheckedAt: "2026-05-06T02:40:00.000Z",
      currentValue: "181300",
      changed: true
    }).toJSON();

    expect(embed.description).toBeUndefined();
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Current", value: "181300" }),
        expect.objectContaining({ name: "Current retrieved at", value: "06/05/2026, 10:43:30 SGT" }),
        expect.objectContaining({ name: "Last stored", value: "181200" }),
        expect.objectContaining({ name: "Last retrieved at", value: "06/05/2026, 10:40:00 SGT" })
      ])
    );
  });

  it("builds simulated alerts with role mentions", () => {
    const result = buildSimulatedAlertResult({ ...checkedIntegration, lastValue: "181300" });
    const payload = buildAlertMessagePayload(result);

    expect(result.previousValue).toBe("181300");
    expect(result.currentValue).toBe("181301");
    expect(payload.content).toBe("<@&role>");
    expect(payload.allowedMentions).toEqual({ roles: ["role"] });
  });

  it("builds a grouped alert role selector embed", () => {
    const embed = buildGroupedRoleSelectorEmbed(
      [
        {
          displayName: "Bonbast USD/IRR",
          commandName: "bonbast",
          roleId: "role-1",
          roleName: "Bonbast Alerts",
          emoji: "💱"
        },
        {
          displayName: "Strategy Bitcoin Purchases",
          commandName: "strategybtc",
          roleId: "role-2",
          roleName: "Strategy BTC Alerts",
          emoji: "🪙"
        }
      ],
      0,
      1
    ).toJSON();

    expect(embed.title).toBe("Market Alert Roles");
    expect(embed.description).toBe("React to receive alerts. Remove your reaction to opt out.");
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "💱 Bonbast USD/IRR", value: "Role: <@&role-1>\nCommand: `/bonbast`" }),
        expect.objectContaining({
          name: "🪙 Strategy Bitcoin Purchases",
          value: "Role: <@&role-2>\nCommand: `/strategybtc`"
        })
      ])
    );
  });

  it("builds event alerts with a prominent strike and Truth Social link button", () => {
    const post: EventMonitorPost = {
      id: "123",
      type: "Truth",
      text: "Hello King",
      qualifyingText: "Hello King",
      postedAt: new Date("2026-05-06T00:00:00.000Z"),
      url: "https://truthsocial.com/@realDonaldTrump/123",
      imageUrls: [],
      imageText: "",
      matchedTerms: ["King"],
      strikeTerms: ["King"]
    };
    const payload = buildEventPostMessagePayload({ ...checkedIntegration, adapterId: "trump-truth" }, post);
    const embed = payload.embeds[0].toJSON();

    expect(payload.content).toBe("<@&role>\n**TEXT STRIKE DETECTED: King**");
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "STRIKE HIT", value: expect.stringContaining("King") }),
        expect.objectContaining({ name: "Truth Social", value: post.url })
      ])
    );
    expect(payload.components[0].toJSON()).toMatchObject({
      components: [expect.objectContaining({ label: "Open Truth", style: 5, url: post.url })]
    });
  });

  it("formats strike search results with timeframe and source search link", () => {
    const embed = buildStrikeSearchEmbed(
      { ...checkedIntegration, adapterId: "trump-truth" },
      {
        term: "King",
        searchUrl:
          "https://www.trumpstruth.org/search?query=King&start_date=2026-05-04&end_date=2026-05-10&removed=include&per_page=100",
        startAt: "2026-05-04T04:00:00.000Z",
        endAt: "2026-05-11T03:59:00.000Z",
        totalResults: 1,
        hits: [
          {
            url: "https://www.trumpstruth.org/statuses/1",
            postedAt: "May 6, 2026, 1:00 PM",
            snippet: "Hello King."
          }
        ]
      }
    ).toJSON();

    expect(embed.title).toBe("Bonbast USD/IRR - Strike search");
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Term", value: "King" }),
        expect.objectContaining({ name: "Matches", value: "1" }),
        expect.objectContaining({ name: "Timeframe", value: "May 04, 2026, 00:00 ET to May 10, 2026, 23:59 ET" }),
        expect.objectContaining({
          name: "Results",
          value: "1. [May 6, 2026, 1:00 PM](https://www.trumpstruth.org/statuses/1) - Hello King."
        }),
        expect.objectContaining({
          name: "Search",
          value:
            "https://www.trumpstruth.org/search?query=King&start_date=2026-05-04&end_date=2026-05-10&removed=include&per_page=100"
        })
      ])
    );
  });

  it("does not mention alert roles for non-strike Trump Truth event alerts", () => {
    const post: EventMonitorPost = {
      id: "123",
      type: "Truth",
      text: "Hello world",
      qualifyingText: "Hello world",
      postedAt: new Date("2026-05-06T00:00:00.000Z"),
      url: "https://truthsocial.com/@realDonaldTrump/123",
      imageUrls: [],
      imageText: "",
      matchedTerms: [],
      strikeTerms: ["King"]
    };
    const payload = buildEventPostMessagePayload({ ...checkedIntegration, adapterId: "trump-truth" }, post);

    expect(payload.content).toBeUndefined();
    expect(payload.allowedMentions).toEqual({ parse: [] });
  });

  it("mentions alert roles for generic event alerts that request a ping", () => {
    const post: EventMonitorPost = {
      id: "0xtx:0x1",
      type: "Polymarket clarification",
      alertTitle: "Polymarket clarification",
      sourceLabel: "On-chain tx",
      buttonLabel: "Open transaction",
      mentionAlertRole: true,
      text: "Clarification issued.",
      qualifyingText: "Clarification issued.",
      postedAt: new Date("2026-05-20T00:00:00.000Z"),
      url: "https://polygonscan.com/tx/0xtx",
      polymarketUrl: "https://polymarket.com/event/test",
      fields: [{ name: "Question", value: "Test market", inline: false }],
      imageUrls: [],
      imageText: "",
      matchedTerms: [],
      strikeTerms: []
    };
    const payload = buildEventPostMessagePayload({ ...checkedIntegration, adapterId: "polymarket-clarifications" }, post);
    const embed = payload.embeds[0].toJSON();

    expect(payload.content).toBe("<@&role>\n**Polymarket clarification**");
    expect(payload.allowedMentions).toEqual({ roles: ["role"] });
    expect(payload.components[0].toJSON()).toMatchObject({
      components: [expect.objectContaining({ label: "Open transaction", style: 5, url: post.url })]
    });
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "On-chain tx", value: post.url }),
        expect.objectContaining({ name: "Question", value: "Test market" })
      ])
    );
  });

  it("uses the post-specific Polymarket URL in Trump Truth event alerts", () => {
    const post: EventMonitorPost = {
      id: "123",
      type: "Truth",
      text: "Hello Trust",
      qualifyingText: "Hello Trust",
      postedAt: new Date("2026-05-11T12:00:00.000Z"),
      url: "https://truthsocial.com/@realDonaldTrump/123",
      polymarketUrl: "https://polymarket.com/event/what-will-trump-post-this-week-may-11-may-17",
      imageUrls: [],
      imageText: "",
      matchedTerms: ["Trust"],
      strikeTerms: ["Trust"]
    };
    const payload = buildEventPostMessagePayload({ ...checkedIntegration, adapterId: "trump-truth" }, post);
    const embed = payload.embeds[0].toJSON();

    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Links",
          value: expect.stringContaining("https://polymarket.com/event/what-will-trump-post-this-week-may-11-may-17")
        })
      ])
    );
  });

  it("formats status with timestamp fields", () => {
    const embed = buildStatusEmbed(
      { ...checkedIntegration, settingsJson: JSON.stringify({ year: 2026, month: 5 }) },
      { effectiveIntervalMinutes: 1, reason: "EIA release watch: Tuesday/Wednesday ET" }
    ).toJSON();

    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Base interval", value: "5 minute(s)" }),
        expect.objectContaining({ name: "Current interval", value: "1 minute(s)" }),
        expect.objectContaining({ name: "Polling mode", value: "EIA release watch: Tuesday/Wednesday ET" }),
        expect.objectContaining({ name: "Period", value: "2026-05" }),
        expect.objectContaining({ name: "Last checked", value: "06/05/2026, 09:02:03 SGT" }),
        expect.objectContaining({ name: "Last changed", value: "06/05/2026, 09:02:03 SGT" })
      ])
    );
    expect(embed.footer?.text).toContain("Returned at");
  });

  it("formats integration summary rows across multiple embeds", () => {
    const embeds = buildIntegrationSummaryEmbeds(
      Array.from({ length: 11 }, (_, index) => ({
        commandName: `test${index}`,
        displayName: `Test ${index}`,
        status: "active",
        sourceUrl: "https://example.com/source",
        polymarketUrl: "https://polymarket.com/event/example-may-10",
        marketEnd: "May 10, 2026, 23:59 ET / 11/05/2026, 11:59 SGT",
        marketExpired: index === 0,
        baseIntervalMinutes: 5,
        currentIntervalMinutes: 1
      }))
    ).map((embed) => embed.toJSON());

    expect(embeds).toHaveLength(3);
    expect(embeds[0].fields).toHaveLength(5);
    expect(embeds[0].fields?.[0]).toMatchObject({
      name: "/test0 · Test 0 · active",
      value: expect.stringContaining("Interval: 1 min current / 5 min base")
    });
    expect(embeds[0].fields?.[0].value).toContain("End: ⚠️ EXPIRED - May 10, 2026, 23:59 ET");
  });

  it("formats missing Polymarket URLs", () => {
    expect(formatPolymarketLine({ ...checkedIntegration, polymarketUrl: null })).toBe("Polymarket: not set");
  });

  it("normalizes valid Polymarket URLs", () => {
    expect(normalizePolymarketUrl(" https://polymarket.com/event/test ")).toBe(
      "https://polymarket.com/event/test"
    );
  });

  it("rejects non-Polymarket URLs", () => {
    expect(normalizePolymarketUrl("https://example.com/event/test")).toBeNull();
  });
});
