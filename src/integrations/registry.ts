import { aaaRegularGasAdapter } from "./aaaGas.js";
import { allInPodcastAdapter } from "./allInPodcast.js";
import { artistSongReleasesAdapter, kpopSongReleasesAdapter } from "./appleSongReleases.js";
import { arenaAiLeaderboardAdapter } from "./arenaAiLeaderboard.js";
import { awsDisruptedAdapter } from "./awsDisrupted.js";
import { basedRevenueAdapter } from "./basedRevenue.js";
import { beaCurrentReleasesAdapter } from "./beaCurrentReleases.js";
import { blsCpiReleasesAdapter } from "./blsCpiReleases.js";
import { bonbastUsdIrrAdapter } from "./bonbast.js";
import { cdcFertilityRateAdapter } from "./cdcFertilityRate.js";
import { cdcMeaslesAdapter } from "./cdcMeasles.js";
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
import { noaaNycPrecipAdapter } from "./noaaNycPrecip.js";
import { noaaSeattlePrecipAdapter } from "./noaaSeattlePrecip.js";
import { nytFrontPageAdapter } from "./nytFrontPage.js";
import { ornnB200IndexAdapter } from "./ornnB200Index.js";
import { ornnH200IndexAdapter } from "./ornnH200Index.js";
import { paidAppStoreAdapter } from "./paidAppStore.js";
import { polymarketClarificationsAdapter } from "./polymarketClarifications.js";
import { polymarketDisputesAdapter } from "./polymarketDisputes.js";
import { polymarketProposalsAdapter } from "./polymarketProposals.js";
import { pythNaturalGasAdapter } from "./pythNaturalGas.js";
import { pythWtiAdapter } from "./pythWti.js";
import { pythXagUsdAdapter } from "./pythXagUsd.js";
import { pythXauUsdAdapter } from "./pythXauUsd.js";
import { spotifyTop50GlobalAdapter } from "./spotifyTop50Global.js";
import { spotifyTop50UsaAdapter } from "./spotifyTop50Usa.js";
import { strategyBitcoinPurchasesAdapter } from "./strategyBitcoinPurchases.js";
import { teslaDeliveriesAdapter } from "./teslaDeliveries.js";
import { trumpScheduleAdapter } from "./trumpSchedule.js";
import { trumpTruthAdapter } from "./trumpTruth.js";
import { tsaPassengersAdapter } from "./tsaPassengers.js";
import type { WebsiteAdapter } from "./types.js";
import { usgsEarthquakesAdapter } from "./usgsEarthquakes.js";
import { whiteHouseAliensNycAdapter } from "./whiteHouseAliensNyc.js";
import { whiteHouseFullLidAdapter } from "./whiteHouseFullLid.js";

const adapters = new Map<string, WebsiteAdapter>([
  [aaaRegularGasAdapter.id, aaaRegularGasAdapter],
  [allInPodcastAdapter.id, allInPodcastAdapter],
  [artistSongReleasesAdapter.id, artistSongReleasesAdapter],
  [arenaAiLeaderboardAdapter.id, arenaAiLeaderboardAdapter],
  [awsDisruptedAdapter.id, awsDisruptedAdapter],
  [basedRevenueAdapter.id, basedRevenueAdapter],
  [beaCurrentReleasesAdapter.id, beaCurrentReleasesAdapter],
  [blsCpiReleasesAdapter.id, blsCpiReleasesAdapter],
  [bonbastUsdIrrAdapter.id, bonbastUsdIrrAdapter],
  [cdcFertilityRateAdapter.id, cdcFertilityRateAdapter],
  [cdcMeaslesAdapter.id, cdcMeaslesAdapter],
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
  [noaaNycPrecipAdapter.id, noaaNycPrecipAdapter],
  [noaaSeattlePrecipAdapter.id, noaaSeattlePrecipAdapter],
  [nytFrontPageAdapter.id, nytFrontPageAdapter],
  [ornnB200IndexAdapter.id, ornnB200IndexAdapter],
  [ornnH200IndexAdapter.id, ornnH200IndexAdapter],
  [paidAppStoreAdapter.id, paidAppStoreAdapter],
  [polymarketClarificationsAdapter.id, polymarketClarificationsAdapter],
  [polymarketDisputesAdapter.id, polymarketDisputesAdapter],
  [polymarketProposalsAdapter.id, polymarketProposalsAdapter],
  [pythNaturalGasAdapter.id, pythNaturalGasAdapter],
  [pythWtiAdapter.id, pythWtiAdapter],
  [pythXagUsdAdapter.id, pythXagUsdAdapter],
  [pythXauUsdAdapter.id, pythXauUsdAdapter],
  [spotifyTop50GlobalAdapter.id, spotifyTop50GlobalAdapter],
  [spotifyTop50UsaAdapter.id, spotifyTop50UsaAdapter],
  [strategyBitcoinPurchasesAdapter.id, strategyBitcoinPurchasesAdapter],
  [teslaDeliveriesAdapter.id, teslaDeliveriesAdapter],
  [trumpScheduleAdapter.id, trumpScheduleAdapter],
  [trumpTruthAdapter.id, trumpTruthAdapter],
  [tsaPassengersAdapter.id, tsaPassengersAdapter],
  [usgsEarthquakesAdapter.id, usgsEarthquakesAdapter],
  [whiteHouseAliensNycAdapter.id, whiteHouseAliensNycAdapter],
  [whiteHouseFullLidAdapter.id, whiteHouseFullLidAdapter]
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
