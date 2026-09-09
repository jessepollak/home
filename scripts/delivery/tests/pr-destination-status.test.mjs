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
        return { status: 200, async json() { return value; } };
      }
      assert.equal(init.method, "POST");
      return { status: 201 };
    },
  };
}

const options = {
  repository: "jessepollak/home",
  apiUrl: "https://api.github.test",
  token: "fixture-token",
};

test("publishes the stable destination context on the live verified head SHA", async () => {
  const payload = await fixture("direct-main");
  payload.pull_request.head = { sha: "1".repeat(40) };
  const current = livePullRequest(payload, "2".repeat(40));
  const github = mockGitHub([current, current, current]);

  const result = await publishCurrentHeadDestinationStatus(payload, {
    ...options,
    fetchImpl: github.fetchImpl,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.headSha, "2".repeat(40));
  assert.equal(result.context, DESTINATION_STATUS_CONTEXT);
  const post = github.calls.find((call) => call.method === "POST");
  assert.match(post.url, new RegExp(`/statuses/${"2".repeat(40)}$`));
  assert.deepEqual(JSON.parse(post.body), {
    context: DESTINATION_STATUS_CONTEXT,
    description: "Direct-to-main destination verified on the current PR head.",
    state: "success",
  });
  assert.ok(github.calls.every((call) => call.method === "GET" || call.method === "POST"));
});

test("a new head observed before publication is the only SHA receiving status", async () => {
  const payload = await fixture("direct-main");
  const oldHead = livePullRequest(payload, "a".repeat(40));
  const newHead = livePullRequest(payload, "b".repeat(40));
  const github = mockGitHub([oldHead, newHead, newHead, newHead]);

  const result = await publishCurrentHeadDestinationStatus(payload, {
    ...options,
    fetchImpl: github.fetchImpl,
  });

  assert.equal(result.headSha, "b".repeat(40));
  const posts = github.calls.filter((call) => call.method === "POST");
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, new RegExp(`/statuses/${"b".repeat(40)}$`));
  assert.ok(!posts[0].url.includes("a".repeat(40)));
});

test("a head change immediately after publication is reconciled onto the new current head", async () => {
  const payload = await fixture("direct-main");
  const oldHead = livePullRequest(payload, "e".repeat(40));
  const newHead = livePullRequest(payload, "f".repeat(40));
  const github = mockGitHub([oldHead, oldHead, newHead, newHead, newHead]);

  const result = await publishCurrentHeadDestinationStatus(payload, {
    ...options,
    fetchImpl: github.fetchImpl,
  });

  assert.equal(result.headSha, "f".repeat(40));
  const posts = github.calls.filter((call) => call.method === "POST");
  assert.equal(posts.length, 2);
  assert.match(posts[0].url, new RegExp(`/statuses/${"e".repeat(40)}$`));
  assert.match(posts[1].url, new RegExp(`/statuses/${"f".repeat(40)}$`));
});

test("a base retarget observed before publication is re-evaluated on the same head", async () => {
  const payload = await fixture("direct-main");
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
  const posts = github.calls.filter((call) => call.method === "POST");
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].body), {
    context: DESTINATION_STATUS_CONTEXT,
    description: "Stacked pull requests cannot carry delivery promotion labels: status:needs-jesse.",
    state: "failure",
  });
});

test("retry exhaustion after success replaces a same-head stale success with failure", async () => {
  const payload = await fixture("direct-main");
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

  const posts = github.calls.filter((call) => call.method === "POST");
  assert.equal(posts.length, 2);
  assert.ok(posts.every((post) => post.url.endsWith(`/statuses/${"9".repeat(40)}`)));
  assert.deepEqual(posts.map((post) => JSON.parse(post.body)), [
    {
      context: DESTINATION_STATUS_CONTEXT,
      description: "Direct-to-main destination verified on the current PR head.",
      state: "success",
    },
    {
      context: DESTINATION_STATUS_CONTEXT,
      description: "PR changed during destination verification; retry required.",
      state: "failure",
    },
  ]);
});

test("retry exhaustion before publication fails the last verified open head", async () => {
  const payload = await fixture("direct-main");
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

  const posts = github.calls.filter((call) => call.method === "POST");
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, new RegExp(`/statuses/${"8".repeat(40)}$`));
  assert.deepEqual(JSON.parse(posts[0].body), {
    context: DESTINATION_STATUS_CONTEXT,
    description: "PR changed during destination verification; retry required.",
    state: "failure",
  });
});

test("rejects mismatched repository data and non-40-hex live heads without publication", async () => {
  const payload = await fixture("direct-main");
  const wrongRepository = livePullRequest(payload, "d".repeat(40));
  wrongRepository.base.repo.full_name = "other/repository";
  const repositoryGithub = mockGitHub([wrongRepository]);
  await assert.rejects(
    publishCurrentHeadDestinationStatus(payload, {
      ...options,
      fetchImpl: repositoryGithub.fetchImpl,
    }),
    /repository mismatch/,
  );
  assert.equal(repositoryGithub.calls.some((call) => call.method === "POST"), false);

  const badSha = livePullRequest(payload, "not-a-sha");
  const shaGithub = mockGitHub([badSha]);
  await assert.rejects(
    publishCurrentHeadDestinationStatus(payload, {
      ...options,
      fetchImpl: shaGithub.fetchImpl,
    }),
    /head SHA/,
  );
  assert.equal(shaGithub.calls.some((call) => call.method === "POST"), false);
});
