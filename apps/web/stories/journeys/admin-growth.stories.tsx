import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { http, HttpResponse } from "msw";
import { GrowthDashboard, type GrowthDashboardData } from "@/client/admin/growth-dashboard";
import { requireAddress } from "@/shared/chain/hex";
import { GROWTH_SETTINGS_DEFAULTS } from "@/shared/operator-settings/growth";
import { waitForReady } from "@/tests/helpers/story-readiness";

const operator = "0x1111111111111111111111111111111111111111" as const;
const empty: GrowthDashboardData = {
  stats: { inviteLinks: 0, attributedSignUps: 0 },
  funnel: { counts: { joined: 0, saved: 0, qualified: 0, approved: 0, rejected: 0, disqualified: 0, ineligible: 0 }, historyPendingCount: 0, reservedAtoms: "0", approvedCount: 0 },
  queue: { qualified: [], approved: [], approvedAtoms: "0" },
  settings: { value: GROWTH_SETTINGS_DEFAULTS, revision: 0, source: "default", updatedAt: null, updatedBy: null },
  signerState: "absent", payoutIsSigner: null,
};
const populated: GrowthDashboardData = {
  ...empty,
  stats: { inviteLinks: 12, attributedSignUps: 21 },
  funnel: { counts: { joined: 7, saved: 5, qualified: 1, approved: 2, rejected: 1, disqualified: 3, ineligible: 2 }, historyPendingCount: 2, reservedAtoms: "10000000", approvedCount: 2 },
  settings: { value: { ...GROWTH_SETTINGS_DEFAULTS, enabled: true, countries: ["US"], acknowledgements: { taxReporting: true, sanctionsScreening: true }, inviterRewardAtoms: "5000000", budgetAtoms: "100000000", termsText: "Hold a qualifying Save deposit for 30 days.", payoutAccount: requireAddress(operator) }, revision: 3, source: "stored", updatedAt: "2026-10-01T12:00:00.000Z", updatedBy: operator },
  signerState: "configured", payoutIsSigner: true,
  queue: { qualified: [{ id: "11111111-1111-4111-8111-111111111111", inviterShortId: "12345678", inviteeShortId: "87654321", depositAssetsAtoms: "25000000", attributedAt: "2026-08-01T12:00:00.000Z", qualifiedAt: "2026-09-01T12:00:00.000Z", riskSignals: ["funded-by-inviter", "signup-burst", "preexisting-shares"] }], approved: [{ id: "22222222-2222-4222-8222-222222222222", inviterShortId: "abcd1234", inviteeShortId: "dcba4321", depositAssetsAtoms: "50000000", attributedAt: "2026-08-01T12:00:00.000Z", qualifiedAt: "2026-09-01T12:00:00.000Z", decidedAt: "2026-09-02T12:00:00.000Z", riskSignals: [], reservedAtoms: "10000000" }], approvedAtoms: "10000000" },
};
const meta = {
  title: "Journeys/Admin growth", component: GrowthDashboard,
  decorators: [(Story) => <main className="mx-auto grid max-w-5xl gap-6 p-6"><h1 className="text-2xl font-semibold">Growth</h1><Story /></main>],
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true }, a11y: { test: "error" } },
  args: { operator },
} satisfies Meta<typeof GrowthDashboard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { args: { data: empty }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByText("No rewards in review.")).toBeVisible();
  await userEvent.click(canvas.getByRole("switch", { name: "Enabled" }));
  await expect(canvas.getByText("Missing enable requirements: countries, acknowledgements, reward, budget, terms, payout-account")).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Save program settings" })).toBeDisabled();
} };
export const PopulatedQueue: Story = { args: { data: populated }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByText("Funded by inviter")).toBeVisible();
  await expect(canvas.getByText("Balance history is behind for 2 rewards")).toBeVisible();
} };
export const UnavailableSections: Story = { args: { data: { ...empty, stats: null, funnel: null, queue: null, settings: null } }, play: async ({ canvasElement }) => {
  await expect(within(canvasElement).getByText("Program settings are unavailable.")).toBeVisible();
} };
export const PayoutNotSigner: Story = { args: { data: { ...populated, payoutIsSigner: false } }, play: async ({ canvasElement }) => {
  await expect(within(canvasElement).getByText("Saved payout account is not a payout signer.")).toBeVisible();
} };
export const NotPayoutAccount: Story = { args: { data: populated, operator: "0x2222222222222222222222222222222222222222" }, play: async ({ canvasElement }) => {
  await expect(within(canvasElement).getByText("Sign in as the payout account to pay")).toBeVisible();
} };
export const Approve: Story = { args: { data: populated }, parameters: { msw: { handlers: [http.post("/api/admin/growth/rewards/:id", () => HttpResponse.json({ version: 1, state: "approved" }))] } }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Approve" }));
  await waitForReady(() => expect(canvas.getByText("Approved, awaiting payout.", { exact: true })).toBeVisible());
} };
export const Reject: Story = { args: { data: populated }, parameters: { msw: { handlers: [http.post("/api/admin/growth/rewards/:id", () => HttpResponse.json({ version: 1, state: "rejected" }))] } }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Reject" }));
  await expect(canvas.getByRole("button", { name: "Confirm rejection" })).toBeDisabled();
  await userEvent.type(canvas.getByRole("textbox", { name: "Rejection reason (operator only)" }), "Review failed");
  await userEvent.click(canvas.getByRole("button", { name: "Confirm rejection" }));
  await waitForReady(() => expect(canvas.getByText("Rejected.", { exact: true })).toBeVisible());
} };
