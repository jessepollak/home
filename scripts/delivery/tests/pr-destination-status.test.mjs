import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DESTINATION_STATUS_CONTEXT,
  publishCurrentHeadDestinationStatus,
} from "../publish-pr-destination-status.mjs";

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
}

async function destinationPayload(sha = "1".repeat(40)) {
  const payload = await fixture("direct-main");
  payload.pull_request.head = { sha };
  return payload;
}

function livePullRequest(payload, sha) {
  const pullRequest = structuredClone(payload.pull_request);
  pullRequest.head = { sha };
  pullRequest.base.repo = { full_name: payload.repository.full_name };
  return pullRequest;
}

function mockGitHub(liveResponses) {
  const remaining = liveResponses.map((value) => structuredClone(value));
  const calls = [];
  return {
    calls,
    async fetchImpl(url, init) {
      calls.push({
        body: init.body,
        method: init.method,
        url: String(url),
      });
      if (init.method === "GET") {
        const value = remaining.shift();
        assert.ok(value, "unexpected extra pull request GET");
        if (value.httpStatus) return { status: value.httpStatus };
        return { status: 200, async json() { return value; } };
      }
      assert.equal(init.method, "POST");
      return { status: 201 };
    },
  };
}

function statusPosts(github) {
  return github.calls
    .filter((call) => call.method === "POST")
    .map((call) => ({
      ...JSON.parse(call.body),
      headSha: call.url.split("/").at(-1),
    }));
}

function latestStateByHead(github) {
  return Object.fromEntries(statusPosts(github).map((post) => [post.headSha, post.state]));
}

const options = {
  repository: "jessepollak/home",
  apiUrl: "https://api.github.test",
  token: "fixture-token",
};

const pendingStatus = {
  context: DESTINATION_STATUS_CONTEXT,
  description: "PR destination verification is pending refresh.",
  state: "pending",
};

