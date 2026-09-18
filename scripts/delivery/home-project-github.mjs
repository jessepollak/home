const API_URL = "https://api.github.com/graphql";
const PAGE_INFO = `pageInfo { hasNextPage endCursor }`;
const ISSUE_IDENTITY = `id number state stateReason repository { id nameWithOwner } parent { id number repository { id nameWithOwner } }`;

function sanitize(message, token) {
  const text = message instanceof Error ? message.message : String(message);
  return token ? text.split(token).join("[REDACTED]") : text;
}

function headers(token) {
  if (typeof token !== "string" || token.length === 0) throw new Error("HOME_PROJECT_TOKEN is required");
  return {
    Accept: "application/vnd.github+json",
    ["Authorization"]: ["Bearer", token].join(" "),
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export function createProjectGitHub(options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? API_URL;
  const token = options.token;
  if (new URL(endpoint).protocol !== "https:") throw new Error("GitHub GraphQL URL must use HTTPS");
  return {
    async graphql(query, variables = {}) {
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: headers(token),
          body: JSON.stringify({ query, variables }),
        });
        if (response.status !== 200) throw new Error(`GitHub GraphQL request failed with HTTP ${response.status}`);
        const payload = await response.json();
        if (payload.errors?.length) {
          const messages = payload.errors.map((error) => error?.message ?? "unknown GraphQL error").join("; ");
          throw new Error(`GitHub GraphQL error: ${messages}`);
        }
        if (!payload.data) throw new Error("GitHub GraphQL response has no data");
        return payload.data;
      } catch (error) {
        throw new Error(sanitize(error, token));
      }
    },
  };
}

async function collectPages(loadPage) {
  const nodes = [];
  const seen = new Set();
  let cursor = null;
  while (true) {
    const connection = await loadPage(cursor);
    if (!connection || !Array.isArray(connection.nodes) || !connection.pageInfo) throw new Error("malformed paginated GraphQL connection");
    nodes.push(...connection.nodes.filter(Boolean));
    if (!connection.pageInfo.hasNextPage) return nodes;
    const next = connection.pageInfo.endCursor;
    if (typeof next !== "string" || next.length === 0 || seen.has(next)) throw new Error("GraphQL pagination did not advance");
    seen.add(next);
    cursor = next;
  }
}

export async function readAndValidateSchema(api, config) {
  const fields = await collectPages(async (cursor) => {
    const data = await api.graphql(`query($id: ID!, $cursor: String) {
      node(id: $id) { ... on ProjectV2 {
        id number title url owner { __typename ... on User { login } ... on Organization { login } }
        repositories(first: 100) { nodes { id nameWithOwner } pageInfo { hasNextPage } }
        fields(first: 100, after: $cursor) { nodes {
          __typename ... on ProjectV2Field { id name } ... on ProjectV2IterationField { id name }
          ... on ProjectV2SingleSelectField { id name options { id name } }
        } ${PAGE_INFO} }
      } }
    }`, { id: config.project.id, cursor });
    const project = data.node;
    if (!project) throw new Error("configured Home Project was not found");
    if (project.id !== config.project.id || project.number !== config.project.number || project.url !== config.project.url) {
      throw new Error("Home Project identity does not match configuration");
    }
    if (project.owner?.login !== config.project.ownerLogin || project.owner?.__typename?.toUpperCase() !== config.project.ownerType) {
      throw new Error("Home Project owner does not match configuration");
    }
    if (project.repositories?.pageInfo?.hasNextPage) throw new Error("Home Project repository validation exceeds 100 linked repositories");
    if (!project.repositories?.nodes?.some((repo) => repo.id === config.repository.id && repo.nameWithOwner === config.repository.nameWithOwner)) {
      throw new Error("Home Project is not linked to the configured repository");
    }
    return project.fields;
  });

  for (const definition of Object.values(config.fields)) {
    const named = fields.filter((field) => field?.name === definition.name);
    if (named.length !== 1 || named[0].__typename !== "ProjectV2SingleSelectField" || named[0].id !== definition.id) {
      throw new Error(`invalid Project field: ${definition.name}`);
    }
    const options = named[0].options ?? [];
    const expected = Object.entries(definition.options);
    const names = new Set(options.map((option) => option.name));
    const ids = new Set(options.map((option) => option.id));
    const live = new Map(options.map((option) => [option.name, option.id]));
    if (options.length !== expected.length || names.size !== options.length || ids.size !== options.length ||
        expected.some(([name, id]) => live.get(name) !== id)) {
      throw new Error(`invalid Project options: ${definition.name}`);
    }
  }

  const [owner, repo] = config.repository.nameWithOwner.split("/");
  const data = await api.graphql(`query($owner: String!, $repo: String!, $milestone: Int!, $rootIds: [ID!]!) {
    repository(owner: $owner, name: $repo) { id nameWithOwner milestone(number: $milestone) { id number title } }
    nodes(ids: $rootIds) { ... on Issue { id number repository { id nameWithOwner } } }
  }`, { owner, repo, milestone: config.milestone.number, rootIds: config.roots.map((root) => root.id) });
  if (data.repository?.id !== config.repository.id || data.repository.nameWithOwner !== config.repository.nameWithOwner) {
    throw new Error("repository identity does not match configuration");
  }
  const milestone = data.repository.milestone;
  if (milestone?.id !== config.milestone.id || milestone.number !== config.milestone.number || milestone.title !== config.milestone.title) {
    throw new Error("Home MVP milestone does not match configuration");
  }
  const roots = new Map((data.nodes ?? []).filter(Boolean).map((issue) => [issue.id, issue]));
  for (const root of config.roots) {
    const issue = roots.get(root.id);
    if (issue?.number !== root.number || issue.repository?.id !== config.repository.id || issue.repository?.nameWithOwner !== config.repository.nameWithOwner) {
      throw new Error(`workstream root #${root.number} does not match configuration`);
    }
  }
  return { fields, milestone };
}

