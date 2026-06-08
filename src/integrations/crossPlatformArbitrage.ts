import { fetchWithTimeout } from "../http.js";
import { parseSettingsJson } from "../settingsJson.js";
import type {
  AdapterValue,
  ArbitrageSetupInput,
  ArbitrageSetupOutcome,
  ArbitrageSetupResult,
  ArbitrageWatchInput,
  ArbitrageWatchResult,
  ArbitrageWatchSide,
  ArbitrageWatchSummary,
  Integration,
  WebsiteAdapter
} from "./types.js";

type PlatformId = "polymarket" | "predict" | "opinion";
type BinarySide = "YES" | "NO";
type TradeVerb = "BUY" | "SELL";
type RouteKind = "hedged-package" | "inventory-rebalance";

type OrderBookLevel = {
  price: number;
  size: number;
};

type SideOrderBook = {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
};

type BinaryOrderBooks = Record<BinarySide, SideOrderBook>;

type PlatformFeeModel =
  | {
      platform: "polymarket";
      feesEnabled: boolean;
      rate: number;
    }
  | {
      platform: "predict";
      feeRateBps: number;
    }
  | {
      platform: "opinion";
      topicRate: number;
      minFeeUsd: number;
      userDiscount: number;
      transactionDiscount: number;
      referralDiscount: number;
    };

type PlatformCatalogOutcome = {
  label: string;
  normalizedLabel: string;
  platformMarketId?: string;
  marketSlug?: string;
  tokenIds?: [string, string];
  raw?: unknown;
};

type PlatformCatalog = {
  platform: PlatformId;
  url: string;
  title: string;
  outcomes: PlatformCatalogOutcome[];
};

type PlatformOutcomeBooks = {
  platform: PlatformId;
  url: string;
  title: string;
  label: string;
  marketId: string;
  books: BinaryOrderBooks;
  feeModel: PlatformFeeModel;
};

type TradeAction = {
  verb: TradeVerb;
  platform: PlatformId;
  side: BinarySide;
  shares: number;
  avgPrice: number;
  grossUsd: number;
  feeUsd: number;
  url: string;
};

export type ArbitrageOpportunity = {
  kind: RouteKind;
  outcome: string;
  side: ArbitrageWatchSide;
  shares: number;
  totalCostUsd: number;
  payoutUsd: number;
  netProfitUsd: number;
  netEdgeBps: number;
  actions: TradeAction[];
  routeKey: string;
};

type PendingArbitrageSetup = {
  urls: string[];
  outcomes: ArbitrageSetupOutcome[];
  maxStakeUsd: number;
  minNetEdgeBps: number;
  createdAt: string;
  selectedOutcomeIndex?: number;
};

type CrossPlatformArbitrageSettings = {
  watch?: ArbitrageWatchSummary;
  pendingArbitrageSetup?: PendingArbitrageSetup;
};

const sourceUrl = "https://polymarket.com";
const defaultMaxStakeUsd = 25;
const defaultMinNetEdgeBps = 50;
const maxSetupOutcomes = 25;
const minExecutableShares = 0.000001;
const polymarketGammaBaseUrl = "https://gamma-api.polymarket.com";
const polymarketClobBaseUrl = "https://clob.polymarket.com";
const predictApiBaseUrl = "https://api.predict.fun";
const opinionApiBaseUrl = "https://openapi.opinion.trade/openapi";

export const crossPlatformArbitrageAdapter: WebsiteAdapter = {
  id: "cross-platform-arbitrage",
  commandName: "arb",
  displayName: "Cross-Platform Arbitrage",
  sourceUrl,
  defaultChannelName: "arb",
  alertRoleName: "Arbitrage Alerts",
  alertRoleEmoji: "\uD83D\uDD01",
  getPollIntervalMinutes: () => 1,
  getErrorNoticeWindowMinutes: () => 15,
  async prepareArbitrageSetup(integration: Integration, input: ArbitrageSetupInput): Promise<ArbitrageSetupResult> {
    return prepareCrossPlatformArbitrageSetup(integration, input);
  },
  async configureArbitrageWatch(integration: Integration, input: ArbitrageWatchInput): Promise<ArbitrageWatchResult> {
    return configureCrossPlatformArbitrageWatch(integration, input);
  },
  selectArbitrageOutcome(integration: Integration, outcomeIndex: number): ArbitrageSetupResult {
    return selectCrossPlatformArbitrageOutcome(integration, outcomeIndex);
  },
  selectArbitrageSide(integration: Integration, side: ArbitrageWatchSide): ArbitrageWatchResult {
    return selectCrossPlatformArbitrageSide(integration, side);
  },
  getArbitrageWatch(integration: Integration): ArbitrageWatchSummary | null {
    return parseArbitrageSettings(integration.settingsJson).watch ?? null;
  },
  shouldAlertOnChange(_previousValue: string | null, currentValue: string): boolean {
    return currentValue.startsWith("ARB AFTER FEES");
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    const observedAt = new Date();
    const watch = integration ? parseArbitrageSettings(integration.settingsJson).watch : undefined;
    if (!watch) {
      return {
        value: "No arbitrage watch configured. Run /arb setup or /arb watch in this channel.",
        rawValue: "not-configured",
        observedAt
      };
    }

    const opportunity = await evaluateConfiguredArbitrage(watch);
    const value = opportunity
      ? formatOpportunityValue(opportunity, watch)
      : formatNoOpportunityValue(watch);
    return {
      value,
      rawValue: opportunity ? JSON.stringify(summarizeOpportunity(opportunity)) : "no-after-fee-arbitrage",
      observedAt
    };
  }
};

