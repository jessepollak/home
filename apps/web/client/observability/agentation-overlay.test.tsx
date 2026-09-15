import "../account/dom-test-harness";

import { describe, expect, test } from "bun:test";

const { cleanup, render } = await import("@testing-library/react");
const { AgentationOverlay } = await import("./agentation-overlay");

describe("Agentation overlay boundary", () => {
  test("renders nothing outside development mode, so production never mounts the toolbar", () => {
    // Bun runs tests with NODE_ENV=test. The overlay must be inert for every
    // non-development value; "development" mounting is covered by the pure
    // gate in agentation-gate.test.ts.
    expect(process.env.NODE_ENV).toBe("test");
    const { container } = render(<AgentationOverlay />);
    expect(container.childElementCount).toBe(0);
    expect(container.innerHTML).toBe("");
    cleanup();
  });

  test("renders nothing when the server disables it for Chromium smoke", () => {
    const { container } = render(<AgentationOverlay disabled />);
    expect(container.childElementCount).toBe(0);
    expect(container.innerHTML).toBe("");
    cleanup();
  });
});
