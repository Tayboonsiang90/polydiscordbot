import type { AdapterValue, EventMonitorPost, EventMonitorResult, Integration, WebsiteAdapter } from "./types.js";
import { fetchWithTimeout } from "../http.js";

export const polymarketBulletinBoardAddress = "0x65070BE91477460D8A7AeEb94ef92fe056C2f2A7";
export const polymarketBulletinBoardSourceUrl = `https://polygonscan.com/address/${polymarketBulletinBoardAddress}`;
export const ancillaryDataUpdatedTopic =
  "0x0059e11815211969c0c4aaf3f498b52b6c2f2d14f286275d0862d70de22a836b";

export const defaultPolygonRpcUrls = [
  "https://polygon.drpc.org",
  "https://polygon-bor-rpc.publicnode.com",
  "https://gateway.tenderly.co/public/polygon",
  "https://1rpc.io/matic"
];
export const defaultPolygonRpcUrl = defaultPolygonRpcUrls[0];
export const defaultPolygonWsUrl = "wss://polygon-bor-rpc.publicnode.com";
const gammaMarketApiUrl = "https://gamma-api.polymarket.com/markets";
const getQuestionSelector = "0x58c039cd";
const defaultConfirmations = 0;
const defaultInitialLookbackBlocks = 250;
const defaultMaxScanBlocksPerRun = 250;
const rpcLogChunkBlocks = 100;
const rpcTimeoutMs = 5_000;

type JsonRpcResponse<T> = {
  result?: T;
  error?: { code: number; message: string };
};

type PolygonRpcResult<T> = {
  result: T;
  rpcUrl: string;
};

export type PolymarketClarificationSettings = {
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

export type PolygonLog = {
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  blockTimestamp?: string;
};

export type PolymarketAncillaryData = {
  title?: string;
  marketId?: string;
  initializer?: string;
};

type QuestionDetails = PolymarketAncillaryData & {
  questionId: string;
  creator?: string;
  question?: string;
  slug?: string;
};

type GammaMarket = {
  question?: string;
  slug?: string;
};

export const polymarketClarificationsAdapter: WebsiteAdapter = {
  id: "polymarket-clarifications",
  commandName: "umaclarifications",
  displayName: "UMA Clarifications",
  sourceUrl: polymarketBulletinBoardSourceUrl,
  defaultChannelName: "uma-clarifications",
  legacyChannelNames: ["pmclarify", "uma-alerts"],
  alertRoleName: "UMA Clarification Alerts",
  alertRoleEmoji: "\uD83D\uDCE3",
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
      throw new Error("Polymarket clarifications requires an integration record");
    }

    const result = await fetchPolymarketClarificationUpdates(integration);
    const latest = result.posts[0];
    const value = latest ? `${latest.id}\n${latest.text}` : "no recent clarification updates";
    return { value, rawValue: value, unit: "latest on-chain clarification", observedAt: result.observedAt };
  },
  async fetchEventUpdates(integration: Integration): Promise<EventMonitorResult> {
    return fetchPolymarketClarificationUpdates(integration);
  }
};

export async function fetchPolymarketClarificationUpdates(
  integration: Integration,
  now = new Date()
): Promise<EventMonitorResult> {
  const settings = parsePolymarketClarificationSettings(integration.settingsJson);
  const rpcUrls = getPolymarketClarificationRpcUrls(settings);
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
    ? await fetchAncillaryDataUpdateLogs(rpcUrls, fromBlock, toBlock, activeRpcUrl)
    : { result: [], rpcUrl: activeRpcUrl };
  const logs = logsResult.result;
  activeRpcUrl = logsResult.rpcUrl;
  const detailsByQuestionId = new Map<string, QuestionDetails | null>();
  const posts: EventMonitorPost[] = [];

  for (const log of logs) {
    const questionId = getTopic(log, 1);
    if (!questionId) {
      continue;
    }

    let details = detailsByQuestionId.get(questionId);
    if (details === undefined) {
      details = await fetchQuestionDetails(rpcUrls, questionId, activeRpcUrl).catch(() => null);
      detailsByQuestionId.set(questionId, details);
    }

    posts.push(normalizePolymarketClarificationLog(log, details ?? { questionId }));
  }

  posts.sort(compareClarificationPostsDescending);

  return {
    posts,
    strikeTerms: [],
    settingsJson: JSON.stringify({
      ...settings,
      lastScannedBlock: toBlock,
      lastScanStartedBlock: fromBlock <= toBlock ? fromBlock : undefined,
      lastScanCompletedAt: now.toISOString()
    }),
    checkTitle: "UMA alert check",
    checkFields: [
      { name: "Clarifications in scanned range", value: String(logs.length), inline: true },
      { name: "Scanned blocks", value: fromBlock <= toBlock ? `${fromBlock} to ${toBlock}` : "already at latest block", inline: false },
      { name: "Confirmed head", value: String(confirmedLatestBlock), inline: true },
      { name: "Data source", value: `${activeRpcUrl} via eth_getLogs fallback`, inline: false },
      ...(rpcUrls.length > 1 ? [{ name: "RPC fallback pool", value: `${rpcUrls.length} endpoints configured`, inline: true }] : [])
    ],
    observedAt: now
  };
}

