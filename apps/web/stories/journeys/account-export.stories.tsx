import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useCallback, useRef, useState } from "react";
import { HttpResponse, http } from "msw";
import { expect, userEvent, spyOn, within } from "storybook/test";
import { AccountSettings } from "@/client/account/account-settings";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { Button } from "@/components/ui/button";
import { ACCOUNT_EXPORT_HOME_CLASSES, type AccountExportResponse } from "@/shared/account/contracts/data-export";

type Scenario = "idle" | "pending" | "error" | "success" | "owner-switch";
const body: AccountExportResponse = {
  version: 1, schema: "home.account-export", generatedAt: "2026-10-07T03:00:00.000Z", complete: true,
  classes: ACCOUNT_EXPORT_HOME_CLASSES.map((name) => ({ name, holder: "home", records: [] })),
  boundaries: { providerHeld: "Provider records are not included.", publicChain: "Public chain records are not included.", currentDevice: "Current device metadata is added by the browser." },
};

function AccountExportJourney({ scenario = "idle" }: { scenario?: Scenario }) {
  const [owner, setOwner] = useState("first-owner");
  const [releaseStatus, setReleaseStatus] = useState<string | null>(null);
  const attempts = useRef(0);
  const pending = useRef<{ resolve: (value: unknown) => void; signal?: AbortSignal } | null>(null);
  const fetchAccountResource = useCallback<AccountWalletClient["fetchAccountResource"]>(async (path, options) => {
    if (path === "/api/invites/link") return { version: 1, code: "abcdefghjk" };
    if (path !== "/api/account/export") throw new Error("Unexpected story request");
    attempts.current += 1;
    if (scenario === "error" && attempts.current === 1) throw new Error("Unavailable");
    if (scenario === "pending" || scenario === "owner-switch" && owner === "first-owner") {
      return new Promise<unknown>((resolve) => { pending.current = { resolve, signal: options?.signal }; });
    }
    return body;
  }, [owner, scenario]);
  return (
    <main className="mx-auto w-full max-w-160 p-4">
      {scenario === "owner-switch" ? (
        <div className="flex flex-wrap gap-2 pb-4">
          <Button variant="outline" onClick={() => setOwner("second-owner")}>Switch owner</Button>
          <Button variant="outline" onClick={() => {
            pending.current?.resolve(body);
            setReleaseStatus(pending.current?.signal?.aborted ? "request aborted" : "request active");
          }}>Complete previous export</Button>
          {releaseStatus ? <span role="status">Previous response released; {releaseStatus}</span> : null}
        </div>
      ) : null}
      <AccountSettings
        regionId="US"
        onRegionChange={() => {}}
        resolutionSource="persisted"
        preferenceMessage=""
        isPreferenceReady
        accountAddress={owner === "first-owner" ? "0x1111111111111111111111111111111111111111" : "0x3333333333333333333333333333333333333333"}
        accountOwnerKey={owner}
        fetchAccountResource={fetchAccountResource}
        showSmallBalances={false}
        onShowSmallBalancesChange={() => {}}
        appearancePreference="light"
        onAppearancePreferenceChange={() => true}
        onSignOut={() => {}}
      />
    </main>
  );
}

const meta = {
  title: "Journeys/Account export",
  component: AccountExportJourney,
  parameters: {
    a11y: { test: "error" },
    viewport: { defaultViewport: "mobile" },
    msw: { handlers: [http.get("https://api.ensideas.com/*", () => HttpResponse.json({ name: "export.base.eth" }))] },
  },
} satisfies Meta<typeof AccountExportJourney>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};
export const Generating: Story = {
  args: { scenario: "pending" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Export" }));
    await expect(await canvas.findByRole("button", { name: "Preparing…" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Preparing…" })).toHaveAttribute("aria-busy", "true");
    await expect(canvas.getByText("Preparing your export")).toBeVisible();
  },
};
export const Downloaded: Story = {
  args: { scenario: "success" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      await userEvent.click(canvas.getByRole("button", { name: "Export" }));
      await expect(await canvas.findByText("Export downloaded")).toBeVisible();
      await expect(click).toHaveBeenCalledTimes(1);
      await expect(canvas.getByRole("button", { name: "Export" })).toBeEnabled();
    } finally { click.mockRestore(); }
  },
};
export const ErrorRetry: Story = {
  args: { scenario: "error" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      await userEvent.click(canvas.getByRole("button", { name: "Export" }));
      await expect(await canvas.findByText("Couldn't create your export. Nothing in your account changed.")).toBeVisible();
      await expect(click).not.toHaveBeenCalled();
      await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
      await expect(await canvas.findByText("Export downloaded")).toBeVisible();
      await expect(click).toHaveBeenCalledTimes(1);
    } finally { click.mockRestore(); }
  },
};
export const OwnerSwitch: Story = {
  args: { scenario: "owner-switch" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      await userEvent.click(canvas.getByRole("button", { name: "Export" }));
      await canvas.findByText("Preparing your export");
      await userEvent.click(canvas.getByRole("button", { name: "Switch owner" }));
      await expect(canvas.getByRole("button", { name: "Export" })).toBeEnabled();
      await userEvent.click(canvas.getByRole("button", { name: "Complete previous export" }));
      await expect(await canvas.findByText("Previous response released; request aborted")).toBeVisible();
      await expect(click).not.toHaveBeenCalled();
      await expect(canvas.queryByText("Export downloaded")).toBeNull();
      await userEvent.click(canvas.getByRole("button", { name: "Export" }));
      await expect(await canvas.findByText("Export downloaded")).toBeVisible();
      await expect(click).toHaveBeenCalledTimes(1);
    } finally { click.mockRestore(); }
  },
};
