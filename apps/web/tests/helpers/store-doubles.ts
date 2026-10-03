import { isDeepStrictEqual } from "node:util";
import { ActionsStore } from "@/server/actions/store";
import { OperatorSettingsConflictError, OperatorSettingsStore } from "@/server/operator-settings/store";
import type { SettingsEntry } from "@/shared/operator-settings/contract";
import type { SqlExecutor } from "@/server/db/sql";

const idleSql: SqlExecutor = {
  query: async () => { throw new Error("Unexpected store query in a test double"); },
  transaction: async () => { throw new Error("Unexpected store transaction in a test double"); },
};

export class TestActionsStore extends ActionsStore {
  readonly inserts: Array<Parameters<ActionsStore["insert"]>[0]> = [];

  constructor() {
    super(idleSql);
  }

  override async insert(input: Parameters<ActionsStore["insert"]>[0]): Promise<void> {
    this.inserts.push(input);
  }
}

export class TestOperatorSettingsStore extends OperatorSettingsStore {
  constructor(private readonly domains: ReadonlySet<string>, private readonly entries: SettingsEntry[]) {
    super(idleSql);
  }

  override hasDomain(domain: string): boolean {
    return this.domains.has(domain);
  }

  override async read(domain: string): Promise<SettingsEntry> {
    const entry = this.entries.find((item) => item.domain === domain);
    if (entry === undefined) throw new Error("Missing settings entry in a test double");
    return entry;
  }

  override async readAll(): Promise<SettingsEntry[]> {
    return this.entries;
  }

  override async write(input: Parameters<OperatorSettingsStore["write"]>[0]): Promise<SettingsEntry> {
    const index = this.entries.findIndex((item) => item.domain === input.domain);
    const entry = this.entries[index];
    if (entry === undefined) throw new Error("Missing settings entry in a test double");
    if (entry.settings.revision !== input.expectedRevision) throw new OperatorSettingsConflictError();
    if (isDeepStrictEqual(entry.settings.value, input.value)) return entry;
    const written: SettingsEntry = { ...entry, settings: { ...entry.settings, value: input.value, revision: input.expectedRevision + 1, source: "stored", updatedBy: input.actor } };
    this.entries[index] = written;
    return written;
  }
}