export function normalizePolymarketClarificationLog(log: PolygonLog, details: QuestionDetails): EventMonitorPost {
  const questionId = getTopic(log, 1) ?? details.questionId;
  const owner = parseAddressTopic(getTopic(log, 2) ?? "");
  const updateText = decodeUtf8AbiBytes(log.data);
  const blockNumber = parseHexQuantity(log.blockNumber);
  const logIndex = parseHexQuantity(log.logIndex);
  const blockTimestamp = log.blockTimestamp ? parseHexQuantity(log.blockTimestamp) : null;
  const transactionUrl = `https://polygonscan.com/tx/${log.transactionHash}`;
  const polymarketUrl = details.slug ? `https://polymarket.com/event/${details.slug}` : undefined;
  const question = details.question ?? details.title;
  const creator = details.creator ?? details.initializer ?? owner;
  const fields = [
    ...(question ? [{ name: "Question", value: question, inline: false }] : []),
    ...(details.marketId ? [{ name: "Gamma market", value: details.marketId, inline: true }] : []),
    { name: "Question ID", value: questionId, inline: false },
    { name: "Creator", value: creator, inline: false },
    { name: "Block", value: String(blockNumber), inline: true }
  ];

  return {
    id: `${log.transactionHash}:${log.logIndex}`,
    type: "Polymarket clarification",
    alertTitle: "Polymarket clarification",
    sourceLabel: "On-chain tx",
    buttonLabel: "Open transaction",
    mentionAlertRole: true,
    textFieldName: "Clarification",
    text: updateText,
    qualifyingText: [question, updateText].filter(Boolean).join("\n"),
    postedAt: blockTimestamp === null ? new Date() : new Date(blockTimestamp * 1_000),
    url: transactionUrl,
    polymarketUrl,
    fields,
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

export async function buildPolymarketClarificationPostFromLog(
  log: PolygonLog,
  rpcUrls: string | string[] = defaultPolygonRpcUrls
): Promise<EventMonitorPost | null> {
  const questionId = getTopic(log, 1);
  if (!questionId) {
    return null;
  }

  const details = await fetchQuestionDetails(normalizeRpcUrls(rpcUrls), questionId).catch(() => null);
  return normalizePolymarketClarificationLog(log, details ?? { questionId });
}

export function buildFastPolymarketClarificationPostFromLog(log: PolygonLog): EventMonitorPost | null {
  const questionId = getTopic(log, 1);
  if (!questionId) {
    return null;
  }

  return normalizePolymarketClarificationLog(log, { questionId });
}

export function parsePolymarketAncillaryData(text: string): PolymarketAncillaryData {
  const title = text.match(/\btitle:\s*([\s\S]*?)(?:,\s*description:|$)/i)?.[1]?.trim();
  const marketId = text.match(/\bmarket_id:\s*(\d+)/i)?.[1];
  const initializerMatch = text.match(/\binitializer:\s*(?:0x)?([0-9a-fA-F]{40})\b/);
  const initializer = initializerMatch ? `0x${initializerMatch[1]}` : undefined;

  return {
    ...(title ? { title } : {}),
    ...(marketId ? { marketId } : {}),
    ...(initializer ? { initializer } : {})
  };
}

export function decodeUtf8AbiBytes(data: string): string {
  return Buffer.from(decodeAbiBytes(data)).toString("utf8").replace(/\0+$/g, "").trim();
}

export function decodeUmaCtfQuestionData(result: string): { creator: string; ancillaryData: string } {
  const hex = stripHexPrefix(result);
  const tupleOffset = wordToSafeNumber(readWord(hex, 0), "question tuple offset");
  const tupleStart = tupleOffset * 2;
  const creator = parseAddressTopic(readWordAt(hex, tupleStart + 10 * 64));
  const ancillaryDataOffset = wordToSafeNumber(readWordAt(hex, tupleStart + 11 * 64), "ancillaryData offset");
  const ancillaryData = Buffer.from(decodeAbiBytesAt(hex, tupleStart + ancillaryDataOffset * 2)).toString("utf8").trim();
  return { creator, ancillaryData };
}

export function parsePolymarketClarificationSettings(settingsJson: string | null): PolymarketClarificationSettings {
  if (!settingsJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(settingsJson) as PolymarketClarificationSettings;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getPolymarketClarificationRpcUrl(settings: PolymarketClarificationSettings = {}): string {
  return getPolymarketClarificationRpcUrls(settings)[0];
}

export function getPolymarketClarificationRpcUrls(settings: PolymarketClarificationSettings = {}): string[] {
  const configured = [
    ...splitRpcUrls(settings.rpcUrl),
    ...splitRpcUrls(process.env.POLYGON_RPC_URLS),
    ...splitRpcUrls(process.env.POLYGON_RPC_URL)
  ];
  return uniqueStrings(configured.length > 0 ? [...configured, ...defaultPolygonRpcUrls] : defaultPolygonRpcUrls);
}

export function getPolymarketClarificationWsUrl(settings: PolymarketClarificationSettings = {}): string {
  return firstNonEmptyString(settings.wsUrl, process.env.POLYGON_WS_URL) ?? defaultPolygonWsUrl;
}

function getNextFromBlock(settings: PolymarketClarificationSettings, confirmedLatestBlock: number): number {
  if (isSafeNonNegativeInteger(settings.lastScannedBlock)) {
    return settings.lastScannedBlock + 1;
  }

  const lookbackBlocks = getIntegerSetting(settings.initialLookbackBlocks, defaultInitialLookbackBlocks, 1, 500_000);
  return Math.max(0, confirmedLatestBlock - lookbackBlocks + 1);
}

function getMaxScanBlocksPerRun(settings: PolymarketClarificationSettings): number {
  return getIntegerSetting(settings.maxScanBlocksPerRun, defaultMaxScanBlocksPerRun, 1, 100_000);
}

async function fetchLatestBlockNumber(rpcUrls: string[]): Promise<PolygonRpcResult<number>> {
  const response = await polygonRpc<string>(rpcUrls, "eth_blockNumber", []);
  return { result: parseHexQuantity(response.result), rpcUrl: response.rpcUrl };
}

async function fetchAncillaryDataUpdateLogs(
  rpcUrls: string[],
  fromBlock: number,
  toBlock: number,
  preferredRpcUrl?: string
): Promise<PolygonRpcResult<PolygonLog[]>> {
  const logs: PolygonLog[] = [];
  let activeRpcUrl = preferredRpcUrl;
  for (let chunkFrom = fromBlock; chunkFrom <= toBlock; chunkFrom += rpcLogChunkBlocks) {
    const chunkTo = Math.min(toBlock, chunkFrom + rpcLogChunkBlocks - 1);
    const response = await fetchAncillaryDataUpdateLogRange(rpcUrls, chunkFrom, chunkTo, activeRpcUrl);
    activeRpcUrl = response.rpcUrl;
    logs.push(...response.result);
  }
  return { result: logs, rpcUrl: activeRpcUrl ?? rpcUrls[0] };
}

async function fetchAncillaryDataUpdateLogRange(
  rpcUrls: string[],
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
          address: polymarketBulletinBoardAddress,
          fromBlock: toHexQuantity(fromBlock),
          toBlock: toHexQuantity(toBlock),
          topics: [ancillaryDataUpdatedTopic]
        }
      ],
      preferredRpcUrl
    );
  } catch (error) {
    if (!isInvalidBlockRangeError(error) || fromBlock >= toBlock) {
      throw error;
    }

    const midBlock = Math.floor((fromBlock + toBlock) / 2);
    const first = await fetchAncillaryDataUpdateLogRange(rpcUrls, fromBlock, midBlock, preferredRpcUrl);
    const second = await fetchAncillaryDataUpdateLogRange(rpcUrls, midBlock + 1, toBlock, first.rpcUrl);
    return { result: [...first.result, ...second.result], rpcUrl: second.rpcUrl };
  }
}

