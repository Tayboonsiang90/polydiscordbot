export type IntegrationStatus = "active" | "paused";

export type Integration = {
  id: number;
  guildId: string;
  channelId: string;
  adapterId: string;
  displayName: string;
  sourceUrl: string;
  polymarketUrl: string | null;
  alertRoleId: string | null;
  roleMessageId: string | null;
  roleChannelId: string | null;
  roleEmoji: string | null;
  settingsJson: string | null;
  pollIntervalMinutes: number;
  status: IntegrationStatus;
  lastValue: string | null;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  snapshotValue: string | null;
  snapshotCheckedAt: string | null;
  snapshotDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateIntegrationInput = {
  guildId: string;
  channelId: string;
  adapterId: string;
  displayName: string;
  sourceUrl: string;
  polymarketUrl?: string | null;
  settingsJson?: string | null;
  pollIntervalMinutes: number;
};

export type IntegrationSettings = Record<string, unknown>;

export type AdapterValue = {
  value: string;
  rawValue: string;
  unit?: string;
  observedAt: Date;
};

export type EventMonitorPost = {
  id: string;
  type: string;
  alertTitle?: string;
  sourceLabel?: string;
  buttonLabel?: string;
  mentionAlertRole?: boolean;
  text: string;
  qualifyingText: string;
  postedAt: Date;
  url: string;
  polymarketUrl?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  imageUrls: string[];
  imageText: string;
  matchedTerms: string[];
  strikeTerms: string[];
};

export type EventMonitorResult = {
  posts: EventMonitorPost[];
  strikeTerms: string[];
  polymarketUrl?: string;
  settingsJson?: string;
  observedAt: Date;
};

export type StrikeSearchHit = {
  url: string;
  postedAt: string;
  snippet: string;
};

export type StrikeSearchResult = {
  term: string;
  searchUrl: string;
  startAt: string;
  endAt: string;
  totalResults: number;
  hits: StrikeSearchHit[];
};

export type WebsiteAdapter = {
  id: string;
  commandName: string;
  displayName: string;
  sourceUrl: string;
  defaultPolymarketUrl?: string;
  defaultChannelName: string;
  legacyChannelNames?: string[];
  alertRoleName: string;
  alertRoleEmoji: string;
  defaultSettings?: IntegrationSettings;
  supportsPeriod?: boolean;
  dailySnapshot?: {
    timeZone: string;
    hour: number;
    minute: number;
    windowMinutes: number;
    label: string;
  };
  supportsStrikes?: boolean;
  getPollIntervalMinutes?(integration: Integration, now?: Date): number;
  getPollIntervalReason?(integration: Integration, now?: Date): string;
  getErrorNoticeWindowMinutes?(integration: Integration): number;
  shouldAlertOnChange?(previousValue: string | null, currentValue: string): boolean;
  fetchCurrentValue(integration?: Integration): Promise<AdapterValue>;
  fetchEventUpdates?(integration: Integration): Promise<EventMonitorResult>;
  enrichEventPost?(post: EventMonitorPost, strikeTerms: string[]): Promise<EventMonitorPost>;
  shouldAlertOnEventPost?(post: EventMonitorPost): boolean;
  refreshSettings?(integration: Integration, options?: { force?: boolean }): Promise<string>;
  getStrikeTerms?(integration: Integration): { strikeTerms: string[]; parsedFromUrl?: string; lastParsedAt?: string };
  searchStrikeTerm?(integration: Integration, term: string): Promise<StrikeSearchResult>;
};
