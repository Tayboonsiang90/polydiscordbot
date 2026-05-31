import { keccak_256 } from "@noble/hashes/sha3";
import { fetchWithTimeout } from "../http.js";
import { enrichEventPostAddressProfiles, updateAddressLabelsInSettingsJson } from "../addressLabels.js";
import {
  defaultPolygonRpcUrl,
  defaultPolygonRpcUrls,
  defaultPolygonWsUrl,
  parseHexQuantity,
  polymarketBulletinBoardAddress,
  type PolygonLog
} from "./polymarketClarifications.js";
import type {
  AdapterValue,
  AddressLabelAction,
  AddressLabelUpdateOptions,
  AddressLabelUpdateResult,
  EventMonitorPost,
  EventMonitorResult,
  Integration,
  WebsiteAdapter
} from "./types.js";

export const optimisticOracleV1Address = "0xBb1A8db2D4350976a11cdfA60A1d43f97710Da49";
export const optimisticOracleV2Address = "0xee3afe347d5c74317041e2618c49534daf887c24";
export const optimisticOracleV3Address = "0x2C0367a9DB231dDeBd88a94b4f6461a6e47C58B1";
export const optimisticOracleSourceUrl = `https://polygonscan.com/address/${optimisticOracleV3Address}`;
export const optimisticOracleAddresses = [optimisticOracleV3Address, optimisticOracleV2Address, optimisticOracleV1Address];
export const polymarketUmaCtfAdapterAddresses = [
  polymarketBulletinBoardAddress,
  "0x157Ce2d672854c848c9b79C49a8Cc6cc89176a49",
  "0x71392E133063CC0D16F40E1F9B60227404Bc03f7",
  "0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74",
  "0xB97455fcF78eb37375e8be6f26df895341CA073d",
  "0xCB1822859cEF82Cd2Eb4E6276C7916e692995130"
];
export const disputePriceEventSignature = "DisputePrice(address,address,address,bytes32,uint256,bytes,int256)";
export const disputePriceTopic = keccakTopic(disputePriceEventSignature);
export const polymarketUmaCtfAdapterAddressTopics = polymarketUmaCtfAdapterAddresses.map(addressTopic);

const clobMarketByQuestionIdUrl = "https://clob.polymarket.com/markets-by-question-id";
const defaultConfirmations = 0;
const defaultInitialLookbackBlocks = 250;
const defaultMaxScanBlocksPerRun = 250;
const rpcLogChunkBlocks = 100;
const rpcTimeoutMs = 5_000;
const maxAdapterAddressesField = 3;

type JsonRpcResponse<T> = {
  result?: T;
  error?: { code: number; message: string };
};

type PolygonRpcResult<T> = {
  result: T;
  rpcUrl: string;
};

export type PolymarketDisputeSettings = {
  eventSeenPostIds?: string[];
  lastScannedBlock?: number;
  lastScanStartedBlock?: number;
  lastScanCompletedAt?: string;
  rpcUrl?: string;
  wsUrl?: string;
  confirmations?: number;
  initialLookbackBlocks?: number;
  maxScanBlocksPerRun?: number;
};

export type PolymarketDisputeEvent = {
  id: string;
  requester: string;
  proposer: string;
  disputer: string;
  oracleAddress: string;
  identifier: string;
  requestTimestamp: number;
  ancillaryData: string;
  questionId: string;
  proposedPrice: bigint;
  proposedOutcome: string;
  blockNumber: number;
  logIndex: number;
  transactionHash: string;
  blockTimestamp?: number;
};

type ClobMarket = {
  question?: string;
  market_slug?: string;
  condition_id?: string;
  tags?: string[];
};

export const polymarketDisputesAdapter: WebsiteAdapter = {
  id: "polymarket-disputes",
  commandName: "umadispute",
  displayName: "UMA Dispute Alerts",
  sourceUrl: optimisticOracleSourceUrl,
  defaultChannelName: "uma-disputes",
  alertRoleName: "UMA Dispute Alerts",
  alertRoleEmoji: "\u2696\uFE0F",
  alertRoleChannelName: "uma-alert-roles",
  alertRoleGroupTitle: "UMA Alert Roles",
  getPollIntervalMinutes(): number {
    return 1;
  },
  getPollIntervalReason(): string {
    return "WebSocket primary; 1-minute HTTP backfill";
  },
  getErrorNoticeWindowMinutes(): number {
    return 60;
  },
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    if (!integration) {
      throw new Error("Polymarket disputes requires an integration record");
    }

    const result = await fetchPolymarketDisputeUpdates(integration);
    const latest = result.posts[0];
    const value = latest ? `${latest.id}\n${latest.text}` : "no recent Polymarket UMA disputes";
    return { value, rawValue: value, unit: "latest on-chain dispute", observedAt: result.observedAt };
  },
  async fetchEventUpdates(integration: Integration): Promise<EventMonitorResult> {
    return fetchPolymarketDisputeUpdates(integration);
  },
  async updateAddressLabels(
    integration: Integration,
    action: AddressLabelAction,
    addressQuery?: string,
    labelQuery?: string,
    options?: AddressLabelUpdateOptions
  ): Promise<AddressLabelUpdateResult> {
    return updateAddressLabelsInSettingsJson(integration.settingsJson, action, addressQuery, labelQuery, options);
  }
};

