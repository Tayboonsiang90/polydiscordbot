import { keccak_256 } from "@noble/hashes/sha3";
import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlugCandidates } from "../marketEnd.js";
import { parseSettingsJson } from "../settingsJson.js";
import { defaultPolygonRpcUrls } from "./polymarketClarifications.js";
import { polymarketUmaCtfAdapterAddresses } from "./polymarketDisputes.js";
import type {
  AdapterValue,
  EventMonitorPost,
  EventMonitorResult,
  Integration,
  ResolvableWatchlistAction,
  ResolvableWatchlistEntry,
  ResolvableWatchlistUpdateResult,
  WebsiteAdapter
} from "./types.js";

const gammaEventsUrl = "https://gamma-api.polymarket.com/events";
const gammaMarketsUrl = "https://gamma-api.polymarket.com/markets";
const adapterDocsUrl = "https://polymarket-uma-ctf-adapter.mintlify.app/integration/resolving-markets";
export const conditionalTokensAddress = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
const readySelector = functionSelector("ready(bytes32)");
const payoutDenominatorSelector = functionSelector("payoutDenominator(bytes32)");
const rpcTimeoutMs = 5_000;

type JsonRpcResponse<T> = {
  result?: T;
  error?: { code: number; message: string };
};

type PolygonRpcResult<T> = {
  result: T;
  rpcUrl: string;
};

export type PolymarketResolvableSettings = {
  eventSeenPostIds?: string[];
  watches?: ResolvableWatchlistEntry[];
  rpcUrl?: string;
  lastCheckCompletedAt?: string;
  lastOnChainCallCount?: number;
  lastReadyCount?: number;
  lastErrorCount?: number;
};

type GammaMarket = {
  question?: string;
  title?: string;
  slug?: string;
  market_slug?: string;
  conditionId?: string;
  condition_id?: string;
  questionID?: string;
  questionId?: string;
  question_id?: string;
};

type GammaEvent = {
  title?: string;
  slug?: string;
  markets?: GammaMarket[];
};

type ReadyCheckResult = {
  status: "pending" | "ready" | "resolved";
  adapterAddress?: string;
  rpcUrl?: string;
  checkedCallCount: number;
  payoutDenominator?: string;
};

export const polymarketResolvableAdapter: WebsiteAdapter = {
  id: "polymarket-resolvable",
  commandName: "resolvable",
  displayName: "Polymarket Resolvable Watch",
  sourceUrl: adapterDocsUrl,
  defaultChannelName: "resolvable",
  alertRoleName: "Resolvable Alerts",
  alertRoleEmoji: "\u2705",
  getPollIntervalMinutes(): number {
    return 1;
  },
  getPollIntervalReason(integration: Integration): string {
    const watchCount = getPolymarketResolvableWatchesFromSettingsJson(integration.settingsJson).length;
    return watchCount
      ? `Checking ${watchCount} configured market(s) with Conditional Tokens payoutDenominator(conditionId) and UMA adapter ready(questionID)`
      : "Idle: no resolvable markets configured, so no Polygon RPC calls";
  },
  getErrorNoticeWindowMinutes(): number {
    return 60;
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    if (!integration) {
      throw new Error("Polymarket resolvable watch requires an integration record");
    }

    const result = await fetchPolymarketResolvableUpdates(integration);
    const watchCount = getPolymarketResolvableWatchesFromSettingsJson(result.settingsJson ?? integration.settingsJson).length;
    const readyCount = result.posts.length;
    const value = readyCount
      ? `${readyCount} market(s) ready or already resolved`
      : `${watchCount} market(s) still watched for ready/resolved status`;
    return { value, rawValue: value, unit: "UMA adapter readiness", observedAt: result.observedAt };
  },
  async fetchEventUpdates(integration: Integration): Promise<EventMonitorResult> {
    return fetchPolymarketResolvableUpdates(integration);
  },
  async updateResolvableWatchlist(
    integration: Integration,
    action: ResolvableWatchlistAction,
    marketQuery?: string
  ): Promise<ResolvableWatchlistUpdateResult> {
    return updatePolymarketResolvableWatchlist(integration, action, marketQuery);
  }
};

