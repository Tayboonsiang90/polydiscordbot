# Polymarket Resolution Monitor Bot

Local Discord bot for monitoring Polymarket resolution-source websites and posting alerts when tracked values change.

## Current Scope

- Discord slash commands only.
- One base channel per website integration, with adapter-owned extra channels only where explicitly documented.
- Local SQLite persistence.
- Polling and Discord alerts only.
- Integration channels are auto-created from registered adapters.
- Alert roles are auto-created from registered adapters.
- Current adapters include Bonbast USD/IRR, AAA Regular Gas, All-In Podcast, Aligned Layer Sale, Artist Song Releases, Arena AI No Style Control, AWS Disrupted Events, Based Revenue, BEA Current Releases, BLS CPI Releases, BLS Jobs Added, CDC General Fertility Rate, CDC Measles Cases, ChatGPT Outage Days, Claude Code Commits, Claude Downtime Days, Cloudflare Critical Incidents, Discord Critical Incidents, EIA Crude Oil SPR Stocks, FDIC Failed Bank List, FRED Egg Price, FRED Ground Beef Price, Free App Store Top 2, Paid App Store Top 2, Powerball Jackpot, UMA Clarification Alerts, UMA Proposal Alerts, UMA Vote Commits, UMA Vote Reveals, UMA.rocks, ISM Services PMI, Kaito Polymarket Mindshare, KPop Song Releases, Met Office London Precipitation, MrBeast YouTube Subscribers, MrBeast YouTube Views, NASA GISTEMP Temperature, NBS Press Releases, NCEI U.S. Tornadoes, NYT Front Page, ORNN B200 Index, ORNN H100 Index, ORNN H200 Index, Pyth Natural Gas Strikes, Pyth WTI Strikes, Pyth XAGUSD Strikes, Pyth XAUUSD Strikes, Spotify Top 50 USA, Spotify Top 50 Global, Strategy Bitcoin Purchases, Tesla Deliveries, Trump Schedule, Trump Truth Social, TSA Passenger Volumes, USGS 5.5+ Earthquakes, White House Alien Arrests NYC, White House Full Lid, White House X Posts, HKO Hong Kong Precipitation, KMA Seoul Precipitation, NOAA NYC Precipitation, and NOAA Seattle Precipitation.

## Current Integrations