export async function fetchPolymarketDisputeUpdates(integration: Integration, now = new Date()): Promise<EventMonitorResult> {
  const settings = parsePolymarketDisputeSettings(integration.settingsJson);
  const rpcUrls = getPolymarketDisputeRpcUrls(settings);
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
    ? await fetchDisputeLogs(rpcUrls, fromBlock, toBlock, activeRpcUrl)
    : { result: [], rpcUrl: activeRpcUrl };
  const logs = logsResult.result;
  activeRpcUrl = logsResult.rpcUrl;
  const marketByQuestionId = new Map<string, ClobMarket | null>();
  const posts: EventMonitorPost[] = [];

  for (const log of logs) {
    const dispute = decodeDisputePriceLog(log);
    if (!dispute) {
      continue;
    }

    let market = marketByQuestionId.get(dispute.questionId);
    if (market === undefined) {
      market = await fetchClobMarketByQuestionId(dispute.questionId).catch(() => null);
      marketByQuestionId.set(dispute.questionId, market);
    }

    posts.push(await enrichEventPostAddressProfiles(normalizePolymarketDisputeEvent(dispute, market)));
  }

  posts.sort(compareDisputePostsDescending);

  return {
    posts,
    strikeTerms: [],
    settingsJson: JSON.stringify({
      ...settings,
      lastScannedBlock: toBlock,
      lastScanStartedBlock: fromBlock <= toBlock ? fromBlock : undefined,
      lastScanCompletedAt: now.toISOString()
    }),
    checkTitle: "UMA dispute check",
    checkFields: [
      { name: "Disputes in scanned range", value: String(posts.length), inline: true },
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

export async function buildPolymarketDisputePostFromLog(log: PolygonLog): Promise<EventMonitorPost | null> {
  const dispute = decodeDisputePriceLog(log);
  if (!dispute) {
    return null;
  }

  const market = await fetchClobMarketByQuestionId(dispute.questionId).catch(() => null);
  return enrichEventPostAddressProfiles(normalizePolymarketDisputeEvent(dispute, market));
}

export function buildFastPolymarketDisputePostFromLog(log: PolygonLog): EventMonitorPost | null {
  const dispute = decodeDisputePriceLog(log);
  return dispute ? normalizePolymarketDisputeEvent(dispute, null) : null;
}

export function normalizePolymarketDisputeEvent(dispute: PolymarketDisputeEvent, market: ClobMarket | null): EventMonitorPost {
  const transactionUrl = `https://polygonscan.com/tx/${dispute.transactionHash}`;
  const polymarketUrl = market?.market_slug ? `https://polymarket.com/market/${market.market_slug}` : undefined;
  const betmoarUrl = market?.market_slug ? `https://betmoar.fun/market/${market.market_slug}` : undefined;
  const question = market?.question;
  const text = [
    question ? `Dispute opened for: ${question}` : "A Polymarket UMA resolution proposal was disputed.",
    `Proposed outcome: ${dispute.proposedOutcome}`
  ].join("\n");
  const fields = [
    { name: "Event type", value: "Polymarket UMA dispute", inline: true },
    { name: "On-chain tx", value: transactionUrl, inline: false },
    ...(market?.condition_id ? [{ name: "Condition ID", value: market.condition_id, inline: false }] : []),
    { name: "Question ID", value: dispute.questionId, inline: false },
    { name: "Requester adapter", value: dispute.requester, inline: false },
    { name: "Oracle", value: dispute.oracleAddress, inline: false },
    { name: "Request timestamp", value: new Date(dispute.requestTimestamp * 1_000).toISOString(), inline: false },
    { name: "Block", value: String(dispute.blockNumber), inline: true }
  ];

  return {
    id: dispute.id,
    type: "Polymarket UMA dispute",
    alertTitle: "Polymarket UMA dispute",
    sourceLabel: "On-chain tx",
    buttonLabel: "Open transaction",
    mentionAlertRole: true,
    textFieldName: "Dispute",
    text,
    qualifyingText: [question, dispute.ancillaryData, text].filter(Boolean).join("\n"),
    postedAt: dispute.blockTimestamp === undefined ? new Date() : new Date(dispute.blockTimestamp * 1_000),
    url: transactionUrl,
    polymarketUrl,
    prioritySummary: {
      question,
      questionUrl: polymarketUrl,
      betmoarUrl,
      proposedOutcome: dispute.proposedOutcome,
      marketTags: market?.tags,
      proposer: dispute.proposer,
      disputer: dispute.disputer
    },
    hideDefaultEventFields: true,
    hideLinksField: true,
    hideTextField: true,
    fields,
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

export function decodeDisputePriceLog(log: PolygonLog): PolymarketDisputeEvent | null {
  if ((getTopic(log, 0) ?? "").toLowerCase() !== disputePriceTopic.toLowerCase()) {
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
  const ancillaryDataBytes = decodeAbiBytesAt(hex, ancillaryDataOffset * 2);
  const blockTimestamp = log.blockTimestamp ? parseHexQuantity(log.blockTimestamp) : undefined;

  return {
    id: `${log.transactionHash}:${log.logIndex}`,
    requester,
    proposer: parseAddressTopic(getTopic(log, 2) ?? ""),
    disputer: parseAddressTopic(getTopic(log, 3) ?? ""),
    oracleAddress: "address" in log && typeof log.address === "string" ? log.address : "",
    identifier,
    requestTimestamp,
    ancillaryData: Buffer.from(ancillaryDataBytes).toString("utf8").trim(),
    questionId: `0x${Buffer.from(keccak_256(ancillaryDataBytes)).toString("hex")}`,
    proposedPrice,
    proposedOutcome: formatProposedOutcome(proposedPrice),
    blockNumber: parseHexQuantity(log.blockNumber),
    logIndex: parseHexQuantity(log.logIndex),
    transactionHash: log.transactionHash,
    ...(blockTimestamp === undefined ? {} : { blockTimestamp })
  };
}

export function parsePolymarketDisputeSettings(settingsJson: string | null): PolymarketDisputeSettings {
  if (!settingsJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(settingsJson) as PolymarketDisputeSettings;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getPolymarketDisputeRpcUrls(settings: PolymarketDisputeSettings = {}): string[] {
  const configured = [
    ...splitRpcUrls(settings.rpcUrl),
    ...splitRpcUrls(process.env.POLYGON_RPC_URLS),
    ...splitRpcUrls(process.env.POLYGON_RPC_URL)
  ];
  return uniqueStrings(configured.length > 0 ? [...configured, ...defaultPolygonRpcUrls] : defaultPolygonRpcUrls);
}

export function getPolymarketDisputeWsUrl(settings: PolymarketDisputeSettings = {}): string {
  return firstNonEmptyString(settings.wsUrl, process.env.POLYGON_WS_URL) ?? defaultPolygonWsUrl;
}

async function fetchLatestBlockNumber(rpcUrls: string[]): Promise<PolygonRpcResult<number>> {
  const response = await polygonRpc<string>(rpcUrls, "eth_blockNumber", []);
  return { result: parseHexQuantity(response.result), rpcUrl: response.rpcUrl };
}

async function fetchDisputeLogs(
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
      const response = await fetchDisputeLogRange(rpcUrls, oracleAddress, chunkFrom, chunkTo, activeRpcUrl);
      activeRpcUrl = response.rpcUrl;
      logs.push(...response.result);
    }
  }

  return { result: logs, rpcUrl: activeRpcUrl ?? defaultPolygonRpcUrl };
}

async function fetchDisputeLogRange(
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
          topics: [disputePriceTopic, polymarketUmaCtfAdapterAddressTopics]
        }
      ],
      preferredRpcUrl
    );
  } catch (error) {
    if (!isInvalidBlockRangeError(error) || fromBlock >= toBlock) {
      throw error;
    }

    const midBlock = Math.floor((fromBlock + toBlock) / 2);
    const first = await fetchDisputeLogRange(rpcUrls, oracleAddress, fromBlock, midBlock, preferredRpcUrl);
    const second = await fetchDisputeLogRange(rpcUrls, oracleAddress, midBlock + 1, toBlock, first.rpcUrl);
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

  const payload = (await response.json()) as ClobMarket;
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return {
    question: typeof payload.question === "string" ? payload.question : undefined,
    market_slug: typeof payload.market_slug === "string" ? payload.market_slug : undefined,
    condition_id: typeof payload.condition_id === "string" ? payload.condition_id : undefined,
    tags: Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === "string") : []
  };
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

function getNextFromBlock(settings: PolymarketDisputeSettings, confirmedLatestBlock: number): number {
  if (isSafeNonNegativeInteger(settings.lastScannedBlock)) {
    return settings.lastScannedBlock + 1;
  }

  const lookbackBlocks = getIntegerSetting(settings.initialLookbackBlocks, defaultInitialLookbackBlocks, 1, 500_000);
  return Math.max(0, confirmedLatestBlock - lookbackBlocks + 1);
}

function getMaxScanBlocksPerRun(settings: PolymarketDisputeSettings): number {
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

function formatProposedOutcome(value: bigint): string {
  const one = 10n ** 18n;
  if (value === 0n) {
    return "NO (0)";
  }
  if (value === one) {
    return "YES (1)";
  }
  if (value === one / 2n) {
    return "UNKNOWN / 50-50 (0.5)";
  }
  if (value === -(1n << 255n)) {
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

function compareDisputePostsDescending(left: EventMonitorPost, right: EventMonitorPost): number {
  const [leftTransactionHash, leftLogIndex] = left.id.split(":");
  const [rightTransactionHash, rightLogIndex] = right.id.split(":");
  const leftBlock = Number(left.fields?.find((field) => field.name === "Block")?.value ?? 0);
  const rightBlock = Number(right.fields?.find((field) => field.name === "Block")?.value ?? 0);
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
