# Polymarket Resolution Monitor Bot

Local Discord bot for monitoring Polymarket resolution-source websites and posting alerts when tracked values change.

## Current Scope

- Discord slash commands only.
- One base channel per website integration, with adapter-owned extra channels only where explicitly documented.
- Local SQLite persistence.
- Polling and Discord alerts only.
- Integration channels are auto-created from registered adapters.
- Alert roles are auto-created from Discord channel categories for non-UMA integrations; UMA integrations keep their individual UMA alert roles.
- Current adapters include Bonbast USD/IRR, AAA Regular Gas, All-In Podcast, Aligned Layer Sale, Artist Album Releases, Artist Song Releases, Arena AI No Style Control, AWS Disrupted Events, Bank of Israel Decision, Based Revenue, BEA Current Releases, Bank Indonesia JISDOR USD/IDR, Billboard 200 #1 Album, Billboard Hot 100 #1 Song, BLS CPI Releases, BLS Jobs Added, CDC General Fertility Rate, CDC Flu Hospitalization Rate, CDC Measles Cases, Census Durable Goods Orders, ChatGPT Outage Days, Claude Code Commits, Claude Code 7D Avg, Claude Downtime Days, Cloudflare Critical Incidents, Discord Critical Incidents, ECDSA.fail Quantum Benchmark, EIA Crude Oil SPR Stocks, Ethereum Monthly Gas, Elon X Posts, FDIC Failed Bank List, FRED Egg Price, FRED Ground Beef Price, Free App Store Top 5, Paid App Store Top 5, Paris Heat Wave, Joe Rogan Podcast, Justin Bieber Monthly Listeners, Lemonade Stand Podcast, Parcl DC Metro Home Value, Parcl NYC Home Value, PBoC Rate Change, PortWatch Bab el-Mandeb Arrivals, Powerball Jackpot, Pump.fun GO, Polymarket Mention Markets, Polymarket Status, Reserve Bank of New Zealand Decision, UMA Clarification Alerts, UMA Proposal Alerts, UMA Vote Commits, UMA Vote Reveals, UMA.rocks, ISM Services PMI, ISW Ukraine Map, Kaito Polymarket Mindshare, KPop Song Releases, Met Office London Precipitation, Mt. Washington Wind Speed, MrBeast Gaming Videos, MrBeast YouTube Subscribers, MrBeast YouTube Views, NASA GISTEMP Temperature, NBS Press Releases, NCEI U.S. Tornadoes, NYT Front Page, NPM private valuation monitors, NOAA daily rain cities, ORNN B200 Index, ORNN H100 Index, ORNN H200 Index, Pyth Natural Gas Strikes, Pyth WTI Strikes, Pyth XAGUSD Strikes, Pyth XAUUSD Strikes, Silver Trump Approval, Spider-Man Trailer, Spotify Top 50 USA, Spotify Top 50 Global, Strategy Bitcoin Purchases, Tesla Deliveries, Treasury MTS Deficit, Trump Getty Photos, Trump Schedule, Trump Truth Social, TSA Passenger Volumes, UFO Files, UMich Consumer Sentiment, USGS 5.5+ Earthquakes, USGS 6.5+ Earthquakes, USGS 7.0+ Earthquakes, USGS 7.0+ Earthquakes 2026, Volmex BVIV Low Strikes, Volmex EVIV High Strikes, White House Alien Arrests NYC, White House Briefings, White House Full Lid, White House X Posts, HKO Hong Kong Precipitation, KMA Seoul Precipitation, NOAA NYC Precipitation, and NOAA Seattle Precipitation.

## Current Integrations

