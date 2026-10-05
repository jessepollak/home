import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HttpResponse, http } from "msw";
import { expect, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { FundingSettings, FundingSettingsUnavailable } from "@/client/admin/funding-settings";
import type { FundingCorridorView, FundingOfferingView } from "@/shared/funding/offering";
import { isRecord } from "@/shared/guards";
import { readJson } from "@/shared/http/read-json";

const operator = "0x1111111111111111111111111111111111111111" as const;

type CorridorSeed = Pick<FundingCorridorView, "providerId" | "providerName" | "region" | "regionName" | "direction" | "currency" | "paymentMethods"> & Partial<FundingCorridorView>;

function corridor(seed: CorridorSeed): FundingCorridorView {
  return {
    key: `${seed.providerId}:${seed.region}:${seed.direction}`,
    connection: "connected",
    missingEnv: [],
    credentials: [],
    selected: false,
    offered: false,
    confirmedBy: null,
    newSinceSave: false,
    ...seed,
  };
}

const coinbaseUs: CorridorSeed = { providerId: "coinbase", providerName: "Coinbase", region: "US", regionName: "United States", direction: "onramp", currency: "USD", paymentMethods: ["Debit card", "Apple Pay", "Bank transfer"], credentials: [{ name: "CDP_API_KEY_ID", state: "set" }, { name: "CDP_API_KEY_SECRET", state: "set" }] };
const peerUs: CorridorSeed = { providerId: "peer", providerName: "Peer", region: "US", regionName: "United States", direction: "offramp", currency: "USD", paymentMethods: ["Venmo", "Zelle", "Cash App"] };
const ripioArOn: CorridorSeed = { providerId: "ripio", providerName: "Ripio", region: "AR", regionName: "Argentina", direction: "onramp", currency: "ARS", paymentMethods: ["Bank transfer"], credentials: [{ name: "RIPIO_CLIENT_ID", state: "set" }, { name: "RIPIO_WEBHOOK_SECRET_AR", state: "set" }] };
const ripioArOff: CorridorSeed = { ...ripioArOn, direction: "offramp" };
const ripioBrOn: CorridorSeed = { providerId: "ripio", providerName: "Ripio", region: "BR", regionName: "Brazil", direction: "onramp", currency: "BRL", paymentMethods: ["Pix"], credentials: [{ name: "RIPIO_CLIENT_ID_BR", state: "unset" }, { name: "RIPIO_CLIENT_SECRET_BR", state: "unset" }, { name: "RIPIO_WEBHOOK_SECRET_BR", state: "unset" }] };
const idrxId: CorridorSeed = { providerId: "idrx", providerName: "IDRX", region: "ID", regionName: "Indonesia", direction: "onramp", currency: "IDR", paymentMethods: ["QRIS", "Bank transfer"], credentials: [{ name: "IDRX_CLIENT_ID", state: "unset" }, { name: "IDRX_CLIENT_SECRET", state: "unset" }] };

const providers: FundingOfferingView["providers"] = [
  { providerId: "coinbase", displayName: "Coinbase", credentials: [{ name: "CDP_API_KEY_ID", state: "set" }, { name: "CDP_API_KEY_SECRET", state: "set" }] },
  { providerId: "peer", displayName: "Peer", credentials: [] },
  { providerId: "ripio", displayName: "Ripio", credentials: [{ name: "RIPIO_CLIENT_ID", state: "set" }, { name: "RIPIO_WEBHOOK_SECRET_AR", state: "set" }] },
  { providerId: "idrx", displayName: "IDRX", credentials: [{ name: "IDRX_CLIENT_ID", state: "unset" }, { name: "IDRX_CLIENT_SECRET", state: "unset" }] },
];

const deploymentView: FundingOfferingView = {
  source: "deployment",
  revision: 0,
  updatedAt: null,
  updatedBy: null,
  corridors: [
    corridor({ ...coinbaseUs, selected: true, offered: true, confirmedBy: "Live $1 card purchase on Sep 18" }),
    corridor({ ...peerUs, selected: true, offered: true, confirmedBy: "Live $1 Venmo payout on Sep 19" }),
    corridor(ripioArOn),
    corridor(ripioArOff),
    corridor({ ...idrxId, connection: "not-connected", missingEnv: ["IDRX_CLIENT_ID", "IDRX_CLIENT_SECRET"] }),
  ],
  providers,
  legacy: [{ name: "PEER_OFFRAMP_ENABLED", state: "in-effect" }],
  unknownSaved: [],
};

const savedView: FundingOfferingView = {
  source: "saved",
  revision: 4,
  updatedAt: "2026-09-22T16:40:00.000Z",
  updatedBy: "0x1111111111111111111111111111111111111111",
  corridors: [
    corridor({ ...coinbaseUs, selected: true, offered: true, confirmedBy: "Live $1 card purchase on Sep 18" }),
    corridor(peerUs),
    corridor({ ...ripioArOn, newSinceSave: true, confirmedBy: "Sandbox transfer on Sep 21" }),
    corridor({ ...ripioArOff, newSinceSave: true }),
    corridor({ ...idrxId, connection: "not-connected", missingEnv: ["IDRX_CLIENT_ID", "IDRX_CLIENT_SECRET"] }),
  ],
  providers,
  legacy: [{ name: "PEER_OFFRAMP_ENABLED", state: "ignored" }],
  unknownSaved: [{ providerId: "bitso", region: "MX", direction: "offramp" }],
};

const savedOnWithoutCredentialsView: FundingOfferingView = {
  ...savedView,
  corridors: [
    corridor({ ...coinbaseUs, selected: true, offered: true }),
    corridor({ ...ripioBrOn, connection: "not-connected", missingEnv: ["RIPIO_CLIENT_ID_BR", "RIPIO_CLIENT_SECRET_BR", "RIPIO_WEBHOOK_SECRET_BR"] }),
    corridor({ ...idrxId, connection: "not-connected", missingEnv: ["IDRX_CLIENT_ID", "IDRX_CLIENT_SECRET"], selected: true, offered: false, confirmedBy: "Sandbox transfer on Sep 21" }),
  ],
  providers: [
    { providerId: "coinbase", displayName: "Coinbase", credentials: [{ name: "CDP_API_KEY_ID", state: "set" }, { name: "CDP_API_KEY_SECRET", state: "set" }] },
    { providerId: "ripio", displayName: "Ripio", credentials: [{ name: "RIPIO_CLIENT_ID_BR", state: "unset" }, { name: "RIPIO_CLIENT_SECRET_BR", state: "unset" }, { name: "RIPIO_WEBHOOK_SECRET_BR", state: "unset" }] },
    { providerId: "idrx", displayName: "IDRX", credentials: [{ name: "IDRX_CLIENT_ID", state: "unset" }, { name: "IDRX_CLIENT_SECRET", state: "unset" }] },
  ],
  legacy: [],
  unknownSaved: [],
};

function settingsEnvelope(corridors: unknown, revision: number) {
  return {
    version: 1,
    domain: "funding",
    settings: { value: { corridors }, revision, source: "stored", updatedAt: "2026-09-23T09:00:00.000Z", updatedBy: "0x1111111111111111111111111111111111111111" },
  };
}

const savedResponse = settingsEnvelope([], 5);

function FundingSettingsJourney({ view }: { view: FundingOfferingView | null }) {
  return (
    <main className="px-6 py-10 md:px-10">
      <div className="mx-auto grid w-full max-w-5xl gap-8">
        <h1 className="text-2xl font-semibold tracking-tight">Money in and out</h1>
        {view ? <FundingSettings view={view} operator={operator} /> : <FundingSettingsUnavailable />}
      </div>
    </main>
  );
}

const meta = {
  id: "journeys-admin-funding-settings",
  title: "Journeys/Admin money in and out",
  component: FundingSettingsJourney,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    msw: { handlers: [http.put("/api/admin/settings/funding", async ({ request }) => {
      const body = await readJson(request);
      if (!isRecord(body)) throw new Error("expected the settings save body to be a JSON object");
      const expectedRevision = typeof body.expectedRevision === "number" ? body.expectedRevision : undefined;
      const value = isRecord(body) && isRecord(body.value) ? body.value : {};
      return HttpResponse.json(settingsEnvelope(value.corridors ?? [], typeof expectedRevision === "number" ? expectedRevision + 1 : 6));
    })] },
  },
} satisfies Meta<typeof FundingSettingsJourney>;

