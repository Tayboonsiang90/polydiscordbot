# Polymarket Resolution Monitor Bot

Local Discord bot for monitoring Polymarket resolution-source websites and posting alerts when tracked values change.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): runtime flow, ownership boundaries, state rules, and validation.
- [Raspberry Pi operations](docs/OPERATIONS.md): deployment, watchdog, health checks, and Linux troubleshooting commands.
- This README: current integrations, setup, commands, and adapter-specific behavior.

## Current Scope

- Discord slash commands only.
- One base channel per website integration, with adapter-owned extra channels only where explicitly documented.
- Local SQLite persistence.
- Polling and Discord alerts only.
- Integration channels are auto-created from registered adapters.
- Alert roles are auto-created from Discord channel categories for non-UMA integrations; UMA integrations keep their individual UMA alert roles.
- Current adapters include Bonbast USD/IRR, AAA Regular Gas, AirNow PM2.5 AQI monitors, All-In Podcast, Big Brother Episodes, Aligned Layer Sale, Artist Album Releases, Artist Song Releases, Arena AI leaderboard monitors, AWS Disrupted Events, Bank of Israel Decision, Based Revenue, BEA Current Releases, Bank Indonesia JISDOR USD/IDR, Billboard 200 #1 Album, Billboard Hot 100 #1 Song, BLS CPI Releases, BLS Jobs Added, Box Office Weekends, CDC Cyclosporiasis Cases, CDC General Fertility Rate, CDC Flu Hospitalization Rate, CDC Measles Cases, Census Durable Goods Orders, ChatGPT Outage Days, Claude Code Commits, Claude Code 7D Avg, Claude Downtime Days, Cloudflare Critical Incidents, Cloudflare Cuba Outage, CompaniesMarketCap Top 10, Discord Critical Incidents, ECDSA.fail Quantum Benchmark, EIA Crude Oil SPR Stocks, Ethereum Monthly Gas, Elon X Posts, FDIC Failed Bank List, FRED Egg Price, FRED Ground Beef Price, FrontierMath Open Problems, Free App Store Top 5, Paid App Store Top 5, Paris Heat Wave, Poker 2026 Money List, Joe Rogan Podcast, Justin Bieber Monthly Listeners, JMA Typhoon Dolphin, Lemonade Stand Podcast, MetaDAO Credible Fundraise, Netflix Top 10, Parcl DC Metro Home Value, Parcl NYC Home Value, PBoC Rate Change, PortWatch Bab el-Mandeb Arrivals, Powerball Jackpot, Pump.fun GO, Polymarket Mention Markets, Polymarket Mentions Schedule, Polymarket Status, Reserve Bank of New Zealand Decision, Rotten Tomatoes Scores, Strategy STRC Market Cap, TicketData World Cup Final Ticket Price, UMA Clarification Alerts, UMA Proposal Alerts, UMA Vote Commits, UMA Vote Reveals, UMA.rocks, ISM Services PMI, ISW Ukraine Map, Kaito Polymarket Mindshare, KPop Song Releases, Met Office London Precipitation, Mt. Washington Wind Speed, MrBeast Gaming Videos, MrBeast YouTube Subscribers, MrBeast YouTube Views, NASA GISTEMP Temperature, NBS Press Releases, NCEI U.S. Tornadoes, NSIDC Arctic Sea Ice, NYT Front Page, NPM private valuation monitors, NOAA daily rain cities, ORNN B200 Index, ORNN H100 Index, ORNN H200 Index, Pyth Natural Gas Strikes, Pyth WTI Strikes, Pyth XAGUSD Strikes, Pyth XAUUSD Strikes, Silver Trump Approval, Spider-Man Trailer, Spotify Top 50 USA, Spotify Top 50 Global, Spotify Top Artist Monthly, Strategy Bitcoin Purchases, Tesla Deliveries, Treasury MTS Deficit, Trump Getty Photos, Trump Schedule, Trump Truth Social, TSA Passenger Volumes, UFO Files, UMich Consumer Sentiment, USGS 5.5+ Earthquakes, USGS 6.5+ Earthquakes, USGS 7.0+ Earthquakes, USGS 7.0+ Earthquakes 2026, Volmex BVIV Strikes, Volmex EVIV Strikes, White House Alien Arrests NYC, White House Briefings, White House Full Lid, White House Pool Updates, White House X Posts, HKO Hong Kong Precipitation, KMA Seoul Precipitation, NOAA NYC Precipitation, NOAA Seattle Precipitation, and $YO Transferability.

## Current Integrations

