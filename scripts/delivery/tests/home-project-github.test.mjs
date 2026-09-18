import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyFieldChanges,
  createProjectGitHub,
  currentDerivedValues,
  listMilestoneClosedIssues,
  listOpenIssues,
  listProjectItems,
  readAndValidateSchema,
  readCurrentIssue,
} from "../home-project-github.mjs";

const config = JSON.parse(await readFile(new URL("../home-project-config.json", import.meta.url), "utf8"));
const done = { hasNextPage: false, endCursor: null };
const response = (data, status = 200) => ({ status, async json() { return structuredClone(data); } });

function liveProject(overrides = {}) {
  return {
    id: config.project.id, number: config.project.number, title: "Home", url: config.project.url,
    owner: { __typename: "User", login: config.project.ownerLogin },
    repositories: { nodes: [config.repository], pageInfo: { hasNextPage: false } },
    fields: {
      nodes: Object.values(config.fields).map((field) => ({
        __typename: "ProjectV2SingleSelectField", id: field.id, name: field.name,
        options: Object.entries(field.options).map(([name, id]) => ({ name, id })),
      })),
      pageInfo: done,
    },
    ...overrides,
  };
}

function schemaApi(project = liveProject()) {
  return { async graphql(query) {
    if (query.includes("fields(first: 100")) return { node: project };
    if (query.includes("nodes(ids: $rootIds)")) return {
      repository: { ...config.repository, milestone: config.milestone },
      nodes: config.roots.map((root) => ({ id: root.id, number: root.number, repository: config.repository })),
    };
    throw new Error("unexpected schema query");
  } };
}

test("actual checked-in schema validates strictly", async () => {
  await readAndValidateSchema(schemaApi(), config);
  for (const mutate of [
    (project) => { project.owner.login = "other"; },
    (project) => { project.owner.__typename = "Organization"; },
    (project) => { project.fields.nodes[0].id = "wrong"; },
    (project) => { project.fields.nodes[0].options.push({ ...project.fields.nodes[0].options[0] }); },
    (project) => { project.fields.nodes[0].options[0].id = project.fields.nodes[0].options[1].id; },
  ]) {
    const project = structuredClone(liveProject());
    mutate(project);
    await assert.rejects(readAndValidateSchema(schemaApi(project), config), /owner|field|options/);
  }
});

test("discovery helpers paginate open, milestone, and archived plus active Project items", async () => {
  for (const [run, selector] of [
    [listOpenIssues, "issues"],
    [listMilestoneClosedIssues, "issues"],
    [listProjectItems, "items"],
  ]) {
    const cursors = [];
    const api = { async graphql(query, variables) {
      cursors.push(variables.cursor);
      if (selector === "items") assert.match(query, /archivedStates: \[ARCHIVED, NOT_ARCHIVED\]/);
      const connection = variables.cursor === null
        ? { nodes: [{ id: "one" }], pageInfo: { hasNextPage: true, endCursor: "next" } }
        : { nodes: [{ id: "two" }], pageInfo: done };
      return selector === "items" ? { node: { items: connection } }
        : query.includes("milestone(number") ? { repository: { milestone: { issues: connection } } }
          : { repository: { issues: connection } };
    } };
    assert.deepEqual((await run(api, config)).map((node) => node.id), ["one", "two"]);
    assert.deepEqual(cursors, [null, "next"]);
  }
  const stuck = { graphql: async () => ({ repository: { issues: {
    nodes: [], pageInfo: { hasNextPage: true, endCursor: "same" },
  } } }) };
  await assert.rejects(listOpenIssues(stuck, config), /did not advance/);
});

test("current read paginates labels and archived memberships and reads named fields without truncation", async () => {
  const calls = [];
  const values = Object.fromEntries(Object.entries(config.fields).map(([key, field]) => [key, {
    __typename: "ProjectV2ItemFieldSingleSelectValue", optionId: Object.values(field.options)[0],
    field: { id: field.id, name: field.name },
  }]));
  const identity = {
    __typename: "Issue", id: "issue", number: 1, state: "OPEN", stateReason: null,
    repository: config.repository, parent: null,
  };
  const api = { async graphql(query, variables) {
    calls.push({ query, variables });
    if (query.includes("projectItems(first")) {
      assert.match(query, /includeArchived: true/);
      assert.match(query, /fieldValueByName/);
    }
    if (query.includes("labels(first") && query.includes("projectItems(first")) return { node: {
      ...identity,
      labels: { nodes: [{ name: "status:todo" }], pageInfo: { hasNextPage: true, endCursor: "labels" } },
      projectItems: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "items" } },
    } };
    if (query.includes("labels(first")) return { node: { labels: { nodes: [{ name: "lane:ops" }], pageInfo: done } } };
    return { node: { projectItems: { nodes: [{ id: "item", project: { id: config.project.id }, ...values }], pageInfo: done } } };
  } };
  const issue = await readCurrentIssue(api, "issue", config);
  assert.deepEqual(issue.labels.map(({ name }) => name), ["status:todo", "lane:ops"]);
  assert.equal(issue.projectItem.id, "item");
  assert.deepEqual(currentDerivedValues(issue.projectItem, config), Object.fromEntries(
    Object.entries(config.fields).map(([key, field]) => [key, Object.values(field.options)[0]]),
  ));
  assert.equal(calls.length, 3);
});

test("changed fields are one allowlisted mutation and every result is validated", async () => {
  const calls = [];
  const changes = [
    { action: "update", fieldId: config.fields.deliveryStatus.id, optionId: config.fields.deliveryStatus.options.Working },
    { action: "clear", fieldId: config.fields.workstream.id },
  ];
  const api = { async graphql(query, variables) {
    calls.push({ query, variables });
    return { change0: { projectV2Item: { id: "item" } }, change1: { projectV2Item: { id: "item" } } };
  } };
  await applyFieldChanges(api, config, "item", changes);
  assert.equal(calls.length, 1);
  assert.match(calls[0].query, /change0: updateProjectV2ItemFieldValue/);
  assert.match(calls[0].query, /change1: clearProjectV2ItemFieldValue/);
  assert.doesNotMatch(calls[0].query, /updateIssue|deleteProjectV2Item|addLabels/);
  await assert.rejects(applyFieldChanges(api, config, "item", [{ action: "clear", fieldId: "other" }]), /unknown Project field/);
});

test("transport closes syntax, HTTP, partial error, and credential disclosure paths", async () => {
  const http = createProjectGitHub({ token: "secret-value", fetchImpl: async () => response({}, 503) });
  await assert.rejects(http.graphql("query { viewer { login } }"), /HTTP 503/);
  const partial = createProjectGitHub({ token: "secret-value", fetchImpl: async () => response({
    data: { node: null }, errors: [{ message: "secret-value forbidden" }],
  }) });
  await assert.rejects(partial.graphql("query { viewer { login } }"), (error) => {
    assert.match(error.message, /\[REDACTED\] forbidden/);
    assert.doesNotMatch(error.message, /secret-value/);
    return true;
  });
  const thrown = createProjectGitHub({ token: "secret-value", fetchImpl: async () => { throw new Error("secret-value leaked"); } });
  await assert.rejects(thrown.graphql("query { viewer { login } }"), (error) => !error.message.includes("secret-value"));
});