export async function listOpenIssues(api, config) {
  const [owner, name] = config.repository.nameWithOwner.split("/");
  return collectPages(async (cursor) => {
    const data = await api.graphql(`query($owner: String!, $name: String!, $cursor: String) {
      repository(owner: $owner, name: $name) { issues(first: 100, after: $cursor, states: OPEN) {
        nodes { __typename ${ISSUE_IDENTITY} } ${PAGE_INFO}
      } }
    }`, { owner, name, cursor });
    return data.repository?.issues;
  });
}

export async function listMilestoneClosedIssues(api, config) {
  const [owner, name] = config.repository.nameWithOwner.split("/");
  return collectPages(async (cursor) => {
    const data = await api.graphql(`query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
      repository(owner: $owner, name: $name) { milestone(number: $number) { issues(first: 100, after: $cursor, states: CLOSED) {
        nodes { __typename ${ISSUE_IDENTITY} } ${PAGE_INFO}
      } } }
    }`, { owner, name, number: config.milestone.number, cursor });
    return data.repository?.milestone?.issues;
  });
}

export async function listProjectItems(api, config) {
  return collectPages(async (cursor) => {
    const data = await api.graphql(`query($id: ID!, $cursor: String) {
      node(id: $id) { ... on ProjectV2 { items(first: 100, after: $cursor, archivedStates: [ARCHIVED, NOT_ARCHIVED]) { nodes { id type content {
        __typename ... on Issue { ${ISSUE_IDENTITY} }
        ... on PullRequest { id number repository { id nameWithOwner } } ... on DraftIssue { id }
      } } ${PAGE_INFO} } } }
    }`, { id: config.project.id, cursor });
    return data.node?.items;
  });
}

const ITEM_FIELDS = `
  deliveryStatus: fieldValueByName(name: $deliveryName) { __typename ... on ProjectV2ItemFieldSingleSelectValue { optionId field { ... on ProjectV2SingleSelectField { id name } } } }
  workstream: fieldValueByName(name: $workstreamName) { __typename ... on ProjectV2ItemFieldSingleSelectValue { optionId field { ... on ProjectV2SingleSelectField { id name } } } }
  level: fieldValueByName(name: $levelName) { __typename ... on ProjectV2ItemFieldSingleSelectValue { optionId field { ... on ProjectV2SingleSelectField { id name } } } }
`;

function fieldVariables(config) {
  return {
    deliveryName: config.fields.deliveryStatus.name,
    workstreamName: config.fields.workstream.name,
    levelName: config.fields.level.name,
  };
}

function currentIssueQuery() {
  return `query($id: ID!, $labelsAfter: String, $itemsAfter: String, $deliveryName: String!, $workstreamName: String!, $levelName: String!) {
    node(id: $id) { ... on Issue {
      __typename ${ISSUE_IDENTITY}
      labels(first: 100, after: $labelsAfter) { nodes { name } ${PAGE_INFO} }
      projectItems(first: 100, after: $itemsAfter, includeArchived: true) { nodes { id project { id } ${ITEM_FIELDS} } ${PAGE_INFO} }
    } }
  }`;
}

