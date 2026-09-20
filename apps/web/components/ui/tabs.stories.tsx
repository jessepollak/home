import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

const meta = {
  id: "ui-tabs",
  title: "UI/Tabs",
  component: Tabs,
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="cash" className="w-72">
      <TabsList>
        <TabsTrigger value="cash">Cash</TabsTrigger>
        <TabsTrigger value="investments">Investments</TabsTrigger>
      </TabsList>
      <TabsContent value="cash">Cash panel</TabsContent>
      <TabsContent value="investments">Investments panel</TabsContent>
    </Tabs>
  ),
};