| Adapter ID | Command | Channel | Alert Role | Emoji | Description |
| --- | --- | --- | --- | --- | --- |
| `bonbast-usd-irr` | `/monitor` | `#bonbast-usd-irr` | `Bonbast Alerts` | `💱` | Monitors Bonbast USD/IRR values and auto-discovers active hit-by and end-of-month USD/IRR Polymarket markets. |
| `cross-platform-arbitrage` | `/monitor` | `#arb` | `Arbitrage Alerts` | `🔁` | Monitors configured Polymarket, Predict, and Opinion market URLs for after-fee cross-platform arbitrage routes. |
| `aaa-regular-gas` | `/monitor` | `#aaa-regular-gas` | `AAA Gas Alerts` | `⛽` | Monitors AAA national Current Avg. Regular gas price for Polymarket resolution checks. |
| `all-in-podcast` | `/monitor` | `#allinpod` | `All-In Podcast Alerts` | `🎧` | Monitors the All-In YouTube channel feed every minute for new non-Shorts uploads, suppresses same-video source-format flips, and auto-discovers active weekly All-In Polymarket markets. |
| `joe-rogan-podcast` | `/monitor` | `#joerogan` | `Joe Rogan Alerts` | `🎤` | Monitors the Joe Rogan YouTube RSS feed every minute for new JRE uploads and auto-discovers weekly first-episode Polymarket markets. |
| `lemonade-stand-podcast` | `/monitor` | `#lemonade` | `Lemonade Stand Alerts` | `🍋` | Monitors the Lemonade Stand YouTube RSS feed every minute for new uploads with `Lemonade Stand` in the title and auto-discovers weekly Polymarket markets. |
| `aligned-layer-sale` | `/monitor` | `#alignedsale` | `Aligned Sale Alerts` | `⏸️` | Temporary monitor for sale.alignedlayer.com page and app-bundle changes while the token sale is on hold. |
| `apple-artist-song-releases` | `/monitor` | `#songreleases` | `Artist Song Release Alerts` | `🎶` | Monitors Apple Music/iTunes for new 2026 songs by unresolved artists parsed from the Polymarket market. |
| `apple-artist-album-releases` | `/monitor` | `#albumreleases` | `Artist Album Release Alerts` | `💿` | Monitors Apple Music/iTunes for new 2026 albums by unresolved artists parsed from the Polymarket market. |
| `arena-ai-no-style-control` | `/monitor` | `#arenaai` | `Arena AI Alerts` | `🤖` | Monitors the top 3 models on Arena AI's overall no-style-control leaderboard. |
| `aws-disrupted-events` | `/monitor` | `#aws-disrupted` | `AWS Disrupted Alerts` | `⚠` | Monitors AWS Health Dashboard history events for disrupted service interruption events in the June 30 market window. |
| `bank-of-israel-decision` | `/monitor` | `#boidecision` | `Bank of Israel Alerts` | `🇮🇱` | Monitors official Bank of Israel interest-rate decision releases, polls fast around scheduled publication dates, and auto-discovers monthly BOI decision markets. |
| `reserve-bank-new-zealand-decision` | `/monitor` | `#rbnzdecision` | `RBNZ Decision Alerts` | `🇳🇿` | Monitors official RBNZ OCR decision data, polls fast around scheduled OCR update dates, and auto-discovers monthly RBNZ decision markets. |
| `based-revenue` | `/monitor` | `#basedrevenue` | `Based Revenue Alerts` | `💵` | Monitors Dune query results for Based cumulative revenue updates. |
| `bea-current-releases` | `/monitor` | `#bea-releases` | `BEA Release Alerts` | `📰` | Monitors BEA Current Releases hourly and alerts when the latest article changes. |
| `bi-jisdor-usd-idr` | `/monitor` | `#jisdor` | `BI JISDOR Alerts` | `🇮🇩` | Monitors Bank Indonesia JISDOR USD/IDR reference rates for Polymarket resolution checks. |
| `billboard-200-number-one-album` | `/monitor` | `#billboard200` | `Billboard 200 Alerts` | `💿` | Monitors the dated Billboard 200 chart for the #1 album and auto-discovers weekly chart markets. |
| `billboard-hot-100-number-one-song` | `/monitor` | `#billboardhot100` | `Billboard Hot 100 Alerts` | `🎵` | Monitors the dated Billboard Hot 100 chart for the #1 song and auto-discovers weekly chart markets. |
| `bls-cpi-releases` | `/monitor` | `#blscpi-releases` | `BLS CPI Release Alerts` | `📈` | Monitors BLS CPI archived news releases hourly and alerts when the latest article changes. |
| `bls-jobs-added` | `/monitor` | `#jobsadded` | `BLS Jobs Added Alerts` | `💼` | Monitors BLS Employment Situation total nonfarm payroll employment change and auto-discovers monthly jobs-added markets. |
| `cdc-fertility-rate` | `/monitor` | `#fertility` | `CDC Fertility Alerts` | `👶` | Monitors CDC natality dashboard 2026 Q1 general fertility rate publication. |
| `cdc-flu-hospitalization` | `/monitor` | `#fluhosp` | `CDC Flu Hosp Alerts` | `🏥` | Monitors CDC FluView/FluSurv-NET cumulative influenza hospitalization rates and auto-discovers weekly flu hospitalization markets. |
| `cdc-measles` | `/monitor` | `#measles` | `CDC Measles Alerts` | `🦠` | Monitors CDC's 2026 confirmed U.S. measles total cases counter and auto-discovers concurrent active measles markets. |
| `census-durable-goods` | `/monitor` | `#durablegoods` | `Durable Goods Alerts` | `🏭` | Monitors the Census Advance Durable Goods May 2026 MoM new orders report and only polls fast on release day. |
| `openai-chatgpt-outages` | `/monitor` | `#chatgptoutage` | `ChatGPT Outage Alerts` | `🟠` | Monitors OpenAI Status for resolved ChatGPT partial/full outage days, sends one daily report for each completed ET day, shows all partial/full outages for manual review, and auto-discovers monthly outage markets. |
| `claude-code-commits` | `/monitor` | `#claudecommits` | `Claude Commits Alerts` | `💻` | Monitors Claude Code Commits Tracker daily data and alerts once when unresolved high/low targets are hit. |
| `claude-code-commits-average` | `/monitor` | `#claudeavg` | `Claude Avg Alerts` | `📈` | Monitors Claude Code Commits Tracker 7D Avg Commits for the end-of-June bracket market, with final-window worst-case analysis. |
| `claude-downtime` | `/monitor` | `#claudedown` | `Claude Downtime Alerts` | `🔴` | Monitors Claude Status claude.ai uptime boxes, sends one daily report for each newly finalized day, and alerts once for finalized non-green days. |
| `cloudflare-critical-incidents` | `/monitor` | `#cloudflare-critical` | `Cloudflare Critical Alerts` | `🔴` | Monitors Cloudflare's official incidents API for Critical/red incidents. |
| `discord-critical-incidents` | `/monitor` | `#discord-critical` | `Discord Critical Alerts` | `🔴` | Monitors Discord's official incidents API for Critical/red incidents and auto-discovers monthly by-date markets. |
| `ecdsa-fail` | `/monitor` | `#ecdsafail` | `ECDSA Fail Alerts` | `🔐` | Monitors ECDSA.fail benchmark API for the percent ahead of Google's classified circuit. |
| `eia-crude-spr` | `/monitor` | `#eia-crude-spr` | `EIA Crude SPR Alerts` | `⛽` | Monitors EIA weekly U.S. Ending Stocks of Crude Oil in the Strategic Petroleum Reserve. |
| `ethereum-gas-monthly-average` | `/monitor` | `#ethgasmonthly` | `ETH Gas Monthly Alerts` | `⛽` | Monitors Dune Ethereum Gas Prices query 1887488 for the latest finalized monthly `mean_gas` value. |
| `elon-x-strikes` | `/monitor` | `#elonx` | `Elon X Alerts` | `🚀` | Monitors @elonmusk posts through a free XCancel/Nitter-style public page reader and parsed weekly Polymarket strike terms. |
| `fdic-failed-banks` | `/monitor` | `#fdic-failed-banks` | `FDIC Failed Bank Alerts` | `🏦` | Monitors the latest row in the FDIC Failed Bank List for new bank failures. |
| `fred-egg-price` | `/monitor` | `#eggs` | `FRED Egg Price Alerts` | `🥚` | Monitors monthly FRED Eggs, Grade A, Large cost per dozen, auto-discovers monthly egg-price markets, and uses release-date polling. |
| `fred-ground-beef` | `/monitor` | `#beef` | `FRED Ground Beef Alerts` | `🥩` | Monitors FRED 2026 Ground beef, 100% beef cost per pound and release-date polling. |
| `free-app-store` | `/monitor` | `#freeappstore` | `Free App Store Alerts` | `🆓` | Shows the US iPhone App Store Top Free Apps top 5, alerts only when the top 2 change, and auto-discovers daily #1/#2 Free App Store markets. |
| `nbs-press-release` | `/monitor` | `#nbs-press` | `NBS Press Release Alerts` | `🇨🇳` | Monitors China NBS English press releases hourly and alerts when the latest item changes. |
| `ornn-b200-index` | `/monitor` | `#ornnb200` | `ORNN B200 Alerts` | `🖥️` | Monitors finalized ORNN B200 Index daily chart values and auto-discovers concurrent active B200 GPU rental-price markets. |
| `ornn-h100-index` | `/monitor` | `#ornnh100` | `ORNN H100 Alerts` | `🖥️` | Monitors finalized ORNN H100 Index daily chart values and auto-discovers concurrent active H100 GPU rental-price markets. |
| `ornn-h200-index` | `/monitor` | `#ornnh200` | `ORNN H200 Alerts` | `🖥️` | Monitors finalized ORNN H200 Index daily chart values and auto-discovers concurrent active H200 GPU rental-price markets. |
| `paid-app-store` | `/monitor` | `#paidappstore` | `Paid App Store Alerts` | `💰` | Shows the US iPhone App Store Top Paid Apps top 5, alerts only when the top 2 change, and auto-discovers daily Paid App Store markets. |
| `paris-heat-wave` | `/monitor` | `#parisheat` | `Paris Heat Alerts` | `🌡️` | Monitors Wunderground Paris-Le Bourget daily high temperatures and alerts when qualifying >=35°C heat-wave days or streak status changes. |
| `parcl-dc-home-value` | `/monitor` | `#dchomevalue` | `DC Home Value Alerts` | `🏠` | Monitors Parcl DC Metro Sales Price Index data and calculates the June 30 median home-value settlement. |
| `parcl-nyc-home-value` | `/monitor` | `#nychomevalue` | `NYC Home Value Alerts` | `🏙️` | Monitors Parcl NYC Sales Price Index data and calculates the June 30 median home-value settlement. |
| `pboc-rate-change` | `/monitor` | `#pboc` | `PBoC Rate Alerts` | `🏦` | Monitors PBoC official announcements for extracted operation-rate changes in the June rate-change market. |
| `powerball-jackpot` | `/monitor` | `#powerball` | `Powerball Jackpot Alerts` | `🎰` | Monitors Powerball's official estimated jackpot once daily for the $1B July 31 market trend. |
| `pump-fun-go` | `/monitor` | `#pumpgo` | `Pump GO Alerts` | `🏁` | Monitors pump.fun GO page and public bounties API every minute, alerting only when GO availability status changes for the Predict.fun disable market. |
| `rwa-total-value` | `/monitor` | `#rwatotal` | `RWA Total Value Alerts` | `🏦` | Monitors the RWA.xyz Total RWA Value chart hourly with 7d/30d rate-of-change analysis using distributed assets excluding stablecoins and cryptocurrency. |
| `polymarket-mention-markets` | `/monitor` | `#mentions` | `Polymarket Mentions Alerts` | `💬` | Alerts when a new active Polymarket event appears under the Mentions tag. |
| `polymarket-status` | `/monitor` | `#polymarketstatus` | `Polymarket Status Alerts` | `🟣` | Monitors the official Polymarket status page every minute and alerts when page status, component status, or active maintenances change. |
| `polymarket-clarifications` | `/umaclarifications` | `#uma-clarifications` | `UMA Clarification Alerts` | `📣` | Alerts on Polymarket UMA bulletin-board clarification updates on Polygon. |
| `polymarket-disputes` | `/umadispute` | `#uma-disputes` | `UMA Dispute Alerts` | `⚖️` | Alerts when Polymarket UMA resolution proposals are disputed on-chain. |
| `polymarket-proposals` | `/umaproposals` | `#uma-proposals` | `UMA Proposal Alerts` | `📨` | Alerts when Polymarket UMA resolution proposals open on-chain for configured Polymarket tags. |
| `polymarket-resolvable` | `/monitor` | `#resolvable` | `Resolvable Alerts` | `✅` | Watches manually added Polymarket URLs or raw question IDs until the market is ready to resolve or already resolved on CTF, then alerts and removes the market. |
| `portwatch-bab-el-mandeb` | `/monitor` | `#babmandeb` | `Bab el-Mandeb Alerts` | `🚢` | Monitors IMF PortWatch Bab el-Mandeb Arrivals of Ships data every minute with latest 14 daily values, moving averages, and optional MarineTraffic alpha context. |
| `portwatch-hormuz-ships` | `/monitor` | `#hormuzships` | `Hormuz Ships Alerts` | `🚢` | Monitors IMF Portwatch Strait of Hormuz transit-call data every minute, reports total and average calls, optional MarineTraffic alpha context, and auto-discovers weekly ships markets. |
| `uma-vote-commits` | `/umacommits` | `#uma-commits` | `UMA Commit Alerts` | `🔒` | Alerts when Ethereum UMA Voting v2 commit or recommit events come from voters above the configured staked UMA threshold. |
| `uma-vote-reveals` | `/umareveals` | `#uma-reveals` | `UMA Reveal Alerts` | `👁️` | Alerts when Ethereum UMA Voting v2 reveal events meet the configured staked UMA threshold. |
| `uma-voting-committee` | `/umarocks` | `#umarocks` | `UMA.rocks Alerts` | `🗳️` | Monitors UMA.rocks voting committee GitHub answer changes and contributor comments for the active voting round. |
| `pyth-natural-gas-strikes` | `/monitor` | `#ngprice` | `NG Price Alerts` | `⛽` | Monitors the top Pyth Natural Gas ticker, alerts only on strike crossings, and auto-discovers monthly NG price markets. |
| `pyth-wti-strikes` | `/monitor` | `#wti` | `WTI Price Alerts` | `🛢️` | Monitors the top Pyth WTI ticker, alerts only on strike crossings, and auto-discovers monthly WTI price markets. |
| `pyth-xagusd-strikes` | `/monitor` | `#xagusd` | `XAGUSD Price Alerts` | `🥈` | Monitors the Pyth XAGUSD feed, alerts only on strike crossings, and auto-discovers monthly silver price markets. |
| `pyth-xauusd-strikes` | `/monitor` | `#xauusd` | `XAUUSD Price Alerts` | `🥇` | Monitors the Pyth XAUUSD feed, alerts only on strike crossings, and auto-discovers monthly gold price markets. |
| `silver-trump-approval` | `/monitor` | `#trumpapproval` | `Trump Approval Alerts` | `📊` | Monitors Silver Bulletin's Trump approval trend-line data, auto-discovers overlapping single-date and weekly Up/Down markets, and alerts on finalized results. |
| `spotify-bieber-monthly-listeners` | `/monitor` | `#bieberlisteners` | `Bieber Listeners Alerts` | `🎧` | Monitors Justin Bieber's public Spotify artist profile monthly-listener count and parsed hit-by thresholds from the active Polymarket market. |
| `spider-man-trailer` | `/monitor` | `#spiderman` | `Spider-Man Trailer Alerts` | `🕷️` | Monitors Spider-Man, Sony Pictures, Marvel, and Sony YouTube RSS feeds every minute for post-market Spider-Man: Brand New Day trailer/teaser uploads. |
| `spotify-top-50-usa` | `/monitor` | `#spotifyusa` | `Spotify USA Top 50 Alerts` | `🎵` | Monitors Kworb's Spotify USA daily top 10 chart details while keeping the official Spotify playlist link, and auto-discovers monthly USA artist #1 markets. |
| `spotify-top-50-global` | `/monitor` | `#spotifyglobal` | `Spotify Global Top 50 Alerts` | `🎵` | Monitors Kworb's Spotify Global daily top 10 chart details while keeping the official Spotify playlist link, and auto-discovers monthly global artist #1 markets. |
| `strategy-bitcoin-purchases` | `/monitor` | `#strategybtc` | `Strategy BTC Alerts` | `🪙` | Monitors Strategy's Bitcoin Purchases page for announcements in the active weekly Polymarket date range and auto-discovers new weekly markets. |
| `tesla-deliveries` | `/monitor` | `#tesla` | `Tesla Deliveries Alerts` | `🚗` | Monitors Tesla production and deliveries press releases for Q2 2026 delivery updates. |
| `treasury-mts-deficit` | `/monitor` | `#treasurymts` | `Treasury MTS Alerts` | `🧾` | Monitors FiscalData Monthly Treasury Statement table 1 current-month deficit/surplus rows and alerts when a new report month or amount appears. |
| `trump-getty-photos` | `/monitor` | `#trumpgetty` | `Trump Getty Alerts` | `📸` | Monitors Getty tagged editorial Donald Trump photo coverage by day using the public Getty search page reader fallback. |
| `trump-schedule` | `/monitor` | `#trumpschedule` | `Trump Schedule Alerts` | `🗓️` | General Roll Call Factbase daily Trump schedule feed with compact change alerts and no default Polymarket URL. |
| `trump-truth` | `/monitor` | `#trumptruth` | `Trump Truth Alerts` | `📰` | Monitors the Trump's Truth archive feed for @realDonaldTrump posts and parsed weekly Polymarket strike terms. |
| `tsa-passengers` | `/monitor` | `#tsa` | `TSA Passenger Alerts` | `✈️` | Sums TSA daily checkpoint throughputs for the date range parsed from the Polymarket URL. |
| `umich-consumer-sentiment` | `/monitor` | `#umichsentiment` | `UMich Sentiment Alerts` | `📊` | Monitors UMich Surveys of Consumers final monthly Index of Consumer Sentiment, auto-discovers monthly markets, and polls fast around the scheduled release. |
| `ufo-files` | `/monitor` | `#ufofiles` | `UFO Files Alerts` | `🛸` | Monitors official U.S. government UFO/UAP file inventories across NARA, AARO, and FBI sources for added or changed file links. |
| `usgs-earthquakes` | `/monitor` | `#earthquake` | `USGS Earthquake Alerts` | `🌎` | Tracks the USGS count of 5.5+ earthquakes in the active weekly market window and alerts on count increases or revision-driven decreases. |
| `usgs-earthquakes-6-5` | `/monitor` | `#earthquake65` | `USGS 6.5 Earthquake Alerts` | `🌏` | Tracks the USGS count of 6.5+ earthquakes in the active weekly market window and auto-discovers upcoming 6.5 weekly markets. |
| `usgs-earthquakes-7-plus` | `/monitor` | `#earthquake7` | `USGS 7.0 Earthquake Alerts` | `🌋` | Tracks the Dec 4-Jun 30 7.0+ earthquake market and includes the overlapping full-year 2026 count in each alert. |
| `usgs-earthquakes-7-plus-2026` | `/monitor` | `#earthquake2026` | `USGS 2026 Earthquake Alerts` | `📅` | Tracks the full-year 2026 7.0+ earthquake market and includes the overlapping Dec 4-Jun 30 count in each alert. |
| `volmex-bviv-low-strikes` | `/monitor` | `#bviv` | `BVIV Alerts` | `📉` | Monitors Volmex BVIV 1-minute low candles and alerts once when tracked low strikes are crossed. |
| `volmex-eviv-high-strikes` | `/monitor` | `#eviv` | `EVIV Alerts` | `📈` | Monitors Volmex EVIV 1-minute high candles and alerts once when tracked high strikes are crossed. |
| `white-house-aliens-nyc` | `/monitor` | `#aliennyc` | `Alien NYC Arrests Alerts` | `🛸` | Monitors the White House aliens table Total Arrests counter for New York, NY. |
| `white-house-briefings` | `/monitor` | `#whbriefings` | `White House Briefing Alerts` | `🏛️` | Monitors White House Briefings & Statements and alerts on every newly listed message. |
| `white-house-full-lid` | `/monitor` | `#fulllid` | `White House Lid Alerts` | `🧢` | Monitors Roll Call and Forth for the first daily White House full lid and labels whether it was before 6:30 PM ET. |
| `white-house-tweets` | `/monitor` | `#whitehousetweets` | `White House Tweet Alerts` | `🐦` | Counts @WhiteHouse X posts in overlapping weekly noon-to-noon ET markets and sends hourly summary alerts for newly captured posts. |
| `hk-precip` | `/monitor` | `#hkprecip` | `HKO Hong Kong Precip Alerts` | `☔` | Monitors HKO Hong Kong monthly rainfall, using Yesterday's Weather as an alpha add-on before Daily Extract catches up. |
| `ism-services-pmi` | `/monitor` | `#ismpmi` | `ISM PMI Alerts` | `📊` | Monitors the ISM Services PMI May 2026 report and polls faster around the scheduled release day. |
| `isw-ukraine-map` | `/monitor` | `#iswmap` | `ISW Map Alerts` | `🗺️` | Monitors the ISW ArcGIS StoryMaps Ukraine frontline geometry notice every minute and alerts when the daily started/finalized notice changes. |
| `kaito-polymarket-mindshare` | `/monitor` | `#kaitomindshare` | `Kaito Mindshare Alerts` | `🧠` | Monitors finalized Kaito Info Markets Historical Data rows for Polymarket mindshare. |
| `apple-kpop-song-releases` | `/monitor` | `#kpopreleases` | `KPop Song Release Alerts` | `🎤` | Monitors Apple Music/iTunes for new 2026 songs by unresolved KPop groups parsed from the Polymarket market. |
| `kma-seoul-precip` | `/monitor` | `#koreaprecip` | `KMA Seoul Precip Alerts` | `☔` | Monitors KMA Seoul monthly precipitation for Polymarket resolution checks. |
| `met-office-london-precip` | `/monitor` | `#londonprecip` | `Met Office London Precip Alerts` | `☔` | Monitors Met Office Heathrow station rain mm, with Infoclimat cumulative alpha plus Weather.com PWS fallback before the Met Office monthly row appears. |
| `mt-washington-wind` | `/monitor` | `#mtwind` | `Mt Washington Wind Alerts` | `💨` | Monitors Mt. Washington Observatory monthly F6 PDFs for the highest summit wind speed in July 2026, using the FASTEST MILE / peak gust column. |
| `mrbeast-gaming-video` | `/monitor` | `#mrbeastgaming` | `MrBeast Gaming Alerts` | `🎮` | Monitors the MrBeast Gaming YouTube RSS feed every minute for new uploads tied to the next-gaming-video Polymarket market. |
| `mrbeast-subscribers` | `/monitor` | `#mrbeastsubs` | `MrBeast Subs Alerts` | `👥` | Polls MrBeast YouTube channel subscriber metadata every minute with rate and Polymarket target projections. |
| `mrbeast-views` | `/monitor` | `#mrbeastviews` | `MrBeast Views Alerts` | `👀` | Polls MrBeast YouTube channel total-view metadata every minute, auto-discovers active billion-view markets, and shows compact target summaries. |
| `nasa-gistemp-temperature` | `/monitor` | `#gistemp` | `NASA GISTEMP Alerts` | `🌡️` | Monitors NASA GISTEMP Global Land-Ocean Temperature Index monthly anomaly cells. |
| `noaa-atlanta-rain` | `/monitor` | `#atlantarain` | `NOAA Atlanta Rain Alerts` | `☔` | Monitors NOAA Atlanta Area daily precipitation for the June 9 rain market and alerts when the value finalizes. |
| `noaa-boston-rain` | `/monitor` | `#bostonrain` | `NOAA Boston Rain Alerts` | `☔` | Monitors NOAA Boston Area daily precipitation for the June 9 rain market and alerts when the value finalizes. |
| `noaa-dallas-rain` | `/monitor` | `#dallasrain` | `NOAA Dallas Rain Alerts` | `☔` | Monitors NOAA Dallas Area daily precipitation for the June 9 rain market and alerts when the value finalizes. |
| `noaa-denver-rain` | `/monitor` | `#denverrain` | `NOAA Denver Rain Alerts` | `☔` | Monitors NOAA Denver Area daily precipitation for the June 9 rain market and alerts when the value finalizes. |
| `noaa-nyc-precip` | `/monitor` | `#nycprecip` | `NOAA NYC Precip Alerts` | `☔` | Monitors NOAA NYC monthly precipitation with latest daily row details so new 0.00 or trace days still alert. |
| `noaa-san-francisco-rain` | `/monitor` | `#sfrain` | `NOAA SF Rain Alerts` | `☔` | Monitors NOAA San Francisco City daily precipitation for the June 9 rain market and alerts when the value finalizes. |
| `noaa-seattle-precip` | `/monitor` | `#seattleprecip` | `NOAA Seattle Precip Alerts` | `☔` | Monitors NOAA Seattle monthly precipitation with latest daily row details so new 0.00 or trace days still alert. |
| `ncei-tornadoes` | `/monitor` | `#tornadoes` | `NCEI Tornado Alerts` | `🌪️` | Monitors NCEI U.S. Tornadoes monthly time-series counts, preliminary status, chart uncertainty range, and auto-discovers monthly tornado markets. |
| `nyt-front-page` | `/monitor` | `#nytfront` | `NYT Front Page Alerts` | `📰` | Monitors New York edition NYT front-page headline strikes, highlights OCR matches in the page image, auto-discovers weekly NYT Polymarket markets, and rechecks latest issues until a matched alert is claimed. |
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
- Integrations are code-defined adapters in `src/integrations/` and registered in `src/integrations/registry.ts`.
- One adapter normally creates one monitor channel. Non-UMA integrations use the generic `/monitor` command inside that channel; UMA integrations keep individual UMA command groups, individual UMA alert roles, and reaction selectors. Non-UMA alert pings use the Discord category role for the channel's current parent category, so moving a channel to another category changes the role it pings after the next sync. UMA Proposal Alerts also manages tag-specific alert channels from its configured tag filters. The provisioner also creates `#errorlogs` for centralized check-failure posts and `#bot-status` for runtime health/restart alerts.
- Shared integration commands are generated in `src/commands.ts`: `/monitor status`, `check`, `last`, `updates`, `polymarket`, `enddate`, `interval`, `turbo`, `pause`, `archive`, `resume`; channel-specific capability commands such as `period`, `snapshot`, `strikes`, `search`, `tagsearch`, `tags`, `watchlist`, `threshold`, `setup`, and `watch` are visible under `/monitor` but only execute in channels whose adapter supports them. Channel cleanup is bot-level through `/bot clear`; server-wide fetch-only smoke checks are queued through `/bot checkall`.
- Discord allows 100 guild slash commands per app. `src/registerCommands.ts` enforces this cap; normal monitors share `/monitor` so new integrations do not consume one command each.
- Channel names should identify the monitor topic, while the command is `/monitor` for non-UMA channels.
- Shared Discord UI lives in `src/embeds.ts`; keep new integration replies/alerts using these embed builders.
- Event alerts can put noisy metadata in `hiddenFields`; Discord shows it only through the shared `Show more` button.
- Polling and alert sends live in `src/poller.ts`; reaction-role add/remove logic lives in `src/reactionRoles.ts`.
- UMA Vote Commits polls Ethereum UMA Voting v2 `VoteCommitted` logs every minute, estimates voter stake with `getVoterStakePostUpdate(address)`, detects recommits from repeated voter/request commit keys, filters by `/umacommits threshold`, and reports tracked threshold-qualified current-cycle commit counts in `/umacommits check`.
- UMA Vote Reveals polls Ethereum UMA Voting v2 `VoteRevealed` logs every minute and filters by `/umareveals threshold`.
- Market-end reminder lookup lives in `src/marketEnd.ts`; it uses queued ET windows when available, otherwise Polymarket Gamma API `endDate` by URL slug, stores the result in SQLite, backs off failed Gamma lookups, sends shared 24h, 12h, 1h, and end alerts, and suppresses rollover reminders when a successor queued market is already stored.
- SQLite stores integration state, Polymarket URL, market-end metadata, adapter settings JSON, timestamps, and role metadata; keep timestamps as ISO strings.
- Daily snapshot integrations store snapshot value/date separately from regular interval `lastValue` checks so event-time captures are not overwritten.
- Dated/monthly Polymarket URLs are queued in `settingsJson.polymarketMarkets` by `src/polymarketQueue.ts`; the active URL changes automatically by ET window, expired queued URLs are pruned after rollover, and the stored current URL remains as fallback even after expiry so source monitoring keeps running. Some monitors intentionally keep multiple active markets for one source, such as ORNN GPU July, hit-in-2026, and end-of-2026 markets; display all active markets when more than one is live, but do not treat market-list-only changes as source value changes.
- Market URL rollover sends a dedicated `Market rollover` alert and stores the newly fetched source value as the baseline, so the bot does not mislabel window-only changes as normal `Value changed` alerts.
- Shared settings helpers live in `src/settingsJson.ts`; use them for cross-adapter `settingsJson` reads, merges, and key deletion. Optional refresh writes should use `BotDatabase.setSettingsJsonIfChanged()` so unchanged settings do not bump `updatedAt`.
- UFO Files fingerprints official UFO/UAP file-link inventories from NARA, AARO, and FBI sources; NARA is fetched directly while AARO/FBI use `r.jina.ai` mirrors because direct Node fetches are blocked.
- Trump Truth, Elon X, All-In Podcast, Joe Rogan Podcast, Lemonade Stand Podcast, App Store daily charts, NYT Front Page, NPM monthly private valuations, monthly precipitation, ChatGPT Outage, Claude Downtime, Discord Critical, TSA, Tesla Deliveries, Strategy Bitcoin Purchases, Bank of Israel Decision, Reserve Bank of New Zealand Decision, USGS 5.5/6.5 Earthquakes, Portwatch Hormuz Ships, White House Full Lid, White House X Posts, NCEI Tornadoes, BLS Jobs Added, CDC Flu Hospitalization, CDC Measles, Spotify monthly artist #1 markets, and Pyth price-strike bots have adapter-specific auto-discovery for upcoming recurring markets; keep this inside the adapter unless the behavior becomes clearly reusable.

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
   ELON_X_NITTER_BASE_URLS=https://xcancel.com
   MARINETRAFFIC_HORMUZ_ALPHA_URL=...
   MARINETRAFFIC_BAB_ALPHA_URL=...
   ```

   `DUNE_API_KEY` is required for `#basedrevenue` and `#ethgasmonthly`. `/trumpgetty` does not use Getty API credentials. It reads the public Getty search page through the reader fallback.

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
Use `/monitor turbo seconds:<seconds> duration-minutes:<minutes>` to temporarily poll the current channel faster. Turbo is stored in `settingsJson`, takes effect within a few seconds, overrides adapter dynamic intervals while active, and expires automatically. Use `/monitor turbo seconds:0` to turn it off early. Minimum turbo interval is 5 seconds; maximum duration is 24 hours.