export function getPolymarketResolvableWatchesFromSettingsJson(settingsJson: string | null | undefined): ResolvableWatchlistEntry[] {
  const settings = parsePolymarketResolvableSettings(settingsJson);
  return settings.watches ?? [];
}

export function parsePolymarketResolvableSettings(settingsJson: string | null | undefined): PolymarketResolvableSettings {
  const parsed = parseSettingsJson(settingsJson);
  const watches = Array.isArray(parsed.watches)
    ? parsed.watches.map(normalizeWatchEntry).filter((watch): watch is ResolvableWatchlistEntry => Boolean(watch))
    : [];

  return {
    ...parsed,
    watches,
    eventSeenPostIds: Array.isArray(parsed.eventSeenPostIds)
      ? parsed.eventSeenPostIds.filter((value): value is string => typeof value === "string" && value.length > 0)
      : undefined,
    rpcUrl: typeof parsed.rpcUrl === "string" && parsed.rpcUrl.trim() ? parsed.rpcUrl.trim() : undefined,
    lastCheckCompletedAt: typeof parsed.lastCheckCompletedAt === "string" ? parsed.lastCheckCompletedAt : undefined,
    lastOnChainCallCount: typeof parsed.lastOnChainCallCount === "number" ? parsed.lastOnChainCallCount : undefined,
    lastReadyCount: typeof parsed.lastReadyCount === "number" ? parsed.lastReadyCount : undefined,
    lastErrorCount: typeof parsed.lastErrorCount === "number" ? parsed.lastErrorCount : undefined
  };
}

export async function updatePolymarketResolvableWatchlist(
  integration: Integration,
  action: ResolvableWatchlistAction,
  marketQuery?: string,
  now = new Date()
): Promise<ResolvableWatchlistUpdateResult> {
  const settings = parsePolymarketResolvableSettings(integration.settingsJson);
  const watches = settings.watches ?? [];

  if (action === "list") {
    return buildWatchlistUpdateResult(settings, action, false, `${watches.length} market(s) configured.`, undefined, watches);
  }

  if (action === "clear") {
    return buildWatchlistUpdateResult(
      settings,
      action,
      watches.length > 0,
      watches.length ? `Removed ${watches.length} market(s) from the watchlist.` : "Watchlist is already empty.",
      undefined,
      []
    );
  }

  const query = marketQuery?.trim();
  if (!query) {
    throw new Error("Add/remove needs a Polymarket URL or question ID.");
  }

  if (action === "remove") {
    const matched = watches.filter((watch) => matchesWatchQuery(watch, query));
    const remaining = watches.filter((watch) => !matchesWatchQuery(watch, query));
    return buildWatchlistUpdateResult(
      settings,
      action,
      matched.length > 0,
      matched.length ? `Removed ${matched.length} matching market(s).` : "No matching market was configured.",
      matched,
      remaining
    );
  }

  const added = await resolvePolymarketUrlToResolvableWatches(query, now);
  const existingIds = new Set(watches.map((watch) => normalizeHex(watch.questionId)));
  const newWatches = added.filter((watch) => !existingIds.has(normalizeHex(watch.questionId)));
  const merged = [...watches, ...newWatches];
  const duplicateCount = added.length - newWatches.length;
  const duplicateNote = duplicateCount ? ` ${duplicateCount} duplicate market(s) were already configured.` : "";

  return buildWatchlistUpdateResult(
    settings,
    action,
    newWatches.length > 0,
    newWatches.length
      ? `Added ${newWatches.length} market(s) to the resolvable watchlist.${duplicateNote}`
      : `No new markets added.${duplicateNote}`,
    newWatches,
    merged
  );
}