| Adapter ID | Command | Channel | Alert Role | Emoji | Description |
| --- | --- | --- | --- | --- | --- |
| `bonbast-usd-irr` | `/bonbast` | `#bonbast-usd-irr` | `Bonbast Alerts` | `💱` | Monitors Bonbast USD/IRR values for Polymarket resolution checks. |
| `aaa-regular-gas` | `/aaa` | `#aaa-regular-gas` | `AAA Gas Alerts` | `⛽` | Monitors AAA national Current Avg. Regular gas price for Polymarket resolution checks. |
| `all-in-podcast` | `/allin` | `#allinpod` | `All-In Podcast Alerts` | `🎧` | Monitors allin.com episodes for the latest All-In Podcast release and auto-discovers active weekly All-In Polymarket markets. |
| `aligned-layer-sale` | `/alignedsale` | `#alignedsale` | `Aligned Sale Alerts` | `⏸️` | Temporary monitor for sale.alignedlayer.com page and app-bundle changes while the token sale is on hold. |
| `apple-artist-song-releases` | `/songreleases` | `#songreleases` | `Artist Song Release Alerts` | `🎶` | Monitors Apple Music/iTunes for new 2026 songs by unresolved artists parsed from the Polymarket market. |
| `arena-ai-no-style-control` | `/arenaai` | `#arenaai` | `Arena AI Alerts` | `🤖` | Monitors the top 3 models on Arena AI's overall no-style-control leaderboard. |
| `aws-disrupted-events` | `/aws` | `#aws-disrupted` | `AWS Disrupted Alerts` | `⚠` | Monitors AWS Health Dashboard history events for disrupted service interruption events in the June 30 market window. |
| `based-revenue` | `/basedrevenue` | `#basedrevenue` | `Based Revenue Alerts` | `💵` | Monitors Dune query results for Based cumulative revenue updates. |
| `bea-current-releases` | `/bea` | `#bea-releases` | `BEA Release Alerts` | `📰` | Monitors BEA Current Releases hourly and alerts when the latest article changes. |
| `bls-cpi-releases` | `/blscpi` | `#blscpi-releases` | `BLS CPI Release Alerts` | `📈` | Monitors BLS CPI archived news releases hourly and alerts when the latest article changes. |
| `bls-jobs-added` | `/jobsadded` | `#jobsadded` | `BLS Jobs Added Alerts` | `💼` | Monitors BLS Employment Situation total nonfarm payroll employment change and auto-discovers monthly jobs-added markets. |
| `cdc-fertility-rate` | `/fertility` | `#fertility` | `CDC Fertility Alerts` | `👶` | Monitors CDC natality dashboard 2026 Q1 general fertility rate publication. |
| `cdc-measles` | `/measles` | `#measles` | `CDC Measles Alerts` | `🦠` | Monitors CDC's 2026 confirmed U.S. measles total cases counter. |
| `openai-chatgpt-outages` | `/chatgptoutage` | `#chatgptoutage` | `ChatGPT Outage Alerts` | `🟠` | Monitors OpenAI Status for resolved ChatGPT partial/full outage days, shows all partial/full outages for manual review, and auto-discovers monthly outage markets. |
| `claude-code-commits` | `/claudecommits` | `#claudecommits` | `Claude Commits Alerts` | `💻` | Monitors Claude Code Commits Tracker daily data and alerts once when unresolved high/low targets are hit. |
| `claude-downtime` | `/claudedown` | `#claudedown` | `Claude Downtime Alerts` | `🔴` | Monitors Claude Status claude.ai uptime boxes and alerts once for finalized non-green days. |
| `cloudflare-critical-incidents` | `/cloudflare` | `#cloudflare-critical` | `Cloudflare Critical Alerts` | `🔴` | Monitors Cloudflare's official incidents API for Critical/red incidents. |
| `discord-critical-incidents` | `/discord` | `#discord-critical` | `Discord Critical Alerts` | `🔴` | Monitors Discord's official incidents API for Critical/red incidents and auto-discovers monthly by-date markets. |
| `eia-crude-spr` | `/eia` | `#eia-crude-spr` | `EIA Crude SPR Alerts` | `⛽` | Monitors EIA weekly U.S. Ending Stocks of Crude Oil in the Strategic Petroleum Reserve. |
| `fdic-failed-banks` | `/fdic` | `#fdic-failed-banks` | `FDIC Failed Bank Alerts` | `🏦` | Monitors the latest row in the FDIC Failed Bank List for new bank failures. |
| `fred-egg-price` | `/eggs` | `#eggs` | `FRED Egg Price Alerts` | `🥚` | Monitors FRED April 2026 Eggs, Grade A, Large cost per dozen and release-date polling. |
| `fred-ground-beef` | `/beef` | `#beef` | `FRED Ground Beef Alerts` | `🥩` | Monitors FRED 2026 Ground beef, 100% beef cost per pound and release-date polling. |
| `free-app-store` | `/freeappstore` | `#freeappstore` | `Free App Store Alerts` | `🆓` | Monitors the US iPhone App Store Top Free Apps top 2 list for Polymarket resolution checks. |
| `nbs-press-release` | `/nbs` | `#nbs-press` | `NBS Press Release Alerts` | `🇨🇳` | Monitors China NBS English press releases hourly and alerts when the latest item changes. |
| `ornn-b200-index` | `/ornnb200` | `#ornnb200` | `ORNN B200 Alerts` | `🖥️` | Monitors finalized ORNN B200 Index daily chart values for GPU rental-price resolution checks. |
| `ornn-h100-index` | `/ornnh100` | `#ornnh100` | `ORNN H100 Alerts` | `🖥️` | Monitors finalized ORNN H100 Index daily chart values and auto-discovers active H100 GPU rental-price markets. |
| `ornn-h200-index` | `/ornnh200` | `#ornnh200` | `ORNN H200 Alerts` | `🖥️` | Monitors finalized ORNN H200 Index daily chart values for GPU rental-price resolution checks. |
| `paid-app-store` | `/paidappstore` | `#paidappstore` | `Paid App Store Alerts` | `💰` | Monitors the US iPhone App Store Top Paid Apps top 2 list for Polymarket resolution checks. |
| `powerball-jackpot` | `/powerball` | `#powerball` | `Powerball Jackpot Alerts` | `🎰` | Monitors Powerball's official estimated jackpot once daily for the $1B July 31 market trend. |
| `polymarket-clarifications` | `/umaclarifications` | `#uma-clarifications` | `UMA Clarification Alerts` | `📣` | Alerts on Polymarket UMA bulletin-board clarification updates on Polygon. |
| `polymarket-disputes` | `/umadispute` | `#uma-disputes` | `UMA Dispute Alerts` | `⚖️` | Alerts when Polymarket UMA resolution proposals are disputed on-chain. |
| `polymarket-proposals` | `/umaproposals` | `#uma-proposals` | `UMA Proposal Alerts` | `📨` | Alerts when Polymarket UMA resolution proposals open on-chain for configured Polymarket tags. |
| `uma-vote-commits` | `/umacommits` | `#uma-commits` | `UMA Commit Alerts` | `🔒` | Alerts when Ethereum UMA Voting v2 commit or recommit events come from voters above the configured staked UMA threshold. |
| `uma-vote-reveals` | `/umareveals` | `#uma-reveals` | `UMA Reveal Alerts` | `👁️` | Alerts when Ethereum UMA Voting v2 reveal events meet the configured staked UMA threshold. |
| `uma-voting-committee` | `/umarocks` | `#umarocks` | `UMA.rocks Alerts` | `🗳️` | Monitors UMA.rocks voting committee GitHub answer changes and contributor comments for the active voting round. |
| `pyth-natural-gas-strikes` | `/ngprice` | `#ngprice` | `NG Price Alerts` | `⛽` | Monitors the top Pyth Natural Gas ticker, alerts only on strike crossings, and auto-discovers monthly NG price markets. |
| `pyth-wti-strikes` | `/wti` | `#wti` | `WTI Price Alerts` | `🛢️` | Monitors the top Pyth WTI ticker, alerts only on strike crossings, and auto-discovers monthly WTI price markets. |
| `pyth-xagusd-strikes` | `/xagusd` | `#xagusd` | `XAGUSD Price Alerts` | `🥈` | Monitors the Pyth XAGUSD feed, alerts only on strike crossings, and auto-discovers monthly silver price markets. |
| `pyth-xauusd-strikes` | `/xauusd` | `#xauusd` | `XAUUSD Price Alerts` | `🥇` | Monitors the Pyth XAUUSD feed, alerts only on strike crossings, and auto-discovers monthly gold price markets. |
| `spotify-top-50-usa` | `/spotifyusa` | `#spotifyusa` | `Spotify USA Top 50 Alerts` | `🎵` | Monitors the #1 track and primary artist profile(s) on Spotify Top 50 - USA for Polymarket resolution checks. |
| `spotify-top-50-global` | `/spotifyglobal` | `#spotifyglobal` | `Spotify Global Top 50 Alerts` | `🎵` | Monitors the #1 track and primary artist profile(s) on Spotify Top 50 - Global for Polymarket resolution checks. |
| `strategy-bitcoin-purchases` | `/strategybtc` | `#strategybtc` | `Strategy BTC Alerts` | `🪙` | Monitors Strategy's Bitcoin Purchases page for announcements in the active Polymarket date range. |
| `tesla-deliveries` | `/tesla` | `#tesla` | `Tesla Deliveries Alerts` | `🚗` | Monitors Tesla production and deliveries press releases for Q2 2026 delivery updates. |
| `trump-schedule` | `/trumpschedule` | `#trumpschedule` | `Trump Schedule Alerts` | `🗓️` | General Roll Call Factbase daily Trump schedule feed with compact change alerts and no default Polymarket URL. |
| `trump-truth` | `/trumptruth` | `#trumptruth` | `Trump Truth Alerts` | `📰` | Monitors the Trump's Truth archive feed for @realDonaldTrump posts and parsed weekly Polymarket strike terms. |
| `tsa-passengers` | `/tsa` | `#tsa` | `TSA Passenger Alerts` | `✈️` | Sums TSA daily checkpoint throughputs for the date range parsed from the Polymarket URL. |
| `usgs-earthquakes` | `/earthquake` | `#earthquake` | `USGS Earthquake Alerts` | `🌎` | Monitors the latest USGS 5.5+ earthquake in the May 4-May 10 market window. |
| `white-house-aliens-nyc` | `/aliennyc` | `#aliennyc` | `Alien NYC Arrests Alerts` | `🛸` | Monitors the White House aliens table Total Arrests counter for New York, NY. |
| `white-house-full-lid` | `/fulllid` | `#fulllid` | `White House Lid Alerts` | `🧢` | Monitors Roll Call and Forth for the first daily White House full lid and labels whether it was before 6:30 PM ET. |
| `white-house-tweets` | `/whitehousetweets` | `#whitehousetweets` | `White House Tweet Alerts` | `🐦` | Counts @WhiteHouse X posts in overlapping weekly noon-to-noon ET markets and sends hourly summary alerts for newly captured posts. |
| `hk-precip` | `/hkprecip` | `#hkprecip` | `HKO Hong Kong Precip Alerts` | `☔` | Monitors HKO Hong Kong monthly rainfall, using Yesterday's Weather as an alpha add-on before Daily Extract catches up. |
| `ism-services-pmi` | `/ismpmi` | `#ismpmi` | `ISM PMI Alerts` | `📊` | Monitors the ISM Services PMI May 2026 report and polls faster around the scheduled release day. |
| `kaito-polymarket-mindshare` | `/kaitomindshare` | `#kaitomindshare` | `Kaito Mindshare Alerts` | `🧠` | Monitors finalized Kaito Info Markets Historical Data rows for Polymarket mindshare. |
| `apple-kpop-song-releases` | `/kpopreleases` | `#kpopreleases` | `KPop Song Release Alerts` | `🎤` | Monitors Apple Music/iTunes for new 2026 songs by unresolved KPop groups parsed from the Polymarket market. |
| `kma-seoul-precip` | `/koreaprecip` | `#koreaprecip` | `KMA Seoul Precip Alerts` | `☔` | Monitors KMA Seoul monthly precipitation for Polymarket resolution checks. |
| `met-office-london-precip` | `/londonprecip` | `#londonprecip` | `Met Office London Precip Alerts` | `☔` | Monitors Met Office Heathrow station rain mm, with Infoclimat daily cumulative alpha before the Met Office monthly row appears. |
| `mrbeast-subscribers` | `/mrbeastsubs` | `#mrbeastsubs` | `MrBeast Subs Alerts` | `👥` | Tracks MrBeast YouTube channel subscribers, rate, and Polymarket target projections. |
| `mrbeast-views` | `/mrbeastviews` | `#mrbeastviews` | `MrBeast Views Alerts` | `👀` | Tracks MrBeast YouTube channel total views with compact billion/million target summaries. |
| `nasa-gistemp-temperature` | `/gistemp` | `#gistemp` | `NASA GISTEMP Alerts` | `🌡️` | Monitors NASA GISTEMP Global Land-Ocean Temperature Index monthly anomaly cells. |
| `noaa-nyc-precip` | `/nycprecip` | `#nycprecip` | `NOAA NYC Precip Alerts` | `☔` | Monitors NOAA NYC monthly precipitation for Polymarket resolution checks. |
| `noaa-seattle-precip` | `/seattleprecip` | `#seattleprecip` | `NOAA Seattle Precip Alerts` | `☔` | Monitors NOAA Seattle monthly precipitation for Polymarket resolution checks. |
| `ncei-tornadoes` | `/tornadoes` | `#tornadoes` | `NCEI Tornado Alerts` | `🌪️` | Monitors NCEI U.S. Tornadoes monthly time-series counts and auto-discovers monthly tornado markets. |
| `nyt-front-page` | `/nytfront` | `#nytfront` | `NYT Front Page Alerts` | `📰` | Monitors the daily New York print front page, OCRs/highlights matched strike words, and scans the active weekly window on manual checks. |

