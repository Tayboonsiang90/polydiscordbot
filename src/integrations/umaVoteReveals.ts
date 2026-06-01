import { keccak_256 } from "@noble/hashes/sha3";
import { fetchWithTimeout } from "../http.js";
import { parseSettingsJson, stringifySettingsJson } from "../settingsJson.js";
import type {
  AdapterValue,
  EventMonitorPost,
  EventMonitorResult,
  Integration,
  ThresholdUpdateResult,
  WebsiteAdapter
} from "./types.js";

const votingV2Address = "0x004395edb43efca9885cedad51ec9faf93bd34ac";
const votingV2AddressLower = votingV2Address.toLowerCase();
const sourceUrl = `https://etherscan.io/address/${votingV2Address}`;
const defaultUmaRevealThresholdWei = "100000000000000000000000";
const voteRevealedEventSignature = "VoteRevealed(address,address,uint32,bytes32,uint256,bytes,int256,uint128)";
const defaultEthereumRpcUrls = [
  "https://ethereum.publicnode.com",
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://rpc.flashbots.net",
  "https://1rpc.io/eth"
];
const rpcTimeoutMs = 15_000;
const rpcLogChunkBlocks = 2_000;
const defaultConfirmations = 2;
const defaultInitialLookbackBlocks = 7_200;
const defaultMaxScanBlocksPerRun = 7_200;
const maxScanBlocksPerRunLimit = 50_000;
const tokenDecimals = 18;
const githubRoundRefs = ["voting-committee-1", "main"];
const roundAnswersCache = new Map<string, Map<string, UmaVotingRoundAnswer>>();

export const voteRevealedTopic = keccakTopic(voteRevealedEventSignature);

export type UmaVoteRevealSettings = {
  rpcUrl?: string;
  rpcUrls?: string;
  lastRpcUrl?: string;
  lastScannedBlock?: number;
  confirmations?: number;
  initialLookbackBlocks?: number;
  maxScanBlocksPerRun?: number;
  umaRevealThresholdWei?: string;
};

export type EthereumLog = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  blockTimestamp?: string;
};

export type UmaVoteRevealEvent = {
  id: string;
  voter: string;
  caller: string;
  roundId: number;
  identifier: string;
  requestTime: number;
  price: bigint;
  ancillaryDataHex: string;
  ancillaryDataText: string;
  numTokens: bigint;
  blockNumber: number;
  blockTimestamp?: number;
  transactionHash: string;
  logIndex: number;
};

type UmaVotingRoundAnswer = {
  ancillaryData: string;
  timestamp: number;
  question: string;
  answer?: string;
};

type UmaVoteRevealPostItem = {
  event: UmaVoteRevealEvent;
  postedAt: Date;
  roundAnswer?: UmaVotingRoundAnswer;
};

type JsonRpcResponse<T> = {
  result?: T;
  error?: { message?: string };
};

type RpcResult<T> = {
  result: T;
  rpcUrl: string;
};

