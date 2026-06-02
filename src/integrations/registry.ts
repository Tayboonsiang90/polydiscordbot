import { aaaRegularGasAdapter } from "./aaaGas.js";
import { alignedLayerSaleAdapter } from "./alignedLayerSale.js";
import { allInPodcastAdapter } from "./allInPodcast.js";
import { artistSongReleasesAdapter, kpopSongReleasesAdapter } from "./appleSongReleases.js";
import { arenaAiLeaderboardAdapter } from "./arenaAiLeaderboard.js";
import { awsDisruptedAdapter } from "./awsDisrupted.js";
import { basedRevenueAdapter } from "./basedRevenue.js";
import { beaCurrentReleasesAdapter } from "./beaCurrentReleases.js";
import { biJisdorAdapter } from "./biJisdor.js";
import { blsCpiReleasesAdapter } from "./blsCpiReleases.js";
import { blsJobsAddedAdapter } from "./blsJobsAdded.js";
import { bonbastUsdIrrAdapter } from "./bonbast.js";
import { cdcFertilityRateAdapter } from "./cdcFertilityRate.js";
import { cdcMeaslesAdapter } from "./cdcMeasles.js";
import { censusDurableGoodsAdapter } from "./censusDurableGoods.js";
import { claudeCodeCommitsAdapter } from "./claudeCodeCommits.js";
import { claudeDowntimeAdapter } from "./claudeDowntime.js";
import { cloudflareCriticalAdapter } from "./cloudflareCritical.js";
import { discordCriticalAdapter } from "./discordCritical.js";
import { eiaCrudeSprAdapter } from "./eiaCrudeSpr.js";
import { fdicFailedBanksAdapter } from "./fdicFailedBanks.js";
import { fredEggPriceAdapter } from "./fredEggPrice.js";
import { fredGroundBeefAdapter } from "./fredGroundBeef.js";
import { freeAppStoreAdapter } from "./freeAppStore.js";
import { hkPrecipAdapter } from "./hkPrecip.js";
import { ismServicesPmiAdapter } from "./ismServicesPmi.js";
import { kaitoMindshareAdapter } from "./kaitoMindshare.js";
import { kmaSeoulPrecipAdapter } from "./kmaSeoulPrecip.js";
import { londonPrecipAdapter } from "./londonPrecip.js";
import { mrBeastSubscribersAdapter } from "./mrBeastSubscribers.js";
import { mrBeastViewsAdapter } from "./mrBeastViews.js";
import { nbsPressReleaseAdapter } from "./nbsPressRelease.js";
import { nceiTornadoesAdapter } from "./nceiTornadoes.js";
import { nasaGistempAdapter } from "./nasaGistemp.js";
import { noaaNycPrecipAdapter } from "./noaaNycPrecip.js";
import { noaaSeattlePrecipAdapter } from "./noaaSeattlePrecip.js";
import { nytFrontPageAdapter } from "./nytFrontPage.js";
import { openAiChatGptOutagesAdapter } from "./openAiChatGptOutages.js";
import { ornnB200IndexAdapter } from "./ornnB200Index.js";
import { ornnH100IndexAdapter } from "./ornnH100Index.js";
import { ornnH200IndexAdapter } from "./ornnH200Index.js";
import { paidAppStoreAdapter } from "./paidAppStore.js";
import { parclDcHomeValueAdapter } from "./parclDcHomeValue.js";
import { polymarketClarificationsAdapter } from "./polymarketClarifications.js";
import { polymarketDisputesAdapter } from "./polymarketDisputes.js";
import { polymarketProposalsAdapter } from "./polymarketProposals.js";
import { powerballJackpotAdapter } from "./powerballJackpot.js";
import { pythNaturalGasAdapter } from "./pythNaturalGas.js";
import { pythWtiAdapter } from "./pythWti.js";
import { pythXagUsdAdapter } from "./pythXagUsd.js";
import { pythXauUsdAdapter } from "./pythXauUsd.js";
import { silverTrumpApprovalAdapter } from "./silverTrumpApproval.js";
import { spotifyTop50GlobalAdapter } from "./spotifyTop50Global.js";
import { spotifyTop50UsaAdapter } from "./spotifyTop50Usa.js";
import { strategyBitcoinPurchasesAdapter } from "./strategyBitcoinPurchases.js";
import { teslaDeliveriesAdapter } from "./teslaDeliveries.js";
import { trumpGettyPhotosAdapter } from "./trumpGettyPhotos.js";
import { trumpScheduleAdapter } from "./trumpSchedule.js";
import { trumpTruthAdapter } from "./trumpTruth.js";
import { tsaPassengersAdapter } from "./tsaPassengers.js";
import type { WebsiteAdapter } from "./types.js";
import { umaVoteCommitsAdapter } from "./umaVoteCommits.js";
import { umaVoteRevealsAdapter } from "./umaVoteReveals.js";
import { umaVotingCommitteeAdapter } from "./umaVotingCommittee.js";
import { usgsEarthquakesAdapter } from "./usgsEarthquakes.js";
import { volmexBvivAdapter } from "./volmexBviv.js";
import { whiteHouseAliensNycAdapter } from "./whiteHouseAliensNyc.js";
import { whiteHouseBriefingsAdapter } from "./whiteHouseBriefings.js";
import { whiteHouseFullLidAdapter } from "./whiteHouseFullLid.js";
import { whiteHouseTweetsAdapter } from "./whiteHouseTweets.js";

