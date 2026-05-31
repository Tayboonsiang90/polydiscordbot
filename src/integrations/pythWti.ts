import { createPythPriceStrikeAdapter } from "./pythPriceStrikes.js";

export const wtiConfig = {
  id: "pyth-wti-strikes",
  commandName: "wti",
  displayName: "Pyth WTI Strikes",
  search: "WTI",
  feedNamePattern: /^WTI[A-Z]\d$/i,
  marketSlugPrefix: "what-price-will-wti-hit-in-",
  marketSearchQuery: "what price will wti hit",
  defaultPolymarketUrl: "https://polymarket.com/event/what-price-will-wti-hit-in-may-2026",
  defaultChannelName: "wti",
  alertRoleName: "WTI Price Alerts",
  alertRoleEmoji: "\uD83D\uDEE2\uFE0F"
};

export const pythWtiAdapter = createPythPriceStrikeAdapter(wtiConfig);
