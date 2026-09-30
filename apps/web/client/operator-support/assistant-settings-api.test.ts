import { afterEach, expect, test } from "bun:test";
import { supportAssistantSettingsTransport, SupportAssistantSettingsConflictError } from "./assistant-settings-api";
import type { SupportCredentialResponse } from "@/shared/support/contract";
import type { SupportAssistantSettings } from "@/shared/operator-settings/contract";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const settings = (value: unknown, revision = 3) => ({ version: 1, domain: "support-assistant", settings: { value, revision, source: "stored", updatedAt: "2026-09-27T12:00:00.000Z", updatedBy: null } });
const hybrid: SupportAssistantSettings = { mode: "hybrid", model: "provider/model-name", instructions: "Be brief." };
const credential: SupportCredentialResponse = { version: 2, configured: true, last4: "abcd", updatedAt: "2026-09-27T12:00:00.000Z", available: true };
const operator = `0x${"1".repeat(40)}` as `0x${string}`;

function capture(responses: Response[]) {
  const calls: { path: string; init: RequestInit | undefined }[] = [];
  globalThis.fetch = (async (path: string | URL | Request, init?: RequestInit) => {
    calls.push({ path: String(path), init });
    return responses.shift() ?? new Response(null, { status: 500 });
  }) as typeof fetch;
  return calls;
}

test("settings save sends the expected revision to the operator settings route", async () => {
  const calls = capture([Response.json(settings(hybrid)), Response.json(settings(hybrid, 4))]);
  expect(await supportAssistantSettingsTransport.settings()).toEqual({ value: hybrid, revision: 3 });
  expect(await supportAssistantSettingsTransport.saveSettings({ mode: "hybrid", model: "provider/model-name", instructions: "Be brief." }, 3, operator)).toEqual({ value: hybrid, revision: 4 });
  expect(calls.map((call) => [call.path, call.init?.method])).toEqual([["/api/admin/settings/support-assistant", "GET"], ["/api/admin/settings/support-assistant", "PUT"]]);
  expect(calls[1].init?.body).toBe(JSON.stringify({ version: 1, expectedRevision: 3, value: hybrid, operator }));
  expect(calls.every((call) => call.init?.credentials === "same-origin")).toBe(true);
});

test("a settings conflict carries the current stored settings", async () => {
  capture([Response.json({ error: { code: "SETTINGS_CONFLICT" }, current: settings(hybrid, 7) }, { status: 409 })]);
  const failure = await supportAssistantSettingsTransport.saveSettings({ mode: "operator", model: "", instructions: "" }, 3, operator).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(SupportAssistantSettingsConflictError);
  expect((failure as SupportAssistantSettingsConflictError).current).toEqual({ value: hybrid, revision: 7 });
});

test("rejected, malformed and unavailable settings responses surface a recovery message", async () => {
  capture([Response.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 }), Response.json(settings({ mode: "hybrid", model: "", instructions: "" })), Response.json({ error: { code: "SETTINGS_UNAVAILABLE" } }, { status: 503 })]);
  await expect(supportAssistantSettingsTransport.saveSettings({ mode: "operator", model: "", instructions: "" }, 0, operator)).rejects.toThrow("Check the model id and instructions, then save again.");
  await expect(supportAssistantSettingsTransport.settings()).rejects.toThrow("Support assistant settings are unavailable. Try again.");
  await expect(supportAssistantSettingsTransport.settings()).rejects.toThrow("Support assistant settings are unavailable. Try again.");
});

test("the API key is write-only and removal sends the contract version", async () => {
  const calls = capture([Response.json(credential), Response.json(credential), Response.json({ ...credential, configured: false, last4: null, updatedAt: null, available: false })]);
  expect(await supportAssistantSettingsTransport.credential()).toEqual(credential);
  expect(await supportAssistantSettingsTransport.saveCredential("key-0000abcd")).toEqual(credential);
  expect((await supportAssistantSettingsTransport.removeCredential()).configured).toBe(false);
  expect(calls.map((call) => [call.path, call.init?.method, call.init?.body])).toEqual([
    ["/api/admin/support/assistant/credential", "GET", undefined],
    ["/api/admin/support/assistant/credential", "PUT", JSON.stringify({ version: 2, apiKey: "key-0000abcd" })],
    ["/api/admin/support/assistant/credential", "DELETE", JSON.stringify({ version: 2 })],
  ]);
});

test("credential failures and malformed credential responses are rejected", async () => {
  capture([Response.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 }), Response.json({ error: { code: "SUPPORT_UNAVAILABLE" } }, { status: 503 }), Response.json({ ...credential, apiKey: "leak" })]);
  await expect(supportAssistantSettingsTransport.saveCredential("short")).rejects.toThrow("Enter a key between 8 and 512 characters.");
  await expect(supportAssistantSettingsTransport.saveCredential("key-0000abcd")).rejects.toThrow("Keys can't be stored right now. Try again later.");
  await expect(supportAssistantSettingsTransport.credential()).rejects.toThrow("Support assistant settings are unavailable. Try again.");
});

test("a different signed-in operator asks for a reload before saving", async () => {
  capture([Response.json({ error: { code: "OPERATOR_CHANGED" } }, { status: 409 })]);
  await expect(supportAssistantSettingsTransport.saveSettings({ mode: "operator", model: "", instructions: "" }, 3, operator)).rejects.toThrow("A different operator is signed in. Reload this page before saving.");
});
