import "@/client/account/dom-test-harness";

import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { getHomeQueryClient } from "@/client/query/query-client";

export function describeDomContaminationFixture(fileName: string) {
  const contaminationKey = ["dom-test-harness", fileName];

  describe(`dom test harness in ${fileName}`, () => {
    test("a test leaves rendered, raw DOM, storage, and query state behind", () => {
      render(<p>rendered leftover</p>);
      const raw = document.createElement("section");
      raw.textContent = "raw leftover";
      document.body.appendChild(raw);
      window.localStorage.setItem("dom-test-harness", "local");
      window.sessionStorage.setItem("dom-test-harness", "session");
      getHomeQueryClient().setQueryData(contaminationKey, "cached");

      expect(document.body.textContent).toContain("raw leftover");
    });

    test("the next test starts from an empty body, storage, and query cache", () => {
      expect(document.body.innerHTML).toBe("");
      expect(window.localStorage.length).toBe(0);
      expect(window.sessionStorage.length).toBe(0);
      expect(getHomeQueryClient().getQueryData(contaminationKey)).toBeUndefined();
    });
  });
}