export async function prepareCrossPlatformArbitrageSetup(
  integration: Integration,
  input: ArbitrageSetupInput
): Promise<ArbitrageSetupResult> {
  const normalizedInput = normalizeSetupInput(input);
  const catalogs = await fetchCatalogsForUrls(normalizedInput.urls);
  const outcomes = findCommonOutcomes(catalogs);
  if (outcomes.length === 0) {
    throw new Error("No shared outcomes were found across those URLs.");
  }

  const settings = parseArbitrageSettings(integration.settingsJson);
  const pendingArbitrageSetup: PendingArbitrageSetup = {
    urls: normalizedInput.urls,
    outcomes: outcomes.slice(0, maxSetupOutcomes),
    maxStakeUsd: normalizedInput.maxStakeUsd,
    minNetEdgeBps: normalizedInput.minNetEdgeBps,
    createdAt: new Date().toISOString()
  };
  const settingsJson = JSON.stringify({
    ...settings,
    pendingArbitrageSetup
  });

  return {
    settingsJson,
    message:
      outcomes.length > maxSetupOutcomes
        ? `Found ${outcomes.length} shared outcomes. Showing the first ${maxSetupOutcomes}; use /arb watch with an outcome name if yours is not listed.`
        : `Found ${outcomes.length} shared outcome(s). Choose the outcome, then choose YES, NO, or BOTH.`,
    outcomes: pendingArbitrageSetup.outcomes
  };
}

export async function configureCrossPlatformArbitrageWatch(
  integration: Integration,
  input: ArbitrageWatchInput
): Promise<ArbitrageWatchResult> {
  const normalizedInput = normalizeSetupInput(input);
  const catalogs = await fetchCatalogsForUrls(normalizedInput.urls);
  const outcomes = findCommonOutcomes(catalogs);
  const normalizedOutcome = normalizeOutcomeLabel(input.outcome);
  const match = outcomes.find((candidate) => candidate.label === input.outcome || normalizeOutcomeLabel(candidate.label) === normalizedOutcome);
  if (!match) {
    const suggestions = outcomes.slice(0, 10).map((outcome) => outcome.label).join(", ");
    throw new Error(`Outcome "${input.outcome}" was not found on every URL. Shared outcomes: ${suggestions || "none"}.`);
  }

  return buildWatchResult(integration, {
    urls: normalizedInput.urls,
    outcome: match.label,
    side: input.side,
    maxStakeUsd: normalizedInput.maxStakeUsd,
    minNetEdgeBps: normalizedInput.minNetEdgeBps,
    createdAt: new Date().toISOString()
  });
}

export function selectCrossPlatformArbitrageOutcome(
  integration: Integration,
  outcomeIndex: number
): ArbitrageSetupResult {
  const settings = parseArbitrageSettings(integration.settingsJson);
  const pending = settings.pendingArbitrageSetup;
  const selected = pending?.outcomes[outcomeIndex];
  if (!pending || !selected) {
    throw new Error("No pending arbitrage setup was found. Run /arb setup again.");
  }

  const nextPending: PendingArbitrageSetup = {
    ...pending,
    selectedOutcomeIndex: outcomeIndex
  };

  return {
    settingsJson: JSON.stringify({
      ...settings,
      pendingArbitrageSetup: nextPending
    }),
    message: `Selected ${selected.label}. Choose which side to monitor.`,
    outcomes: pending.outcomes,
    selectedOutcome: selected.label
  };
}

export function selectCrossPlatformArbitrageSide(
  integration: Integration,
  side: ArbitrageWatchSide
): ArbitrageWatchResult {
  const settings = parseArbitrageSettings(integration.settingsJson);
  const pending = settings.pendingArbitrageSetup;
  if (!pending || pending.selectedOutcomeIndex === undefined) {
    throw new Error("Choose an arbitrage outcome first, or run /arb setup again.");
  }

  const outcome = pending.outcomes[pending.selectedOutcomeIndex];
  if (!outcome) {
    throw new Error("The selected arbitrage outcome is no longer available. Run /arb setup again.");
  }

  return buildWatchResult(integration, {
    urls: pending.urls,
    outcome: outcome.label,
    side,
    maxStakeUsd: pending.maxStakeUsd,
    minNetEdgeBps: pending.minNetEdgeBps,
    createdAt: new Date().toISOString()
  });
}

export function parseArbitrageSettings(settingsJson: string | null): CrossPlatformArbitrageSettings {
  const settings = parseSettingsJson(settingsJson) as CrossPlatformArbitrageSettings;
  return {
    ...settings,
    watch: normalizeWatch(settings.watch),
    pendingArbitrageSetup: normalizePendingSetup(settings.pendingArbitrageSetup)
  };
}