async function fetchQuestionDetails(
  rpcUrls: string[],
  questionId: string,
  preferredRpcUrl?: string
): Promise<QuestionDetails> {
  const response = await polygonRpc<string>(
    rpcUrls,
    "eth_call",
    [
      { to: polymarketBulletinBoardAddress, data: `${getQuestionSelector}${stripHexPrefix(questionId)}` },
      "latest"
    ],
    preferredRpcUrl
  );
  const questionData = decodeUmaCtfQuestionData(response.result);
  const parsed = parsePolymarketAncillaryData(questionData.ancillaryData);
  const gammaMarket = parsed.marketId ? await fetchGammaMarket(parsed.marketId).catch(() => null) : null;

  return {
    questionId,
    ...parsed,
    creator: questionData.creator,
    question: gammaMarket?.question ?? parsed.title,
    slug: gammaMarket?.slug
  };
}

async function fetchGammaMarket(marketId: string): Promise<GammaMarket | null> {
  const response = await fetchWithTimeout(`${gammaMarketApiUrl}/${encodeURIComponent(marketId)}`, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as GammaMarket;
  return payload && typeof payload === "object" ? payload : null;
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

function decodeAbiBytes(data: string): Uint8Array {
  const hex = stripHexPrefix(data);
  const offset = wordToSafeNumber(readWord(hex, 0), "bytes offset");
  return decodeAbiBytesAt(hex, offset * 2);
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

export function parseHexQuantity(value: string): number {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`Invalid hex quantity: ${value}`);
  }
  const parsed = Number.parseInt(value.slice(2), 16);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Hex quantity exceeds JavaScript safe integer range: ${value}`);
  }
  return parsed;
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

function normalizeRpcUrls(value: string | string[]): string[] {
  const urls = uniqueStrings(Array.isArray(value) ? value : splitRpcUrls(value));
  return urls.length > 0 ? urls : defaultPolygonRpcUrls;
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

function compareClarificationPostsDescending(left: EventMonitorPost, right: EventMonitorPost): number {
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
