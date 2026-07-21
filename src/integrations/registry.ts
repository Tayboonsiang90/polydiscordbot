import { aaaRegularGasAdapter } from "./aaaGas.js";
import { alignedLayerSaleAdapter } from "./alignedLayerSale.js";
import { allInPodcastAdapter } from "./allInPodcast.js";
import {
  airNowChicagoAqiAdapter,
  airNowColumbusAqiAdapter,
  airNowNycAqiAdapter,
  airNowPhiladelphiaAqiAdapter,
  airNowStadiumAqiAdapter
} from "./airNowAqi.js";
import { artistAlbumReleasesAdapter, artistSongReleasesAdapter, kpopSongReleasesAdapter } from "./appleSongReleases.js";
import { arenaAiLeaderboardAdapters } from "./arenaAiLeaderboard.js";
import { awsDisruptedAdapter } from "./awsDisrupted.js";
import { bankOfIsraelDecisionAdapter } from "./bankOfIsraelDecision.js";
import { basedRevenueAdapter } from "./basedRevenue.js";
import { beaCurrentReleasesAdapter } from "./beaCurrentReleases.js";
import { biJisdorAdapter } from "./biJisdor.js";
import { billboard200Adapter } from "./billboard200.js";
import { billboardHot100Adapter } from "./billboardHot100.js";
import { blsCpiReleasesAdapter } from "./blsCpiReleases.js";
import { blsJobsAddedAdapter } from "./blsJobsAdded.js";
import { bonbastUsdIrrAdapter } from "./bonbast.js";
import { boxOfficeWeekendsAdapter } from "./boxOfficeWeekends.js";
import { cdcCyclosporiasisAdapter } from "./cdcCyclosporiasis.js";
import { cdcFertilityRateAdapter } from "./cdcFertilityRate.js";
import { cdcFluHospitalizationAdapter } from "./cdcFluHospitalization.js";
import { cdcMeaslesAdapter } from "./cdcMeasles.js";
import { censusDurableGoodsAdapter } from "./censusDurableGoods.js";
import { claudeCodeCommitsAdapter } from "./claudeCodeCommits.js";
import { claudeCodeCommitsAverageAdapter } from "./claudeCodeCommitsAverage.js";
import { claudeDowntimeAdapter } from "./claudeDowntime.js";
import { cloudflareCubaOutageAdapter } from "./cloudflareCubaOutage.js";
import { cloudflareCriticalAdapter } from "./cloudflareCritical.js";
import { companiesMarketCapAdapter } from "./companiesMarketCap.js";
import { crossPlatformArbitrageAdapter } from "./crossPlatformArbitrage.js";
import { discordCriticalAdapter } from "./discordCritical.js";
import { ecdsaFailAdapter } from "./ecdsaFail.js";
import { eiaCrudeSprAdapter } from "./eiaCrudeSpr.js";
import { ethereumGasMonthlyAdapter } from "./ethereumGasMonthly.js";
import { elonXAdapter } from "./elonX.js";
import { fdicFailedBanksAdapter } from "./fdicFailedBanks.js";
import { fredEggPriceAdapter } from "./fredEggPrice.js";
import { fredGroundBeefAdapter } from "./fredGroundBeef.js";
import { freeAppStoreAdapter } from "./freeAppStore.js";
import { hkPrecipAdapter } from "./hkPrecip.js";
import { hendonMobMoneyListAdapter } from "./hendonMobMoneyList.js";
import { iswUkraineMapAdapter } from "./iswUkraineMap.js";
import { ismServicesPmiAdapter } from "./ismServicesPmi.js";
import { kaitoMindshareAdapter } from "./kaitoMindshare.js";
import { kmaSeoulPrecipAdapter } from "./kmaSeoulPrecip.js";
import { londonPrecipAdapter } from "./londonPrecip.js";
import { joeRoganPodcastAdapter } from "./joeRoganPodcast.js";
import { lemonadeStandPodcastAdapter } from "./lemonadeStandPodcast.js";
import { metadaoCredibleFundraiseAdapter } from "./metadaoCredibleFundraise.js";
import { mtWashingtonWindAdapter } from "./mtWashingtonWind.js";
import { mrBeastGamingVideosAdapter } from "./mrBeastGamingVideos.js";
import { mrBeastSubscribersAdapter } from "./mrBeastSubscribers.js";
import { mrBeastViewsAdapter } from "./mrBeastViews.js";
import { nbsPressReleaseAdapter } from "./nbsPressRelease.js";
import { nceiTornadoesAdapter } from "./nceiTornadoes.js";
import { nasaGistempAdapter } from "./nasaGistemp.js";
import { netflixTop10Adapter } from "./netflixTop10.js";
import { nsidcArcticSeaIceAdapter } from "./nsidcArcticSeaIce.js";
import { nytFrontPageAdapter } from "./nytFrontPage.js";
import { npmPrivateValuationAdapters } from "./npmPrivateValuations.js";
import { noaaNycPrecipAdapter } from "./noaaNycPrecip.js";
import {
  noaaAtlantaRainAdapter,
  noaaBostonRainAdapter,
  noaaDallasRainAdapter,
  noaaDenverRainAdapter,
  noaaSanFranciscoRainAdapter
} from "./noaaDailyRain.js";
import { noaaSeattlePrecipAdapter } from "./noaaSeattlePrecip.js";
import { openAiChatGptOutagesAdapter } from "./openAiChatGptOutages.js";
import { ornnB200IndexAdapter } from "./ornnB200Index.js";
import { ornnH100IndexAdapter } from "./ornnH100Index.js";
import { ornnH200IndexAdapter } from "./ornnH200Index.js";
import { paidAppStoreAdapter } from "./paidAppStore.js";
import { parisHeatWaveAdapter } from "./parisHeatWave.js";
import { parclDcHomeValueAdapter } from "./parclDcHomeValue.js";
import { parclNycHomeValueAdapter } from "./parclNycHomeValue.js";
import { pbocRateChangeAdapter } from "./pbocRateChange.js";
import { polymarketClarificationsAdapter } from "./polymarketClarifications.js";
import { polymarketDisputesAdapter } from "./polymarketDisputes.js";
import { polymarketMentionMarketsAdapter } from "./polymarketNewMarkets.js";
import { polymarketProposalsAdapter } from "./polymarketProposals.js";
import { polymarketResolvableAdapter } from "./polymarketResolvable.js";
import { polymarketStatusAdapter } from "./polymarketStatus.js";
import { portwatchBabElMandebAdapter } from "./portwatchBabElMandeb.js";
import { portwatchHormuzShipsAdapter } from "./portwatchHormuzShips.js";
import { powerballJackpotAdapter } from "./powerballJackpot.js";
import { pumpFunGoAdapter } from "./pumpFunGo.js";
import { pythNaturalGasAdapter } from "./pythNaturalGas.js";
import { pythWtiAdapter } from "./pythWti.js";
import { pythXagUsdAdapter } from "./pythXagUsd.js";
import { pythXauUsdAdapter } from "./pythXauUsd.js";
import { reserveBankNewZealandDecisionAdapter } from "./reserveBankNewZealandDecision.js";
import { rottenTomatoesScoresAdapter } from "./rottenTomatoesScores.js";
import { rwaTotalValueAdapter } from "./rwaTotalValue.js";
import { silverTrumpApprovalAdapter } from "./silverTrumpApproval.js";
import { spotifyBieberMonthlyListenersAdapter } from "./spotifyMonthlyListeners.js";
import { spotifyTopArtistMonthlyAdapter } from "./spotifyTopArtistMonthly.js";
import { spiderManTrailerAdapter } from "./spiderManTrailer.js";
import { spotifyTop50GlobalAdapter } from "./spotifyTop50Global.js";
import { spotifyTop50UsaAdapter } from "./spotifyTop50Usa.js";
import { strategyBitcoinPurchasesAdapter } from "./strategyBitcoinPurchases.js";
import { teslaDeliveriesAdapter } from "./teslaDeliveries.js";
import { ticketDataWorldCupFinalAdapter } from "./ticketDataWorldCupFinal.js";
import { trumpGettyPhotosAdapter } from "./trumpGettyPhotos.js";
import { trumpScheduleAdapter } from "./trumpSchedule.js";
import { trumpTruthAdapter } from "./trumpTruth.js";
import { tsaPassengersAdapter } from "./tsaPassengers.js";
import { treasuryMtsDeficitAdapter } from "./treasuryMtsDeficit.js";
import { umichConsumerSentimentAdapter } from "./umichConsumerSentiment.js";
import type { WebsiteAdapter } from "./types.js";
import { ufoFilesAdapter } from "./ufoFiles.js";
import { umaVoteCommitsAdapter } from "./umaVoteCommits.js";
import { umaVoteRevealsAdapter } from "./umaVoteReveals.js";
import { umaVotingCommitteeAdapter } from "./umaVotingCommittee.js";
import {
  usgsEarthquakesAdapter,
  usgsSixPointFiveEarthquakesAdapter,
  usgsSevenPlusEarthquakesAdapter,
  usgsSevenPlusEarthquakesYearAdapter
} from "./usgsEarthquakes.js";
import { volmexBvivAdapter } from "./volmexBviv.js";
import { volmexEvivAdapter } from "./volmexEviv.js";
import { whiteHouseAliensNycAdapter } from "./whiteHouseAliensNyc.js";
import { whiteHouseBriefingsAdapter } from "./whiteHouseBriefings.js";
import { whiteHouseFullLidAdapter } from "./whiteHouseFullLid.js";
import { whiteHousePoolUpdatesAdapter } from "./whiteHousePoolUpdates.js";
import { whiteHouseTweetsAdapter } from "./whiteHouseTweets.js";