Use `/monitor archive` when a market is done but the adapter should remain available for future market restarts. Archive sets the integration to `paused`, stores `archivedAt` plus optional `archiveReason` in `settingsJson`, and leaves the channel, role, source code, Polymarket URL, last values, and update logs intact. `/monitor resume` clears archive metadata and resumes polling.
Use `/monitor updates` in each channel to review recent detected update times and rough SGT/ET hour patterns. Update logs begin from deployment and are not backfilled.
Use `/bot summarize` anywhere in the server to list all integrations with resolution source, Polymarket URL, parsed market end, and polling interval.
Use `/bot checkall` to queue a fetch-only smoke check for every active non-UMA integration. It checks one monitor at a time with a configurable delay, posts one editable progress message in the command channel, posts one smoke-check result in each integration channel, and does not update stored values or mention alert roles.
Check-failure errors are posted to `#errorlogs` when that channel exists. The bot keeps one editable `Check failed` post per integration, updates repeated failures there, and falls back to the integration channel only if `#errorlogs` is unavailable. Use `/bot clearerrors` to scan integration channels plus `#errorlogs` and delete old bot `Check failed` messages; by default it keeps only the newest failure per channel. Use `keep-latest:false` to remove all existing failure messages.
Use `/bot pruneroles mode:preview` to list stale Discord roles ending in `Alerts` that are no longer referenced by the current category-role or UMA-role mapping. Use `/bot pruneroles mode:delete` only after previewing; by default it skips stale roles that still have members unless `include-member-roles:true` is provided.
Arbitrage replies are alert-only. `/monitor setup` in `#arb` asks for a shared outcome and YES/NO/BOTH side through dropdowns, then alerts only when the best route is positive after configured platform fees and the minimum edge. Alerts include the buy/sell platform, side, executable amount, fees, and expected profit. Predict and Opinion checks require their API keys in `.env`.
MarineTraffic alpha for `#hormuzships` and `#babmandeb` is optional. The public MarineTraffic map blocks bot fetches; use official MarineTraffic/Kpler export URLs in `MARINETRAFFIC_HORMUZ_ALPHA_URL` and `MARINETRAFFIC_BAB_ALPHA_URL` if you have API/export access. If unset, PortWatch output is unchanged.
Bonbast replies use Discord embeds with compact fields, colored status accents, and clickable links.
Use `/monitor polymarket` once per market so future alerts include a clickable Polymarket link.
The stored Polymarket URL also drives market-end reminders. For queued dated URLs, the bot uses the ET-derived queue end time; otherwise it reads the market `endDate` from Polymarket Gamma API once per integration/Polymarket URL, stores it locally, and alerts 24 hours before, 12 hours before, 1 hour before, and at the returned end time. If a later queued market is already stored for the integration, rollover reminders for the current market are skipped. If Gamma does not return an `endDate`, the bot sends one warning in that integration channel instead of repeatedly querying Gamma. Failed Gamma lookups back off before retrying so a VPN/DNS/API outage does not flood logs. Use `/monitor enddate` in the channel to manually set the end time in ET, for example `/monitor enddate datetime:2026-05-10 23:59`.
Use `/bot clear` to clear the current text channel. You and the bot both need `Manage Messages`.

