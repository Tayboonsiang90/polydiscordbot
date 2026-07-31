import { fetchWithTimeout } from "../http.js";
import { getPolymarketSlug } from "../marketEnd.js";
import type { AdapterValue, Integration, WebsiteAdapter } from "./types.js";

const sourceUrl = "https://music.apple.com/us/browse";
const gammaApiUrl = "https://gamma-api.polymarket.com/events";
const appleSearchUrl = "https://itunes.apple.com/search";
const appleLookupUrl = "https://itunes.apple.com/lookup";
const parseCacheMs = 6 * 60 * 60_000;
const defaultPollIntervalMinutes = 60;
const releaseYear = 2026;

type SongReleaseAdapterConfig = {
  id: string;
  commandName: string;
  displayName: string;
  defaultPolymarketUrl: string;
  defaultChannelName: string;
  alertRoleName: string;
  alertRoleEmoji: string;
  releasePhrase: "new song" | "song" | "album";
  releaseKind: "song" | "album";
  qualifyingStart: "calendar_year" | "market_creation";
};

export type ArtistReleaseMarket = {
  artistName: string;
  marketSlug: string;
  question: string;
  artistId?: number;
  artistUrl?: string;
  qualifyingStartDate?: string;
};

type SongReleaseSettings = {
  artistReleaseMarkets?: ArtistReleaseMarket[];
  parsedFromUrl?: string;
  lastParsedAt?: string;
  latestErrorMessageId?: string;
};

type GammaEvent = {
  startDate?: unknown;
  creationDate?: unknown;
  createdAt?: unknown;
  markets?: GammaMarket[];
};

type GammaMarket = {
  question?: unknown;
  slug?: unknown;
  active?: unknown;
  closed?: unknown;
  outcomes?: unknown;
  outcomePrices?: unknown;
};

type AppleArtistSearchResponse = {
  results?: AppleArtistSearchResult[];
};

type AppleArtistSearchResult = {
  artistId?: unknown;
  artistName?: unknown;
  artistLinkUrl?: unknown;
};

type AppleLookupResponse = {
  results?: AppleLookupResult[];
};

type AppleLookupResult = {
  wrapperType?: unknown;
  kind?: unknown;
  artistId?: unknown;
  artistName?: unknown;
  artistViewUrl?: unknown;
  collectionArtistName?: unknown;
  collectionName?: unknown;
  collectionId?: unknown;
  collectionType?: unknown;
  collectionViewUrl?: unknown;
  trackCount?: unknown;
  trackId?: unknown;
  trackName?: unknown;
  trackViewUrl?: unknown;
  releaseDate?: unknown;
  isStreamable?: unknown;
};

type ArtistSongRelease = {
  artistName: string;
  trackName: string;
  releaseDate: string;
  trackUrl: string;
  trackId: number;
};

export const artistSongReleasesAdapter = createSongReleaseAdapter({
  id: "apple-artist-song-releases",
  commandName: "songreleases",
  displayName: "Artist Song Releases",
  defaultPolymarketUrl: "https://polymarket.com/event/which-artists-will-release-a-new-song-in-2026",
  defaultChannelName: "songreleases",
  alertRoleName: "Artist Song Release Alerts",
  alertRoleEmoji: "\uD83C\uDFB6",
  releasePhrase: "new song",
  releaseKind: "song",
  qualifyingStart: "calendar_year"
});

export const kpopSongReleasesAdapter = createSongReleaseAdapter({
  id: "apple-kpop-song-releases",
  commandName: "kpopreleases",
  displayName: "KPop Song Releases",
  defaultPolymarketUrl: "https://polymarket.com/event/which-kpop-groups-will-release-songs-in-2026",
  defaultChannelName: "kpopreleases",
  alertRoleName: "KPop Song Release Alerts",
  alertRoleEmoji: "\uD83C\uDFA4",
  releasePhrase: "song",
  releaseKind: "song",
  qualifyingStart: "market_creation"
});

export const artistAlbumReleasesAdapter = createSongReleaseAdapter({
  id: "apple-artist-album-releases",
  commandName: "albumreleases",
  displayName: "Artist Album Releases",
  defaultPolymarketUrl: "https://polymarket.com/event/which-artists-will-release-new-albums-in-2026",
  defaultChannelName: "albumreleases",
  alertRoleName: "Artist Album Release Alerts",
  alertRoleEmoji: "\uD83D\uDCBF",
  releasePhrase: "album",
  releaseKind: "album",
  qualifyingStart: "calendar_year"
});

