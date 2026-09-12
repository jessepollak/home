import { authorizeSession } from "@/server/auth/authorize";

export function createMoneyActionSessionAuthorizer() {
  return authorizeSession;
}