| Adapter ID | Command | Channel | Alert Role | Emoji | Description |
| --- | --- | --- | --- | --- | --- |
| `bonbast-usd-irr` | `/monitor` | `#bonbast-usd-irr` | `Bonbast Alerts` | `💱` | Converts Bonbast's published toman rate to IRR, distinguishes provisional from finalized daily values, and auto-discovers active hit-by and end-of-month markets. |
| `cross-platform-arbitrage` | `/monitor` | `#arb` | `Arbitrage Alerts` | `🔁` | Monitors configured Polymarket, Predict, and Opinion market URLs for after-fee cross-platform arbitrage routes. |
| `aaa-regular-gas` | `/monitor` | `#aaa-regular-gas` | `AAA Gas Alerts` | `⛽` | Monitors AAA national Current Avg. Regular gas, alerts on market-rule two-decimal changes even during monthly rollover, and auto-discovers monthly markets. |
| `all-in-podcast` | `/monitor` | `#allinpod` | `All-In Podcast Alerts` | `🎧` | Monitors the All-In YouTube channel feed every minute for new non-Shorts uploads, suppresses same-video source-format flips, and auto-discovers active weekly All-In Polymarket markets. |
| `big-brother-episodes` | `/monitor` | `#bigbrother` | `Big Brother Alerts` | `🏠` | Monitors the CBS Big Brother show page every minute and alerts when the latest full episode URL changes. |
| `joe-rogan-podcast` | `/monitor` | `#joerogan` | `Joe Rogan Alerts` | `🎤` | Monitors the Joe Rogan YouTube RSS feed every minute for new JRE uploads and auto-discovers weekly first-episode Polymarket markets. |
| `lemonade-stand-podcast` | `/monitor` | `#lemonade` | `Lemonade Stand Alerts` | `🍋` | Monitors Lemonade Stand every minute for qualifying uploads, falls back to the official YouTube channel/watch pages when RSS is unavailable, and auto-discovers weekly Polymarket markets. |
| `aligned-layer-sale` | `/monitor` | `#alignedsale` | `Aligned Sale Alerts` | `⏸️` | Temporary monitor for sale.alignedlayer.com page and app-bundle changes while the token sale is on hold. |
| `airnow-chicago-aqi` | `/monitor` | `#chicagoaqi` | `Chicago AQI Alerts` | `🌫️` | Monitors AirNow finalized Chicago Daily AQI for PM2.5 rows for the July 17-21 below-100 markets. |
| `airnow-columbus-aqi` | `/monitor` | `#columbusaqi` | `Columbus AQI Alerts` | `🌫️` | Monitors AirNow finalized Columbus Daily AQI for PM2.5 rows for the July 17-21 below-100 markets. |
| `airnow-nyc-aqi` | `/monitor` | `#nycaqi` | `NYC AQI Alerts` | `🌫️` | Monitors AirNow finalized New York City Region Daily AQI for PM2.5 rows for the July 17-21 below-100 markets. |
| `airnow-philadelphia-aqi` | `/monitor` | `#phillyaqi` | `Philadelphia AQI Alerts` | `🌫️` | Monitors AirNow finalized Philadelphia Daily AQI for PM2.5 rows for the July 17-21 below-100 markets. |
| `airnow-stadium-aqi` | `/monitor` | `#stadiumaqi` | `Stadium AQI Alerts` | `🌫️` | Monitors AirNow East Rutherford current PM2.5 AQI near MetLife Stadium, alerts on current source updates before/during the final, and tracks the in-window high-water mark. |
| `apple-artist-song-releases` | `/monitor` | `#songreleases` | `Artist Song Release Alerts` | `🎶` | Monitors Apple Music/iTunes for candidate 2026 songs by unresolved artists, excluding obvious remixes, reissues, and alternate versions. |
| `apple-artist-album-releases` | `/monitor` | `#albumreleases` | `Artist Album Release Alerts` | `💿` | Monitors Apple Music/iTunes for new 2026 albums by unresolved artists parsed from the Polymarket market. |
| `arena-ai-no-style-control` | `/monitor` | `#arenaai` | `Arena AI Alerts` | `🤖` | Monitors the top 3 models and distinct companies on Arena AI's overall no-style-control leaderboard and auto-discovers recurring matching markets. |
| `arena-ai-style-control-on` | `/monitor` | `#arenaaistyle` | `Arena Style Alerts` | `🤖` | Monitors the top 3 models and distinct companies on Arena AI's style-control-on leaderboard and auto-discovers recurring matching markets. |
| `arena-ai-math` | `/monitor` | `#arenaaimath` | `Arena Math Alerts` | `🧮` | Monitors the top 3 models and distinct companies on Arena AI's Text Arena Math leaderboard and auto-discovers recurring matching markets. |
| `arena-ai-code-webdev` | `/monitor` | `#arenawebdev` | `Arena WebDev Alerts` | `💻` | Monitors the top 3 models and distinct companies on Code Arena WebDev and auto-discovers recurring first/second/third-place markets. |
| `arena-ai-text-to-image` | `/monitor` | `#arenaimage` | `Arena Image Alerts` | `🎨` | Monitors the top 3 models and distinct companies on Arena AI's Text-to-Image leaderboard and auto-discovers recurring matching markets. |
| `arena-ai-text-to-video` | `/monitor` | `#arenavideo` | `Arena Video Alerts` | `🎬` | Monitors the top 3 models and distinct companies on Arena AI's Text-to-Video leaderboard and auto-discovers recurring matching markets. |
| `arena-ai-chinese-company` | `/monitor` | `#arenachina` | `Arena China Alerts` | `🇨🇳` | Monitors the top 3 qualifying Chinese-company models/companies and auto-discovers recurring Chinese-company markets. |
| `aws-disrupted-events` | `/monitor` | `#aws-disrupted` | `AWS Disrupted Alerts` | `⚠` | Monitors all publicly visible AWS Health Dashboard events classified as disrupted, even after the original market expires. |
| `bank-of-israel-decision` | `/monitor` | `#boidecision` | `Bank of Israel Alerts` | `🇮🇱` | Reads the official BOI `GetInterest` API, polls fast around scheduled publication dates, and auto-discovers monthly BOI decision markets. |
| `reserve-bank-new-zealand-decision` | `/monitor` | `#rbnzdecision` | `RBNZ Decision Alerts` | `🇳🇿` | Monitors official RBNZ OCR decision data, polls fast around scheduled OCR update dates, and auto-discovers monthly RBNZ decision markets. |
| `based-revenue` | `/monitor` | `#basedrevenue` | `Based Revenue Alerts` | `💵` | Monitors Dune query results for Based cumulative revenue updates. |
| `bea-current-releases` | `/monitor` | `#bea-releases` | `BEA Release Alerts` | `📰` | Monitors BEA Current Releases hourly and puts the new article title, date, and direct link first. |
| `bi-jisdor-usd-idr` | `/monitor` | `#jisdor` | `BI JISDOR Alerts` | `🇮🇩` | Monitors Bank Indonesia JISDOR USD/IDR reference rates for Polymarket resolution checks. |
| `billboard-200-number-one-album` | `/monitor` | `#billboard200` | `Billboard 200 Alerts` | `💿` | Monitors the dated Billboard 200 chart for the #1 album and auto-discovers weekly chart markets. |
| `billboard-hot-100-number-one-song` | `/monitor` | `#billboardhot100` | `Billboard Hot 100 Alerts` | `🎵` | Monitors the dated Billboard Hot 100 chart for the #1 song and auto-discovers weekly chart markets. |
| `bls-cpi-releases` | `/monitor` | `#blscpi-releases` | `BLS CPI Release Alerts` | `📈` | Monitors BLS CPI archived releases hourly and puts the new release title and direct link first. |
| `bls-jobs-added` | `/monitor` | `#jobsadded` | `BLS Jobs Added Alerts` | `💼` | Monitors BLS Employment Situation total nonfarm payroll employment change and auto-discovers monthly jobs-added markets. |
| `box-office-weekends` | `/monitor` | `#boxoffice` | `Box Office Alerts` | `🎬` | Monitors all active Polymarket weekend box-office markets in one channel, sums The Numbers daily domestic weekend rows, includes opening previews, uses BoxOfficeMojo as secondary context, auto-discovers new markets, and alerts only when a final bondable bracket appears or changes. |
| `cdc-cyclosporiasis` | `/monitor` | `#cyclosporiasis` | `CDC Cyclosporiasis Alerts` | `🧪` | Monitors CDC's confirmed domestically acquired U.S. cyclosporiasis cases since May 1, 2026 and auto-discovers concurrent active cyclosporiasis markets. |
| `cdc-fertility-rate` | `/monitor` | `#fertility` | `CDC Fertility Alerts` | `👶` | Monitors the CDC 2026 Q1 general fertility rate and states the market result against the 2025 Q4 reference. |
| `cdc-flu-hospitalization` | `/monitor` | `#fluhosp` | `CDC Flu Hosp Alerts` | `🏥` | Monitors the CDC FluSurv-NET weekly hospitalization rate required by current markets, polls every minute during release windows, and auto-discovers weekly markets. |
| `cdc-measles` | `/monitor` | `#measles` | `CDC Measles Alerts` | `🦠` | Monitors CDC's 2026 confirmed U.S. measles total cases counter and auto-discovers concurrent active measles markets. |
| `census-durable-goods` | `/monitor` | `#durablegoods` | `Durable Goods Alerts` | `🏭` | Monitors the Census Advance Durable Goods May 2026 MoM new orders report and only polls fast on release day. |
| `openai-chatgpt-outages` | `/monitor` | `#chatgptoutage` | `ChatGPT Outage Alerts` | `🟠` | Monitors OpenAI Status for resolved ChatGPT partial/full outage days, sends one daily report for each completed ET day, shows all partial/full outages for manual review, and auto-discovers monthly outage markets. |
| `claude-code-commits` | `/monitor` | `#claudecommits` | `Claude Commits Alerts` | `💻` | Monitors Claude Code Commits Tracker daily data, continues reporting without an active strike market, and alerts once when configured unresolved targets are hit. |
| `claude-code-commits-average` | `/monitor` | `#claudeavg` | `Claude Avg Alerts` | `📈` | Monitors Claude Code Commits Tracker 7D Avg Commits for the end-of-June bracket market, with final-window worst-case analysis. |
| `claude-downtime` | `/monitor` | `#claudedown` | `Claude Downtime Alerts` | `🔴` | Monitors finalized non-green claude.ai uptime boxes, sends one daily report, and auto-discovers recurring monthly downtime markets. |
| `cloudflare-cuba-outage` | `/monitor` | `#cubaoutage` | `Cuba Outage Alerts` | `🇨🇺` | Monitors Cloudflare Radar Cuba outage annotations every minute and alerts when a qualifying nationwide internet outage caused by power outage appears. |
| `cloudflare-critical-incidents` | `/monitor` | `#cloudflare-critical` | `Cloudflare Critical Alerts` | `🔴` | Monitors Cloudflare's official incidents API for Critical/red incidents. |
| `companies-market-cap-top10` | `/monitor` | `#companyrank` | `Company Rank Alerts` | `🏢` | Monitors CompaniesMarketCap's CSV top 10 companies by market cap and alerts only when the top-10 company rank order changes for the largest/2nd/3rd end-of-August markets. |
| `discord-critical-incidents` | `/monitor` | `#discord-critical` | `Discord Critical Alerts` | `🔴` | Monitors Discord's official incidents API for Critical/red incidents and auto-discovers monthly by-date markets. |
| `ecdsa-fail` | `/monitor` | `#ecdsafail` | `ECDSA Fail Alerts` | `🔐` | Monitors ECDSA.fail benchmark API for the percent ahead of Google's classified circuit. |
| `eia-crude-spr` | `/monitor` | `#eia-crude-spr` | `EIA Crude SPR Alerts` | `⛽` | Monitors EIA weekly SPR stocks with million-barrel totals/change, release timing, and recurring market auto-discovery. |
| `ethereum-gas-monthly-average` | `/monitor` | `#ethgasmonthly` | `ETH Gas Monthly Alerts` | `⛽` | Monitors Dune Ethereum Gas Prices query 1887488 for the latest finalized monthly `mean_gas` value. |
| `elon-x-strikes` | `/monitor` | `#elonx` | `Elon X Alerts` | `🚀` | Monitors full-text @elonmusk posts/replies through optional direct X session search, with merged XTracker/XCancel/Nitter fallbacks, and parses weekly Polymarket strike terms. |
| `fdic-failed-banks` | `/monitor` | `#fdic-failed-banks` | `FDIC Failed Bank Alerts` | `🏦` | Monitors the latest row in the FDIC Failed Bank List for new bank failures and auto-discovers active bank-failure Polymarket markets. |
| `fred-egg-price` | `/monitor` | `#eggs` | `FRED Egg Price Alerts` | `🥚` | Monitors monthly FRED Eggs, Grade A, Large cost per dozen, auto-discovers monthly egg-price markets, and uses release-date polling. |
| `fred-ground-beef` | `/monitor` | `#beef` | `FRED Ground Beef Alerts` | `🥩` | Monitors FRED 2026 Ground beef, 100% beef cost per pound and release-date polling. |
| `frontiermath-open-problems` | `/monitor` | `#frontiermath-solved` | `FrontierMath Solved Alerts` | `🧮` | Checks Epoch AI's FrontierMath Open Problems page every five minutes and alerts only when a solved problem beyond the two market-issuance baseline problems appears. |
| `free-app-store` | `/monitor` | `#freeappstore` | `Free App Store Alerts` | `🆓` | Shows the US iPhone App Store Top Free Apps top 5, alerts only when the top 2 change, and auto-discovers daily #1/#2 Free App Store markets. |
| `nbs-press-release` | `/monitor` | `#nbs-press` | `NBS Press Release Alerts` | `🇨🇳` | Monitors China NBS English press releases hourly and alerts when the latest item changes. |
| `ornn-b200-index` | `/monitor` | `#ornnb200` | `ORNN B200 Alerts` | `🖥️` | Monitors finalized ORNN B200 Index daily chart values and auto-discovers concurrent active B200 GPU rental-price markets. |
| `ornn-h100-index` | `/monitor` | `#ornnh100` | `ORNN H100 Alerts` | `🖥️` | Monitors finalized ORNN H100 Index daily chart values and auto-discovers concurrent active H100 GPU rental-price markets. |
| `ornn-h200-index` | `/monitor` | `#ornnh200` | `ORNN H200 Alerts` | `🖥️` | Monitors finalized ORNN H200 Index daily chart values and auto-discovers concurrent active H200 GPU rental-price markets. |
| `paid-app-store` | `/monitor` | `#paidappstore` | `Paid App Store Alerts` | `💰` | Shows the US iPhone App Store Top Paid Apps top 5, alerts only when the top 2 change, and auto-discovers daily Paid App Store markets. |
| `paris-heat-wave` | `/monitor` | `#parisheat` | `Paris Heat Alerts` | `🌡️` | Monitors Wunderground Paris-Le Bourget daily highs, chunks Weather.com history requests at its 31-day limit, and alerts when qualifying >=35°C days or the 3-day streak status changes. |
| `hendon-mob-money-list` | `/monitor` | `#pokermoney` | `Poker Money List Alerts` | `🃏` | Monitors The Hendon Mob 2026 Money List hourly, supports optional browser-session cookie/UA when Cloudflare blocks direct fetches, and alerts only when the top 3 rank order changes. |
| `parcl-dc-home-value` | `/monitor` | `#dchomevalue` | `DC Home Value Alerts` | `🏠` | Auto-discovers DC Metro markets, derives the target date from the active URL, and calculates the 1,800 sqft settlement from Parcl ID 2900475. |
| `parcl-nyc-home-value` | `/monitor` | `#nychomevalue` | `NYC Home Value Alerts` | `🏙️` | Auto-discovers NYC markets, derives the target date from the active URL, and calculates the 1,000 sqft settlement from Parcl ID 5372594. |
| `pboc-rate-change` | `/monitor` | `#pboc` | `PBoC Rate Alerts` | `🏦` | Monitors official PBoC operation-rate announcements and auto-discovers active PBoC rate-change markets. |
| `powerball-jackpot` | `/monitor` | `#powerball` | `Powerball Jackpot Alerts` | `🎰` | Monitors Powerball's official estimated jackpot once daily for the $1B July 31 market trend; alerts surface jackpot, target progress, cash value, and next drawing in the quick read. |
| `pump-fun-buybacks` | `/monitor` | `#pumpbuybacks` | `Pump Buyback Alerts` | `💚` | Monitors the official Pump.fun Total $PUMP Purchases (USD) tracker hourly, sends one finalized daily update, and alerts on the next check if cumulative buybacks cross $500M. |
| `pump-fun-go` | `/monitor` | `#pumpgo` | `Pump GO Alerts` | `🏁` | Monitors pump.fun GO page and public bounties API every minute, alerting only when GO availability status changes for the Predict.fun disable market. |
| `rwa-total-value` | `/monitor` | `#rwatotal` | `RWA Total Value Alerts` | `🏦` | Monitors finalized RWA.xyz daily values hourly, shows the newest point separately as provisional, and includes 7d/30d rate analysis. |
| `rotten-tomatoes-scores` | `/monitor` | `#rottentomatoes` | `Rotten Tomatoes Alerts` | `🍅` | Monitors all active Polymarket Rotten Tomatoes score markets in one channel, checks exact movie Tomatometer scores, and alerts only when a score enters a new 5-point bucket. |
| `polymarket-mention-markets` | `/monitor` | `#mentions` | `Polymarket Mentions Alerts` | `💬` | Alerts when a new active Polymarket event appears under the Mentions tag. |
| `polymarket-mention-schedule` | `/monitor` | `#mentions-schedule` | `Polymarket Mentions Schedule Alerts` | `🗓️` | Sends one daily 6:00 PM SGT briefing covering Mentions markets scheduled in the following 24 hours, using rule timezones when shown and Polymarket card times as UTC fallback. |
| `polymarket-status` | `/monitor` | `#polymarketstatus` | `Polymarket Status Alerts` | `🟣` | Monitors the official Polymarket status page every minute and alerts when page status, component status, or active maintenances change. |
| `polymarket-clarifications` | `/umaclarifications` | `#uma-clarifications` | `UMA Clarification Alerts` | `📣` | Alerts on Polymarket UMA bulletin-board clarification updates on Polygon. |
| `polymarket-disputes` | `/umadispute` | `#uma-disputes` | `UMA Dispute Alerts` | `⚖️` | Alerts when Polymarket UMA resolution proposals are disputed on-chain. |
| `polymarket-proposals` | `/umaproposals` | `#uma-proposals` | `UMA Proposal Alerts` | `📨` | Alerts when Polymarket UMA resolution proposals open on-chain for configured Polymarket tags. |
| `polymarket-resolvable` | `/monitor` | `#uma-resolvable` | `Resolvable Alerts` | `✅` | Watches manually added Polymarket URLs or raw question IDs until the market is ready to resolve or already resolved on CTF, then alerts and removes the market. |
| `portwatch-bab-el-mandeb` | `/monitor` | `#babmandeb` | `Bab el-Mandeb Alerts` | `🚢` | Monitors IMF PortWatch Bab el-Mandeb Arrivals of Ships data every minute with latest 14 daily values, moving averages, and optional MarineTraffic alpha context. |
| `portwatch-hormuz-ships` | `/monitor` | `#hormuzships` | `Hormuz Ships Alerts` | `🚢` | Monitors IMF Portwatch Strait of Hormuz transit-call data every minute, reports total and average calls, optional MarineTraffic alpha context, and auto-discovers weekly ships markets. |
| `uma-vote-commits` | `/umacommits` | `#uma-commits` | `UMA Commit Alerts` | `🔒` | Alerts when Ethereum UMA Voting v2 commit or recommit events come from voters above the configured staked UMA threshold. |
| `uma-vote-reveals` | `/umareveals` | `#uma-reveals` | `UMA Reveal Alerts` | `👁️` | Alerts when Ethereum UMA Voting v2 reveal events meet the configured staked UMA threshold. |
| `uma-voting-committee` | `/umarocks` | `#uma-rocks-votes` | `UMA.rocks Alerts` | `🗳️` | Monitors recent UMA.rocks voting committee GitHub rounds every 10 minutes, alerts when each two-day voting request PR appears, and catches answer changes or comments even after a PR has merged. |
| `pyth-natural-gas-strikes` | `/monitor` | `#ngprice` | `NG Price Alerts` | `⛽` | Monitors the top Pyth Natural Gas ticker, respects HIGH/LOW strike direction, alerts once per crossing, and auto-discovers monthly NG markets. |
| `pyth-wti-strikes` | `/monitor` | `#wti` | `WTI Price Alerts` | `🛢️` | Monitors the top Pyth WTI ticker, respects HIGH/LOW strike direction, alerts once per crossing, and auto-discovers monthly WTI markets. |
| `pyth-xagusd-strikes` | `/monitor` | `#xagusd` | `XAGUSD Price Alerts` | `🥈` | Monitors Pyth XAGUSD, respects HIGH/LOW strike direction, alerts once per crossing, and auto-discovers monthly silver markets. |
| `pyth-xauusd-strikes` | `/monitor` | `#xauusd` | `XAUUSD Price Alerts` | `🥇` | Monitors Pyth XAUUSD, respects HIGH/LOW strike direction, alerts once per crossing, and auto-discovers monthly gold markets. |
| `silver-trump-approval` | `/monitor` | `#trumpapproval` | `Trump Approval Alerts` | `📊` | Monitors Silver Bulletin's Trump approval trend-line data, prefers the latest versioned Datawrapper dataset, auto-discovers overlapping single-date and weekly Up/Down markets, alerts on finalized results, and tracks real approval revisions while ignoring disapproval-only jitter. |
| `spotify-bieber-monthly-listeners` | `/monitor` | `#bieberlisteners` | `Bieber Listeners Alerts` | `🎧` | Monitors Justin Bieber's public Spotify artist profile monthly-listener count and parsed hit-by thresholds from the active Polymarket market. |
| `spotify-top-artist-monthly` | `/monitor` | `#spotifytopartist` | `Spotify Top Artist Alerts` | `🎧` | Monitors Kworb's Spotify monthly-listener ranking for active listed artists in Top Artist monthly markets, keeps Spotify as the resolution source, and auto-discovers recurring monthly markets. |
| `spider-man-trailer` | `/monitor` | `#spiderman` | `Spider-Man Trailer Alerts` | `🕷️` | Monitors Spider-Man, Sony Pictures, Marvel, and Sony YouTube RSS feeds every minute for post-market Spider-Man: Brand New Day trailer/teaser uploads. |
| `spotify-top-50-usa` | `/monitor` | `#spotifyusa` | `Spotify USA Top 50 Alerts` | `🎵` | Shows Kworb's USA daily top 10 with ranking links and auto-discovers monthly artist plus weekly US #1/#2 song markets. |
| `spotify-top-50-global` | `/monitor` | `#spotifyglobal` | `Spotify Global Top 50 Alerts` | `🎵` | Shows Kworb's Global daily top 10 with ranking links and auto-discovers monthly artist plus weekly global #1/#2 song markets. |
| `strategy-bitcoin-purchases` | `/monitor` | `#strategybtc` | `Strategy BTC Alerts` | `🪙` | Monitors Strategy's Bitcoin Purchases page for announcements in the active weekly Polymarket date range and auto-discovers new weekly markets. |
| `strategy-strc-market-cap` | `/monitor` | `#strcmarketcap` | `STRC Market Cap Alerts` | `📈` | Polls Strategy's official STRC Market Cap ($M) feed every 15 seconds, alerts whenever the reported value changes, and highlights newly reached Polymarket thresholds. |
| `tesla-deliveries` | `/monitor` | `#tesla` | `Tesla Deliveries Alerts` | `🚗` | Monitors Tesla production and deliveries releases, showing the delivery count and direct press/SEC links first. |
| `ticketdata-world-cup-final` | `/monitor` | `#wcticket` | `World Cup Ticket Alerts` | `🎟️` | Monitors TicketData event 855416 for the World Cup Final get-in price, alerts on bracket crossings, and sends a final-price alert when `Final Get-In Price` appears. |
| `treasury-mts-deficit` | `/monitor` | `#treasurymts` | `Treasury MTS Alerts` | `🧾` | Monitors FiscalData Monthly Treasury Statement table 1 current-month deficit/surplus rows and alerts when a new report month or amount appears. |
| `trump-getty-photos` | `/monitor` | `#trumpgetty` | `Trump Getty Alerts` | `📸` | Monitors Getty tagged editorial Donald Trump photo coverage by day using the public Getty search page reader fallback. |
| `trump-schedule` | `/monitor` | `#trumpschedule` | `Trump Schedule Alerts` | `🗓️` | General Roll Call Factbase daily Trump schedule feed with the next ET item highlighted and no default Polymarket URL. |
| `trump-truth` | `/monitor` | `#trumptruth` | `Trump Truth Alerts` | `📰` | Fast-polls Trump posts every 10 seconds, tries direct Truth Social when a browser-session cookie is configured, falls back to Trump's Truth archive RSS/homepage, and parses weekly Polymarket strike terms. |
| `tsa-passengers` | `/monitor` | `#tsa` | `TSA Passenger Alerts` | `✈️` | Shows the latest TSA daily throughput even without a new market while retaining the parsed market-window sum and auto-discovery. |
| `umich-consumer-sentiment` | `/monitor` | `#umichsentiment` | `UMich Sentiment Alerts` | `📊` | Monitors UMich Surveys of Consumers final monthly Index of Consumer Sentiment, auto-discovers monthly markets, and polls fast around the scheduled release. |
| `ufo-files` | `/monitor` | `#ufofiles` | `UFO Files Alerts` | `🛸` | Monitors official U.S. government UFO/UAP file inventories across NARA, AARO, and FBI sources for added or changed file links. |
| `usgs-earthquakes` | `/monitor` | `#earthquake` | `USGS Earthquake Alerts` | `🌎` | Tracks the USGS count of 5.5+ earthquakes in the active weekly market window and alerts on count increases or revision-driven decreases. |
| `usgs-earthquakes-6-5` | `/monitor` | `#earthquake65` | `USGS 6.5 Earthquake Alerts` | `🌏` | Tracks the USGS count of 6.5+ earthquakes in the active weekly market window and auto-discovers upcoming 6.5 weekly markets. |
| `usgs-earthquakes-7-plus` | `/monitor` | `#earthquake7` | `USGS 7.0 Earthquake Alerts` | `🌋` | Tracks the Dec 4-Jun 30 7.0+ earthquake market and includes the overlapping full-year 2026 count in each alert. |
| `usgs-earthquakes-7-plus-2026` | `/monitor` | `#earthquake2026` | `USGS 2026 Earthquake Alerts` | `📅` | Tracks the full-year 2026 7.0+ earthquake market and includes the overlapping Dec 4-Jun 30 count in each alert. |
| `volmex-bviv-low-strikes` | `/monitor` | `#bviv` | `BVIV Alerts` | `📉` | Auto-discovers BVIV markets and alerts once when any unresolved high or low 1-minute strike is crossed. |
| `volmex-eviv-high-strikes` | `/monitor` | `#eviv` | `EVIV Alerts` | `📈` | Auto-discovers EVIV markets and alerts once when any unresolved high or low 1-minute strike is crossed. |
| `white-house-aliens-nyc` | `/monitor` | `#aliennyc` | `Alien NYC Arrests Alerts` | `🛸` | Monitors the White House aliens table Total Arrests counter for New York, NY. |
| `white-house-briefings` | `/monitor` | `#whbriefings` | `White House Briefing Alerts` | `🏛️` | Monitors White House Briefings & Statements and alerts on every newly listed message. |
| `white-house-full-lid` | `/monitor` | `#fulllid` | `White House Lid Alerts` | `🧢` | Monitors Roll Call and Forth for the first daily White House full lid and labels whether it was before 6:30 PM ET. |
| `white-house-pool-updates` | `/monitor` | `#whpool` | `White House Pool Alerts` | `📰` | Monitors BNO News and best-effort Forth White House Press Pool pages every minute and alerts on each newly listed pool report without a Polymarket URL. |
| `white-house-tweets` | `/monitor` | `#whitehousetweets` | `White House Tweet Alerts` | `🐦` | Uses Polymarket XTracker to count @WhiteHouse posts in overlapping weekly noon-to-noon ET markets, with hourly summary alerts and public-feed fallbacks. |
| `yo-token-transferability` | `/monitor` | `#yo-token` | `YO Token Alerts` | `🔓` | Simulates zero-value `transfer` and `transferFrom` calls on the Base $YO token every minute and alerts only when an arbitrary non-owner can transfer publicly. |
| `hk-precip` | `/monitor` | `#hkprecip` | `HKO Hong Kong Precip Alerts` | `☔` | Monitors HKO monthly rainfall plus 1-minute RF023 Observatory AWS alpha; only non-overlapping top-of-hour buckets are retained and zero reports are ignored. |
| `ism-services-pmi` | `/monitor` | `#ismpmi` | `ISM PMI Alerts` | `📊` | Auto-discovers monthly ISM Services PMI markets, derives the target report and release date, and polls faster around release. |
| `isw-ukraine-map` | `/monitor` | `#iswmap` | `ISW Map Alerts` | `🗺️` | Monitors the ISW ArcGIS StoryMaps Ukraine frontline geometry notice every minute and alerts when the actual notice or map status changes. |
| `jma-typhoon-dolphin` | `/monitor` | `#typhoon-dolphin` | `Typhoon Dolphin Alerts` | `🌀` | Polls JMA's official Dolphin position advisory every minute and alerts on each new or revised analysis, showing center, classification, winds, movement, and the China-landfall rule status. |
| `kaito-polymarket-mindshare` | `/monitor` | `#kaitomindshare` | `Kaito Mindshare Alerts` | `🧠` | Monitors finalized Kaito Info Markets Historical Data rows for Polymarket mindshare. |
| `apple-kpop-song-releases` | `/monitor` | `#kpopreleases` | `KPop Song Release Alerts` | `🎤` | Monitors post-market Apple Music/iTunes candidate songs by unresolved KPop groups, excluding obvious remixes, reissues, and alternate versions. |
| `kma-seoul-precip` | `/monitor` | `#koreaprecip` | `KMA Seoul Precip Alerts` | `☔` | Monitors KMA Seoul station 108 monthly precipitation plus exact-station hourly rainfall; new positive hours alert and zero hours are ignored. |
| `met-office-london-precip` | `/monitor` | `#londonprecip` | `Met Office London Precip Alerts` | `☔` | Monitors Met Office Heathrow rain plus exact-station Infoclimat alpha and hourly alpha from the separate Environment Agency Heathrow Airport gauge 247540TP; no nearby personal-station fallback is used. |
| `metadao-credible-fundraise` | `/monitor` | `#metadao-credible` | `MetaDAO Credible Alerts` | `🏛️` | Monitors the Credible Finance MetaDAO public sale hourly from the visible official fundraise page for total committed USDC and contributor count. |
| `mt-washington-wind` | `/monitor` | `#mtwind` | `Mt Washington Wind Alerts` | `💨` | Auto-discovers monthly Mt. Washington wind-speed markets and monitors the matching Observatory F6 PDF for the monthly high, newest daily wind speed, and revisions to any parsed daily wind row, using the FASTEST MILE / peak gust column. |
| `mrbeast-gaming-video` | `/monitor` | `#mrbeastgaming` | `MrBeast Gaming Alerts` | `🎮` | Monitors the MrBeast Gaming YouTube RSS feed every minute for new uploads tied to the next-gaming-video Polymarket market. |
| `mrbeast-subscribers` | `/monitor` | `#mrbeastsubs` | `MrBeast Subs Alerts` | `👥` | Polls MrBeast YouTube channel subscriber metadata every minute with rate/target projections and auto-discovers recurring subscriber-target markets. |
| `mrbeast-views` | `/monitor` | `#mrbeastviews` | `MrBeast Views Alerts` | `👀` | Polls MrBeast YouTube channel total-view metadata every minute, auto-discovers active billion-view markets, and shows compact target summaries. |
| `nasa-gistemp-temperature` | `/monitor` | `#gistemp` | `NASA GISTEMP Alerts` | `🌡️` | Monitors NASA GISTEMP Global Land-Ocean Temperature Index monthly anomaly cells. |
| `netflix-top-10` | `/monitor` | `#netflix` | `Netflix Top 10 Alerts` | `🍿` | Monitors Netflix official Top 10 pages for US/global TV and film rankings, displays #1/#2 and top 10 context, and auto-discovers weekly Netflix Polymarket markets. |
| `noaa-atlanta-rain` | `/monitor` | `#atlantarain` | `NOAA Atlanta Rain Alerts` | `☔` | Monitors NOAA Atlanta Area daily precipitation for the June 9 rain market and alerts when the value finalizes. |
| `noaa-boston-rain` | `/monitor` | `#bostonrain` | `NOAA Boston Rain Alerts` | `☔` | Monitors NOAA Boston Area daily precipitation for the June 9 rain market and alerts when the value finalizes. |
| `noaa-dallas-rain` | `/monitor` | `#dallasrain` | `NOAA Dallas Rain Alerts` | `☔` | Monitors NOAA Dallas Area daily precipitation for the June 9 rain market and alerts when the value finalizes. |
| `noaa-denver-rain` | `/monitor` | `#denverrain` | `NOAA Denver Rain Alerts` | `☔` | Monitors NOAA Denver Area daily precipitation for the June 9 rain market and alerts when the value finalizes. |
| `noaa-nyc-precip` | `/monitor` | `#nycprecip` | `NOAA NYC Precip Alerts` | `☔` | Monitors official NOAA Central Park monthly precipitation plus 1-minute KNYC hourly alpha; each new positive or trace hour alerts while zero hours are ignored. |
| `noaa-san-francisco-rain` | `/monitor` | `#sfrain` | `NOAA SF Rain Alerts` | `☔` | Monitors NOAA San Francisco City daily precipitation for the June 9 rain market and alerts when the value finalizes. |
| `noaa-seattle-precip` | `/monitor` | `#seattleprecip` | `NOAA Seattle Precip Alerts` | `☔` | Monitors NOAA's official SEAthr Seattle City Area monthly thread plus 1-minute KSEA airport hourly alpha; positive rain and revisions alert while zero and trace-only updates are stored silently. |
| `ncei-tornadoes` | `/monitor` | `#tornadoes` | `NCEI Tornado Alerts` | `🌪️` | Monitors NCEI U.S. Tornadoes monthly time-series counts, preliminary status, chart uncertainty range, and auto-discovers monthly tornado markets. |
| `nsidc-arctic-sea-ice` | `/monitor` | `#arcticice` | `Arctic Sea Ice Alerts` | `🧊` | Monitors NSIDC northern hemisphere daily Sea Ice Index extent CSV hourly and alerts on Aug 1-Oct 1 minimum/latest-window updates. |
| `nyt-front-page` | `/monitor` | `#nytfront` | `NYT Front Page Alerts` | `📰` | Monitors New York edition NYT front-page headline strikes, highlights OCR matches in the page image, auto-discovers weekly NYT Polymarket markets through Gamma search plus series/tag fallbacks, and rechecks latest issues until a matched alert is claimed. |
| `npm-anthropic-valuation` | `/monitor` | `#npm-anthropic-valuation` | `NPM Anthropic Valuation Alerts` | `🧠` | Monitors Anthropic NPM valuation and PPS from the SecondMarket resolution page with 10-second polling around the 1:00 PM ET update window. |
| `npm-openai-valuation` | `/monitor` | `#npm-openai-valuation` | `NPM OpenAI Valuation Alerts` | `🤖` | Monitors OpenAI NPM valuation and PPS from the SecondMarket resolution page with 10-second polling around the 1:00 PM ET update window. |
| `npm-stripe-valuation` | `/monitor` | `#npm-stripe-valuation` | `NPM Stripe Valuation Alerts` | `💳` | Monitors Stripe NPM valuation and PPS from the SecondMarket resolution page with 10-second polling around the 1:00 PM ET update window. |
| `npm-databricks-valuation` | `/monitor` | `#npm-databricks-valuation` | `NPM Databricks Valuation Alerts` | `🧱` | Monitors Databricks NPM valuation and PPS from the SecondMarket page and auto-discovers monthly valuation markets. |
| `npm-neuralink-valuation` | `/monitor` | `#npm-neuralink-valuation` | `NPM Neuralink Valuation Alerts` | `🧬` | Monitors Neuralink NPM valuation and PPS from the SecondMarket page and auto-discovers monthly valuation markets. |
| `npm-perplexity-valuation` | `/monitor` | `#npm-perplexity-valuation` | `NPM Perplexity Valuation Alerts` | `🔎` | Monitors Perplexity NPM valuation and PPS from the SecondMarket page and auto-discovers monthly valuation markets. |
| `npm-kraken-valuation` | `/monitor` | `#npm-kraken-valuation` | `NPM Kraken Valuation Alerts` | `🐙` | Monitors Kraken NPM valuation and PPS from the SecondMarket page and auto-discovers monthly valuation markets. |
| `npm-lambda-valuation` | `/monitor` | `#npm-lambda-valuation` | `NPM Lambda Valuation Alerts` | `🔺` | Monitors Lambda NPM valuation and PPS from the SecondMarket page and auto-discovers monthly valuation markets. |
| `npm-epic-games-valuation` | `/monitor` | `#npm-epic-games-valuation` | `NPM Epic Games Valuation Alerts` | `🎮` | Monitors Epic Games NPM valuation and PPS from the SecondMarket page and auto-discovers monthly valuation markets. |
| `npm-canva-valuation` | `/monitor` | `#npm-canva-valuation` | `NPM Canva Valuation Alerts` | `🎨` | Monitors Canva NPM valuation and PPS from the SecondMarket page and auto-discovers monthly valuation markets. |
| `npm-anduril-valuation` | `/monitor` | `#npm-anduril-valuation` | `NPM Anduril Valuation Alerts` | `🛡` | Monitors Anduril NPM valuation and PPS from the SecondMarket resolution page with 10-second polling around the 1:00 PM ET update window. |
| `npm-glean-valuation` | `/monitor` | `#npm-glean-valuation` | `NPM Glean Valuation Alerts` | `📚` | Monitors Glean NPM valuation and PPS from the SecondMarket page and auto-discovers monthly valuation markets. |
| `npm-bytedance-valuation` | `/monitor` | `#npm-bytedance-valuation` | `NPM ByteDance Valuation Alerts` | `🎵` | Monitors ByteDance NPM valuation and PPS from the SecondMarket page and auto-discovers monthly valuation markets. |
| `npm-revolut-valuation` | `/monitor` | `#npm-revolut-valuation` | `NPM Revolut Valuation Alerts` | `💸` | Monitors Revolut NPM valuation and PPS from the SecondMarket page and auto-discovers monthly valuation markets. |