## Agent Quick Context

- This is a local Discord bot for monitoring Polymarket resolution sources; it sends alerts only and does not trade.
- Integrations are code-defined adapters in `src/integrations/` and registered in `src/integrations/registry.ts`.
- One adapter normally creates one monitor channel, one slash-command group, one alert role, and one reaction-role selector. UMA Proposal Alerts also manages tag-specific alert channels from its configured tag filters.
- Shared commands are generated in `src/commands.ts`: `status`, `check`, `test`, `last`, `clear`, `polymarket`, `enddate`, `interval`, `pause`, `resume`; adapters with month/year settings also get `period`, snapshot adapters get `snapshot`, strike-text adapters get `strikes`, searchable strike adapters get `search`, and tag-filtered adapters get `tagsearch` and `tags`.
- Channel names should match or clearly hint at the slash-command prefix so users do not have to guess the command.
- Shared Discord UI lives in `src/embeds.ts`; keep new integration replies/alerts using these embed builders.
- Event alerts can put noisy metadata in `hiddenFields`; Discord shows it only through the shared `Show more` button.
- Polling and alert sends live in `src/poller.ts`; reaction-role add/remove logic lives in `src/reactionRoles.ts`.
- UMA Vote Commits polls Ethereum UMA Voting v2 `VoteCommitted` logs every minute, estimates voter stake with `getVoterStakePostUpdate(address)`, detects recommits from repeated voter/request commit keys, and filters by `/umacommits threshold`.
- UMA Vote Reveals polls Ethereum UMA Voting v2 `VoteRevealed` logs every minute and filters by `/umareveals threshold`.
- Market-end reminder lookup lives in `src/marketEnd.ts`; it uses queued ET windows when available, otherwise Polymarket Gamma API `endDate` by URL slug, stores the result in SQLite, backs off failed Gamma lookups, and sends shared 24h, 12h, 1h, and end alerts.
- SQLite stores integration state, Polymarket URL, market-end metadata, adapter settings JSON, timestamps, and role metadata; keep timestamps as ISO strings.
- Daily snapshot integrations store snapshot value/date separately from regular interval `lastValue` checks so event-time captures are not overwritten.
- Dated/monthly Polymarket URLs are queued in `settingsJson.polymarketMarkets` by `src/polymarketQueue.ts`; the active URL changes automatically by ET window, expired queued URLs are pruned after rollover, and stale dated URLs are cleared when no queued or undated market is active.
- Trump Truth, All-In Podcast, NYT Front Page, monthly precipitation, ChatGPT Outage, Claude Downtime, Discord Critical, TSA, Tesla Deliveries, USGS Earthquakes, White House X Posts, NCEI Tornadoes, BLS Jobs Added, and Pyth price-strike bots have adapter-specific auto-discovery for upcoming recurring markets; keep this inside the adapter unless the behavior becomes clearly reusable.

## Setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in:

   ```text
   DISCORD_TOKEN=...
   DISCORD_CLIENT_ID=...
   DISCORD_GUILD_ID=...
   DATABASE_PATH=data/bot.sqlite
   DEFAULT_POLL_INTERVAL_MINUTES=5
   DUNE_API_KEY=...
   KAITO_INFOMARKETS_API_URL=...
   KAITO_API_KEY=...
   POLYGON_RPC_URL=...
   POLYGON_RPC_URLS=...
   POLYGON_WS_URL=...
   ETHEREUM_RPC_URL=...
   ETHEREUM_RPC_URLS=...
   X_BEARER_TOKEN=...
   WHITE_HOUSE_TWEETS_NITTER_FEEDS=https://xcancel.com/WhiteHouse/rss
   WHITE_HOUSE_TWEETS_ALLOW_NITTER_FALLBACK=true
   ```

3. Register slash commands for your test server:

   ```powershell
   npm run register-commands
   ```

The bot invite needs `Manage Channels`, `Send Messages`, `View Channels`, `Manage Messages`, `Manage Roles`, `Add Reactions`, and `Read Message History`. The bot's highest Discord role must be above the alert roles it manages. Enable the Server Members Intent in the Discord Developer Portal if role assignment fails.

## Commands

The bot creates a channel for each registered adapter when it starts, then checks every minute for missing channels.

