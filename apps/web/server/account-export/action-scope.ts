import "server-only";

import type { ExportScope } from "./owner";
import { AccountExportError } from "./errors";

export function accountActionScope(scope: ExportScope): { sql: string; ownerSql: string; values: unknown[] } {
  const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");
  const patterns = scope.credentials.map((credential) => {
    if (/^[a-zA-Z0-9-]{1,100}$/.exec(credential.subject)?.[0] !== credential.subject) throw new AccountExportError("ACCOUNT_EXPORT_LINKAGE");
    return `${escapeLike(`[${JSON.stringify(credential.subject)},"0x`)}%${escapeLike(`,8453,${JSON.stringify(credential.account_provider)}]`)}`;
  });
  const ownerSql = `(owner_key=ANY($2::text[])${patterns.map((_, index) => ` OR owner_key LIKE $${index + 3}`).join("")})`;
  return { sql: `(customer_id=$1 OR (customer_id IS NULL AND ${ownerSql}))`, ownerSql, values: [scope.customerId, scope.ownerKeys, ...patterns] };
}