## Archived Integrations

No archived integrations currently.

## Agent Quick Context

- This is a local Discord bot for monitoring Polymarket resolution sources; it sends alerts only and does not trade.
- Integrations are code-defined adapters in `src/integrations/` and registered in `src/integrations/registry.ts`; startup builds validated id and command-name indexes and fails fast on duplicate or malformed metadata.
- One adapter normally creates one monitor channel. Non-UMA integrations use the generic `/monitor` command inside that channel; UMA integrations keep individual UMA command groups, individual UMA alert roles, and reaction selectors. Non-UMA alert pings use the Discord category role for the channel's current parent category, so moving a channel to another category changes the role it pings after the next sync. UMA Proposal Alerts also manages tag-specific alert channels from its configured tag filters. The provisioner also creates `#errorlogs` for centralized check-failure posts and `#bot-status` for runtime health/restart alerts.
- Shared integration commands are generated in `src/commands.ts`: `/monitor status`, `check`, `last`, `updates`, `polymarket`, `enddate`, `interval`, `turbo`, `pause`, `archive`, `resume`; channel-specific capability commands such as `period`, `snapshot`, `strikes`, `search`, `tagsearch`, `tags`, `watchlist`, `threshold`, `setup`, and `watch` are visible under `/monitor` but only execute in channels whose adapter supports them. Channel cleanup is bot-level through `/bot clear`; server-wide fetch-only smoke checks are queued through `/bot checkall`; archived monitor channels are restored through `/bot reinstate`.
- Discord allows 100 guild slash commands per app. `src/registerCommands.ts` enforces this cap; normal monitors share `/monitor` so new integrations do not consume one command each.
- Channel names should identify the monitor topic, while the command is `/monitor` for non-UMA channels.
- Shared Discord UI lives in `src/embeds.ts`; keep new integration replies/alerts using these embed builders and compact Markdown link rows such as `[Resolution] · [Polymarket]`.
- Event alerts can put noisy metadata in `hiddenFields`; Discord shows it only through the shared `Show more` button.
- Polling and alert sends live in `src/poller.ts`; error classification and persisted failure-message state live in `src/errorNotices.ts`; reaction-role add/remove logic lives in `src/reactionRoles.ts`.
- UMA Vote Commits polls Ethereum UMA Voting v2 `VoteCommitted` logs every minute, estimates voter stake with `getVoterStakePostUpdate(address)`, detects recommits from repeated voter/request commit keys, filters by `/umacommits threshold`, and reports tracked threshold-qualified current-cycle commit counts in `/umacommits check`.
- UMA Vote Reveals polls Ethereum UMA Voting v2 `VoteRevealed` logs every minute and filters by `/umareveals threshold`.
- Market-end reminder lookup lives in `src/marketEnd.ts`; it uses queued ET windows when available, otherwise Polymarket Gamma API `endDate` by URL slug, stores the result in SQLite, backs off failed Gamma lookups, sends one alert 24 hours before market end, and suppresses rollover reminders when a successor queued market is already stored.
- SQLite stores integration state, Polymarket URL, market-end metadata, adapter settings JSON, timestamps, and role metadata; keep timestamps as ISO strings.
- Daily snapshot integrations store snapshot value/date separately from regular interval `lastValue` checks so event-time captures are not overwritten.
- Dated/monthly Polymarket URLs are queued in `settingsJson.polymarketMarkets` by `src/polymarketQueue.ts`; the active URL changes automatically by ET window, expired queued URLs are pruned after rollover, and the stored current URL remains as fallback even after expiry so source monitoring keeps running. Some monitors intentionally keep multiple active markets for one source, such as ORNN GPU July, hit-in-2026, and end-of-2026 markets; shared Discord `Links` fields display all tracked Polymarket URLs grouped as active window, upcoming, undated, or expired when more than one is stored, but do not treat market-list-only changes as source value changes.
- `src/integrations/gammaPolymarketDiscovery.ts` is the reusable helper for recurring markets whose exact Gamma `startDate`/`endDate` should be retained instead of inferred from a slug.
- Market URL rollover sends a dedicated `Market rollover` alert and stores the newly fetched source value as the baseline, so the bot does not mislabel window-only changes as normal `Value changed` alerts.
- Shared settings helpers live in `src/settingsJson.ts`; use them for cross-adapter `settingsJson` reads, merges, and key deletion. Optional refresh writes should use `BotDatabase.setSettingsJsonIfChanged()` so unchanged settings do not bump `updatedAt`.
- Shared value-change alert UI lives in `src/embeds.ts`; keep alerts human-first with `Quick read`, optional compact `Detected change`, `Retrieved at`, and shared `Links` only. Do not add per-integration detailed snapshot fields unless the user explicitly asks for them.
- Mention/video alerts lead with the new title and release time. Weather, earthquake, tornado, GISTEMP, Spotify, Billboard, artist-release, Rotten Tomatoes, and box-office alerts lead with the decision-useful count, threshold, leader, release, score bucket, or bondable bracket. Direct release/report/chart/data URLs belong in the shared `Links` field.
- NYT Front Page accepts either the parent weekly Polymarket event URL or a nested outcome URL; the adapter normalizes nested outcome URLs to the parent event and selects weekly strikes by the published issue date, so an edition released before midnight ET is checked against its upcoming dated market immediately.
- UFO Files fingerprints official UFO/UAP file-link inventories from NARA, AARO, and FBI sources; NARA is fetched directly while AARO/FBI use `r.jina.ai` mirrors because direct Node fetches are blocked. Alerts include added/removed/metadata-changed file URLs after the stored baseline contains the tracked-file inventory.
- Trump Truth, Elon X, All-In Podcast, Joe Rogan Podcast, Lemonade Stand Podcast, App Store daily charts, AAA Regular Gas, FDIC Failed Bank List, NYT Front Page, NPM monthly private valuations, monthly precipitation, ChatGPT Outage, Claude Downtime, Discord Critical, TSA, Tesla Deliveries, Strategy Bitcoin Purchases, Bank of Israel Decision, Reserve Bank of New Zealand Decision, Box Office Weekends, Rotten Tomatoes Scores, Netflix Top 10, USGS 5.5/6.5 Earthquakes, Portwatch Hormuz Ships, White House Full Lid, White House X Posts, NCEI Tornadoes, BLS Jobs Added, CDC Flu Hospitalization, CDC Measles, Spotify monthly artist #1/top-artist markets, and Pyth price-strike bots have adapter-specific auto-discovery for upcoming recurring markets; keep this inside the adapter unless the behavior becomes clearly reusable.

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
   BOT_HEARTBEAT_PATH=.health/bot-heartbeat.json
   BOT_HEARTBEAT_INTERVAL_SECONDS=30
   BOT_STATUS_CHANNEL_NAME=bot-status
   BOT_SERVICE_NAME=discord-bot.service
   BOT_HEARTBEAT_MAX_AGE_SECONDS=120
   BOT_WATCHDOG_RESTART_ON_BAD=true
   BOT_WATCHDOG_RESTART_COOLDOWN_SECONDS=300
   BOT_WATCHDOG_RESTART_WINDOW_SECONDS=900
   BOT_WATCHDOG_MAX_RESTARTS_PER_WINDOW=3
   BOT_RESTART_COMMAND=
   DISCORD_HEALTH_WEBHOOK_URL=...
   HEALTHCHECKS_PING_URL=...
   DUNE_API_KEY=...
   PYTH_PRO_API_KEY=...
   CLOUDFLARE_RADAR_API_TOKEN=...
   KAITO_INFOMARKETS_API_URL=...
   KAITO_API_KEY=...
   PREDICT_API_KEY=...
   OPINION_API_KEY=...
   OPINION_DEFAULT_TOPIC_RATE=0.08
   OPINION_MIN_FEE_USD=0.5
   POLYGON_RPC_URL=...
   POLYGON_RPC_URLS=...
   POLYGON_WS_URL=...
   ETHEREUM_RPC_URL=...
   ETHEREUM_RPC_URLS=...
   WHITE_HOUSE_TWEETS_NITTER_FEEDS=https://nitter.net/WhiteHouse/rss,https://xcancel.com/WhiteHouse/rss
   ELON_X_AUTH_TOKEN=
   ELON_X_CT0=
   ELON_X_NITTER_BASE_URLS=https://xcancel.com,https://nitter.kareem.one
   ELON_X_NITTER_FEEDS=https://xcancel.com/elonmusk/rss
   TRUTH_SOCIAL_COOKIE=...
   TRUTH_SOCIAL_USER_AGENT=...
   HENDON_MOB_COOKIE=...
   HENDON_MOB_USER_AGENT=...
   MARINETRAFFIC_HORMUZ_ALPHA_URL=...
   MARINETRAFFIC_BAB_ALPHA_URL=...
   ```

   `DUNE_API_KEY` is required for `#basedrevenue` and `#ethgasmonthly`. `PYTH_PRO_API_KEY` is required for reliable Pyth 1-minute history after Pyth authenticated that endpoint on July 24, 2026; without it the price adapters retain the old browser-API fallback but may receive a Vercel checkpoint. `CLOUDFLARE_RADAR_API_TOKEN` is required for `#cubaoutage` because the public Radar page is Cloudflare-protected from direct bot fetches; create a Cloudflare API token with Radar read access. `/trumpgetty` does not use Getty API credentials. It reads the public Getty search page through the reader fallback. `TRUTH_SOCIAL_COOKIE` and `TRUTH_SOCIAL_USER_AGENT` are optional for `#trumptruth`; use them only when direct Truth Social works in a normal browser on the same Pi/VPN egress IP. `HENDON_MOB_COOKIE` and `HENDON_MOB_USER_AGENT` are optional for `#pokermoney`; use them only when The Hendon Mob blocks direct bot fetches, and copy them from a normal browser session on the same Pi/VPN egress IP.