Every integration uses the same command shape inside its own channel. Replace `/bonbast` below with that channel's command, for example `/trumptruth`, `/tsa`, `/mrbeastviews`, or `/nytfront`:

- `/bonbast status`
- `/bonbast check`
- `/bonbast test`
- `/bonbast last`
- `/bonbast updates`
- `/freeappstore snapshot`
- `/paidappstore snapshot`
- `/bonbast clear`
- `/bonbast polymarket url:https://polymarket.com/event/example`
- `/bonbast enddate datetime:2026-05-10 23:59`
- `/bonbast interval minutes:1`
- `/umacommits threshold value:250k`
- `/umareveals threshold value:250k`
- `/bonbast pause`
- `/bonbast resume`
- `/bot summarize`
- `/bot clearerrors keep-latest:true`

Month/year integrations also support:

- `/claudedown period year:2026 month:6`
- `/chatgptoutage period year:2026 month:6`
- `/hkprecip period year:2026 month:5`
- `/koreaprecip period year:2026 month:5`
- `/londonprecip period year:2026 month:5`
- `/gistemp period year:2026 month:6`
- `/nycprecip period year:2026 month:5`
- `/seattleprecip period year:2026 month:5`

Monthly precipitation, ChatGPT Outage, and Claude Downtime adapters auto-discover active next-month Polymarket URLs through Gamma public search and keep `year`/`month` settings synchronized with the active queued market.

Commands are intentionally channel-scoped. A command only executes in the channel owned by the matching adapter.
Command replies and alerts display timestamps in Singapore local time.
Status replies show both the configured base interval and the current effective interval. Dynamic polling integrations also show the current polling mode/reason.
Use each channel's `updates` command to review recent detected update times and rough SGT/ET hour patterns. Update logs begin from deployment and are not backfilled.
Use `/bot summarize` anywhere in the server to list all integrations with resolution source, Polymarket URL, parsed market end, and polling interval.
Use `/bot clearerrors` to scan all integration channels and delete old bot `Check failed` messages; by default it keeps only the newest failure per channel. Use `keep-latest:false` to remove all existing failure messages.
Bonbast replies use Discord embeds with compact fields, colored status accents, and clickable links.
Use `/bonbast polymarket` once per market so future alerts include a clickable Polymarket link.
The stored Polymarket URL also drives market-end reminders. For queued dated URLs, the bot uses the ET-derived queue end time; otherwise it reads the market `endDate` from Polymarket Gamma API once per integration/Polymarket URL, stores it locally, and alerts 24 hours before, 12 hours before, 1 hour before, and at the returned end time. If Gamma does not return an `endDate`, the bot sends one warning in that integration channel instead of repeatedly querying Gamma. Failed Gamma lookups back off before retrying so a VPN/DNS/API outage does not flood logs. Use the channel's `enddate` command to manually set the end time in ET, for example `/bonbast enddate datetime:2026-05-10 23:59`.
Use `/bonbast clear` to clear the current integration channel. You and the bot both need `Manage Messages`.
Use `/bonbast test` to preview the exact role ping and alert embed without fetching Bonbast or changing stored values.

## Polymarket URL Queue

For most integrations, `/... polymarket url:<url>` appends or updates a queued Polymarket URL in `settingsJson.polymarketMarkets`. If the URL slug contains a date range such as `may-18-may-24`, the bot derives an ET window, keeps the current market active until the new window starts, switches automatically on the next poll/check, and prunes expired queued URLs after rollover. When no queued dated market is active and there is no undated fallback, the bot clears the active Polymarket URL so stale expired markets stop driving checks and reminders.

If a URL has no parseable date range, the bot keeps it as an undated fallback for that integration. Market-end reminders for queued dated URLs use the queue's ET-derived `endAt` instead of Gamma `endDate`. Trump Truth uses a specialized queue because it stores all terms, resolved terms, active terms, and Gamma refresh timestamps per weekly market. NYT Front Page, TSA, and USGS Earthquakes use the shared queue plus adapter-specific auto-discovery for upcoming weekly markets. Tesla Deliveries uses the shared queue plus adapter-specific auto-discovery for upcoming quarterly delivery markets. NCEI Tornadoes uses adapter-specific monthly windows with Gamma `endDate` because monthly markets overlap the next month until the NCEI release date.

Trump Truth and NYT Front Page also support:

- `/trumptruth strikes`
- `/trumptruth search term:King`
- `/nytfront strikes`

The `strikes` command force-refreshes Gamma-derived strike terms and then displays the currently active unresolved terms.
The Trump Truth `search` command refreshes settings, searches the Trump Truth archive for a word or phrase inside the active weekly market's ET timeframe, and returns matching posts plus the source search URL.

UMA Proposal Alerts also supports:

- `/umaproposals tagsearch query:sports`
- `/umaproposals tags action:add tag:1`
- `/umaproposals tags action:list`
- `/umaproposals tags action:remove tag:sports`
- `/umaproposals tags action:clear`
- `/umaproposals tagblocks action:add blocked:mentions`
- `/umaproposals tagblocks action:list`
- `/umaproposals tagblocks action:remove blocked:mentions`
- `/umaproposals tagblocks action:clear`

