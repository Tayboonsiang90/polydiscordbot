import { fetchWithTimeout } from "../http.js";
import { parseSettingsJson, stringifySettingsJson } from "../settingsJson.js";
import type { AdapterValue, EventMonitorPost, EventMonitorResult, Integration, WebsiteAdapter } from "./types.js";

const owner = "UMA-rocks";
const repo = "voting-committees";
const branch = "voting-committee-1";
const apiBaseUrl = `https://api.github.com/repos/${owner}/${repo}`;
const sourceUrl = `https://github.com/${owner}/${repo}/tree/${branch}`;
const maxPullsPerPoll = 10;
const maxCommitsPerPull = 10;
const maxCommentsPerPoll = 100;
const maxStoredSeenCommits = 80;
const githubTimeoutMs = 15_000;

export type UmaVotingAnswerChange = {
  question: string;
  answer: string;
  previousAnswer: string;
  filename: string;
};

type UmaVotingSettings = {
  umaVotingSeenCommitShas?: string[];
  umaVotingLastPullNumber?: number;
  umaVotingLastRound?: string;
};

type GitHubUser = {
  login?: string;
  html_url?: string;
};

type GitHubPull = {
  number: number;
  title: string;
  html_url: string;
  state?: string;
  created_at?: string;
  updated_at?: string;
  merged_at?: string | null;
  head?: {
    sha?: string;
    ref?: string;
  };
};

type GitHubCommitListItem = {
  sha: string;
  html_url?: string;
  author?: GitHubUser | null;
  commit?: {
    message?: string;
    author?: {
      name?: string;
      date?: string;
    };
    committer?: {
      name?: string;
      date?: string;
    };
  };
};

type GitHubBranch = {
  commit?: GitHubCommitListItem;
};

type GitHubCommitDetail = GitHubCommitListItem & {
  files?: GitHubCommitFile[];
};

type GitHubCommitFile = {
  filename?: string;
  status?: string;
  patch?: string;
};

type GitHubPullActivity = {
  pull: GitHubPull;
  commits: GitHubCommitListItem[];
  posts: EventMonitorPost[];
};

type GitHubIssueComment = {
  id: number;
  body?: string;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  user?: GitHubUser | null;
};

type GitHubReviewComment = {
  id: number;
  body?: string;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  user?: GitHubUser | null;
  path?: string;
};

type GitHubReview = {
  id: number;
  body?: string;
  state?: string;
  html_url?: string;
  submitted_at?: string;
  user?: GitHubUser | null;
};

export const umaVotingCommitteeAdapter: WebsiteAdapter = {
  id: "uma-voting-committee",
  commandName: "umarocks",
  displayName: "UMA.rocks",
  sourceUrl,
  defaultChannelName: "uma-rocks-votes",
  legacyChannelNames: ["umarocks", "uma-votes"],
  alertRoleName: "UMA.rocks Alerts",
  alertRoleEmoji: "\uD83D\uDDF3\uFE0F",
  getPollIntervalMinutes: () => 10,
  getPollIntervalReason: () => "GitHub polling for the active UMA voting committee PR",
  getErrorNoticeWindowMinutes: () => 60,
  async fetchCurrentValue(integration?: Integration): Promise<AdapterValue> {
    if (!integration) {
      throw new Error("UMA.rocks requires an integration record");
    }

    const result = await this.fetchEventUpdates!(integration);
    const latest = result.posts[0];
    const value = latest ? `${latest.type}\n${latest.text}` : "no open UMA voting committee updates found";
    return {
      value,
      rawValue: latest?.id ?? "no-posts",
      observedAt: result.observedAt
    };
  },
  async fetchEventUpdates(integration: Integration): Promise<EventMonitorResult> {
    const observedAt = new Date();
    const [pulls, branchHeadCommit] = await Promise.all([fetchRecentVotingPulls(), fetchVotingBranchHeadCommit()]);
    if (!pulls.length) {
      return {
        posts: [],
        strikeTerms: [],
        observedAt,
        checkTitle: "Voting committee check complete",
        checkFields: [{ name: "Recent PR", value: "No voting committee PR found.", inline: false }]
      };
    }

    const settings = parseUmaVotingSettings(integration.settingsJson);
    const seenCommitShas = new Set(settings.umaVotingSeenCommitShas ?? []);
    const pullsToInspect = selectUmaVotingPullsToInspect(pulls, settings.umaVotingLastPullNumber);
    const latestPullNumber = pulls[0]?.number;
    const activities = await Promise.all(
      pullsToInspect.map((pull) =>
        fetchPullActivity(
          pull,
          seenCommitShas,
          settings.umaVotingLastPullNumber,
          pull.number === latestPullNumber ? branchHeadCommit : null
        )
      )
    );
    const sortedPosts = activities.flatMap((activity) => activity.posts).sort(comparePostsDescending);
    const latestPull = pulls[0];
    return {
      posts: sortedPosts,
      strikeTerms: [],
      observedAt,
      settingsJson: buildNextSettingsJson(
        integration.settingsJson,
        latestPull,
        activities.flatMap((activity) => activity.commits)
      ),
      checkTitle: "Voting committee check complete",
      checkFields: buildCheckFields(latestPull, activities.flatMap((activity) => activity.commits), sortedPosts)
    };
  }
};