export async function readCurrentIssue(api, issueId, config) {
  const first = await api.graphql(currentIssueQuery(), {
    id: issueId, labelsAfter: null, itemsAfter: null, ...fieldVariables(config),
  });
  const identity = first.node;
  if (identity?.__typename !== "Issue" || identity.id !== issueId) throw new Error("current Issue lookup failed");

  async function continueConnection(initial, field, selection, extraVariables = {}) {
    if (!initial || !Array.isArray(initial.nodes) || !initial.pageInfo) throw new Error(`malformed Issue ${field} connection`);
    const nodes = [...initial.nodes];
    let pageInfo = initial.pageInfo;
    const seen = new Set();
    while (pageInfo.hasNextPage) {
      const cursor = pageInfo.endCursor;
      if (!cursor || seen.has(cursor)) throw new Error(`Issue ${field} pagination did not advance`);
      seen.add(cursor);
      const declarations = field === "projectItems" ? ", $deliveryName: String!, $workstreamName: String!, $levelName: String!" : "";
      const args = field === "projectItems" ? ", includeArchived: true" : "";
      const data = await api.graphql(`query($id: ID!, $cursor: String!${declarations}) { node(id: $id) { ... on Issue {
        ${field}(first: 100, after: $cursor${args}) { nodes { ${selection} } ${PAGE_INFO} }
      } } }`, { id: issueId, cursor, ...extraVariables });
      const connection = data.node?.[field];
      if (!connection) throw new Error(`Issue ${field} pagination failed`);
      nodes.push(...connection.nodes.filter(Boolean));
      pageInfo = connection.pageInfo;
    }
    return nodes;
  }

  identity.labels = await continueConnection(identity.labels, "labels", "name");
  const projectItems = await continueConnection(identity.projectItems, "projectItems", `id project { id } ${ITEM_FIELDS}`, fieldVariables(config));
  const matching = projectItems.filter((item) => item.project?.id === config.project.id);
  if (matching.length > 1) throw new Error(`Issue #${identity.number} has duplicate Home Project items`);
  identity.projectItem = matching[0] ?? null;
  return identity;
}

export async function readParent(api, parentId) {
  const data = await api.graphql(`query($id: ID!) { node(id: $id) { ... on Issue { ${ISSUE_IDENTITY} } } }`, { id: parentId });
  if (!data.node || data.node.id !== parentId) throw new Error("native parent Issue lookup failed");
  return data.node;
}

export function currentDerivedValues(item, config) {
  const values = {};
  for (const [key, field] of Object.entries(config.fields)) {
    const value = item?.[key] ?? null;
    if (value !== null && (value.__typename !== "ProjectV2ItemFieldSingleSelectValue" || value.field?.id !== field.id || value.field?.name !== field.name)) {
      throw new Error(`invalid current Project field value: ${field.name}`);
    }
    values[key] = value?.optionId ?? null;
  }
  return values;
}

export async function addProjectItem(api, config, contentId) {
  const data = await api.graphql(`mutation($project: ID!, $content: ID!) {
    addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } }
  }`, { project: config.project.id, content: contentId });
  if (!data.addProjectV2ItemById?.item?.id) throw new Error("Project item addition returned no item");
  return data.addProjectV2ItemById.item.id;
}

export async function applyFieldChanges(api, config, itemId, changes) {
  if (!changes.length) return;
  const allowedFields = new Set(Object.values(config.fields).map((field) => field.id));
  const declarations = ["$project: ID!", "$item: ID!"];
  const selections = [];
  const variables = { project: config.project.id, item: itemId };
  changes.forEach((change, index) => {
    if (!allowedFields.has(change.fieldId)) throw new Error("refusing mutation of an unknown Project field");
    declarations.push(`$field${index}: ID!`);
    variables[`field${index}`] = change.fieldId;
    if (change.action === "update") {
      const field = Object.values(config.fields).find((entry) => entry.id === change.fieldId);
      if (!Object.values(field.options).includes(change.optionId)) throw new Error("refusing an unknown Project option");
      declarations.push(`$option${index}: String!`);
      variables[`option${index}`] = change.optionId;
      selections.push(`change${index}: updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field${index}, value: { singleSelectOptionId: $option${index} } }) { projectV2Item { id } }`);
    } else if (change.action === "clear") {
      selections.push(`change${index}: clearProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field${index} }) { projectV2Item { id } }`);
    } else {
      throw new Error("refusing unknown Project mutation action");
    }
  });
  const data = await api.graphql(`mutation(${declarations.join(", ")}) { ${selections.join("\n")} }`, variables);
  changes.forEach((_, index) => {
    if (data[`change${index}`]?.projectV2Item?.id !== itemId) throw new Error("Project field mutation returned the wrong item");
  });
}
