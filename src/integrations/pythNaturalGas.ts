import {
  createPythPriceStrikeAdapter,
  extractPythCandles,
  extractPythStrikesFromGamma,
  extractTopPythFeed,
  filterNewPythStrikeCrossings,
  findPythStrikeCrossings,
  formatPythPriceStrikeMonitorValue,
  pythPriceStrikeShouldAlertOnChange
} from "./pythPriceStrikes.js";

export const naturalGasConfig = {
  id: "pyth-natural-gas-strikes",
  commandName: "ngprice",
  displayName: "Pyth Natural Gas Strikes",
  search: "NGD",
  feedNamePattern: /^NGD[A-Z]\d$/i,
  defaultPolymarketUrl: "https://polymarket.com/event/what-price-will-ng-hit-in-may-2026",
  defaultChannelName: "ngprice",
  alertRoleName: "NG Price Alerts",
  alertRoleEmoji: "\u26FD"
};

export const pythNaturalGasAdapter = createPythPriceStrikeAdapter(naturalGasConfig);

export {
  extractPythCandles,
  extractPythStrikesFromGamma as extractNaturalGasStrikesFromGamma,
  extractTopPythFeed,
  filterNewPythStrikeCrossings,
  findPythStrikeCrossings,
  formatPythPriceStrikeMonitorValue,
  pythPriceStrikeShouldAlertOnChange as naturalGasShouldAlertOnChange
};

export function extractTopNaturalGasFeed(data: unknown) {
  return extractTopPythFeed(data, naturalGasConfig.feedNamePattern);
}
