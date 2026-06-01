import { keccak_256 } from "@noble/hashes/sha3";
import { fetchWithTimeout } from "../http.js";
import { enrichEventPostAddressProfiles, updateAddressLabelsInSettingsJson } from "../addressLabels.js";
import {
  defaultPolygonRpcUrl,
  defaultPolygonRpcUrls,
  defaultPolygonWsUrl,
  parseHexQuantity,
  type PolygonLog
} from "./polymarketClarifications.js";
import {
  optimisticOracleAddresses,
  optimisticOracleSourceUrl,
  polymarketUmaCtfAdapterAddresses,
  polymarketUmaCtfAdapterAddressTopics
} from "./polymarketDisputes.js";
import type {
  AdapterValue,
  AddressLabelAction,
  AddressLabelUpdateOptions,
  AddressLabelUpdateResult,
  EventMonitorPost,
  EventMonitorResult,
  Integration,
  TagFilterAction,
  TagFilterEntry,
  TagBlocklistUpdateResult,
  TagFilterUpdateResult,
  TagSearchResult,
  WebsiteAdapter
} from "./types.js";

export const proposePriceEventSignature = "ProposePrice(address,address,bytes32,uint256,bytes,int256,uint256,address)";
export const proposePriceTopic = keccakTopic(proposePriceEventSignature);

const clobMarketByQuestionIdUrl = "https://clob.polymarket.com/markets-by-question-id";
const clobOrderBookUrl = "https://clob.polymarket.com/book";
const gammaTagsUrl = "https://gamma-api.polymarket.com/tags";
const defaultConfirmations = 0;
const defaultInitialLookbackBlocks = 250;
const defaultMaxScanBlocksPerRun = 250;
const rpcLogChunkBlocks = 100;
const rpcTimeoutMs = 5_000;
const maxAdapterAddressesField = 3;
const maxTagSearchResults = 20;
const maxGammaTagPages = 120;
const gammaTagPageSize = 100;
const gammaTagCacheMs = 10 * 60_000;
const clobOrderBookTimeoutMs = 2_500;
const proposalTagChannelPrefix = "uma-proposals-";
const matchedTagsFieldName = "Matched tags";
const umaOnePrice = 10n ** 18n;
const umaHalfPrice = umaOnePrice / 2n;
const umaIgnorePrice = -(1n << 255n);

type JsonRpcResponse<T> = {
  result?: T;
  error?: { code: number; message: string };
};

type PolygonRpcResult<T> = {
  result: T;
  rpcUrl: string;
};

type ClobMarket = {
  question?: string;
  market_slug?: string;
  condition_id?: string;
  tags?: string[];
  tokens?: ClobMarketToken[];
};

type ClobMarketToken = {
  tokenId: string;
  outcome: string;
};

type ClobOrderBook = {
  asks: ClobOrderLevel[];
};

type ClobOrderLevel = {
  price: number;
  size: number;
};

type ProposedSideLiquidity = {
  outcome: string;
  tokenId: string;
  bestAsk: number;
  bestAskSize: number;
  totalAskSize: number;
  askCount: number;
};

type GammaTag = {
  id?: string | number;
  label?: string;
  slug?: string;
};

type TagCache = {
  fetchedAtMs: number;
  tags: TagFilterEntry[];
};

type ProposalTagMatch = {
  matchedMarketTags: string[];
  matchedFilters: ProposalTagFilterEntry[];
};

export type ProposalTagFilterEntry = TagFilterEntry & {
  channelId?: string;
  channelName?: string;
  excludedTags?: TagFilterEntry[];
};

export type PolymarketProposalSettings = {
  eventSeenPostIds?: string[];
  lastScannedBlock?: number;
  lastScanStartedBlock?: number;
  lastScanCompletedAt?: string;
  rpcUrl?: string;
  wsUrl?: string;
  confirmations?: number;
  initialLookbackBlocks?: number;
  maxScanBlocksPerRun?: number;
  tagFilters?: ProposalTagFilterEntry[];
};

export type PolymarketProposalEvent = {
  id: string;
  requester: string;
  proposer: string;
  oracleAddress: string;
  identifier: string;
  requestTimestamp: number;
  ancillaryData: string;
  questionId: string;
  proposedPrice: bigint;
  proposedOutcome: string;
  expirationTimestamp: number;
  currency: string;
  blockNumber: number;
  logIndex: number;
  transactionHash: string;
  blockTimestamp?: number;
};

let tagCache: TagCache | null = null;

export const polymarketProposalsAdapter: WebsiteAdapter = {
  id: "polymarket-proposals",
  commandName: "umaproposals",
  displayName: "UMA Proposal Alerts",
  sourceUrl: optimisticOracleSourceUrl,
  defaultChannelName: "uma-proposals",
  alertRoleName: "UMA Proposal Alerts",
  alertRoleEmoji: "\uD83D\uDCE8",
  alertRoleChannelName: "uma-alert-roles",
  alertRoleGroupTitle: "UMA Alert Roles",
  getPollIntervalMinutes(): number {
    return 1;
  },
  getPollIntervalReason(): string {
    return "WebSocket primary; 1-minute HTTP backfill; tag-filtered";
  },
  getErrorNoticeWindowMinutes(): number {
    return 60;
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    if (!integration) {
      throw new Error("Polymarket proposals requires an integration record");
    }

    const result = await fetchPolymarketProposalUpdates(integration);
    const latest = result.posts[0];
    const value = latest ? `${latest.id}\n${latest.text}` : "no recent matching Polymarket UMA proposals";
    return { value, rawValue: value, unit: "latest tag-filtered proposal", observedAt: result.observedAt };
  },
  async fetchEventUpdates(integration: Integration): Promise<EventMonitorResult> {
    return fetchPolymarketProposalUpdates(integration);
  },
  async searchTags(query: string): Promise<TagSearchResult> {
    return searchPolymarketProposalTags(query);
  },
  async updateTagFilters(
    integration: Integration,
    action: TagFilterAction,
    tagQuery?: string
  ): Promise<TagFilterUpdateResult> {
    return updatePolymarketProposalTagFilters(integration, action, tagQuery);
  },
  async updateTagBlocklist(
    integration: Integration,
    subscriptionTagQuery: string | undefined,
    action: TagFilterAction,
    blockedTagQuery?: string
  ): Promise<TagBlocklistUpdateResult> {
    return updatePolymarketProposalTagBlocklist(integration, subscriptionTagQuery, action, blockedTagQuery);
  },
  async updateAddressLabels(
    integration: Integration,
    action: AddressLabelAction,
    addressQuery?: string,
    labelQuery?: string,
    options?: AddressLabelUpdateOptions
  ): Promise<AddressLabelUpdateResult> {
    return updateAddressLabelsInSettingsJson(integration.settingsJson, action, addressQuery, labelQuery, options);
  },
  getTagFilters(integration: Integration): TagFilterEntry[] {
    return getPolymarketProposalTagFilters(integration);
  },
  resolveEventPostChannelIds(integration: Integration, post: EventMonitorPost): string[] {
    return resolvePolymarketProposalChannelIds(integration, post);
  }
};

