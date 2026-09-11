import { afterEach, describe, expect, test } from "bun:test";
import { resetHostScroll } from "./reset-host-scroll";

describe("resetHostScroll", () => {
  afterEach(() => {
    document.body.replaceChildren();
    window.scrollTo(0, 0);
  });

  test("resets the shared authenticated main and the window", () => {
    const main = document.createElement("main");
    main.className = "app-main app-main-authenticated";
    const child = document.createElement("div");
    main.append(child);
    document.body.append(main);
    main.scrollTop = 420;
    window.scrollTo(0, 180);

    resetHostScroll(child);

    expect(main.scrollTop).toBe(0);
    expect(window.scrollY).toBe(0);
  });
});