export function createSongReleaseAdapter(config: SongReleaseAdapterConfig): WebsiteAdapter {
  return {
    id: config.id,
    commandName: config.commandName,
    displayName: config.displayName,
    sourceUrl,
    defaultPolymarketUrl: config.defaultPolymarketUrl,
    defaultChannelName: config.defaultChannelName,
    alertRoleName: config.alertRoleName,
    alertRoleEmoji: config.alertRoleEmoji,
    getPollIntervalMinutes: () => defaultPollIntervalMinutes,
    getPollIntervalReason: () => "Apple Music/iTunes release monitor: hourly polling",
    async refreshSettings(integration: Integration): Promise<string> {
      return refreshSongReleaseSettings(integration, config);
    },
    shouldAlertOnChange: shouldAlertOnSongReleaseChange,
    async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
      const settingsIntegration = await ensureSongReleaseSettings(integration, config);
      const settings = parseSongReleaseSettings(settingsIntegration.settingsJson);
      const value = formatSongReleaseValue(
        await fetchArtistReleases(settings.artistReleaseMarkets ?? [], config.releaseKind),
        settings.artistReleaseMarkets ?? [],
        settings.parsedFromUrl ?? settingsIntegration.polymarketUrl ?? config.defaultPolymarketUrl,
        settings.lastParsedAt,
        config.releaseKind
      );
      return {
        value,
        rawValue: value,
        unit: `Apple Music/iTunes ${config.releaseKind} releases`,
        observedAt: new Date()
      };
    }
  };
}

export async function refreshSongReleaseSettings(
  integration: Integration,
  config: SongReleaseAdapterConfig,
  now = new Date()
): Promise<string> {
  const settings = parseSongReleaseSettings(integration.settingsJson);
  const polymarketUrl = integration.polymarketUrl ?? config.defaultPolymarketUrl;
  if (!shouldRefreshParsedArtists(settings, polymarketUrl, now)) {
    return JSON.stringify(settings);
  }

  const artistReleaseMarkets = await parseArtistReleaseMarketsFromPolymarket(
    polymarketUrl,
    config.releasePhrase,
    config.qualifyingStart
  );
  const existingByName = new Map(
    (settings.artistReleaseMarkets ?? []).map((market) => [normalizeName(market.artistName), market])
  );
  const resolvedMarkets: ArtistReleaseMarket[] = [];
  for (const market of artistReleaseMarkets) {
    const existing = existingByName.get(normalizeName(market.artistName));
    if (existing?.artistId) {
      resolvedMarkets.push({ ...market, artistId: existing.artistId, artistUrl: existing.artistUrl });
      continue;
    }

    resolvedMarkets.push(await resolveAppleArtist(market));
  }

  return JSON.stringify({
    ...settings,
    artistReleaseMarkets: resolvedMarkets,
    parsedFromUrl: polymarketUrl,
    lastParsedAt: now.toISOString()
  });
}

