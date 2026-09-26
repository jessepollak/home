import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Button } from "./button";
import { Combobox, ComboboxInput, ComboboxItem, ComboboxList } from "./combobox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./dialog";
import { Kbd } from "./kbd";

function DialogExample() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>Open dialog</DialogTrigger>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Press ? anywhere to open this list.</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

const commands = [
  { id: "fit", label: "Fit board", key: "0" },
  { id: "next", label: "Next frame", key: "J" },
  { id: "previous", label: "Previous frame", key: "K" },
];

function CommandExample() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>Open palette</DialogTrigger>
      <DialogContent variant="command" aria-label="Command palette">
        <Combobox<(typeof commands)[number]> items={commands} inline autoHighlight="always" itemToStringLabel={(item) => item.label}>
          <ComboboxInput aria-label="Search commands" placeholder="Search commands…" showTrigger={false} variant="search" />
          <ComboboxList>
            {(item: (typeof commands)[number]) => (
              <ComboboxItem key={item.id} value={item} className="justify-between gap-3 px-2.5">
                {item.label}
                <Kbd>{item.key}</Kbd>
              </ComboboxItem>
            )}
          </ComboboxList>
        </Combobox>
      </DialogContent>
    </Dialog>
  );
}

const meta = {
  id: "ui-dialog",
  title: "UI/Dialog",
  component: DialogExample,
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof DialogExample>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Open dialog" }));
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole("dialog", { name: "Keyboard shortcuts" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  },
};

export const Command: Story = {
  render: () => <CommandExample />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Open palette" }));
    const body = within(canvasElement.ownerDocument.body);
    const input = await body.findByRole("combobox", { name: "Search commands" });
    await waitFor(() => expect(input).toHaveFocus());
    await userEvent.keyboard("next");
    await waitFor(() => expect(body.getByRole("option", { name: /Next frame/ })).toHaveAttribute("data-highlighted"));
  },
};
