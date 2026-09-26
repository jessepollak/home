import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CircleAlertIcon } from "lucide-react";
import { expect, within } from "storybook/test";
import { Alert, AlertAction, AlertDescription, AlertIcon, AlertTitle } from "./alert";
import { Button } from "./button";

const meta = {
  id: "ui-alert",
  title: "UI/Alert",
  component: Alert,
  args: { children: "Saved balance is stale." },
  parameters: { layout: "centered", a11y: { test: "error" }, design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=158-1862" } },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="w-80">
      <Alert {...args}>
        <AlertTitle>Saved balance unavailable</AlertTitle>
        <AlertDescription>Retry to load the latest onchain snapshot.</AlertDescription>
      </Alert>
    </div>
  ),
};

export const Dark: Story = { ...Default, globals: { theme: "dark" } };

export const Destructive: Story = {
  args: { variant: "destructive" },
  render: (args) => (
    <div className="w-80">
      <Alert {...args}>
        <AlertIcon><CircleAlertIcon /></AlertIcon>
        <AlertTitle>Deposit failed</AlertTitle>
        <AlertDescription>The deposit did not succeed onchain.</AlertDescription>
      </Alert>
    </div>
  ),
};

export const WithAction: Story = {
  render: (args) => (
    <div className="w-80">
      <Alert {...args}>
        <AlertDescription>Vaults are temporarily unavailable.</AlertDescription>
        <AlertAction>
          <Button variant="outline" size="touch">Retry</Button>
        </AlertAction>
      </Alert>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const description = canvas.getByText("Vaults are temporarily unavailable.").getBoundingClientRect();
    const action = canvas.getByRole("button", { name: "Retry" }).getBoundingClientRect();
    const alert = canvas.getByRole("alert").getBoundingClientRect();
    await expect(action.left).toBeGreaterThanOrEqual(description.right);
    await expect(Math.abs((description.top + description.bottom) / 2 - (action.top + action.bottom) / 2)).toBeLessThanOrEqual(1);
    await expect(alert.height).toBeLessThanOrEqual(44 + 28 + 2 + 1);
  },
};

export const WithIcon: Story = {
  render: (args) => (
    <div className="w-80">
      <Alert {...args}>
        <AlertIcon><CircleAlertIcon /></AlertIcon>
        <AlertTitle>Saved balance unavailable</AlertTitle>
        <AlertDescription>Retry to load the latest onchain snapshot.</AlertDescription>
      </Alert>
    </div>
  ),
};

export const DestructiveWithAction: Story = {
  args: { variant: "destructive" },
  render: (args) => (
    <div className="w-80">
      <Alert {...args}>
        <AlertIcon><CircleAlertIcon /></AlertIcon>
        <AlertTitle>Account check unavailable</AlertTitle>
        <AlertDescription>Your account could not be checked. Try again.</AlertDescription>
        <AlertAction>
          <Button variant="outline" size="lg" className="h-11">Try again</Button>
        </AlertAction>
      </Alert>
    </div>
  ),
};

export const LongTextWithAction: Story = {
  render: (args) => (
    <div className="w-80">
      <Alert {...args}>
        <AlertIcon><CircleAlertIcon /></AlertIcon>
        <AlertTitle>Account check unavailable</AlertTitle>
        <AlertDescription>The account check could not finish. Your balances may be out of date until another account check succeeds.</AlertDescription>
        <AlertAction>
          <Button variant="outline" size="lg" className="h-11">Retry account check</Button>
        </AlertAction>
      </Alert>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const action = canvas.getByRole("button", { name: "Retry account check" }).getBoundingClientRect();
    const description = canvas.getByText(/The account check could not finish/).getBoundingClientRect();
    const icon = canvasElement.querySelector('[data-slot="alert-icon"]')!.getBoundingClientRect();
    const title = canvas.getByText("Account check unavailable").getBoundingClientRect();
    await expect(action.top).toBeGreaterThanOrEqual(description.bottom);
    await expect(description.width).toBeGreaterThanOrEqual(180);
    await expect(action.height).toBeGreaterThanOrEqual(44);
    await expect(Math.abs(icon.top - title.top)).toBeLessThanOrEqual(3);
  },
};

export const DescriptionOnlyDestructive: Story = {
  args: { variant: "destructive" },
  render: (args) => (
    <div className="w-80">
      <Alert {...args}>
        <AlertIcon><CircleAlertIcon /></AlertIcon>
        <AlertDescription>The deposit did not succeed onchain.</AlertDescription>
      </Alert>
    </div>
  ),
};