export default meta;
type Story = StoryObj<typeof meta>;

async function reviewRipioOnramp(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const toggle = canvas.getByRole("switch", { name: "Add money with Ripio in Argentina" });
  await userEvent.click(toggle);
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await userEvent.click(canvas.getByRole("button", { name: "Review and save" }));
  await expect(canvas.getByRole("heading", { name: "Review before turning on" })).toHaveFocus();
  await expect(canvas.getByText("Customers in Argentina can add money with Ripio via Bank transfer.")).toBeVisible();
  return canvas;
}

export const DeploymentSource: Story = {
  args: { view: deploymentView },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Using deployment values — review and save")).toBeVisible();
    await expect(canvas.getByText(/is in effect/)).toBeVisible();
    await expect(canvas.getByRole("switch", { name: "Add money with IDRX in Indonesia" })).toHaveAttribute("aria-disabled", "true");
  },
};

export const SavedStates: Story = {
  args: { view: savedView },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText("New")).toHaveLength(2);
    await expect(canvas.getByText(/is set but ignored/)).toBeVisible();
    await expect(canvas.getByText("Saved corridors this version no longer offers")).toBeVisible();
    await expect(canvas.getByRole("switch", { name: "Cash out with Peer in United States" })).toHaveAttribute("aria-checked", "false");
  },
};

