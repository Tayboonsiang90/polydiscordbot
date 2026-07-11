import { createHash } from "node:crypto";
import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.metadao.fi/projects/credible/fundraise";
const defaultPolymarketUrl = "https://polymarket.com/event/total-commitments-for-the-credible-public-sale-on-metadao-20260708134325640";
const credibleBaseMint = "CREDBHvVqREBCAxMihzr8D1nepHMr2gmQoZWpmgGmeta";
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const rpcTimeoutMs = 20_000;
const usdcDecimals = 6n;
const usdcScale = 10n ** usdcDecimals;

const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

type LaunchpadProgramConfig = {
  label: string;
  programId: string;
  hasFinalRaiseAmountBeforeState: boolean;
};

const launchpadPrograms: LaunchpadProgramConfig[] = [
  {
    label: "v0.8",
    programId: "moonDJUoHteKkGATejA5bdJVwJ6V6Dg74gyqyJTx73n",
    hasFinalRaiseAmountBeforeState: false
  },
  {
    label: "v0.7",
    programId: "moontUzsdepotRGe5xsfip7vLPTJnVuafqdUWexVnPM",
    hasFinalRaiseAmountBeforeState: false
  },
  {
    label: "v0.6",
    programId: "MooNyh4CBUYEKyXVnjGYQ8mEiJDpGvJMdvrZx1iGeHV",
    hasFinalRaiseAmountBeforeState: true
  }
];

const launchStateLabels = ["Initialized", "Live", "Closed", "Complete", "Refunding"] as const;

type RpcProgramAccount = {
  pubkey: string;
  account: {
    data: string | [string, string];
  };
};

type SolanaRpcResponse<T> = {
  result?: T;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

export type MetaDaoLaunchSnapshot = {
  programLabel: string;
  programId: string;
  launchAddress: string;
  baseMint: string;
  quoteMint: string;
  minimumRaiseAmount: bigint;
  totalCommittedAmount: bigint;
  contributorCount: number;
  state: string;
  startedAt: Date | null;
  closedAt: Date | null;
};

export const metadaoCredibleFundraiseAdapter: WebsiteAdapter = {
  id: "metadao-credible-fundraise",
  commandName: "metadao",
  displayName: "MetaDAO Credible Fundraise",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "metadao-credible",
  alertRoleName: "MetaDAO Credible Alerts",
  alertRoleEmoji: "\uD83C\uDFDB\uFE0F",
  getPollIntervalMinutes: () => 60,
  getPollIntervalReason: () => "Fixed hourly check for MetaDAO Credible committed amount and contributor count",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const observedAt = new Date();
    const snapshot = await fetchCredibleFundraiseSnapshot();
    const value = formatMetaDaoCredibleFundraiseValue(snapshot);

    return {
      value,
      rawValue: value,
      unit: "fundraise committed amount",
      observedAt
    };
  }
};

export async function fetchCredibleFundraiseSnapshot(): Promise<MetaDaoLaunchSnapshot> {
  const launch = await findLaunchByBaseMint(credibleBaseMint);
  if (!launch) {
    return {
      programLabel: "not found",
      programId: "not found",
      launchAddress: "not initialized yet",
      baseMint: credibleBaseMint,
      quoteMint: usdcMint,
      minimumRaiseAmount: 2_000_000n * usdcScale,
      totalCommittedAmount: 0n,
      contributorCount: 0,
      state: "Not initialized on-chain",
      startedAt: null,
      closedAt: null
    };
  }

  const contributorCount = await countLaunchContributors(launch.program, launch.launchAddress);
  return {
    ...launch,
    contributorCount
  };
}

