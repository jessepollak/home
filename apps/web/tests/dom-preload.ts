import { afterEach, beforeEach } from "bun:test";
import { runDomTestCleanup } from "./helpers/dom-test-cleanup";

beforeEach(() => {
  (globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }).BASE_UI_ANIMATIONS_DISABLED = true;
});

afterEach(runDomTestCleanup);