export async function fetchPolymarketProposalUpdates(
  integration: Integration,
  now = new Date()
): Promise<EventMonitorResult> {
  const settings = parsePolymarketProposalSettings(integration.settingsJson);
  const tagFilters = getTagFiltersFromSettings(settings);
  const rpcUrls = getPolymarketProposalRpcUrls(settings);
  const latestBlockResult = await fetchLatestBlockNumber(rpcUrls);
  const latestBlock = latestBlockResult.result;
  let activeRpcUrl = latestBlockResult.rpcUrl;
  const confirmations = getIntegerSetting(settings.confirmations, defaultConfirmations, 0, 1_000);
  const confirmedLatestBlock = Math.max(0, latestBlock - confirmations);
  const fromBlock = getNextFromBlock(settings, confirmedLatestBlock);
  const toBlock = fromBlock <= confirmedLatestBlock
    ? Math.min(confirmedLatestBlock, fromBlock + getMaxScanBlocksPerRun(settings) - 1)
    : confirmedLatestBlock;

  const logsResult = fromBlock <= toBlock
    ? await fetchProposalLogs(rpcUrls, fromBlock, toBlock, activeRpcUrl)
    : { result: [], rpcUrl: activeRpcUrl };
  const logs = logsResult.result;
  activeRpcUrl = logsResult.rpcUrl;
  const marketByQuestionId = new Map<string, ClobMarket | null>();
  const liquidityByTokenId = new Map<string, ProposedSideLiquidity | null>();
  const posts: EventMonitorPost[] = [];
  let decodedProposalCount = 0;
  let matchedProposalCount = 0;

  for (const log of logs) {
    const proposal = decodeProposePriceLog(log);
    if (!proposal) {
      continue;
    }

    decodedProposalCount += 1;
    if (!tagFilters.length) {
      continue;
    }

    let market = marketByQuestionId.get(proposal.questionId);
    if (market === undefined) {
      market = await fetchClobMarketByQuestionId(proposal.questionId).catch(() => null);
      marketByQuestionId.set(proposal.questionId, market);
    }

    const tagMatch = findProposalTagMatch(market?.tags ?? [], tagFilters);
    if (!tagMatch) {
      continue;
    }

    matchedProposalCount += 1;
    const liquidity = await fetchProposedSideLiquidity(proposal, market, liquidityByTokenId).catch(() => null);
    posts.push(await enrichEventPostAddressProfiles(normalizePolymarketProposalEvent(proposal, market, tagMatch, liquidity)));
  }

  posts.sort(compareProposalPostsDescending);

  return {
    posts,
    strikeTerms: [],
    settingsJson: JSON.stringify({
      ...settings,
      tagFilters,
      lastScannedBlock: toBlock,
      lastScanStartedBlock: fromBlock <= toBlock ? fromBlock : undefined,
      lastScanCompletedAt: now.toISOString()
    }),
    checkTitle: "UMA proposal check",
    checkFields: [
      { name: "Matching proposals", value: String(matchedProposalCount), inline: true },
      { name: "Proposals in scanned range", value: String(decodedProposalCount), inline: true },
      { name: "Configured proposal tags", value: formatConfiguredTagFilters(tagFilters), inline: false },
      { name: "Scanned blocks", value: fromBlock <= toBlock ? `${fromBlock} to ${toBlock}` : "already at latest block", inline: false },
      { name: "Confirmed head", value: String(confirmedLatestBlock), inline: true },
      { name: "Data source", value: `${activeRpcUrl} via eth_getLogs fallback`, inline: false },
      { name: "Watched oracle contracts", value: String(optimisticOracleAddresses.length), inline: true },
      { name: "Polymarket adapter filter", value: formatWatchedAdapterAddresses(), inline: false },
      ...(rpcUrls.length > 1 ? [{ name: "RPC fallback pool", value: `${rpcUrls.length} endpoints configured`, inline: true }] : [])
    ],
    observedAt: now
  };
}

export async function buildPolymarketProposalPostFromLog(
  log: PolygonLog,
  integration: Integration
): Promise<EventMonitorPost | null> {
  const proposal = decodeProposePriceLog(log);
  if (!proposal) {
    return null;
  }

  const tagFilters = getPolymarketProposalTagFilters(integration);
  if (!tagFilters.length) {
    return null;
  }

  const market = await fetchClobMarketByQuestionId(proposal.questionId).catch(() => null);
  const tagMatch = findProposalTagMatch(market?.tags ?? [], tagFilters);
  if (!tagMatch) {
    return null;
  }

  const liquidity = await fetchProposedSideLiquidity(proposal, market).catch(() => null);
  return enrichEventPostAddressProfiles(normalizePolymarketProposalEvent(proposal, market, tagMatch, liquidity));
}

export function decodeProposePriceLog(log: PolygonLog): PolymarketProposalEvent | null {
  if ((getTopic(log, 0) ?? "").toLowerCase() !== proposePriceTopic.toLowerCase()) {
    return null;
  }

  const requester = parseAddressTopic(getTopic(log, 1) ?? "");
  if (!isPolymarketUmaCtfAdapter(requester)) {
    return null;
  }

  const hex = stripHexPrefix(log.data);
  const identifier = `0x${readWord(hex, 0)}`;
  const requestTimestamp = wordToSafeNumber(readWord(hex, 1), "request timestamp");
  const ancillaryDataOffset = wordToSafeNumber(readWord(hex, 2), "ancillary data offset");
  const proposedPrice = wordToSignedBigInt(readWord(hex, 3));
  const expirationTimestamp = wordToSafeNumber(readWord(hex, 4), "expiration timestamp");
  const currency = parseAddressTopic(readWord(hex, 5));
  const ancillaryDataBytes = decodeAbiBytesAt(hex, ancillaryDataOffset * 2);
  const blockTimestamp = log.blockTimestamp ? parseHexQuantity(log.blockTimestamp) : undefined;

  return {
    id: `${log.transactionHash}:${log.logIndex}`,
    requester,
    proposer: parseAddressTopic(getTopic(log, 2) ?? ""),
    oracleAddress: "address" in log && typeof log.address === "string" ? log.address : "",
    identifier,
    requestTimestamp,
    ancillaryData: Buffer.from(ancillaryDataBytes).toString("utf8").trim(),
    questionId: `0x${Buffer.from(keccak_256(ancillaryDataBytes)).toString("hex")}`,
    proposedPrice,
    proposedOutcome: formatProposedOutcome(proposedPrice),
    expirationTimestamp,
    currency,
    blockNumber: parseHexQuantity(log.blockNumber),
    logIndex: parseHexQuantity(log.logIndex),
    transactionHash: log.transactionHash,
    ...(blockTimestamp === undefined ? {} : { blockTimestamp })
  };
}

