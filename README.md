# Polymarket Resolution Monitor Bot

Local Discord bot for monitoring Polymarket resolution-source websites and posting alerts when tracked values change.

## Current Scope

- Discord slash commands only.
- One channel per website integration.
- Local SQLite persistence.
- Polling and Discord alerts only.
- Integration channels are auto-created from registered adapters.
- Alert roles are auto-created from registered adapters.
- Current adapters include Bonbast USD/IRR, AAA Regular Gas, All-In Podcast, Arena AI No Style Control, AWS Disrupted Events, Based Revenue, BEA Current Releases, BLS CPI Releases, CDC General Fertility Rate, CDC Measles Cases, Cloudflare Critical Incidents, Discord Critical Incidents, EIA Crude Oil SPR Stocks, FDIC Failed Bank List, FRED Egg Price, FRED Ground Beef Price, Free App Store Top 2, Paid App Store Top 2, Kaito Polymarket Mindshare, NBS Press Releases, NYT Front Page, ORNN B200 Index, ORNN H200 Index, Pyth Natural Gas Strikes, Pyth WTI Strikes, Pyth XAGUSD Strikes, Pyth XAUUSD Strikes, Spotify Top 50 USA, Spotify Top 50 Global, Strategy Bitcoin Purchases, Tesla Deliveries, Trump Truth Social, TSA Passenger Volumes, USGS 5.5+ Earthquakes, White House Full Lid, HKO Hong Kong Precipitation, KMA Seoul Precipitation, NOAA NYC Precipitation, and NOAA Seattle Precipitation.

## Current Integrations

