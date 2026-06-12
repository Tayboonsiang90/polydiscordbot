import { keccak_256 } from "@noble/hashes/sha3";
import { fetchWithTimeout } from "../http.js";
import {
  advanceLastScannedBlock,
  formatEthGetLogsBackfillMode,
  getEthGetLogsChunkBlocks,
  planEthGetLogsScan
} from "../rpcProviders.js";
import { parseSettingsJson, stringifySettingsJson } from "../settingsJson.js";
import { formatUmaTokenAmount, parseUmaRevealThresholdWei } from "./umaVoteReveals.js";
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
const defaultUmaCommitThresholdWei = "100000000000000000000000";
const voteCommittedEventSignature = "VoteCommitted(address,address,uint32,bytes32,uint256,bytes)";
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
const defaultInitialLookbackBlocks = 20;
const defaultMaxScanBlocksPerRun = 7_200;
const maxScanBlocksPerRunLimit = 50_000;
const maxStoredCommitKeys = 1_000;
const githubRoundRefs = ["voting-committee-1", "main"];
const roundAnswersCache = new Map<string, Map<string, UmaVotingRoundAnswer>>();

export const voteCommittedTopic = keccakTopic(voteCommittedEventSignature);

export type UmaVoteCommitSettings = {
  rpcUrl?: string;
  rpcUrls?: string;
  lastRpcUrl?: string;
  lastScannedBlock?: number;
  confirmations?: number;
  initialLookbackBlocks?: number;
  maxScanBlocksPerRun?: number;
  umaCommitThresholdWei?: string;
  umaCommitSeenKeys?: Array<{ key: string; count: number }>;
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

export type UmaVoteCommitEvent = {
  id: string;
  voter: string;
  caller: string;
  roundId: number;
  identifier: string;
  requestTime: number;
  ancillaryDataHex: string;
  ancillaryDataText: string;
  blockNumber: number;
  blockTimestamp?: number;
  transactionHash: string;
  logIndex: number;
  commitKey: string;
  previousCommitCount: number;
};

type UmaVotingRoundAnswer = {
  ancillaryData: string;
  timestamp: number;
  question: string;
  answer?: string;
};

type UmaVoteCommitPostItem = {
  event: UmaVoteCommitEvent;
  stakeWei: bigint;
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

export const umaVoteCommitsAdapter: WebsiteAdapter = {
  id: "uma-vote-commits",
  commandName: "umacommits",
  displayName: "UMA Vote Commits",
  sourceUrl,
  defaultChannelName: "uma-commits",
  alertRoleName: "UMA Commit Alerts",
  alertRoleEmoji: "\uD83D\uDD12",
  defaultSettings: {
    umaCommitThresholdWei: defaultUmaCommitThresholdWei
  },
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "Ethereum log polling for large UMA Voting v2 commit and recommit events",
  getErrorNoticeWindowMinutes: () => 60,
  maxEventPostAgeMinutes: 10,
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    if (!integration) {
      throw new Error("UMA Vote Commits requires an integration record");
    }

    const result = await this.fetchEventUpdates!(integration);
    const latest = result.posts[0];
    const value = latest ? `${latest.type}\n${latest.text}` : "no large UMA vote commits found in scanned blocks";
    return {
      value,
      rawValue: latest?.id ?? "no-commits",
      observedAt: result.observedAt
    };
  },
  async fetchEventUpdates(integration: Integration): Promise<EventMonitorResult> {
    const observedAt = new Date();
    const settings = parseUmaVoteCommitSettings(integration.settingsJson);
    const thresholdWei = getUmaCommitThresholdWei(settings);
    const rpcUrls = getEthereumRpcUrls(settings);
    const latestBlockResponse = await fetchLatestBlockNumber(rpcUrls, settings.lastRpcUrl);
    const confirmations = getIntegerSetting(settings.confirmations, defaultConfirmations, 0, 128);
    const confirmedLatestBlock = Math.max(0, latestBlockResponse.result - confirmations);
    const maxScanBlocks = getIntegerSetting(settings.maxScanBlocksPerRun, defaultMaxScanBlocksPerRun, 1, maxScanBlocksPerRunLimit);
    const scanPlan = planEthGetLogsScan(
      latestBlockResponse.rpcUrl,
      getNextFromBlock(settings, confirmedLatestBlock),
      confirmedLatestBlock,
      maxScanBlocks
    );
    const fromBlock = scanPlan.fromBlock;
    const toBlock = scanPlan.toBlock;
    const logResponse =
      fromBlock <= toBlock
        ? await fetchVoteCommitLogs(rpcUrls, fromBlock, toBlock, latestBlockResponse.rpcUrl)
        : { result: [], rpcUrl: latestBlockResponse.rpcUrl };
    const votingStatus = await fetchVotingStatus(rpcUrls, logResponse.rpcUrl).catch(() => null);
    const seenCommitKeys = commitSeenEntriesToMap(settings.umaCommitSeenKeys ?? []);
    const decodedEvents = logResponse.result
      .map((log) => decodeUmaVoteCommitLog(log, seenCommitKeys))
      .filter(isUmaVoteCommitEvent)
      .sort(compareCommitEventsAscending);
    const posts = await normalizeUmaVoteCommitPosts(decodedEvents, thresholdWei, rpcUrls, logResponse.rpcUrl);

    return {
      posts,
      strikeTerms: [],
      observedAt,
      settingsJson: stringifySettingsJson({
        ...parseSettingsJson(integration.settingsJson),
        umaCommitThresholdWei: thresholdWei.toString(),
        umaCommitSeenKeys: commitSeenMapToEntries(seenCommitKeys),
        lastScannedBlock: advanceLastScannedBlock(settings.lastScannedBlock, toBlock),
        lastScanRequestedFromBlock: scanPlan.skippedToLiveHead ? scanPlan.requestedFromBlock : undefined,
        lastRpcUrl: logResponse.rpcUrl
      }),
      checkTitle: "UMA commit check complete",
      checkFields: buildCheckFields({
        thresholdWei,
        fromBlock,
        toBlock,
        latestBlock: latestBlockResponse.result,
        confirmedLatestBlock,
        logsScanned: decodedEvents.length,
        matchingCommits: posts.length,
        recommits: posts.filter((post) => post.type === "UMA vote recommit").length,
        votingStatus,
        backfillMode: formatEthGetLogsBackfillMode(scanPlan)
      })
    };
  },
  updateThreshold(integration: Integration, thresholdQuery?: string): ThresholdUpdateResult {
    const settings = parseSettingsJson(integration.settingsJson);
    const previousThresholdWei = getUmaCommitThresholdWei(parseUmaVoteCommitSettings(integration.settingsJson));
    if (!thresholdQuery) {
      return {
        changed: false,
        message: "Current threshold returned. Provide `value` to change it.",
        thresholdLabel: "Minimum voter stake",
        thresholdValue: `${formatUmaTokenAmount(previousThresholdWei)} UMA`,
        settingsJson: stringifySettingsJson({
          ...settings,
          umaCommitThresholdWei: previousThresholdWei.toString()
        })
      };
    }

    const nextThresholdWei = parseUmaRevealThresholdWei(thresholdQuery);
    const settingsJson = stringifySettingsJson({
      ...settings,
      umaCommitThresholdWei: nextThresholdWei.toString()
    });
    return {
      changed: nextThresholdWei !== previousThresholdWei,
      message: `Future commit alerts will only fire for voters staked at or above ${formatUmaTokenAmount(nextThresholdWei)} UMA.`,
      thresholdLabel: "Minimum voter stake",
      thresholdValue: `${formatUmaTokenAmount(nextThresholdWei)} UMA`,
      settingsJson
    };
  }
};

export function parseUmaVoteCommitSettings(settingsJson: string | null): UmaVoteCommitSettings {
  const settings = parseSettingsJson(settingsJson);
  return {
    rpcUrl: typeof settings.rpcUrl === "string" ? settings.rpcUrl : undefined,
    rpcUrls: typeof settings.rpcUrls === "string" ? settings.rpcUrls : undefined,
    lastRpcUrl: typeof settings.lastRpcUrl === "string" ? settings.lastRpcUrl : undefined,
    lastScannedBlock: isSafeNonNegativeInteger(settings.lastScannedBlock) ? settings.lastScannedBlock : undefined,
    confirmations: typeof settings.confirmations === "number" ? settings.confirmations : undefined,
    initialLookbackBlocks: typeof settings.initialLookbackBlocks === "number" ? settings.initialLookbackBlocks : undefined,
    maxScanBlocksPerRun: typeof settings.maxScanBlocksPerRun === "number" ? settings.maxScanBlocksPerRun : undefined,
    umaCommitThresholdWei: typeof settings.umaCommitThresholdWei === "string" ? settings.umaCommitThresholdWei : undefined,
    umaCommitSeenKeys: parseCommitSeenEntries(settings.umaCommitSeenKeys)
  };
}

export function decodeUmaVoteCommitLog(log: EthereumLog, seenCommitKeys = new Map<string, number>()): UmaVoteCommitEvent | null {
  if (log.address.toLowerCase() !== votingV2AddressLower || log.topics[0]?.toLowerCase() !== voteCommittedTopic) {
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
  const ancillaryDataBytes = decodeAbiBytesAt(hex, ancillaryDataOffset * 2);
  const blockNumber = parseHexQuantity(log.blockNumber);
  const blockTimestamp = log.blockTimestamp ? parseHexQuantity(log.blockTimestamp) : undefined;
  const logIndex = parseHexQuantity(log.logIndex);
  const voter = parseAddressTopic(voterTopic);
  const ancillaryDataHex = `0x${Buffer.from(ancillaryDataBytes).toString("hex")}`;
  const commitKey = buildCommitKey({ voter, roundId, identifier: identifierTopic, requestTime, ancillaryDataHex });
  const previousCommitCount = seenCommitKeys.get(commitKey) ?? 0;
  seenCommitKeys.set(commitKey, previousCommitCount + 1);

  return {
    id: `${log.transactionHash.toLowerCase()}:${log.logIndex.toLowerCase()}`,
    voter,
    caller: parseAddressTopic(callerTopic),
    roundId,
    identifier: identifierTopic,
    requestTime,
    ancillaryDataHex,
    ancillaryDataText: Buffer.from(ancillaryDataBytes).toString("utf8"),
    blockNumber,
    blockTimestamp,
    transactionHash: log.transactionHash.toLowerCase(),
    logIndex,
    commitKey,
    previousCommitCount
  };
}

export function normalizeUmaVoteCommitPost(
  event: UmaVoteCommitEvent,
  stakeWei: bigint,
  thresholdWei: bigint,
  postedAt: Date,
  roundAnswer?: UmaVotingRoundAnswer
): EventMonitorPost {
  const transactionUrl = `https://etherscan.io/tx/${event.transactionHash}`;
  const stake = `${formatUmaTokenAmount(stakeWei)} UMA`;
  const isRecommit = event.previousCommitCount > 0;
  const question = roundAnswer?.question;
  const title = isRecommit ? "Large UMA vote recommit" : "Large UMA vote commit";
  const type = isRecommit ? "UMA vote recommit" : "UMA vote commit";
  const text = [
    question,
    `${event.voter} ${isRecommit ? "recommitted" : "committed"} with estimated stake ${stake} in round ${event.roundId}.`
  ].filter(Boolean).join("\n");

  return {
    id: event.id,
    type,
    alertTitle: title,
    sourceLabel: "Ethereum tx",
    buttonLabel: "Open transaction",
    mentionAlertRole: true,
    textFieldName: "Commit",
    text,
    qualifyingText: text,
    postedAt,
    url: transactionUrl,
    hideLinksField: true,
    hideTextField: true,
    summaryFields: [
      ...(question ? [{ name: "Question", value: question, inline: false }] : []),
      { name: "Commit type", value: isRecommit ? `Recommit #${event.previousCommitCount + 1}` : "Initial commit", inline: true },
      { name: "Estimated stake", value: stake, inline: true },
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
      { name: "Commit key", value: event.commitKey, inline: false },
      { name: "Raw estimated stake", value: stakeWei.toString(), inline: false },
      { name: "Ancillary data", value: event.ancillaryDataText || event.ancillaryDataHex, inline: false },
      { name: "Ancillary data hex", value: event.ancillaryDataHex, inline: false }
    ],
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

async function normalizeUmaVoteCommitPosts(
  events: UmaVoteCommitEvent[],
  thresholdWei: bigint,
  rpcUrls: string[],
  preferredRpcUrl?: string
): Promise<EventMonitorPost[]> {
  const blockTimestamps = new Map<number, number>();
  const stakeCache = new Map<string, bigint>();
  const answerMaps = new Map<number, Map<string, UmaVotingRoundAnswer>>();
  const itemsByVoter = new Map<string, UmaVoteCommitPostItem[]>();

  for (const event of events) {
    const stakeCacheKey = `${event.voter}:${event.blockNumber}`;
    const stakeWei =
      stakeCache.get(stakeCacheKey) ??
      (await fetchVoterStakeAtBlock(rpcUrls, event.voter, event.blockNumber, preferredRpcUrl).catch(() =>
        fetchVoterStakeAtBlock(rpcUrls, event.voter, "latest", preferredRpcUrl)
      ));
    stakeCache.set(stakeCacheKey, stakeWei);
    if (stakeWei < thresholdWei) {
      continue;
    }

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
      stakeWei,
      postedAt: new Date(timestamp * 1000),
      roundAnswer: answerMap.get(roundAnswerKey(event))
    });
    itemsByVoter.set(voterKey, items);
  }

  const posts = [...itemsByVoter.values()].map((items) => normalizeUmaVoteCommitPostGroup(items, thresholdWei));
  return posts.sort(compareCommitPostsDescending);
}

function normalizeUmaVoteCommitPostGroup(items: UmaVoteCommitPostItem[], thresholdWei: bigint): EventMonitorPost {
  const sortedItems = [...items].sort((left, right) => compareCommitEventsDescending(left.event, right.event));
  const latest = sortedItems[0]!;
  const event = latest.event;
  const transactionUrl = `https://etherscan.io/tx/${event.transactionHash}`;
  const recommitCount = sortedItems.filter((item) => item.event.previousCommitCount > 0).length;
  const stakeValues = uniqueStrings(sortedItems.map((item) => `${formatUmaTokenAmount(item.stakeWei)} UMA`));
  const rounds = uniqueStrings(sortedItems.map((item) => String(item.event.roundId)));
  const commitLines = sortedItems.map(formatCommitGroupLine);
  const title =
    sortedItems.length === 1
      ? recommitCount > 0
        ? "Large UMA vote recommit"
        : "Large UMA vote commit"
      : recommitCount > 0
        ? "Large UMA vote commits/recommits"
        : "Large UMA vote commits";
  const type =
    sortedItems.length === 1
      ? recommitCount > 0
        ? "UMA vote recommit"
        : "UMA vote commit"
      : recommitCount > 0
        ? "UMA vote commits/recommits"
        : "UMA vote commits";
  const text = `${event.voter} committed ${formatPlural(sortedItems.length, "request")} above threshold in ${formatPlural(rounds.length, "round")}.`;

  return {
    id: event.id,
    type,
    alertTitle: title,
    sourceLabel: "Ethereum tx",
    buttonLabel: "Open latest transaction",
    mentionAlertRole: true,
    textFieldName: "Commits",
    text,
    qualifyingText: text,
    postedAt: latest.postedAt,
    url: transactionUrl,
    hideLinksField: true,
    hideTextField: true,
    summaryFields: [
      { name: "Voter", value: event.voter, inline: false },
      { name: "Commit count", value: String(sortedItems.length), inline: true },
      { name: "Recommits", value: String(recommitCount), inline: true },
      { name: stakeValues.length === 1 ? "Estimated stake" : "Estimated stakes", value: truncateFieldValue(stakeValues.join("\n")), inline: true },
      { name: "Rounds", value: rounds.join(", "), inline: true },
      { name: "Threshold", value: `${formatUmaTokenAmount(thresholdWei)} UMA`, inline: true }
    ],
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

function formatCommitGroupLine(item: UmaVoteCommitPostItem, index: number): string {
  const question = item.roundAnswer?.question ?? `request ${item.event.requestTime}`;
  const commitType = item.event.previousCommitCount > 0 ? `recommit #${item.event.previousCommitCount + 1}` : "initial";
  return `${index + 1}. ${truncateLine(question)} -> ${commitType}`;
}

async function fetchVoterStakeAtBlock(
  rpcUrls: string[],
  voter: string,
  blockTag: number | "latest",
  preferredRpcUrl?: string
): Promise<bigint> {
  const response = await ethereumRpc<string>(
    rpcUrls,
    "eth_call",
    [
      { to: votingV2Address, data: `${functionSelector("getVoterStakePostUpdate(address)")}${encodeAddress(voter)}` },
      blockTag === "latest" ? "latest" : toHexQuantity(blockTag)
    ],
    preferredRpcUrl
  );
  return BigInt(response.result);
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

function roundAnswerKey(event: UmaVoteCommitEvent): string {
  return `${normalizeHex(event.ancillaryDataHex)}:${event.requestTime}`;
}

function buildCheckFields(input: {
  thresholdWei: bigint;
  fromBlock: number;
  toBlock: number;
  latestBlock: number;
  confirmedLatestBlock: number;
  logsScanned: number;
  matchingCommits: number;
  recommits: number;
  votingStatus: { roundId: number; phase: number } | null;
  backfillMode?: string;
}): Array<{ name: string; value: string; inline?: boolean }> {
  return [
    { name: "Minimum voter stake", value: `${formatUmaTokenAmount(input.thresholdWei)} UMA`, inline: true },
    {
      name: "Current voting cycle",
      value: input.votingStatus ? `Round ${input.votingStatus.roundId} - ${formatVotingPhase(input.votingStatus.phase)}` : "unavailable",
      inline: true
    },
    { name: "Blocks scanned", value: `${input.fromBlock} to ${input.toBlock}`, inline: false },
    ...(input.backfillMode ? [{ name: "Backfill mode", value: input.backfillMode, inline: false }] : []),
    { name: "Latest block", value: `${input.latestBlock} (${input.confirmedLatestBlock} confirmed)`, inline: true },
    { name: "Commit logs scanned", value: String(input.logsScanned), inline: true },
    { name: "Matching commits", value: `${input.matchingCommits} (${input.recommits} recommit)`, inline: true }
  ];
}

async function fetchLatestBlockNumber(rpcUrls: string[], preferredRpcUrl?: string): Promise<RpcResult<number>> {
  const response = await ethereumRpc<string>(rpcUrls, "eth_blockNumber", [], preferredRpcUrl);
  return { result: parseHexQuantity(response.result), rpcUrl: response.rpcUrl };
}

async function fetchVoteCommitLogs(
  rpcUrls: string[],
  fromBlock: number,
  toBlock: number,
  preferredRpcUrl?: string
): Promise<RpcResult<EthereumLog[]>> {
  const logs: EthereumLog[] = [];
  let activeRpcUrl = preferredRpcUrl;
  const chunkBlocks = getEthGetLogsChunkBlocks(activeRpcUrl ?? rpcUrls[0], rpcLogChunkBlocks);
  for (let chunkFrom = fromBlock; chunkFrom <= toBlock; chunkFrom += chunkBlocks) {
    const chunkTo = Math.min(toBlock, chunkFrom + chunkBlocks - 1);
    const response = await fetchVoteCommitLogRange(rpcUrls, chunkFrom, chunkTo, activeRpcUrl);
    activeRpcUrl = response.rpcUrl;
    logs.push(...response.result);
  }
  return { result: logs, rpcUrl: activeRpcUrl ?? rpcUrls[0] };
}

async function fetchVoteCommitLogRange(
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
          topics: [voteCommittedTopic]
        }
      ],
      preferredRpcUrl
    );
  } catch (error) {
    if (!isInvalidBlockRangeError(error) || fromBlock >= toBlock) {
      throw error;
    }

    const midBlock = Math.floor((fromBlock + toBlock) / 2);
    const first = await fetchVoteCommitLogRange(rpcUrls, fromBlock, midBlock, preferredRpcUrl);
    const second = await fetchVoteCommitLogRange(rpcUrls, midBlock + 1, toBlock, first.rpcUrl);
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

function getEthereumRpcUrls(settings: UmaVoteCommitSettings): string[] {
  const configured = [
    ...splitRpcUrls(settings.rpcUrls),
    ...splitRpcUrls(settings.rpcUrl),
    ...splitRpcUrls(process.env.ETHEREUM_RPC_URLS),
    ...splitRpcUrls(process.env.ETHEREUM_RPC_URL)
  ];
  return uniqueStrings(configured.length > 0 ? [...configured, ...defaultEthereumRpcUrls] : defaultEthereumRpcUrls);
}

function getUmaCommitThresholdWei(settings: UmaVoteCommitSettings): bigint {
  try {
    const value = BigInt(settings.umaCommitThresholdWei ?? defaultUmaCommitThresholdWei);
    return value > 0n ? value : BigInt(defaultUmaCommitThresholdWei);
  } catch {
    return BigInt(defaultUmaCommitThresholdWei);
  }
}

function getNextFromBlock(settings: UmaVoteCommitSettings, confirmedLatestBlock: number): number {
  if (isSafeNonNegativeInteger(settings.lastScannedBlock)) {
    return settings.lastScannedBlock + 1;
  }

  const lookbackBlocks = getIntegerSetting(settings.initialLookbackBlocks, defaultInitialLookbackBlocks, 1, maxScanBlocksPerRunLimit);
  return Math.max(0, confirmedLatestBlock - lookbackBlocks + 1);
}

function buildCommitKey(input: { voter: string; roundId: number; identifier: string; requestTime: number; ancillaryDataHex: string }): string {
  return Buffer.from(
    keccak_256(Buffer.from(`${input.voter.toLowerCase()}:${input.roundId}:${input.identifier}:${input.requestTime}:${normalizeHex(input.ancillaryDataHex)}`))
  ).toString("hex");
}

function parseCommitSeenEntries(value: unknown): Array<{ key: string; count: number }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const candidate = entry as { key?: unknown; count?: unknown };
      return typeof candidate.key === "string" && typeof candidate.count === "number" && candidate.count > 0
        ? { key: candidate.key, count: Math.floor(candidate.count) }
        : null;
    })
    .filter((entry): entry is { key: string; count: number } => entry !== null);
}

