import "@/client/account/dom-test-harness";

import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { CategoryScreen } from "./category-screen";

afterEach(cleanup);

test("a failed category page retains its explanation and retries the read", () => {
  const retry = mock(() => undefined);
  const view = render(
    <CategoryScreen title="Memes" shelfId="memes" assets={[]} market={{ status: "unavailable" }}
      pagination={{ nextOffset: 24, exhausted: false, loadingMore: false, loadMoreError: true, autoLoadPaused: false, consecutiveEmptyPages: 0 }}
      onRetryLoadMore={retry} onBack={() => {}} onOpenAsset={() => {}} />,
  );
  const alert = view.getByRole("alert");
  expect(alert.textContent).toContain("More memes could not be loaded. Your current results are unchanged.");
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledTimes(1);
});