| Adapter ID | Command | Channel | Alert Role | Emoji | Description |
| --- | --- | --- | --- | --- | --- |
| `bonbast-usd-irr` | `/bonbast` | `#bonbast-usd-irr` | `Bonbast Alerts` | `ðŸ’±` | Monitors Bonbast USD/IRR values for Polymarket resolution checks. |
| `aaa-regular-gas` | `/aaa` | `#aaa-regular-gas` | `AAA Gas Alerts` | `â›½` | Monitors AAA national Current Avg. Regular gas price for Polymarket resolution checks. |
| `all-in-podcast` | `/allin` | `#allinpod` | `All-In Podcast Alerts` | `ðŸŽ§` | Monitors allin.com episodes for the latest All-In Podcast release. |
| `arena-ai-no-style-control` | `/arenaai` | `#arenaai` | `Arena AI Alerts` | `🤖` | Monitors the top 3 models on Arena AI's overall no-style-control leaderboard. |
| `aws-disrupted-events` | `/aws` | `#aws-disrupted` | `AWS Disrupted Alerts` | `⚠` | Monitors AWS Health Dashboard history events for disrupted service interruption events in the June 30 market window. |
| `based-revenue` | `/basedrevenue` | `#basedrevenue` | `Based Revenue Alerts` | `💵` | Monitors Dune query results for Based cumulative revenue updates. |
| `bea-current-releases` | `/bea` | `#bea-releases` | `BEA Release Alerts` | `ðŸ“°` | Monitors BEA Current Releases hourly and alerts when the latest article changes. |
| `bls-cpi-releases` | `/blscpi` | `#blscpi-releases` | `BLS CPI Release Alerts` | `ðŸ“ˆ` | Monitors BLS CPI archived news releases hourly and alerts when the latest article changes. |
| `cdc-fertility-rate` | `/fertility` | `#fertility` | `CDC Fertility Alerts` | `👶` | Monitors CDC natality dashboard 2026 Q1 general fertility rate publication. |
| `cdc-measles` | `/measles` | `#measles` | `CDC Measles Alerts` | `🦠` | Monitors CDC's 2026 confirmed U.S. measles total cases counter. |
| `cloudflare-critical-incidents` | `/cloudflare` | `#cloudflare-critical` | `Cloudflare Critical Alerts` | `🔴` | Monitors Cloudflare's official incidents API for Critical/red incidents. |
| `discord-critical-incidents` | `/discord` | `#discord-critical` | `Discord Critical Alerts` | `🔴` | Monitors Discord's official incidents API for Critical/red incidents in the May 31 market window. |
| `eia-crude-spr` | `/eia` | `#eia-crude-spr` | `EIA Crude SPR Alerts` | `⛽` | Monitors EIA weekly U.S. Ending Stocks of Crude Oil in the Strategic Petroleum Reserve. |
| `fdic-failed-banks` | `/fdic` | `#fdic-failed-banks` | `FDIC Failed Bank Alerts` | `??` | Monitors the latest row in the FDIC Failed Bank List for new bank failures. |
| `fred-egg-price` | `/eggs` | `#eggs` | `FRED Egg Price Alerts` | `🥚` | Monitors FRED April 2026 Eggs, Grade A, Large cost per dozen and release-date polling. |
| `fred-ground-beef` | `/beef` | `#beef` | `FRED Ground Beef Alerts` | `🥩` | Monitors FRED 2026 Ground beef, 100% beef cost per pound and release-date polling. |
| `free-app-store` | `/freeappstore` | `#freeappstore` | `Free App Store Alerts` | `ðŸ†“` | Monitors the US iPhone App Store Top Free Apps top 2 list for Polymarket resolution checks. |
| `nbs-press-release` | `/nbs` | `#nbs-press` | `NBS Press Release Alerts` | `🇨🇳` | Monitors China NBS English press releases hourly and alerts when the latest item changes. |
| `ornn-b200-index` | `/ornnb200` | `#ornnb200` | `ORNN B200 Alerts` | `🖥️` | Monitors finalized ORNN B200 Index daily chart values for GPU rental-price resolution checks. |
| `ornn-h200-index` | `/ornnh200` | `#ornnh200` | `ORNN H200 Alerts` | `🖥️` | Monitors finalized ORNN H200 Index daily chart values for GPU rental-price resolution checks. |
| `paid-app-store` | `/paidappstore` | `#paidappstore` | `Paid App Store Alerts` | `ðŸ’°` | Monitors the US iPhone App Store Top Paid Apps top 2 list for Polymarket resolution checks. |
| `pyth-natural-gas-strikes` | `/ngprice` | `#ngprice` | `NG Price Alerts` | `⛽` | Monitors the top Pyth Natural Gas ticker and alerts only when live price crosses parsed Polymarket strikes. |
| `pyth-wti-strikes` | `/wti` | `#wti` | `WTI Price Alerts` | `🛢️` | Monitors the top Pyth WTI ticker and alerts only when live price crosses parsed Polymarket strikes. |
| `pyth-xagusd-strikes` | `/xagusd` | `#xagusd` | `XAGUSD Price Alerts` | `🥈` | Monitors the Pyth XAGUSD feed and alerts only when live price crosses parsed Polymarket strikes. |
| `pyth-xauusd-strikes` | `/xauusd` | `#xauusd` | `XAUUSD Price Alerts` | `🥇` | Monitors the Pyth XAUUSD feed and alerts only when live price crosses parsed Polymarket strikes. |
| `spotify-top-50-usa` | `/spotifyusa` | `#spotifyusa` | `Spotify USA Top 50 Alerts` | `ðŸŽµ` | Monitors the #1 track and primary artist profile(s) on Spotify Top 50 - USA for Polymarket resolution checks. |
| `spotify-top-50-global` | `/spotifyglobal` | `#spotifyglobal` | `Spotify Global Top 50 Alerts` | `??` | Monitors the #1 track and primary artist profile(s) on Spotify Top 50 - Global for Polymarket resolution checks. |
| `strategy-bitcoin-purchases` | `/strategybtc` | `#strategybtc` | `Strategy BTC Alerts` | `🪙` | Monitors Strategy's Bitcoin Purchases page for announcements in the active Polymarket date range. |
| `tesla-deliveries` | `/tesla` | `#tesla` | `Tesla Deliveries Alerts` | `🚗` | Monitors Tesla production and deliveries press releases for Q2 2026 delivery updates. |
| `trump-truth` | `/trumptruth` | `#trumptruth` | `Trump Truth Alerts` | `ðŸ“°` | Monitors the Trump's Truth archive feed for @realDonaldTrump posts and parsed weekly Polymarket strike terms. |
| `tsa-passengers` | `/tsa` | `#tsa` | `TSA Passenger Alerts` | `✈️` | Sums TSA daily checkpoint throughputs for the date range parsed from the Polymarket URL. |
| `usgs-earthquakes` | `/earthquake` | `#earthquake` | `USGS Earthquake Alerts` | `🌎` | Monitors the latest USGS 5.5+ earthquake in the May 4-May 10 market window. |
| `white-house-full-lid` | `/fulllid` | `#fulllid` | `White House Lid Alerts` | `🧢` | Monitors Roll Call and Forth for the first daily White House full lid and labels whether it was before 6:30 PM ET. |
| `hk-precip` | `/hkprecip` | `#hkprecip` | `HKO Hong Kong Precip Alerts` | `â˜”` | Monitors HKO Hong Kong monthly total rainfall from Daily Extract for Polymarket resolution checks. |
| `kaito-polymarket-mindshare` | `/kaitomindshare` | `#kaitomindshare` | `Kaito Mindshare Alerts` | `🧠` | Monitors finalized Kaito Info Markets Historical Data rows for Polymarket mindshare. |
| `kma-seoul-precip` | `/koreaprecip` | `#koreaprecip` | `KMA Seoul Precip Alerts` | `â˜”` | Monitors KMA Seoul monthly precipitation for Polymarket resolution checks. |
| `noaa-nyc-precip` | `/nycprecip` | `#nycprecip` | `NOAA NYC Precip Alerts` | `â˜”` | Monitors NOAA NYC monthly precipitation for Polymarket resolution checks. |
| `noaa-seattle-precip` | `/seattleprecip` | `#seattleprecip` | `NOAA Seattle Precip Alerts` | `â˜”` | Monitors NOAA Seattle monthly precipitation for Polymarket resolution checks. |
| `nyt-front-page` | `/nytfront` | `#nytfront` | `NYT Front Page Alerts` | `ðŸ“°` | Monitors the daily New York print front page on PressReader and OCRs page one for active Polymarket strike terms. |