## Raspberry Pi Health Alerts

Production on the Pi has three moving parts:

- `discord-bot.service` runs Guangdang Bot through `npm run dev`.
- The existing deploy cron runs `deploy.sh` every minute; it pulls `origin/main`, builds, registers commands, and restarts `discord-bot.service` only when GitHub has a new commit.
- `scripts/rpi-discord-watchdog.sh` is the local watchdog. It checks the bot heartbeat, posts health alerts to `#bot-status`, and restarts `discord-bot.service` when the heartbeat is stale or the service is not active.

The main bot writes `.health/bot-heartbeat.json` every `BOT_HEARTBEAT_INTERVAL_SECONDS` while the Node process is alive. The provisioner creates `#bot-status`, and the bot posts a startup message there after each successful login. The watchdog can post to the same channel through `DISCORD_HEALTH_WEBHOOK_URL`; if no webhook is configured, it falls back to the normal `DISCORD_TOKEN` and `DISCORD_GUILD_ID` to find or create `#bot-status`.

Health channel policy:

- `#bot-status`: only bot lifecycle and liveness events: startup, Pi boot, stale/missing heartbeat, inactive service, watchdog restart attempt/result, recovery after unhealthy state, and fatal runtime errors such as uncaught exceptions or startup/login failures.
- `#errorlogs`: integration check failures only. The poller keeps one editable failure post per integration and updates repeated failures there.
- Healthy-service retry noise, such as transient Discord `UND_ERR_CONNECT_TIMEOUT` provisioning sends or scheduler send retries, stays in `journalctl` and `.health/watchdog.log`; it should not alert Discord unless it makes the heartbeat stale or service unhealthy.

