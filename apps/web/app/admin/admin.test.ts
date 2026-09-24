import { expect, test } from "bun:test";
import AdminPage from "./page";
import AdminNotFound from "./not-found";
import UnknownAdminPage from "./[...path]/page";
import AdminLayout from "./layout";

test("the admin segment owns its landing, unknown paths and not-found boundary", () => {
  expect(typeof AdminPage).toBe("function");
  expect(typeof AdminLayout).toBe("function");
  expect(typeof AdminNotFound).toBe("function");
  expect(() => UnknownAdminPage()).toThrow(/NEXT_HTTP_ERROR.*404/);
});
