import type { QueryClient } from "@tanstack/react-query";
import { subscribeOwnerQueryBoundary } from "@/client/query/query-client";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { ActivityOrder } from "@/shared/activity/contract-orders";
import { retainActivityRows } from "./retained-activity";

export type RetainedActivitySources = {
  operations: readonly RecentMoneyActionOperation[];
  orders: readonly ActivityOrder[];
  presented?: ReadonlySet<string>;
};

export type ActivitySourceRetention = {
  scope: string;
  read: () => RetainedActivitySources | undefined;
  subscribe: (listener: () => void) => () => void;
  write: (rows: RetainedActivitySources) => void;
};

type Entry = RetainedActivitySources & { owner: string };
type Handle = ActivitySourceRetention & { owner: string; dead: boolean };
type Registry = { entries: Map<string, Entry>; listeners: Map<string, Set<() => void>>; handles: Map<string, Handle> };

const registries = new WeakMap<QueryClient, Registry>();

function notify(registry: Registry, scope: string) {
  for (const listener of [...registry.listeners.get(scope) ?? []]) listener();
}

function registryFor(queryClient: QueryClient): Registry {
  let registry = registries.get(queryClient);
  if (!registry) {
    const created: Registry = { entries: new Map(), listeners: new Map(), handles: new Map() };
    subscribeOwnerQueryBoundary(queryClient, (preserved) => {
      const scopes = new Set<string>();
      for (const [scope, handle] of created.handles) {
        if (handle.owner === preserved) continue;
        handle.dead = true;
        created.handles.delete(scope);
        scopes.add(scope);
      }
      for (const [scope, entry] of created.entries) {
        if (entry.owner !== preserved) { created.entries.delete(scope); scopes.add(scope); }
      }
      for (const scope of scopes) notify(created, scope);
    });
    registry = created;
    registries.set(queryClient, registry);
  }
  return registry;
}

function sameRows<T>(left: readonly T[], right: readonly T[]) {
  return left.length === right.length && left.every((row, index) => row === right[index]);
}

function retention(registry: Registry, owner: string, scope: string): ActivitySourceRetention {
  const existing = registry.handles.get(scope);
  if (existing && !existing.dead) return existing;
  const handle: Handle = {
    scope,
    owner,
    dead: false,
    read: () => handle.dead ? undefined : registry.entries.get(scope),
    subscribe: (listener) => {
      const listeners = registry.listeners.get(scope) ?? new Set();
      registry.listeners.set(scope, listeners);
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    write: (rows) => {
      if (handle.dead) return;
      const known = registry.entries.get(scope);
      if (!known && rows.operations.length === 0 && rows.orders.length === 0 && !rows.presented?.size) return;
      const mergedOperations = retainActivityRows(known?.operations ?? [], rows.operations, (row) => row.action.id);
      const mergedOrders = retainActivityRows(known?.orders ?? [], rows.orders, (row) => row.id);
      const operations = sameRows(mergedOperations, rows.operations) ? rows.operations : mergedOperations;
      const orders = sameRows(mergedOrders, rows.orders) ? rows.orders : mergedOrders;
      const knownPresented = known?.presented ?? new Set<string>();
      const presented = [...rows.presented ?? []].every((id) => knownPresented.has(id))
        ? knownPresented : new Set([...knownPresented, ...rows.presented ?? []]);
      if (known && sameRows(operations, known.operations) && sameRows(orders, known.orders) && presented === knownPresented) return;
      registry.entries.set(scope, { owner, operations, orders, presented });
      notify(registry, scope);
    },
  };
  registry.handles.set(scope, handle);
  return handle;
}

export function activitySourceRetention(queryClient: QueryClient, owner: string, regionId: string): ActivitySourceRetention {
  return retention(registryFor(queryClient), owner, `${owner}\u0000${regionId}`);
}

export function localActivitySourceRetention(scope: string): ActivitySourceRetention {
  return retention({ entries: new Map(), listeners: new Map(), handles: new Map() }, scope, scope);
}
