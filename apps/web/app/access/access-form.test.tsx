import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AccessForm } from "./access-form";

describe("access form", () => {
  test("server-renders a submittable native POST form before hydration", () => {
    const html = renderToStaticMarkup(<AccessForm next="/borrow?asset=usdc" />);

    expect(html).toContain('action="/api/access"');
    expect(html).toContain('method="post"');
    expect(html).toContain('name="next" value="/borrow?asset=usdc"');
    expect(html).toContain('type="submit"');
    expect(html).not.toContain(' disabled=""');
    expect(html).not.toContain("data-hydrated");
  });
});
