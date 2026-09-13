import { within } from "@testing-library/react";

export function page() {
  return within(document.body);
}