export const SavedOnWithoutCredentials: Story = {
  args: { view: savedOnWithoutCredentialsView },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const on = canvas.getByRole("switch", { name: "Add money with IDRX in Indonesia" });
    await expect(on).toHaveAttribute("aria-checked", "true");
    await expect(on).not.toHaveAttribute("aria-disabled", "true");
    await expect(canvas.getByText(/Not connected · On when credentials are set/)).toBeVisible();
    await expect(canvas.getByRole("switch", { name: "Add money with Ripio in Brazil" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(canvas.getByRole("switch", { name: "Add money with Coinbase in United States" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    const review = canvas.getByRole("region", { name: "On without credentials" });
    await expect(review).toHaveTextContent("IDRX_CLIENT_ID not set");
    await expect(review).toHaveTextContent("Evidence: Sandbox transfer on Sep 21");
    await expect(review).toHaveTextContent("When credentials are set, customers in Indonesia can add money with IDRX");
    await userEvent.click(canvas.getByRole("button", { name: "Back" }));
    await userEvent.click(canvas.getByRole("switch", { name: "Add money with IDRX in Indonesia" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    const paused = canvas.getByRole("region", { name: "Pausing" });
    await expect(paused).toHaveTextContent("New orders stop. Existing orders keep working");
    await expect(paused).toHaveTextContent("This corridor stays off and won't become available when its credentials return.");
  },
};
export const SavedOnWithoutCredentialsList: Story = {
  args: { view: savedOnWithoutCredentialsView },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("switch", { name: "Add money with IDRX in Indonesia" })).toHaveAttribute("aria-checked", "true");
  },
};


export const ReviewStep: Story = {
  args: { view: savedView },
  play: async ({ canvasElement }) => {
    const canvas = await reviewRipioOnramp(canvasElement);
    await expect(canvas.getByText("Evidence: Sandbox transfer on Sep 21")).toBeVisible();
  },
};

export const ConfirmSaves: Story = {
  args: { view: savedView },
  play: async ({ canvasElement }) => {
    const canvas = await reviewRipioOnramp(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Confirm" }));
    await waitForReady(() => expect(canvas.getByRole("status")).toHaveTextContent("Saved."));
  },
};

export const PauseOnly: Story = {
  args: { view: savedView },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("switch", { name: "Add money with Coinbase in United States" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(canvas.getByRole("heading", { name: "Pause 1 corridor?" })).toHaveFocus();
    await expect(canvas.getByText(/Existing orders keep working/)).toBeVisible();
  },
};

export const ConflictError: Story = {
  args: { view: savedView },
  parameters: {
    msw: { handlers: [http.put("/api/admin/settings/funding", () => HttpResponse.json({ error: { code: "SETTINGS_CONFLICT" }, current: savedResponse }, { status: 409 }))] },
  },
  play: async ({ canvasElement }) => {
    const canvas = await reviewRipioOnramp(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Confirm" }));
    await waitForReady(() => expect(canvas.getByText("Someone else changed these settings")).toBeVisible());
    await expect(canvas.getByRole("button", { name: "Review and save" })).toBeDisabled();
  },
};

export const SaveUnavailable: Story = {
  args: { view: savedView },
  parameters: {
    msw: { handlers: [http.put("/api/admin/settings/funding", () => HttpResponse.json({ error: { code: "SETTINGS_UNAVAILABLE" } }, { status: 503 }))] },
  },
  play: async ({ canvasElement }) => {
    const canvas = await reviewRipioOnramp(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Confirm" }));
    await waitForReady(() => expect(canvas.getByRole("alert")).toHaveTextContent("Settings can't be saved right now."));
  },
};

export const Unavailable: Story = {
  args: { view: null },
};