3. Register slash commands for your test server:

   ```powershell
   npm run register-commands
   ```

The bot invite needs `Manage Channels`, `Send Messages`, `View Channels`, `Manage Messages`, `Manage Roles`, `Add Reactions`, and `Read Message History`. The bot's highest Discord role must be above the alert roles it manages. Enable the Server Members Intent in the Discord Developer Portal if role assignment fails.

## Commands

The bot creates a channel for each adapter when it starts, then checks every minute for missing channels and alert-role drift.

Non-UMA alert subscriptions are category-based. `#market-alert-roles` shows one reaction entry per Discord category, and every integration channel in that category pings the same category role. Moving a channel between categories or renaming a category is detected by Discord channel updates and by the periodic provisioner sync. UMA integrations keep their separate UMA-specific subscription roles.

Most integrations use the same generic command inside their own channel. Run `/monitor` in the channel you want to control, for example `#bonbast-usd-irr`, `#trumptruth`, `#tsa`, or `#mrbeastviews`:

- `/monitor status`
- `/monitor check`
- `/monitor last`
- `/monitor updates`
- `/monitor snapshot`
- `/monitor polymarket url:https://polymarket.com/event/example`
- `/monitor enddate datetime:2026-05-10 23:59`
- `/monitor interval minutes:1`
- `/monitor turbo seconds:10 duration-minutes:30`
- `/monitor turbo seconds:0`
- `/umacommits threshold value:250k`
- `/umareveals threshold value:250k`
- `/monitor watchlist action:add market:https://polymarket.com/market/example`
- `/monitor watchlist action:add market:0x...questionId`
- `/monitor watchlist action:list`
- `/monitor setup urls:https://predict.fun/market/ipos-before-2027 https://polymarket.com/event/ipos-before-2027 amount:25 min-edge:0.5`
- `/monitor watch urls:https://predict.fun/market/ipos-before-2027 https://polymarket.com/event/ipos-before-2027 outcome:Discord side:BOTH amount:25 min-edge:0.5`
- `/monitor pause`
- `/monitor archive reason:market ended`
- `/monitor resume`
- `/bot summarize`
- `/bot reinstate`
- `/bot reinstate adapter:bonbast-usd-irr`
- `/bot checkall delay-seconds:5`
- `/bot clear`
- `/bot clearerrors keep-latest:true`
- `/bot clearroles`
- `/bot pruneroles mode:preview`
- `/bot pruneroles mode:delete`