export function normalizePolymarketProposalEvent(
  proposal: PolymarketProposalEvent,
  market: ClobMarket | null,
  tagMatch: ProposalTagMatch,
  liquidity: ProposedSideLiquidity | null = null
): EventMonitorPost {
  const transactionUrl = `https://polygonscan.com/tx/${proposal.transactionHash}`;
  const polymarketUrl = market?.market_slug ? `https://polymarket.com/market/${market.market_slug}` : undefined;
  const betmoarUrl = market?.market_slug ? `https://betmoar.fun/market/${market.market_slug}` : undefined;
  const question = market?.question;
  const matchedTags = tagMatch.matchedMarketTags.join(", ");
  const liquidityText = liquidity ? formatProposedSideLiquidity(liquidity) : undefined;
  const text = [
    question ? `Proposal opened for: ${question}` : "A Polymarket UMA resolution proposal was opened.",
    `Proposed outcome: ${proposal.proposedOutcome}`,
    liquidityText ? `Penny pick liquidity: ${liquidityText.replace(/\*\*/g, "")}` : "",
    `Matched tags: ${matchedTags}`
  ].filter(Boolean).join("\n");
  const hiddenFields = [
    { name: "Event type", value: "Polymarket UMA proposal", inline: true },
    { name: "On-chain tx", value: transactionUrl, inline: false },
    { name: matchedTagsFieldName, value: matchedTags, inline: false },
    ...(market?.condition_id ? [{ name: "Condition ID", value: market.condition_id, inline: false }] : []),
    { name: "Question ID", value: proposal.questionId, inline: false },
    { name: "Requester adapter", value: proposal.requester, inline: false },
    { name: "Oracle", value: proposal.oracleAddress, inline: false },
    { name: "Request timestamp", value: new Date(proposal.requestTimestamp * 1_000).toISOString(), inline: false },
    { name: "Block", value: String(proposal.blockNumber), inline: true }
  ];

  return {
    id: proposal.id,
    type: "Polymarket UMA proposal",
    alertTitle: liquidity ? "Polymarket UMA proposal - proposed-side shares available" : "Polymarket UMA proposal",
    sourceLabel: "On-chain tx",
    buttonLabel: "Open transaction",
    mentionAlertRole: true,
    textFieldName: "Proposal",
    text,
    qualifyingText: [question, proposal.ancillaryData, matchedTags, text].filter(Boolean).join("\n"),
    postedAt: proposal.blockTimestamp === undefined ? new Date() : new Date(proposal.blockTimestamp * 1_000),
    url: transactionUrl,
    polymarketUrl,
    prioritySummary: {
      question,
      questionUrl: polymarketUrl,
      betmoarUrl,
      proposedOutcome: proposal.proposedOutcome,
      proposedSideLiquidity: liquidityText,
      proposalExpirationAt: new Date(proposal.expirationTimestamp * 1_000).toISOString(),
      marketTags: market?.tags,
      matchedTags: tagMatch.matchedMarketTags,
      proposer: proposal.proposer
    },
    hideDefaultEventFields: true,
    hideLinksField: true,
    hideTextField: true,
    hiddenFields,
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

export function parsePolymarketProposalSettings(settingsJson: string | null): PolymarketProposalSettings {
  if (!settingsJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(settingsJson) as PolymarketProposalSettings;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getPolymarketProposalTagFilters(integration: Integration): ProposalTagFilterEntry[] {
  return getTagFiltersFromSettings(parsePolymarketProposalSettings(integration.settingsJson));
}

export function getPolymarketProposalTagFiltersFromSettingsJson(settingsJson: string | null): ProposalTagFilterEntry[] {
  return getTagFiltersFromSettings(parsePolymarketProposalSettings(settingsJson));
}

export function getPolymarketProposalTagChannelName(tag: TagFilterEntry): string {
  const slug = normalizeTagText(tag.slug || tag.label) || "tag";
  const channelName = `${proposalTagChannelPrefix}${slug}`.slice(0, 100).replace(/-+$/g, "");
  return channelName || `${proposalTagChannelPrefix}tag`;
}

export function getPolymarketProposalStoredTagFilter(
  settingsJson: string | null,
  tag: TagFilterEntry
): ProposalTagFilterEntry | null {
  return getPolymarketProposalTagFiltersFromSettingsJson(settingsJson).find((candidate) => sameTagFilter(candidate, tag)) ?? null;
}

export function getPolymarketProposalTagFilterByChannelId(
  integration: Integration,
  channelId: string
): ProposalTagFilterEntry | null {
  return getPolymarketProposalTagFilters(integration).find((tag) => tag.channelId === channelId) ?? null;
}

export function setPolymarketProposalTagChannel(
  settingsJson: string | null,
  tag: TagFilterEntry,
  channelId: string,
  channelName: string
): string {
  const settings = parsePolymarketProposalSettings(settingsJson);
  const tagFilters = getTagFiltersFromSettings(settings);
  const nextFilters = tagFilters.map((candidate) =>
    sameTagFilter(candidate, tag)
      ? { ...candidate, channelId: channelId.trim(), channelName: channelName.trim() }
      : candidate
  );

  return JSON.stringify({ ...settings, tagFilters: nextFilters });
}

export function resolvePolymarketProposalChannelIds(integration: Integration, post: EventMonitorPost): string[] {
  const matchedTagKeys = getPostMatchedTagKeys(post);
  if (!matchedTagKeys.size) {
    return [];
  }

  const marketTagKeys = getPostMarketTagKeys(post);
  const channelIds = getPolymarketProposalTagFilters(integration)
    .filter((tag) => tag.channelId && hasMatchedTagKey(matchedTagKeys, tag) && !isTagExcludedByMarketTagKeys(tag, marketTagKeys))
    .map((tag) => tag.channelId!)
    .filter(Boolean);
  return uniqueStrings(channelIds);
}

export async function searchPolymarketProposalTags(query: string): Promise<TagSearchResult> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error("Tag search query is required");
  }

  const normalizedQuery = normalizeTagText(trimmedQuery);
  const tags = await fetchAllPolymarketTags();
  const matches = tags.filter((tag) =>
    tag.id?.toLowerCase().includes(trimmedQuery.toLowerCase()) ||
    tag.slug.includes(normalizedQuery) ||
    normalizeTagText(tag.label).includes(normalizedQuery)
  );

  return {
    query: trimmedQuery,
    sourceUrl: gammaTagsUrl,
    fetchedAt: new Date().toISOString(),
    totalResults: matches.length,
    shownResults: matches.slice(0, maxTagSearchResults)
  };
}

export async function updatePolymarketProposalTagFilters(
  integration: Integration,
  action: TagFilterAction,
  tagQuery?: string
): Promise<TagFilterUpdateResult> {
  const settings = parsePolymarketProposalSettings(integration.settingsJson);
  const tagFilters = getTagFiltersFromSettings(settings);

  if (action === "list") {
    return {
      action,
      changed: false,
      message: tagFilters.length ? `${tagFilters.length} tag filter(s) configured.` : "No proposal tag filters configured.",
      tagFilters,
      settingsJson: integration.settingsJson ?? JSON.stringify({ ...settings, tagFilters })
    };
  }

  if (action === "clear") {
    return {
      action,
      changed: tagFilters.length > 0,
      message: tagFilters.length ? "Cleared all proposal tag filters." : "No proposal tag filters were configured.",
      tagFilters: [],
      settingsJson: JSON.stringify({ ...settings, tagFilters: [] })
    };
  }

  if (!tagQuery?.trim()) {
    throw new Error(`${action} requires a tag id, slug, or label`);
  }

  if (action === "remove") {
    const localIndex = findLocalTagIndex(tagFilters, tagQuery);
    const matchedTag = localIndex >= 0 ? tagFilters[localIndex] : await resolvePolymarketTag(tagQuery);
    const nextFilters = tagFilters.filter((tag) => !sameTagFilter(tag, matchedTag));
    const changed = nextFilters.length !== tagFilters.length;
    return {
      action,
      changed,
      message: changed ? `Removed ${matchedTag.label}.` : `${matchedTag.label} was not configured.`,
      matchedTag,
      tagFilters: nextFilters,
      settingsJson: JSON.stringify({ ...settings, tagFilters: nextFilters })
    };
  }

  if (action === "add") {
    const matchedTag = await resolvePolymarketTag(tagQuery);
    const exists = tagFilters.some((tag) => sameTagFilter(tag, matchedTag));
    const nextFilters = exists ? tagFilters : [...tagFilters, matchedTag].sort(compareTagFilters);
    return {
      action,
      changed: !exists,
      message: exists ? `${matchedTag.label} was already configured.` : `Added ${matchedTag.label}.`,
      matchedTag,
      tagFilters: nextFilters,
      settingsJson: JSON.stringify({ ...settings, tagFilters: nextFilters })
    };
  }

  throw new Error(`Unsupported tag filter action: ${action}`);
}

export async function updatePolymarketProposalTagBlocklist(
  integration: Integration,
  subscriptionTagQuery: string | undefined,
  action: TagFilterAction,
  blockedTagQuery?: string
): Promise<TagBlocklistUpdateResult> {
  const settings = parsePolymarketProposalSettings(integration.settingsJson);
  const tagFilters = getTagFiltersFromSettings(settings);
  const subscriptionIndex = subscriptionTagQuery ? findLocalTagIndex(tagFilters, subscriptionTagQuery) : -1;
  if (subscriptionIndex < 0) {
    throw new Error("Run this in a proposal tag channel or provide a configured proposal tag.");
  }

  const subscriptionTag = tagFilters[subscriptionIndex];
  const blockedTags = subscriptionTag.excludedTags ?? [];

  if (action === "list") {
    return {
      action,
      changed: false,
      message: blockedTags.length
        ? `${subscriptionTag.label} excludes ${blockedTags.length} tag(s).`
        : `${subscriptionTag.label} has no excluded tags.`,
      subscriptionTag,
      blockedTags,
      settingsJson: integration.settingsJson ?? JSON.stringify({ ...settings, tagFilters })
    };
  }

  if (action === "clear") {
    const nextFilters = replaceTagFilter(tagFilters, subscriptionTag, { ...subscriptionTag, excludedTags: [] });
    return {
      action,
      changed: blockedTags.length > 0,
      message: blockedTags.length ? `Cleared excluded tags for ${subscriptionTag.label}.` : `${subscriptionTag.label} had no excluded tags.`,
      subscriptionTag: nextFilters[subscriptionIndex],
      blockedTags: [],
      settingsJson: JSON.stringify({ ...settings, tagFilters: nextFilters })
    };
  }

  if (!blockedTagQuery?.trim()) {
    throw new Error(`${action} requires a tag id, slug, or label to exclude`);
  }

  const blockedTag = action === "remove"
    ? (blockedTags[findLocalTagIndex(blockedTags, blockedTagQuery)] ?? await resolvePolymarketTag(blockedTagQuery))
    : await resolvePolymarketTag(blockedTagQuery);
  if (sameTagFilter(subscriptionTag, blockedTag)) {
    throw new Error(`Cannot exclude ${blockedTag.label} from itself.`);
  }

  if (action === "remove") {
    const nextBlockedTags = blockedTags.filter((tag) => !sameTagFilter(tag, blockedTag));
    const changed = nextBlockedTags.length !== blockedTags.length;
    const nextFilters = replaceTagFilter(tagFilters, subscriptionTag, { ...subscriptionTag, excludedTags: nextBlockedTags });
    return {
      action,
      changed,
      message: changed ? `${subscriptionTag.label} will no longer exclude ${blockedTag.label}.` : `${subscriptionTag.label} was not excluding ${blockedTag.label}.`,
      subscriptionTag: nextFilters[subscriptionIndex],
      blockedTag,
      blockedTags: nextBlockedTags,
      settingsJson: JSON.stringify({ ...settings, tagFilters: nextFilters })
    };
  }

  if (action === "add") {
    const exists = blockedTags.some((tag) => sameTagFilter(tag, blockedTag));
    const nextBlockedTags = exists ? blockedTags : [...blockedTags, blockedTag].sort(compareTagFilters);
    const nextFilters = replaceTagFilter(tagFilters, subscriptionTag, { ...subscriptionTag, excludedTags: nextBlockedTags });
    return {
      action,
      changed: !exists,
      message: exists
        ? `${subscriptionTag.label} already excludes ${blockedTag.label}.`
        : `${subscriptionTag.label} will exclude markets that also have ${blockedTag.label}.`,
      subscriptionTag: nextFilters[subscriptionIndex],
      blockedTag,
      blockedTags: nextBlockedTags,
      settingsJson: JSON.stringify({ ...settings, tagFilters: nextFilters })
    };
  }

  throw new Error(`Unsupported tag blocklist action: ${action}`);
}

export function getPolymarketProposalRpcUrls(settings: PolymarketProposalSettings = {}): string[] {
  const configured = [
    ...splitRpcUrls(settings.rpcUrl),
    ...splitRpcUrls(process.env.POLYGON_RPC_URLS),
    ...splitRpcUrls(process.env.POLYGON_RPC_URL)
  ];
  return uniqueStrings(configured.length > 0 ? [...configured, ...defaultPolygonRpcUrls] : defaultPolygonRpcUrls);
}

export function getPolymarketProposalWsUrl(settings: PolymarketProposalSettings = {}): string {
  return firstNonEmptyString(settings.wsUrl, process.env.POLYGON_WS_URL) ?? defaultPolygonWsUrl;
}

async function fetchLatestBlockNumber(rpcUrls: string[]): Promise<PolygonRpcResult<number>> {
  const response = await polygonRpc<string>(rpcUrls, "eth_blockNumber", []);
  return { result: parseHexQuantity(response.result), rpcUrl: response.rpcUrl };
}

async function fetchProposalLogs(
  rpcUrls: string[],
  fromBlock: number,
  toBlock: number,
  preferredRpcUrl?: string
): Promise<PolygonRpcResult<PolygonLog[]>> {
  const logs: PolygonLog[] = [];
  let activeRpcUrl = preferredRpcUrl;
  for (let chunkFrom = fromBlock; chunkFrom <= toBlock; chunkFrom += rpcLogChunkBlocks) {
    const chunkTo = Math.min(toBlock, chunkFrom + rpcLogChunkBlocks - 1);
    for (const oracleAddress of optimisticOracleAddresses) {
      const response = await fetchProposalLogRange(rpcUrls, oracleAddress, chunkFrom, chunkTo, activeRpcUrl);
      activeRpcUrl = response.rpcUrl;
      logs.push(...response.result);
    }
  }

  return { result: logs, rpcUrl: activeRpcUrl ?? defaultPolygonRpcUrl };
}

async function fetchProposalLogRange(
  rpcUrls: string[],
  oracleAddress: string,
  fromBlock: number,
  toBlock: number,
  preferredRpcUrl?: string
): Promise<PolygonRpcResult<PolygonLog[]>> {
  try {
    return await polygonRpc<PolygonLog[]>(
      rpcUrls,
      "eth_getLogs",
      [
        {
          address: oracleAddress,
          fromBlock: toHexQuantity(fromBlock),
          toBlock: toHexQuantity(toBlock),
          topics: [proposePriceTopic, polymarketUmaCtfAdapterAddressTopics]
        }
      ],
      preferredRpcUrl
    );
  } catch (error) {
    if (!isInvalidBlockRangeError(error) || fromBlock >= toBlock) {
      throw error;
    }

    const midBlock = Math.floor((fromBlock + toBlock) / 2);
    const first = await fetchProposalLogRange(rpcUrls, oracleAddress, fromBlock, midBlock, preferredRpcUrl);
    const second = await fetchProposalLogRange(rpcUrls, oracleAddress, midBlock + 1, toBlock, first.rpcUrl);
    return { result: [...first.result, ...second.result], rpcUrl: second.rpcUrl };
  }
}

async function fetchClobMarketByQuestionId(questionId: string): Promise<ClobMarket | null> {
  const response = await fetchWithTimeout(`${clobMarketByQuestionIdUrl}/${encodeURIComponent(questionId)}`, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as Record<string, unknown>;
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return {
    question: typeof payload.question === "string" ? payload.question : undefined,
    market_slug: typeof payload.market_slug === "string" ? payload.market_slug : undefined,
    condition_id: typeof payload.condition_id === "string" ? payload.condition_id : undefined,
    tags: Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === "string") : [],
    tokens: parseClobMarketTokens(payload)
  };
}

async function fetchProposedSideLiquidity(
  proposal: PolymarketProposalEvent,
  market: ClobMarket | null,
  cache = new Map<string, ProposedSideLiquidity | null>()
): Promise<ProposedSideLiquidity | null> {
  const token = findProposedOutcomeToken(proposal.proposedPrice, market);
  if (!token) {
    return null;
  }

  if (cache.has(token.tokenId)) {
    return cache.get(token.tokenId) ?? null;
  }

  const book = await fetchClobOrderBook(token.tokenId);
  const asks = book?.asks.filter((ask) => ask.price > 0 && ask.price < 1 && ask.size > 0) ?? [];
  const liquidity = asks.length
    ? {
        outcome: token.outcome,
        tokenId: token.tokenId,
        bestAsk: asks[0].price,
        bestAskSize: asks[0].size,
        totalAskSize: asks.reduce((sum, ask) => sum + ask.size, 0),
        askCount: asks.length
      }
    : null;

  cache.set(token.tokenId, liquidity);
  return liquidity;
}

async function fetchClobOrderBook(tokenId: string): Promise<ClobOrderBook | null> {
  const url = new URL(clobOrderBookUrl);
  url.searchParams.set("token_id", tokenId);

  const response = await fetch(url.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" },
    signal: AbortSignal.timeout(clobOrderBookTimeoutMs)
  });
  if (!response.ok) {
    return null;
  }

  return parseClobOrderBook((await response.json()) as unknown);
}

function parseClobMarketTokens(payload: Record<string, unknown>): ClobMarketToken[] {
  if (Array.isArray(payload.tokens)) {
    return payload.tokens.map(toClobMarketToken).filter(isClobMarketToken);
  }

  const tokenIds = parseStringArray(payload.clobTokenIds ?? payload.clob_token_ids);
  const outcomes = parseStringArray(payload.outcomes);
  return tokenIds
    .map((tokenId, index) => ({ tokenId, outcome: outcomes[index] ?? defaultOutcomeName(index) }))
    .filter(isClobMarketToken);
}

function toClobMarketToken(value: unknown): ClobMarketToken | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const token = value as Record<string, unknown>;
  const tokenId = firstNonEmptyString(token.token_id, token.tokenId, token.asset_id, token.assetId, token.id);
  const outcome = firstNonEmptyString(token.outcome, token.name, token.label);
  return tokenId && outcome ? { tokenId, outcome } : null;
}