export function parseArbitrageUrls(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeOutcomeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(inc|inc\.|corp|corp\.|corporation|company|labs|lab|technologies|technology|holdings|ltd|ltd\.)\b/g, " ")
    .replace(/\b(ipo|before|by|will|the|a|an|in|on|of|for|to|yes|no|resolve|resolves|2025|2026|2027)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function calculatePlatformFee(
  feeModel: PlatformFeeModel,
  price: number,
  shares: number,
  role: "maker" | "taker" = "taker"
): number {
  if (role === "maker" || shares <= 0) {
    return 0;
  }

  const boundedPrice = Math.min(Math.max(price, 0), 1);
  if (feeModel.platform === "polymarket") {
    return feeModel.feesEnabled ? shares * feeModel.rate * boundedPrice * (1 - boundedPrice) : 0;
  }

  if (feeModel.platform === "predict") {
    return shares * (feeModel.feeRateBps / 10_000) * Math.min(boundedPrice, 1 - boundedPrice);
  }

  const notional = shares * boundedPrice;
  const effectiveRate =
    feeModel.topicRate *
    boundedPrice *
    (1 - boundedPrice) *
    (1 - feeModel.userDiscount) *
    (1 - feeModel.transactionDiscount) *
    (1 - feeModel.referralDiscount);
  return Math.max(notional * effectiveRate, feeModel.minFeeUsd);
}

export function evaluateArbitrage(
  outcomes: PlatformOutcomeBooks[],
  watch: Pick<ArbitrageWatchSummary, "outcome" | "side" | "maxStakeUsd" | "minNetEdgeBps">
): ArbitrageOpportunity | null {
  const opportunities: ArbitrageOpportunity[] = [];
  const sides = watch.side === "BOTH" ? (["YES", "NO"] as const) : ([watch.side] as BinarySide[]);

  for (const side of sides) {
    opportunities.push(...evaluateInventoryRoutes(outcomes, side, watch));
  }
  opportunities.push(...evaluateHedgedPackageRoutes(outcomes, watch));

  return (
    opportunities
      .filter((opportunity) => opportunity.netProfitUsd > 0 && opportunity.netEdgeBps >= watch.minNetEdgeBps)
      .sort((left, right) => right.netProfitUsd - left.netProfitUsd || right.netEdgeBps - left.netEdgeBps)[0] ?? null
  );
}

async function evaluateConfiguredArbitrage(watch: ArbitrageWatchSummary): Promise<ArbitrageOpportunity | null> {
  const outcomes = await Promise.all(watch.urls.map((url) => fetchOutcomeBooksForUrl(url, watch.outcome)));
  return evaluateArbitrage(outcomes, watch);
}

function evaluateHedgedPackageRoutes(
  outcomes: PlatformOutcomeBooks[],
  watch: Pick<ArbitrageWatchSummary, "outcome" | "side" | "maxStakeUsd">
): ArbitrageOpportunity[] {
  const opportunities: ArbitrageOpportunity[] = [];
  for (const yesMarket of outcomes) {
    for (const noMarket of outcomes) {
      if (yesMarket.platform === noMarket.platform && yesMarket.marketId === noMarket.marketId) {
        continue;
      }

      const opportunity = evaluateHedgedPackageRoute(yesMarket, noMarket, watch);
      if (opportunity) {
        opportunities.push(opportunity);
      }
    }
  }
  return opportunities;
}

function evaluateHedgedPackageRoute(
  yesMarket: PlatformOutcomeBooks,
  noMarket: PlatformOutcomeBooks,
  watch: Pick<ArbitrageWatchSummary, "outcome" | "side" | "maxStakeUsd">
): ArbitrageOpportunity | null {
  const yesLevels = cloneLevels(yesMarket.books.YES.asks);
  const noLevels = cloneLevels(noMarket.books.NO.asks);
  let yesIndex = 0;
  let noIndex = 0;
  let yesRemaining = yesLevels[0]?.size ?? 0;
  let noRemaining = noLevels[0]?.size ?? 0;
  let remainingBudget = watch.maxStakeUsd;
  const yesAction = createAction("BUY", yesMarket, "YES");
  const noAction = createAction("BUY", noMarket, "NO");

  while (yesIndex < yesLevels.length && noIndex < noLevels.length && remainingBudget > 0) {
    const yesLevel = yesLevels[yesIndex];
    const noLevel = noLevels[noIndex];
    if (!yesLevel || !noLevel) {
      break;
    }

    const maxShares = Math.min(yesRemaining, noRemaining);
    const shares = maxAffordableShares(maxShares, remainingBudget, (candidateShares) =>
      buyTotal(yesMarket, yesLevel.price, candidateShares) + buyTotal(noMarket, noLevel.price, candidateShares)
    );
    if (shares < minExecutableShares) {
      break;
    }

    const yesFee = calculatePlatformFee(yesMarket.feeModel, yesLevel.price, shares);
    const noFee = calculatePlatformFee(noMarket.feeModel, noLevel.price, shares);
    const totalCost = shares * yesLevel.price + yesFee + shares * noLevel.price + noFee;
    const profit = shares - totalCost;
    if (profit <= 0) {
      break;
    }

    addActionFill(yesAction, shares, yesLevel.price, yesFee);
    addActionFill(noAction, shares, noLevel.price, noFee);
    remainingBudget -= totalCost;
    yesRemaining -= shares;
    noRemaining -= shares;
    if (yesRemaining <= minExecutableShares) {
      yesIndex += 1;
      yesRemaining = yesLevels[yesIndex]?.size ?? 0;
    }
    if (noRemaining <= minExecutableShares) {
      noIndex += 1;
      noRemaining = noLevels[noIndex]?.size ?? 0;
    }
  }

  const shares = Math.min(yesAction.shares, noAction.shares);
  if (shares < minExecutableShares) {
    return null;
  }

  const actions = [yesAction, noAction].map(finalizeAction);
  const totalCostUsd = actions.reduce((sum, action) => sum + action.grossUsd + action.feeUsd, 0);
  const payoutUsd = shares;
  const netProfitUsd = payoutUsd - totalCostUsd;
  return {
    kind: "hedged-package",
    outcome: watch.outcome,
    side: watch.side,
    shares,
    totalCostUsd,
    payoutUsd,
    netProfitUsd,
    netEdgeBps: totalCostUsd > 0 ? (netProfitUsd / totalCostUsd) * 10_000 : 0,
    actions,
    routeKey: `package:${yesMarket.platform}:${noMarket.platform}:YES-NO`
  };
}

function evaluateInventoryRoutes(
  outcomes: PlatformOutcomeBooks[],
  side: BinarySide,
  watch: Pick<ArbitrageWatchSummary, "outcome" | "side" | "maxStakeUsd">
): ArbitrageOpportunity[] {
  const opportunities: ArbitrageOpportunity[] = [];
  for (const sellMarket of outcomes) {
    for (const buyMarket of outcomes) {
      if (sellMarket.platform === buyMarket.platform && sellMarket.marketId === buyMarket.marketId) {
        continue;
      }

      const opportunity = evaluateInventoryRoute(sellMarket, buyMarket, side, watch);
      if (opportunity) {
        opportunities.push(opportunity);
      }
    }
  }
  return opportunities;
}

function evaluateInventoryRoute(
  sellMarket: PlatformOutcomeBooks,
  buyMarket: PlatformOutcomeBooks,
  side: BinarySide,
  watch: Pick<ArbitrageWatchSummary, "outcome" | "side" | "maxStakeUsd">
): ArbitrageOpportunity | null {
  const sellLevels = cloneLevels(sellMarket.books[side].bids);
  const buyLevels = cloneLevels(buyMarket.books[side].asks);
  let sellIndex = 0;
  let buyIndex = 0;
  let sellRemaining = sellLevels[0]?.size ?? 0;
  let buyRemaining = buyLevels[0]?.size ?? 0;
  let remainingBudget = watch.maxStakeUsd;
  const sellAction = createAction("SELL", sellMarket, side);
  const buyAction = createAction("BUY", buyMarket, side);

  while (sellIndex < sellLevels.length && buyIndex < buyLevels.length && remainingBudget > 0) {
    const sellLevel = sellLevels[sellIndex];
    const buyLevel = buyLevels[buyIndex];
    if (!sellLevel || !buyLevel) {
      break;
    }

    const maxShares = Math.min(sellRemaining, buyRemaining);
    const shares = maxAffordableShares(maxShares, remainingBudget, (candidateShares) =>
      buyTotal(buyMarket, buyLevel.price, candidateShares)
    );
    if (shares < minExecutableShares) {
      break;
    }

    const sellFee = calculatePlatformFee(sellMarket.feeModel, sellLevel.price, shares);
    const buyFee = calculatePlatformFee(buyMarket.feeModel, buyLevel.price, shares);
    const sellNet = shares * sellLevel.price - sellFee;
    const buyCost = shares * buyLevel.price + buyFee;
    if (sellNet - buyCost <= 0) {
      break;
    }

    addActionFill(sellAction, shares, sellLevel.price, sellFee);
    addActionFill(buyAction, shares, buyLevel.price, buyFee);
    remainingBudget -= buyCost;
    sellRemaining -= shares;
    buyRemaining -= shares;
    if (sellRemaining <= minExecutableShares) {
      sellIndex += 1;
      sellRemaining = sellLevels[sellIndex]?.size ?? 0;
    }
    if (buyRemaining <= minExecutableShares) {
      buyIndex += 1;
      buyRemaining = buyLevels[buyIndex]?.size ?? 0;
    }
  }

  const shares = Math.min(sellAction.shares, buyAction.shares);
  if (shares < minExecutableShares) {
    return null;
  }

  const actions = [sellAction, buyAction].map(finalizeAction);
  const sell = actions[0];
  const buy = actions[1];
  if (!sell || !buy) {
    return null;
  }

  const sellProceedsUsd = sell.grossUsd - sell.feeUsd;
  const buyCostUsd = buy.grossUsd + buy.feeUsd;
  const netProfitUsd = sellProceedsUsd - buyCostUsd;
  return {
    kind: "inventory-rebalance",
    outcome: watch.outcome,
    side,
    shares,
    totalCostUsd: buyCostUsd,
    payoutUsd: sellProceedsUsd,
    netProfitUsd,
    netEdgeBps: buyCostUsd > 0 ? (netProfitUsd / buyCostUsd) * 10_000 : 0,
    actions,
    routeKey: `inventory:${side}:${sellMarket.platform}:${buyMarket.platform}`
  };
}

function buyTotal(market: PlatformOutcomeBooks, price: number, shares: number): number {
  return shares * price + calculatePlatformFee(market.feeModel, price, shares);
}

function maxAffordableShares(maxShares: number, budget: number, cost: (shares: number) => number): number {
  if (maxShares <= 0 || budget <= 0) {
    return 0;
  }
  if (cost(maxShares) <= budget) {
    return maxShares;
  }

  let low = 0;
  let high = maxShares;
  for (let index = 0; index < 48; index += 1) {
    const mid = (low + high) / 2;
    if (cost(mid) <= budget) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return low;
}

function createAction(verb: TradeVerb, market: PlatformOutcomeBooks, side: BinarySide): TradeAction {
  return {
    verb,
    platform: market.platform,
    side,
    shares: 0,
    avgPrice: 0,
    grossUsd: 0,
    feeUsd: 0,
    url: market.url
  };
}

function addActionFill(action: TradeAction, shares: number, price: number, feeUsd: number): void {
  action.shares += shares;
  action.grossUsd += shares * price;
  action.feeUsd += feeUsd;
}

function finalizeAction(action: TradeAction): TradeAction {
  return {
    ...action,
    avgPrice: action.shares > 0 ? action.grossUsd / action.shares : 0
  };
}

async function fetchCatalogsForUrls(urls: string[]): Promise<PlatformCatalog[]> {
  return Promise.all(urls.map(fetchCatalogForUrl));
}

async function fetchCatalogForUrl(url: string): Promise<PlatformCatalog> {
  const platform = detectPlatform(url);
  if (platform === "polymarket") {
    return fetchPolymarketCatalog(url);
  }
  if (platform === "predict") {
    return fetchPredictCatalog(url);
  }
  return fetchOpinionCatalog(url);
}

async function fetchOutcomeBooksForUrl(url: string, outcome: string): Promise<PlatformOutcomeBooks> {
  const platform = detectPlatform(url);
  if (platform === "polymarket") {
    return fetchPolymarketOutcomeBooks(url, outcome);
  }
  if (platform === "predict") {
    return fetchPredictOutcomeBooks(url, outcome);
  }
  return fetchOpinionOutcomeBooks(url, outcome);
}

function detectPlatform(url: string): PlatformId {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname === "polymarket.com" || hostname === "www.polymarket.com") {
    return "polymarket";
  }
  if (hostname === "predict.fun" || hostname.endsWith(".predict.fun")) {
    return "predict";
  }
  if (hostname.includes("opinion.trade")) {
    return "opinion";
  }

  throw new Error(`Unsupported arbitrage platform URL: ${url}`);
}

async function fetchPolymarketCatalog(url: string): Promise<PlatformCatalog> {
  const context = parsePolymarketUrl(url);
  if (context.eventSlug) {
    const event = await fetchPolymarketEvent(context.eventSlug);
    return buildPolymarketCatalogFromEvent(url, event, context.marketSlug);
  }

  if (context.marketSlug) {
    const market = await fetchPolymarketMarket(context.marketSlug);
    return buildPolymarketCatalogFromMarkets(url, stringValue(market.question) ?? stringValue(market.title) ?? context.marketSlug, [market]);
  }

  throw new Error(`Could not parse Polymarket event or market slug from ${url}`);
}

async function fetchPolymarketOutcomeBooks(url: string, outcome: string): Promise<PlatformOutcomeBooks> {
  const catalog = await fetchPolymarketCatalog(url);
  const matched = findCatalogOutcome(catalog, outcome);
  if (!matched?.tokenIds) {
    throw new Error(`Polymarket outcome "${outcome}" does not have YES/NO CLOB token IDs.`);
  }

  const market = matched.raw as Record<string, unknown>;
  const yesBook = await fetchPolymarketBook(matched.tokenIds[0]);
  const noBook = await fetchPolymarketBook(matched.tokenIds[1]);
  return {
    platform: "polymarket",
    url,
    title: catalog.title,
    label: matched.label,
    marketId: stringValue(market.id) ?? matched.marketSlug ?? matched.label,
    books: {
      YES: yesBook,
      NO: noBook
    },
    feeModel: {
      platform: "polymarket",
      feesEnabled: market.feesEnabled !== false,
      rate: numberValue((market.feeSchedule as Record<string, unknown> | undefined)?.rate) ?? 0.04
    }
  };
}

async function fetchPolymarketEvent(slug: string): Promise<Record<string, unknown>> {
  const payload = await fetchJson(`${polymarketGammaBaseUrl}/events?slug=${encodeURIComponent(slug)}`);
  const event = firstObject(payload);
  if (!event) {
    throw new Error(`Polymarket event not found: ${slug}`);
  }
  return event;
}

async function fetchPolymarketMarket(slug: string): Promise<Record<string, unknown>> {
  const payload = await fetchJson(`${polymarketGammaBaseUrl}/markets?slug=${encodeURIComponent(slug)}`);
  const market = firstObject(payload);
  if (!market) {
    throw new Error(`Polymarket market not found: ${slug}`);
  }
  return market;
}

async function fetchPolymarketBook(tokenId: string): Promise<SideOrderBook> {
  const payload = await fetchJson(`${polymarketClobBaseUrl}/book?token_id=${encodeURIComponent(tokenId)}`);
  const book = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return {
    asks: normalizeOrderBookLevels(book.asks, "asc"),
    bids: normalizeOrderBookLevels(book.bids, "desc")
  };
}

function buildPolymarketCatalogFromEvent(url: string, event: Record<string, unknown>, marketSlug?: string): PlatformCatalog {
  const markets = arrayValue(event.markets).filter(isRecord);
  const filteredMarkets = marketSlug
    ? markets.filter((market) => stringValue(market.slug) === marketSlug)
    : markets;
  return buildPolymarketCatalogFromMarkets(url, stringValue(event.title) ?? stringValue(event.slug) ?? "Polymarket event", filteredMarkets);
}

function buildPolymarketCatalogFromMarkets(
  url: string,
  title: string,
  markets: Record<string, unknown>[]
): PlatformCatalog {
  const outcomes = markets
    .filter((market) => market.active !== false && market.closed !== true && market.archived !== true)
    .map((market) => {
      const label = extractOutcomeLabel(market.groupItemTitle, market.question, market.title, market.slug);
      return {
        label,
        normalizedLabel: normalizeOutcomeLabel(label),
        platformMarketId: stringValue(market.id),
        marketSlug: stringValue(market.slug),
        tokenIds: parseTokenPair(market.clobTokenIds),
        raw: market
      };
    })
    .filter((outcome) => outcome.normalizedLabel.length > 0);
  return {
    platform: "polymarket",
    url,
    title,
    outcomes
  };
}

function parsePolymarketUrl(url: string): { eventSlug?: string; marketSlug?: string } {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  if (parts[0] === "event") {
    return {
      eventSlug: parts[1],
      marketSlug: parts[2]
    };
  }
  if (parts[0] === "market") {
    return { marketSlug: parts[1] };
  }
  return {};
}

async function fetchPredictCatalog(url: string): Promise<PlatformCatalog> {
  const slugOrId = parseLastPathSegment(url);
  const apiKey = getRequiredEnv("PREDICT_API_KEY", "Predict production API requires PREDICT_API_KEY for arbitrage monitoring.");
  const search = await fetchPredictJson(`/v1/search?query=${encodeURIComponent(slugOrId)}&includeResolved=false&limit=20`, apiKey);
  const catalog = buildPredictCatalogFromSearch(url, slugOrId, search);
  if (catalog.outcomes.length === 0) {
    throw new Error(`Predict market outcomes not found for ${slugOrId}.`);
  }
  return catalog;
}

async function fetchPredictOutcomeBooks(url: string, outcome: string): Promise<PlatformOutcomeBooks> {
  const catalog = await fetchPredictCatalog(url);
  const matched = findCatalogOutcome(catalog, outcome);
  const marketId = matched?.platformMarketId;
  if (!matched || !marketId) {
    throw new Error(`Predict outcome "${outcome}" was not found in ${url}.`);
  }

  const apiKey = getRequiredEnv("PREDICT_API_KEY", "Predict production API requires PREDICT_API_KEY for arbitrage monitoring.");
  const [marketPayload, orderBookPayload] = await Promise.all([
    fetchPredictJson(`/v1/markets/${encodeURIComponent(marketId)}`, apiKey),
    fetchPredictJson(`/v1/markets/${encodeURIComponent(marketId)}/orderbook`, apiKey)
  ]);
  const market = firstObject((marketPayload as Record<string, unknown>).data) ?? firstObject(marketPayload) ?? {};
  const orderBook = firstObject((orderBookPayload as Record<string, unknown>).data) ?? firstObject(orderBookPayload) ?? {};
  const yesBook = {
    asks: normalizeOrderBookLevels(orderBook.asks, "asc"),
    bids: normalizeOrderBookLevels(orderBook.bids, "desc")
  };

  return {
    platform: "predict",
    url,
    title: catalog.title,
    label: matched.label,
    marketId,
    books: {
      YES: yesBook,
      NO: invertYesBookToNoBook(yesBook)
    },
    feeModel: {
      platform: "predict",
      feeRateBps: numberValue(market.feeRateBps) ?? numberValue((matched.raw as Record<string, unknown> | undefined)?.feeRateBps) ?? 200
    }
  };
}

async function fetchPredictJson(path: string, apiKey: string): Promise<unknown> {
  return fetchJson(`${predictApiBaseUrl}${path}`, {
    headers: {
      "x-api-key": apiKey,
      "user-agent": "PolymarketResolutionMonitorBot/0.1"
    }
  });
}

function buildPredictCatalogFromSearch(url: string, slugOrId: string, payload: unknown): PlatformCatalog {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
  const categories = arrayValue((data as Record<string, unknown>).categories).filter(isRecord);
  const markets = arrayValue((data as Record<string, unknown>).markets).filter(isRecord);
  const normalizedSlug = normalizeOutcomeLabel(slugOrId);
  const category = categories.find((candidate) => normalizeOutcomeLabel(stringValue(candidate.slug) ?? stringValue(candidate.title) ?? "") === normalizedSlug);
  const categoryMarkets = category ? arrayValue(category.markets).filter(isRecord) : [];
  const sourceMarkets = categoryMarkets.length ? categoryMarkets : markets;
  const title = stringValue(category?.title) ?? stringValue(category?.question) ?? slugOrId;

  return {
    platform: "predict",
    url,
    title,
    outcomes: sourceMarkets
      .map((market) => {
        const label = extractOutcomeLabel(market.outcome, market.groupItemTitle, market.title, market.question, market.slug);
        return {
          label,
          normalizedLabel: normalizeOutcomeLabel(label),
          platformMarketId: stringValue(market.id),
          marketSlug: stringValue(market.slug),
          raw: market
        };
      })
      .filter((outcome) => outcome.normalizedLabel.length > 0)
  };
}

async function fetchOpinionCatalog(url: string): Promise<PlatformCatalog> {
  const marketId = parseOpinionMarketId(url);
  const apiKey = getRequiredEnv("OPINION_API_KEY", "Opinion OpenAPI requires OPINION_API_KEY for arbitrage monitoring.");
  const payload = await fetchOpinionJson(`/market/${encodeURIComponent(marketId)}`, apiKey);
  const market = firstObject((payload as Record<string, unknown>).result) ?? firstObject(payload);
  if (!market) {
    throw new Error(`Opinion market not found: ${marketId}`);
  }
  return buildOpinionCatalog(url, marketId, market);
}

async function fetchOpinionOutcomeBooks(url: string, outcome: string): Promise<PlatformOutcomeBooks> {
  const catalog = await fetchOpinionCatalog(url);
  const matched = findCatalogOutcome(catalog, outcome);
  if (!matched?.tokenIds) {
    throw new Error(`Opinion outcome "${outcome}" does not have YES/NO token IDs.`);
  }

  const apiKey = getRequiredEnv("OPINION_API_KEY", "Opinion OpenAPI requires OPINION_API_KEY for arbitrage monitoring.");
  const [yesBook, noBook] = await Promise.all([
    fetchOpinionOrderBook(matched.tokenIds[0], apiKey),
    fetchOpinionOrderBook(matched.tokenIds[1], apiKey)
  ]);
  const raw = isRecord(matched.raw) ? matched.raw : {};
  return {
    platform: "opinion",
    url,
    title: catalog.title,
    label: matched.label,
    marketId: matched.platformMarketId ?? parseOpinionMarketId(url),
    books: {
      YES: yesBook,
      NO: noBook
    },
    feeModel: {
      platform: "opinion",
      topicRate: numberValue(raw.topic_rate) ?? numberValue(raw.topicRate) ?? Number(process.env.OPINION_DEFAULT_TOPIC_RATE ?? "0.08"),
      minFeeUsd: Number(process.env.OPINION_MIN_FEE_USD ?? "0.5"),
      userDiscount: Number(process.env.OPINION_USER_DISCOUNT ?? "0"),
      transactionDiscount: Number(process.env.OPINION_TRANSACTION_DISCOUNT ?? "0"),
      referralDiscount: Number(process.env.OPINION_REFERRAL_DISCOUNT ?? "0")
    }
  };
}

async function fetchOpinionJson(path: string, apiKey: string): Promise<unknown> {
  return fetchJson(`${opinionApiBaseUrl}${path}`, {
    headers: {
      apikey: apiKey,
      "user-agent": "PolymarketResolutionMonitorBot/0.1"
    }
  });
}

async function fetchOpinionOrderBook(tokenId: string, apiKey: string): Promise<SideOrderBook> {
  const payload = await fetchOpinionJson(`/token/orderbook?token_id=${encodeURIComponent(tokenId)}`, apiKey);
  const book = firstObject((payload as Record<string, unknown>).result) ?? firstObject(payload) ?? {};
  return {
    asks: normalizeOrderBookLevels(book.asks, "asc"),
    bids: normalizeOrderBookLevels(book.bids, "desc")
  };
}

function buildOpinionCatalog(url: string, marketId: string, market: Record<string, unknown>): PlatformCatalog {
  const outcomes =
    arrayValue(market.outcomes).filter(isRecord).length > 0
      ? arrayValue(market.outcomes).filter(isRecord)
      : arrayValue(market.tokens).filter(isRecord);
  return {
    platform: "opinion",
    url,
    title: stringValue(market.title) ?? stringValue(market.question) ?? marketId,
    outcomes: outcomes
      .map((outcome) => {
        const label = extractOutcomeLabel(outcome.outcome, outcome.name, outcome.title, outcome.question);
        return {
          label,
          normalizedLabel: normalizeOutcomeLabel(label),
          platformMarketId: stringValue(outcome.marketId) ?? marketId,
          tokenIds: parseTokenPair(outcome.tokenIds) ?? parseTokenPair([outcome.yesTokenId, outcome.noTokenId]),
          raw: outcome
        };
      })
      .filter((outcome) => outcome.normalizedLabel.length > 0)
  };
}

function parseOpinionMarketId(url: string): string {
  const pathParts = new URL(url).pathname.split("/").filter(Boolean);
  const numeric = pathParts.find((part) => /^\d+$/.test(part));
  if (numeric) {
    return numeric;
  }
  const last = pathParts.at(-1);
  if (last) {
    return last;
  }
  throw new Error(`Could not parse Opinion market id from ${url}`);
}

function findCommonOutcomes(catalogs: PlatformCatalog[]): ArbitrageSetupOutcome[] {
  if (catalogs.length < 2) {
    throw new Error("Provide at least two platform URLs.");
  }

  const [firstCatalog, ...restCatalogs] = catalogs;
  if (!firstCatalog) {
    return [];
  }

  return firstCatalog.outcomes.flatMap((firstOutcome) => {
    const platformLabels = [firstOutcome.label];
    for (const catalog of restCatalogs) {
      const match = catalog.outcomes.find((outcome) => outcome.normalizedLabel === firstOutcome.normalizedLabel);
      if (!match) {
        return [];
      }
      platformLabels.push(match.label);
    }
    return [{ label: firstOutcome.label, platformLabels }];
  });
}

function findCatalogOutcome(catalog: PlatformCatalog, outcome: string): PlatformCatalogOutcome | undefined {
  const normalized = normalizeOutcomeLabel(outcome);
  return catalog.outcomes.find((candidate) => candidate.label === outcome || candidate.normalizedLabel === normalized);
}

function normalizeSetupInput(input: ArbitrageSetupInput): Required<ArbitrageSetupInput> {
  const urls = [...new Set(input.urls.map((url) => url.trim()).filter(Boolean))];
  if (urls.length < 2 || urls.length > 3) {
    throw new Error("Provide two or three platform URLs.");
  }
  for (const url of urls) {
    new URL(url);
  }

  const maxStakeUsd = input.maxStakeUsd ?? defaultMaxStakeUsd;
  if (!Number.isFinite(maxStakeUsd) || maxStakeUsd <= 0) {
    throw new Error("Arbitrage amount must be greater than 0.");
  }

  const minNetEdgeBps = input.minNetEdgeBps ?? defaultMinNetEdgeBps;
  if (!Number.isFinite(minNetEdgeBps) || minNetEdgeBps < 0) {
    throw new Error("Minimum after-fee edge must be 0 or greater.");
  }

  return { urls, maxStakeUsd, minNetEdgeBps };
}

function buildWatchResult(integration: Integration, watch: ArbitrageWatchSummary): ArbitrageWatchResult {
  const settings = parseArbitrageSettings(integration.settingsJson);
  const nextSettings: CrossPlatformArbitrageSettings = {
    ...settings,
    watch,
    pendingArbitrageSetup: undefined
  };
  return {
    settingsJson: JSON.stringify(nextSettings),
    message: `Watching ${watch.outcome} ${watch.side} for after-fee arbitrage across ${watch.urls.length} platforms.`,
    watch
  };
}

function normalizeWatch(value: unknown): ArbitrageWatchSummary | undefined {
  if (!isRecord(value) || !Array.isArray(value.urls)) {
    return undefined;
  }

  const side = value.side === "YES" || value.side === "NO" || value.side === "BOTH" ? value.side : "BOTH";
  const outcome = stringValue(value.outcome);
  if (!outcome) {
    return undefined;
  }

  return {
    urls: value.urls.filter((url): url is string => typeof url === "string"),
    outcome,
    side,
    maxStakeUsd: numberValue(value.maxStakeUsd) ?? defaultMaxStakeUsd,
    minNetEdgeBps: numberValue(value.minNetEdgeBps) ?? defaultMinNetEdgeBps,
    createdAt: stringValue(value.createdAt) ?? new Date(0).toISOString()
  };
}

function normalizePendingSetup(value: unknown): PendingArbitrageSetup | undefined {
  if (!isRecord(value) || !Array.isArray(value.urls) || !Array.isArray(value.outcomes)) {
    return undefined;
  }

  const outcomes = value.outcomes
    .filter(isRecord)
    .map((outcome) => ({
      label: stringValue(outcome.label) ?? "",
      platformLabels: arrayValue(outcome.platformLabels).filter((label): label is string => typeof label === "string")
    }))
    .filter((outcome) => outcome.label);
  if (outcomes.length === 0) {
    return undefined;
  }

  return {
    urls: value.urls.filter((url): url is string => typeof url === "string"),
    outcomes,
    maxStakeUsd: numberValue(value.maxStakeUsd) ?? defaultMaxStakeUsd,
    minNetEdgeBps: numberValue(value.minNetEdgeBps) ?? defaultMinNetEdgeBps,
    createdAt: stringValue(value.createdAt) ?? new Date(0).toISOString(),
    selectedOutcomeIndex: numberValue(value.selectedOutcomeIndex)
  };
}

function normalizeOrderBookLevels(value: unknown, direction: "asc" | "desc"): OrderBookLevel[] {
  const levels = arrayValue(value)
    .flatMap((level) => parseOrderBookLevel(level))
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size) && level.price >= 0 && level.price <= 1 && level.size > 0);
  levels.sort((left, right) => (direction === "asc" ? left.price - right.price : right.price - left.price));
  return levels;
}

