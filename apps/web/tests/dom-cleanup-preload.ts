import { afterEach } from "bun:test";
import { runDomTestCleanup } from "./helpers/dom-test-cleanup";

afterEach(runDomTestCleanup);
