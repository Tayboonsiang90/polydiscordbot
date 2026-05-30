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
  textFieldName?: string;
  text: string;
  qualifyingText: string;
  postedAt: Date;
  url: string;
  polymarketUrl?: string;
  summaryFields?: Array<{ name: string; value: string; inline?: boolean }>;
  prioritySummary?: EventPostPrioritySummary;
  hideDefaultEventFields?: boolean;
  hideLinksField?: boolean;
  hideTextField?: boolean;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  imageUrls: string[];
  imageAttachments?: EventPostImageAttachment[];
  imageText: string;
  matchedTerms: string[];
  strikeTerms: string[];
};

export type EventPostImageAttachment = {
  name: string;
  data: Buffer;
  description?: string;
  displayAsImage?: boolean;
};

export type EventPostPrioritySummary = {
  question?: string;
  questionUrl?: string;
  proposedOutcome?: string;
  proposalExpirationAt?: string;
  marketTags?: string[];
  matchedTags?: string[];
  proposer?: string;
  proposerProfile?: AddressProfileStatus;
  disputer?: string;
  disputerProfile?: AddressProfileStatus;
  creator?: string;
  clarification?: string;
};

export type EventMonitorResult = {
  posts: EventMonitorPost[];
  strikeTerms: string[];
  polymarketUrl?: string;
  settingsJson?: string;
  checkTitle?: string;
  checkFields?: Array<{ name: string; value: string; inline?: boolean }>;
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

export type TagFilterAction = "add" | "remove" | "list" | "clear";

export type TagFilterEntry = {
  id?: string;
  label: string;
  slug: string;
};

export type TagSearchResult = {
  query: string;
  sourceUrl: string;
  fetchedAt: string;
  totalResults: number;
  shownResults: TagFilterEntry[];
};

export type TagFilterUpdateResult = {
  action: TagFilterAction;
  changed: boolean;
  message: string;
  matchedTag?: TagFilterEntry;
  tagFilters: TagFilterEntry[];
  settingsJson: string;
};

export type TagBlocklistUpdateResult = {
  action: TagFilterAction;
  changed: boolean;
  message: string;
  subscriptionTag: TagFilterEntry;
  blockedTag?: TagFilterEntry;
  blockedTags: TagFilterEntry[];
  settingsJson: string;
};

export type AddressLabelAction = "add" | "remove" | "list" | "clear";

export type AddressLabelEntry = {
  address: string;
  label: string;
};

export type AddressProfileStatus = {
  address: string;
  profileUrl: string;
  checkedAt: string;
  sourceUrl: string;
  hasTrades?: boolean;
  error?: string;
};

export type AddressLabelUpdateResult = {
  action: AddressLabelAction;
  changed: boolean;
  message: string;
  matchedLabel?: AddressLabelEntry;
  addressLabels: AddressLabelEntry[];
  settingsJson: string;
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
  alertRoleChannelName?: string;
  alertRoleGroupTitle?: string;
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
  upsertPolymarketMarket?(
    integration: Integration,
    url: string
  ): { settingsJson: string | null; activeUrl: string | null } | Promise<{ settingsJson: string | null; activeUrl: string | null }>;
  fetchCurrentValue(integration?: Integration): Promise<AdapterValue>;
  fetchEventUpdates?(integration: Integration): Promise<EventMonitorResult>;
  enrichEventPost?(post: EventMonitorPost, strikeTerms: string[]): Promise<EventMonitorPost>;
  shouldAlertOnEventPost?(post: EventMonitorPost): boolean;
  resolveEventPostChannelIds?(integration: Integration, post: EventMonitorPost): string[];
  refreshSettings?(integration: Integration, options?: { force?: boolean }): Promise<string>;
  getStrikeTerms?(integration: Integration): { strikeTerms: string[]; parsedFromUrl?: string; lastParsedAt?: string };
  searchStrikeTerm?(integration: Integration, term: string): Promise<StrikeSearchResult>;
  searchTags?(query: string): Promise<TagSearchResult>;
  updateTagFilters?(integration: Integration, action: TagFilterAction, tagQuery?: string): Promise<TagFilterUpdateResult>;
  updateTagBlocklist?(
    integration: Integration,
    subscriptionTagQuery: string | undefined,
    action: TagFilterAction,
    blockedTagQuery?: string
  ): Promise<TagBlocklistUpdateResult>;
  updateAddressLabels?(
    integration: Integration,
    action: AddressLabelAction,
    addressQuery?: string,
    labelQuery?: string
  ): Promise<AddressLabelUpdateResult>;
  getTagFilters?(integration: Integration): TagFilterEntry[];
};