Month/year integrations also support:

- `/monitor period year:2026 month:6` inside `#claudedown`
- `/monitor period year:2026 month:6` inside `#chatgptoutage`
- `/monitor period year:2026 month:5` inside `#hkprecip`
- `/monitor period year:2026 month:5` inside `#koreaprecip`
- `/monitor period year:2026 month:5` inside `#londonprecip`
- `/monitor period year:2026 month:6` inside `#gistemp`
- `/monitor period year:2026 month:5` inside `#nycprecip`
- `/monitor period year:2026 month:5` inside `#seattleprecip`

Monthly precipitation, ChatGPT Outage, and Claude Downtime adapters auto-discover active next-month Polymarket URLs through Gamma public search and keep `year`/`month` settings synchronized with the active queued market. Monthly precipitation adapters also fall back to the current ET month when no active next market exists, so source updates continue after an old Polymarket expires.

Commands are intentionally channel-scoped. `/monitor` detects the adapter from the current channel and rejects unsupported subcommands for that channel. UMA commands remain adapter-specific.
Command replies and alerts display timestamps in Singapore local time.
Status replies show both the configured base interval and the current effective interval. Dynamic polling integrations also show the current polling mode/reason.
Use `/monitor turbo seconds:<seconds> duration-minutes:<minutes>` to temporarily poll the current channel faster. Turbo is stored in `settingsJson`, takes effect within a few seconds, overrides adapter dynamic intervals while active, and expires automatically. Use `/monitor turbo seconds:0` to turn it off early. Minimum turbo interval is 1 second; maximum duration is 24 hours. The scheduler never overlaps checks for the same integration, so a slow source safely skips ticks instead of stacking requests.