function parseClobOrderBook(payload: unknown): ClobOrderBook | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const book = payload as Record<string, unknown>;
  return { asks: parseClobOrderLevels(book.asks).sort((left, right) => left.price - right.price) };
}

function parseClobOrderLevels(value: unknown): ClobOrderLevel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(toClobOrderLevel).filter(isClobOrderLevel);
}

function toClobOrderLevel(value: unknown): ClobOrderLevel | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const level = value as Record<string, unknown>;
  const price = toFiniteNumber(level.price);
  const size = toFiniteNumber(level.size);
  return price !== null && size !== null ? { price, size } : null;
}

function findProposedOutcomeToken(proposedPrice: bigint, market: ClobMarket | null): ClobMarketToken | null {
  const outcomeSide = getScalarProposedOutcomeSide(proposedPrice);
  const tokens = market?.tokens ?? [];
  if (!outcomeSide || !tokens.length) {
    return null;
  }

  const exactToken = tokens.find((token) => normalizeTokenOutcome(token.outcome) === outcomeSide);
  if (exactToken) {
    return { ...exactToken, outcome: outcomeSide };
  }

  if (tokens.length === 2) {
    return outcomeSide === "YES" ? tokens[0] : tokens[1];
  }

  return null;
}

function getScalarProposedOutcomeSide(proposedPrice: bigint): "YES" | "NO" | null {
  if (proposedPrice === umaOnePrice) {
    return "YES";
  }
  if (proposedPrice === 0n) {
    return "NO";
  }
  return null;
}

