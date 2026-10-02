import { OPERATOR_SETTINGS_CONTRACT_VERSION, parseOperatorSettingsErrorResponse, parseSettingsResponse, parseSupportAssistantSettings, type PutSettingsRequest, type SupportAssistantSettings } from "@/shared/operator-settings/contract";
import { SUPPORT_CONTRACT_VERSION, parseSupportCredentialResponse, parseSupportErrorResponse, type SupportCredentialPutRequest, type SupportCredentialResponse } from "@/shared/support/contract";

export type SupportAssistantSettingsSnapshot = { value: SupportAssistantSettings; revision: number };

export class SupportAssistantSettingsConflictError extends Error {
  constructor(readonly current: SupportAssistantSettingsSnapshot | null) {
    super("These settings changed since you opened them. Review the latest values, then save again.");
  }
}

export type SupportAssistantSettingsTransport = {
  settings: () => Promise<SupportAssistantSettingsSnapshot>;
  saveSettings: (value: SupportAssistantSettings, expectedRevision: number, operator: `0x${string}`) => Promise<SupportAssistantSettingsSnapshot>;
  credential: () => Promise<SupportCredentialResponse>;
  saveCredential: (apiKey: string) => Promise<SupportCredentialResponse>;
  removeCredential: () => Promise<SupportCredentialResponse>;
};

const settingsPath = "/api/admin/settings/support-assistant";
const credentialPath = "/api/admin/support/assistant/credential";
const unavailable = "Support assistant settings are unavailable. Try again.";

function snapshot(value: unknown): SupportAssistantSettingsSnapshot | null {
  const response = parseSettingsResponse(value);
  const settings = response && response.domain === "support-assistant" ? parseSupportAssistantSettings(response.settings.value) : null;
  return response && settings ? { value: settings, revision: response.settings.revision } : null;
}

type RequestBody = PutSettingsRequest | SupportCredentialPutRequest | { version: typeof SUPPORT_CONTRACT_VERSION };

async function send(path: string, method: "GET" | "PUT" | "DELETE", body?: RequestBody): Promise<{ response: Response; value: unknown }> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  return { response, value: await response.json().catch(() => null) };
}

async function readSettings(path: string, method: "GET" | "PUT", body?: PutSettingsRequest): Promise<SupportAssistantSettingsSnapshot> {
  const { response, value } = await send(path, method, body);
  if (!response.ok) {
    const error = parseOperatorSettingsErrorResponse(value);
    if (error?.error.code === "SETTINGS_CONFLICT") throw new SupportAssistantSettingsConflictError(error.current ? snapshot(error.current) : null);
    if (error?.error.code === "INVALID_REQUEST") throw new Error("Check the model id and instructions, then save again.");
    if (error?.error.code === "OPERATOR_CHANGED") throw new Error("A different operator is signed in. Reload this page before saving.");
    throw new Error(unavailable);
  }
  const parsed = snapshot(value);
  if (!parsed) throw new Error(unavailable);
  return parsed;
}

async function readCredential(method: "GET" | "PUT" | "DELETE", body?: RequestBody): Promise<SupportCredentialResponse> {
  const { response, value } = await send(credentialPath, method, body);
  if (!response.ok) {
    const error = parseSupportErrorResponse(value);
    if (error?.error.code === "INVALID_REQUEST") throw new Error("Enter a key between 8 and 512 characters.");
    throw new Error(error?.error.code === "SUPPORT_UNAVAILABLE" ? "Keys can't be stored right now. Try again later." : unavailable);
  }
  const parsed = parseSupportCredentialResponse(value);
  if (!parsed) throw new Error(unavailable);
  return parsed;
}

export const supportAssistantSettingsTransport: SupportAssistantSettingsTransport = {
  settings: () => readSettings(settingsPath, "GET"),
  saveSettings: (value, expectedRevision, operator) => readSettings(settingsPath, "PUT", { version: OPERATOR_SETTINGS_CONTRACT_VERSION, expectedRevision, value, operator }),
  credential: () => readCredential("GET"),
  saveCredential: (apiKey) => readCredential("PUT", { version: SUPPORT_CONTRACT_VERSION, apiKey }),
  removeCredential: () => readCredential("DELETE", { version: SUPPORT_CONTRACT_VERSION }),
};