function parseOrderBookLevel(value: unknown): OrderBookLevel[] {
  if (Array.isArray(value)) {
    const price = numberValue(value[0]);
    const size = numberValue(value[1]);
    return price !== undefined && size !== undefined ? [{ price, size }] : [];
  }
  if (isRecord(value)) {
    const price = numberValue(value.price ?? value.p);
    const size = numberValue(value.size ?? value.quantity ?? value.qty ?? value.amount);
    return price !== undefined && size !== undefined ? [{ price, size }] : [];
  }
  return [];
}

function invertYesBookToNoBook(yesBook: SideOrderBook): SideOrderBook {
  return {
    asks: yesBook.bids.map((level) => ({ price: 1 - level.price, size: level.size })).sort((left, right) => left.price - right.price),
    bids: yesBook.asks.map((level) => ({ price: 1 - level.price, size: level.size })).sort((left, right) => right.price - left.price)
  };
}

function cloneLevels(levels: OrderBookLevel[]): OrderBookLevel[] {
  return levels.map((level) => ({ ...level }));
}

function parseTokenPair(value: unknown): [string, string] | undefined {
  const tokens = typeof value === "string" ? safeJsonParse(value) : value;
  const array = arrayValue(tokens).map(stringValue).filter((token): token is string => Boolean(token));
  return array.length >= 2 && array[0] && array[1] ? [array[0], array[1]] : undefined;
}