export function formatMetaDaoCredibleFundraiseValue(snapshot: MetaDaoLaunchSnapshot): string {
  const progress =
    snapshot.minimumRaiseAmount > 0n
      ? (Number(snapshot.totalCommittedAmount) / Number(snapshot.minimumRaiseAmount)) * 100
      : null;

  return [
    "Metric: MetaDAO Credible public sale",
    `Total committed: ${formatUsdc(snapshot.totalCommittedAmount)}`,
    `Contributors: ${formatInteger(snapshot.contributorCount)}`,
    `Status: ${snapshot.state}`,
    `Minimum raise: ${formatUsdc(snapshot.minimumRaiseAmount)}`,
    `Progress to minimum: ${progress === null ? "unknown" : `${formatDecimal(progress, 2)}%`}`,
    `Started at: ${formatDateOrNotStarted(snapshot.startedAt)}`,
    `Closed at: ${formatDateOrNotStarted(snapshot.closedAt)}`,
    `Launch account: ${snapshot.launchAddress}`,
    `Launchpad program: ${snapshot.programLabel} ${snapshot.programId}`,
    `Base mint: ${snapshot.baseMint}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function parseMetaDaoLaunchAccount(
  data: Buffer,
  program: LaunchpadProgramConfig,
  launchAddress: string
): Omit<MetaDaoLaunchSnapshot, "contributorCount"> {
  assertDiscriminator(data, "Launch");
  let offset = 8;
  offset += 1;
  const minimumRaiseAmount = readU64(data, offset);
  offset += 8;
  offset += 8;

  const monthlySpendingMemberCount = readU32(data, offset);
  offset += 4 + monthlySpendingMemberCount * 32;
  offset += 32;
  offset += 32;
  offset += 1;
  offset += 32;
  offset += 32;

  const baseMint = readPublicKey(data, offset);
  offset += 32;
  const quoteMint = readPublicKey(data, offset);
  offset += 32;
  const started = readOptionalI64(data, offset);
  offset = started.nextOffset;
  const closed = readOptionalI64(data, offset);
  offset = closed.nextOffset;
  const totalCommittedAmount = readU64(data, offset);
  offset += 8;
  if (program.hasFinalRaiseAmountBeforeState) {
    offset = skipOptionalU64(data, offset);
  }

  const stateIndex = readU8(data, offset);

  return {
    programLabel: program.label,
    programId: program.programId,
    launchAddress,
    baseMint,
    quoteMint,
    minimumRaiseAmount,
    totalCommittedAmount,
    state: launchStateLabels[stateIndex] ?? `Unknown (${stateIndex})`,
    startedAt: unixSecondsToDate(started.value),
    closedAt: unixSecondsToDate(closed.value)
  };
}

export function parseFundingRecordCommittedAmount(data: Buffer): bigint {
  assertDiscriminator(data, "FundingRecord");
  return readU64(data, 73);
}

export function countPositiveFundingRecords(accounts: RpcProgramAccount[]): number {
  return accounts.reduce((count, account) => {
    try {
      return parseFundingRecordCommittedAmount(getProgramAccountData(account)) > 0n ? count + 1 : count;
    } catch {
      return count;
    }
  }, 0);
}

export function anchorAccountDiscriminator(accountName: string): Buffer {
  return createHash("sha256").update(`account:${accountName}`).digest().subarray(0, 8);
}

export function base58Encode(data: Uint8Array): string {
  let value = BigInt(`0x${Buffer.from(data).toString("hex") || "0"}`);
  let encoded = "";
  while (value > 0n) {
    const remainder = value % 58n;
    encoded = base58Alphabet[Number(remainder)] + encoded;
    value /= 58n;
  }

  for (const byte of data) {
    if (byte !== 0) {
      break;
    }
    encoded = `1${encoded}`;
  }

  return encoded || "1";
}

async function findLaunchByBaseMint(baseMint: string): Promise<(Omit<MetaDaoLaunchSnapshot, "contributorCount"> & { program: LaunchpadProgramConfig }) | null> {
  const errors: string[] = [];
  for (const program of launchpadPrograms) {
    let accounts: RpcProgramAccount[];
    try {
      accounts = await fetchProgramAccounts(program.programId, [
        { memcmp: { offset: 0, bytes: base58Encode(anchorAccountDiscriminator("Launch")) } }
      ]);
    } catch (error) {
      errors.push(`${program.label}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    for (const account of accounts) {
      try {
        const launch = parseMetaDaoLaunchAccount(getProgramAccountData(account), program, account.pubkey);
        if (launch.baseMint === baseMint) {
          return {
            ...launch,
            program
          };
        }
      } catch {
        // Ignore malformed or older account layouts that do not match the supported Launch shape.
      }
    }
  }

  if (errors.length === launchpadPrograms.length) {
    throw new Error(`Could not query any MetaDAO launchpad programs: ${errors.join("; ")}`);
  }

  return null;
}

