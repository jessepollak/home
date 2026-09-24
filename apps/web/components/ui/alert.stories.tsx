import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./alert";
import { Button } from "./button";

const meta = {
  id: "ui-alert",
  title: "UI/Alert",
  component: Alert,
  args: { children: "Saved balance is stale." },
  parameters: { layout: "centered", design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=158-1862" } },
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

export const Destructive: Story = {
  args: { variant: "destructive" },
  render: (args) => (
    <div className="w-80">
      <Alert {...args}>
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
        <AlertDescription>Vault rates stale.</AlertDescription>
        <AlertAction>
          <Button variant="ghost">Retry</Button>
        </AlertAction>
      </Alert>
    </div>
  ),
};
