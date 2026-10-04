import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import type { SupportAssistantSettings as Settings } from "@/shared/operator-settings/contract";
import type { SupportCredentialResponse } from "@/shared/support/contract";
import { SupportAssistantSettings } from "./assistant-settings";
import { SupportAssistantSettingsConflictError, type SupportAssistantSettingsTransport } from "./assistant-settings-api";

const screen = within(document.body);
const configured: SupportCredentialResponse = { version: 2, configured: true, last4: "abcd", updatedAt: "2026-09-27T12:00:00.000Z", available: true };
const missing: SupportCredentialResponse = { version: 2, configured: false, last4: null, updatedAt: null, available: false };
const operator = `0x${"1".repeat(40)}` as `0x${string}`;

function setup(value: Settings, key: SupportCredentialResponse, overrides: Partial<SupportAssistantSettingsTransport> = {}) {
  const calls = { saved: [] as { value: Settings; revision: number; operator: string }[], keys: [] as string[], removed: 0 };
  let current = { value, revision: 2 };
  let credential = key;
  const transport: SupportAssistantSettingsTransport = {
    settings: async () => current,
    saveSettings: async (next, revision, actor) => { calls.saved.push({ value: next, revision, operator: actor }); current = { value: next, revision: revision + 1 }; return current; },
    credential: async () => credential,
    saveCredential: async (apiKey) => { calls.keys.push(apiKey); credential = { ...configured, last4: apiKey.slice(-4) }; return credential; },
    removeCredential: async () => { calls.removed++; credential = missing; return credential; },
    ...overrides,
  };
  return { transport, calls };
}

afterEach(cleanup);