Use `/monitor archive` when a market is done but the adapter should remain available for future market restarts. Archive sets the integration to `paused`, stores `archivedAt`, optional `archiveReason`, and deleted-channel metadata in `settingsJson`, then deletes the monitor channel so the server stays clean. Archived integrations keep their source code, Polymarket URL, last values, and update logs, and the provisioner will not recreate their channels until reinstated. Use `/bot reinstate` from any normal channel to list archived monitors, then `/bot reinstate adapter:<adapter-id>` to recreate the saved channel and resume polling. `/monitor resume` still works if an archived channel was not deleted.
Use `/monitor updates` in each channel to review recent detected update times and rough SGT/ET hour patterns. Update logs begin from deployment and are not backfilled.
Use `/bot summarize` anywhere in the server to list all integrations with resolution source, Polymarket URL, parsed market end, and polling interval.
Use `/bot checkall` to queue a fetch-only smoke check for every active non-UMA integration. It checks one monitor at a time with a configurable delay, posts one editable progress message in the command channel, posts one smoke-check result in each integration channel, and does not update stored values or mention alert roles.
Check-failure errors are posted to `#errorlogs` when that channel exists. The bot keeps one editable `Check failed` post per integration, updates repeated failures there, and falls back to the integration channel only if `#errorlogs` is unavailable. Use `/bot clearerrors` to scan integration channels plus `#errorlogs` and delete old bot `Check failed` messages; by default it keeps only the newest failure per channel. Use `keep-latest:false` to remove all existing failure messages.
Use `/bot pruneroles mode:preview` to list stale Discord roles ending in `Alerts` that are no longer referenced by the current category-role or UMA-role mapping. Use `/bot pruneroles mode:delete` only after previewing; by default it skips stale roles that still have members unless `include-member-roles:true` is provided.
Arbitrage replies are alert-only. `/monitor setup` in `#arb` asks for a shared outcome and YES/NO/BOTH side through dropdowns, then alerts only when the best route is positive after configured platform fees and the minimum edge. Alerts include the buy/sell platform, side, executable amount, fees, and expected profit. Predict and Opinion checks require their API keys in `.env`.
MarineTraffic alpha for `#hormuzships` and `#babmandeb` is optional. The public MarineTraffic map blocks bot fetches; use official MarineTraffic/Kpler export URLs in `MARINETRAFFIC_HORMUZ_ALPHA_URL` and `MARINETRAFFIC_BAB_ALPHA_URL` if you have API/export access. If unset, PortWatch output is unchanged.
Bonbast replies use Discord embeds with compact fields, colored status accents, and clickable links.
Use `/monitor polymarket` once per market so future alerts include a clickable Polymarket link.
The stored Polymarket URL also drives market-end reminders. For queued dated URLs, the bot uses the ET-derived queue end time; otherwise it reads the market `endDate` from Polymarket Gamma API once per integration/Polymarket URL, stores it locally, and sends one reminder 24 hours before the returned end time. It does not send 12-hour, 1-hour, or end-time reminders. If a later queued market is already stored for the integration, the reminder for the current market is skipped. If Gamma does not return an `endDate`, the bot sends one warning in that integration channel instead of repeatedly querying Gamma. Failed Gamma lookups back off before retrying so a VPN/DNS/API outage does not flood logs. Use `/monitor enddate` in the channel to manually set the end time in ET, for example `/monitor enddate datetime:2026-05-10 23:59`.
Use `/bot clear` to clear the current text channel. You and the bot both need `Manage Messages`.

## Raspberry Pi Health Alerts

Production uses `discord-bot.service`, the minute-by-minute `deploy.sh` cron, and `scripts/rpi-discord-watchdog.sh`. See the [Raspberry Pi operations runbook](docs/OPERATIONS.md) for setup, health-channel policy, deployment checks, and copy-paste troubleshooting commands.

## Polymarket URL Queue

For most integrations, `/... polymarket url:<url>` appends or updates a queued Polymarket URL in `settingsJson.polymarketMarkets`. If the URL slug contains a date range such as `may-18-may-24`, the bot derives an ET window, keeps the current market active until the new window starts, switches automatically on the next poll/check, suppresses old-market rollover reminders once a later queued market exists, and prunes expired queued URLs after rollover. When no queued dated market is active and there is no undated fallback, the bot keeps the stored current Polymarket URL as a fallback, even if expired, so source checks and alerts continue.

If a URL has no parseable date range, the bot keeps it as an undated fallback for that integration. Market-end reminders for queued dated URLs use the queue's ET-derived `endAt` instead of Gamma `endDate`. Trump Truth uses a specialized queue because it stores all terms, resolved terms, active terms, and Gamma refresh timestamps per weekly market. All-In Podcast, Joe Rogan Podcast, Lemonade Stand Podcast, Strategy Bitcoin Purchases, TSA, USGS Earthquakes, and White House Full Lid use the shared queue plus adapter-specific auto-discovery for upcoming weekly markets. Tesla Deliveries uses the shared queue plus adapter-specific auto-discovery for upcoming quarterly delivery markets. NCEI Tornadoes uses adapter-specific monthly windows with Gamma `endDate` because monthly markets overlap the next month until the NCEI release date.

Trump Truth also supports:

- `/trumptruth strikes`
- `/trumptruth search term:King`

The `strikes` command force-refreshes Gamma-derived strike terms and then displays the currently active unresolved terms.
The Trump Truth `search` command refreshes settings, searches the Trump Truth archive for a word or phrase inside the active weekly market's ET timeframe, and returns matching posts plus the source search URL.
Trump Truth strike alerts include an `Ignore strike` button for false positives. The button opens a small term list modal, stores the ignored term on the active weekly market in `settingsJson`, edits the original alert to remove the strike state, and excludes that term from future matching for that market only.

UMA Proposal Alerts also supports:

- `/umaproposals tagsearch query:sports`
- `/umaproposals tags action:add tag:1`
- `/umaproposals tags action:list`
- `/umaproposals tags action:remove tag:sports`
- `/umaproposals tags action:clear`
- In `#uma-proposals-politics`: `/umaproposals tagblocks action:add blocked:mentions`
- In `#uma-proposals-politics`: `/umaproposals tagblocks action:list`
- In `#uma-proposals-politics`: `/umaproposals tagblocks action:remove blocked:mentions`
- In `#uma-proposals-politics`: `/umaproposals tagblocks action:clear`
- From base `#uma-proposals`: `/umaproposals tagblocks action:add tag:politics blocked:mentions`

Proposal alerts are off until at least one Polymarket tag filter is configured. The bot watches UMA `ProposePrice` logs first, then enriches each proposal with Polymarket CLOB market metadata and only alerts when the market tags exactly match a configured tag label or slug. Adding a tag creates a dedicated channel named `#uma-proposals-<tag-slug>`, removing a tag deletes that tag channel, and matching alerts are sent to the tag-specific channel instead of the base `#uma-proposals` command channel.
Run `/umaproposals tagblocks` inside a tag-specific proposal channel to ban another market tag only from that channel; the same blocked tag can still alert in other UMA proposal tag channels unless those channels also block it. From the base `#uma-proposals` channel, include `tag:<configured-tag>` to choose which tag channel gets the exclusion.
Run `/umaproposals notify mode:off` inside a tag-specific proposal channel to keep alerts posting there without mentioning the shared UMA Proposal Alerts role; `mode:on` restores pings. Notify mode is on by default for every proposal tag channel.

UMA Proposal and Dispute Alerts also support address labels:

- `/umaproposals addresses action:add address:0x0000000000000000000000000000000000000000 name:Example`
- `/umaproposals addresses action:list`
- `/umaproposals addresses action:remove address:0x0000000000000000000000000000000000000000`
- `/umaproposals addresses action:clear`
- `/umaproposals addresses action:import file:addresses.csv dry-run:true`
- `/umaproposals addresses action:import file:addresses.csv dry-run:false`
- `/umaproposals addresses action:export`

The same `addresses` subcommand is available on `/umadispute`. Adding, removing, clearing, or importing labels syncs across the configured UMA proposal and dispute integrations so proposer and disputer fields can show names above the raw address. Bulk import accepts CSV or loose text where each nonblank row contains one nickname and one `0x` address; dry-run defaults to true so imports can be previewed before saving. Export returns the current shared address book as CSV. Alerts resolve each proposer/disputer through Polymarket Gamma `public-profile`, then check Data API trades on the resolved proxy wallet; addresses with at least one trade get a Polymarket profile link, while addresses with no linked profile/trades are marked as not linked. Proposal and dispute alerts also check the resolved proxy wallet for aligned and hedged positions on the same Polymarket condition, and always include a Polygonscan address link for proposer/disputer addresses.
UMA proposal/dispute alerts also include `Refresh data`, `Label proposer`, and `Label disputer` buttons when those addresses are present. `Refresh data` retries profile/trade/position enrichment and edits the existing alert; label buttons open a private nickname form and save through the same synced address-label storage.

App Store integrations have one extra command inside their channels:

- `/monitor snapshot`