Recommended Pi `.env` health settings:

```bash
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
DISCORD_HEALTH_WEBHOOK_URL=
HEALTHCHECKS_PING_URL=https://hc-ping.com/your-uuid
```

`BOT_RESTART_COMMAND` is optional. If unset, the watchdog runs `sudo -n systemctl restart discord-bot.service`. If that fails, either run the watchdog from root's cron/systemd or set `BOT_RESTART_COMMAND` to the exact command that works on the Pi.

Install or confirm the watchdog cron job on the Pi:

```bash
cd /home/financegeek/apps/discord-bot
mkdir -p .health
chmod +x scripts/rpi-discord-watchdog.sh
(crontab -l 2>/dev/null; echo '* * * * * cd /home/financegeek/apps/discord-bot && ./scripts/rpi-discord-watchdog.sh >> .health/watchdog-cron.log 2>&1') | crontab -
```

Common Pi commands:

```bash
cd /home/financegeek/apps/discord-bot

# Is the bot process active?
systemctl status discord-bot.service --no-pager -l

# Latest bot logs.
journalctl -u discord-bot.service -n 120 --no-pager

# Watch auto-deploy logs.
tail -n 80 deploy.log

# Watch watchdog logs.
tail -n 80 .health/watchdog.log
tail -n 80 .health/watchdog-cron.log

# Check the current deployed commit.
git rev-parse --short HEAD
git log -1 --oneline

# Manual restart.
sudo systemctl restart discord-bot.service

# Manual watchdog test.
./scripts/rpi-discord-watchdog.sh
```