export function extractUmaVotingAnswerChangesFromPatch(filename: string, patch: string): UmaVotingAnswerChange[] {
  const changes: UmaVotingAnswerChange[] = [];
  let currentQuestion: string | null = null;
  let previousAnswer: string | null = null;

  for (const rawLine of patch.split("\n")) {
    const marker = rawLine[0];
    if (marker !== " " && marker !== "+" && marker !== "-") {
      continue;
    }

    const line = rawLine.slice(1);
    const question = parseJsonStringProperty(line, "question");
    if (question && marker !== "-") {
      currentQuestion = question;
    }

    const answer = parseJsonStringProperty(line, "answer");
    if (!answer) {
      continue;
    }

    if (marker === "-") {
      previousAnswer = answer;
      continue;
    }

    if (marker === "+" && previousAnswer && previousAnswer !== answer) {
      changes.push({
        question: currentQuestion ?? "Unknown question",
        answer,
        previousAnswer,
        filename
      });
      previousAnswer = null;
    }
  }

  return dedupeAnswerChanges(changes);
}

export function formatUmaVotingAnswerChanges(changes: UmaVotingAnswerChange[], maxShown = 8): string {
  if (!changes.length) {
    return "No changed answers found.";
  }

  const shown = changes.slice(0, maxShown);
  const lines = shown.map((change, index) => {
    const prefix = changes.length > 1 ? `${index + 1}. ` : "";
    return [`**${prefix}Question**`, change.question, "**Answer**", change.answer].join("\n");
  });
  const remaining = changes.length - shown.length;
  if (remaining > 0) {
    lines.push(`...and ${remaining} more changed answer(s).`);
  }

  return lines.join("\n\n");
}

export function selectUmaVotingPullsToInspect(pulls: GitHubPull[], lastPullNumber?: number): GitHubPull[] {
  const sorted = [...pulls].sort((left, right) => right.number - left.number);
  if (lastPullNumber === undefined) {
    return sorted.slice(0, 1);
  }

  const unseenOrCurrent = sorted.filter((pull) => pull.number >= lastPullNumber);
  return unseenOrCurrent.length ? unseenOrCurrent : sorted.slice(0, 1);
}

export function countUmaVotingRequestsFromCommit(commit: GitHubCommitDetail | undefined): number | null {
  const requests = extractUmaVotingRequestsFromCommit(commit);
  return requests.length ? requests.length : null;
}