## Agent Quick Context

- This is a local Discord bot for monitoring Polymarket resolution sources; it sends alerts only and does not trade.
- Integrations are code-defined adapters in `src/integrations/` and registered in `src/integrations/registry.ts`.
- One adapter creates one monitor channel, one slash-command group, one alert role, and one reaction-role selector.
- Shared commands are generated in `src/commands.ts`: `status`, `check`, `test`, `last`, `clear`, `polymarket`, `interval`, `pause`, `resume`; adapters with month/year settings also get `period`.
- Channel names should match or clearly hint at the slash-command prefix so users do not have to guess the command.
- Shared Discord UI lives in `src/embeds.ts`; keep new integration replies/alerts using these embed builders.
- Polling and alert sends live in `src/poller.ts`; reaction-role add/remove logic lives in `src/reactionRoles.ts`.
- Market-end reminder lookup lives in `src/marketEnd.ts`; it uses Polymarket Gamma API `endDate` by URL slug, stores the result in SQLite, and sends shared 24h, 12h, 1h, and end alerts.
- SQLite stores integration state, Polymarket URL, market-end metadata, adapter settings JSON, timestamps, and role metadata; keep timestamps as ISO strings.
- Daily snapshot integrations store snapshot value/date separately from regular interval `lastValue` checks so event-time captures are not overwritten.

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
   ```

3. Register slash commands for your test server:

   ```powershell
   npm run register-commands
   ```

The bot invite needs `Manage Channels`, `Send Messages`, `View Channels`, `Manage Messages`, `Manage Roles`, `Add Reactions`, and `Read Message History`. The bot's highest Discord role must be above the alert roles it manages. Enable the Server Members Intent in the Discord Developer Portal if role assignment fails.

## Commands

The bot creates a channel for each registered adapter when it starts, then checks every minute for missing channels.

For Bonbast, use these commands inside `#bonbast-usd-irr`; for AAA gas, Free App Store, and precipitation integrations, use the same subcommands under `/aaa`, `/allin`, `/arenaai`, `/aws`, `/basedrevenue`, `/bea`, `/blscpi`, `/beef`, `/cloudflare`, `/discord`, `/eia`, `/earthquake`, `/eggs`, `/fdic`, `/fertility`, `/freeappstore`, `/fulllid`, `/kaitomindshare`, `/measles`, `/nbs`, `/ngprice`, `/nytfront`, `/ornnb200`, `/ornnh200`, `/paidappstore`, `/spotifyusa`, `/spotifyglobal`, `/strategybtc`, `/tesla`, `/trumptruth`, `/tsa`, `/wti`, `/xagusd`, `/xauusd`, `/hkprecip`, `/koreaprecip`, `/nycprecip`, or `/seattleprecip` inside their own channels:

- `/bonbast status`
- `/bonbast check`
- `/bonbast test`
- `/bonbast last`
- `/freeappstore snapshot`
- `/paidappstore snapshot`
- `/bonbast clear`
- `/bonbast polymarket url:https://polymarket.com/event/example`
- `/bonbast enddate datetime:2026-05-10 23:59`
- `/bonbast interval minutes:1`
- `/bonbast pause`
- `/bonbast resume`
- `/bot summarize`

Precipitation integrations also support:

- `/hkprecip period year:2026 month:5`
- `/koreaprecip period year:2026 month:5`
- `/nycprecip period year:2026 month:5`
- `/seattleprecip period year:2026 month:5`