What the watchdog reports as the "reason" is the concrete local evidence it sees: inactive service state, missing/stale heartbeat age, recent `journalctl` errors, and whether the restart command succeeded. It cannot send Discord alerts while the whole Pi or its internet connection is fully down. For true "Pi is unreachable" alerts, set `HEALTHCHECKS_PING_URL` from a Healthchecks.io check and configure that service to post missed-ping alerts into Discord.

## Polymarket URL Queue

For most integrations, `/... polymarket url:<url>` appends or updates a queued Polymarket URL in `settingsJson.polymarketMarkets`. If the URL slug contains a date range such as `may-18-may-24`, the bot derives an ET window, keeps the current market active until the new window starts, switches automatically on the next poll/check, suppresses old-market rollover reminders once a later queued market exists, and prunes expired queued URLs after rollover. When no queued dated market is active and there is no undated fallback, the bot keeps the stored current Polymarket URL as a fallback, even if expired, so source checks and alerts continue.

If a URL has no parseable date range, the bot keeps it as an undated fallback for that integration. Market-end reminders for queued dated URLs use the queue's ET-derived `endAt` instead of Gamma `endDate`. Trump Truth uses a specialized queue because it stores all terms, resolved terms, active terms, and Gamma refresh timestamps per weekly market. All-In Podcast, Joe Rogan Podcast, Lemonade Stand Podcast, Strategy Bitcoin Purchases, TSA, USGS Earthquakes, and White House Full Lid use the shared queue plus adapter-specific auto-discovery for upcoming weekly markets. Tesla Deliveries uses the shared queue plus adapter-specific auto-discovery for upcoming quarterly delivery markets. NCEI Tornadoes uses adapter-specific monthly windows with Gamma `endDate` because monthly markets overlap the next month until the NCEI release date.