Proposal alerts are off until at least one Polymarket tag filter is configured. The bot watches UMA `ProposePrice` logs first, then enriches each proposal with Polymarket CLOB market metadata and only alerts when the market tags exactly match a configured tag label or slug. Adding a tag creates a dedicated channel named `#uma-proposals-<tag-slug>`, removing a tag deletes that tag channel, and matching alerts are sent to the tag-specific channel instead of the base `#uma-proposals` command channel.
Run `/umaproposals tagblocks` inside a tag-specific proposal channel to exclude another tag only from that channel, for example excluding `mentions` from `#uma-proposals-politics`. From the base `#uma-proposals` channel, include `tag:<configured-tag>` to choose which tag channel gets the exclusion.

UMA Proposal and Dispute Alerts also support address labels:

- `/umaproposals addresses action:add address:0x0000000000000000000000000000000000000000 name:Example`
- `/umaproposals addresses action:list`
- `/umaproposals addresses action:remove address:0x0000000000000000000000000000000000000000`
- `/umaproposals addresses action:clear`
- `/umaproposals addresses action:import file:addresses.csv dry-run:true`
- `/umaproposals addresses action:import file:addresses.csv dry-run:false`
- `/umaproposals addresses action:export`

The same `addresses` subcommand is available on `/umadispute`. Adding, removing, clearing, or importing labels syncs across the configured UMA proposal and dispute integrations so proposer and disputer fields can show names above the raw address. Bulk import accepts CSV or loose text where each nonblank row contains one nickname and one `0x` address; dry-run defaults to true so imports can be previewed before saving. Export returns the current shared address book as CSV. Alerts check Polymarket's public Data API trades endpoint for each proposer/disputer address; addresses with at least one trade get a Polymarket profile link, while addresses with no returned trades are marked as no trades found.
UMA proposal/dispute alerts also include `Label proposer` and `Label disputer` buttons when those addresses are present. Clicking one opens a private nickname form and saves the label through the same synced address-label storage.

App Store integrations have one extra command:

- `/freeappstore snapshot`
- `/paidappstore snapshot`

The Free App Store and Paid App Store integrations run a separate daily snapshot check during the 12:00-12:05 PM ET window. That snapshot is posted as a distinct snapshot alert, stored in separate SQLite fields, and is not overwritten by regular interval checks. The next ET day noon snapshot replaces the previous stored snapshot. Repeated snapshot failures use the shared integration error-throttling window.

## Alert Roles

The bot creates `#market-alert-roles` and posts grouped reaction selectors for market integration roles. It creates `#uma-alert-roles` for UMA clarification, proposal, and dispute alert roles. React to an alert emoji to receive that alert role; remove your reaction to opt out. Each grouped selector uses up to 20 unique emoji, and the provisioner preserves existing selector-message assignments, user reactions, and stored fallback emoji while adding missing bot reactions. Stale selector messages with user reactions are left in place instead of being deleted automatically.

The Current Integrations table is the source of truth for each adapter's role name and emoji. Normal value-change alerts, daily snapshots, and market-end reminders mention the adapter alert role. Event-post integrations can be quieter: Trump Truth posts every new post but only mentions the role when a strike is detected, while NYT Front Page only posts alerts for strike matches.

## Integration Pattern

- Add integrations as adapters in `src/integrations/`; keep scraping and parsing logic inside the adapter.
- Register adapters in `src/integrations/registry.ts`; each adapter must define `id`, `commandName`, `displayName`, `sourceUrl`, `defaultChannelName`, `alertRoleName`, `alertRoleEmoji`, and `fetchCurrentValue`.
- Keep `defaultChannelName` synchronized with `commandName` when practical; if exact matching is too long, the channel name must still clearly indicate the slash command.
- Return normalized string values plus `observedAt`; store timestamps as ISO strings and format them only in Discord output.
- Auto-parsed strike integrations must ignore resolved markets, including Gamma markets marked `closed`, `archived`, inactive, or outcome prices already resolved to `1/0`.
- Use `defaultSettings` and `supportsPeriod` for month/year-driven sources; keep settings in adapter-owned JSON rather than one-off tables.
- Use the shared command set and embeds; do not create one-off Discord UI per integration.
- Do not add integration-specific command handlers unless the shared command model cannot express the behavior.
- Temporary integrations should still be normal adapters with full command/channel/role metadata; mark the temporary purpose in this README and remove or pause the adapter once the market no longer needs monitoring.
- Add focused tests for parser extraction, adapter registry metadata, command registration, and embed output.
- Keep README Current Integrations metadata in sync with `listAdapters()`; `test/documentation.test.ts` checks adapter id, command, channel, alert role, and emoji.
- Keep links in this exact embed field format:

  ```text
  Resolution: <resolution-url>
  Polymarket: <polymarket-url-or-not-set>
  ```

## Development

