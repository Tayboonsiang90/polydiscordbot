import { describe, expect, it, vi } from "vitest";
import {
  buildAdapterCommands,
  buildBotCommands,
  formatPolymarketLine,
  handleAdapterCommand,
  listSlashCommandAdapters,
  normalizePolymarketUrl
} from "../src/commands.js";
import { listAdapters } from "../src/integrations/registry.js";
import {
  buildCheckEmbed,
  buildClearErrorsEmbed,
  buildErrorEmbed,
  buildEventPostDetailsEmbed,
  buildEventPostMessagePayload,
  buildGroupedRoleSelectorEmbed,
  buildIntegrationSummaryEmbeds,
  buildLastEmbed,
  buildMarketEndManualUpdatedEmbed,
  buildMarketRolloverEmbed,
  buildStrikeSearchEmbed,
  buildStatusEmbed,
  buildUpdateLogsEmbed,
  parseAddressLabelButtonCustomId,
  parseEventDetailsCustomId,
  parseEventRefreshCustomId
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
  it("defers check commands before integration lookup work", async () => {
    const interaction = {
      guild: { id: "guild" },
      channel: { id: "channel" },
      commandName: "bonbast",
      options: { getSubcommand: () => "check" },
      deferReply: vi.fn()
    };
    const database = {
      getIntegrationByChannel: vi.fn(() => {
        throw new Error("simulated slow database failure");
      })
    };

    await expect(handleAdapterCommand(interaction as never, database as never)).rejects.toThrow("simulated slow database failure");
    expect(interaction.deferReply).toHaveBeenCalledOnce();
    expect(database.getIntegrationByChannel).toHaveBeenCalledOnce();
  });

  it("registers bot summarize as a global bot command", () => {
    expect(buildBotCommands()[0].toJSON()).toMatchObject({
      name: "bot",
      options: expect.arrayContaining([
        expect.objectContaining({ name: "summarize" }),
        expect.objectContaining({ name: "clearerrors" }),
        expect.objectContaining({ name: "clearroles" })
      ])
    });
  });

  it("registers shared and adapter-specific subcommands from adapter capabilities", () => {
    type CommandJson = { name: string; description?: string; options?: Array<{ name: string }> };
    const commandByName = new Map(
      buildAdapterCommands().map((command) => [command.name, command.toJSON() as CommandJson])
    );
    const sharedSubcommands = [
      "status",
      "check",
      "last",
      "updates",
      "clear",
      "polymarket",
      "interval",
      "enddate",
      "pause",
      "archive",
      "resume"
    ];

    for (const adapter of listSlashCommandAdapters()) {
      const command = commandByName.get(adapter.commandName);
      const options = command?.options ?? [];

      expect(command).toMatchObject({
        name: adapter.commandName,
        description: `Manage ${adapter.displayName}`
      });
      for (const subcommandName of sharedSubcommands) {
        expect(options).toEqual(expect.arrayContaining([expect.objectContaining({ name: subcommandName })]));
      }
      expect(options).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "test" })]));

      const optionalSubcommands: Array<[unknown, string]> = [
        [adapter.supportsPeriod, "period"],
        [adapter.dailySnapshot, "snapshot"],
        [adapter.supportsStrikes, "strikes"],
        [adapter.searchStrikeTerm, "search"],
        [adapter.searchTags, "tagsearch"],
        [adapter.updateTagFilters, "tags"],
        [adapter.updateResolvableWatchlist, "watchlist"],
        [adapter.updateTagBlocklist, "tagblocks"],
        [adapter.updateAddressLabels, "addresses"],
        [adapter.updateThreshold, "threshold"],
        [adapter.prepareArbitrageSetup, "setup"],
        [adapter.configureArbitrageWatch, "watch"],
        [adapter.getArbitrageWatch, "config"]
      ];
      for (const [enabled, subcommandName] of optionalSubcommands) {
        const matcher = expect.arrayContaining([expect.objectContaining({ name: subcommandName })]);
        if (enabled) {
          expect(options).toEqual(matcher);
        } else {
          expect(options).not.toEqual(matcher);
        }
      }
      expect(options).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "analysis" })]));
    }

    expect(commandByName.has("alignedsale")).toBe(false);
    expect(commandByName.get("iswmap")).toMatchObject({
      name: "iswmap",
      description: "Manage ISW Ukraine Map"
    });
    expect(commandByName.get("mentions")).toMatchObject({
      name: "mentions",
      description: "Manage Polymarket Mention Markets"
    });
  });

  it("keeps registered slash commands within Discord's guild command cap", () => {
    expect(buildAdapterCommands().length + buildBotCommands().length).toBeLessThanOrEqual(100);
  });

  it("registers UMA address bulk import and export options", () => {
    type CommandJson = { name: string; options?: Array<{ name: string; options?: Array<{ name: string; choices?: Array<{ value: string }> }> }> };
    const command = buildAdapterCommands().find((candidate) => candidate.name === "umaproposals")?.toJSON() as CommandJson | undefined;
    const addresses = command?.options?.find((option) => option.name === "addresses");
    const tags = command?.options?.find((option) => option.name === "tags");
    const tagblocks = command?.options?.find((option) => option.name === "tagblocks");
    const addressOptions = addresses?.options ?? [];
    const action = addressOptions.find((option) => option.name === "action");
    const tagAction = tags?.options?.find((option) => option.name === "action");
    const tagblockAction = tagblocks?.options?.find((option) => option.name === "action");

    expect(action?.choices?.map((choice) => choice.value)).toEqual(expect.arrayContaining(["add", "remove", "list", "clear", "import", "export"]));
    expect(tagAction?.choices?.map((choice) => choice.value)).toEqual(["add", "remove", "list", "clear"]);
    expect(tagblockAction?.choices?.map((choice) => choice.value)).toEqual(["add", "remove", "list", "clear"]);
    expect(addressOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "file" }),
        expect.objectContaining({ name: "dry-run" })
      ])
    );
  });

  it("keeps adapter command option counts within Discord limits", () => {
    type CommandJson = { name: string; options?: Array<{ name: string }> };
    for (const command of buildAdapterCommands()) {
      const json = command.toJSON() as CommandJson;
      expect(json.options?.length ?? 0).toBeLessThanOrEqual(25);
    }
  });

  it("registers the resolvable watchlist command options", () => {
    type CommandJson = { name: string; options?: Array<{ name: string; options?: Array<{ name: string; choices?: Array<{ value: string }> }> }> };
    const command = buildAdapterCommands().find((candidate) => candidate.name === "resolvable")?.toJSON() as CommandJson | undefined;
    const watchlist = command?.options?.find((option) => option.name === "watchlist");
    const action = watchlist?.options?.find((option) => option.name === "action");

    expect(action?.choices?.map((choice) => choice.value)).toEqual(["add", "remove", "list", "clear"]);
    expect(watchlist?.options).toEqual(expect.arrayContaining([expect.objectContaining({ name: "market" })]));
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

  it("formats update timing logs with SGT and ET patterns", () => {
    const embed = buildUpdateLogsEmbed(checkedIntegration, [
      {
        id: 1,
        integrationId: checkedIntegration.id,
        adapterId: checkedIntegration.adapterId,
        kind: "value_change",
        dedupeKey: null,
        title: "Value changed",
        summary: "181300",
        sourceAt: "2026-05-06T02:43:30.000Z",
        detectedAt: "2026-05-06T02:43:30.000Z",
        createdAt: "2026-05-06T02:43:30.000Z"
      },
      {
        id: 2,
        integrationId: checkedIntegration.id,
        adapterId: checkedIntegration.adapterId,
        kind: "event",
        dedupeKey: "post-1",
        title: "NYT front page",
        summary: "Matched: Border",
        sourceAt: "2026-05-05T04:20:00.000Z",
        detectedAt: "2026-05-06T03:43:30.000Z",
        createdAt: "2026-05-06T03:43:30.000Z"
      }
    ]).toJSON();

    expect(embed.title).toBe("Bonbast USD/IRR - Update timing log");
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Recent updates", value: expect.stringContaining("Value changed") }),
        expect.objectContaining({ name: "SGT hour pattern", value: expect.stringContaining("10:00 - 1") }),
        expect.objectContaining({ name: "ET hour pattern", value: expect.stringContaining("22:00 - 1") })
      ])
    );
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

  it("formats market rollover alerts separately from value changes", () => {
    const embed = buildMarketRolloverEmbed(checkedIntegration, {
      previousPolymarketUrl: "https://polymarket.com/event/old-market",
      currentPolymarketUrl: "https://polymarket.com/event/new-market"
    }).toJSON();

    expect(embed.title).toBe("Bonbast USD/IRR - Market rollover");
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Previous Polymarket", value: "https://polymarket.com/event/old-market" }),
        expect.objectContaining({ name: "Active Polymarket", value: "https://polymarket.com/event/new-market" }),
        expect.objectContaining({ name: "Source value", value: expect.stringContaining("new baseline") })
      ])
    );
  });

  it("formats check results with current and last stored timestamps", () => {
    const embed = buildCheckEmbed({
      integration: { ...checkedIntegration, lastValue: "181300", lastCheckedAt: "2026-05-06T02:43:30.000Z" },
      previousValue: "181200",
      previousCheckedAt: "2026-05-06T02:40:00.000Z",
      currentValue: "181300",
      changed: true,
      marketRollover: null
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

  it("formats check-failed cleanup summaries", () => {
    const embed = buildClearErrorsEmbed({
      scannedChannels: 12,
      deletedMessages: 40,
      keptMessages: 8,
      skippedChannels: 1,
      failedDeletes: 0,
      keepLatest: true
    }).toJSON();

    expect(embed.title).toBe("Check-failed message cleanup");
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Deleted old errors", value: "40" }),
        expect.objectContaining({ name: "Kept latest errors", value: "8" }),
        expect.objectContaining({ name: "Mode", value: "Kept the newest Check failed message per channel." })
      ])
    );
  });

  it("omits the Polymarket field from check-failed embeds when no market is configured", () => {
    const embed = buildErrorEmbed({ ...checkedIntegration, adapterId: "uma-voting-committee", polymarketUrl: null }, "GitHub API failed").toJSON();

    expect(embed.fields).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Error", value: "GitHub API failed" })]));
    expect(embed.fields).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "Polymarket" })]));
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

  it("shows when strike search results are truncated", () => {
    const embed = buildStrikeSearchEmbed(
      { ...checkedIntegration, adapterId: "trump-truth" },
      {
        term: "King",
        searchUrl: "https://www.trumpstruth.org/search?query=King",
        startAt: "2026-05-04T04:00:00.000Z",
        endAt: "2026-05-11T03:59:00.000Z",
        totalResults: 12,
        hits: Array.from({ length: 12 }, (_, index) => ({
          url: `https://www.trumpstruth.org/statuses/${index + 1}`,
          postedAt: `May ${index + 1}, 2026`,
          snippet: `King mention ${index + 1}`
        }))
      }
    ).toJSON();
    const results = embed.fields?.find((field) => field.name === "Results")?.value;

    expect(results).toContain("10. [May 10, 2026]");
    expect(results).toContain("...and 2 more result(s). Open the search link for the full list.");
  });

  it("mentions alert roles for non-strike generic event alerts by default", () => {
    const post: EventMonitorPost = {
      id: "123",
      type: "Article",
      alertTitle: "New article",
      text: "Hello world",
      qualifyingText: "Hello world",
      postedAt: new Date("2026-05-06T00:00:00.000Z"),
      url: "https://www.whitehouse.gov/briefings-statements/example",
      imageUrls: [],
      imageText: "",
      matchedTerms: [],
      strikeTerms: []
    };
    const payload = buildEventPostMessagePayload({ ...checkedIntegration, adapterId: "white-house-briefings" }, post);

    expect(payload.content).toBe("<@&role>\n**New article**");
    expect(payload.allowedMentions).toEqual({ roles: ["role"] });
  });

  it("does not mention alert roles for non-strike Trump Truth or Elon X alerts", () => {
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

    for (const adapterId of ["trump-truth", "elon-x-strikes"]) {
      const payload = buildEventPostMessagePayload({ ...checkedIntegration, adapterId }, post);
      expect(payload.content).toBeUndefined();
      expect(payload.allowedMentions).toEqual({ parse: [] });
    }
  });

  it("does not mention alert roles for event alerts that opt out", () => {
    const post: EventMonitorPost = {
      id: "123",
      type: "Truth",
      mentionAlertRole: false,
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

  it("keeps event technical details behind a Show more button", () => {
    const post: EventMonitorPost = {
      id: "0x3333333333333333333333333333333333333333333333333333333333333333:0x5",
      type: "Polymarket clarification",
      alertTitle: "Polymarket clarification",
      sourceLabel: "On-chain tx",
      buttonLabel: "Open transaction",
      mentionAlertRole: true,
      text: "Clarification issued.",
      qualifyingText: "Clarification issued.",
      postedAt: new Date("2026-05-20T00:00:00.000Z"),
      url: "https://polygonscan.com/tx/0xtx",
      polymarketUrl: "https://polymarket.com/market/test",
      hiddenFields: [{ name: "Condition ID", value: "0xcondition", inline: false }],
      imageUrls: [],
      imageText: "",
      matchedTerms: [],
      strikeTerms: []
    };
    const payload = buildEventPostMessagePayload({ ...checkedIntegration, adapterId: "polymarket-clarifications" }, post);
    const embed = payload.embeds[0].toJSON();
    const components = payload.components[0].toJSON().components;
    const detailsEmbed = buildEventPostDetailsEmbed({ ...checkedIntegration, adapterId: "polymarket-clarifications" }, post).toJSON();

    expect(embed.fields).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "Condition ID" })]));
    expect(components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Open transaction", style: 5, url: post.url }),
        expect.objectContaining({ label: "Show more", style: 2 })
      ])
    );
    const showMoreButton = components.find((component) => "custom_id" in component && component.label === "Show more") as
      | { custom_id?: string }
      | undefined;
    const customId = showMoreButton?.custom_id;
    expect(parseEventDetailsCustomId(String(customId))).toEqual({ integrationId: checkedIntegration.id, eventId: post.id });
    expect(detailsEmbed.fields).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Condition ID", value: "0xcondition" })]));
  });

  it("omits Polymarket not-set lines from event details when no market is configured", () => {
    const post: EventMonitorPost = {
      id: "uma-vote-review:22",
      type: "UMA voting committee review",
      alertTitle: "UMA voting review",
      sourceLabel: "GitHub review",
      buttonLabel: "Open review",
      mentionAlertRole: true,
      text: "Agree with this answer.",
      qualifyingText: "Agree with this answer.",
      postedAt: new Date("2026-06-20T06:00:00.000Z"),
      url: "https://github.com/UMA-rocks/voting-committees/pull/47#pullrequestreview-22",
      hiddenFields: [{ name: "Pull request", value: "#47 Answers for voting round 10312", inline: false }],
      imageUrls: [],
      imageText: "",
      matchedTerms: [],
      strikeTerms: []
    };
    const detailsEmbed = buildEventPostDetailsEmbed(
      { ...checkedIntegration, adapterId: "uma-voting-committee", polymarketUrl: null },
      post
    ).toJSON();
    const links = detailsEmbed.fields?.find((field) => field.name === "Links")?.value;

    expect(links).toBe("Original: https://github.com/UMA-rocks/voting-committees/pull/47#pullrequestreview-22");
    expect(links).not.toContain("Polymarket");
  });

  it("uses a Refresh data button for UMA proposal details", () => {
    const post: EventMonitorPost = {
      id: "0x3333333333333333333333333333333333333333333333333333333333333333:0x5",
      type: "Polymarket UMA proposal",
      alertTitle: "Polymarket UMA proposal",
      sourceLabel: "On-chain tx",
      buttonLabel: "Open transaction",
      mentionAlertRole: true,
      text: "Proposal opened.",
      qualifyingText: "Proposal opened.",
      postedAt: new Date("2026-05-20T00:00:00.000Z"),
      url: "https://polygonscan.com/tx/0xtx",
      polymarketUrl: "https://polymarket.com/market/test",
      prioritySummary: { question: "Test market?", proposedOutcome: "YES (1)", proposer: "0x1111111111111111111111111111111111111111" },
      hiddenFields: [{ name: "Condition ID", value: "0xcondition", inline: false }],
      imageUrls: [],
      imageText: "",
      matchedTerms: [],
      strikeTerms: []
    };
    const payload = buildEventPostMessagePayload({ ...checkedIntegration, adapterId: "polymarket-proposals" }, post);
    const components = payload.components[0].toJSON().components;

    expect(components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Open transaction", style: 5, url: post.url }),
        expect.objectContaining({ label: "Refresh data", style: 2 })
      ])
    );
    const refreshButton = components.find((component) => "custom_id" in component && component.label === "Refresh data") as
      | { custom_id?: string }
      | undefined;
    expect(parseEventRefreshCustomId(String(refreshButton?.custom_id))).toEqual({ integrationId: checkedIntegration.id, eventId: post.id });
  });

  it("adds address label buttons for UMA proposer and disputer fields", () => {
    const proposer = "0x1111111111111111111111111111111111111111";
    const disputer = "0x2222222222222222222222222222222222222222";
    const post: EventMonitorPost = {
      id: "0xtx:0x2",
      type: "Polymarket UMA dispute",
      alertTitle: "Polymarket UMA dispute",
      sourceLabel: "On-chain tx",
      buttonLabel: "Open transaction",
      mentionAlertRole: true,
      text: "Dispute opened.",
      qualifyingText: "Dispute opened.",
      postedAt: new Date("2026-05-20T00:00:00.000Z"),
      url: "https://polygonscan.com/tx/0xtx",
      prioritySummary: { proposer, disputer },
      imageUrls: [],
      imageText: "",
      matchedTerms: [],
      strikeTerms: []
    };
    const payload = buildEventPostMessagePayload({ ...checkedIntegration, adapterId: "polymarket-disputes" }, post);
    const components = payload.components[0].toJSON().components;

    expect(components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Refresh data", style: 2 }),
        expect.objectContaining({ label: "Label proposer", style: 2 }),
        expect.objectContaining({ label: "Label disputer", style: 2 })
      ])
    );
    const refreshButton = components.find((component) => "custom_id" in component && component.label === "Refresh data") as
      | { custom_id?: string }
      | undefined;
    expect(parseEventRefreshCustomId(String(refreshButton?.custom_id))).toEqual({ integrationId: checkedIntegration.id, eventId: post.id });
    const proposerCustomId = components.find((component) => "custom_id" in component && component.label === "Label proposer") as
      | { custom_id?: string }
      | undefined;
    expect(parseAddressLabelButtonCustomId(String(proposerCustomId?.custom_id))).toEqual({
      integrationId: checkedIntegration.id,
      role: "proposer",
      address: proposer
    });
  });

  it("attaches highlighted event images when provided", () => {
    const post: EventMonitorPost = {
      id: "nyt-front-page-2026-05-18",
      type: "Front page",
      text: "Federal Reserve",
      qualifyingText: "Federal Reserve",
      postedAt: new Date("2026-05-18T04:20:00.000Z"),
      url: "https://nytimes.pressreader.com/the-new-york-times/20260518/page/1",
      imageUrls: ["https://example.com/original.jpg"],
      imageAttachments: [
        {
          name: "nyt-front-page-2026-05-18-highlight.png",
          data: Buffer.from("png"),
          description: "highlighted"
        }
      ],
      imageText: "Federal Reserve",
      matchedTerms: ["Federal Reserve"],
      strikeTerms: ["Federal Reserve"]
    };
    const payload = buildEventPostMessagePayload({ ...checkedIntegration, adapterId: "nyt-front-page" }, post);

    expect(payload.files).toEqual([
      {
        attachment: Buffer.from("png"),
        name: "nyt-front-page-2026-05-18-highlight.png",
        description: "highlighted"
      }
    ]);
    expect(payload.embeds[1].toJSON().image?.url).toBe("attachment://nyt-front-page-2026-05-18-highlight.png");
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

  it("formats archived status metadata", () => {
    const embed = buildStatusEmbed({
      ...checkedIntegration,
      status: "paused",
      settingsJson: JSON.stringify({
        archivedAt: "2026-05-06T01:02:03.000Z",
        archiveReason: "market ended"
      })
    }).toJSON();

    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Status", value: "paused (archived)" }),
        expect.objectContaining({ name: "Archived at", value: "06/05/2026, 09:02:03 SGT" }),
        expect.objectContaining({ name: "Archive reason", value: "market ended" })
      ])
    );
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
