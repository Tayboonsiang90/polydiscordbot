import { createPythPriceStrikeAdapter } from "./pythPriceStrikes.js";

export const xauUsdConfig = {
  id: "pyth-xauusd-strikes",
  commandName: "xauusd",
  displayName: "Pyth XAUUSD Strikes",
  search: "XAUUSD",
  sourceUrl: "https://pythdata.app/explore/Metal.XAU%2FUSD",
  priceFeedsQuery: "Metal.XAU/USD",
  feedNamePattern: /^XAUUSD$/i,
  defaultPolymarketUrl: "https://polymarket.com/event/what-price-will-xauusd-hit-in-may-2026",
  defaultChannelName: "xauusd",
  alertRoleName: "XAUUSD Price Alerts",
  alertRoleEmoji: "\uD83E\uDD47"
};

export const pythXauUsdAdapter = createPythPriceStrikeAdapter(xauUsdConfig);
