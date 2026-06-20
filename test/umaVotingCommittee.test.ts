import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractUmaVotingAnswerChangesFromPatch,
  formatUmaVotingAnswerChanges,
  umaVotingCommitteeAdapter
} from "../src/integrations/umaVotingCommittee.js";
import type { Integration } from "../src/integrations/types.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("UMA voting committee adapter", () => {
  it("extracts only changed question and answer pairs from answer-file patches", () => {
    const patch = [
      "@@ -1,5 +1,5 @@",
      "     {",
      '         "question": "Will the highest temperature in Moscow be 4\\u00b0C or below on May 29?",',
      '-        "answer": "P0"',
      '+        "answer": "P4"',
      "     }"
    ].join("\n");

    expect(extractUmaVotingAnswerChangesFromPatch("answers/10302/1.json", patch)).toEqual([
      {
        question: "Will the highest temperature in Moscow be 4\u00b0C or below on May 29?",
        answer: "P4",
        previousAnswer: "P0",
        filename: "answers/10302/1.json"
      }
    ]);
  });

  it("does not treat initial added default answers as submitted updates", () => {
    const patch = [
      "@@ -0,0 +1,5 @@",
      "+    {",
      '+        "question": "Default placeholder?",',
      '+        "answer": "P0"',
      "+    }"
    ].join("\n");

    expect(extractUmaVotingAnswerChangesFromPatch("answers/10302/1.json", patch)).toEqual([]);
  });

  it("formats answer updates without ancillary JSON fields", () => {
    const text = formatUmaVotingAnswerChanges([
      {
        question: "Will the highest temperature in Moscow be 4\u00b0C or below on May 29?",
        answer: "P4",
        previousAnswer: "P0",
        filename: "answers/10302/1.json"
      }
    ]);

    expect(text).toBe(
      [
        "**Question**",
        "Will the highest temperature in Moscow be 4\u00b0C or below on May 29?",
        "**Answer**",
        "P4"
      ].join("\n")
    );
  });

  it("fetches answer changes and contributor comments from the active GitHub PR", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/pulls?")) {
        return jsonResponse([
          {
            number: 37,
            title: "Answers for voting round 10302",
            html_url: "https://github.com/UMA-rocks/voting-committees/pull/37",
            head: { sha: "newsha", ref: "voting-committee-1" }
          }
        ]);
      }
      if (url.endsWith("/pulls/37/commits?per_page=10")) {
        return jsonResponse([
          {
            sha: "newsha",
            html_url: "https://github.com/UMA-rocks/voting-committees/commit/newsha",
            author: { login: "jessioc" },
            commit: {
              message: "Update 1.json\n\nI think P4 is the right answer.",
              author: { name: "jessioc", date: "2026-05-31T04:01:26Z" },
              committer: { name: "GitHub", date: "2026-05-31T04:01:26Z" }
            }
          }
        ]);
      }
      if (url.endsWith("/commits/newsha")) {
        return jsonResponse({
          sha: "newsha",
          html_url: "https://github.com/UMA-rocks/voting-committees/commit/newsha",
          author: { login: "jessioc" },
          commit: {
            message: "Update 1.json\n\nI think P4 is the right answer.",
            author: { name: "jessioc", date: "2026-05-31T04:01:26Z" },
            committer: { name: "GitHub", date: "2026-05-31T04:01:26Z" }
          },
          files: [
            {
              filename: "answers/10302/1.json",
              status: "modified",
              patch: [
                "@@ -1,5 +1,5 @@",
                "     {",
                '         "question": "Will the highest temperature in Moscow be 4\\u00b0C or below on May 29?",',
                '-        "answer": "P0"',
                '+        "answer": "P4"',
                "     }"
              ].join("\n")
            }
          ]
        });
      }
      if (url.endsWith("/issues/37/comments?per_page=100")) {
        return jsonResponse([
          {
            id: 11,
            body: "Line-level discussion belongs here.",
            html_url: "https://github.com/UMA-rocks/voting-committees/pull/37#issuecomment-11",
            created_at: "2026-05-31T04:02:00Z",
            user: { login: "cruzpoly" }
          }
        ]);
      }
      if (url.endsWith("/pulls/37/comments?per_page=100")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/pulls/37/reviews?per_page=100")) {
        return jsonResponse([
          {
            id: 22,
            body: "Agree with this answer.",
            state: "COMMENTED",
            html_url: "https://github.com/UMA-rocks/voting-committees/pull/37#pullrequestreview-22",
            submitted_at: "2026-05-31T04:03:00Z",
            user: { login: "okayway" }
          }
        ]);
      }

      throw new Error(`Unhandled URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await umaVotingCommitteeAdapter.fetchEventUpdates!(buildIntegration());
    const answerPost = result.posts.find((post) => post.id === "uma-vote-answer:newsha");
    const commitNotePost = result.posts.find((post) => post.id === "uma-vote-commit-note:newsha");
    const issueCommentPost = result.posts.find((post) => post.id === "uma-vote-issue-comment:11");
    const reviewPost = result.posts.find((post) => post.id === "uma-vote-review:22");

    expect(answerPost).toMatchObject({
      alertTitle: "UMA voting answer update",
      mentionAlertRole: true,
      hideDefaultEventFields: true,
      hideLinksField: true,
      text: expect.stringContaining("P4")
    });
    expect(answerPost?.text).toContain("Will the highest temperature in Moscow be 4\u00b0C or below on May 29?");
    expect(answerPost?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Author", value: "jessioc" }),
        expect.objectContaining({ name: "Round", value: "10302" }),
        expect.objectContaining({
          name: "Previous answers",
          value: "Will the highest temperature in Moscow be 4\u00b0C or below on May 29?: P0 -> P4"
        })
      ])
    );
    expect(answerPost?.hiddenFields).toBeUndefined();
    expect(commitNotePost?.text).toBe("I think P4 is the right answer.");
    expect(issueCommentPost?.text).toBe("Line-level discussion belongs here.");
    expect(reviewPost?.text).toBe("Agree with this answer.");
    expect(JSON.parse(result.settingsJson ?? "{}")).toMatchObject({
      umaVotingSeenCommitShas: ["newsha"],
      umaVotingLastPullNumber: 37,
      umaVotingLastRound: "10302"
    });
  });
});

function buildIntegration(): Integration {
  return {
    id: 1,
    guildId: "guild",
    channelId: "channel",
    adapterId: "uma-voting-committee",
    displayName: "UMA.rocks",
    sourceUrl: "https://github.com/UMA-rocks/voting-committees/tree/voting-committee-1",
    polymarketUrl: null,
    alertRoleId: "role",
    roleMessageId: null,
    roleChannelId: null,
    roleEmoji: null,
    settingsJson: null,
    pollIntervalMinutes: 10,
    status: "active",
    lastValue: null,
    lastCheckedAt: null,
    lastChangedAt: null,
    snapshotValue: null,
    snapshotCheckedAt: null,
    snapshotDate: null,
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z"
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