function normalizeTokenOutcome(outcome: string): "YES" | "NO" | null {
  const normalized = normalizeTagText(outcome);
  if (["yes", "y"].includes(normalized)) {
    return "YES";
  }
  if (["no", "n"].includes(normalized)) {
    return "NO";
  }
  return null;
}

function formatProposedSideLiquidity(liquidity: ProposedSideLiquidity): string {
  return [
    `**${liquidity.outcome} shares available**`,
    `best ask ${formatSharePrice(liquidity.bestAsk)}`,
    `${formatShareQuantity(liquidity.bestAskSize)} at best`,
    `${formatShareQuantity(liquidity.totalAskSize)} total asks`
  ].join(" | ");
}

async function fetchAllPolymarketTags(nowMs = Date.now()): Promise<TagFilterEntry[]> {
  if (tagCache && nowMs - tagCache.fetchedAtMs < gammaTagCacheMs) {
    return tagCache.tags;
  }

  const tags: TagFilterEntry[] = [];
  for (let pageIndex = 0; pageIndex < maxGammaTagPages; pageIndex += 1) {
    const url = new URL(gammaTagsUrl);
    url.searchParams.set("limit", String(gammaTagPageSize));
    url.searchParams.set("offset", String(pageIndex * gammaTagPageSize));
    const response = await fetchWithTimeout(url.toString(), {
      headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
    });
    if (!response.ok) {
      throw new Error(`Polymarket Gamma tags returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    const page = Array.isArray(payload) ? payload.map(toTagFilterEntry).filter(isTagFilterEntry) : [];
    tags.push(...page);
    if (page.length < gammaTagPageSize) {
      break;
    }
  }

  const uniqueTags = uniqueTagFilters(tags).sort(compareTagFilters);
  tagCache = { fetchedAtMs: nowMs, tags: uniqueTags };
  return uniqueTags;
}

async function resolvePolymarketTag(query: string): Promise<TagFilterEntry> {
  const trimmedQuery = query.trim();
  const direct = await fetchDirectPolymarketTag(trimmedQuery).catch(() => null);
  if (direct) {
    return direct;
  }

  const tags = await fetchAllPolymarketTags();
  const normalizedQuery = normalizeTagText(trimmedQuery);
  const lowerQuery = trimmedQuery.toLowerCase();
  const exactMatches = tags.filter((tag) =>
    tag.id?.toLowerCase() === lowerQuery ||
    tag.slug === normalizedQuery ||
    normalizeTagText(tag.label) === normalizedQuery
  );
  if (exactMatches.length === 1) {
    return exactMatches[0];
  }
  if (exactMatches.length > 1) {
    throw new Error(`Multiple exact Polymarket tags matched "${trimmedQuery}": ${formatTagCandidates(exactMatches)}`);
  }

  const partialMatches = tags.filter((tag) =>
    tag.id?.toLowerCase().includes(lowerQuery) ||
    tag.slug.includes(normalizedQuery) ||
    normalizeTagText(tag.label).includes(normalizedQuery)
  );
  if (partialMatches.length === 1) {
    return partialMatches[0];
  }
  if (partialMatches.length > 1) {
    throw new Error(
      `Multiple Polymarket tags matched "${trimmedQuery}": ${formatTagCandidates(partialMatches)}. Use the tag id or slug.`
    );
  }

  throw new Error(`No Polymarket tag found for "${trimmedQuery}"`);
}

async function fetchDirectPolymarketTag(query: string): Promise<TagFilterEntry | null> {
  const candidates = /^\d+$/.test(query)
    ? [`${gammaTagsUrl}/${encodeURIComponent(query)}`]
    : [`${gammaTagsUrl}/slug/${encodeURIComponent(normalizeTagText(query))}`];

  for (const url of candidates) {
    const response = await fetchWithTimeout(url, {
      headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
    });
    if (!response.ok) {
      continue;
    }

    const tag = toTagFilterEntry((await response.json()) as GammaTag);
    if (tag) {
      return tag;
    }
  }

  return null;
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

function findProposalTagMatch(marketTags: string[], tagFilters: ProposalTagFilterEntry[]): ProposalTagMatch | null {
  if (!marketTags.length || !tagFilters.length) {
    return null;
  }

  const marketTagKeys = new Set(marketTags.map(normalizeTagText));
  const normalizedFilters = new Map<string, ProposalTagFilterEntry[]>();
  for (const filter of tagFilters) {
    for (const key of uniqueStrings([normalizeTagText(filter.label), normalizeTagText(filter.slug)])) {
      const existing = normalizedFilters.get(key) ?? [];
      existing.push(filter);
      normalizedFilters.set(key, existing);
    }
  }

  const matchedMarketTags: string[] = [];
  const matchedFilters: ProposalTagFilterEntry[] = [];
  for (const marketTag of marketTags) {
    const filters = (normalizedFilters.get(normalizeTagText(marketTag)) ?? []).filter(
      (filter) => !isTagExcludedByMarketTagKeys(filter, marketTagKeys)
    );
    if (!filters?.length) {
      continue;
    }

    matchedMarketTags.push(marketTag);
    matchedFilters.push(...filters);
  }

  return matchedMarketTags.length
    ? { matchedMarketTags: uniqueStrings(matchedMarketTags), matchedFilters: uniqueTagFilters(matchedFilters) }
    : null;
}

function getPostMatchedTagKeys(post: EventMonitorPost): Set<string> {
  const summaryMatchedTags = post.prioritySummary?.matchedTags ?? [];
  const value = getPostFieldValue(post, matchedTagsFieldName) ?? "";
  return new Set(
    [...summaryMatchedTags, ...value.split(",")]
      .map((tag) => normalizeTagText(tag))
      .filter(Boolean)
  );
}

function getPostMarketTagKeys(post: EventMonitorPost): Set<string> {
  const summaryMarketTags = post.prioritySummary?.marketTags ?? [];
  const value = getPostFieldValue(post, "Market tags") ?? "";
  return new Set(
    [...summaryMarketTags, ...value.split(",")]
      .map((tag) => normalizeTagText(tag.replace(/\*/g, "")))
      .filter(Boolean)
  );
}

function hasMatchedTagKey(matchedTagKeys: Set<string>, tag: TagFilterEntry): boolean {
  return matchedTagKeys.has(normalizeTagText(tag.label)) || matchedTagKeys.has(normalizeTagText(tag.slug));
}

function isTagExcludedByMarketTagKeys(tag: ProposalTagFilterEntry, marketTagKeys: Set<string>): boolean {
  return (tag.excludedTags ?? []).some((excludedTag) => hasMatchedTagKey(marketTagKeys, excludedTag));
}

function getNextFromBlock(settings: PolymarketProposalSettings, confirmedLatestBlock: number): number {
  if (isSafeNonNegativeInteger(settings.lastScannedBlock)) {
    return settings.lastScannedBlock + 1;
  }

  const lookbackBlocks = getIntegerSetting(settings.initialLookbackBlocks, defaultInitialLookbackBlocks, 1, 500_000);
  return Math.max(0, confirmedLatestBlock - lookbackBlocks + 1);
}

function getMaxScanBlocksPerRun(settings: PolymarketProposalSettings): number {
  return getIntegerSetting(settings.maxScanBlocksPerRun, defaultMaxScanBlocksPerRun, 1, 100_000);
}

function isPolymarketUmaCtfAdapter(address: string): boolean {
  const normalized = address.toLowerCase();
  return polymarketUmaCtfAdapterAddresses.some((candidate) => candidate.toLowerCase() === normalized);
}

function formatWatchedAdapterAddresses(): string {
  const visible = polymarketUmaCtfAdapterAddresses.slice(0, maxAdapterAddressesField);
  const suffix = polymarketUmaCtfAdapterAddresses.length > visible.length
    ? `\n+${polymarketUmaCtfAdapterAddresses.length - visible.length} older adapter(s)`
    : "";
  return `${visible.join("\n")}${suffix}`;
}

function formatConfiguredTagFilters(tagFilters: ProposalTagFilterEntry[]): string {
  return tagFilters.length
    ? tagFilters
        .map((tag) =>
          [
            `${tag.label} (${tag.slug})${tag.channelName ? ` -> #${tag.channelName}` : ""}`,
            tag.excludedTags?.length ? `excludes: ${tag.excludedTags.map((blockedTag) => blockedTag.label).join(", ")}` : ""
          ]
            .filter(Boolean)
            .join(" | ")
        )
        .join("\n")
    : "none - use `/umaproposals tags action:add tag:<id-or-slug>`";
}

function formatProposedOutcome(value: bigint): string {
  if (value === 0n) {
    return "NO (0)";
  }
  if (value === umaOnePrice) {
    return "YES (1)";
  }
  if (value === umaHalfPrice) {
    return "UNKNOWN / 50-50 (0.5)";
  }
  if (value === umaIgnorePrice) {
    return "IGNORE";
  }

  return formatFixed18(value);
}

function formatFixed18(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const scale = 10n ** 18n;
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(18, "0").replace(/0+$/g, "");
  return `${sign}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

function decodeAbiBytesAt(hex: string, byteOffsetHexIndex: number): Uint8Array {
  const length = wordToSafeNumber(readWordAt(hex, byteOffsetHexIndex), "bytes length");
  const start = byteOffsetHexIndex + 64;
  const end = start + length * 2;
  if (end > hex.length) {
    throw new Error("ABI bytes payload is shorter than declared length");
  }
  return Buffer.from(hex.slice(start, end), "hex");
}

function readWord(hex: string, wordIndex: number): string {
  return readWordAt(hex, wordIndex * 64);
}

function readWordAt(hex: string, offset: number): string {
  const word = hex.slice(offset, offset + 64);
  if (word.length !== 64) {
    throw new Error("ABI payload is shorter than expected");
  }
  return word;
}

function wordToSafeNumber(word: string, label: string): number {
  const value = BigInt(`0x${word}`);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`ABI ${label} exceeds JavaScript safe integer range`);
  }
  return Number(value);
}

function wordToSignedBigInt(word: string): bigint {
  const unsigned = BigInt(`0x${word}`);
  return unsigned >= 1n << 255n ? unsigned - (1n << 256n) : unsigned;
}

function getTopic(log: PolygonLog, index: number): string | null {
  const topic = log.topics[index];
  return typeof topic === "string" && /^0x[0-9a-fA-F]{64}$/.test(topic) ? topic : null;
}

function parseAddressTopic(topic: string): string {
  const normalized = stripHexPrefix(topic);
  if (normalized.length < 40) {
    return "";
  }
  return `0x${normalized.slice(-40)}`;
}

function addressTopic(address: string): string {
  return `0x${stripHexPrefix(address).toLowerCase().padStart(64, "0")}`;
}

function keccakTopic(signature: string): string {
  return `0x${Buffer.from(keccak_256(Buffer.from(signature, "utf8"))).toString("hex")}`;
}

function toHexQuantity(value: number): string {
  return `0x${value.toString(16)}`;
}

function stripHexPrefix(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function getIntegerSetting(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parseStringArray(parsed);
  } catch {
    return [];
  }
}

function defaultOutcomeName(index: number): string {
  if (index === 0) {
    return "YES";
  }
  if (index === 1) {
    return "NO";
  }
  return `Outcome ${index + 1}`;
}

function isClobMarketToken(value: ClobMarketToken | null): value is ClobMarketToken {
  return Boolean(value?.tokenId && value.outcome);
}

function isClobOrderLevel(value: ClobOrderLevel | null): value is ClobOrderLevel {
  return Boolean(value && Number.isFinite(value.price) && Number.isFinite(value.size));
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function formatSharePrice(value: number): string {
  return `$${formatDecimal(value, value < 0.01 ? 4 : 3)}`;
}

function formatShareQuantity(value: number): string {
  return `${formatDecimal(value, 4)} shares`;
}

function formatDecimal(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits
  }).format(value);
}

function splitRpcUrls(value: unknown): string[] {
  return typeof value === "string"
    ? value
        .split(/[,\s]+/)
        .map((candidate) => candidate.trim())
        .filter(Boolean)
    : [];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function orderRpcUrls(rpcUrls: string[], preferredRpcUrl?: string): string[] {
  const urls = uniqueStrings(rpcUrls);
  return preferredRpcUrl && urls.includes(preferredRpcUrl)
    ? [preferredRpcUrl, ...urls.filter((url) => url !== preferredRpcUrl)]
    : urls;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isInvalidBlockRangeError(error: unknown): boolean {
  const message = formatError(error).toLowerCase();
  return message.includes("block range") && (message.includes("invalid") || message.includes("too large"));
}

function getTagFiltersFromSettings(settings: PolymarketProposalSettings): ProposalTagFilterEntry[] {
  return uniqueTagFilters(Array.isArray(settings.tagFilters) ? settings.tagFilters.map(sanitizeTagFilter).filter(isTagFilterEntry) : []);
}

function sanitizeTagFilter(value: unknown): ProposalTagFilterEntry | null {
  const base = sanitizeBaseTagFilter(value);
  if (!base) {
    return null;
  }

  const tag = value as Partial<ProposalTagFilterEntry>;
  const excludedTags = Array.isArray(tag.excludedTags)
    ? uniqueTagFilters(tag.excludedTags.map(sanitizeBaseTagFilter).filter(isTagFilterEntry)).sort(compareTagFilters)
    : [];

  return {
    ...base,
    ...(typeof tag.channelId === "string" && tag.channelId.trim() ? { channelId: tag.channelId.trim() } : {}),
    ...(typeof tag.channelName === "string" && tag.channelName.trim() ? { channelName: tag.channelName.trim() } : {}),
    ...(excludedTags.length ? { excludedTags } : {})
  };
}

function sanitizeBaseTagFilter(value: unknown): TagFilterEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const tag = value as Partial<TagFilterEntry>;
  const label = typeof tag.label === "string" ? tag.label.trim() : "";
  const slug = typeof tag.slug === "string" ? normalizeTagText(tag.slug) : normalizeTagText(label);
  if (!label || !slug) {
    return null;
  }

  return {
    ...(typeof tag.id === "string" && tag.id.trim() ? { id: tag.id.trim() } : {}),
    label,
    slug
  };
}

function toTagFilterEntry(tag: GammaTag | unknown): TagFilterEntry | null {
  if (!tag || typeof tag !== "object") {
    return null;
  }

  const candidate = tag as GammaTag;
  const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
  const slug = typeof candidate.slug === "string" ? normalizeTagText(candidate.slug) : normalizeTagText(label);
  if (!label || !slug) {
    return null;
  }

  return {
    ...(candidate.id !== undefined && candidate.id !== null ? { id: String(candidate.id) } : {}),
    label,
    slug
  };
}

function isTagFilterEntry(value: TagFilterEntry | null): value is TagFilterEntry {
  return Boolean(value);
}

function uniqueTagFilters<T extends TagFilterEntry>(tags: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const tag of tags) {
    byKey.set(tagFilterKey(tag), tag);
  }
  return [...byKey.values()];
}

function replaceTagFilter(
  tagFilters: ProposalTagFilterEntry[],
  existingTag: TagFilterEntry,
  replacement: ProposalTagFilterEntry
): ProposalTagFilterEntry[] {
  return tagFilters.map((tag) => (sameTagFilter(tag, existingTag) ? replacement : tag));
}

function compareTagFilters(left: TagFilterEntry, right: TagFilterEntry): number {
  return left.label.localeCompare(right.label) || left.slug.localeCompare(right.slug);
}

function sameTagFilter(left: TagFilterEntry, right: TagFilterEntry): boolean {
  return tagFilterKey(left) === tagFilterKey(right) || Boolean(left.id && right.id && left.id === right.id);
}

function tagFilterKey(tag: TagFilterEntry): string {
  return tag.id ? `id:${tag.id}` : `slug:${tag.slug}`;
}

function findLocalTagIndex(tags: TagFilterEntry[], query: string): number {
  const normalizedQuery = normalizeTagText(query);
  const lowerQuery = query.trim().toLowerCase();
  return tags.findIndex((tag) =>
    tag.id?.toLowerCase() === lowerQuery ||
    tag.slug === normalizedQuery ||
    normalizeTagText(tag.label) === normalizedQuery
  );
}

function normalizeTagText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function formatTagCandidates(tags: TagFilterEntry[]): string {
  return tags
    .slice(0, 10)
    .map((tag) => `${tag.id ? `${tag.id}: ` : ""}${tag.label} (${tag.slug})`)
    .join(", ");
}

function compareProposalPostsDescending(left: EventMonitorPost, right: EventMonitorPost): number {
  const [leftTransactionHash, leftLogIndex] = left.id.split(":");
  const [rightTransactionHash, rightLogIndex] = right.id.split(":");
  const leftBlock = Number(getPostFieldValue(left, "Block") ?? 0);
  const rightBlock = Number(getPostFieldValue(right, "Block") ?? 0);
  if (leftBlock !== rightBlock) {
    return rightBlock - leftBlock;
  }

  const leftIndex = leftLogIndex ? parseHexQuantity(leftLogIndex) : 0;
  const rightIndex = rightLogIndex ? parseHexQuantity(rightLogIndex) : 0;
  if (leftIndex !== rightIndex) {
    return rightIndex - leftIndex;
  }

  return (rightTransactionHash ?? "").localeCompare(leftTransactionHash ?? "");
}

function getPostFieldValue(post: EventMonitorPost, name: string): string | undefined {
  return [...(post.fields ?? []), ...(post.hiddenFields ?? [])].find((field) => field.name === name)?.value;
}

export const testOnlyPolymarketProposalHelpers = {
  addressTopic,
  resetTagCache(): void {
    tagCache = null;
  }
};