The Free App Store and Paid App Store integrations run a separate daily snapshot check during the 12:00-12:05 PM ET window. That snapshot is posted as a distinct snapshot alert, stored in separate SQLite fields, and is not overwritten by regular interval checks. The next ET day noon snapshot replaces the previous stored snapshot. Repeated snapshot failures use the shared integration error-throttling window.

## Alert Roles

The bot creates `#market-alert-roles` and posts grouped reaction selectors for market integration roles. It creates `#uma-alert-roles` for UMA clarification, proposal, and dispute alert roles. React to an alert emoji to receive that alert role; remove your reaction to opt out. Each grouped selector uses up to 20 unique emoji, and the provisioner preserves existing selector-message assignments, user reactions, and stored fallback emoji while adding missing bot reactions. Stale selector messages with user reactions are left in place instead of being deleted automatically.

The Current Integrations table is the source of truth for each adapter's role name and emoji. Normal value-change alerts, daily snapshots, and market-end reminders mention the adapter alert role. Event-post integrations can be quieter: Trump Truth posts every new post but only mentions the role when a strike is detected.

Old per-integration alert roles from before the category-role model are not reused. `/bot pruneroles mode:preview` shows stale `* Alerts` roles that are safe candidates; `/bot pruneroles mode:delete` deletes only editable candidates and skips roles with members unless explicitly told otherwise.

## Integration Pattern

- Add integrations as adapters in `src/integrations/`; keep scraping and parsing logic inside the adapter.
- Register adapters in `src/integrations/registry.ts`; each adapter must define `id`, `commandName`, `displayName`, `sourceUrl`, `defaultChannelName`, `alertRoleName`, `alertRoleEmoji`, and `fetchCurrentValue`.
- Keep `defaultChannelName` synchronized with `commandName` when practical; if exact matching is too long, the channel name must still clearly indicate the slash command.
- Return normalized string values plus `observedAt`; store timestamps as ISO strings and format them only in Discord output.
- Auto-parsed strike integrations must ignore resolved markets, including Gamma markets marked `closed`, `archived`, inactive, or outcome prices already resolved to `1/0`.
- Use `defaultSettings` and `supportsPeriod` for month/year-driven sources; keep settings in adapter-owned JSON rather than one-off tables.
- Use the shared command set and embeds; do not create one-off Discord UI per integration.
- Do not add integration-specific command handlers unless the shared command model cannot express the behavior.
- Temporary integrations should still be normal adapters with full command/channel/role metadata; mark the temporary purpose in this README and use `/... archive` once the market no longer needs monitoring.
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
- FRED eggs monitors the active monthly egg-price market from its queued Polymarket URL; it polls hourly except on the day before and day of the parsed next release date, when it polls every minute.
- FRED beef monitors the latest 2026 ground beef price; it polls hourly except on the day before and day of the parsed next release date, when it polls every minute.
- FDIC monitors the latest failed-bank table row; changes to that row trigger the normal value-change alert.
- Kaito mindshare monitors a configured Kaito Historical Data JSON/API endpoint for finalized Polymarket mindshare rows because the public Kaito page is Cloudflare-protected from direct bot scraping.
- MrBeast subscribers monitors the YouTube channel About metadata subscriber count every minute and compares it to Gamma-parsed million-subscriber market targets.
- MrBeast views monitors the YouTube channel About metadata total view count every minute, rejects implausible video-level view-count parses, auto-discovers active Gamma billion-view markets, uses `lastChangedAt` for rate math, and keeps `#mrbeastviews` as the canonical channel name.
- ORNN B200, H100, and H200 monitor the dashboard's GPU index-history API and use the second latest point as finalized because daily values finalize after the following day's point is published. Each ORNN GPU adapter polls hourly, alerts only when the finalized daily value changes, auto-discovers active `gpu-rental-prices-<gpu>-...` Polymarket markets through Gamma search, and shows all active linked markets when the same GPU has multiple concurrent markets.
- ISW Ukraine Map polls the official ArcGIS StoryMap item JSON first, then falls back to the full StoryMaps HTML page, ignores optional `Story published at` metadata for change detection, and alerts only when the actual notice or assessed map status changes.
- Portwatch Hormuz Ships monitors the IMF Portwatch `Daily_Chokepoints_Data` ArcGIS table for `portid='chokepoint6'`, sums `n_total` over the active weekly Polymarket window, reports the average over reported days, polls every minute, auto-discovers weekly Hormuz transit markets, and keeps the previous weekly window visible after rollover once delayed PortWatch data completes it.
- UMA Clarification Alerts subscribes to pending `postUpdate(bytes32,bytes)` transactions and mined `AncillaryDataUpdated` events from Polymarket's UMA bulletin-board contract on Polygon over WebSocket, defaults to PublicNode's free Polygon Bor WebSocket, and uses Nodies, OnFinality, dRPC, PublicNode, Tenderly, and QuickNode public endpoints for 1-minute HTTP backfill. Configure an Alchemy Polygon WebSocket for filtered mempool alerts; non-Alchemy sockets listen only for mined logs instead of consuming the unusable unfiltered Polygon mempool stream. Multiple comma-separated `POLYGON_WS_URLS` run concurrently for redundancy, and the PublicNode mined-log socket is retained as a fallback. Pending mempool alerts are best-effort and can arrive before mining; the mined-log path remains the authoritative confirmation/backfill. Configure providers with `POLYGON_WS_URL`, `POLYGON_WS_URLS`, `POLYGON_RPC_URL`, or `POLYGON_RPC_URLS`.
- UMA Dispute Alerts subscribes to UMA OptimisticOracle `DisputePrice` events on Polygon, watches current and legacy oracle contracts, filters requester addresses to Polymarket UMA requester contracts including the bulletin board adapter, and uses 1-minute HTTP backfill plus CLOB `markets-by-question-id` enrichment.
- UMA Proposal Alerts subscribes to UMA OptimisticOracle `ProposePrice` events on Polygon, watches current and legacy oracle contracts, filters requester addresses to Polymarket UMA requester contracts including the bulletin board adapter, enriches each proposal through CLOB `markets-by-question-id`, alerts only when the returned market tags match configured `/umaproposals tags` filters, and adds a Penny pick liquidity field only when the CLOB book returns live asks for the proposed-side token. CLOB orderbook failures are shown in the main alert as `PENNY PICK CHECK`; non-error check details stay in Show more.
- Polymarket Resolvable Watch keeps an empty watchlist by default. `/monitor watchlist action:add market:<polymarket-url>` stores Gamma `questionID` and `conditionId` values, while `market:<question-id>` stores a raw question ID and skips the CTF `conditionId` precheck. It polls Conditional Tokens `payoutDenominator(bytes32)` when a condition ID is known plus UMA CTF adapter `ready(bytes32)` through Polygon `eth_call` only while at least one market is configured, alerts when either the condition is already resolved or `ready` returns true, and removes that market from the watchlist.
- UMA Vote Commits polls Ethereum UMA Voting v2 `VoteCommitted` logs every minute, estimates each voter's current stake at the commit block with `getVoterStakePostUpdate(address)`, detects recommits from repeated voter/request commit keys, groups same-voter events per scan into voter-level summaries because commit answers are confidential, tracks threshold-qualified current-cycle commit counts for `/umacommits check`, drops pending/backfilled alerts older than 10 minutes, routes its reaction role through `#uma-alert-roles`, and alerts only when the stake is at least `/umacommits threshold`.
- UMA Vote Reveals polls Ethereum UMA Voting v2 `VoteRevealed` logs every minute, groups same-voter events per scan, drops pending/backfilled alerts older than 10 minutes, routes its reaction role through `#uma-alert-roles`, and alerts only when the revealed `numTokens` vote weight is at least `/umareveals threshold`; default free RPC endpoints can be overridden with `ETHEREUM_RPC_URL` or comma-separated `ETHEREUM_RPC_URLS`.
- Grouped UMA vote alerts are voter-level summaries only and intentionally omit per-request lists and Show more details.
- UMA proposal alerts keep question, outcome, market tags, proposer, and times visible; transaction, condition ID, question ID, oracle, requester, request timestamp, and block are behind the refresh/details button.
- UMA clarification, proposal, and dispute question fields include Polymarket and Betmoar market links when the Polymarket market slug is known; keep these links even when the Polymarket page may not exist yet.
- Pyth Natural Gas, WTI, XAGUSD, and XAUUSD auto-discover matching monthly Polymarket markets, parse only unresolved strikes, enforce HIGH as upward-only and LOW as downward-only, and alert each strike once per market. They discover the front stable contract from Pyth's public symbols API and use the authenticated official 1-minute history endpoint when `PYTH_PRO_API_KEY` is set; the old browser API remains a best-effort fallback. Requests are serialized, the top feed is cached for five minutes, and HTTP 429/5xx responses are retried.
- MetaDAO Credible Fundraise polls hourly and parses the visible committed amount/contributor count from the official `metadao.fi` fundraise page. If MetaDAO returns a Vercel security checkpoint or the visible totals cannot be parsed, the adapter fails closed instead of emitting a synthetic `$0.00` value.
- RWA Total Value reads the RWA.xyz home chart tRPC data, treats a daily point as finalized only after the following point appears, and alerts only on finalized-value changes.
- Box Office Weekends keeps all active weekend box-office markets in one adapter/channel, discovers active `weekend box office` Polymarket events with the `box-office` tag, reads The Numbers pages through `r.jina.ai` because direct The Numbers bot HTTP returns 403, checks BoxOfficeMojo title/release pages as secondary context, keeps prior bondable brackets through transient fetch errors, and alerts only when a market becomes complete/bondable or its complete bracket changes.
- Rotten Tomatoes Scores keeps all active Rotten Tomatoes score markets in one adapter/channel, discovers active `rotten-tomatoes-score`/`rotten-tomato-score` Polymarket events by the Rotten Tomatoes tag, checks exact movie search rows on Rotten Tomatoes, keeps the last known bucket through transient RT fetch errors, and only treats real 5-point Tomatometer bucket moves as alert-worthy value changes.
- AWS monitors the public AWS Health Dashboard history events JSON, treats status code `3` as disrupted, and intentionally keeps checking beyond the expired June market window.
- Bank of Israel Decision uses the official `https://www.boi.org.il/PublicApi/GetInterest` JSON endpoint, avoiding the Radware-blocked HTML pages, and auto-discovers monthly `bank-of-israel-decision-in-...` markets.
- Reserve Bank of New Zealand Decision monitors RBNZ OCR/current-rate and past-decision pages through `r.jina.ai` because direct Node fetches can return Cloudflare/F5 restriction pages; it alerts when the latest official OCR decision key changes and auto-discovers monthly `reserve-bank-of-new-zealand-decision-in-...` markets.
- BLS Jobs Added monitors the Employment Situation Summary current/archive pages, keeps each monthly market active through the scheduled 8:30 AM ET release day, polls every minute on the day before/day of release, and auto-discovers active monthly `how-many-jobs-added-in-...` markets.
- CDC fertility monitors the natality dashboard CSV for the 2026 Q1 general fertility rate row.
- Cloudflare monitors the official Statuspage incidents API and returns a stable no-critical value unless a Critical/red incident appears.
- Discord monitors the official Statuspage incidents API, filters Critical/red incidents to the active discovered market window, and auto-discovers recurring by-date markets.
- Claude Downtime accepts current Gamma titles with a blank day-count outcome, auto-discovers the recurring monthly event, and only counts finalized non-green `claude.ai` boxes.
- Claude Code Commits keeps publishing the latest tracker statistics when Gamma has no unresolved strike market; an empty target list is a valid idle state, not a check failure.
- Artist Song Releases and KPop Song Releases parse unresolved artist/group questions from Gamma, resolve Apple Music artist IDs through the public iTunes Search API, and poll recent catalog entries hourly. Obvious remixes, edits, live/acoustic/demo versions, rerecordings, remasters, and catalog collections are excluded; remaining matches are labeled candidates for manual verification. KPop releases must also be on or after the Gamma market creation date.
- ISM Services PMI derives the target month and exact release date from the active Gamma event, checks the matching monthly Services report URL, and polls every minute on the day before/day of release.
- UMich Consumer Sentiment checks the Surveys of Consumers landing page and Table 1 CSV, auto-discovers monthly Polymarket markets, ignores preliminary releases, and only marks the target month published when that month’s Final Results link exists.
- NCEI tornadoes monitors monthly U.S. tornado counts from the NCEI Tornadoes Time Series JSON endpoint plus chart config metadata, treats preliminary counts as resolution-relevant, shows NCEI's uncertainty range, and alerts when the target value/status/uncertainty changes.
- NPM private valuation monitors normalize dollar formatting from the public API and rendered fallback before comparing values, so `$16.730B` and `$16.73B` do not create false value-change alerts. Monthly-discovery monitors retain all concurrent matching monthly/yearly markets and use each Gamma `endDate` instead of a guessed cutoff.
- USGS earthquakes monitors the official USGS event API count for 5.5+ and 6.5+ earthquakes in active weekly Polymarket date windows, alerts on any count change, and treats decreases as USGS revision alerts for events moved below the cutoff. USGS 7.0+ earthquakes uses the same count-change alert behavior with separate fixed windows for the Jun 30 market and full-year 2026 market. Earthquake value blocks always show separate market start/end UTC timestamps for auditability.
- NSIDC Arctic Sea Ice uses the official NOAA@NSIDC daily northern hemisphere extent CSV (`N_seaice_extent_daily_v4.0.csv`), computes the Aug 1-Oct 1 minimum to three decimals, and suppresses pre-window alerts until at least one qualifying window day is published.
- HKO Hong Kong precipitation uses Daily Extract as the official total, then adds the text-only Yesterday's Weather rainfall only when that report is newer than the latest Daily Extract day; if Gamma has no active next market, it still tracks the current ET month.
- NOAA NYC and Seattle monthly precipitation use RCC ACIS daily rows instead of only the monthly sum. NYC retains its existing alerts for newly posted `0.00` or `T` days but ignores label/format-only changes; Seattle stores both `0.00` and `T` updates silently and alerts only for positive rain or a changed monthly total.
- The five recurring monthly precipitation monitors use the rule location: HKO Observatory AWS RF023, NOAA Central Park thread `NYCthr` with KNYC hourly observations, KMA Seoul station 108, exact Heathrow station 03772 plus the separate near-coincident Environment Agency gauge 247540TP, and NOAA Seattle City Area thread `SEAthr` with KSEA hourly observations. They poll hourly alpha feeds every minute, retain positive/trace observations for the station-local day, and alert only when a positive hour is added or revised; zero hourly reports are ignored. HKO keeps only top-of-hour buckets because its API otherwise exposes overlapping rolling-hour snapshots, and its AWS gauge differs from the official climatological gauge. Heathrow's Environment Agency gauge is also provisional and separate from the official Met Office instrument. London's slower exact-station Infoclimat cumulative alpha is cached for 30 minutes; no nearby personal weather station fallback is used. All five continue checking even before a new Polymarket URL is discovered.
- Precipitation alert quick reads must show the summed `Current total` or `Total precipitation` first, then latest day/reporting status; long `Daily values` rows are source detail and should not dominate the compact alert. Alpha cumulative or pending daily totals should be surfaced when present.
- Paris Heat Wave uses Wunderground's public Weather.com historical observations for station `LFPB`, splits ranges into at most 31 inclusive days to satisfy the upstream API, groups highs by Paris station-local calendar date, and alerts only when the >=35°C qualifying-day set or 3-day streak status changes.
- White House Alien Arrests NYC reads the embedded Flourish table on `whitehouse.gov/aliens` and exact-matches the `New York, NY` row's `Total Arrests` counter.
- White House Full Lid monitors Roll Call's Factba.se calendar and Forth's WH pool page for today's ET full lid; it also checks BNO News' White House Press Pool feed (`https://bnonews.com/whpool`) as a faster alpha source and skips lunch-lid reports. Alpha alerts must show the exact BNO/Forth source URL, and Roll Call same-day or recent-prior-day confirmations/revisions should alert even after a BNO alpha alert. It polls every minute during 8:00 AM-8:30 PM ET and hourly off-hours.
- White House Pool Updates is a standalone no-market feed for `https://bnonews.com/whpool` and best-effort `https://www.forth.news/whpool`; Forth can return a Vercel 429 to bot fetches, so BNO updates should still alert while Forth status is reported non-fatally.
- White House X Posts uses Polymarket's public XTracker posts and active-trackings APIs as its primary unauthenticated source and market-discovery source. The Trump Feed plus configurable Nitter/XCancel RSS URLs remain fallbacks. It polls every 5 minutes, keeps a monotonic captured-post set, tracks overlapping weekly noon-to-noon markets, and sends role-tagged hourly summaries only when newly captured posts exist.
- Register new adapters in `src/integrations/registry.ts`.
- Give each adapter a unique `commandName` for its slash command.
- Give each adapter a unique `alertRoleName` and `alertRoleEmoji`.
- Keep scraping logic isolated in adapters.
- Use simple HTTP parsing first; add browser automation later only for JavaScript-rendered sources.
- Free and Paid App Store integrations monitor Apple's US iPhone chart feeds, display the top 5, compare only the top 2 for alerts, capture separate 12:00 PM ET daily snapshots via snapshot storage fields, and auto-discover active daily App Store markets through Gamma search. Free discovery accepts `#1` and `#2` Free App Store markets; Paid discovery accepts Paid App Store markets.
- Spotify USA and Spotify Global use Kworb daily chart pages for the detailed top 10 chart date, positions, streams, days, and peaks while preserving the official Spotify Top 50 playlist links. Alert quick reads show the chart date, #1 change, current top 5, and a direct Kworb ranking-data link; discovery includes recurring weekly #1/#2 song markets.
- Spotify Top Artist Monthly uses Kworb's public monthly-listener ranking for structured artist counts, parses active listed artist outcomes from Gamma, and keeps Spotify as the resolution source in alerts.
- Justin Bieber Monthly Listeners reads Spotify's public artist page metadata directly, so it does not need Spotify API credentials; it alerts only when the listener count line changes and displays parsed hit/open Polymarket thresholds.
- Spider-Man Trailer monitors four official YouTube RSS feeds and only alerts on post-market videos whose title matches Spider-Man/Spiderman, Brand New Day, and trailer/teaser while excluding ticket-sale, livestream, production, clip, and featurette wording.
- Arena AI adapters show the top 3 model rows and top 3 distinct companies, compare those rankings without score/vote jitter, and use Gamma discovery for recurring leaderboard markets.
- Tesla deliveries monitors Tesla production and delivery press releases through the matching official SEC 8-K exhibit because direct local requests to `ir.tesla.com/press` are Akamai-blocked; it auto-discovers active quarterly Polymarket delivery markets into the shared queue.
- Elon X can use a logged-in X web session for low-latency, full-text posts and replies without a paid API on Node.js 22+: put a dedicated spare account's `auth_token` and `ct0` cookies in `ELON_X_AUTH_TOKEN` and `ELON_X_CT0`. Treat both as login secrets. With both set, active markets poll direct X search every 30 seconds and automatically fall back on failure. Without them, the adapter concurrently merges Polymarket XTracker with every configured `/elonmusk/with_replies` page and RSS feed instead of trusting the first non-empty mirror; XTracker is fast but may omit replies. Quoted-post and repost text do not count for strikes, and repost notifications remain suppressed.
- Trump Schedule monitors Roll Call's Factba.se calendar for today's ET public schedule, highlights the next remaining item, stores lid/travel/press/remarks flags, and polls every 15 minutes during 7:00 AM-10:00 PM ET.
- Trump Truth tries the direct Truth Social statuses API only when `TRUTH_SOCIAL_COOKIE` is configured, using the optional `TRUTH_SOCIAL_USER_AGENT` from the same Pi/VPN browser session. If direct Truth Social is blocked or unconfigured, it falls back to the reachable `https://www.trumpstruth.org/feed` and `https://www.trumpstruth.org/` archive sources; alerts include original Truth Social URLs and an Open Truth link button for verification.
- Trump Truth parses weekly Polymarket strike terms into `settingsJson`, stores the latest seen Truth Social post ID in `lastValue`, checks archive image descriptions, alt text, and basic OCR output for image-only strike review, auto-discovers upcoming weekly markets, supports active-window archive search with `/trumptruth search`, supports per-market false-positive strike ignores from the alert button, posts non-strike feed updates without a role ping, and only role-tags strike hits.
- TSA passengers parses the active market range and sum, but also stores the latest official source day/throughput so monitoring remains useful when Polymarket has not created the next weekly market.
- Centralized alert quick reads in `src/embeds.ts` should lead with the actionable result/value and keep direct article, press release, and filing URLs in the `Links` field rather than exposing raw adapter metadata first.
- Generic dated Polymarket queueing lives in `src/polymarketQueue.ts`; prefer it over adapter-specific queue fields unless the adapter needs extra parsed market state.