Trump Truth also supports:

- `/trumptruth strikes`
- `/trumptruth search term:King`

The `strikes` command force-refreshes Gamma-derived strike terms and then displays the currently active unresolved terms.
The Trump Truth `search` command refreshes settings, searches the Trump Truth archive for a word or phrase inside the active weekly market's ET timeframe, and returns matching posts plus the source search URL.

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
- Portwatch Hormuz Ships monitors the IMF Portwatch `Daily_Chokepoints_Data` ArcGIS table for `portid='chokepoint6'`, sums `n_total` over the active weekly Polymarket window, reports the average over reported days, polls every minute, auto-discovers weekly Hormuz transit markets, and keeps the previous weekly window visible after rollover once delayed PortWatch data completes it.
- UMA Clarification Alerts subscribes to pending `postUpdate(bytes32,bytes)` transactions and mined `AncillaryDataUpdated` events from Polymarket's UMA bulletin-board contract on Polygon over WebSocket, defaults to PublicNode's free Polygon Bor WebSocket, and uses Nodies, OnFinality, dRPC, PublicNode, Tenderly, and QuickNode public endpoints for 1-minute HTTP backfill. Pending mempool alerts are best-effort and can arrive before mining; the mined-log path remains the confirmation/backfill. It can be pointed at another provider with `POLYGON_WS_URL`, `POLYGON_RPC_URL`, or comma-separated `POLYGON_RPC_URLS`.
- UMA Dispute Alerts subscribes to UMA OptimisticOracle `DisputePrice` events on Polygon, watches current and legacy oracle contracts, filters requester addresses to Polymarket UMA requester contracts including the bulletin board adapter, and uses 1-minute HTTP backfill plus CLOB `markets-by-question-id` enrichment.
- UMA Proposal Alerts subscribes to UMA OptimisticOracle `ProposePrice` events on Polygon, watches current and legacy oracle contracts, filters requester addresses to Polymarket UMA requester contracts including the bulletin board adapter, enriches each proposal through CLOB `markets-by-question-id`, alerts only when the returned market tags match configured `/umaproposals tags` filters, and adds a Penny pick liquidity field only when the CLOB book returns live asks for the proposed-side token. CLOB orderbook failures are shown in the main alert as `PENNY PICK CHECK`; non-error check details stay in Show more.
- Polymarket Resolvable Watch keeps an empty watchlist by default. `/monitor watchlist action:add market:<polymarket-url>` stores Gamma `questionID` and `conditionId` values, while `market:<question-id>` stores a raw question ID and skips the CTF `conditionId` precheck. It polls Conditional Tokens `payoutDenominator(bytes32)` when a condition ID is known plus UMA CTF adapter `ready(bytes32)` through Polygon `eth_call` only while at least one market is configured, alerts when either the condition is already resolved or `ready` returns true, and removes that market from the watchlist.
- UMA Vote Commits polls Ethereum UMA Voting v2 `VoteCommitted` logs every minute, estimates each voter's current stake at the commit block with `getVoterStakePostUpdate(address)`, detects recommits from repeated voter/request commit keys, groups same-voter events per scan into voter-level summaries because commit answers are confidential, tracks threshold-qualified current-cycle commit counts for `/umacommits check`, drops pending/backfilled alerts older than 10 minutes, routes its reaction role through `#uma-alert-roles`, and alerts only when the stake is at least `/umacommits threshold`.
- UMA Vote Reveals polls Ethereum UMA Voting v2 `VoteRevealed` logs every minute, groups same-voter events per scan, drops pending/backfilled alerts older than 10 minutes, routes its reaction role through `#uma-alert-roles`, and alerts only when the revealed `numTokens` vote weight is at least `/umareveals threshold`; default free RPC endpoints can be overridden with `ETHEREUM_RPC_URL` or comma-separated `ETHEREUM_RPC_URLS`.
- Grouped UMA vote alerts are voter-level summaries only and intentionally omit per-request lists and Show more details.
- UMA proposal alerts keep question, outcome, market tags, proposer, and times visible; transaction, condition ID, question ID, oracle, requester, request timestamp, and block are behind the refresh/details button.
- UMA clarification, proposal, and dispute question fields include Polymarket and Betmoar market links when the Polymarket market slug is known; keep these links even when the Polymarket page may not exist yet.
- Pyth Natural Gas, WTI, XAGUSD, and XAUUSD auto-discover matching monthly Polymarket markets, parse only unresolved strike prices from the active Polymarket URL, check only the configured top stable Pyth feed, store the latest observed price, and alert only when the live 1-minute candle range crosses a strike from the previously stored price.
- RWA Total Value reads the RWA.xyz home chart tRPC data, decodes the compressed chart payload, sums the latest asset-class series date, and polls hourly for Total RWA Value changes.
- AWS monitors the public AWS Health Dashboard history events JSON and treats status code `3` as the disrupted severity classification.
- Bank of Israel Decision monitors official BOI interest-rate announcement pages through `r.jina.ai` because direct BOI Node fetches return a Radware loader; it alerts when the latest official interest-rate decision release URL changes and auto-discovers monthly `bank-of-israel-decision-in-...` markets.
- Reserve Bank of New Zealand Decision monitors RBNZ OCR/current-rate and past-decision pages through `r.jina.ai` because direct Node fetches can return Cloudflare/F5 restriction pages; it alerts when the latest official OCR decision key changes and auto-discovers monthly `reserve-bank-of-new-zealand-decision-in-...` markets.
- BLS Jobs Added monitors the Employment Situation Summary current/archive pages, keeps each monthly market active through the scheduled 8:30 AM ET release day, polls every minute on the day before/day of release, and auto-discovers active monthly `how-many-jobs-added-in-...` markets.
- CDC fertility monitors the natality dashboard CSV for the 2026 Q1 general fertility rate row.
- Cloudflare monitors the official Statuspage incidents API and returns a stable no-critical value unless a Critical/red incident appears.
- Discord monitors the official Statuspage incidents API and filters Critical/red incidents to the 2026 May 31 market window.
- Artist Song Releases and KPop Song Releases parse unresolved artist/group questions from Gamma, resolve Apple Music artist IDs through the public iTunes Search API, poll recent Apple song catalog entries hourly, filter obvious DJ-mix catalog noise, and alert only when a new 2026 track ID appears after the first stored check.
- ISM Services PMI checks the Services report page plus the direct monthly report URL, stores `not published yet` before release, and polls every minute on the day before/day of the scheduled 10:00 AM ET release.
- UMich Consumer Sentiment checks the Surveys of Consumers landing page and Table 1 CSV, auto-discovers monthly Polymarket markets, ignores preliminary releases, and only marks the target month published when that month’s Final Results link exists.
- NCEI tornadoes monitors monthly U.S. tornado counts from the NCEI Tornadoes Time Series JSON endpoint plus chart config metadata, treats preliminary counts as resolution-relevant, shows NCEI's uncertainty range, and alerts when the target value/status/uncertainty changes.
- NPM private valuation monitors normalize dollar formatting from the public API and rendered fallback before comparing values, so `$16.730B` and `$16.73B` do not create false value-change alerts.
- USGS earthquakes monitors the official USGS event API count for 5.5+ and 6.5+ earthquakes in active weekly Polymarket date windows, alerts on any count change, and treats decreases as USGS revision alerts for events moved below the cutoff. USGS 7.0+ earthquakes uses the same count-change alert behavior with separate fixed windows for the Jun 30 market and full-year 2026 market. Earthquake value blocks always show separate market start/end UTC timestamps for auditability.
- HKO Hong Kong precipitation uses Daily Extract as the official total, then adds the text-only Yesterday's Weather rainfall only when that report is newer than the latest Daily Extract day; if Gamma has no active next market, it still tracks the current ET month.
- NOAA NYC and Seattle monthly precipitation use RCC ACIS daily rows instead of only the monthly sum, so newly posted `0.00` or `T` days still change `lastValue` and alert.
- Met Office London precipitation uses Heathrow stationdata as the official monthly row and Infoclimat Heathrow climatology as preferred cumulative alpha. If Infoclimat blocks the bot, it falls back to Weather.com/Wunderground PWS daily history near Heathrow, clearly labeled as alpha rather than official resolution data; daily alpha rainfall is estimated from cumulative changes, including 0.0 mm updates. KMA Seoul, NOAA NYC, NOAA Seattle, HKO Hong Kong, and Met Office London all continue checking the current ET month even before a new Polymarket URL is discovered.
- Paris Heat Wave uses Wunderground's public Weather.com historical observations for station `LFPB`, groups highs by Paris station-local calendar date, and alerts only when the >=35°C qualifying-day set or 3-day streak status changes.
- White House Alien Arrests NYC reads the embedded Flourish table on `whitehouse.gov/aliens` and exact-matches the `New York, NY` row's `Total Arrests` counter.
- White House Full Lid monitors Roll Call's Factba.se calendar and Forth's WH pool page for today's ET full lid; it polls every minute during 8:00 AM-8:30 PM ET and hourly off-hours.
- White House X Posts uses The Trump Feed public archive for unauthenticated `@WhiteHouse` X posts, filtering out `@POTUS` posts from the shared `potus-x` feed. If that source fails, it falls back to Nitter/XCancel RSS feeds such as `WHITE_HOUSE_TWEETS_NITTER_FEEDS=https://nitter.net/WhiteHouse/rss,https://xcancel.com/WhiteHouse/rss`. It polls every 5 minutes, keeps a monotonic captured-post set, auto-discovers overlapping weekly Polymarket markets, rejects XCancel whitelist placeholders, and sends role-tagged hourly summaries only when newly captured posts exist. Public-source fallback is less authoritative than X itself and can miss deleted posts if no public archive exposes them before removal.
- Register new adapters in `src/integrations/registry.ts`.
- Give each adapter a unique `commandName` for its slash command.
- Give each adapter a unique `alertRoleName` and `alertRoleEmoji`.
- Keep scraping logic isolated in adapters.
- Use simple HTTP parsing first; add browser automation later only for JavaScript-rendered sources.
- Free and Paid App Store integrations monitor Apple's US iPhone chart feeds, display the top 5, compare only the top 2 for alerts, capture separate 12:00 PM ET daily snapshots via snapshot storage fields, and auto-discover active daily App Store markets through Gamma search. Free discovery accepts `#1` and `#2` Free App Store markets; Paid discovery accepts Paid App Store markets.
- Spotify USA and Spotify Global use Kworb daily chart pages for the detailed top 10 chart date, positions, streams, days, and peaks while preserving the official Spotify Top 50 playlist links in output.
- Justin Bieber Monthly Listeners reads Spotify's public artist page metadata directly, so it does not need Spotify API credentials; it alerts only when the listener count line changes and displays parsed hit/open Polymarket thresholds.
- Spider-Man Trailer monitors four official YouTube RSS feeds and only alerts on post-market videos whose title matches Spider-Man/Spiderman, Brand New Day, and trailer/teaser while excluding ticket-sale, livestream, production, clip, and featurette wording.
- Arena AI monitors the server-rendered no-style-control leaderboard and stores only the top 3 model names/ranks so score/vote movements do not trigger alerts.
- Tesla deliveries monitors Tesla production and delivery press releases through the matching official SEC 8-K exhibit because direct local requests to `ir.tesla.com/press` are Akamai-blocked; it auto-discovers active quarterly Polymarket delivery markets into the shared queue.
- Elon X uses XCancel/Nitter-style public HTML pages such as `https://xcancel.com/elonmusk` and `/elonmusk/with_replies` because direct X API polling requires paid credentials. It parses own posts, replies, quote-post text, repost labels, timestamps, and still-image links; quoted-post and repost text do not count for text strikes, and reposts are suppressed entirely from notifications. Set `ELON_X_NITTER_BASE_URLS` to swap or add public frontends if XCancel blocks the Pi.
- Trump Schedule monitors Roll Call's Factba.se calendar for today's ET public schedule, stores a compact daily digest with lid/travel/press/remarks flags, and polls every 15 minutes during 7:00 AM-10:00 PM ET.
- Trump Truth uses the reachable `https://www.trumpstruth.org/feed` archive feed because direct Truth Social access is Cloudflare-blocked locally; alerts include original Truth Social URLs and an Open Truth link button for verification.
- Trump Truth parses weekly Polymarket strike terms into `settingsJson`, stores the latest seen Truth Social post ID in `lastValue`, checks archive image descriptions, alt text, and basic OCR output for image-only strike review, auto-discovers upcoming weekly markets, supports active-window archive search with `/trumptruth search`, posts non-strike feed updates without a role ping, and only role-tags strike hits.
- TSA passengers parses the date range from the active Polymarket URL slug, sums official TSA daily checkpoint throughput rows for that range, and auto-discovers upcoming weekly TSA markets into the shared queue.
- Generic dated Polymarket queueing lives in `src/polymarketQueue.ts`; prefer it over adapter-specific queue fields unless the adapter needs extra parsed market state.

