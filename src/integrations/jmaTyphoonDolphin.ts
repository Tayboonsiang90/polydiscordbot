import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { feature } from "topojson-client";
import { fetchWithTimeout } from "../http.js";
import { parseSettingsJson, stringifySettingsJson } from "../settingsJson.js";
import { formatEasternDateTime } from "../time.js";
import type { AdapterValue, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://www.jma.go.jp/bosai/map.html#contents=typhoon&lang=en";
const apiUrl = "https://www.jma.go.jp/bosai/typhoon/data/TC2615/specifications.json";
const defaultPolymarketUrl =
  "https://polymarket.com/event/will-super-typhoon-dolphin-hit-china-20260730202351925";
const japanPolymarketUrl =
  "https://polymarket.com/event/will-super-typhoon-dolphin-hit-japan-20260730150614391";
const dolphinPolymarketMarkets = [
  {
    url: japanPolymarketUrl,
    slug: "will-super-typhoon-dolphin-hit-japan-20260730150614391",
    startAt: "2026-07-30T15:54:52.885Z",
    endAt: "2026-08-16T03:59:00.000Z",
    addedAt: "2026-07-30T15:54:52.885Z"
  },
  {
    url: defaultPolymarketUrl,
    slug: "will-super-typhoon-dolphin-hit-china-20260730202351925",
    startAt: "2026-07-30T20:54:35.969Z",
    endAt: "2026-08-16T03:59:00.000Z",
    addedAt: "2026-07-30T20:54:35.969Z"
  }
];

type TerritoryGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

type CountriesTopology = {
  objects: {
    countries: {
      geometries: Array<{ id?: string | number }>;
    };
  };
};

const require = createRequire(import.meta.url);
const countriesTopology = require("world-atlas/countries-10m.json") as CountriesTopology;
const chinaTerritoryGeometries = ["156", "344", "446"].map(loadCountryGeometry);
const japanTerritoryGeometry = loadCountryGeometry("392");

type LocalizedValue = {
  jp?: unknown;
  en?: unknown;
};

export type JmaTyphoonPart = {
  part?: unknown;
  issue?: LocalizedValue;
  typhoonNumber?: unknown;
  name?: LocalizedValue;
  category?: LocalizedValue | unknown;
  advancedHours?: unknown;
  maximumWind?: {
    sustained?: { "m/s"?: unknown; kt?: unknown };
    gust?: { "m/s"?: unknown; kt?: unknown };
  };
  position?: {
    deg?: unknown;
  };
  location?: unknown;
  course?: unknown;
  speed?: {
    "km/h"?: unknown;
    kt?: unknown;
  };
  pressure?: unknown;
  intensity?: unknown;
  validtime?: LocalizedValue;
};

export type JmaTyphoonForecastPoint = {
  advancedHours: number;
  validAt: string | null;
  latitude: number;
  longitude: number;
  category: string;
};

export type JmaTyphoonDolphinReport = {
  stormName: string;
  typhoonNumber: string;
  issuedAt: string | null;
  validAt: string | null;
  latitude: number;
  longitude: number;
  category: string;
  intensity: string;
  location: string;
  course: string;
  speedKmh: number | null;
  pressureHpa: number | null;
  sustainedWindKmh: number | null;
  sustainedWindKt: number | null;
  gustKmh: number | null;
  gustKt: number | null;
  forecast: JmaTyphoonForecastPoint[];
  chinaCoordinateOnLand: boolean;
  japanCoordinateOnLand: boolean;
  qualifyingTropicalCyclone: boolean;
  terminalClassification: boolean;
  fingerprint: string;
};

export const jmaTyphoonDolphinAdapter: WebsiteAdapter = {
  id: "jma-typhoon-dolphin",
  commandName: "typhoondolphin",
  displayName: "JMA Typhoon Dolphin",
  sourceUrl,
  defaultPolymarketUrl,
  defaultChannelName: "typhoon-dolphin",
  alertRoleName: "Typhoon Dolphin Alerts",
  alertRoleEmoji: "\uD83C\uDF00",
  defaultSettings: { polymarketMarkets: dolphinPolymarketMarkets },
  getPollIntervalMinutes: () => 1,
  getPollIntervalReason: () => "Polls Dolphin's official JMA position advisory every minute",
  getErrorNoticeWindowMinutes: () => 30,
  shouldAlertOnChange: shouldAlertOnJmaTyphoonDolphinChange,
  suppressMarketRolloverAlerts: true,
  refreshSettings: async (integration) => ensureDolphinPolymarketMarkets(integration.settingsJson),
  async fetchCurrentValue(integration): Promise<AdapterValue> {
    const response = await fetchWithTimeout(apiUrl, {
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1"
      }
    });
    if (!response.ok) {
      throw new Error(`JMA Dolphin advisory endpoint returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as unknown;
    const report = parseJmaTyphoonDolphinReport(data);
    const value = formatJmaTyphoonDolphinValue(report, integration?.lastValue ?? null);
    const satisfiedTerritories = getSatisfiedTerritoriesFromValue(value);
    return {
      value,
      rawValue: report.fingerprint,
      unit: "JMA Typhoon Dolphin advisory",
      alertTitle: satisfiedTerritories.length
        ? `\uD83D\uDEA8 DOLPHIN RULE SATISFIED: ${satisfiedTerritories.join(" + ")}`
        : undefined,
      alertSeverity: satisfiedTerritories.length ? "critical" : undefined,
      observedAt: new Date()
    };
  }
};

export function parseJmaTyphoonDolphinReport(data: unknown): JmaTyphoonDolphinReport {
  if (!Array.isArray(data) || data.length < 2) {
    throw new Error("JMA Dolphin response did not contain advisory parts");
  }

  const parts = data.filter(isRecord) as JmaTyphoonPart[];
  const title = parts.find((part) => part.part === "title");
  const analysis = parts.find((part) => readNumber(part.advancedHours) === 0 || readLocalized(part.part, "en") === "Analysis");
  if (!title || !analysis) {
    throw new Error("Could not find JMA Dolphin title and analysis rows");
  }

  const stormName = readLocalized(title.name, "en") || "Dolphin";
  if (!/dolphin/i.test(stormName)) {
    throw new Error(`JMA event TC2615 is not Dolphin: ${stormName}`);
  }

  const [latitude, longitude] = readPosition(analysis.position?.deg);
  const category = readCategory(analysis.category) || readCategory(title.category) || "unknown";
  const location = readString(analysis.location) || "not listed";
  const territory = classifyDolphinCoordinate(latitude, longitude);
  const forecast = parts
    .map(parseForecastPoint)
    .filter((point): point is JmaTyphoonForecastPoint => point !== null)
    .sort((left, right) => left.advancedHours - right.advancedHours);

  return {
    stormName,
    typhoonNumber: readString(title.typhoonNumber) || "unknown",
    issuedAt: readLocalized(title.issue, "UTC") || null,
    validAt: readLocalized(analysis.validtime, "UTC") || null,
    latitude,
    longitude,
    category,
    intensity: readString(analysis.intensity) || "not listed",
    location,
    course: readString(analysis.course) || "not listed",
    speedKmh: readNumber(analysis.speed?.["km/h"]),
    pressureHpa: readNumber(analysis.pressure),
    sustainedWindKmh: convertMetersPerSecondToKmh(readNumber(analysis.maximumWind?.sustained?.["m/s"])),
    sustainedWindKt: readNumber(analysis.maximumWind?.sustained?.kt),
    gustKmh: convertMetersPerSecondToKmh(readNumber(analysis.maximumWind?.gust?.["m/s"])),
    gustKt: readNumber(analysis.maximumWind?.gust?.kt),
    forecast,
    chinaCoordinateOnLand: territory.china,
    japanCoordinateOnLand: territory.japan,
    qualifyingTropicalCyclone: isQualifyingTropicalCyclone(category),
    terminalClassification: isTerminalClassification(category, location),
    fingerprint: createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 16)
  };
}

export function formatJmaTyphoonDolphinValue(report: JmaTyphoonDolphinReport, previousValue: string | null): string {
  const previousCoordinateTerritories = extractLine(previousValue, "Coordinate territory") ?? "none";
  const previousClass = extractJmaClass(previousValue) ?? report.category;
  const crossingClassQualifies = isQualifyingTropicalCyclone(previousClass);
  const previousChinaSatisfied = extractLine(previousValue, "China rule ever satisfied") === "yes";
  const previousJapanSatisfied = extractLine(previousValue, "Japan rule ever satisfied") === "yes";
  const chinaCrossedNow = report.chinaCoordinateOnLand && !territoryListContains(previousCoordinateTerritories, "China");
  const japanCrossedNow = report.japanCoordinateOnLand && !territoryListContains(previousCoordinateTerritories, "Japan");
  const chinaRuleEverSatisfied = previousChinaSatisfied || (chinaCrossedNow && crossingClassQualifies);
  const japanRuleEverSatisfied = previousJapanSatisfied || (japanCrossedNow && crossingClassQualifies);
  const chinaRuleSatisfiedNow = report.chinaCoordinateOnLand && chinaRuleEverSatisfied;
  const japanRuleSatisfiedNow = report.japanCoordinateOnLand && japanRuleEverSatisfied;
  const satisfiedTerritories = [chinaRuleSatisfiedNow ? "CHINA" : null, japanRuleSatisfiedNow ? "JAPAN" : null].filter(
    (value): value is string => value !== null
  );
  const coordinateTerritories = [report.chinaCoordinateOnLand ? "China" : null, report.japanCoordinateOnLand ? "Japan" : null].filter(
    (value): value is string => value !== null
  );
  const outcomeWatch = satisfiedTerritories.length
    ? `\uD83D\uDEA8 RULE SATISFIED - JMA center is on ${satisfiedTerritories.join(" and ")} territory with class ${report.category}`
    : report.terminalClassification
      ? `NO QUALIFYING CROSSING NOW - JMA lists terminal class ${report.category}`
      : coordinateTerritories.length
        ? `REVIEW - center is on ${coordinateTerritories.join(" and ")} territory but class ${report.category} is not recognized as tropical cyclone`
        : "MONITORING - latest JMA center is outside qualifying China and Japan land";

  return [
    "Metric: JMA Typhoon Dolphin position advisory",
    `Outcome watch: ${outcomeWatch}`,
    `Current center: ${formatCoordinate(report.latitude, report.longitude)}`,
    `JMA location: ${formatLocation(report.location)}`,
    `Current class: ${report.category}${report.intensity === "not listed" ? "" : ` (${formatIntensity(report.intensity)})`}`,
    `Sustained winds: ${formatWind(report.sustainedWindKmh, report.sustainedWindKt)}`,
    `Peak gusts: ${formatWind(report.gustKmh, report.gustKt)}`,
    `Pressure: ${report.pressureHpa === null ? "not available" : `${report.pressureHpa} hPa`}`,
    `Movement: ${formatCourse(report.course)}${report.speedKmh === null ? "" : ` at ${report.speedKmh} km/h`}`,
    `Advisory issued: ${formatTime(report.issuedAt)}`,
    `Analysis valid: ${formatTime(report.validAt)}`,
    `Forecast track: ${formatForecast(report.forecast)}`,
    `Coordinate territory: ${coordinateTerritories.join(" + ") || "none"}`,
    `Qualifying tropical cyclone class: ${report.qualifyingTropicalCyclone ? "yes" : "no"}`,
    `Crossing class used: ${previousClass} (${crossingClassQualifies ? "qualifying" : "not qualifying"})`,
    `China rule satisfied now: ${chinaRuleSatisfiedNow ? "yes" : "no"}`,
    `Japan rule satisfied now: ${japanRuleSatisfiedNow ? "yes" : "no"}`,
    `China rule ever satisfied: ${chinaRuleEverSatisfied ? "yes" : "no"}`,
    `Japan rule ever satisfied: ${japanRuleEverSatisfied ? "yes" : "no"}`,
    `Terminal classification: ${report.terminalClassification ? "yes" : "no"}`,
    `China rule: center must cross PRC-administered land while JMA classifies Dolphin as a tropical cyclone; Hong Kong and Macau count, Taiwan does not`,
    `Japan rule: center must cross Japanese territory while JMA classifies Dolphin as a tropical cyclone; Okinawa, Ryukyu, and all main islands count`,
    `Coordinate classifier: Natural Earth 1:10m land polygons; China unions CHN, Hong Kong, and Macau and excludes Taiwan`,
    `Advisory fingerprint: ${report.fingerprint}`,
    `Resolution: ${sourceUrl}`,
    `JMA API: ${apiUrl}`
  ].join("\n");
}

export function shouldAlertOnJmaTyphoonDolphinChange(previousValue: string | null, currentValue: string): boolean {
  if (!previousValue) {
    return false;
  }

  return ["China rule ever satisfied", "Japan rule ever satisfied"].some(
    (label) => extractLine(previousValue, label) !== "yes" && extractLine(currentValue, label) === "yes"
  );
}

export function classifyDolphinCoordinate(latitude: number, longitude: number): { china: boolean; japan: boolean } {
  return {
    china: chinaTerritoryGeometries.some((geometry) => geometryContainsCoordinate(geometry, latitude, longitude)),
    japan: geometryContainsCoordinate(japanTerritoryGeometry, latitude, longitude)
  };
}

function ensureDolphinPolymarketMarkets(settingsJson: string | null): string {
  const settings = parseSettingsJson(settingsJson);
  const existingMarkets = Array.isArray(settings.polymarketMarkets)
    ? settings.polymarketMarkets.filter(isRecord).map((market) => ({ ...market }))
    : [];
  const marketsBySlug = new Map<string, Record<string, unknown>>();

  for (const market of existingMarkets) {
    const slug = readString(market.slug);
    if (slug) {
      marketsBySlug.set(slug, market);
    }
  }
  for (const market of dolphinPolymarketMarkets) {
    marketsBySlug.set(market.slug, { ...marketsBySlug.get(market.slug), ...market });
  }

  return stringifySettingsJson({ ...settings, polymarketMarkets: [...marketsBySlug.values()] });
}

function getSatisfiedTerritoriesFromValue(value: string): string[] {
  return ["CHINA", "JAPAN"].filter(
    (territory) => extractLine(value, `${territory[0]}${territory.slice(1).toLowerCase()} rule satisfied now`) === "yes"
  );
}

function extractJmaClass(value: string | null): string | null {
  const classLine = extractLine(value, "Current class");
  return classLine?.match(/^([^\s(]+)/)?.[1] ?? null;
}

function territoryListContains(value: string, territory: string): boolean {
  return value.split("+").some((candidate) => candidate.trim().toLowerCase() === territory.toLowerCase());
}

function loadCountryGeometry(countryId: string): TerritoryGeometry {
  const country = countriesTopology.objects.countries.geometries.find((geometry) => String(geometry.id) === countryId);
  if (!country) {
    throw new Error(`Natural Earth country geometry ${countryId} is unavailable`);
  }
  const countryFeature = feature(countriesTopology as never, country as never) as unknown as { geometry: TerritoryGeometry };
  return countryFeature.geometry;
}

function geometryContainsCoordinate(
  geometry: TerritoryGeometry,
  latitude: number,
  longitude: number
): boolean {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((polygon) => polygonContainsPoint(polygon, [longitude, latitude]));
}

function polygonContainsPoint(polygon: number[][][], point: [number, number]): boolean {
  const [outerRing, ...holes] = polygon;
  return Boolean(outerRing && ringContainsPoint(outerRing, point) && !holes.some((hole) => ringContainsPoint(hole, point)));
}

function ringContainsPoint(ring: number[][], point: [number, number]): boolean {
  let inside = false;
  for (let currentIndex = 0, previousIndex = ring.length - 1; currentIndex < ring.length; previousIndex = currentIndex++) {
    const current = ring[currentIndex];
    const previous = ring[previousIndex];
    if (!current || !previous) {
      continue;
    }
    if (pointIsOnSegment(point, previous, current)) {
      return true;
    }

    const crossesLatitude = current[1] > point[1] !== previous[1] > point[1];
    if (
      crossesLatitude &&
      point[0] < ((previous[0] - current[0]) * (point[1] - current[1])) / (previous[1] - current[1]) + current[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function pointIsOnSegment(point: [number, number], start: number[], end: number[]): boolean {
  const crossProduct = (point[0] - start[0]) * (end[1] - start[1]) - (point[1] - start[1]) * (end[0] - start[0]);
  if (Math.abs(crossProduct) > 1e-9) {
    return false;
  }
  return (
    point[0] >= Math.min(start[0], end[0]) - 1e-9 &&
    point[0] <= Math.max(start[0], end[0]) + 1e-9 &&
    point[1] >= Math.min(start[1], end[1]) - 1e-9 &&
    point[1] <= Math.max(start[1], end[1]) + 1e-9
  );
}

function parseForecastPoint(part: JmaTyphoonPart): JmaTyphoonForecastPoint | null {
  const advancedHours = readNumber(part.advancedHours);
  if (advancedHours === null || advancedHours <= 0) {
    return null;
  }

  try {
    const [latitude, longitude] = readPosition(part.position?.deg);
    return {
      advancedHours,
      validAt: readLocalized(part.validtime, "UTC") || null,
      latitude,
      longitude,
      category: readCategory(part.category) || "unknown"
    };
  } catch {
    return null;
  }
}

function isTerminalClassification(category: string, location: string): boolean {
  return /(?:EX|extratropical|dissipated|absorbed|温帯低気圧|消滅|吸収)/i.test(`${category} ${location}`);
}

function isQualifyingTropicalCyclone(category: string): boolean {
  return /^(?:TD|TS|STS|TY)$/i.test(category.trim()) || /tropical (?:depression|storm|cyclone)|typhoon/i.test(category);
}

function readPosition(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error("Could not parse JMA Dolphin center position");
  }

  const latitude = readNumber(value[0]);
  const longitude = readNumber(value[1]);
  if (latitude === null || longitude === null) {
    throw new Error("Could not parse JMA Dolphin center coordinates");
  }
  return [latitude, longitude];
}

function readCategory(value: unknown): string {
  return readLocalized(value, "en") || readLocalized(value, "jp") || readString(value);
}

function readLocalized(value: unknown, key: string): string {
  if (!isRecord(value)) {
    return "";
  }
  return readString(value[key]);
}

function readString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function readNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function convertMetersPerSecondToKmh(value: number | null): number | null {
  return value === null ? null : Math.round(value * 3.6);
}

function formatCoordinate(latitude: number, longitude: number): string {
  return `${Math.abs(latitude).toFixed(1)}°${latitude >= 0 ? "N" : "S"}, ${Math.abs(longitude).toFixed(1)}°${longitude >= 0 ? "E" : "W"}`;
}

function formatLocation(location: string): string {
  const translations: Record<string, string> = {
    "南鳥島近海": "Near Minamitorishima",
    "小笠原近海": "Near Ogasawara",
    "日本の南": "South of Japan",
    "東シナ海": "East China Sea",
    "南シナ海": "South China Sea",
    "台湾海峡": "Taiwan Strait",
    "華南": "South China",
    "華東": "East China"
  };
  const translation = translations[location];
  return translation ? `${translation} (${location})` : location;
}

function formatIntensity(intensity: string): string {
  const translations: Record<string, string> = {
    "猛烈な": "Violent / 猛烈な",
    "非常に強い": "Very strong / 非常に強い",
    "強い": "Strong / 強い"
  };
  return translations[intensity] ?? intensity;
}

function formatCourse(course: string): string {
  const translations: Record<string, string> = {
    "北": "N / 北",
    "北北東": "NNE / 北北東",
    "北東": "NE / 北東",
    "東北東": "ENE / 東北東",
    "東": "E / 東",
    "東南東": "ESE / 東南東",
    "南東": "SE / 南東",
    "南南東": "SSE / 南南東",
    "南": "S / 南",
    "南南西": "SSW / 南南西",
    "南西": "SW / 南西",
    "西南西": "WSW / 西南西",
    "西": "W / 西",
    "西北西": "WNW / 西北西",
    "北西": "NW / 北西",
    "北北西": "NNW / 北北西"
  };
  return translations[course] ?? course;
}

function formatWind(kmh: number | null, knots: number | null): string {
  if (kmh === null && knots === null) {
    return "not available";
  }
  return [kmh === null ? null : `${kmh} km/h`, knots === null ? null : `${knots} kt`].filter(Boolean).join(" / ");
}

function formatTime(value: string | null): string {
  if (!value || Number.isNaN(Date.parse(value))) {
    return "not available";
  }
  return formatEasternDateTime(value);
}

function formatForecast(points: JmaTyphoonForecastPoint[]): string {
  if (!points.length) {
    return "not available";
  }
  return points
    .map((point) => `+${point.advancedHours}h ${formatCoordinate(point.latitude, point.longitude)} ${point.category}`)
    .join(" | ");
}

function extractLine(value: string | null, label: string): string | null {
  if (!value) {
    return null;
  }
  return value.match(new RegExp(`^${escapeRegExp(label)}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