test("operator-only mode with no key shows no unavailable note and asks for a key", async () => {
  const { transport } = setup({ mode: "operator", model: "", instructions: "" }, missing);
  render(<SupportAssistantSettings operator={operator} transport={transport} />);
  expect(await screen.findByRole("radio", { name: "Operator only" })).toBeTruthy();
  expect(screen.getByRole("radio", { name: "Operator only" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.queryByText("Assistant unavailable")).toBeNull();
  expect(screen.getByLabelText("AI Gateway API key").getAttribute("type")).toBe("password");
});

test("an assistant mode without a key explains that the assistant is unavailable", async () => {
  const { transport } = setup({ mode: "hybrid", model: "provider/model-name", instructions: "" }, missing);
  render(<SupportAssistantSettings operator={operator} transport={transport} />);
  expect(await screen.findByText("Assistant unavailable")).toBeTruthy();
  expect(screen.getByText(/Add an AI Gateway API key/)).toBeTruthy();
});

test("a stored key that cannot be opened asks the operator to replace it", async () => {
  const { transport } = setup({ mode: "assistant", model: "provider/model-name", instructions: "" }, { ...configured, available: false });
  render(<SupportAssistantSettings operator={operator} transport={transport} />);
  expect(await screen.findByText("Assistant unavailable")).toBeTruthy();
  expect(screen.getByText(/The saved key can't be used/)).toBeTruthy();
});

test("an assistant mode needs a valid model id before it is saved", async () => {
  const { transport, calls } = setup({ mode: "operator", model: "", instructions: "" }, configured);
  render(<SupportAssistantSettings operator={operator} transport={transport} />);
  fireEvent.click(await screen.findByRole("radio", { name: "Assistant with handoff" }));
  await waitFor(() => expect(screen.getByRole("radio", { name: "Assistant with handoff" }).getAttribute("aria-checked")).toBe("true"));
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Enter a model id to turn on the assistant.");
  fireEvent.input(screen.getByLabelText("Model"), { target: { value: "Not A Model" } });
  expect(screen.getByRole("alert").textContent).toBe("Use a model id like provider/model-name.");
  expect(calls.saved).toEqual([]);
  fireEvent.input(screen.getByLabelText("Model"), { target: { value: " provider/model-name " } });
  fireEvent.input(screen.getByLabelText("Instructions"), { target: { value: "Keep answers short." } });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  expect((await screen.findByRole("status")).textContent).toBe("Settings saved.");
  expect(calls.saved).toEqual([{ value: { mode: "hybrid", model: "provider/model-name", instructions: "Keep answers short." }, revision: 2, operator }]);
  expect(screen.getByRole("button", { name: "Save settings" }).hasAttribute("disabled")).toBe(true);
});

test("settings fields cannot change during a save and become editable after it completes", async () => {
  let completeSave: (value: { value: Settings; revision: number }) => void = () => {};
  const initial: Settings = { mode: "operator", model: "provider/first", instructions: "Before" };
  const { transport, calls } = setup(initial, configured, {
    saveSettings: async (value, revision, actor) => {
      calls.saved.push({ value, revision, operator: actor });
      return new Promise((resolve) => { completeSave = resolve; });
    },
  });
  render(<SupportAssistantSettings operator={operator} transport={transport} />);
  const model = await screen.findByLabelText("Model") as HTMLInputElement;
  const instructions = screen.getByLabelText("Instructions") as HTMLTextAreaElement;
  fireEvent.input(model, { target: { value: "provider/second" } });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() => expect(model.disabled).toBe(true));
  expect(instructions.disabled).toBe(true);
  expect(screen.getAllByRole("radio").every((radio) => radio.getAttribute("aria-disabled") === "true")).toBe(true);
  expect(calls.saved).toEqual([{ value: { ...initial, model: "provider/second" }, revision: 2, operator }]);
  completeSave({ value: { ...initial, model: "provider/second" }, revision: 3 });
  await waitFor(() => expect(model.disabled).toBe(false));
  expect(model.value).toBe("provider/second");
  expect(instructions.value).toBe("Before");
  expect(screen.getByRole("radio", { name: "Operator only" }).getAttribute("aria-checked")).toBe("true");
  fireEvent.input(instructions, { target: { value: "After" } });
  expect(screen.getByRole("button", { name: "Save settings" }).hasAttribute("disabled")).toBe(false);
});

test("a settings conflict adopts the latest stored values and explains why", async () => {
  const latest = { value: { mode: "assistant" as const, model: "provider/other-model", instructions: "" }, revision: 9 };
  const { transport } = setup({ mode: "operator", model: "", instructions: "" }, configured, { saveSettings: async () => { throw new SupportAssistantSettingsConflictError(latest); } });
  render(<SupportAssistantSettings operator={operator} transport={transport} />);
  fireEvent.input(await screen.findByLabelText("Instructions"), { target: { value: "Mine" } });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  expect((await screen.findByRole("alert")).textContent).toBe("These settings changed since you opened them. Review the latest values, then save again.");
  expect((screen.getByLabelText("Model") as HTMLInputElement).value).toBe("provider/other-model");
  expect(screen.getByRole("radio", { name: "Assistant only" }).getAttribute("aria-checked")).toBe("true");
});

test("a failed load offers a retry", async () => {
  let attempts = 0;
  const { transport } = setup({ mode: "operator", model: "", instructions: "" }, missing, { settings: async () => { attempts++; if (attempts === 1) throw new Error("Support assistant settings are unavailable. Try again."); return { value: { mode: "operator", model: "", instructions: "" }, revision: 0 }; } });
  render(<SupportAssistantSettings operator={operator} transport={transport} />);
  expect((await screen.findByRole("alert")).textContent).toContain("Support assistant settings are unavailable. Try again.");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("radio", { name: "Operator only" })).toBeTruthy();
});

test("a configured key shows only its last four and can be replaced", async () => {
  const { transport, calls } = setup({ mode: "hybrid", model: "provider/model-name", instructions: "" }, configured);
  render(<SupportAssistantSettings operator={operator} transport={transport} />);
  expect(await screen.findByText("Configured · ends in abcd")).toBeTruthy();
  expect(screen.queryByText("Assistant unavailable")).toBeNull();
  expect(screen.queryByLabelText("New API key")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Replace key" }));
  const input = await screen.findByLabelText("New API key");
  fireEvent.input(input, { target: { value: "short" } });
  fireEvent.click(screen.getByRole("button", { name: "Save key" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Enter a key between 8 and 512 characters.");
  fireEvent.input(input, { target: { value: "  key-00001234  " } });
  fireEvent.click(screen.getByRole("button", { name: "Save key" }));
  expect(await screen.findByText("Configured · ends in 1234")).toBeTruthy();
  expect(calls.keys).toEqual(["key-00001234"]);
  expect(screen.queryByLabelText("New API key")).toBeNull();
});

test("removing the key asks for confirmation and turns the assistant off", async () => {
  const { transport, calls } = setup({ mode: "hybrid", model: "provider/model-name", instructions: "" }, configured);
  render(<SupportAssistantSettings operator={operator} transport={transport} />);
  fireEvent.click(await screen.findByRole("button", { name: "Remove key" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(calls.removed).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(await screen.findByText("Assistant unavailable")).toBeTruthy();
  expect(calls.removed).toBe(1);
  expect(screen.getByLabelText("AI Gateway API key")).toBeTruthy();
});

test("a failed key save keeps the entered key for another attempt", async () => {
  const { transport } = setup({ mode: "operator", model: "", instructions: "" }, missing, { saveCredential: async () => { throw new Error("Keys can't be stored right now. Try again later."); } });
  render(<SupportAssistantSettings operator={operator} transport={transport} />);
  const input = await screen.findByLabelText("AI Gateway API key");
  fireEvent.input(input, { target: { value: "key-00001234" } });
  fireEvent.click(screen.getByRole("button", { name: "Save key" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Keys can't be stored right now. Try again later.");
  expect((input as HTMLInputElement).value).toBe("key-00001234");
});