export async function fetchPolymarketResolvableUpdates(
  integration: Integration,
  now = new Date()
): Promise<EventMonitorResult> {
  const settings = parsePolymarketResolvableSettings(integration.settingsJson);
  const watches = settings.watches ?? [];

  if (watches.length === 0) {
    return {
      posts: [],
      strikeTerms: [],
      settingsJson: JSON.stringify({
        ...settings,
        watches: [],
        lastCheckCompletedAt: now.toISOString(),
        lastOnChainCallCount: 0,
        lastReadyCount: 0,
        lastErrorCount: 0
      }),
      checkTitle: "Resolvable watch check",
      checkFields: [
        { name: "Watched markets", value: "0", inline: true },
        { name: "Polygon RPC calls", value: "0", inline: true },
        { name: "Status", value: "Idle. Add a market with `/resolvable watchlist action:add market:<polymarket-url>`.", inline: false }
      ],
      observedAt: now
    };
  }

  const rpcUrls = getPolymarketResolvableRpcUrls(settings);
  const posts: EventMonitorPost[] = [];
  const remainingWatches: ResolvableWatchlistEntry[] = [];
  let onChainCallCount = 0;
  let errorCount = 0;
  let activeRpcUrl = rpcUrls[0];

  for (const watch of watches) {
    try {
      const check = await checkResolvableStatus(watch, rpcUrls, activeRpcUrl);
      onChainCallCount += check.checkedCallCount;
      activeRpcUrl = check.rpcUrl ?? activeRpcUrl;

      if (check.status === "ready" || check.status === "resolved") {
        posts.push(normalizePolymarketResolvablePost(watch, check, now));
      } else {
        remainingWatches.push({
          ...watch,
          lastCheckedAt: now.toISOString(),
          lastStatus: "pending",
          lastError: undefined
        });
      }
    } catch (error) {
      errorCount += 1;
      remainingWatches.push({
        ...watch,
        lastCheckedAt: now.toISOString(),
        lastStatus: "error",
        lastError: formatError(error)
      });
    }
  }

  return {
    posts,
    strikeTerms: [],
    settingsJson: JSON.stringify({
      ...settings,
      watches: remainingWatches,
      lastCheckCompletedAt: now.toISOString(),
      lastOnChainCallCount: onChainCallCount,
      lastReadyCount: posts.length,
      lastErrorCount: errorCount
    }),
    checkTitle: "Resolvable watch check",
    checkFields: [
      { name: "Watched before check", value: String(watches.length), inline: true },
      { name: "Ready/resolved now", value: String(posts.length), inline: true },
      { name: "Still watching", value: String(remainingWatches.length), inline: true },
      { name: "Check errors", value: String(errorCount), inline: true },
      { name: "Polygon RPC calls", value: String(onChainCallCount), inline: true },
      { name: "Data source", value: `${activeRpcUrl} via eth_call fallback`, inline: false }
    ],
    observedAt: now
  };
}

export async function resolvePolymarketUrlToResolvableWatches(
  polymarketUrl: string,
  now = new Date()
): Promise<ResolvableWatchlistEntry[]> {
  const normalizedUrl = normalizePolymarketUrl(polymarketUrl);
  if (!normalizedUrl) {
    throw new Error("Please provide a valid Polymarket URL.");
  }

  const markets = await fetchGammaMarketsForPolymarketUrl(normalizedUrl);
  const watches = markets
    .map((market) => normalizeGammaMarketToWatch(market, normalizedUrl, now))
    .filter((watch): watch is ResolvableWatchlistEntry => Boolean(watch));

  if (watches.length === 0) {
    throw new Error("Polymarket Gamma did not return a questionID for that URL.");
  }

  return dedupeWatches(watches);
}