Commands are intentionally channel-scoped. Bonbast commands only work in the Bonbast channel.
Command replies and alerts display timestamps in Singapore local time.
Status replies show both the configured base interval and the current effective interval. Dynamic polling integrations also show the current polling mode/reason.
Use `/bot summarize` anywhere in the server to list all integrations with resolution source, Polymarket URL, parsed market end, and polling interval.
Bonbast replies use Discord embeds with compact fields, colored status accents, and clickable links.
Use `/bonbast polymarket` once per market so future alerts include a clickable Polymarket link.
The stored Polymarket URL also drives market-end reminders. The bot reads the market `endDate` from Polymarket Gamma API once per integration/Polymarket URL, stores it locally, and alerts 24 hours before, 12 hours before, 1 hour before, and at the returned end time. If Gamma does not return an `endDate`, the bot sends one warning in that integration channel instead of repeatedly querying Gamma. Use the channel's `enddate` command to manually set the end time in ET, for example `/bonbast enddate datetime:2026-05-10 23:59`.
Use `/bonbast clear` to clear the current integration channel. You and the bot both need `Manage Messages`.
Use `/bonbast test` to preview the exact role ping and alert embed without fetching Bonbast or changing stored values.

Trump Truth and NYT Front Page also support:

- `/trumptruth strikes`
- `/nytfront strikes`

App Store integrations have one extra command:

- `/freeappstore snapshot`
- `/paidappstore snapshot`

The Free App Store and Paid App Store integrations run a separate daily snapshot check during the 12:00-12:05 PM ET window. That snapshot is posted as a distinct snapshot alert, stored in separate SQLite fields, and is not overwritten by regular interval checks. The next ET day noon snapshot replaces the previous stored snapshot.

## Alert Roles

The bot creates `#market-alert-roles` and posts one reaction selector per integration. React to the integration emoji to receive that alert role; remove the reaction to opt out. Bonbast uses `💱` and the `Bonbast Alerts` role. When Bonbast changes, alert messages mention that role before the embed.

Free App Store uses `ðŸ†“` and the `Free App Store Alerts` role. Paid App Store uses `ðŸ’°` and the `Paid App Store Alerts` role. HKO Hong Kong uses `â˜”` and the `HKO Hong Kong Precip Alerts` role. Kaito mindshare uses `🧠` and the `Kaito Mindshare Alerts` role. KMA uses `â˜”` and the `KMA Seoul Precip Alerts` role. NOAA NYC uses `â˜”` and the `NOAA NYC Precip Alerts` role. NOAA Seattle uses `â˜”` and the `NOAA Seattle Precip Alerts` role. All-In uses `ðŸŽ§` and the `All-In Podcast Alerts` role. Arena AI uses `🤖` and the `Arena AI Alerts` role. AWS uses `⚠` and the `AWS Disrupted Alerts` role. Based Revenue uses `💵` and the `Based Revenue Alerts` role. BEA uses `ðŸ“°` and the `BEA Release Alerts` role. BLS CPI uses `ðŸ“ˆ` and the `BLS CPI Release Alerts` role. CDC fertility uses `👶` and the `CDC Fertility Alerts` role. Cloudflare uses `🔴` and the `Cloudflare Critical Alerts` role. Discord uses `🔴` and the `Discord Critical Alerts` role. EIA uses `⛽` and the `EIA Crude SPR Alerts` role. FDIC uses `??` and the `FDIC Failed Bank Alerts` role. FRED eggs uses `🥚` and the `FRED Egg Price Alerts` role. FRED beef uses `🥩` and the `FRED Ground Beef Alerts` role. NBS uses `🇨🇳` and the `NBS Press Release Alerts` role. Pyth Natural Gas uses `⛽` and the `NG Price Alerts` role. Pyth WTI uses `🛢️` and the `WTI Price Alerts` role. Pyth XAGUSD uses `🥈` and the `XAGUSD Price Alerts` role. Pyth XAUUSD uses `🥇` and the `XAUUSD Price Alerts` role. ORNN B200 uses `🖥️` and the `ORNN B200 Alerts` role. ORNN H200 uses `🖥️` and the `ORNN H200 Alerts` role. Tesla uses `🚗` and the `Tesla Deliveries Alerts` role. TSA uses `✈️` and the `TSA Passenger Alerts` role. USGS earthquakes uses `🌎` and the `USGS Earthquake Alerts` role. White House Full Lid uses `🧢` and the `White House Lid Alerts` role. AAA gas uses its own adapter-defined role and emoji.

## Integration Pattern