export async function parseArtistReleaseMarketsFromPolymarket(
  polymarketUrl: string,
  releasePhrase: "new song" | "song" | "album",
  qualifyingStart: "calendar_year" | "market_creation" = "calendar_year"
): Promise<ArtistReleaseMarket[]> {
  const slug = getPolymarketSlug(polymarketUrl);
  if (!slug) {
    throw new Error(`Could not parse Polymarket slug from ${polymarketUrl}`);
  }

  const response = await fetchWithTimeout(`${gammaApiUrl}?slug=${encodeURIComponent(slug)}`, {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma returned HTTP ${response.status}`);
  }

  const events = (await response.json()) as GammaEvent[];
  const event = events[0];
  const markets = event?.markets ?? [];
  const qualifyingStartDate =
    qualifyingStart === "market_creation"
      ? parseGammaDate(event?.startDate) ?? parseGammaDate(event?.creationDate) ?? parseGammaDate(event?.createdAt)
      : null;
  return markets.flatMap((market) => {
    const artistName = parseArtistFromQuestion(String(market.question ?? ""), releasePhrase);
    if (!artistName || !isUnresolvedMarket(market) || !isNonEmptyString(market.slug)) {
      return [];
    }

    return [
      {
        artistName,
        marketSlug: market.slug,
        question: String(market.question),
        ...(qualifyingStartDate ? { qualifyingStartDate: qualifyingStartDate.slice(0, 10) } : {})
      }
    ];
  });
}

export function parseArtistFromQuestion(question: string, releasePhrase: "new song" | "song" | "album"): string | null {
  const escapedPhrase = releasePhrase.replace(/\s+/g, "\\s+");
  const match = question.match(new RegExp(`^Will\\s+(.+?)\\s+release\\s+(?:a|an)\\s+${escapedPhrase}\\s+in\\s+2026\\??\\s*$`, "i"));
  return normalizeDisplayName(match?.[1] ?? "");
}

export function formatSongReleaseValue(
  releases: ArtistSongRelease[],
  artistMarkets: ArtistReleaseMarket[],
  parsedFromUrl: string,
  lastParsedAt?: string,
  releaseKind: "song" | "album" = "song"
): string {
  const sortedReleases = sortReleases(releases);
  const releaseLabel = releaseKind === "album" ? "album" : "song";
  const releaseLabelPlural = releaseKind === "album" ? "albums" : "songs";
  const lines = [
    `Metric: Apple Music/iTunes 2026 ${releaseLabel} releases`,
    `Tracked unresolved artists: ${artistMarkets.length ? artistMarkets.map((market) => market.artistName).join(", ") : "none"}`,
    `Candidate ${releaseLabelPlural} found: ${sortedReleases.length ? String(sortedReleases.length) : "none"}`,
    `Parsed from: ${parsedFromUrl}`,
    `Artists parsed at: ${lastParsedAt ?? "not parsed yet"}`
  ];

  if (sortedReleases.length) {
    lines.push(
      `Latest candidate ${releaseLabelPlural}:`,
      ...sortedReleases
        .slice(0, 10)
        .map((release) => `- ${release.artistName} — ${release.trackName} — ${release.releaseDate.slice(0, 10)} — ${release.trackUrl}`)
    );
  }

  lines.push(`Release IDs: ${formatReleaseIds(sortedReleases)}`);
  return lines.join("\n");
}

export function shouldAlertOnSongReleaseChange(previousValue: string | null, currentValue: string): boolean {
  const previousIds = parseReleaseIds(previousValue);
  const currentIds = parseReleaseIds(currentValue);
  return [...currentIds].some((id) => !previousIds.has(id));
}

async function ensureSongReleaseSettings(
  integration: Integration | undefined,
  config: SongReleaseAdapterConfig
): Promise<Integration> {
  const fallback = {
    settingsJson: null,
    polymarketUrl: config.defaultPolymarketUrl
  } as Integration;
  const activeIntegration = integration ?? fallback;
  const settings = parseSongReleaseSettings(activeIntegration.settingsJson);
  if (settings.artistReleaseMarkets?.length) {
    return activeIntegration;
  }

  return {
    ...activeIntegration,
    settingsJson: await refreshSongReleaseSettings(activeIntegration, config)
  };
}

async function fetchArtistSongReleases(artistMarkets: ArtistReleaseMarket[]): Promise<ArtistSongRelease[]> {
  return fetchArtistReleases(artistMarkets, "song");
}

async function fetchArtistReleases(
  artistMarkets: ArtistReleaseMarket[],
  releaseKind: "song" | "album"
): Promise<ArtistSongRelease[]> {
  const releases: ArtistSongRelease[] = [];
  for (const artistMarket of artistMarkets) {
    if (!artistMarket.artistId) {
      continue;
    }

    releases.push(...(await (releaseKind === "album" ? fetchAppleArtistAlbums(artistMarket) : fetchAppleArtistSongs(artistMarket))));
  }

  return uniqueReleases(releases);
}

async function resolveAppleArtist(market: ArtistReleaseMarket): Promise<ArtistReleaseMarket> {
  const searchUrl = new URL(appleSearchUrl);
  searchUrl.searchParams.set("term", market.artistName);
  searchUrl.searchParams.set("entity", "musicArtist");
  searchUrl.searchParams.set("limit", "5");

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Apple artist search returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as AppleArtistSearchResponse;
  const artist = findBestAppleArtistMatch(payload.results ?? [], market.artistName);
  if (!artist?.artistId || typeof artist.artistId !== "number") {
    return market;
  }

  return {
    ...market,
    artistId: artist.artistId,
    artistUrl: isNonEmptyString(artist.artistLinkUrl) ? artist.artistLinkUrl : undefined
  };
}

async function fetchAppleArtistSongs(artistMarket: ArtistReleaseMarket): Promise<ArtistSongRelease[]> {
  const lookupUrl = new URL(appleLookupUrl);
  lookupUrl.searchParams.set("id", String(artistMarket.artistId));
  lookupUrl.searchParams.set("entity", "song");
  lookupUrl.searchParams.set("limit", "200");
  lookupUrl.searchParams.set("sort", "recent");

  const response = await fetchWithTimeout(lookupUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Apple song lookup returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as AppleLookupResponse;
  return (payload.results ?? []).flatMap((result) => normalizeAppleSongRelease(result, artistMarket));
}

async function fetchAppleArtistAlbums(artistMarket: ArtistReleaseMarket): Promise<ArtistSongRelease[]> {
  const lookupUrl = new URL(appleLookupUrl);
  lookupUrl.searchParams.set("id", String(artistMarket.artistId));
  lookupUrl.searchParams.set("entity", "album");
  lookupUrl.searchParams.set("limit", "200");
  lookupUrl.searchParams.set("sort", "recent");

  const response = await fetchWithTimeout(lookupUrl.toString(), {
    headers: { "user-agent": "Mozilla/5.0 PolymarketResolutionMonitorBot/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Apple album lookup returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as AppleLookupResponse;
  return (payload.results ?? []).flatMap((result) => normalizeAppleAlbumRelease(result, artistMarket));
}

function normalizeAppleSongRelease(result: AppleLookupResult, artistMarket: ArtistReleaseMarket): ArtistSongRelease[] {
  if (!isQualifyingAppleSongResult(result, artistMarket)) {
    return [];
  }

  return [
    {
      artistName: artistMarket.artistName,
      trackName: String(result.trackName),
      releaseDate: String(result.releaseDate),
      trackUrl: String(result.trackViewUrl),
      trackId: Number(result.trackId)
    }
  ];
}

function normalizeAppleAlbumRelease(result: AppleLookupResult, artistMarket: ArtistReleaseMarket): ArtistSongRelease[] {
  if (!isQualifyingAppleAlbumResult(result, artistMarket)) {
    return [];
  }

  return [
    {
      artistName: artistMarket.artistName,
      trackName: String(result.collectionName),
      releaseDate: String(result.releaseDate),
      trackUrl: String(result.collectionViewUrl),
      trackId: Number(result.collectionId)
    }
  ];
}

function isQualifyingAppleSongResult(result: AppleLookupResult, artistMarket: ArtistReleaseMarket): boolean {
  if (
    result.wrapperType !== "track" ||
    result.kind !== "song" ||
    result.artistId !== artistMarket.artistId ||
    !isNonEmptyString(result.trackName) ||
    !isNonEmptyString(result.trackViewUrl) ||
    !isNonEmptyString(result.releaseDate) ||
    typeof result.trackId !== "number" ||
    new Date(result.releaseDate).getUTCFullYear() !== releaseYear ||
    !isOnOrAfterQualifyingStartDate(result.releaseDate, artistMarket.qualifyingStartDate)
  ) {
    return false;
  }

  const collectionArtistName = isNonEmptyString(result.collectionArtistName) ? result.collectionArtistName : String(result.artistName ?? "");
  const collectionName = String(result.collectionName ?? "");
  const trackName = String(result.trackName);
  return (
    normalizeName(collectionArtistName) === normalizeName(artistMarket.artistName) &&
    !/\bDJ Mix\b/i.test(collectionName) &&
    !isClearlyDisqualifiedSongVersion(trackName, collectionName)
  );
}

function isQualifyingAppleAlbumResult(result: AppleLookupResult, artistMarket: ArtistReleaseMarket): boolean {
  if (
    result.wrapperType !== "collection" ||
    result.collectionType !== "Album" ||
    result.artistId !== artistMarket.artistId ||
    !isNonEmptyString(result.collectionName) ||
    !isNonEmptyString(result.collectionViewUrl) ||
    !isNonEmptyString(result.releaseDate) ||
    typeof result.collectionId !== "number" ||
    new Date(result.releaseDate).getUTCFullYear() !== releaseYear ||
    !isOnOrAfterQualifyingStartDate(result.releaseDate, artistMarket.qualifyingStartDate)
  ) {
    return false;
  }

  const collectionArtistName = isNonEmptyString(result.collectionArtistName) ? result.collectionArtistName : String(result.artistName ?? "");
  const collectionName = String(result.collectionName);
  return (
    normalizeName(collectionArtistName) === normalizeName(artistMarket.artistName) &&
    !/\bSingle\b|\bEP\b|\bDJ Mix\b/i.test(collectionName) &&
    !/\(Single\)|\[Single\]|\(EP\)|\[EP\]/i.test(collectionName)
  );
}

function findBestAppleArtistMatch(results: AppleArtistSearchResult[], artistName: string): AppleArtistSearchResult | null {
  return (
    results.find((result) => normalizeName(result.artistName) === normalizeName(artistName)) ??
    results.find((result) => normalizeName(result.artistName).includes(normalizeName(artistName))) ??
    null
  );
}

function shouldRefreshParsedArtists(settings: SongReleaseSettings, polymarketUrl: string, now: Date): boolean {
  if (settings.parsedFromUrl !== polymarketUrl || !settings.artistReleaseMarkets?.length || !settings.lastParsedAt) {
    return true;
  }

  const lastParsedMs = Date.parse(settings.lastParsedAt);
  return Number.isNaN(lastParsedMs) || now.getTime() - lastParsedMs >= parseCacheMs;
}

function parseSongReleaseSettings(settingsJson: string | null): SongReleaseSettings {
  if (!settingsJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(settingsJson) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const settings = parsed as SongReleaseSettings;
    return {
      ...settings,
      artistReleaseMarkets: normalizeArtistReleaseMarkets(settings.artistReleaseMarkets),
      parsedFromUrl: isNonEmptyString(settings.parsedFromUrl) ? settings.parsedFromUrl : undefined,
      lastParsedAt: isNonEmptyString(settings.lastParsedAt) ? settings.lastParsedAt : undefined,
      latestErrorMessageId: isNonEmptyString(settings.latestErrorMessageId) ? settings.latestErrorMessageId : undefined
    };
  } catch {
    return {};
  }
}

function normalizeArtistReleaseMarkets(value: unknown): ArtistReleaseMarket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const market = item as Partial<ArtistReleaseMarket>;
    if (!isNonEmptyString(market.artistName) || !isNonEmptyString(market.marketSlug) || !isNonEmptyString(market.question)) {
      return [];
    }

    return [
      {
        artistName: market.artistName,
        marketSlug: market.marketSlug,
        question: market.question,
        artistId: typeof market.artistId === "number" ? market.artistId : undefined,
        artistUrl: isNonEmptyString(market.artistUrl) ? market.artistUrl : undefined,
        qualifyingStartDate: isIsoDate(market.qualifyingStartDate) ? market.qualifyingStartDate : undefined
      }
    ];
  });
}

function isClearlyDisqualifiedSongVersion(trackName: string, collectionName: string): boolean {
  const versionMarker =
    /(?:\(|\[|\s[-–—]\s)\s*(?:acoustic|commentary|demo|edit|extended|instrumental|live|mixed|radio edit|re-?recorded|remaster(?:ed)?|remix|slowed|sped up|track by track|version)\b/i;
  const catalogMarker = /\b(?:anniversary|compilation|deluxe|expanded|greatest hits|legacy edition|remaster(?:ed)?)\b/i;
  return versionMarker.test(trackName) || versionMarker.test(collectionName) || catalogMarker.test(collectionName);
}

function isOnOrAfterQualifyingStartDate(releaseDate: string, qualifyingStartDate?: string): boolean {
  return !qualifyingStartDate || releaseDate.slice(0, 10) >= qualifyingStartDate;
}

function parseGammaDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isUnresolvedMarket(market: GammaMarket): boolean {
  if (market.active === false || market.closed === true) {
    return false;
  }

  const prices = parseJsonStringArray(market.outcomePrices);
  return !(prices.includes("1") && prices.includes("0"));
}

function parseJsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }

  if (!isNonEmptyString(value)) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseReleaseIds(value: string | null): Set<string> {
  const ids = value?.match(/^Release IDs:\s*(.+)$/m)?.[1];
  if (!ids || ids === "none") {
    return new Set();
  }

  return new Set(ids.split(",").map((id) => id.trim()).filter(Boolean));
}

function formatReleaseIds(releases: ArtistSongRelease[]): string {
  const ids = uniqueStrings(releases.map((release) => `${slugify(release.artistName)}:${release.trackId}`));
  return ids.length ? ids.join(",") : "none";
}

function uniqueReleases(releases: ArtistSongRelease[]): ArtistSongRelease[] {
  const seen = new Set<number>();
  return sortReleases(
    releases.filter((release) => {
      if (seen.has(release.trackId)) {
        return false;
      }

      seen.add(release.trackId);
      return true;
    })
  );
}

function sortReleases(releases: ArtistSongRelease[]): ArtistSongRelease[] {
  return [...releases].sort(
    (left, right) =>
      Date.parse(right.releaseDate) - Date.parse(left.releaseDate) ||
      left.artistName.localeCompare(right.artistName) ||
      left.trackName.localeCompare(right.trackName)
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeDisplayName(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length ? normalized : null;
}

function normalizeName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

function slugify(value: string): string {
  return normalizeName(value) || "artist";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