## Maintenance Review Notes

- Overall structure is healthy: adapters stay isolated, while `commands.ts`, `poller.ts`, `embeds.ts`, `database.ts`, and `provisioner.ts` form the shared core.
- Shared settings helpers live in `src/settingsJson.ts`; use them when reading, merging, or deleting cross-adapter `settingsJson` keys. Use `BotDatabase.setSettingsJsonIfChanged()` instead of open-coded optional `setSettingsJson` blocks.
- `commands.ts`, `embeds.ts`, and `poller.ts` are still the main growth hotspots; split only when changing them for real features, not as a standalone rewrite.
- Poller error suppression/formatting lives in `src/errorNotices.ts`; keep retry/noise-control behavior there instead of adding local copies.
- Integration check failures should route through the shared poller error path into `#errorlogs`; do not send adapter-local error messages to monitor channels.
- Registry and command metadata tests are table-driven from `listAdapters()`; add special-case assertions only for adapter-specific capabilities.
- Current one-timer-per-integration polling is fine for dozens of adapters; revisit only if the bot grows into hundreds of active monitors or needs exact cron scheduling.
- Keep `lastValue` string comparisons for simple monitors, but use structured settings/event tables for dedupe-heavy or multi-item integrations.

## Validation

```powershell
npm test
npm run build
```