- Add integrations as adapters in `src/integrations/`; keep scraping and parsing logic inside the adapter.
- Register adapters in `src/integrations/registry.ts`; each adapter must define `id`, `commandName`, `displayName`, `sourceUrl`, `defaultChannelName`, `alertRoleName`, `alertRoleEmoji`, and `fetchCurrentValue`.
- Keep `defaultChannelName` synchronized with `commandName` when practical; if exact matching is too long, the channel name must still clearly indicate the slash command.
- Return normalized string values plus `observedAt`; store timestamps as ISO strings and format them only in Discord output.
- Auto-parsed strike integrations must ignore resolved markets, including Gamma markets marked `closed`, `archived`, inactive, or outcome prices already resolved to `1/0`.
- Use `defaultSettings` and `supportsPeriod` for month/year-driven sources; keep settings in adapter-owned JSON rather than one-off tables.
- Use the shared command set and embeds; do not create one-off Discord UI per integration.
- Do not add integration-specific command handlers unless the shared command model cannot express the behavior.
- Add focused tests for parser extraction, adapter registry metadata, command registration, and embed output.
- Keep links in this exact embed field format:

  ```text
  Resolution: <resolution-url>
  Polymarket: <polymarket-url-or-not-set>
  ```

## Development

- Add new websites under `src/integrations/`.
- EIA monitors weekly SPR crude oil reserve stocks; it polls hourly except on Tuesday/Wednesday ET, when it polls every minute around the normal release window.
- FRED eggs monitors April 2026 egg-price data; it polls hourly except on the day before and day of the parsed next release date, when it polls every minute.
- FRED beef monitors the latest 2026 ground beef price; it polls hourly except on the day before and day of the parsed next release date, when it polls every minute.
- FDIC monitors the latest failed-bank table row; changes to that row trigger the normal value-change alert.
- Kaito mindshare monitors a configured Kaito Historical Data JSON/API endpoint for finalized Polymarket mindshare rows because the public Kaito page is Cloudflare-protected from direct bot scraping.
- ORNN B200 and H200 monitor the dashboard's GPU index-history API and use the second latest point as finalized because daily values finalize after the following day's point is published.
- Pyth Natural Gas, WTI, XAGUSD, and XAUUSD parse only unresolved strike prices from the active Polymarket URL, check only the configured top stable Pyth feed, store the latest observed price, and alert only when the live 1-minute candle range crosses a strike from the previously stored price.
- AWS monitors the public AWS Health Dashboard history events JSON and treats status code `3` as the disrupted severity classification.
- CDC fertility monitors the natality dashboard CSV for the 2026 Q1 general fertility rate row.
- Cloudflare monitors the official Statuspage incidents API and returns a stable no-critical value unless a Critical/red incident appears.
- Discord monitors the official Statuspage incidents API and filters Critical/red incidents to the 2026 May 31 market window.
- USGS earthquakes monitors the official USGS event API for the latest 5.5+ earthquake in the May 4-May 10 market window.
- White House Full Lid monitors Roll Call's Factba.se calendar and Forth's WH pool page for today's ET full lid; it polls every minute during 8:00 AM-8:30 PM ET and hourly off-hours.
- Register new adapters in `src/integrations/registry.ts`.
- Give each adapter a unique `commandName` for its slash command.
- Give each adapter a unique `alertRoleName` and `alertRoleEmoji`.
- Keep scraping logic isolated in adapters.
- Use simple HTTP parsing first; add browser automation later only for JavaScript-rendered sources.
- Free and Paid App Store integrations monitor Apple's US iPhone chart feeds and compare the top 2 list; both capture separate 12:00 PM ET daily snapshots via snapshot storage fields.
- Spotify USA and Spotify Global monitor public Spotify Top 50 playlist pages and store the #1 track plus primary artist profile names.
- Arena AI monitors the server-rendered no-style-control leaderboard and stores only the top 3 model names/ranks so score/vote movements do not trigger alerts.
- Tesla deliveries monitors Tesla production and delivery press releases through the matching official SEC 8-K exhibit because direct local requests to `ir.tesla.com/press` are Akamai-blocked.
- Trump Truth uses the reachable `https://www.trumpstruth.org/feed` archive feed because direct Truth Social access is Cloudflare-blocked locally; alerts include original Truth Social URLs and an Open Truth link button for verification.
- Trump Truth parses weekly Polymarket strike terms into `settingsJson`, stores the latest seen Truth Social post ID in `lastValue`, and checks archive image descriptions, alt text, and basic OCR output for image-only strike review.
- TSA passengers parses the date range from the current Polymarket URL slug and sums official TSA daily checkpoint throughput rows for that range.

## Validation

```powershell
npm test
npm run build
```


