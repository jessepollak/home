import "@/client/account/dom-test-harness";
import { expect, test } from "bun:test";
import { preserveRowFocus } from "./preserve-row-focus";

function rowList(key = "native") {
  const list = document.createElement("ul");
  const button = document.createElement("button");
  const label = document.createElement("span");
  label.dataset.holdingKey = key;
  button.append(label);
  list.append(button);
  return { list, button, label };
}

function pendingRefresh() {
  const panel = document.createElement("section");
  const container = document.createElement("div");
  const before = rowList();
  container.append(before.list);
  panel.append(container);
  document.body.append(panel);
  before.button.focus();
  const pending = preserveRowFocus(before.list);
  if (pending === null) throw new Error("Focused fixture row did not schedule restoration");
  before.list.remove();
  const next = rowList();
  return { panel, container, pending, next };
}

test("refresh restores the focused holding once without scrolling", () => {
  const { container, pending, next } = pendingRefresh();
  expect(document.activeElement).toBe(document.body);
  container.append(next.list);
  pending.restore(next.list);
  expect(document.activeElement).toBe(next.button);
  next.button.blur();
  pending.restore(next.list);
  expect(document.activeElement).toBe(document.body);
});

for (const interruption of ["focus", "pointer", "keyboard", "hidden", "inert", "scope", "failure", "unmount", "removed"]) {
  test(`refresh does not steal focus after ${interruption}`, () => {
    const { panel, container, pending, next } = pendingRefresh();
    if (interruption === "focus") {
      const elsewhere = document.createElement("button");
      document.body.append(elsewhere);
      elsewhere.focus();
      elsewhere.remove();
    }
    if (interruption === "pointer") document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    if (interruption === "keyboard") document.body.dispatchEvent(new Event("keydown", { bubbles: true }));
    if (interruption === "hidden" || interruption === "inert") {
      panel.setAttribute(interruption, "");
      panel.removeAttribute(interruption);
    }
    if (interruption === "scope") {
      const replacement = document.createElement("div");
      panel.replaceChildren(replacement);
      replacement.append(next.list);
    } else container.append(next.list);
    if (interruption === "failure") pending.cancel();
    if (interruption === "unmount") panel.remove();
    if (interruption === "removed") next.label.dataset.holdingKey = "other";
    pending.restore(next.list);
    expect(document.activeElement).toBe(document.body);
  });
}

test("an unfocused list schedules no restoration", () => {
  const { list } = rowList();
  document.body.append(list);
  expect(preserveRowFocus(list)).toBeNull();
});