export function extractUmaVotingRequestsFromCommit(commit: GitHubCommitDetail | undefined): string[] {
  if (!commit) {
    return [];
  }

  return uniqueStrings(
    (commit.files ?? [])
      .filter((file) => file.status === "added" && /^answers\/\d+\/\d+\.json$/.test(file.filename ?? ""))
      .flatMap((file) =>
        file.patch
          ?.split("\n")
          .filter((line) => line.startsWith("+"))
          .map((line) => parseJsonStringProperty(line.slice(1), "question"))
          .filter(isNonEmptyString) ?? []
      )
  );
}

async function fetchPullActivity(
  pull: GitHubPull,
  seenCommitShas: Set<string>,
  lastPullNumber?: number,
  branchHeadCommit: GitHubCommitListItem | null = null
): Promise<GitHubPullActivity> {
  const [pullCommits, issueComments, reviewComments, reviews] = await Promise.all([
    fetchPullCommits(pull.number),
    fetchIssueComments(pull.number),
    fetchReviewComments(pull.number),
    fetchReviews(pull.number)
  ]);
  let commits = mergeCommitLists(pullCommits, branchHeadCommit);
  const unseenCommits = commits.filter((commit) => !seenCommitShas.has(commit.sha));
  let commitDetails = await Promise.all(unseenCommits.map((commit) => fetchCommitDetail(commit.sha)));
  if (
    branchHeadCommit &&
    !pullCommits.some((commit) => commit.sha === branchHeadCommit.sha) &&
    !branchCommitMatchesPull(commitDetails.find((commit) => commit.sha === branchHeadCommit.sha), pull)
  ) {
    commits = pullCommits;
    commitDetails = commitDetails.filter((commit) => commit.sha !== branchHeadCommit.sha);
  }
  const initialCommit = commitDetails.find((commit) => commit.sha === commits[0]?.sha);
  const posts: EventMonitorPost[] = [];

  if (lastPullNumber === undefined || pull.number > lastPullNumber) {
    posts.push(normalizeUmaVotingRequest(pull, extractUmaVotingRequestsFromCommit(initialCommit)));
  }
  for (const commit of commitDetails) {
    posts.push(...normalizeUmaVotingCommit(commit, pull));
  }
  posts.push(...issueComments.map((comment) => normalizeUmaVotingIssueComment(comment, pull)).filter(isEventPost));
  posts.push(...reviewComments.map((comment) => normalizeUmaVotingReviewComment(comment, pull)).filter(isEventPost));
  posts.push(...reviews.map((review) => normalizeUmaVotingReview(review, pull)).filter(isEventPost));

  return { pull, commits, posts };
}

