import { describe, expect, it } from "vitest";
import {
  anchorAccountDiscriminator,
  base58Encode,
  countPositiveFundingRecords,
  formatMetaDaoCredibleFundraiseValue,
  parseMetaDaoLaunchAccount
} from "../src/integrations/metadaoCredibleFundraise.js";

describe("MetaDAO Credible fundraise adapter", () => {
  it("parses the Launch account totals from Anchor account data", () => {
    const baseMint = publicKeyBytes(7);
    const quoteMint = publicKeyBytes(9);
    const launchData = Buffer.concat([
      anchorAccountDiscriminator("Launch"),
      u8(255),
      u64(2_000_000_000_000n),
      u64(250_000_000_000n),
      u32(0),
      publicKeyBytes(1),
      publicKeyBytes(2),
      u8(254),
      publicKeyBytes(3),
      publicKeyBytes(4),
      baseMint,
      quoteMint,
      optionalI64(1_720_000_000n),
      optionalI64(null),
      u64(1_234_567_890_000n),
      u8(1)
    ]);

    const parsed = parseMetaDaoLaunchAccount(
      launchData,
      {
        label: "v0.7",
        programId: "test-program",
        hasFinalRaiseAmountBeforeState: false
      },
      "test-launch"
    );

    expect(parsed).toMatchObject({
      launchAddress: "test-launch",
      baseMint: base58Encode(baseMint),
      quoteMint: base58Encode(quoteMint),
      minimumRaiseAmount: 2_000_000_000_000n,
      totalCommittedAmount: 1_234_567_890_000n,
      state: "Live",
      closedAt: null
    });
    expect(parsed.startedAt?.toISOString()).toBe("2024-07-03T09:46:40.000Z");
  });

  it("counts only funding records with a positive committed amount", () => {
    const launch = publicKeyBytes(5);
    const accounts = [fundingRecordAccount(launch, 100_000_000n), fundingRecordAccount(launch, 0n), fundingRecordAccount(launch, 1n)];

    expect(countPositiveFundingRecords(accounts)).toBe(2);
  });

  it("formats the Discord value around committed total and contributors", () => {
    const value = formatMetaDaoCredibleFundraiseValue({
      programLabel: "v0.7",
      programId: "test-program",
      launchAddress: "test-launch",
      baseMint: "test-base",
      quoteMint: "test-quote",
      minimumRaiseAmount: 2_000_000_000_000n,
      totalCommittedAmount: 1_234_567_890_000n,
      contributorCount: 42,
      state: "Live",
      startedAt: new Date("2026-07-11T17:00:00.000Z"),
      closedAt: null
    });

    expect(value).toContain("Total committed: $1,234,567.89");
    expect(value).toContain("Contributors: 42");
    expect(value).toContain("Progress to minimum: 61.73%");
    expect(value).toContain("Status: Live");
  });
});

function fundingRecordAccount(launch: Buffer, committedAmount: bigint) {
  const data = Buffer.concat([
    anchorAccountDiscriminator("FundingRecord"),
    u8(255),
    publicKeyBytes(4),
    launch,
    u64(committedAmount),
    u8(0),
    u8(0),
    u64(0n),
    u128(0n),
    i64(0n)
  ]);

  return {
    pubkey: base58Encode(publicKeyBytes(Number(committedAmount % 255n))),
    account: {
      data: [data.toString("base64"), "base64"] as [string, string]
    }
  };
}

function publicKeyBytes(fill: number): Buffer {
  return Buffer.alloc(32, fill);
}

function u8(value: number): Buffer {
  return Buffer.from([value]);
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function u64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
}

function i64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(value);
  return buffer;
}

function u128(value: bigint): Buffer {
  const buffer = Buffer.alloc(16);
  buffer.writeBigUInt64LE(value & ((1n << 64n) - 1n), 0);
  buffer.writeBigUInt64LE(value >> 64n, 8);
  return buffer;
}

function optionalI64(value: bigint | null): Buffer {
  return value === null ? u8(0) : Buffer.concat([u8(1), i64(value)]);
}