const adapters = new Map<string, WebsiteAdapter>([
  [aaaRegularGasAdapter.id, aaaRegularGasAdapter],
  [alignedLayerSaleAdapter.id, alignedLayerSaleAdapter],
  [allInPodcastAdapter.id, allInPodcastAdapter],
  [airNowChicagoAqiAdapter.id, airNowChicagoAqiAdapter],
  [airNowColumbusAqiAdapter.id, airNowColumbusAqiAdapter],
  [airNowNycAqiAdapter.id, airNowNycAqiAdapter],
  [airNowPhiladelphiaAqiAdapter.id, airNowPhiladelphiaAqiAdapter],
  [airNowStadiumAqiAdapter.id, airNowStadiumAqiAdapter],
  [artistAlbumReleasesAdapter.id, artistAlbumReleasesAdapter],
  [artistSongReleasesAdapter.id, artistSongReleasesAdapter],
  ...arenaAiLeaderboardAdapters.map((adapter) => [adapter.id, adapter] as [string, WebsiteAdapter]),
  [awsDisruptedAdapter.id, awsDisruptedAdapter],
  [bankOfIsraelDecisionAdapter.id, bankOfIsraelDecisionAdapter],
  [basedRevenueAdapter.id, basedRevenueAdapter],
  [beaCurrentReleasesAdapter.id, beaCurrentReleasesAdapter],
  [biJisdorAdapter.id, biJisdorAdapter],
  [billboard200Adapter.id, billboard200Adapter],
  [billboardHot100Adapter.id, billboardHot100Adapter],
  [blsCpiReleasesAdapter.id, blsCpiReleasesAdapter],
  [blsJobsAddedAdapter.id, blsJobsAddedAdapter],
  [bonbastUsdIrrAdapter.id, bonbastUsdIrrAdapter],
  [boxOfficeWeekendsAdapter.id, boxOfficeWeekendsAdapter],
  [cdcCyclosporiasisAdapter.id, cdcCyclosporiasisAdapter],
  [cdcFertilityRateAdapter.id, cdcFertilityRateAdapter],
  [cdcFluHospitalizationAdapter.id, cdcFluHospitalizationAdapter],
  [cdcMeaslesAdapter.id, cdcMeaslesAdapter],
  [censusDurableGoodsAdapter.id, censusDurableGoodsAdapter],
  [claudeCodeCommitsAverageAdapter.id, claudeCodeCommitsAverageAdapter],
  [claudeCodeCommitsAdapter.id, claudeCodeCommitsAdapter],
  [claudeDowntimeAdapter.id, claudeDowntimeAdapter],
  [cloudflareCubaOutageAdapter.id, cloudflareCubaOutageAdapter],
  [cloudflareCriticalAdapter.id, cloudflareCriticalAdapter],
  [companiesMarketCapAdapter.id, companiesMarketCapAdapter],
  [crossPlatformArbitrageAdapter.id, crossPlatformArbitrageAdapter],
  [discordCriticalAdapter.id, discordCriticalAdapter],
  [ecdsaFailAdapter.id, ecdsaFailAdapter],
  [eiaCrudeSprAdapter.id, eiaCrudeSprAdapter],
  [ethereumGasMonthlyAdapter.id, ethereumGasMonthlyAdapter],
  [elonXAdapter.id, elonXAdapter],
  [fdicFailedBanksAdapter.id, fdicFailedBanksAdapter],
  [fredEggPriceAdapter.id, fredEggPriceAdapter],
  [fredGroundBeefAdapter.id, fredGroundBeefAdapter],
  [freeAppStoreAdapter.id, freeAppStoreAdapter],
  [hendonMobMoneyListAdapter.id, hendonMobMoneyListAdapter],
  [hkPrecipAdapter.id, hkPrecipAdapter],
  [iswUkraineMapAdapter.id, iswUkraineMapAdapter],
  [ismServicesPmiAdapter.id, ismServicesPmiAdapter],
  [kaitoMindshareAdapter.id, kaitoMindshareAdapter],
  [kpopSongReleasesAdapter.id, kpopSongReleasesAdapter],
  [kmaSeoulPrecipAdapter.id, kmaSeoulPrecipAdapter],
  [londonPrecipAdapter.id, londonPrecipAdapter],
  [joeRoganPodcastAdapter.id, joeRoganPodcastAdapter],
  [lemonadeStandPodcastAdapter.id, lemonadeStandPodcastAdapter],
  [metadaoCredibleFundraiseAdapter.id, metadaoCredibleFundraiseAdapter],
  [mtWashingtonWindAdapter.id, mtWashingtonWindAdapter],
  [mrBeastGamingVideosAdapter.id, mrBeastGamingVideosAdapter],
  [mrBeastSubscribersAdapter.id, mrBeastSubscribersAdapter],
  [mrBeastViewsAdapter.id, mrBeastViewsAdapter],
  [nbsPressReleaseAdapter.id, nbsPressReleaseAdapter],
  [nceiTornadoesAdapter.id, nceiTornadoesAdapter],
  [nasaGistempAdapter.id, nasaGistempAdapter],
  [netflixTop10Adapter.id, netflixTop10Adapter],
  [nsidcArcticSeaIceAdapter.id, nsidcArcticSeaIceAdapter],
  [nytFrontPageAdapter.id, nytFrontPageAdapter],
  ...npmPrivateValuationAdapters.map((adapter) => [adapter.id, adapter] as [string, WebsiteAdapter]),
  [noaaAtlantaRainAdapter.id, noaaAtlantaRainAdapter],
  [noaaBostonRainAdapter.id, noaaBostonRainAdapter],
  [noaaDallasRainAdapter.id, noaaDallasRainAdapter],
  [noaaDenverRainAdapter.id, noaaDenverRainAdapter],
  [noaaNycPrecipAdapter.id, noaaNycPrecipAdapter],
  [noaaSanFranciscoRainAdapter.id, noaaSanFranciscoRainAdapter],
  [noaaSeattlePrecipAdapter.id, noaaSeattlePrecipAdapter],
  [openAiChatGptOutagesAdapter.id, openAiChatGptOutagesAdapter],
  [ornnB200IndexAdapter.id, ornnB200IndexAdapter],
  [ornnH100IndexAdapter.id, ornnH100IndexAdapter],
  [ornnH200IndexAdapter.id, ornnH200IndexAdapter],
  [paidAppStoreAdapter.id, paidAppStoreAdapter],
  [parisHeatWaveAdapter.id, parisHeatWaveAdapter],
  [parclDcHomeValueAdapter.id, parclDcHomeValueAdapter],
  [parclNycHomeValueAdapter.id, parclNycHomeValueAdapter],
  [pbocRateChangeAdapter.id, pbocRateChangeAdapter],
  [polymarketClarificationsAdapter.id, polymarketClarificationsAdapter],
  [polymarketDisputesAdapter.id, polymarketDisputesAdapter],
  [polymarketMentionMarketsAdapter.id, polymarketMentionMarketsAdapter],
  [polymarketProposalsAdapter.id, polymarketProposalsAdapter],
  [polymarketResolvableAdapter.id, polymarketResolvableAdapter],
  [polymarketStatusAdapter.id, polymarketStatusAdapter],
  [portwatchBabElMandebAdapter.id, portwatchBabElMandebAdapter],
  [portwatchHormuzShipsAdapter.id, portwatchHormuzShipsAdapter],
  [powerballJackpotAdapter.id, powerballJackpotAdapter],
  [pumpFunGoAdapter.id, pumpFunGoAdapter],
  [pythNaturalGasAdapter.id, pythNaturalGasAdapter],
  [pythWtiAdapter.id, pythWtiAdapter],
  [pythXagUsdAdapter.id, pythXagUsdAdapter],
  [pythXauUsdAdapter.id, pythXauUsdAdapter],
  [reserveBankNewZealandDecisionAdapter.id, reserveBankNewZealandDecisionAdapter],
  [rottenTomatoesScoresAdapter.id, rottenTomatoesScoresAdapter],
  [rwaTotalValueAdapter.id, rwaTotalValueAdapter],
  [silverTrumpApprovalAdapter.id, silverTrumpApprovalAdapter],
  [spotifyBieberMonthlyListenersAdapter.id, spotifyBieberMonthlyListenersAdapter],
  [spotifyTopArtistMonthlyAdapter.id, spotifyTopArtistMonthlyAdapter],
  [spiderManTrailerAdapter.id, spiderManTrailerAdapter],
  [spotifyTop50GlobalAdapter.id, spotifyTop50GlobalAdapter],
  [spotifyTop50UsaAdapter.id, spotifyTop50UsaAdapter],
  [strategyBitcoinPurchasesAdapter.id, strategyBitcoinPurchasesAdapter],
  [teslaDeliveriesAdapter.id, teslaDeliveriesAdapter],
  [ticketDataWorldCupFinalAdapter.id, ticketDataWorldCupFinalAdapter],
  [trumpGettyPhotosAdapter.id, trumpGettyPhotosAdapter],
  [trumpScheduleAdapter.id, trumpScheduleAdapter],
  [trumpTruthAdapter.id, trumpTruthAdapter],
  [tsaPassengersAdapter.id, tsaPassengersAdapter],
  [treasuryMtsDeficitAdapter.id, treasuryMtsDeficitAdapter],
  [umichConsumerSentimentAdapter.id, umichConsumerSentimentAdapter],
  [ufoFilesAdapter.id, ufoFilesAdapter],
  [umaVoteCommitsAdapter.id, umaVoteCommitsAdapter],
  [umaVoteRevealsAdapter.id, umaVoteRevealsAdapter],
  [umaVotingCommitteeAdapter.id, umaVotingCommitteeAdapter],
  [usgsEarthquakesAdapter.id, usgsEarthquakesAdapter],
  [usgsSixPointFiveEarthquakesAdapter.id, usgsSixPointFiveEarthquakesAdapter],
  [usgsSevenPlusEarthquakesAdapter.id, usgsSevenPlusEarthquakesAdapter],
  [usgsSevenPlusEarthquakesYearAdapter.id, usgsSevenPlusEarthquakesYearAdapter],
  [volmexBvivAdapter.id, volmexBvivAdapter],
  [volmexEvivAdapter.id, volmexEvivAdapter],
  [whiteHouseAliensNycAdapter.id, whiteHouseAliensNycAdapter],
  [whiteHouseBriefingsAdapter.id, whiteHouseBriefingsAdapter],
  [whiteHouseFullLidAdapter.id, whiteHouseFullLidAdapter],
  [whiteHousePoolUpdatesAdapter.id, whiteHousePoolUpdatesAdapter],
  [whiteHouseTweetsAdapter.id, whiteHouseTweetsAdapter]
]);

export function getAdapter(adapterId: string): WebsiteAdapter {
  const adapter = adapters.get(adapterId);
  if (!adapter) {
    throw new Error(`Unknown adapter: ${adapterId}`);
  }
  return adapter;
}

export function hasAdapter(adapterId: string): boolean {
  return adapters.has(adapterId);
}

export function getAdapterByCommandName(commandName: string): WebsiteAdapter {
  const adapter = listAdapters().find((candidate) => candidate.commandName === commandName);
  if (!adapter) {
    throw new Error(`Unknown adapter command: ${commandName}`);
  }
  return adapter;
}

export function listAdapters(): WebsiteAdapter[] {
  return [...adapters.values()];
}
