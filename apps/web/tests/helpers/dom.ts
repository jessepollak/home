import { within } from "@/client/account/dom-test-harness";

export function page() {
  return within(document.body);
}