async function countLaunchContributors(program: LaunchpadProgramConfig, launchAddress: string): Promise<number> {
  const accounts = await fetchProgramAccounts(program.programId, [
    { memcmp: { offset: 0, bytes: base58Encode(anchorAccountDiscriminator("FundingRecord")) } },
    { memcmp: { offset: 41, bytes: launchAddress } }
  ]);
  return countPositiveFundingRecords(accounts);
}

async function fetchProgramAccounts(programId: string, filters: Array<{ memcmp: { offset: number; bytes: string } }>): Promise<RpcProgramAccount[]> {
  return fetchSolanaRpc<RpcProgramAccount[]>("getProgramAccounts", [
    programId,
    {
      encoding: "base64",
      filters
    }
  ]);
}

async function fetchSolanaRpc<T>(method: string, params: unknown[]): Promise<T> {
  const errors: string[] = [];
  for (const rpcUrl of getSolanaRpcUrls()) {
    try {
      const response = await fetchWithTimeout(
        rpcUrl,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method,
            params
          })
        },
        rpcTimeoutMs
      );
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
      }

      const payload = JSON.parse(body) as SolanaRpcResponse<T>;
      if (payload.error) {
        throw new Error(`${payload.error.message ?? "RPC error"}${payload.error.code ? ` (${payload.error.code})` : ""}`);
      }
      if (payload.result === undefined) {
        throw new Error("RPC response did not include a result");
      }
      return payload.result;
    } catch (error) {
      errors.push(`${rpcUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`MetaDAO Solana RPC ${method} failed on all endpoints: ${errors.join("; ")}`);
}

function getSolanaRpcUrls(): string[] {
  return uniqueStrings([
    process.env.METADAO_SOLANA_RPC_URL?.trim(),
    process.env.SOLANA_RPC_URL?.trim(),
    "https://api.mainnet-beta.solana.com",
    "https://solana-rpc.publicnode.com"
  ]);
}

function getProgramAccountData(account: RpcProgramAccount): Buffer {
  const data = account.account.data;
  return Buffer.from(Array.isArray(data) ? data[0] : data, "base64");
}

function assertDiscriminator(data: Buffer, accountName: string): void {
  const expected = anchorAccountDiscriminator(accountName);
  if (data.length < expected.length || !data.subarray(0, expected.length).equals(expected)) {
    throw new Error(`Invalid ${accountName} account discriminator`);
  }
}

function readU8(data: Buffer, offset: number): number {
  assertReadable(data, offset, 1);
  return data.readUInt8(offset);
}

function readU32(data: Buffer, offset: number): number {
  assertReadable(data, offset, 4);
  return data.readUInt32LE(offset);
}

function readU64(data: Buffer, offset: number): bigint {
  assertReadable(data, offset, 8);
  return data.readBigUInt64LE(offset);
}

function readI64(data: Buffer, offset: number): bigint {
  assertReadable(data, offset, 8);
  return data.readBigInt64LE(offset);
}

function readPublicKey(data: Buffer, offset: number): string {
  assertReadable(data, offset, 32);
  return base58Encode(data.subarray(offset, offset + 32));
}

function readOptionalI64(data: Buffer, offset: number): { value: bigint | null; nextOffset: number } {
  const tag = readU8(data, offset);
  if (tag === 0) {
    return { value: null, nextOffset: offset + 1 };
  }
  return { value: readI64(data, offset + 1), nextOffset: offset + 9 };
}

function skipOptionalU64(data: Buffer, offset: number): number {
  const tag = readU8(data, offset);
  return offset + 1 + (tag === 0 ? 0 : 8);
}

function unixSecondsToDate(value: bigint | null): Date | null {
  return value === null ? null : new Date(Number(value) * 1000);
}

function assertReadable(data: Buffer, offset: number, length: number): void {
  if (offset < 0 || offset + length > data.length) {
    throw new Error(`Account data too short at offset ${offset}`);
  }
}

function formatUsdc(amount: bigint): string {
  const cents = (amount + 5_000n) / 10_000n;
  const dollars = cents / 100n;
  const centRemainder = cents % 100n;
  return `$${groupDigits(dollars)}.${centRemainder.toString().padStart(2, "0")}`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatDecimal(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(value);
}

function formatDateOrNotStarted(value: Date | null): string {
  return value ? value.toISOString() : "not available";
}

function groupDigits(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
