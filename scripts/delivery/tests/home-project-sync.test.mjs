import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { reconcileHomeProject } from "../sync-home-project.mjs";

const config = JSON.parse(await readFile(new URL("../home-project-config.json", import.meta.url), "utf8"));
const done = { hasNextPage: false, endCursor: null };

function schemaProject() {
  return {
    id: config.project.id, number: config.project.number, title: "Home", url: config.project.url,
    owner: { __typename: "User", login: config.project.ownerLogin },
    repositories: { nodes: [config.repository], pageInfo: { hasNextPage: false } },
    fields: { nodes: Object.values(config.fields).map((field) => ({
      __typename: "ProjectV2SingleSelectField", id: field.id, name: field.name,
      options: Object.entries(field.options).map(([name, id]) => ({ name, id })),
    })), pageInfo: done },
  };
}

function fieldValue(field, optionId) {
  return optionId == null ? null : {
    __typename: "ProjectV2ItemFieldSingleSelectValue", optionId,
    field: { id: field.id, name: field.name },
  };
}

function createHarness({ malformedParent = false, unclassified = false } = {}) {
  const items = new Map();
  const mutations = [];
  const roots = new Map(config.roots.map((root) => [root.id, root]));
  const extra = { __typename: "Issue", id: "unclassified", number: 999, repository: config.repository, parent: null };
  if (unclassified) {
    roots.set(extra.id, extra);
    items.set(extra.id, {
      deliveryStatus: config.fields.deliveryStatus.options.Todo,
      workstream: config.fields.workstream.options.Invest,
      level: config.fields.level.options.Delivery,
    });
  }
  function current(root) {
    const values = items.get(root.id);
    return {
      __typename: "Issue", id: root.id, number: root.number, state: "OPEN", stateReason: null,
      repository: config.repository,
      parent: malformedParent && root.number === Math.min(...config.roots.map((entry) => entry.number))
        ? { id: null, number: null, repository: null }
        : null,
      labels: { nodes: [{ name: "status:todo" }], pageInfo: done },
      projectItems: { nodes: values ? [{
        id: `item-${root.number}`, project: { id: config.project.id },
        deliveryStatus: fieldValue(config.fields.deliveryStatus, values.deliveryStatus),
        workstream: fieldValue(config.fields.workstream, values.workstream),
        level: fieldValue(config.fields.level, values.level),
      }] : [], pageInfo: done },
    };
  }
  return {
    mutations,
    items,
    api: { async graphql(query, variables) {
      if (query.includes("fields(first: 100")) return { node: schemaProject() };
      if (query.includes("nodes(ids: $rootIds)")) return {
        repository: { ...config.repository, milestone: config.milestone },
        nodes: config.roots.map((root) => ({ id: root.id, number: root.number, repository: config.repository })),
      };
      if (query.includes("states: OPEN")) return { repository: { issues: {
        nodes: unclassified ? [extra] : [], pageInfo: done,
      } } };
      if (query.includes("states: CLOSED")) return { repository: { milestone: { issues: { nodes: [], pageInfo: done } } } };
      if (query.includes("items(first: 100")) return { node: { items: { nodes: [], pageInfo: done } } };
      if (query.includes("projectItems(first: 100")) return { node: current(roots.get(variables.id)) };
      if (query.includes("addProjectV2ItemById")) {
        mutations.push("add");
        items.set(variables.content, { deliveryStatus: null, workstream: null, level: null });
        return { addProjectV2ItemById: { item: { id: `item-${roots.get(variables.content).number}` } } };
      }
      if (query.startsWith("mutation(")) {
        mutations.push("fields");
        const root = [...roots.values()].find((entry) => `item-${entry.number}` === variables.item);
        const values = items.get(root.id);
        const result = {};
        for (let index = 0; Object.hasOwn(variables, `field${index}`); index += 1) {
          const [key] = Object.entries(config.fields).find(([, field]) => field.id === variables[`field${index}`]);
          values[key] = variables[`option${index}`] ?? null;
          result[`change${index}`] = { projectV2Item: { id: variables.item } };
        }
        return result;
      }
      throw new Error("unexpected test query");
    } },
  };
}

test("live add/update/clear followed by repeat reconciliation is a no-op", async () => {
  const harness = createHarness({ unclassified: true });
  const first = await reconcileHomeProject({ api: harness.api, config, dryRun: false });
  assert.equal(first.added, 8);
  assert.equal(first.updated, 24);
  assert.equal(first.cleared, 1);
  assert.deepEqual(harness.mutations, [...Array.from({ length: 8 }, () => ["add", "fields"]).flat(), "fields"]);
  harness.mutations.length = 0;
  const repeat = await reconcileHomeProject({ api: harness.api, config, dryRun: false });
  assert.equal(repeat.unchanged, 9);
  assert.deepEqual(harness.mutations, []);
});

test("dry-run performs no writes and reports additions without claiming they happened", async () => {
  const harness = createHarness();
  const result = await reconcileHomeProject({ api: harness.api, config, dryRun: true });
  assert.equal(result.wouldAdd, 8);
  assert.equal(result.added, 0);
  assert.equal(result.wouldUpdate, 24);
  assert.deepEqual(harness.mutations, []);
  assert.equal(result.issues.every((issue) => issue.add === true), true);
});

test("malformed parent fails before an unclassified clear or any mutation", async () => {
  const harness = createHarness({ malformedParent: true });
  await assert.rejects(reconcileHomeProject({ api: harness.api, config, dryRun: false }), /malformed.*native parent/);
  assert.deepEqual(harness.mutations, []);
});
