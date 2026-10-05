import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { AccountSignInSheet } from "@/client/account/account-screen";
import {
  AccountWalletClientProvider,
  createBlockedAccountWalletClient,
  type AccountWalletClient,
} from "@/client/account/cdp-client";

const OUTAGE_COPY = "Email sign-in is temporarily unavailable. Try again in a few minutes.";
const REJECTED_COPY = "We could not send a code. Check the address and try again.";

class EmailApiError extends Error {
  constructor(readonly statusCode: number, readonly errorType: string) {
    super(statusCode === 503 ? "Service unavailable." : "Invalid request.");
  }
}

function SignInJourney({ statusCode, errorType, transportFailure = false }: { statusCode: number; errorType: string; transportFailure?: boolean }) {
  const client: AccountWalletClient = {
    ...createBlockedAccountWalletClient("unconfigured"),
    projectConfigured: true,
    signInAvailability: "ready",
    requestEmailCode: async () => {
      if (transportFailure) throw new TypeError("Failed to fetch");
      throw new EmailApiError(statusCode, errorType);
    },
  };
  return (
    <AccountWalletClientProvider client={client}>
      <AccountSignInSheet open onClose={() => {}} />
    </AccountWalletClientProvider>
  );
}

const meta = {
  id: "journeys-account-sign-in",
  title: "Journeys/Account sign-in",
  component: SignInJourney,
  args: { statusCode: 503, errorType: "service_unavailable" },
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    viewport: { defaultViewport: "mobile" },
  },
} satisfies Meta<typeof SignInJourney>;

export default meta;
type Story = StoryObj<typeof meta>;

async function submitEmail(canvasElement: HTMLElement) {
  const screen = within(canvasElement.ownerDocument.body);
  await userEvent.type(screen.getByRole("textbox", { name: "Email address" }), "person@example.com");
  await userEvent.click(screen.getByRole("button", { name: "Continue with email" }));
  return screen;
}

async function expectOutageCopy(canvasElement: HTMLElement) {
  const screen = await submitEmail(canvasElement);
  const alert = await screen.findByRole("alert");
  await expect(alert).toHaveTextContent(OUTAGE_COPY);
  await expect(alert).not.toHaveTextContent("Check the address");
}

export const ProviderOutage: Story = {
  play: async ({ canvasElement }) => {
    await expectOutageCopy(canvasElement);
  },
};

export const ProviderOutageUnknownErrorType: Story = {
  args: { statusCode: 0, errorType: "unknown" },
  play: async ({ canvasElement }) => {
    await expectOutageCopy(canvasElement);
  },
};

export const TransportFailure: Story = {
  args: { statusCode: 0, errorType: "unknown", transportFailure: true },
  play: async ({ canvasElement }) => {
    await expectOutageCopy(canvasElement);
  },
};

export const RejectedAddress: Story = {
  args: { statusCode: 400, errorType: "invalid_request" },
  play: async ({ canvasElement }) => {
    const screen = await submitEmail(canvasElement);
    const alert = await screen.findByRole("alert");
    await expect(alert).toHaveTextContent(REJECTED_COPY);
  },
};