function commitSeenEntriesToMap(entries: Array<{ key: string; count: number }>): Map<string, number> {
  return new Map(entries.map((entry) => [entry.key, entry.count]));
}

function commitSeenMapToEntries(map: Map<string, number>): Array<{ key: string; count: number }> {
  return [...map.entries()]
    .slice(-maxStoredCommitKeys)
    .map(([key, count]) => ({ key, count }));
}

function formatVotingPhase(phase: number): string {
  return phase === 0 ? "commit" : phase === 1 ? "reveal" : `phase ${phase}`;
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

function encodeAddress(address: string): string {
  const normalized = stripHexPrefix(address).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`Invalid EVM address: ${address}`);
  }
  return normalized.padStart(64, "0");
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

function compareCommitEventsAscending(left: UmaVoteCommitEvent, right: UmaVoteCommitEvent): number {
  if (left.blockNumber !== right.blockNumber) {
    return left.blockNumber - right.blockNumber;
  }
  return left.logIndex - right.logIndex;
}

function compareCommitEventsDescending(left: UmaVoteCommitEvent, right: UmaVoteCommitEvent): number {
  if (left.blockNumber !== right.blockNumber) {
    return right.blockNumber - left.blockNumber;
  }
  return right.logIndex - left.logIndex;
}

function compareCommitPostsDescending(left: EventMonitorPost, right: EventMonitorPost): number {
  const [leftTransactionHash, leftLogIndex] = left.id.split(":");
  const [rightTransactionHash, rightLogIndex] = right.id.split(":");
  const leftBlock = Number(left.hiddenFields?.find((field) => field.name === "Block")?.value ?? 0);
  const rightBlock = Number(right.hiddenFields?.find((field) => field.name === "Block")?.value ?? 0);
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

function isUmaVoteCommitEvent(event: UmaVoteCommitEvent | null): event is UmaVoteCommitEvent {
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