- Add new websites under `src/integrations/`.
- Aligned Layer Sale is a temporary page-change monitor for `sale.alignedlayer.com`; it stores the HTML shell, app asset paths, and sale-status phrases so an app deployment or sale-state wording change triggers a normal value-change alert.
- EIA monitors weekly SPR crude oil reserve stocks; it polls hourly except on Tuesday/Wednesday ET, when it polls every minute around the normal release window.
- FRED eggs monitors April 2026 egg-price data; it polls hourly except on the day before and day of the parsed next release date, when it polls every minute.
- FRED beef monitors the latest 2026 ground beef price; it polls hourly except on the day before and day of the parsed next release date, when it polls every minute.
- FDIC monitors the latest failed-bank table row; changes to that row trigger the normal value-change alert.
- Kaito mindshare monitors a configured Kaito Historical Data JSON/API endpoint for finalized Polymarket mindshare rows because the public Kaito page is Cloudflare-protected from direct bot scraping.
- MrBeast subscribers monitors the YouTube channel About metadata subscriber count and compares it to Gamma-parsed million-subscriber market targets.
- MrBeast views monitors the YouTube channel About metadata total view count, rejects implausible video-level view-count parses, compares it to Gamma-parsed billion-view targets, uses `lastChangedAt` for rate math, and keeps `#mrbeastviews` as the canonical channel name.
- ORNN B200, H100, and H200 monitor the dashboard's GPU index-history API and use the second latest point as finalized because daily values finalize after the following day's point is published. Each ORNN GPU adapter polls hourly, alerts only when the finalized daily value changes, and auto-discovers active `gpu-rental-prices-<gpu>-...` Polymarket markets through Gamma search.
- UMA Clarification Alerts subscribes to pending `postUpdate(bytes32,bytes)` transactions and mined `AncillaryDataUpdated` events from Polymarket's UMA bulletin-board contract on Polygon over WebSocket, defaults to PublicNode's free Polygon Bor WebSocket, and uses Nodies, OnFinality, dRPC, PublicNode, Tenderly, and QuickNode public endpoints for 1-minute HTTP backfill. Pending mempool alerts are best-effort and can arrive before mining; the mined-log path remains the confirmation/backfill. It can be pointed at another provider with `POLYGON_WS_URL`, `POLYGON_RPC_URL`, or comma-separated `POLYGON_RPC_URLS`.
- UMA Dispute Alerts subscribes to UMA OptimisticOracle `DisputePrice` events on Polygon, watches current and legacy oracle contracts, filters requester addresses to Polymarket UMA requester contracts including the bulletin board adapter, and uses 1-minute HTTP backfill plus CLOB `markets-by-question-id` enrichment.
- UMA Proposal Alerts subscribes to UMA OptimisticOracle `ProposePrice` events on Polygon, watches current and legacy oracle contracts, filters requester addresses to Polymarket UMA requester contracts including the bulletin board adapter, enriches each proposal through CLOB `markets-by-question-id`, and alerts only when the returned market tags match configured `/umaproposals tags` filters.
- UMA Vote Commits polls Ethereum UMA Voting v2 `VoteCommitted` logs every minute, estimates each voter's current stake at the commit block with `getVoterStakePostUpdate(address)`, detects recommits from repeated voter/request commit keys, groups same-voter events per scan into voter-level summaries because commit answers are confidential, starts new installs with a short live-head lookback, and alerts only when the stake is at least `/umacommits threshold`.
- UMA Vote Reveals polls Ethereum UMA Voting v2 `VoteRevealed` logs every minute, groups same-voter events per scan, and alerts only when the revealed `numTokens` vote weight is at least `/umareveals threshold`; default free RPC endpoints can be overridden with `ETHEREUM_RPC_URL` or comma-separated `ETHEREUM_RPC_URLS`.
- UMA proposal alerts keep question, outcome, market tags, proposer, and times visible; transaction, condition ID, question ID, oracle, requester, request timestamp, and block are behind `Show more`.
- UMA clarification, proposal, and dispute question fields include a Betmoar market link when the Polymarket market slug is known.
- Pyth Natural Gas, WTI, XAGUSD, and XAUUSD auto-discover matching monthly Polymarket markets, parse only unresolved strike prices from the active Polymarket URL, check only the configured top stable Pyth feed, store the latest observed price, and alert only when the live 1-minute candle range crosses a strike from the previously stored price.
- AWS monitors the public AWS Health Dashboard history events JSON and treats status code `3` as the disrupted severity classification.
- BLS Jobs Added monitors the Employment Situation Summary current/archive pages, keeps each monthly market active through the scheduled 8:30 AM ET release day, polls every minute on the day before/day of release, and auto-discovers active monthly `how-many-jobs-added-in-...` markets.
- CDC fertility monitors the natality dashboard CSV for the 2026 Q1 general fertility rate row.
- Cloudflare monitors the official Statuspage incidents API and returns a stable no-critical value unless a Critical/red incident appears.
- Discord monitors the official Statuspage incidents API and filters Critical/red incidents to the 2026 May 31 market window.
- Artist Song Releases and KPop Song Releases parse unresolved artist/group questions from Gamma, resolve Apple Music artist IDs through the public iTunes Search API, poll recent Apple song catalog entries hourly, filter obvious DJ-mix catalog noise, and alert only when a new 2026 track ID appears after the first stored check.
- ISM Services PMI checks the Services report page plus the direct monthly report URL, stores `not published yet` before release, and polls every minute on the day before/day of the scheduled 10:00 AM ET release.
- NCEI tornadoes monitors monthly U.S. tornado counts from the NCEI Tornadoes Time Series JSON endpoint, treats preliminary counts as resolution-relevant, and only alerts when the target month first becomes published.
- USGS earthquakes monitors the official USGS event API for the latest 5.5+ earthquake in the active Polymarket date window and auto-discovers upcoming weekly 5.5+ earthquake markets into the shared queue.
- HKO Hong Kong precipitation uses Daily Extract as the official total, then adds the text-only Yesterday's Weather rainfall only when that report is newer than the latest Daily Extract day.
- Met Office London precipitation uses Heathrow stationdata as the official monthly row and Infoclimat Heathrow climatology as daily cumulative alpha before the Met Office row appears.
- White House Alien Arrests NYC reads the embedded Flourish table on `whitehouse.gov/aliens` and exact-matches the `New York, NY` row's `Total Arrests` counter.
- White House Full Lid monitors Roll Call's Factba.se calendar and Forth's WH pool page for today's ET full lid; it polls every minute during 8:00 AM-8:30 PM ET and hourly off-hours.
- White House X Posts uses the official X API when `X_BEARER_TOKEN` is set; otherwise it falls back to Nitter/XCancel RSS feeds such as `WHITE_HOUSE_TWEETS_NITTER_FEEDS=https://xcancel.com/WhiteHouse/rss`. It polls every 5 minutes, keeps a monotonic captured-post set, auto-discovers overlapping weekly Polymarket markets, and sends role-tagged hourly summaries only when newly captured posts exist. RSS fallback is free but less authoritative and can miss deleted posts if the feed never exposes them before removal.
- Register new adapters in `src/integrations/registry.ts`.
- Give each adapter a unique `commandName` for its slash command.
- Give each adapter a unique `alertRoleName` and `alertRoleEmoji`.
- Keep scraping logic isolated in adapters.
- Use simple HTTP parsing first; add browser automation later only for JavaScript-rendered sources.
- Free and Paid App Store integrations monitor Apple's US iPhone chart feeds and compare the top 2 list; both capture separate 12:00 PM ET daily snapshots via snapshot storage fields.
- Spotify USA and Spotify Global monitor public Spotify Top 50 playlist pages and store the #1 track plus primary artist profile names.
- Arena AI monitors the server-rendered no-style-control leaderboard and stores only the top 3 model names/ranks so score/vote movements do not trigger alerts.
- Tesla deliveries monitors Tesla production and delivery press releases through the matching official SEC 8-K exhibit because direct local requests to `ir.tesla.com/press` are Akamai-blocked; it auto-discovers active quarterly Polymarket delivery markets into the shared queue.
- Trump Schedule monitors Roll Call's Factba.se calendar for today's ET public schedule, stores a compact daily digest with lid/travel/press/remarks flags, and polls every 15 minutes during 7:00 AM-10:00 PM ET.
- Trump Truth uses the reachable `https://www.trumpstruth.org/feed` archive feed because direct Truth Social access is Cloudflare-blocked locally; alerts include original Truth Social URLs and an Open Truth link button for verification.
- Trump Truth parses weekly Polymarket strike terms into `settingsJson`, stores the latest seen Truth Social post ID in `lastValue`, checks archive image descriptions, alt text, and basic OCR output for image-only strike review, auto-discovers upcoming weekly markets, supports active-window archive search with `/trumptruth search`, and only role-tags strike hits.
- NYT Front Page auto-discovers active weekly NYT headline markets through Gamma search; scheduled polling checks the latest page, while `/nytfront check` scans every issue date in the active market window, forces each historical page image to its issue date, and posts highlighted matched pages.
- TSA passengers parses the date range from the active Polymarket URL slug, sums official TSA daily checkpoint throughput rows for that range, and auto-discovers upcoming weekly TSA markets into the shared queue.
- Generic dated Polymarket queueing lives in `src/polymarketQueue.ts`; prefer it over adapter-specific queue fields unless the adapter needs extra parsed market state.

## Maintenance Review Notes

- Overall structure is healthy: adapters stay isolated, while `commands.ts`, `poller.ts`, `embeds.ts`, `database.ts`, and `provisioner.ts` form the shared core.
- Shared settings helpers live in `src/settingsJson.ts`; use them when reading or merging cross-adapter `settingsJson` keys.
- `commands.ts`, `embeds.ts`, and `poller.ts` are still the main growth hotspots; split only when changing them for real features, not as a standalone rewrite.
- Poller error suppression/formatting lives in `src/errorNotices.ts`; keep retry/noise-control behavior there instead of adding local copies.
- Registry and command metadata tests are table-driven from `listAdapters()`; add special-case assertions only for adapter-specific capabilities.
- Current one-timer-per-integration polling is fine for dozens of adapters; revisit only if the bot grows into hundreds of active monitors or needs exact cron scheduling.
- Keep `lastValue` string comparisons for simple monitors, but use structured settings/event tables for dedupe-heavy or multi-item integrations.

## Validation

```powershell
npm test
npm run build
```