const adapters = new Map<string, WebsiteAdapter>([
  [aaaRegularGasAdapter.id, aaaRegularGasAdapter],
  [alignedLayerSaleAdapter.id, alignedLayerSaleAdapter],
  [allInPodcastAdapter.id, allInPodcastAdapter],
  [artistSongReleasesAdapter.id, artistSongReleasesAdapter],
  [arenaAiLeaderboardAdapter.id, arenaAiLeaderboardAdapter],
  [awsDisruptedAdapter.id, awsDisruptedAdapter],
  [basedRevenueAdapter.id, basedRevenueAdapter],
  [beaCurrentReleasesAdapter.id, beaCurrentReleasesAdapter],
  [biJisdorAdapter.id, biJisdorAdapter],
  [blsCpiReleasesAdapter.id, blsCpiReleasesAdapter],
  [blsJobsAddedAdapter.id, blsJobsAddedAdapter],
  [bonbastUsdIrrAdapter.id, bonbastUsdIrrAdapter],
  [cdcFertilityRateAdapter.id, cdcFertilityRateAdapter],
  [cdcMeaslesAdapter.id, cdcMeaslesAdapter],
  [censusDurableGoodsAdapter.id, censusDurableGoodsAdapter],
  [claudeCodeCommitsAdapter.id, claudeCodeCommitsAdapter],
  [claudeDowntimeAdapter.id, claudeDowntimeAdapter],
  [cloudflareCriticalAdapter.id, cloudflareCriticalAdapter],
  [discordCriticalAdapter.id, discordCriticalAdapter],
  [eiaCrudeSprAdapter.id, eiaCrudeSprAdapter],
  [fdicFailedBanksAdapter.id, fdicFailedBanksAdapter],
  [fredEggPriceAdapter.id, fredEggPriceAdapter],
  [fredGroundBeefAdapter.id, fredGroundBeefAdapter],
  [freeAppStoreAdapter.id, freeAppStoreAdapter],
  [hkPrecipAdapter.id, hkPrecipAdapter],
  [ismServicesPmiAdapter.id, ismServicesPmiAdapter],
  [kaitoMindshareAdapter.id, kaitoMindshareAdapter],
  [kpopSongReleasesAdapter.id, kpopSongReleasesAdapter],
  [kmaSeoulPrecipAdapter.id, kmaSeoulPrecipAdapter],
  [londonPrecipAdapter.id, londonPrecipAdapter],
  [mrBeastSubscribersAdapter.id, mrBeastSubscribersAdapter],
  [mrBeastViewsAdapter.id, mrBeastViewsAdapter],
  [nbsPressReleaseAdapter.id, nbsPressReleaseAdapter],
  [nceiTornadoesAdapter.id, nceiTornadoesAdapter],
  [nasaGistempAdapter.id, nasaGistempAdapter],
  [noaaNycPrecipAdapter.id, noaaNycPrecipAdapter],
  [noaaSeattlePrecipAdapter.id, noaaSeattlePrecipAdapter],
  [nytFrontPageAdapter.id, nytFrontPageAdapter],
  [openAiChatGptOutagesAdapter.id, openAiChatGptOutagesAdapter],
  [ornnB200IndexAdapter.id, ornnB200IndexAdapter],
  [ornnH100IndexAdapter.id, ornnH100IndexAdapter],
  [ornnH200IndexAdapter.id, ornnH200IndexAdapter],
  [paidAppStoreAdapter.id, paidAppStoreAdapter],
  [parclDcHomeValueAdapter.id, parclDcHomeValueAdapter],
  [polymarketClarificationsAdapter.id, polymarketClarificationsAdapter],
  [polymarketDisputesAdapter.id, polymarketDisputesAdapter],
  [polymarketProposalsAdapter.id, polymarketProposalsAdapter],
  [powerballJackpotAdapter.id, powerballJackpotAdapter],
  [pythNaturalGasAdapter.id, pythNaturalGasAdapter],
  [pythWtiAdapter.id, pythWtiAdapter],
  [pythXagUsdAdapter.id, pythXagUsdAdapter],
  [pythXauUsdAdapter.id, pythXauUsdAdapter],
  [silverTrumpApprovalAdapter.id, silverTrumpApprovalAdapter],
  [spotifyTop50GlobalAdapter.id, spotifyTop50GlobalAdapter],
  [spotifyTop50UsaAdapter.id, spotifyTop50UsaAdapter],
  [strategyBitcoinPurchasesAdapter.id, strategyBitcoinPurchasesAdapter],
  [teslaDeliveriesAdapter.id, teslaDeliveriesAdapter],
  [trumpGettyPhotosAdapter.id, trumpGettyPhotosAdapter],
  [trumpScheduleAdapter.id, trumpScheduleAdapter],
  [trumpTruthAdapter.id, trumpTruthAdapter],
  [tsaPassengersAdapter.id, tsaPassengersAdapter],
  [umaVoteCommitsAdapter.id, umaVoteCommitsAdapter],
  [umaVoteRevealsAdapter.id, umaVoteRevealsAdapter],
  [umaVotingCommitteeAdapter.id, umaVotingCommitteeAdapter],
  [usgsEarthquakesAdapter.id, usgsEarthquakesAdapter],
  [volmexBvivAdapter.id, volmexBvivAdapter],
  [whiteHouseAliensNycAdapter.id, whiteHouseAliensNycAdapter],
  [whiteHouseBriefingsAdapter.id, whiteHouseBriefingsAdapter],
  [whiteHouseFullLidAdapter.id, whiteHouseFullLidAdapter],
  [whiteHouseTweetsAdapter.id, whiteHouseTweetsAdapter]
]);

export function getAdapter(adapterId: string): WebsiteAdapter {
  const adapter = adapters.get(adapterId);
  if (!adapter) {
    throw new Error(`Unknown adapter: ${adapterId}`);
  }
  return adapter;
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