function normalizeUmaVotingRequest(pull: GitHubPull, requests: string[]): EventMonitorPost {
  const round = extractVotingRound(pull.title);
  const status = pull.merged_at ? "Merged" : pull.state === "closed" ? "Closed" : "Open";
  const requestCount = requests.length || null;
  const requestText = requestCount === null ? "an unparsed number of requests" : `${requestCount} request(s)`;
  return {
    id: `uma-vote-request:${pull.number}`,
    type: "UMA voting request",
    alertTitle: "New UMA voting request",
    sourceLabel: "GitHub pull request",
    buttonLabel: "Open request",
    mentionAlertRole: true,
    textFieldName: "Request",
    text: `Voting round ${round ?? "unknown"} opened with ${requestText}.`,
    qualifyingText: `${pull.title}\n${requestText}`,
    postedAt: parseGitHubDate(pull.created_at),
    url: pull.html_url,
    hideDefaultEventFields: true,
    hideLinksField: true,
    fields: [
      { name: "Round", value: round ?? "unknown", inline: true },
      { name: "Requests", value: requestCount === null ? "not parsed" : String(requestCount), inline: true },
      { name: "Status", value: status, inline: true },
      ...(requests.length ? [{ name: "Request preview", value: formatUmaVotingRequestPreview(requests), inline: false }] : [])
    ],
    hiddenFields: buildPullHiddenFields(pull),
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

export function normalizeUmaVotingCommit(commit: GitHubCommitDetail, pull: GitHubPull): EventMonitorPost[] {
  const changes = extractAnswerChangesFromCommit(commit);
  const posts: EventMonitorPost[] = [];
  const author = formatCommitAuthor(commit);
  const postedAt = parseGitHubDate(commit.commit?.committer?.date ?? commit.commit?.author?.date);
  const round = extractVotingRound(pull.title) ?? extractVotingRoundFromCommit(commit);
  const commitUrl = commit.html_url ?? `${apiBaseUrl.replace("api.github.com/repos/", "github.com/")}/commit/${commit.sha}`;

  if (changes.length) {
    posts.push({
      id: `uma-vote-answer:${commit.sha}`,
      type: "UMA voting committee answer",
      alertTitle: "UMA voting answer update",
      sourceLabel: "GitHub commit",
      buttonLabel: "Open commit",
      mentionAlertRole: true,
      textFieldName: "Answers",
      text: formatUmaVotingAnswerChanges(changes),
      qualifyingText: formatUmaVotingAnswerChanges(changes),
      postedAt,
      url: commitUrl,
      hideDefaultEventFields: true,
      hideLinksField: true,
      fields: buildCommitDetailFields(pull, commit, author, round, changes),
      imageUrls: [],
      imageText: "",
      matchedTerms: [],
      strikeTerms: []
    });
  }

  const commitNote = extractCommitNote(commit.commit?.message);
  if (commitNote) {
    posts.push({
      id: `uma-vote-commit-note:${commit.sha}`,
      type: "UMA voting committee comment",
      alertTitle: "UMA voting comment",
      sourceLabel: "GitHub commit",
      buttonLabel: "Open commit",
      mentionAlertRole: true,
      textFieldName: "Comment",
      text: commitNote,
      qualifyingText: commitNote,
      postedAt,
      url: commitUrl,
      hideDefaultEventFields: true,
      hideLinksField: true,
      fields: [
        { name: "Author", value: author, inline: true },
        { name: "Round", value: round ?? "unknown", inline: true }
      ],
      hiddenFields: buildCommitDetailFields(pull, commit, author, round, changes),
      imageUrls: [],
      imageText: "",
      matchedTerms: [],
      strikeTerms: []
    });
  }

  return posts;
}

function normalizeUmaVotingIssueComment(comment: GitHubIssueComment, pull: GitHubPull): EventMonitorPost | null {
  const body = normalizeMultilineText(comment.body);
  if (!body) {
    return null;
  }

  const author = formatUser(comment.user);
  const round = extractVotingRound(pull.title);
  return {
    id: `uma-vote-issue-comment:${comment.id}`,
    type: "UMA voting committee comment",
    alertTitle: "UMA voting comment",
    sourceLabel: "GitHub comment",
    buttonLabel: "Open comment",
    mentionAlertRole: true,
    textFieldName: "Comment",
    text: body,
    qualifyingText: body,
    postedAt: parseGitHubDate(comment.created_at ?? comment.updated_at),
    url: comment.html_url ?? pull.html_url,
    hideDefaultEventFields: true,
    hideLinksField: true,
    fields: [
      { name: "Author", value: author, inline: true },
      { name: "Round", value: round ?? "unknown", inline: true }
    ],
    hiddenFields: buildPullHiddenFields(pull),
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

function normalizeUmaVotingReviewComment(comment: GitHubReviewComment, pull: GitHubPull): EventMonitorPost | null {
  const body = normalizeMultilineText(comment.body);
  if (!body) {
    return null;
  }

  const author = formatUser(comment.user);
  const round = extractVotingRound(pull.title);
  return {
    id: `uma-vote-review-comment:${comment.id}`,
    type: "UMA voting committee review comment",
    alertTitle: "UMA voting review comment",
    sourceLabel: "GitHub review comment",
    buttonLabel: "Open comment",
    mentionAlertRole: true,
    textFieldName: "Comment",
    text: body,
    qualifyingText: body,
    postedAt: parseGitHubDate(comment.created_at ?? comment.updated_at),
    url: comment.html_url ?? pull.html_url,
    hideDefaultEventFields: true,
    hideLinksField: true,
    fields: [
      { name: "Author", value: author, inline: true },
      { name: "Round", value: round ?? "unknown", inline: true }
    ],
    hiddenFields: [
      ...buildPullHiddenFields(pull),
      ...(comment.path ? [{ name: "File", value: comment.path, inline: false }] : [])
    ],
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

function normalizeUmaVotingReview(review: GitHubReview, pull: GitHubPull): EventMonitorPost | null {
  const body = normalizeMultilineText(review.body);
  if (!body) {
    return null;
  }

  const author = formatUser(review.user);
  const round = extractVotingRound(pull.title);
  return {
    id: `uma-vote-review:${review.id}`,
    type: "UMA voting committee review",
    alertTitle: "UMA voting review",
    sourceLabel: "GitHub review",
    buttonLabel: "Open review",
    mentionAlertRole: true,
    textFieldName: "Review comment",
    text: body,
    qualifyingText: body,
    postedAt: parseGitHubDate(review.submitted_at),
    url: review.html_url ?? pull.html_url,
    hideDefaultEventFields: true,
    hideLinksField: true,
    fields: [
      { name: "Author", value: author, inline: true },
      { name: "State", value: review.state ?? "review", inline: true },
      { name: "Round", value: round ?? "unknown", inline: true }
    ],
    hiddenFields: buildPullHiddenFields(pull),
    imageUrls: [],
    imageText: "",
    matchedTerms: [],
    strikeTerms: []
  };
}

function extractAnswerChangesFromCommit(commit: GitHubCommitDetail): UmaVotingAnswerChange[] {
  return dedupeAnswerChanges(
    (commit.files ?? []).flatMap((file) => {
      const filename = file.filename ?? "";
      if (!filename.endsWith(".json") || !filename.startsWith("answers/") || !file.patch) {
        return [];
      }

      return extractUmaVotingAnswerChangesFromPatch(filename, file.patch);
    })
  );
}

function buildCommitDetailFields(
  pull: GitHubPull,
  commit: GitHubCommitDetail,
  author: string,
  round: string | undefined,
  changes: UmaVotingAnswerChange[]
): Array<{ name: string; value: string; inline?: boolean }> {
  return [
    { name: "Author", value: author, inline: true },
    { name: "Round", value: round ?? "unknown", inline: true },
    { name: "Commit", value: commit.sha, inline: false },
    { name: "Files", value: uniqueStrings(changes.map((change) => change.filename)).join("\n") || "none", inline: false },
    ...(changes.length
      ? [{ name: "Previous answers", value: formatPreviousAnswers(changes), inline: false }]
      : []),
    ...buildPullHiddenFields(pull)
  ];
}

function buildPullHiddenFields(pull: GitHubPull): Array<{ name: string; value: string; inline?: boolean }> {
  return [
    { name: "Pull request", value: `#${pull.number} ${pull.title}\n${pull.html_url}`, inline: false },
    ...(pull.head?.sha ? [{ name: "Head SHA", value: pull.head.sha, inline: false }] : [])
  ];
}

function buildCheckFields(
  pull: GitHubPull,
  commits: GitHubCommitListItem[],
  posts: EventMonitorPost[]
): Array<{ name: string; value: string; inline?: boolean }> {
  const latest = posts[0];
  const status = pull.merged_at ? "merged" : pull.state ?? "unknown";
  return [
    { name: "Latest PR", value: `#${pull.number} ${pull.title} (${status})\n${pull.html_url}`, inline: false },
    { name: "Commits checked", value: String(commits.length), inline: true },
    { name: "Events found", value: String(posts.length), inline: true },
    { name: "Latest event", value: latest ? `${latest.type}\n${latest.url}` : "none", inline: false }
  ];
}

function buildNextSettingsJson(settingsJson: string | null, pull: GitHubPull, commits: GitHubCommitListItem[]): string {
  const settings = parseSettingsJson(settingsJson);
  const currentCommitShas = commits.map((commit) => commit.sha).filter(isNonEmptyString);
  const existingCommitShas = getSeenCommitShas(settings);
  return stringifySettingsJson({
    ...settings,
    umaVotingSeenCommitShas: uniqueStrings([...currentCommitShas, ...existingCommitShas]).slice(0, maxStoredSeenCommits),
    umaVotingLastPullNumber: pull.number,
    umaVotingLastRound: extractVotingRound(pull.title)
  });
}

function parseUmaVotingSettings(settingsJson: string | null): UmaVotingSettings {
  const settings = parseSettingsJson(settingsJson);
  return {
    umaVotingSeenCommitShas: getSeenCommitShas(settings),
    umaVotingLastPullNumber:
      typeof settings.umaVotingLastPullNumber === "number" ? settings.umaVotingLastPullNumber : undefined,
    umaVotingLastRound: typeof settings.umaVotingLastRound === "string" ? settings.umaVotingLastRound : undefined
  };
}

function getSeenCommitShas(settings: Record<string, unknown>): string[] {
  return Array.isArray(settings.umaVotingSeenCommitShas)
    ? settings.umaVotingSeenCommitShas.filter(isNonEmptyString)
    : [];
}

async function fetchRecentVotingPulls(): Promise<GitHubPull[]> {
  const url = `${apiBaseUrl}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=all&sort=created&direction=desc&per_page=${maxPullsPerPoll}`;
  return fetchGitHubJson<GitHubPull[]>(url, "recent voting committee PRs");
}

async function fetchVotingBranchHeadCommit(): Promise<GitHubCommitListItem | null> {
  try {
    const result = await fetchGitHubJson<GitHubBranch>(
      `${apiBaseUrl}/branches/${encodeURIComponent(branch)}`,
      "voting committee branch head"
    );
    return result.commit?.sha ? result.commit : null;
  } catch (error) {
    console.warn(
      `UMA.rocks branch-head fast path unavailable; using PR commits only: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

async function fetchPullCommits(pullNumber: number): Promise<GitHubCommitListItem[]> {
  return fetchGitHubJson<GitHubCommitListItem[]>(
    `${apiBaseUrl}/pulls/${pullNumber}/commits?per_page=${maxCommitsPerPull}`,
    "pull request commits"
  );
}

async function fetchCommitDetail(sha: string): Promise<GitHubCommitDetail> {
  return fetchGitHubJson<GitHubCommitDetail>(`${apiBaseUrl}/commits/${encodeURIComponent(sha)}`, "commit detail");
}

async function fetchIssueComments(pullNumber: number): Promise<GitHubIssueComment[]> {
  return fetchGitHubJson<GitHubIssueComment[]>(
    `${apiBaseUrl}/issues/${pullNumber}/comments?per_page=${maxCommentsPerPoll}`,
    "pull request comments"
  );
}

async function fetchReviewComments(pullNumber: number): Promise<GitHubReviewComment[]> {
  return fetchGitHubJson<GitHubReviewComment[]>(
    `${apiBaseUrl}/pulls/${pullNumber}/comments?per_page=${maxCommentsPerPoll}`,
    "pull request review comments"
  );
}

async function fetchReviews(pullNumber: number): Promise<GitHubReview[]> {
  return fetchGitHubJson<GitHubReview[]>(
    `${apiBaseUrl}/pulls/${pullNumber}/reviews?per_page=${maxCommentsPerPoll}`,
    "pull request reviews"
  );
}

async function fetchGitHubJson<T>(url: string, label: string): Promise<T> {
  const response = await fetchWithTimeout(
    url,
    {
      headers: githubHeaders()
    },
    githubTimeoutMs
  );
  if (!response.ok) {
    throw new Error(`GitHub ${label} returned HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "PolymarketResolutionMonitorBot/0.1"
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

function parseJsonStringProperty(line: string, property: string): string | null {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = line.match(new RegExp(`^\\s*"${escapedProperty}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*"|[^,\\s]+)\\s*,?\\s*$`));
  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1]) as unknown;
    if (typeof parsed === "string") {
      return parsed;
    }
    if (typeof parsed === "number" || typeof parsed === "boolean") {
      return String(parsed);
    }
  } catch {
    return null;
  }

  return null;
}

function extractCommitNote(message: string | undefined): string | null {
  const normalized = normalizeMultilineText(message);
  if (!normalized) {
    return null;
  }

  const lines = normalized.split("\n");
  const note = lines.slice(1).join("\n").trim();
  return note || null;
}

function normalizeMultilineText(value: string | undefined): string | null {
  const normalized = value?.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  return normalized || null;
}

function formatCommitAuthor(commit: GitHubCommitListItem): string {
  return commit.author?.login ?? commit.commit?.author?.name ?? commit.commit?.committer?.name ?? "unknown";
}

function formatUser(user: GitHubUser | null | undefined): string {
  return user?.login ?? "unknown";
}

function extractVotingRound(title: string | undefined): string | undefined {
  return title?.match(/voting round\s+(\d+)/i)?.[1];
}

function extractVotingRoundFromCommit(commit: GitHubCommitDetail): string | undefined {
  for (const file of commit.files ?? []) {
    const round = file.filename?.match(/^answers\/(\d+)\//)?.[1];
    if (round) {
      return round;
    }
  }

  return undefined;
}

function branchCommitMatchesPull(commit: GitHubCommitDetail | undefined, pull: GitHubPull): boolean {
  if (!commit) {
    return false;
  }

  const commitRound = extractVotingRoundFromCommit(commit);
  const pullRound = extractVotingRound(pull.title);
  return !commitRound || !pullRound || commitRound === pullRound;
}

function mergeCommitLists(
  pullCommits: GitHubCommitListItem[],
  branchHeadCommit: GitHubCommitListItem | null
): GitHubCommitListItem[] {
  if (!branchHeadCommit || pullCommits.some((commit) => commit.sha === branchHeadCommit.sha)) {
    return pullCommits;
  }
  return [...pullCommits, branchHeadCommit];
}

function parseGitHubDate(value: string | undefined): Date {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatPreviousAnswers(changes: UmaVotingAnswerChange[]): string {
  const lines = changes.slice(0, 12).map((change) => `${change.question}: ${change.previousAnswer} -> ${change.answer}`);
  const remaining = changes.length - lines.length;
  if (remaining > 0) {
    lines.push(`...and ${remaining} more changed answer(s).`);
  }
  return lines.join("\n");
}

function formatUmaVotingRequestPreview(requests: string[], maxShown = 5): string {
  const shown = requests.slice(0, maxShown).map((question, index) => `${index + 1}. ${question}`);
  const remaining = requests.length - shown.length;
  if (remaining > 0) {
    shown.push(`...and ${remaining} more request(s).`);
  }
  return shown.join("\n").slice(0, 1_024);
}

function dedupeAnswerChanges(changes: UmaVotingAnswerChange[]): UmaVotingAnswerChange[] {
  const seen = new Set<string>();
  const deduped: UmaVotingAnswerChange[] = [];
  for (const change of changes) {
    const key = `${change.filename}\u0000${change.question}\u0000${change.answer}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(change);
  }
  return deduped;
}

function comparePostsDescending(left: EventMonitorPost, right: EventMonitorPost): number {
  const dateDiff = right.postedAt.getTime() - left.postedAt.getTime();
  return dateDiff !== 0 ? dateDiff : right.id.localeCompare(left.id);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isEventPost(post: EventMonitorPost | null): post is EventMonitorPost {
  return post !== null;
}