test("invalidates the trusted event head before publishing success on a different stable live head", async () => {
  const payload = await destinationPayload("1".repeat(40));
  const current = livePullRequest(payload, "2".repeat(40));
  const github = mockGitHub([current, current, current]);

  const result = await publishCurrentHeadDestinationStatus(payload, {
    ...options,
    fetchImpl: github.fetchImpl,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.headSha, "2".repeat(40));
  assert.equal(result.context, DESTINATION_STATUS_CONTEXT);
  assert.deepEqual(statusPosts(github), [
    { ...pendingStatus, headSha: "1".repeat(40) },
    { ...pendingStatus, headSha: "2".repeat(40) },
    {
      context: DESTINATION_STATUS_CONTEXT,
      description: "Direct-to-main destination verified on the current PR head.",
      headSha: "2".repeat(40),
      state: "success",
    },
  ]);
});

test("a new head observed before publication receives pending before the only final success", async () => {
  const payload = await destinationPayload("a".repeat(40));
  const oldHead = livePullRequest(payload, "a".repeat(40));
  const newHead = livePullRequest(payload, "b".repeat(40));
  const github = mockGitHub([oldHead, newHead, newHead, newHead]);

  const result = await publishCurrentHeadDestinationStatus(payload, {
    ...options,
    fetchImpl: github.fetchImpl,
  });

  assert.equal(result.headSha, "b".repeat(40));
  assert.deepEqual(latestStateByHead(github), {
    ["a".repeat(40)]: "pending",
    ["b".repeat(40)]: "success",
  });
  assert.deepEqual(
    statusPosts(github).filter((post) => post.state === "success").map((post) => post.headSha),
    ["b".repeat(40)],
  );
});

test("a head change immediately after publication invalidates old success and reconciles the new head", async () => {
  const payload = await destinationPayload("e".repeat(40));
  const oldHead = livePullRequest(payload, "e".repeat(40));
  const newHead = livePullRequest(payload, "f".repeat(40));
  const github = mockGitHub([oldHead, oldHead, newHead, newHead, newHead]);

  const result = await publishCurrentHeadDestinationStatus(payload, {
    ...options,
    fetchImpl: github.fetchImpl,
  });

  assert.equal(result.headSha, "f".repeat(40));
  assert.deepEqual(latestStateByHead(github), {
    ["e".repeat(40)]: "pending",
    ["f".repeat(40)]: "success",
  });
});

test("a base retarget observed before publication is re-evaluated on the same pending head", async () => {
  const payload = await destinationPayload("c".repeat(40));
  const directMain = livePullRequest(payload, "c".repeat(40));
  const promotedStack = structuredClone(directMain);
  promotedStack.base.ref = "feature/dependency";
  promotedStack.labels.push({ name: "delivery:stacked" });
  promotedStack.labels = promotedStack.labels.filter((label) => label.name !== "status:ready-for-review");
  promotedStack.labels.push({ name: "status:needs-jesse" });
  const github = mockGitHub([directMain, promotedStack, promotedStack, promotedStack]);

  const result = await publishCurrentHeadDestinationStatus(payload, {
    ...options,
    fetchImpl: github.fetchImpl,
  });

  assert.equal(result.allowed, false);
  assert.deepEqual(statusPosts(github).map(({ state }) => state), ["pending", "failure"]);
  assert.deepEqual(statusPosts(github).at(-1), {
    context: DESTINATION_STATUS_CONTEXT,
    description: "Stacked pull requests cannot carry delivery promotion labels: status:needs-jesse.",
    headSha: "c".repeat(40),
    state: "failure",
  });
});

test("a stable invalid destination replaces prior success with a final failure", async () => {
  const payload = await destinationPayload("3".repeat(40));
  const invalid = livePullRequest(payload, "3".repeat(40));
  invalid.labels.push({ name: "delivery:stacked" });
  const github = mockGitHub([invalid, invalid, invalid]);

  const result = await publishCurrentHeadDestinationStatus(payload, {
    ...options,
    fetchImpl: github.fetchImpl,
  });

  assert.equal(result.allowed, false);
  assert.deepEqual(statusPosts(github).map(({ state }) => state), ["pending", "failure"]);
  assert.equal(latestStateByHead(github)["3".repeat(40)], "failure");
});

test("same-head metadata refresh invalidates prior success before an initial GET 503", async () => {
  const payload = await destinationPayload("4".repeat(40));
  payload.action = "labeled";
  payload.pull_request.labels.push({ name: "delivery:stacked" });
  const github = mockGitHub([{ httpStatus: 503 }]);

  await assert.rejects(
    publishCurrentHeadDestinationStatus(payload, {
      ...options,
      fetchImpl: github.fetchImpl,
    }),
    /HTTP 503/,
  );

  assert.deepEqual(statusPosts(github), [
    { ...pendingStatus, headSha: "4".repeat(40) },
  ]);
});

test("a newly observed live head is pending when the next verification GET fails", async () => {
  const payload = await destinationPayload("5".repeat(40));
  const newHead = livePullRequest(payload, "6".repeat(40));
  const github = mockGitHub([newHead, { httpStatus: 503 }]);

  await assert.rejects(
    publishCurrentHeadDestinationStatus(payload, {
      ...options,
      fetchImpl: github.fetchImpl,
    }),
    /HTTP 503/,
  );

  assert.deepEqual(latestStateByHead(github), {
    ["5".repeat(40)]: "pending",
    ["6".repeat(40)]: "pending",
  });
});

test("a post-success read failure best-effort restores a non-success status", async () => {
  const payload = await destinationPayload("7".repeat(40));
  const current = livePullRequest(payload, "7".repeat(40));
  const github = mockGitHub([current, current, { httpStatus: 503 }]);

  await assert.rejects(
    publishCurrentHeadDestinationStatus(payload, {
      ...options,
      fetchImpl: github.fetchImpl,
    }),
    /HTTP 503/,
  );

  assert.deepEqual(statusPosts(github).map(({ state }) => state), [
    "pending",
    "success",
    "pending",
  ]);
  assert.equal(latestStateByHead(github)["7".repeat(40)], "pending");
});

test("retry exhaustion after success replaces the same-head success with failure", async () => {
  const payload = await destinationPayload("9".repeat(40));
  const directMain = livePullRequest(payload, "9".repeat(40));
  const retargeted = structuredClone(directMain);
  retargeted.base.ref = "feature/dependency";
  const github = mockGitHub([directMain, directMain, retargeted]);

  await assert.rejects(
    publishCurrentHeadDestinationStatus(payload, {
      ...options,
      fetchImpl: github.fetchImpl,
      maxAttempts: 1,
    }),
    /changed repeatedly/,
  );

  assert.deepEqual(statusPosts(github).map(({ state }) => state), [
    "pending",
    "success",
    "pending",
    "failure",
  ]);
  assert.equal(latestStateByHead(github)["9".repeat(40)], "failure");
});

test("retry exhaustion before publication fails the last verified open head", async () => {
  const payload = await destinationPayload("7".repeat(40));
  const oldHead = livePullRequest(payload, "7".repeat(40));
  const currentHead = livePullRequest(payload, "8".repeat(40));
  const github = mockGitHub([oldHead, currentHead]);

  await assert.rejects(
    publishCurrentHeadDestinationStatus(payload, {
      ...options,
      fetchImpl: github.fetchImpl,
      maxAttempts: 1,
    }),
    /changed repeatedly/,
  );

  assert.deepEqual(statusPosts(github), [
    { ...pendingStatus, headSha: "7".repeat(40) },
    { ...pendingStatus, headSha: "8".repeat(40) },
    {
      context: DESTINATION_STATUS_CONTEXT,
      description: "PR changed during destination verification; retry required.",
      headSha: "8".repeat(40),
      state: "failure",
    },
  ]);
});

test("a currently closed PR receives no final success or failure", async () => {
  const payload = await destinationPayload("a".repeat(40));
  const closed = livePullRequest(payload, "a".repeat(40));
  closed.state = "closed";
  const github = mockGitHub([closed]);

  const result = await publishCurrentHeadDestinationStatus(payload, {
    ...options,
    fetchImpl: github.fetchImpl,
  });

  assert.deepEqual(result, {
    allowed: false,
    headSha: "a".repeat(40),
    published: false,
    reason: "pull-request-closed",
  });
  assert.deepEqual(statusPosts(github), [
    { ...pendingStatus, headSha: "a".repeat(40) },
  ]);
});

test("malformed or foreign event identity, event head, and retry config cause no writes", async () => {
  const foreignPayload = await destinationPayload("b".repeat(40));
  foreignPayload.repository.full_name = "other/repository";
  const foreignGithub = mockGitHub([]);
  await assert.rejects(
    publishCurrentHeadDestinationStatus(foreignPayload, {
      ...options,
      fetchImpl: foreignGithub.fetchImpl,
    }),
    /does not match/,
  );
  assert.deepEqual(foreignGithub.calls, []);

  const badHeadPayload = await destinationPayload("b".repeat(39));
  const badHeadGithub = mockGitHub([]);
  await assert.rejects(
    publishCurrentHeadDestinationStatus(badHeadPayload, {
      ...options,
      fetchImpl: badHeadGithub.fetchImpl,
    }),
    /event pull request head SHA/,
  );
  assert.deepEqual(badHeadGithub.calls, []);

  const badConfigPayload = await destinationPayload("b".repeat(40));
  const badConfigGithub = mockGitHub([]);
  await assert.rejects(
    publishCurrentHeadDestinationStatus(badConfigPayload, {
      ...options,
      fetchImpl: badConfigGithub.fetchImpl,
      maxAttempts: 0,
    }),
    /attempt count/,
  );
  assert.deepEqual(badConfigGithub.calls, []);
});

test("invalid live repository or head data leaves only the trusted event-head invalidation", async () => {
  const repositoryPayload = await destinationPayload("c".repeat(40));
  const wrongRepository = livePullRequest(repositoryPayload, "d".repeat(40));
  wrongRepository.base.repo.full_name = "other/repository";
  const repositoryGithub = mockGitHub([wrongRepository]);
  await assert.rejects(
    publishCurrentHeadDestinationStatus(repositoryPayload, {
      ...options,
      fetchImpl: repositoryGithub.fetchImpl,
    }),
    /repository mismatch/,
  );
  assert.deepEqual(statusPosts(repositoryGithub), [
    { ...pendingStatus, headSha: "c".repeat(40) },
  ]);

  const shaPayload = await destinationPayload("e".repeat(40));
  const badSha = livePullRequest(shaPayload, "f".repeat(40));
  badSha.head.sha = "not-a-sha";
  const shaGithub = mockGitHub([badSha]);
  await assert.rejects(
    publishCurrentHeadDestinationStatus(shaPayload, {
      ...options,
      fetchImpl: shaGithub.fetchImpl,
    }),
    /head SHA/,
  );
  assert.deepEqual(statusPosts(shaGithub), [
    { ...pendingStatus, headSha: "e".repeat(40) },
  ]);
});
