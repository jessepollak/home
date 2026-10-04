import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field";

function DestructiveContrast({ destructive }: { destructive: string }) {
  const style: CSSProperties & { "--destructive": string } = {
    "--destructive": destructive,
  };
  return (
    <div className="min-h-screen bg-muted flex flex-col gap-6 p-4" style={style}>
      <Card>
        <CardHeader>
          <CardTitle>Remove API key</CardTitle>
          <CardDescription>Apps using this key stop working.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <span>Last request</span>
            <Badge variant="destructive">Failed</Badge>
          </div>
          <FieldError>Couldn&apos;t remove the key. Try again.</FieldError>
          <footer className="flex justify-end gap-2">
            <Button variant="outline">Cancel</Button>
            <Button variant="destructive">Remove</Button>
          </footer>
        </CardContent>
      </Card>
      <div className="flex items-center gap-3">
        <Badge variant="destructive">Failed</Badge>
        <Button variant="destructive">Remove</Button>
      </div>
      <Alert variant="destructive">
        <AlertTitle>Deposit failed</AlertTitle>
        <AlertDescription>Your deposit didn&apos;t go through. Try again.</AlertDescription>
      </Alert>
    </div>
  );
}

const meta = {
  id: "explorations-destructive-contrast",
  title: "Explorations/Theme/Destructive contrast",
  component: DestructiveContrast,
  tags: ["exploration"],
  globals: { theme: "light" },
  args: { destructive: "#c8372d" },
  parameters: { layout: "fullscreen", a11y: { test: "todo" } },
} satisfies Meta<typeof DestructiveContrast>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Current: Story = {};
export const A: Story = { args: { destructive: "#c33128" } };
export const B: Story = { args: { destructive: "#bd2b23" } };
export const C: Story = { args: { destructive: "#b42318" } };