function extractOutcomeLabel(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value)?.trim();
    if (!text) {
      continue;
    }
    return cleanOutcomeLabel(text);
  }
  return "Outcome";
}

function cleanOutcomeLabel(value: string): string {
  return value
    .replace(/\?/g, "")
    .replace(/\bIPO before 2027\b/gi, "")
    .replace(/\bbefore 2027\b/gi, "")
    .replace(/\bWill\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatOpportunityValue(opportunity: ArbitrageOpportunity, watch: ArbitrageWatchSummary): string {
  const routeLabel =
    opportunity.kind === "hedged-package"
      ? "No-inventory hedged package"
      : "Inventory/rebalance route (requires shares to sell)";
  const lines = [
    `ARB AFTER FEES: ${opportunity.outcome} ${opportunity.side}`,
    `Route: ${routeLabel}`,
    `Expected profit: ${formatUsd(opportunity.netProfitUsd)} (${formatBps(opportunity.netEdgeBps)} edge after fees)`,
    `Size: ${formatShares(opportunity.shares)}; Amount cap: ${formatUsd(watch.maxStakeUsd)}`,
    `Cost/Proceeds: ${formatUsd(opportunity.totalCostUsd)} -> ${formatUsd(opportunity.payoutUsd)}`,
    "Steps:",
    ...opportunity.actions.map(formatAction),
    `Alert threshold: ${formatBps(watch.minNetEdgeBps)} after fees`
  ];
  return lines.join("\n");
}

function formatNoOpportunityValue(watch: ArbitrageWatchSummary): string {
  return [
    `No after-fee arbitrage: ${watch.outcome} ${watch.side}`,
    `Checked ${watch.urls.length} platforms with amount cap ${formatUsd(watch.maxStakeUsd)}.`,
    `Alert threshold: ${formatBps(watch.minNetEdgeBps)} after fees.`
  ].join("\n");
}

function formatAction(action: TradeAction): string {
  const cash =
    action.verb === "BUY"
      ? `cost ${formatUsd(action.grossUsd + action.feeUsd)} incl. ${formatUsd(action.feeUsd)} fees`
      : `receive ${formatUsd(action.grossUsd - action.feeUsd)} after ${formatUsd(action.feeUsd)} fees`;
  return `${action.verb} ${formatShares(action.shares)} ${action.side} on ${formatPlatform(action.platform)} @ avg ${formatPrice(action.avgPrice)}; ${cash}`;
}

function summarizeOpportunity(opportunity: ArbitrageOpportunity): Record<string, unknown> {
  return {
    kind: opportunity.kind,
    routeKey: opportunity.routeKey,
    netProfitUsd: roundCurrency(opportunity.netProfitUsd),
    netEdgeBps: Math.round(opportunity.netEdgeBps),
    shares: roundShares(opportunity.shares)
  };
}

function formatPlatform(platform: PlatformId): string {
  if (platform === "polymarket") {
    return "Polymarket";
  }
  if (platform === "predict") {
    return "Predict";
  }
  return "Opinion";
}

function formatUsd(value: number): string {
  return `$${roundCurrency(value).toFixed(2)}`;
}

function formatBps(value: number): string {
  return `${(value / 100).toFixed(2)}%`;
}

function formatPrice(value: number): string {
  return `${(value * 100).toFixed(value < 0.01 ? 2 : 1)}c`;
}

function formatShares(value: number): string {
  return `${roundShares(value).toLocaleString("en-US", { maximumFractionDigits: 4 })} shares`;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundShares(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetchWithTimeout(url, init);
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.json();
}

function getRequiredEnv(name: string, message: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function parseLastPathSegment(url: string): string {
  const last = new URL(url).pathname.split("/").filter(Boolean).at(-1);
  if (!last) {
    throw new Error(`Could not parse market slug from ${url}`);
  }
  return last;
}

function firstObject(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    return value.find(isRecord);
  }
  if (isRecord(value)) {
    return value;
  }
  return undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