export const umaVoteRevealsAdapter: WebsiteAdapter = {
  id: "uma-vote-reveals",
  commandName: "umareveals",
  displayName: "UMA Vote Reveals",
  sourceUrl,
  defaultChannelName: "uma-reveals",
  alertRoleName: "UMA Reveal Alerts",
  alertRoleEmoji: "\uD83D\uDC41\uFE0F",
  defaultSettings: {
    umaRevealThresholdWei: defaultUmaRevealThresholdWei
  },
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "Ethereum log polling for large UMA Voting v2 reveal events",
  getErrorNoticeWindowMinutes: () => 60,
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    if (!integration) {
      throw new Error("UMA Vote Reveals requires an integration record");
    }

    const result = await this.fetchEventUpdates!(integration);
    const latest = result.posts[0];
    const value = latest ? `${latest.type}\n${latest.text}` : "no large UMA vote reveals found in scanned blocks";
    return {
      value,
      rawValue: latest?.id ?? "no-reveals",
      observedAt: result.observedAt
    };
  },
  async fetchEventUpdates(integration: Integration): Promise<EventMonitorResult> {
    const observedAt = new Date();
    const settings = parseUmaVoteRevealSettings(integration.settingsJson);
    const thresholdWei = getUmaRevealThresholdWei(settings);
    const rpcUrls = getEthereumRpcUrls(settings);
    const latestBlockResponse = await fetchLatestBlockNumber(rpcUrls, settings.lastRpcUrl);
    const confirmations = getIntegerSetting(settings.confirmations, defaultConfirmations, 0, 128);
    const confirmedLatestBlock = Math.max(0, latestBlockResponse.result - confirmations);
    const fromBlock = getNextFromBlock(settings, confirmedLatestBlock);
    const maxScanBlocks = getIntegerSetting(settings.maxScanBlocksPerRun, defaultMaxScanBlocksPerRun, 1, maxScanBlocksPerRunLimit);
    const toBlock = fromBlock <= confirmedLatestBlock ? Math.min(confirmedLatestBlock, fromBlock + maxScanBlocks - 1) : confirmedLatestBlock;
    const logResponse =
      fromBlock <= toBlock
        ? await fetchVoteRevealLogs(rpcUrls, fromBlock, toBlock, latestBlockResponse.rpcUrl)
        : { result: [], rpcUrl: latestBlockResponse.rpcUrl };
    const votingStatus = await fetchVotingStatus(rpcUrls, logResponse.rpcUrl).catch(() => null);
    const decodedEvents = logResponse.result.map(decodeUmaVoteRevealLog).filter(isUmaVoteRevealEvent);
    const matchingEvents = decodedEvents.filter((event) => event.numTokens >= thresholdWei);
    const posts = await normalizeUmaVoteRevealPosts(matchingEvents, thresholdWei, rpcUrls, logResponse.rpcUrl);

    return {
      posts,
      strikeTerms: [],
      observedAt,
      settingsJson: stringifySettingsJson({
        ...parseSettingsJson(integration.settingsJson),
        umaRevealThresholdWei: thresholdWei.toString(),
        lastScannedBlock: toBlock,
        lastRpcUrl: logResponse.rpcUrl
      }),
      checkTitle: "UMA reveal check complete",
      checkFields: buildCheckFields({
        thresholdWei,
        fromBlock,
        toBlock,
        latestBlock: latestBlockResponse.result,
        confirmedLatestBlock,
        logsScanned: decodedEvents.length,
        matchingReveals: posts.length,
        votingStatus
      })
    };
  },
  updateThreshold(integration: Integration, thresholdQuery?: string): ThresholdUpdateResult {
    const settings = parseSettingsJson(integration.settingsJson);
    const previousThresholdWei = getUmaRevealThresholdWei(parseUmaVoteRevealSettings(integration.settingsJson));
    if (!thresholdQuery) {
      return {
        changed: false,
        message: "Current threshold returned. Provide `value` to change it.",
        thresholdLabel: "Minimum vote weight",
        thresholdValue: `${formatUmaTokenAmount(previousThresholdWei)} UMA`,
        settingsJson: stringifySettingsJson({
          ...settings,
          umaRevealThresholdWei: previousThresholdWei.toString()
        })
      };
    }

    const nextThresholdWei = parseUmaRevealThresholdWei(thresholdQuery);
    const settingsJson = stringifySettingsJson({
      ...settings,
      umaRevealThresholdWei: nextThresholdWei.toString()
    });
    return {
      changed: nextThresholdWei !== previousThresholdWei,
      message: `Future alerts will only fire for reveals at or above ${formatUmaTokenAmount(nextThresholdWei)} UMA.`,
      thresholdLabel: "Minimum vote weight",
      thresholdValue: `${formatUmaTokenAmount(nextThresholdWei)} UMA`,
      settingsJson
    };
  }
};

