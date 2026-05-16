import { createPythPriceStrikeAdapter } from "./pythPriceStrikes.js";

export const xagUsdConfig = {
  id: "pyth-xagusd-strikes",
  commandName: "xagusd",
  displayName: "Pyth XAGUSD Strikes",
  search: "XAGUSD",
  sourceUrl: "https://pythdata.app/explore/Metal.XAG%2FUSD",
  priceFeedsQuery: "Metal.XAG/USD",
  feedNamePattern: /^XAGUSD$/i,
  defaultPolymarketUrl: "https://polymarket.com/event/what-price-will-xagusd-hit-in-may-2026",
  defaultChannelName: "xagusd",
  alertRoleName: "XAGUSD Price Alerts",
  alertRoleEmoji: "\uD83E\uDD48"
};

export const pythXagUsdAdapter = createPythPriceStrikeAdapter(xagUsdConfig);