function normalizePolymarketResolvablePost(
  watch: ResolvableWatchlistEntry,
  check: ReadyCheckResult,
  now: Date
): EventMonitorPost {
  const adapterAddress = check.adapterAddress ?? polymarketUmaCtfAdapterAddresses[0];
  const adapterUrl = `https://polygonscan.com/address/${adapterAddress}#readContract`;
  const isResolved = check.status === "resolved";
  const sourceUrl = isResolved ? `https://polygonscan.com/address/${conditionalTokensAddress}#readContract` : adapterUrl;

  return {
    id: `resolvable:${normalizeHex(watch.questionId)}`,
    type: "Polymarket resolvable",
    alertTitle: isResolved ? "Polymarket market already resolved" : "Polymarket market ready to resolve",
    sourceLabel: isResolved ? "Conditional Tokens" : "UMA adapter",
    buttonLabel: isResolved ? "Open CTF" : "Open adapter",
    mentionAlertRole: true,
    textFieldName: "Signal",
    text: isResolved
      ? "Conditional Tokens payoutDenominator(conditionId) is greater than zero."
      : "UMA CTF Adapter ready(questionID) returned true.",
    qualifyingText: `${watch.question}\n${isResolved ? "payoutDenominator(conditionId) > 0" : "ready(questionID) == true"}`,
    postedAt: now,
    url: sourceUrl,
    polymarketUrl: watch.url,
    prioritySummary: {
      question: watch.question,
      questionUrl: watch.url,
      conditionId: watch.conditionId
    },
    hideDefaultEventFields: true,
    hideLinksField: true,
    hideTextField: true,
    fields: [
      { name: "Status", value: isResolved ? "**RESOLVED ON CTF**" : "**READY TO RESOLVE**", inline: false },
      {
        name: "On-chain check",
        value: isResolved ? "`payoutDenominator(conditionId) > 0`" : "`ready(questionID) == true`",
        inline: false
      },
      { name: "Watched since", value: watch.addedAt, inline: true }
    ],
    hiddenFields: [
      { name: "Question ID", value: watch.questionId, inline: false },
      ...(watch.conditionId ? [{ name: "Condition ID", value: watch.conditionId, inline: false }] : []),
      ...(check.payoutDenominator ? [{ name: "Payout denominator", value: check.payoutDenominator, inline: true }] : []),
      { name: "Ready adapter", value: check.adapterAddress ?? "not ready; CTF settlement detected", inline: false },
      { name: "Conditional Tokens", value: conditionalTokensAddress, inline: false },
      { name: "RPC endpoint", value: check.rpcUrl ?? "not recorded", inline: false }
    ],
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

async function checkResolvableStatus(
  watch: ResolvableWatchlistEntry,
  rpcUrls: string[],
  preferredRpcUrl?: string
): Promise<ReadyCheckResult> {
  let checkedCallCount = 0;
  let lastRpcUrl = preferredRpcUrl;
  const errors: string[] = [];

  if (watch.conditionId) {
    try {
      checkedCallCount += 1;
      const denominator = await callPayoutDenominator(watch.conditionId, rpcUrls, lastRpcUrl);
      lastRpcUrl = denominator.rpcUrl;
      if (denominator.result > 0n) {
        return {
          status: "resolved",
          rpcUrl: denominator.rpcUrl,
          checkedCallCount,
          payoutDenominator: denominator.result.toString()
        };
      }
    } catch (error) {
      errors.push(`${conditionalTokensAddress}: ${formatError(error)}`);
    }
  }

  for (const adapterAddress of polymarketUmaCtfAdapterAddresses) {
    checkedCallCount += 1;
    try {
      const call = await callReady(adapterAddress, watch.questionId, rpcUrls, lastRpcUrl);
      lastRpcUrl = call.rpcUrl;
      if (call.result) {
        return { status: "ready", adapterAddress, rpcUrl: call.rpcUrl, checkedCallCount };
      }
    } catch (error) {
      errors.push(`${adapterAddress}: ${formatError(error)}`);
    }
  }

  const expectedCallCount = polymarketUmaCtfAdapterAddresses.length + (watch.conditionId ? 1 : 0);
  if (errors.length === expectedCallCount) {
    throw new Error(`resolvable checks failed on all contracts: ${errors.join("; ")}`);
  }

  return { status: "pending", rpcUrl: lastRpcUrl, checkedCallCount };
}

async function callPayoutDenominator(
  conditionId: string,
  rpcUrls: string[],
  preferredRpcUrl?: string
): Promise<PolygonRpcResult<bigint>> {
  const data = `${payoutDenominatorSelector}${stripHexPrefix(conditionId)}`;
  const response = await polygonRpc<string>(
    rpcUrls,
    "eth_call",
    [
      {
        to: conditionalTokensAddress,
        data
      },
      "latest"
    ],
    preferredRpcUrl
  );

  return {
    result: parseAbiUint(response.result),
    rpcUrl: response.rpcUrl
  };
}

async function callReady(
  adapterAddress: string,
  questionId: string,
  rpcUrls: string[],
  preferredRpcUrl?: string
): Promise<PolygonRpcResult<boolean>> {
  const data = `${readySelector}${stripHexPrefix(questionId)}`;
  const response = await polygonRpc<string>(
    rpcUrls,
    "eth_call",
    [
      {
        to: adapterAddress,
        data
      },
      "latest"
    ],
    preferredRpcUrl
  );

  return {
    result: parseAbiBool(response.result),
    rpcUrl: response.rpcUrl
  };
}

async function fetchGammaMarketsForPolymarketUrl(polymarketUrl: string): Promise<GammaMarket[]> {
  const slugCandidates = getPolymarketSlugCandidates(polymarketUrl).filter((slug) => slug !== "market" && slug !== "event");
  const preferEvents = new URL(polymarketUrl).pathname.split("/").filter(Boolean)[0] === "event";
  const fetchers = preferEvents
    ? [fetchGammaEventMarketsBySlug, fetchGammaMarketsBySlug]
    : [fetchGammaMarketsBySlug, fetchGammaEventMarketsBySlug];

  for (const slug of slugCandidates) {
    for (const fetcher of fetchers) {
      const markets = await fetcher(slug);
      if (markets.length) {
        return markets;
      }
    }
  }

  return [];
}

async function fetchGammaMarketsBySlug(slug: string): Promise<GammaMarket[]> {
  const urls = [
    `${gammaMarketsUrl}?slug=${encodeURIComponent(slug)}`,
    `${gammaMarketsUrl}?slug=${encodeURIComponent(slug)}&closed=true`,
    `${gammaMarketsUrl}?slug=${encodeURIComponent(slug)}&archived=true`
  ];

  for (const url of urls) {
    const payload = await fetchGammaJson(url);
    const markets = parseGammaMarkets(payload);
    if (markets.length) {
      return markets;
    }
  }

  return [];
}

async function fetchGammaEventMarketsBySlug(slug: string): Promise<GammaMarket[]> {
  const urls = [
    `${gammaEventsUrl}?slug=${encodeURIComponent(slug)}`,
    `${gammaEventsUrl}?slug=${encodeURIComponent(slug)}&closed=true`,
    `${gammaEventsUrl}?slug=${encodeURIComponent(slug)}&archived=true`
  ];

  for (const url of urls) {
    const payload = await fetchGammaJson(url);
    const markets = parseGammaMarkets(payload);
    if (markets.length) {
      return markets;
    }
  }

  return [];
}

async function fetchGammaJson(url: string): Promise<unknown> {
  const response = await fetchWithTimeout(url, {
    headers: {
      "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  return response.json() as Promise<unknown>;
}

function parseGammaMarkets(payload: unknown): GammaMarket[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const markets: GammaMarket[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const event = entry as GammaEvent;
    if (Array.isArray(event.markets)) {
      markets.push(...event.markets);
      continue;
    }
    markets.push(entry as GammaMarket);
  }

  return markets;
}

function normalizeGammaMarketToWatch(
  market: GammaMarket,
  sourceUrl: string,
  now: Date
): ResolvableWatchlistEntry | null {
  const questionId = normalizeBytes32(market.questionID ?? market.questionId ?? market.question_id);
  if (!questionId) {
    return null;
  }

  const slug = firstNonEmptyString(market.slug, market.market_slug);
  const question = firstNonEmptyString(market.question, market.title, slug) ?? "Polymarket market";
  const conditionId = normalizeBytes32(market.conditionId ?? market.condition_id);
  const url = slug ? `https://polymarket.com/market/${slug}` : sourceUrl;

  return {
    question,
    url,
    ...(slug ? { slug } : {}),
    questionId,
    ...(conditionId ? { conditionId } : {}),
    addedAt: now.toISOString(),
    lastStatus: "pending"
  };
}

function buildWatchlistUpdateResult(
  settings: PolymarketResolvableSettings,
  action: ResolvableWatchlistAction,
  changed: boolean,
  message: string,
  matchedWatches: ResolvableWatchlistEntry[] | undefined,
  watches: ResolvableWatchlistEntry[]
): ResolvableWatchlistUpdateResult {
  return {
    action,
    changed,
    message,
    ...(matchedWatches ? { matchedWatches } : {}),
    watches,
    settingsJson: JSON.stringify({
      ...settings,
      watches
    })
  };
}

function normalizeWatchEntry(value: unknown): ResolvableWatchlistEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Partial<ResolvableWatchlistEntry>;
  const questionId = normalizeBytes32(entry.questionId);
  if (!questionId) {
    return null;
  }
  const slug = firstNonEmptyString(entry.slug);
  const conditionId = normalizeBytes32(entry.conditionId);

  return {
    question: firstNonEmptyString(entry.question) ?? "Polymarket market",
    url: firstNonEmptyString(entry.url) ?? "https://polymarket.com",
    ...(slug ? { slug } : {}),
    questionId,
    ...(conditionId ? { conditionId } : {}),
    addedAt: parseIsoOrNow(entry.addedAt),
    ...(typeof entry.lastCheckedAt === "string" ? { lastCheckedAt: entry.lastCheckedAt } : {}),
    ...(entry.lastStatus === "ready" || entry.lastStatus === "resolved" || entry.lastStatus === "error" || entry.lastStatus === "pending"
      ? { lastStatus: entry.lastStatus }
      : {}),
    ...(typeof entry.lastError === "string" && entry.lastError ? { lastError: entry.lastError } : {})
  };
}

function matchesWatchQuery(watch: ResolvableWatchlistEntry, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedUrl = normalizePolymarketUrl(query)?.toLowerCase();
  const questionId = normalizeBytes32(query);
  return (
    (normalizedUrl && watch.url.toLowerCase() === normalizedUrl) ||
    (questionId && normalizeHex(watch.questionId) === questionId) ||
    watch.slug?.toLowerCase() === normalizedQuery ||
    watch.question.toLowerCase().includes(normalizedQuery)
  );
}

function dedupeWatches(watches: ResolvableWatchlistEntry[]): ResolvableWatchlistEntry[] {
  const seen = new Set<string>();
  return watches.filter((watch) => {
    const key = normalizeHex(watch.questionId);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function getPolymarketResolvableRpcUrls(settings: PolymarketResolvableSettings): string[] {
  const configured = [
    settings.rpcUrl,
    process.env.POLYGON_RPC_URL,
    ...(process.env.POLYGON_RPC_URLS ?? "").split(",")
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  return [...new Set([...configured.map((value) => value.trim()), ...defaultPolygonRpcUrls])];
}

async function polygonRpc<T>(
  rpcUrls: string[],
  method: string,
  params: unknown[],
  preferredRpcUrl?: string
): Promise<PolygonRpcResult<T>> {
  const errors: string[] = [];
  for (const rpcUrl of orderRpcUrls(rpcUrls, preferredRpcUrl)) {
    try {
      const result = await polygonRpcOne<T>(rpcUrl, method, params);
      return { result, rpcUrl };
    } catch (error) {
      errors.push(`${rpcUrl}: ${formatError(error)}`);
    }
  }

  throw new Error(`Polygon RPC ${method} failed on all endpoints: ${errors.join("; ")}`);
}

async function polygonRpcOne<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "PolymarketResolutionMonitorBot/0.1"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(rpcTimeoutMs)
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = (await response.json()) as JsonRpcResponse<T>;
  if (payload.error) {
    throw new Error(payload.error.message);
  }
  if (payload.result === undefined) {
    throw new Error("returned no result");
  }

  return payload.result;
}

function parseAbiBool(value: string): boolean {
  return parseAbiUint(value) !== 0n;
}

function parseAbiUint(value: string): bigint {
  const normalized = stripHexPrefix(value);
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`Invalid ABI uint result: ${value}`);
  }

  return BigInt(`0x${normalized}`);
}

function functionSelector(signature: string): string {
  return `0x${Buffer.from(keccak_256(Buffer.from(signature))).toString("hex").slice(0, 8)}`;
}

function normalizePolymarketUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (!["polymarket.com", "www.polymarket.com"].includes(parsed.hostname.toLowerCase())) {
      return null;
    }

    parsed.protocol = "https:";
    parsed.hostname = "polymarket.com";
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function normalizeBytes32(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function normalizeHex(value: string): string {
  return value.toLowerCase();
}

function stripHexPrefix(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function parseIsoOrNow(value: unknown): string {
  if (typeof value === "string" && !Number.isNaN(new Date(value).getTime())) {
    return value;
  }

  return new Date().toISOString();
}

function orderRpcUrls(rpcUrls: string[], preferredRpcUrl?: string): string[] {
  if (!preferredRpcUrl || !rpcUrls.includes(preferredRpcUrl)) {
    return rpcUrls;
  }

  return [preferredRpcUrl, ...rpcUrls.filter((rpcUrl) => rpcUrl !== preferredRpcUrl)];
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