export function parseUmaVoteRevealSettings(settingsJson: string | null): UmaVoteRevealSettings {
  const settings = parseSettingsJson(settingsJson);
  return {
    rpcUrl: typeof settings.rpcUrl === "string" ? settings.rpcUrl : undefined,
    rpcUrls: typeof settings.rpcUrls === "string" ? settings.rpcUrls : undefined,
    lastRpcUrl: typeof settings.lastRpcUrl === "string" ? settings.lastRpcUrl : undefined,
    lastScannedBlock: isSafeNonNegativeInteger(settings.lastScannedBlock) ? settings.lastScannedBlock : undefined,
    confirmations: typeof settings.confirmations === "number" ? settings.confirmations : undefined,
    initialLookbackBlocks: typeof settings.initialLookbackBlocks === "number" ? settings.initialLookbackBlocks : undefined,
    maxScanBlocksPerRun: typeof settings.maxScanBlocksPerRun === "number" ? settings.maxScanBlocksPerRun : undefined,
    umaRevealThresholdWei: typeof settings.umaRevealThresholdWei === "string" ? settings.umaRevealThresholdWei : undefined
  };
}

export function parseUmaRevealThresholdWei(value: string): bigint {
  const normalized = value.trim().replace(/[,_\s]/g, "").toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!match) {
    throw new Error("Invalid UMA threshold. Use values like `100000`, `250k`, or `1.5m`.");
  }

  const multiplier = match[2] === "m" ? 1_000_000n : match[2] === "k" ? 1_000n : 1n;
  const units = parseDecimalTokenUnits(match[1], tokenDecimals) * multiplier;
  if (units <= 0n) {
    throw new Error("UMA threshold must be greater than zero.");
  }

  return units;
}

export function formatUmaTokenAmount(value: bigint, maxDecimals = 4): string {
  const scale = 10n ** BigInt(tokenDecimals);
  const whole = value / scale;
  const fractional = value % scale;
  if (fractional === 0n) {
    return whole.toLocaleString("en-US");
  }

  const fraction = fractional.toString().padStart(tokenDecimals, "0").replace(/0+$/, "").slice(0, maxDecimals);
  return `${whole.toLocaleString("en-US")}.${fraction}`;
}

export function decodeUmaVoteRevealLog(log: EthereumLog): UmaVoteRevealEvent | null {
  if (log.address.toLowerCase() !== votingV2AddressLower || log.topics[0]?.toLowerCase() !== voteRevealedTopic) {
    return null;
  }

  const voterTopic = getTopic(log, 1);
  const callerTopic = getTopic(log, 2);
  const identifierTopic = getTopic(log, 3);
  if (!voterTopic || !callerTopic || !identifierTopic) {
    return null;
  }

  const hex = stripHexPrefix(log.data);
  const roundId = wordToSafeNumber(readWord(hex, 0), "roundId");
  const requestTime = wordToSafeNumber(readWord(hex, 1), "request time");
  const ancillaryDataOffset = wordToSafeNumber(readWord(hex, 2), "ancillary data offset");
  const price = wordToSignedBigInt(readWord(hex, 3));
  const numTokens = BigInt(`0x${readWord(hex, 4)}`);
  const ancillaryDataBytes = decodeAbiBytesAt(hex, ancillaryDataOffset * 2);
  const blockNumber = parseHexQuantity(log.blockNumber);
  const blockTimestamp = log.blockTimestamp ? parseHexQuantity(log.blockTimestamp) : undefined;
  const logIndex = parseHexQuantity(log.logIndex);

  return {
    id: `${log.transactionHash.toLowerCase()}:${log.logIndex.toLowerCase()}`,
    voter: parseAddressTopic(voterTopic),
    caller: parseAddressTopic(callerTopic),
    roundId,
    identifier: identifierTopic,
    requestTime,
    price,
    ancillaryDataHex: `0x${Buffer.from(ancillaryDataBytes).toString("hex")}`,
    ancillaryDataText: Buffer.from(ancillaryDataBytes).toString("utf8"),
    numTokens,
    blockNumber,
    blockTimestamp,
    transactionHash: log.transactionHash.toLowerCase(),
    logIndex
  };
}

