import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, render } = await import("@testing-library/react");
const { Input } = await import("./input");

afterEach(cleanup);

describe("Input", () => {
  test("keeps the default variant compact on desktop and opts in to 16px at every width with touch", () => {
    const view = render(<>
      <Input aria-label="Default" defaultValue="default" />
      <Input aria-label="Touch" defaultValue="touch" variant="touch" />
    </>);
    const input = view.getByLabelText("Default") as HTMLInputElement;
    expect(input.className).toContain("text-base");
    expect(input.className).toContain("md:text-sm");
    const touch = view.getByLabelText("Touch") as HTMLInputElement;
    expect(touch.className).toContain("text-base");
    expect(touch.className).toContain("md:text-base");
    expect(touch.className).not.toContain("md:text-sm");
  });
});
