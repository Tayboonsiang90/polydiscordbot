import { describe, expect, it, vi } from "vitest";
import {
  buildAdapterCommands,
  buildBotCommands,
  buildMonitorCommands,
  formatPolymarketLine,
  handleAdapterCommand,
  isUmaAdapterId,
  listSlashCommandAdapters,
  normalizePolymarketUrl,
  selectArchivedIntegrations,
  selectCheckAllTargets
} from "../src/commands.js";
import {
  buildAlertEmbed,
  buildCheckAllChannelEmbed,
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
  buildTurboUpdatedEmbed,
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
      commandName: "monitor",
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
        expect.objectContaining({ name: "reinstate" }),
        expect.objectContaining({ name: "checkall" }),
        expect.objectContaining({ name: "clear" }),
        expect.objectContaining({ name: "clearerrors" }),
        expect.objectContaining({ name: "clearroles" }),
        expect.objectContaining({ name: "pruneroles" })
      ])
    });
  });

  it("selects only active non-UMA integrations for check-all", () => {
    const integrations: Integration[] = [
      { ...checkedIntegration, id: 1, adapterId: "bonbast-usd-irr", displayName: "Bonbast USD/IRR", status: "active" },
      { ...checkedIntegration, id: 2, adapterId: "polymarket-proposals", displayName: "UMA Proposal Alerts", status: "active" },
      { ...checkedIntegration, id: 3, adapterId: "aaa-regular-gas", displayName: "AAA Regular Gas", status: "paused" },
      { ...checkedIntegration, id: 4, adapterId: "does-not-exist", displayName: "Unknown Adapter", status: "active" },
      { ...checkedIntegration, id: 5, guildId: "other-guild", adapterId: "aaa-regular-gas", displayName: "Other Guild", status: "active" }
    ];

    expect(selectCheckAllTargets(integrations, "guild").map((integration) => integration.displayName)).toEqual(["Bonbast USD/IRR"]);
    expect(isUmaAdapterId("polymarket-proposals")).toBe(true);
    expect(isUmaAdapterId("bonbast-usd-irr")).toBe(false);
  });

  it("selects archived integrations from archive metadata", () => {
    const integrations: Integration[] = [
      { ...checkedIntegration, id: 1, displayName: "Active", settingsJson: null, status: "active" },
      {
        ...checkedIntegration,
        id: 2,
        displayName: "Archived",
        settingsJson: JSON.stringify({ archivedAt: "2026-05-06T01:02:03.000Z" }),
        status: "paused"
      },
      {
        ...checkedIntegration,
        id: 3,
        guildId: "other-guild",
        displayName: "Other Guild Archived",
        settingsJson: JSON.stringify({ archivedAt: "2026-05-06T01:02:03.000Z" }),
        status: "paused"
      }
    ];

    expect(selectArchivedIntegrations(integrations, "guild").map((integration) => integration.displayName)).toEqual(["Archived"]);
  });

  it("registers a generic monitor command plus UMA-specific command groups", () => {
    type CommandJson = { name: string; description?: string; options?: Array<{ name: string }> };
    const commandByName = new Map(
      buildAdapterCommands().map((command) => [command.name, command.toJSON() as CommandJson])
    );
    const monitorCommand = buildMonitorCommands()[0].toJSON() as CommandJson;
    const monitorOptions = monitorCommand.options ?? [];
    const sharedSubcommands = [
      "status",
      "check",
      "last",
      "updates",
      "polymarket",
      "interval",
      "turbo",
      "enddate",
      "pause",
      "archive",
      "resume"
    ];
    const channelCapabilitySubcommands = [
      "period",
      "snapshot",
      "strikes",
      "search",
      "tagsearch",
      "tags",
      "watchlist",
      "tagblocks",
      "addresses",
      "threshold",
      "setup",
      "watch",
      "config"
    ];

    expect(monitorCommand).toMatchObject({
      name: "monitor",
      description: "Manage the monitor in this channel"
    });
    for (const subcommandName of [...sharedSubcommands, ...channelCapabilitySubcommands]) {
      expect(monitorOptions).toEqual(expect.arrayContaining([expect.objectContaining({ name: subcommandName })]));
    }
    expect(monitorOptions).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "clear" })]));
    expect(monitorOptions).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "test" })]));
    expect(monitorOptions).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "analysis" })]));

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
      expect(options).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "clear" })]));
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
    expect(commandByName.has("iswmap")).toBe(false);
    expect(commandByName.has("mentions")).toBe(false);
  });

  it("keeps registered slash commands within Discord's guild command cap", () => {
    expect(buildMonitorCommands().length + buildAdapterCommands().length + buildBotCommands().length).toBeLessThanOrEqual(100);
  });

  it("registers UMA address bulk import and export options", () => {
    type CommandJson = { name: string; options?: Array<{ name: string; options?: Array<{ name: string; choices?: Array<{ value: string }> }> }> };
    const command = buildAdapterCommands().find((candidate) => candidate.name === "umaproposals")?.toJSON() as CommandJson | undefined;
    const addresses = command?.options?.find((option) => option.name === "addresses");
    const tags = command?.options?.find((option) => option.name === "tags");
    const tagblocks = command?.options?.find((option) => option.name === "tagblocks");
    const notify = command?.options?.find((option) => option.name === "notify");
    const addressOptions = addresses?.options ?? [];
    const action = addressOptions.find((option) => option.name === "action");
    const tagAction = tags?.options?.find((option) => option.name === "action");
    const tagblockAction = tagblocks?.options?.find((option) => option.name === "action");
    const tagblockOptions = tagblocks?.options ?? [];
    const notifyMode = notify?.options?.find((option) => option.name === "mode");

    expect(action?.choices?.map((choice) => choice.value)).toEqual(expect.arrayContaining(["add", "remove", "list", "clear", "import", "export"]));
    expect(tagAction?.choices?.map((choice) => choice.value)).toEqual(["add", "remove", "list", "clear"]);
    expect(tagblockAction?.choices?.map((choice) => choice.value)).toEqual(["add", "remove", "list", "clear"]);
    expect(notifyMode?.choices?.map((choice) => choice.value)).toEqual(["on", "off"]);
    expect(tagblockOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "blocked" }),
        expect.objectContaining({ name: "tag" })
      ])
    );
    expect(addressOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "file" }),
        expect.objectContaining({ name: "dry-run" })
      ])
    );
  });

  it("keeps adapter command option counts within Discord limits", () => {
    type CommandJson = { name: string; options?: Array<{ name: string }> };
    for (const command of [...buildMonitorCommands(), ...buildAdapterCommands()]) {
      const json = command.toJSON() as CommandJson;
      expect(json.options?.length ?? 0).toBeLessThanOrEqual(25);
    }
  });

  it("registers the resolvable watchlist command options", () => {
    type CommandJson = { name: string; options?: Array<{ name: string; options?: Array<{ name: string; choices?: Array<{ value: string }> }> }> };
    const command = buildMonitorCommands()[0].toJSON() as CommandJson;
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
            "🔗 [Resolution](https://www.bonbast.com/graph/usd) · [Polymarket](https://polymarket.com/event/will-usd-hit-iranian-rials-by-may-31)"
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

  it("summarizes source-level inventory changes in alert embeds", () => {
    const embed = buildAlertEmbed({
      integration: { ...checkedIntegration, adapterId: "ufo-files", displayName: "UFO Files" },
      previousValue: [
        "Metric: Official UFO/UAP file inventory",
        "Tracked files: 410",
        "Fingerprint: 909951cf296a476e",
        "Sources:",
        "AARO Official UAP Imagery: 7 tracked file link(s)"
      ].join("\n"),
      previousCheckedAt: "2026-07-12T16:30:00.000Z",
      currentValue: [
        "Metric: Official UFO/UAP file inventory",
        "Tracked files: 442",
        "Fingerprint: d57952d15d3cddd4",
        "Sources:",
        "AARO Official UAP Imagery: 39 tracked file link(s)"
      ].join("\n"),
      changed: true,
      marketRollover: null
    }).toJSON();

    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Detected change",
          value: expect.stringContaining("AARO Official UAP Imagery: 7 -> 39 (+32)")
        })
      ])
    );
  });

  it("shows concrete UFO file inventory changes in alert embeds", () => {
    const embed = buildAlertEmbed({
      integration: { ...checkedIntegration, adapterId: "ufo-files", displayName: "UFO Files" },
      previousValue: [
        "Metric: Official UFO/UAP file inventory",
        "Tracked files: 1",
        "Fingerprint: 1111111111111111",
        "Sources:",
        "AARO Official UAP Imagery: 1 tracked file link(s)",
        "Tracked file inventory:",
        "Tracked file: AARO Official UAP Imagery | https://www.aaro.mil/old.pdf | Old case"
      ].join("\n"),
      previousCheckedAt: "2026-07-12T16:30:00.000Z",
      currentValue: [
        "Metric: Official UFO/UAP file inventory",
        "Tracked files: 2",
        "Fingerprint: 2222222222222222",
        "Sources:",
        "AARO Official UAP Imagery: 2 tracked file link(s)",
        "Tracked file inventory:",
        "Tracked file: AARO Official UAP Imagery | https://www.aaro.mil/old.pdf | Old case",
        "Tracked file: AARO Official UAP Imagery | https://www.aaro.mil/new.pdf | New case"
      ].join("\n"),
      changed: true,
      marketRollover: null
    }).toJSON();

    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Quick read",
          value: expect.stringContaining("First added")
        }),
        expect.objectContaining({
          name: "Detected change",
          value: expect.stringContaining("https://www.aaro.mil/new.pdf")
        })
      ])
    );
  });

  it("shows Spotify top 5 leaders in alert quick reads", () => {
    const currentValue = [
      "Metric: Spotify Top 50 - USA daily top 10",
      "Chart date: 2026/07/14 (Kworb daily chart)",
      "Top 10:",
      "#1 +3 Malcolm Todd - Earrings — 1,751,197 streams, 177d, peak #1 (x1)",
      "#2 -1 Alex Warren - Ordinary — 1,466,912 streams, 147d, peak #1 (x5)",
      "#3 -1 Sabrina Carpenter - Manchild — 1,437,509 streams, 24d, peak #1 (x4)",
      "#4 -1 Morgan Wallen - What I Want — 1,236,397 streams, 46d, peak #1 (x1)",
      "#5 +1 Ravyn Lenae - Love Me Not — 1,070,609 streams, 114d, peak #5",
      "#6 -1 Lady Gaga - Die With A Smile — 1,031,384 streams, 318d, peak #1 (x15)",
      "Spotify playlist: https://open.spotify.com/playlist/37i9dQZEVXbLRQDuF5jeBp",
      "Kworb details: https://kworb.net/spotify/country/us_daily.html"
    ].join("\n");
    const previousValue = currentValue.replace("2026/07/14", "2026/07/13").replace("Malcolm Todd - Earrings", "Alex Warren - Ordinary");
    const embed = buildAlertEmbed({
      integration: { ...checkedIntegration, adapterId: "spotify-top-50-usa", displayName: "Spotify Top 50 USA" },
      previousValue,
      previousCheckedAt: "2026-07-15T16:30:00.000Z",
      currentValue,
      changed: true,
      marketRollover: null
    }).toJSON();

    const quickRead = embed.fields?.find((field) => field.name === "Quick read")?.value ?? "";
    expect(quickRead).toContain("**Top 5:**");
    expect(quickRead).toContain("Malcolm Todd - Earrings");
    expect(quickRead).toContain("Ravyn Lenae - Love Me Not");
    expect(quickRead).not.toContain("Lady Gaga - Die With A Smile");
    expect(embed.fields?.find((field) => field.name === "Links")?.value).toContain(
      "[Ranking data](https://kworb.net/spotify/country/us_daily.html)"
    );
  });

  it("shows NPM valuation changes before supporting details", () => {
    const embed = buildAlertEmbed({
      integration: {
        ...checkedIntegration,
        adapterId: "npm-perplexity-valuation",
        displayName: "NPM Perplexity Valuation"
      },
      previousValue: [
        "Metric: NPM private company valuation",
        "Company: Perplexity",
        "As of: Jul 29, 2026",
        "Valuation: $16.730B",
        "Price per share: $58.17",
        "Expected update: 1:00 PM ET on NPM business days"
      ].join("\n"),
      previousCheckedAt: "2026-07-29T17:00:00.000Z",
      currentValue: [
        "Metric: NPM private company valuation",
        "Company: Perplexity",
        "As of: Jul 30, 2026",
        "Valuation: $17.100B",
        "Price per share: $59.45",
        "Expected update: 1:00 PM ET on NPM business days"
      ].join("\n"),
      changed: true,
      marketRollover: null
    }).toJSON();

    const quickRead = embed.fields?.find((field) => field.name === "Quick read")?.value ?? "";
    expect(quickRead).toContain("**Valuation:** $16.730B → **$17.100B**");
    expect(quickRead).toContain("**Price per share:** $58.17 → **$59.45**");
    expect(quickRead).toContain("**As of:** Jul 29, 2026 → **Jul 30, 2026**");
  });

  it("shows Pyth strike action before the live ticker context", () => {
    const embed = buildAlertEmbed({
      integration: {
        ...checkedIntegration,
        adapterId: "pyth-wti-strikes",
        displayName: "Pyth WTI Strikes"
      },
      previousValue: null,
      previousCheckedAt: null,
      currentValue: [
        "Ticker: WTIN6",
        "Last Price: 99.2",
        "Last Price Time: 2026-07-30T14:10:00.000Z",
        "Crossed Strikes:",
        "$100.00 crossed up on WTIN6 at 100.1 (2026-07-30T14:10:00.000Z)",
        "Alerted Strikes:",
        "$100.00",
        "Tracked Strikes:",
        "↑ $100.00"
      ].join("\n"),
      changed: true,
      marketRollover: null
    }).toJSON();

    const quickRead = embed.fields?.find((field) => field.name === "Quick read")?.value ?? "";
    expect(quickRead).toContain("**Strike crossed:**");
    expect(quickRead).toContain("**$100.00** crossed up on WTIN6");
    expect(quickRead).toContain("**Last Price:** 99.2");
    expect(quickRead).toContain("One-shot alert");
  });

  it("labels Apple release matches as candidates with review links", () => {
    const embed = buildAlertEmbed({
      integration: {
        ...checkedIntegration,
        adapterId: "apple-kpop-song-releases",
        displayName: "KPop Song Releases"
      },
      previousValue: "Candidate songs found: none\nRelease IDs: none",
      previousCheckedAt: "2026-07-29T17:00:00.000Z",
      currentValue: [
        "Metric: Apple Music/iTunes 2026 song releases",
        "Tracked unresolved artists: NewJeans",
        "Candidate songs found: 1",
        "Latest candidate songs:",
        "- NewJeans — New Song — 2026-07-30 — https://music.apple.com/us/album/new-song/123",
        "Release IDs: 123"
      ].join("\n"),
      changed: true,
      marketRollover: null
    }).toJSON();

    const quickRead = embed.fields?.find((field) => field.name === "Quick read")?.value ?? "";
    expect(quickRead).toContain("**Candidate songs found:** 1");
    expect(quickRead).toContain("[Apple Music](https://music.apple.com/us/album/new-song/123)");
    expect(quickRead).toContain("Candidate only");
  });

  it.each([
    {
      adapterId: "tsa-passengers",
      previousValue: "Latest source day: 2026-07-28\nLatest daily throughput: 2,900,000",
      currentValue: [
        "Metric: TSA daily checkpoint throughput sum",
        "Latest source day: 2026-07-29",
        "Latest daily throughput: 3,100,000",
        "Market window: 2026-05-04 to 2026-05-10",
        "Market status: complete",
        "Window reported days: 7/7",
        "Window total: 16,780,961"
      ].join("\n"),
      expected: ["**Latest source day:** 2026-07-29", "**Latest daily throughput:** 3,100,000"]
    },
    {
      adapterId: "bonbast-usd-irr",
      previousValue: "Latest finalized: 1,930,000 IRR per USD",
      currentValue: [
        "Metric: Bonbast USD exchange rate",
        "Latest provisional date: 2026-07-30",
        "Latest provisional: 1,933,000 IRR per USD (193,300 toman)",
        "Latest finalized date: 2026-07-29",
        "Latest finalized: 1,936,000 IRR per USD (193,600 toman)",
        "Day change: -3,000 IRR (-0.15%)"
      ].join("\n"),
      expected: ["**Latest finalized:** 1,936,000 IRR per USD", "**Latest provisional:** 1,933,000 IRR per USD"]
    },
    {
      adapterId: "ornn-h100-index",
      previousValue: "Date: 2026-07-28\nIndex Value: 2.5\nFinalized by: 2026-07-29",
      currentValue: "Date: 2026-07-29\nIndex Value: 2.75\nFinalized by: 2026-07-30",
      expected: ["**Index value:** 2.5 → **2.75**", "**Daily change:** +0.2500 (10.00%)"]
    }
  ])("shows decision-useful $adapterId alert details first", ({ adapterId, previousValue, currentValue, expected }) => {
    const embed = buildAlertEmbed({
      integration: { ...checkedIntegration, adapterId },
      previousValue,
      previousCheckedAt: "2026-07-30T00:00:00.000Z",
      currentValue,
      changed: true,
      marketRollover: null
    }).toJSON();
    const quickRead = embed.fields?.find((field) => field.name === "Quick read")?.value ?? "";
    for (const text of expected) {
      expect(quickRead).toContain(text);
    }
  });

  it.each([
    {
      adapterId: "big-brother-episodes",
      currentValue: [
        "Metric: CBS Big Brother latest full episode",
        "Title: Episode 12",
        "Season: 28",
        "Episode: 12",
        "Air date: 2026-07-30",
        "URL: https://www.cbs.com/shows/video/episode-12/"
      ].join("\n"),
      expected: ["**Latest episode:**", "Episode 12", "**Season:** 28", "**Air date:** 2026-07-30"]
    },
    {
      adapterId: "all-in-podcast",
      currentValue: [
        "Title: Episode #283",
        "Date: 7/31/2026",
        "URL: https://www.youtube.com/watch?v=episode283",
        "Source: allin.com"
      ].join("\n"),
      expected: ["**Latest release:**", "Episode #283", "**Date:** 7/31/2026", "**Source:** allin.com"]
    },
    {
      adapterId: "mrbeast-views",
      currentValue: [
        "Metric: MrBeast YouTube channel total views",
        "Total views: 135.11B",
        "Change: +12.3M since last stored total",
        "Rate: +28.4M/day since last counter change",
        "Next target: 136B - 890M away",
        "Needed by deadline: 31.2M/day"
      ].join("\n"),
      expected: ["**Total views:** 135.11B", "**Next target:** 136B - 890M away"]
    },
    {
      adapterId: "airnow-philadelphia-aqi",
      currentValue: [
        "Metric: AirNow finalized Daily AQI for PM2.5",
        "Area: Philadelphia, Pennsylvania",
        "Market window: 2026-07-17 to 2026-07-21 ET",
        "Below 100 observed: YES - 2026-07-19 = 79",
        "Minimum PM2.5 AQI: 64 on 2026-07-20",
        "Latest finalized day: 2026-07-21 = 64",
        "Reported days: 5/5"
      ].join("\n"),
      expected: ["**Below 100 observed:** YES", "**Latest finalized day:** 2026-07-21 = 64", "**Minimum PM2.5 AQI:** 64"]
    },
    {
      adapterId: "trump-getty-photos",
      currentValue: [
        "Metric: Getty Images tagged editorial Donald Trump photos",
        "Window: 2026-07-27 to 2026-08-02",
        "Upload deadline: 2026-08-03 23:59 ET",
        "Covered days: 4/7",
        "Covered dates: 2026-07-27, 2026-07-28, 2026-07-29, 2026-07-30",
        "Missing dates: 2026-07-31, 2026-08-01, 2026-08-02",
        "Every day covered: no"
      ].join("\n"),
      expected: ["**Every day covered:** no", "**Covered days:** 4/7", "**Missing dates:** 2026-07-31"]
    }
  ])("gives $adapterId a human-first alert summary", ({ adapterId, currentValue, expected }) => {
    const embed = buildAlertEmbed({
      integration: { ...checkedIntegration, adapterId },
      previousValue: currentValue.replace("Episode 12", "Episode 11").replace("135.11B", "135.10B").replace("4/7", "3/7"),
      previousCheckedAt: "2026-07-30T00:00:00.000Z",
      currentValue,
      changed: true,
      marketRollover: null
    }).toJSON();
    const quickRead = embed.fields?.find((field) => field.name === "Quick read")?.value ?? "";
    for (const text of expected) {
      expect(quickRead).toContain(text);
    }
  });

  it.each([
    {
      adapterId: "paris-heat-wave",
      previousValue: "Status: watching\nLatest reported day: 2026-07-28 33°C",
      currentValue: [
        "Status: qualifying days found, streak not complete",
        "Latest reported day: 2026-07-30 36°C",
        "Qualifying days: 2026-07-29 35°C; 2026-07-30 36°C",
        "Longest qualifying streak: 2026-07-29 35°C; 2026-07-30 36°C",
        "Fetched through: 2026-07-30"
      ].join("\n"),
      expected: ["**Status:** qualifying days found", "**Longest qualifying streak:**", "**Fetched through:** 2026-07-30"]
    },
    {
      adapterId: "usgs-earthquakes",
      previousValue: "Total earthquakes: 10",
      currentValue: [
        "Window ET: 2026-07-27 00:00 to 2026-08-02 23:59",
        "Market start UTC: 2026-07-27T04:00:00.000Z",
        "Market end UTC: 2026-08-03T03:59:00.000Z",
        "Minimum magnitude: 5.5",
        "Total earthquakes: 11",
        "Events: long event list"
      ].join("\n"),
      expected: ["**Total earthquakes:** 11", "**Minimum magnitude:** 5.5", "**Market end UTC:**"]
    },
    {
      adapterId: "usgs-earthquakes-7-plus",
      previousValue: "By June 30 market: 9\nFull-year 2026 market: 8",
      currentValue: "By June 30 market: 10\nFull-year 2026 market: 9\nEvents: long event list",
      expected: ["**By June 30 market:** 10", "**Full-year 2026 market:** 9"]
    },
    {
      adapterId: "ncei-tornadoes",
      previousValue: "Value: not published yet",
      currentValue: [
        "Period: 2026-07",
        "Value: 117 tornadoes",
        "Data status: preliminary",
        "Final count: not available",
        "Preliminary count: 117 tornadoes",
        "Uncertainty range: 105 to 129"
      ].join("\n"),
      expected: ["**Value:** 117 tornadoes", "**Data status:** preliminary", "**Uncertainty range:** 105 to 129"]
    },
    {
      adapterId: "nasa-gistemp-temperature",
      previousValue: "Value: not published yet",
      currentValue: "Period: 2026-06\nValue: 1.18 °C anomaly\nSource cell: row 2026, column Jun",
      expected: ["**Value:** 1.18 °C anomaly", "**Period:** 2026-06", "**Source cell:** row 2026, column Jun"]
    },
    {
      adapterId: "spotify-bieber-monthly-listeners",
      previousValue: "Monthly listeners: 122,900,000",
      currentValue: [
        "Monthly listeners: 123,100,000 (123.1M)",
        "Next strike: 130M - 6,900,000 away",
        "Hit strikes: 120M",
        "Open strikes: 125M, 130M"
      ].join("\n"),
      expected: ["**Monthly listeners:** 123,100,000", "**Next strike:** 130M", "**Open strikes:** 125M, 130M"]
    },
    {
      adapterId: "spotify-top-artist-monthly",
      previousValue: "Leader: Justin Bieber 123.0M",
      currentValue: [
        "Market: 2026-07; check: Jul 31, 2026, 12:00 ET",
        "Leader: Bruno Mars 130.5M (Kworb #1)",
        "Tracked artists:",
        "1. Bruno Mars 130.5M (#1, +120K)",
        "2. Justin Bieber 123.1M (#2, +90K)",
        "3. The Weeknd 113.5M (#3, +50K)",
        "Missing: none"
      ].join("\n"),
      expected: ["**Leader:** Bruno Mars 130.5M", "**Top 5:**", "1. Bruno Mars 130.5M"]
    },
    {
      adapterId: "rotten-tomatoes-scores",
      previousValue: "Scores:\n- Spider-Man (2026): 89%, bucket 85, hit 85, next 90",
      currentValue: "Tracked active markets: 2\nScores:\n- Spider-Man (2026): 90%, bucket 90, hit 85/90, next 95\n- PAW Patrol (2026): pending, bucket pending, thresholds 70/75",
      expected: ["**Action:** A tracked movie moved", "**Changed score:**", "Spider-Man (2026): 90%"]
    },
    {
      adapterId: "box-office-weekends",
      previousValue: "Movies:\n- The Odyssey: $49.0M partial (2/3 days)",
      currentValue: "Tracked active markets: 2\nMovies:\n- The Odyssey: $61.2M complete (3/3 days), bracket 60-65m\n- PAW Patrol: pending (0/3 days)",
      expected: ["**Action:** A weekend total is complete", "**Completed/changed movie:**", "The Odyssey: $61.2M complete"]
    },
    {
      adapterId: "billboard-hot-100-number-one-song",
      previousValue: "Status: not published yet",
      currentValue: "Target chart: Week of August 8, 2026\nStatus: published\n#1 Song: New Song\nArtist: Artist Name\nPublished chart date: Week of August 8, 2026",
      expected: ["**Status:** published", "**#1 Song:** New Song", "**Artist:** Artist Name"]
    },
    {
      adapterId: "apple-artist-album-releases",
      previousValue: "New albums found: 1\nLatest albums:\n- Artist A — Old Album — 2026-01-01 — https://music.apple.com/old",
      currentValue: "New albums found: 2\nLatest albums:\n- Artist B — New Album — 2026-07-31 — https://music.apple.com/new\n- Artist A — Old Album — 2026-01-01 — https://music.apple.com/old\nTracked unresolved artists: Artist A, Artist B",
      expected: ["**New albums found:** 2", "**New candidate:**", "Artist B — New Album"]
    }
  ])("gives $adapterId an actionable domain summary", ({ adapterId, previousValue, currentValue, expected }) => {
    const embed = buildAlertEmbed({
      integration: { ...checkedIntegration, adapterId },
      previousValue,
      previousCheckedAt: "2026-07-30T00:00:00.000Z",
      currentValue,
      changed: true,
      marketRollover: null
    }).toJSON();
    const quickRead = embed.fields?.find((field) => field.name === "Quick read")?.value ?? "";
    for (const text of expected) {
      expect(quickRead).toContain(text);
    }
  });

  it("adds direct article links from release values to the Links field", () => {
    const embed = buildAlertEmbed({
      integration: { ...checkedIntegration, adapterId: "bea-current-releases", sourceUrl: "https://www.bea.gov/news/current-releases" },
      previousValue: null,
      previousCheckedAt: null,
      currentValue: [
        "Title: Gross Domestic Product, 2nd Quarter 2026",
        "Date: July 30, 2026",
        "URL: https://www.bea.gov/news/2026/gross-domestic-product-2nd-quarter-2026"
      ].join("\n"),
      changed: true,
      marketRollover: null
    }).toJSON();

    expect(embed.fields?.find((field) => field.name === "Quick read")?.value).toContain("Gross Domestic Product");
    expect(embed.fields?.find((field) => field.name === "Links")?.value).toContain(
      "[Latest release](https://www.bea.gov/news/2026/gross-domestic-product-2nd-quarter-2026)"
    );
  });

  it("keeps Powerball jackpot numbers in quick-read alerts", () => {
    const embed = buildAlertEmbed({
      integration: { ...checkedIntegration, adapterId: "powerball-jackpot", displayName: "Powerball Jackpot" },
      previousValue: [
        "Report date (ET): 2026-07-16",
        "Estimated jackpot: $172 Million",
        "Target: $1 Billion",
        "Target status: below target (17.2%, $828 Million to go)",
        "Cash value: $75.6 Million",
        "Next drawing: Sat, Jul 18, 2026",
        "Draw time UTC: 2026-07-19T02:59:00.000Z"
      ].join("\n"),
      previousCheckedAt: "2026-07-16T18:00:00.000Z",
      currentValue: [
        "Report date (ET): 2026-07-17",
        "Estimated jackpot: $172 Million",
        "Target: $1 Billion",
        "Target status: below target (17.2%, $828 Million to go)",
        "Cash value: $75.6 Million",
        "Next drawing: Sat, Jul 18, 2026",
        "Draw time UTC: 2026-07-19T02:59:00.000Z"
      ].join("\n"),
      changed: true,
      marketRollover: null
    }).toJSON();

    const quickRead = embed.fields?.find((field) => field.name === "Quick read")?.value ?? "";
    expect(quickRead).toContain("**Estimated jackpot:** $172 Million");
    expect(quickRead).toContain("**Target status:** below target (17.2%, $828 Million to go)");
    expect(quickRead).toContain("**Cash value:** $75.6 Million");
    expect(quickRead).toContain("**Next drawing:** Sat, Jul 18, 2026");
    expect(quickRead).toContain("**Report date (ET):** 2026-07-17");
  });

  it("shows Silver approval row revisions in quick-read alerts", () => {
    const previousValue = [
      "Metric: Silver Bulletin Trump approval rating",
      "Market: Trump approval rating on July 17?",
      "Target date: 2026-07-17",
      "Target status: finalized",
      "Approval: 40.1%",
      "Disapproval: 56.9%",
      "Tracked approval rows: Target 2026-07-17: 2026-07-17 = 40.1% approval, 56.9% disapproval"
    ].join("\n");
    const currentValue = previousValue
      .replace("Approval: 40.1%", "Approval: 40.2%")
      .replace("2026-07-17 = 40.1% approval", "2026-07-17 = 40.2% approval");
    const embed = buildAlertEmbed({
      integration: { ...checkedIntegration, adapterId: "silver-trump-approval", displayName: "Silver Trump Approval" },
      previousValue,
      previousCheckedAt: "2026-07-18T18:00:00.000Z",
      currentValue,
      changed: true,
      marketRollover: null
    }).toJSON();

    const quickRead = embed.fields?.find((field) => field.name === "Quick read")?.value ?? "";
    expect(quickRead).toContain("**Approval revisions:** Target 2026-07-17");
    expect(quickRead).toContain("40.1% approval");
    expect(quickRead).toContain("**2026-07-17 = 40.2% approval");
    expect(quickRead).toContain("**Approval:** 40.2%");
  });

  it("does not show Silver approval revisions for disapproval-only row changes", () => {
    const previousValue = [
      "Metric: Silver Bulletin Trump approval rating",
      "Market: Trump approval rating on July 24?",
      "Target date: 2026-07-24",
      "Target status: published; waiting for next data point to finalize",
      "Approval: 38.8%",
      "Disapproval: 58.1%",
      "Tracked approval rows: Target 2026-07-24: 2026-07-24 = 38.8% approval, 58.1% disapproval"
    ].join("\n");
    const currentValue = previousValue
      .replace("Disapproval: 58.1%", "Disapproval: 58.2%")
      .replace("58.1% disapproval", "58.2% disapproval");
    const embed = buildAlertEmbed({
      integration: { ...checkedIntegration, adapterId: "silver-trump-approval", displayName: "Silver Trump Approval" },
      previousValue,
      previousCheckedAt: "2026-07-24T16:00:00.000Z",
      currentValue,
      changed: true,
      marketRollover: null
    }).toJSON();

    const quickRead = embed.fields?.find((field) => field.name === "Quick read")?.value ?? "";
    expect(quickRead).not.toContain("Approval revisions");
  });

  it("puts Full Lid before-cutoff status first in alert embeds", () => {
    const currentValue = [
      "Date ET: 2026-07-13",
      "Cutoff: 6:30 PM ET",
      "Lid found: yes",
      "Alert Date: 2026-07-13",
      "First lid source: BNO",
      "First lid time: not listed",
      "First lid URL: https://bnonews.com/whpool/example",
      "Cutoff status: unknown",
      "Detail: In-Town Press Pool #12: Travel/Photo lid: Have a good night everyone!",
      "Resolution: https://rollcall.com/factbase/trump/calendar/",
      "Fallback: https://www.forth.news/whpool",
      "Alpha: https://bnonews.com/whpool"
    ].join("\n");
    const embed = buildAlertEmbed({
      integration: { ...checkedIntegration, adapterId: "white-house-full-lid", displayName: "White House Full Lid" },
      previousValue: "Date ET: 2026-07-13\nLid found: no\nAlert Date: none\nCutoff status: unknown",
      previousCheckedAt: "2026-07-13T22:00:00.000Z",
      currentValue,
      changed: true,
      marketRollover: null
    }).toJSON();

    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Quick read",
          value: expect.stringContaining("**Before 6:30 PM ET:** ⚠️ **UNKNOWN")
        })
      ])
    );
    const quickRead = embed.fields?.find((field) => field.name === "Quick read")?.value ?? "";
    expect(quickRead).toContain("**Source URL:** https://bnonews.com/whpool/example");
    expect(embed.fields?.find((field) => field.name === "Links")?.value).toContain(
      "[Source report](https://bnonews.com/whpool/example)"
    );
    expect(embed.fields?.some((field) => field.name === "Current snapshot")).toBe(false);
    expect(embed.fields?.some((field) => field.name === "Previous snapshot")).toBe(false);
  });

  it("formats value-change alerts as quick-read-only summaries", () => {
    const embed = buildAlertEmbed({
      integration: checkedIntegration,
      previousValue: "Current total: 214.0 mm\nResolution: https://example.com",
      previousCheckedAt: "2026-07-13T22:00:00.000Z",
      currentValue: "Current total: 227.2 mm\nResolution: https://example.com",
      changed: true,
      marketRollover: null
    }).toJSON();

    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Quick read", value: expect.stringContaining("**Current total:** 214.0 mm → **227.2 mm**") }),
        expect.objectContaining({ name: "Links", value: expect.stringContaining("[Resolution](https://www.bonbast.com/graph/usd)") })
      ])
    );
    expect(embed.fields?.some((field) => field.name === "Current snapshot")).toBe(false);
    expect(embed.fields?.some((field) => field.name === "Previous snapshot")).toBe(false);
  });

  it("puts precipitation totals before long daily row diffs", () => {
    const embed = buildAlertEmbed({
      integration: { ...checkedIntegration, adapterId: "noaa-seattle-precip", displayName: "NOAA Seattle Precipitation" },
      previousValue: [
        "Metric: NOAA monthly precipitation",
        "Location: Seattle Area",
        "Period: 2026-07",
        "Status: partial",
        "Reported days: 12/31",
        "Total precipitation: 0.00 inches",
        "Latest reported day: 2026-07-12",
        "Latest day value: 0.00 inches",
        "Daily values: 2026-07-01: 0.00 | 2026-07-02: 0.00"
      ].join("\n"),
      previousCheckedAt: "2026-07-13T22:00:00.000Z",
      currentValue: [
        "Metric: NOAA monthly precipitation",
        "Location: Seattle Area",
        "Period: 2026-07",
        "Status: partial",
        "Reported days: 13/31",
        "Total precipitation: 0.00 inches",
        "Latest reported day: 2026-07-13",
        "Latest day value: 0.00 inches",
        "Daily values: 2026-07-01: 0.00 | 2026-07-02: 0.00 | 2026-07-03: 0.00 | 2026-07-04: 0.00"
      ].join("\n"),
      changed: true,
      marketRollover: null
    }).toJSON();

    const quickRead = embed.fields?.find((field) => field.name === "Quick read")?.value ?? "";
    expect(quickRead).toContain("**Total precipitation:** 0.00 inches");
    expect(quickRead).toContain("**Latest day value:** 0.00 inches");
    expect(quickRead).toContain("**Latest reported day:** 2026-07-13");
    expect(quickRead).toContain("**Reported days:** 13/31");
    expect(quickRead).not.toContain("Daily values");
  });

  it("shows precipitation alpha totals in quick-read alerts", () => {
    const embed = buildAlertEmbed({
      integration: { ...checkedIntegration, adapterId: "hk-precip", displayName: "HKO Hong Kong Precipitation" },
      previousValue: "Current total: 215.0 mm (2026-05)\nData status: official daily extract",
      previousCheckedAt: "2026-07-13T22:00:00.000Z",
      currentValue: [
        "Current total: 227.2 mm (2026-05)",
        "Data status: alpha daily report added",
        "Official Daily Extract total: 215.0 mm",
        "Alpha pending daily reports: 2026-05-29: 12.2 mm",
        "Yesterday report rainfall: 12.2 mm (2026-05-29)",
        "Alpha source: https://www.hko.gov.hk/textonly/v2/pastwx/ryestxt.htm"
      ].join("\n"),
      changed: true,
      marketRollover: null
    }).toJSON();

    const quickRead = embed.fields?.find((field) => field.name === "Quick read")?.value ?? "";
    expect(quickRead).toContain("**Current total:** 227.2 mm (2026-05)");
    expect(quickRead).toContain("**Official Daily Extract total:** 215.0 mm");
    expect(quickRead).toContain("**Alpha pending daily reports:** 2026-05-29: 12.2 mm");
    expect(quickRead).not.toContain("Alpha source");
  });

  it("keeps Mt. Washington wind speed numbers in quick-read alerts", () => {
    const embed = buildAlertEmbed({
      integration: { ...checkedIntegration, adapterId: "mt-washington-wind", displayName: "Mt. Washington Wind Speed" },
      previousValue: [
        "Metric: Mt. Washington summit highest wind speed",
        "Period: 2026-07",
        "Highest wind speed: 72 mph",
        "Highest day: 2026-07-12",
        "Latest reported day: 2026-07-14",
        "Latest day wind speed: 48 mph on 2026-07-14 (avg 22.1 mph, 290 (W))",
        "Daily rows parsed: 14",
        "Daily wind rows: 2026-07-01=64mph avg 37.8 280(W) | 2026-07-12=72mph avg 32.1 300(NW) | 2026-07-14=48mph avg 22.1 290(W)",
        "F6 last modified: Wed, 15 Jul 2026 06:20:04 GMT"
      ].join("\n"),
      previousCheckedAt: "2026-07-15T22:00:00.000Z",
      currentValue: [
        "Metric: Mt. Washington summit highest wind speed",
        "Period: 2026-07",
        "Highest wind speed: 72 mph",
        "Highest day: 2026-07-12",
        "Latest reported day: 2026-07-15",
        "Latest day wind speed: 55 mph on 2026-07-15 (avg 24.8 mph, 300 (NW))",
        "Daily rows parsed: 15",
        "Daily wind rows: 2026-07-01=64mph avg 37.8 280(W) | 2026-07-12=72mph avg 34.1 310(NW) | 2026-07-14=48mph avg 22.1 290(W) | 2026-07-15=55mph avg 24.8 300(NW)",
        "F6 last modified: Thu, 16 Jul 2026 06:05:04 GMT"
      ].join("\n"),
      changed: true,
      marketRollover: null
    }).toJSON();

    const quickRead = embed.fields?.find((field) => field.name === "Quick read")?.value ?? "";
    expect(quickRead).toContain("**Highest wind speed:** 72 mph");
    expect(quickRead).toContain("**Latest day wind speed:** 55 mph on 2026-07-15");
    expect(quickRead).toContain("**Latest reported day:** 2026-07-15");
    expect(quickRead).toContain("**Revised daily rows:** 2026-07-12: 72mph avg 32.1 300(NW)");
    expect(quickRead).toContain("**72mph avg 34.1 310(NW)**");
    expect(quickRead).not.toContain("Daily rows parsed");
  });

  it("keeps NSIDC sea ice minimum in quick-read alerts", () => {
    const embed = buildAlertEmbed({
      integration: { ...checkedIntegration, adapterId: "nsidc-arctic-sea-ice", displayName: "NSIDC Arctic Sea Ice" },
      previousValue: [
        "Metric: NSIDC Arctic sea ice minimum extent",
        "Window: 2026-08-01 to 2026-10-01",
        "Current minimum: 4.300 million sq km on 2026-09-08",
        "Latest window day: 2026-09-08 — 4.300 million sq km",
        "Reported window days: 39/62",
        "Latest dataset date: 2026-09-08",
        "Latest dataset extent: 4.300 million sq km",
        "Data status: in progress"
      ].join("\n"),
      previousCheckedAt: "2026-09-09T12:00:00.000Z",
      currentValue: [
        "Metric: NSIDC Arctic sea ice minimum extent",
        "Window: 2026-08-01 to 2026-10-01",
        "Current minimum: 4.255 million sq km on 2026-09-10",
        "Latest window day: 2026-09-10 — 4.255 million sq km",
        "Reported window days: 41/62",
        "Latest dataset date: 2026-09-10",
        "Latest dataset extent: 4.255 million sq km",
        "Data status: in progress"
      ].join("\n"),
      changed: true,
      marketRollover: null
    }).toJSON();

    const quickRead = embed.fields?.find((field) => field.name === "Quick read")?.value ?? "";
    expect(quickRead).toContain("**Current minimum:** 4.255 million sq km on 2026-09-10");
    expect(quickRead).toContain("**Latest window day:** 2026-09-10");
    expect(quickRead).toContain("**Reported window days:** 41/62");
    expect(quickRead).not.toContain("Window:");
  });

  it("keeps a quick-read fallback when only low-priority links are present", () => {
    const embed = buildAlertEmbed({
      integration: checkedIntegration,
      previousValue: "Resolution: https://example.com/old\nPolymarket: https://polymarket.com/event/old",
      previousCheckedAt: "2026-07-13T22:00:00.000Z",
      currentValue: "Resolution: https://example.com/new\nPolymarket: https://polymarket.com/event/new",
      changed: true,
      marketRollover: null
    }).toJSON();

    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Quick read", value: "_No compact summary available._" }),
        expect.objectContaining({ name: "Links", value: expect.stringContaining("[Polymarket](https://polymarket.com/event/will-usd-hit-iranian-rials-by-may-31)") })
      ])
    );
    expect(embed.fields?.some((field) => field.name === "Current snapshot")).toBe(false);
    expect(embed.fields?.some((field) => field.name === "Previous snapshot")).toBe(false);
  });

  it("formats ISO timestamps in quick-read diffs as ET", () => {
    const embed = buildAlertEmbed({
      integration: checkedIntegration,
      previousValue: "Published: 2026-07-13T12:00:00.000Z",
      previousCheckedAt: "2026-07-13T22:00:00.000Z",
      currentValue: "Published: 2026-07-13T13:00:00.000Z",
      changed: true,
      marketRollover: null
    }).toJSON();

    const quickRead = embed.fields?.find((field) => field.name === "Quick read")?.value ?? "";
    expect(quickRead).toContain("ET");
    expect(quickRead).not.toContain("2026-07-13T13:00:00.000Z");
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

  it("formats multiple tracked Polymarket links from integration settings", () => {
    const embed = buildCheckEmbed({
      integration: {
        ...checkedIntegration,
        adapterId: "box-office-weekends",
        displayName: "Box Office Weekends",
        sourceUrl: "https://www.the-numbers.com/",
        polymarketUrl: "https://polymarket.com/event/toy-story-5-4th-weekend-box-office-20260708231025962",
        settingsJson: JSON.stringify({
          markets: [
            {
              url: "https://polymarket.com/event/toy-story-5-4th-weekend-box-office-20260708231025962",
              startAt: "2020-01-01T00:00:00.000Z",
              endAt: "2099-01-01T00:00:00.000Z"
            },
            {
              url: "https://polymarket.com/event/moana-2026-opening-weekend-box-office-20260706135043555",
              startAt: "2099-01-02T00:00:00.000Z",
              endAt: "2099-01-03T00:00:00.000Z"
            },
            {
              url: "https://polymarket.com/event/evil-dead-burn-opening-weekend-box-office-20260706163531731",
              startAt: "2000-01-01T00:00:00.000Z",
              endAt: "2000-01-02T00:00:00.000Z"
            }
          ]
        })
      },
      previousValue: "old",
      previousCheckedAt: "2026-07-12T00:00:00.000Z",
      currentValue: "new",
      changed: true,
      marketRollover: null
    }).toJSON();

    const links = embed.fields?.find((field) => field.name === "Links")?.value;
    expect(links).toContain("[Resolution](https://www.the-numbers.com/)");
    expect(links).toContain("Polymarkets:");
    expect(links).toContain("Active window:");
    expect(links).toContain("](https://polymarket.com/event/toy-story-5-4th-weekend-box-office-20260708231025962)");
    expect(links).toContain("Upcoming:");
    expect(links).toContain("](https://polymarket.com/event/moana-2026-opening-weekend-box-office-20260706135043555)");
    expect(links).toContain("Expired:");
    expect(links).toContain("](https://polymarket.com/event/evil-dead-burn-opening-weekend-box-office-20260706163531731)");
    expect(links).not.toContain("Polymarket: https://polymarket.com/event/toy-story-5-4th-weekend-box-office-20260708231025962");
  });

  it("formats check-all channel smoke-check results", () => {
    const embed = buildCheckAllChannelEmbed({
      integration: checkedIntegration,
      ok: true,
      currentValue: "181300",
      durationMs: 1234,
      completed: 2,
      total: 10
    }).toJSON();

    expect(embed.title).toBe("Bonbast USD/IRR - Smoke check passed");
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Fetched value", value: "181300" }),
        expect.objectContaining({ name: "Queue progress", value: "2/10" }),
        expect.objectContaining({ name: "Mode", value: expect.stringContaining("stored values were not updated") })
      ])
    );
  });

  it("builds a grouped alert role selector embed", () => {
    const embed = buildGroupedRoleSelectorEmbed(
      [
        {
          displayName: "Bonbast USD/IRR",
          commandName: "monitor",
          roleId: "role-1",
          roleName: "Bonbast Alerts",
          emoji: "💱"
        },
        {
          displayName: "Strategy Bitcoin Purchases",
          commandName: "monitor",
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
        expect.objectContaining({ name: "💱 Bonbast USD/IRR", value: "Role: <@&role-1>\nCommand: `/monitor`" }),
        expect.objectContaining({
          name: "🪙 Strategy Bitcoin Purchases",
          value: "Role: <@&role-2>\nCommand: `/monitor`"
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

  it("builds event alerts with a prominent strike, Truth Social link, and ignore button", () => {
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
    const components = payload.components[0].toJSON().components ?? [];
    expect(components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Open Truth", style: 5, url: post.url }),
        expect.objectContaining({ label: "Ignore strike", style: 4 })
      ])
    );
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

  it("shows non-strike Trump Truth or Elon X alerts without mentioning alert roles", () => {
    const post: EventMonitorPost = {
      id: "123",
      type: "Truth",
      alertTitle: "Trump Truth Social - New post",
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
      expect(payload.content).toBe("**Trump Truth Social - New post**");
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

    expect(links).toBe("🔗 [Original](https://github.com/UMA-rocks/voting-committees/pull/47#pullrequestreview-22)");
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

  it("formats active turbo polling status", () => {
    const embed = buildStatusEmbed(
      {
        ...checkedIntegration,
        settingsJson: JSON.stringify({
          turboPolling: {
            intervalSeconds: 10,
            startedAt: "2099-05-06T01:02:03.000Z",
            until: "2099-05-06T02:02:03.000Z"
          }
        })
      },
      { effectiveIntervalMs: 10_000, reason: "Turbo polling every 10 second(s)" }
    ).toJSON();

    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Current interval", value: "10 second(s)" }),
        expect.objectContaining({ name: "Turbo interval", value: "10 second(s)" }),
        expect.objectContaining({ name: "Turbo ends", value: "06/05/2099, 10:02:03 SGT" })
      ])
    );
  });

  it("formats turbo polling updates", () => {
    const embed = buildTurboUpdatedEmbed({
      ...checkedIntegration,
      settingsJson: JSON.stringify({
        turboPolling: {
          intervalSeconds: 5,
          startedAt: "2099-05-06T01:02:03.000Z",
          until: "2099-05-06T02:02:03.000Z"
        }
      })
    }).toJSON();

    expect(embed.title).toBe("Bonbast USD/IRR - Turbo polling updated");
    expect(embed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Turbo", value: "on" }),
        expect.objectContaining({ name: "Turbo interval", value: "5 second(s)" }),
        expect.objectContaining({ name: "Turbo ends", value: "06/05/2099, 10:02:03 SGT" })
      ])
    );
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