export function normalizeUmaVoteRevealPost(
  event: UmaVoteRevealEvent,
  thresholdWei: bigint,
  postedAt: Date,
  roundAnswer?: UmaVotingRoundAnswer
): EventMonitorPost {
  const transactionUrl = `https://etherscan.io/tx/${event.transactionHash}`;
  const voteWeight = `${formatUmaTokenAmount(event.numTokens)} UMA`;
  const revealedPrice = formatUmaVotePrice(event.price);
  const question = roundAnswer?.question;
  const text = [
    question,
    `${event.voter} revealed ${revealedPrice} with ${voteWeight} in round ${event.roundId}.`
  ].filter(Boolean).join("\n");

  return {
    id: event.id,
    type: "UMA vote reveal",
    alertTitle: "Large UMA vote reveal",
    sourceLabel: "Ethereum tx",
    buttonLabel: "Open transaction",
    mentionAlertRole: true,
    textFieldName: "Reveal",
    text,
    qualifyingText: text,
    postedAt,
    url: transactionUrl,
    hideLinksField: true,
    hideTextField: true,
    summaryFields: [
      ...(question ? [{ name: "Question", value: question, inline: false }] : []),
      { name: "Revealed price", value: revealedPrice, inline: true },
      ...(roundAnswer?.answer ? [{ name: "Committee answer file", value: roundAnswer.answer, inline: true }] : []),
      { name: "Vote weight", value: voteWeight, inline: true },
      { name: "Voter", value: event.voter, inline: false },
      ...(event.caller.toLowerCase() !== event.voter.toLowerCase()
        ? [{ name: "Delegate caller", value: event.caller, inline: false }]
        : []),
      { name: "Round", value: String(event.roundId), inline: true },
      { name: "Threshold", value: `${formatUmaTokenAmount(thresholdWei)} UMA`, inline: true }
    ],
    hiddenFields: [
      { name: "Contract", value: votingV2Address, inline: false },
      { name: "Block", value: String(event.blockNumber), inline: true },
      { name: "Log index", value: String(event.logIndex), inline: true },
      { name: "Identifier", value: event.identifier, inline: false },
      { name: "Request timestamp", value: String(event.requestTime), inline: true },
      { name: "Raw price", value: event.price.toString(), inline: false },
      { name: "Raw vote weight", value: event.numTokens.toString(), inline: false },
      { name: "Ancillary data", value: event.ancillaryDataText || event.ancillaryDataHex, inline: false },
      { name: "Ancillary data hex", value: event.ancillaryDataHex, inline: false }
    ],
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

async function normalizeUmaVoteRevealPosts(
  events: UmaVoteRevealEvent[],
  thresholdWei: bigint,
  rpcUrls: string[],
  preferredRpcUrl?: string
): Promise<EventMonitorPost[]> {
  const blockTimestamps = new Map<number, number>();
  const answerMaps = new Map<number, Map<string, UmaVotingRoundAnswer>>();
  const itemsByVoter = new Map<string, UmaVoteRevealPostItem[]>();

  for (const event of events) {
    const timestamp =
      event.blockTimestamp ??
      blockTimestamps.get(event.blockNumber) ??
      (await fetchBlockTimestamp(rpcUrls, event.blockNumber, preferredRpcUrl).catch(() => Math.floor(Date.now() / 1000)));
    blockTimestamps.set(event.blockNumber, timestamp);

    let answerMap = answerMaps.get(event.roundId);
    if (!answerMap) {
      answerMap = await fetchRoundAnswers(event.roundId).catch(() => new Map<string, UmaVotingRoundAnswer>());
      answerMaps.set(event.roundId, answerMap);
    }

    const voterKey = event.voter.toLowerCase();
    const items = itemsByVoter.get(voterKey) ?? [];
    items.push({
      event,
      postedAt: new Date(timestamp * 1000),
      roundAnswer: answerMap.get(roundAnswerKey(event))
    });
    itemsByVoter.set(voterKey, items);
  }

  const posts = [...itemsByVoter.values()].map((items) => normalizeUmaVoteRevealPostGroup(items, thresholdWei));
  return posts.sort(compareRevealPostsDescending);
}

function normalizeUmaVoteRevealPostGroup(items: UmaVoteRevealPostItem[], thresholdWei: bigint): EventMonitorPost {
  const sortedItems = [...items].sort((left, right) => compareRevealEventsDescending(left.event, right.event));
  if (sortedItems.length === 1) {
    const item = sortedItems[0]!;
    return normalizeUmaVoteRevealPost(item.event, thresholdWei, item.postedAt, item.roundAnswer);
  }

  const latest = sortedItems[0]!;
  const event = latest.event;
  const transactionUrl = `https://etherscan.io/tx/${event.transactionHash}`;
  const voteWeights = uniqueStrings(sortedItems.map((item) => `${formatUmaTokenAmount(item.event.numTokens)} UMA`));
  const rounds = uniqueStrings(sortedItems.map((item) => String(item.event.roundId)));
  const revealLines = sortedItems.map(formatRevealGroupLine);
  const text = [
    `${event.voter} revealed ${sortedItems.length} answers above threshold in ${formatPlural(rounds.length, "round")}.`,
    ...revealLines.slice(0, 5)
  ].join("\n");

  return {
    id: event.id,
    type: "UMA vote reveals",
    alertTitle: "Large UMA vote reveals",
    sourceLabel: "Ethereum tx",
    buttonLabel: "Open latest transaction",
    mentionAlertRole: true,
    textFieldName: "Reveals",
    text,
    qualifyingText: text,
    postedAt: latest.postedAt,
    url: transactionUrl,
    hideLinksField: true,
    hideTextField: true,
    summaryFields: [
      { name: "Voter", value: event.voter, inline: false },
      { name: "Reveal count", value: String(sortedItems.length), inline: true },
      { name: voteWeights.length === 1 ? "Vote weight" : "Vote weights", value: truncateFieldValue(voteWeights.join("\n")), inline: true },
      { name: "Rounds", value: rounds.join(", "), inline: true },
      { name: "Reveals", value: truncateFieldValue(revealLines.join("\n")), inline: false },
      { name: "Threshold", value: `${formatUmaTokenAmount(thresholdWei)} UMA`, inline: true }
    ],
    hiddenFields: [
      { name: "Contract", value: votingV2Address, inline: false },
      { name: "Block", value: String(event.blockNumber), inline: true },
      { name: "Log index", value: String(event.logIndex), inline: true },
      { name: "Included reveal logs", value: truncateFieldValue(sortedItems.map((item) => item.event.id).join("\n")), inline: false },
      { name: "Latest raw vote weight", value: event.numTokens.toString(), inline: false },
      { name: "Latest ancillary data", value: truncateFieldValue(event.ancillaryDataText || event.ancillaryDataHex), inline: false },
      { name: "Latest ancillary data hex", value: event.ancillaryDataHex, inline: false }
    ],
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

function formatRevealGroupLine(item: UmaVoteRevealPostItem, index: number): string {
  const question = item.roundAnswer?.question ?? `request ${item.event.requestTime}`;
  const answer = item.roundAnswer?.answer ? `; committee ${item.roundAnswer.answer}` : "";
  return `${index + 1}. ${truncateLine(question)} -> ${formatUmaVotePrice(item.event.price)}${answer}`;
}

async function fetchRoundAnswers(roundId: number): Promise<Map<string, UmaVotingRoundAnswer>> {
  const cacheKey = String(roundId);
  const cached = roundAnswersCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  for (const ref of githubRoundRefs) {
    const url = `https://raw.githubusercontent.com/UMA-rocks/voting-committees/${encodeURIComponent(ref)}/answers/${roundId}/1.json`;
    const response = await fetchWithTimeout(
      url,
      { headers: { "user-agent": "PolymarketResolutionMonitorBot/0.1" } },
      8_000
    ).catch(() => null);
    if (!response?.ok) {
      continue;
    }

    const answers = parseRoundAnswers(await response.json());
    roundAnswersCache.set(cacheKey, answers);
    return answers;
  }

  const empty = new Map<string, UmaVotingRoundAnswer>();
  roundAnswersCache.set(cacheKey, empty);
  return empty;
}

function parseRoundAnswers(payload: unknown): Map<string, UmaVotingRoundAnswer> {
  const answers = new Map<string, UmaVotingRoundAnswer>();
  if (!Array.isArray(payload)) {
    return answers;
  }

  for (const item of payload) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const row = item as Record<string, unknown>;
    if (typeof row.ancillaryData !== "string" || typeof row.timestamp !== "number" || typeof row.question !== "string") {
      continue;
    }

    const answer: UmaVotingRoundAnswer = {
      ancillaryData: normalizeHex(row.ancillaryData),
      timestamp: row.timestamp,
      question: row.question,
      answer: typeof row.answer === "string" ? row.answer : undefined
    };
    answers.set(`${answer.ancillaryData}:${answer.timestamp}`, answer);
  }

  return answers;
}

function roundAnswerKey(event: UmaVoteRevealEvent): string {
  return `${normalizeHex(event.ancillaryDataHex)}:${event.requestTime}`;
}

function buildCheckFields(input: {
  thresholdWei: bigint;
  fromBlock: number;
  toBlock: number;
  latestBlock: number;
  confirmedLatestBlock: number;
  logsScanned: number;
  matchingReveals: number;
  votingStatus: { roundId: number; phase: number } | null;
}): Array<{ name: string; value: string; inline?: boolean }> {
  return [
    { name: "Minimum vote weight", value: `${formatUmaTokenAmount(input.thresholdWei)} UMA`, inline: true },
    {
      name: "Current voting cycle",
      value: input.votingStatus ? `Round ${input.votingStatus.roundId} - ${formatVotingPhase(input.votingStatus.phase)}` : "unavailable",
      inline: true
    },
    { name: "Blocks scanned", value: `${input.fromBlock} to ${input.toBlock}`, inline: false },
    { name: "Latest block", value: `${input.latestBlock} (${input.confirmedLatestBlock} confirmed)`, inline: true },
    { name: "Reveal logs scanned", value: String(input.logsScanned), inline: true },
    { name: "Matching reveals", value: String(input.matchingReveals), inline: true }
  ];
}

async function fetchLatestBlockNumber(rpcUrls: string[], preferredRpcUrl?: string): Promise<RpcResult<number>> {
  const response = await ethereumRpc<string>(rpcUrls, "eth_blockNumber", [], preferredRpcUrl);
  return { result: parseHexQuantity(response.result), rpcUrl: response.rpcUrl };
}

async function fetchVoteRevealLogs(
  rpcUrls: string[],
  fromBlock: number,
  toBlock: number,
  preferredRpcUrl?: string
): Promise<RpcResult<EthereumLog[]>> {
  const logs: EthereumLog[] = [];
  let activeRpcUrl = preferredRpcUrl;
  for (let chunkFrom = fromBlock; chunkFrom <= toBlock; chunkFrom += rpcLogChunkBlocks) {
    const chunkTo = Math.min(toBlock, chunkFrom + rpcLogChunkBlocks - 1);
    const response = await fetchVoteRevealLogRange(rpcUrls, chunkFrom, chunkTo, activeRpcUrl);
    activeRpcUrl = response.rpcUrl;
    logs.push(...response.result);
  }
  return { result: logs, rpcUrl: activeRpcUrl ?? rpcUrls[0] };
}

async function fetchVoteRevealLogRange(
  rpcUrls: string[],
  fromBlock: number,
  toBlock: number,
  preferredRpcUrl?: string
): Promise<RpcResult<EthereumLog[]>> {
  try {
    return await ethereumRpc<EthereumLog[]>(
      rpcUrls,
      "eth_getLogs",
      [
        {
          address: votingV2Address,
          fromBlock: toHexQuantity(fromBlock),
          toBlock: toHexQuantity(toBlock),
          topics: [voteRevealedTopic]
        }
      ],
      preferredRpcUrl
    );
  } catch (error) {
    if (!isInvalidBlockRangeError(error) || fromBlock >= toBlock) {
      throw error;
    }

    const midBlock = Math.floor((fromBlock + toBlock) / 2);
    const first = await fetchVoteRevealLogRange(rpcUrls, fromBlock, midBlock, preferredRpcUrl);
    const second = await fetchVoteRevealLogRange(rpcUrls, midBlock + 1, toBlock, first.rpcUrl);
    return { result: [...first.result, ...second.result], rpcUrl: second.rpcUrl };
  }
}

async function fetchVotingStatus(
  rpcUrls: string[],
  preferredRpcUrl?: string
): Promise<{ roundId: number; phase: number }> {
  const roundResponse = await ethereumRpc<string>(
    rpcUrls,
    "eth_call",
    [{ to: votingV2Address, data: functionSelector("getCurrentRoundId()") }, "latest"],
    preferredRpcUrl
  );
  const phaseResponse = await ethereumRpc<string>(
    rpcUrls,
    "eth_call",
    [{ to: votingV2Address, data: functionSelector("getVotePhase()") }, "latest"],
    roundResponse.rpcUrl
  );

  return {
    roundId: wordToSafeNumber(readWord(stripHexPrefix(roundResponse.result), 0), "current round id"),
    phase: wordToSafeNumber(readWord(stripHexPrefix(phaseResponse.result), 0), "vote phase")
  };
}

async function fetchBlockTimestamp(rpcUrls: string[], blockNumber: number, preferredRpcUrl?: string): Promise<number> {
  const response = await ethereumRpc<{ timestamp?: string }>(
    rpcUrls,
    "eth_getBlockByNumber",
    [toHexQuantity(blockNumber), false],
    preferredRpcUrl
  );
  if (!response.result.timestamp) {
    throw new Error("block timestamp unavailable");
  }

  return parseHexQuantity(response.result.timestamp);
}

async function ethereumRpc<T>(
  rpcUrls: string[],
  method: string,
  params: unknown[],
  preferredRpcUrl?: string
): Promise<RpcResult<T>> {
  const errors: string[] = [];
  for (const rpcUrl of orderRpcUrls(rpcUrls, preferredRpcUrl)) {
    try {
      const result = await ethereumRpcOne<T>(rpcUrl, method, params);
      return { result, rpcUrl };
    } catch (error) {
      errors.push(`${rpcUrl}: ${formatError(error)}`);
    }
  }

  throw new Error(`Ethereum RPC ${method} failed on all endpoints: ${errors.join("; ")}`);
}

async function ethereumRpcOne<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
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
    throw new Error(payload.error.message ?? "RPC error");
  }
  if (payload.result === undefined) {
    throw new Error("returned no result");
  }

  return payload.result;
}

function getEthereumRpcUrls(settings: UmaVoteRevealSettings): string[] {
  const configured = [
    ...splitRpcUrls(settings.rpcUrls),
    ...splitRpcUrls(settings.rpcUrl),
    ...splitRpcUrls(process.env.ETHEREUM_RPC_URLS),
    ...splitRpcUrls(process.env.ETHEREUM_RPC_URL)
  ];
  return uniqueStrings(configured.length > 0 ? [...configured, ...defaultEthereumRpcUrls] : defaultEthereumRpcUrls);
}

function getUmaRevealThresholdWei(settings: UmaVoteRevealSettings): bigint {
  try {
    const value = BigInt(settings.umaRevealThresholdWei ?? defaultUmaRevealThresholdWei);
    return value > 0n ? value : BigInt(defaultUmaRevealThresholdWei);
  } catch {
    return BigInt(defaultUmaRevealThresholdWei);
  }
}

function getNextFromBlock(settings: UmaVoteRevealSettings, confirmedLatestBlock: number): number {
  if (isSafeNonNegativeInteger(settings.lastScannedBlock)) {
    return settings.lastScannedBlock + 1;
  }

  const lookbackBlocks = getIntegerSetting(settings.initialLookbackBlocks, defaultInitialLookbackBlocks, 1, maxScanBlocksPerRunLimit);
  return Math.max(0, confirmedLatestBlock - lookbackBlocks + 1);
}

function formatUmaVotePrice(price: bigint): string {
  const scale = 10n ** 18n;
  const negative = price < 0n;
  const abs = negative ? -price : price;
  if (abs > 10n ** 40n) {
    return price.toString();
  }

  const whole = abs / scale;
  const fractional = abs % scale;
  const sign = negative ? "-" : "";
  if (fractional === 0n) {
    return `${sign}${whole.toString()}`;
  }

  const fraction = fractional.toString().padStart(18, "0").replace(/0+$/, "");
  return `${sign}${whole.toString()}.${fraction}`;
}

function formatVotingPhase(phase: number): string {
  return phase === 0 ? "commit" : phase === 1 ? "reveal" : `phase ${phase}`;
}

function parseDecimalTokenUnits(value: string, decimals: number): bigint {
  const [wholePart, fractionalPart = ""] = value.split(".");
  if (fractionalPart.length > decimals) {
    throw new Error(`UMA threshold supports up to ${decimals} decimal places.`);
  }

  const whole = BigInt(wholePart || "0") * 10n ** BigInt(decimals);
  const fractional = fractionalPart ? BigInt(fractionalPart.padEnd(decimals, "0")) : 0n;
  return whole + fractional;
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
  const value = BigInt(`0x${word}`);
  return value >= 2n ** 255n ? value - 2n ** 256n : value;
}

function getTopic(log: EthereumLog, index: number): string | null {
  const topic = log.topics[index];
  return typeof topic === "string" && /^0x[0-9a-fA-F]{64}$/.test(topic) ? topic : null;
}

function parseAddressTopic(topic: string): string {
  const normalized = stripHexPrefix(topic);
  return `0x${normalized.slice(-40)}`;
}

function parseHexQuantity(value: string): number {
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

function normalizeHex(value: string): string {
  return `0x${stripHexPrefix(value).toLowerCase()}`;
}

function getIntegerSetting(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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

function isInvalidBlockRangeError(error: unknown): boolean {
  const message = formatError(error).toLowerCase();
  return message.includes("block range") && (message.includes("invalid") || message.includes("too large"));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function keccakTopic(signature: string): string {
  return `0x${Buffer.from(keccak_256(Buffer.from(signature, "utf8"))).toString("hex")}`;
}

function functionSelector(signature: string): string {
  return `0x${Buffer.from(keccak_256(Buffer.from(signature, "utf8"))).toString("hex").slice(0, 8)}`;
}

function compareRevealEventsDescending(left: UmaVoteRevealEvent, right: UmaVoteRevealEvent): number {
  if (left.blockNumber !== right.blockNumber) {
    return right.blockNumber - left.blockNumber;
  }

  if (left.logIndex !== right.logIndex) {
    return right.logIndex - left.logIndex;
  }

  return right.transactionHash.localeCompare(left.transactionHash);
}

function compareRevealPostsDescending(left: EventMonitorPost, right: EventMonitorPost): number {
  const [leftTransactionHash, leftLogIndex] = left.id.split(":");
  const [rightTransactionHash, rightLogIndex] = right.id.split(":");
  const leftBlock = Number(left.hiddenFields?.find((field) => field.name === "Block")?.value ?? 0);
  const rightBlock = Number(right.hiddenFields?.find((field) => field.name === "Block")?.value ?? 0);
  if (leftBlock !== rightBlock) {
    return rightBlock - leftBlock;
  }

  const leftIndex = Number(leftLogIndex ?? 0);
  const rightIndex = Number(rightLogIndex ?? 0);
  if (leftIndex !== rightIndex) {
    return rightIndex - leftIndex;
  }

  return (rightTransactionHash ?? "").localeCompare(leftTransactionHash ?? "");
}

function isUmaVoteRevealEvent(event: UmaVoteRevealEvent | null): event is UmaVoteRevealEvent {
  return event !== null;
}

function formatPlural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function truncateFieldValue(value: string, maxLength = 1000): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function truncateLine(value: string, maxLength = 180): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 3)}...`;
}