## Maintenance Review Notes

- Overall structure is healthy: adapters stay isolated, while `commands.ts`, `poller.ts`, `embeds.ts`, `database.ts`, and `provisioner.ts` form the shared core.
- Shared settings helpers live in `src/settingsJson.ts`; use them when reading, merging, or deleting cross-adapter `settingsJson` keys. Use `BotDatabase.setSettingsJsonIfChanged()` instead of open-coded optional `setSettingsJson` blocks.
- `commands.ts`, `embeds.ts`, and `poller.ts` are still the main growth hotspots; split only when changing them for real features, not as a standalone rewrite.
- Poller error suppression/formatting lives in `src/errorNotices.ts`; keep retry/noise-control behavior there instead of adding local copies.
- Integration check failures should route through the shared poller error path into `#errorlogs`; do not send adapter-local error messages to monitor channels.
- Adapter registry construction validates ids, command names, channels, source URLs, and required role metadata at startup; tests cover duplicate rejection and adapter-specific capabilities.
- Current one-timer-per-integration polling is fine for dozens of adapters; revisit only if the bot grows into hundreds of active monitors or needs exact cron scheduling.
- Keep `lastValue` string comparisons for simple monitors, but use structured settings/event tables for dedupe-heavy or multi-item integrations.

## Validation

```powershell
npm.cmd run validate
```
