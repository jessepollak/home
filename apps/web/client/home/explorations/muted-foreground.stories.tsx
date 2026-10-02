import type { CSSProperties, ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import homeOverviewMeta from "../home-overview.stories";

const HomeOverviewStory = homeOverviewMeta.component;

type MutedForegroundOverviewProps = ComponentProps<typeof HomeOverviewStory> & {
  mutedForeground: string;
};

function MutedForegroundOverview({ mutedForeground, ...args }: MutedForegroundOverviewProps) {
  const style: CSSProperties & { "--muted-foreground": string } = {
    "--muted-foreground": mutedForeground,
  };
  return (
    <div
      className="min-h-screen bg-muted"
      style={style}
    >
      <HomeOverviewStory {...args} />
    </div>
  );
}

const meta = {
  id: "explorations-muted-foreground",
  title: "Explorations/Home/Muted foreground",
  component: MutedForegroundOverview,
  tags: ["exploration"],
  globals: { theme: "light" },
  args: { ...homeOverviewMeta.args, mutedForeground: "oklch(0.556 0 0)" },
  parameters: { ...homeOverviewMeta.parameters, a11y: { test: "todo" } },
} satisfies Meta<typeof MutedForegroundOverview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Current: Story = {};
export const A: Story = { args: { mutedForeground: "oklch(0.54 0 0)" } };
export const B: Story = { args: { mutedForeground: "oklch(0.52 0 0)" } };
export const C: Story = { args: { mutedForeground: "oklch(0.50 0 0)" } };
