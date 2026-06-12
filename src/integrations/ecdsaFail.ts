import { fetchWithTimeout } from "../http.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.ecdsa.fail/";
const apiUrl = "https://api.ecdsa.fail/api/benchmarks";
const defaultPolymarketUrl =
  "https://polymarket.com/event/how-far-ahead-of-googles-quantum-benchmark-will-ecdsafail-get-by-june-30/will-ecdsafail-get-at-least-40-ahead-of-googles-classified-circuit-by-june-30-2026";
const googleClassifiedCircuitScore = 2_992_500_000;
const userAgent = "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1";

type EcdsaFailBenchmarksResponse = {
  benchmarks?: EcdsaFailBenchmark[];
};

type EcdsaFailBenchmark = {
  id?: unknown;
  status?: unknown;
  name?: unknown;
  sourceUrl?: unknown;
  currentBestScore?: unknown;
  currentBestMetrics?: unknown;
  baselineScore?: unknown;
  baselineMetrics?: unknown;
  updatedAt?: unknown;
};

type CircuitMetrics = {
  qubits: number;
  toffoli: number;
};

export const ecdsaFailAdapter: WebsiteAdapter = {
  id: "ecdsa-fail",
  commandName: "ecdsafail",
  displayName: "ECDSA.fail Quantum Benchmark",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "ecdsafail",
  alertRoleName: "ECDSA Fail Alerts",
  alertRoleEmoji: "\uD83D\uDD10",
  async fetchCurrentValue(): Promise<AdapterValue> {
    const response = await fetchWithTimeout(apiUrl, {
      headers: {
        accept: "application/json",
        "user-agent": userAgent
      }
    });

    if (!response.ok) {
      throw new Error(`ECDSA.fail API returned HTTP ${response.status}`);
    }

    const value = extractEcdsaFailValue((await response.json()) as EcdsaFailBenchmarksResponse);
    return {
      value,
      rawValue: extractAheadPercent(value) ?? value,
      unit: "% ahead of Google's classified circuit",
      observedAt: new Date()
    };
  }
};

export function extractEcdsaFailValue(data: EcdsaFailBenchmarksResponse): string {
  const benchmark = selectOfficialBenchmark(data.benchmarks ?? []);
  if (!benchmark) {
    throw new Error("Could not find the official ECDSA.fail challenge benchmark");
  }

  const currentBestScore = asFiniteNumber(benchmark.currentBestScore);
  if (currentBestScore === null) {
    throw new Error("ECDSA.fail benchmark does not have a current best score yet");
  }

  const baselineScore = asFiniteNumber(benchmark.baselineScore);
  const currentMetrics = parseCircuitMetrics(benchmark.currentBestMetrics);
  const baselineMetrics = parseCircuitMetrics(benchmark.baselineMetrics);
  const aheadPercent = calculateGoogleAheadPercent(currentBestScore);

  return [
    "Metric: ECDSA.fail quantum benchmark progress",
    `Google classified circuit score: ${formatInteger(googleClassifiedCircuitScore)}`,
    `Current best score: ${formatInteger(currentBestScore)}`,
    `Ahead of Google: ${formatPercent(aheadPercent)}`,
    `Current best metrics: ${formatCircuitMetrics(currentMetrics)}`,
    `Baseline score: ${baselineScore === null ? "unknown" : formatInteger(baselineScore)}`,
    `Baseline metrics: ${formatCircuitMetrics(baselineMetrics)}`,
    `Benchmark: ${asString(benchmark.name) ?? "unknown"}`,
    `Status: ${asString(benchmark.status) ?? "unknown"}`,
    `Updated at: ${asString(benchmark.updatedAt) ?? "unknown"}`,
    `Source repo: ${asString(benchmark.sourceUrl) ?? "unknown"}`,
    `Resolution: ${sourceUrl}`
  ].join("\n");
}

export function calculateGoogleAheadPercent(currentBestScore: number): number {
  return ((googleClassifiedCircuitScore - currentBestScore) / googleClassifiedCircuitScore) * 100;
}

function selectOfficialBenchmark(benchmarks: EcdsaFailBenchmark[]): EcdsaFailBenchmark | null {
  return (
    benchmarks.find(
      (benchmark) =>
        asString(benchmark.status) === "open" && asString(benchmark.sourceUrl) === "https://github.com/ecdsafail/ecdsafail-challenge"
    ) ??
    benchmarks.find((benchmark) => asString(benchmark.sourceUrl) === "https://github.com/ecdsafail/ecdsafail-challenge") ??
    benchmarks.find((benchmark) => asString(benchmark.status) === "open" && asString(benchmark.name)?.includes("ecdsafail-challenge")) ??
    null
  );
}

function parseCircuitMetrics(value: unknown): CircuitMetrics | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const metrics = value as Partial<Record<keyof CircuitMetrics, unknown>>;
  const qubits = asFiniteNumber(metrics.qubits);
  const toffoli = asFiniteNumber(metrics.toffoli);
  return qubits === null || toffoli === null ? null : { qubits, toffoli };
}

function formatCircuitMetrics(metrics: CircuitMetrics | null): string {
  if (!metrics) {
    return "unknown";
  }

  return `${formatInteger(metrics.qubits)} qubits × ${formatInteger(metrics.toffoli)} Toffoli`;
}

function extractAheadPercent(value: string): string | null {
  return value.match(/^Ahead of Google:\s*([^\n]+)$/m)?.[1] ?? null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}%`;
}
