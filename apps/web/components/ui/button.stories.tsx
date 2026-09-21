import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { X } from "lucide-react";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import { Button } from "./button";

const meta = {
  id: "ui-button",
  title: "UI/Button",
  component: Button,
  args: { children: "Continue" },
  parameters: { layout: "centered" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button>Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
    </div>
  ),
};

export const Disabled: Story = { args: { disabled: true } };

/**
 * The press treatment is a CSS `:active` state, so observing it needs real
 * pointer input: synthetic events from `storybook/test` never set it. Under the
 * story-test gate (vitest browser mode) the play function drives real mouse
 * input through the vitest provider and asserts the computed pressed scale; in
 * a plain workshop session, where no provider input exists, the press-state
 * checks are skipped and only the environment-independent semantics run.
 */
type PressInput = {
  userEvent: { click: (element: Element, options?: { delay?: number }) => Promise<void> };
  page: { elementLocator: (element: Element) => { dropTo: (target: unknown) => Promise<void> } };
};

async function pressInput(): Promise<PressInput | null> {
  const globals = globalThis as { __vitest_browser__?: boolean };
  if (!globals.__vitest_browser__) return null;
  const mod = (await import("vitest/browser")) as unknown as Partial<PressInput>;
  if (!mod.userEvent || !mod.page) {
    throw new Error("The vitest browser provider input API is unavailable in this run.");
  }
  return mod as PressInput;
}

type PressSample = { active: boolean; scale: string };

/** `none` is the computed rest value of the independent `scale` property. */
function scaleOf(element: Element) {
  return getComputedStyle(element).scale === "none" ? "1" : getComputedStyle(element).scale;
}

/**
 * Presses `element` with real pointer input, samples it on animation frames while
 * the pointer is down, and returns every sample so a caller can assert both the
 * pressed and the rest state.
 */
async function samplePress(input: PressInput, element: Element, gesture?: () => Promise<void>) {
  const samples: PressSample[] = [];
  let done = false;
  const sampler = (async () => {
    while (!done) {
      samples.push({ active: element.matches(":active"), scale: scaleOf(element) });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  })();

  if (gesture) await gesture();
  else await input.userEvent.click(element, { delay: 500 });

  done = true;
  await sampler;
  return samples;
}

/** The last scale observed while the pointer was actually down. */
function pressedScale(samples: PressSample[]) {
  return [...samples].reverse().find((sample) => sample.active)?.scale;
}

async function expectRest(element: Element) {
  await waitFor(() => expect(scaleOf(element)).toBe("1"), { timeout: 2000, interval: 20 });
}

function PressFeedbackStory() {
  const [activations, setActivations] = useState(0);
  const activate = () => setActivations((count) => count + 1);

  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={activate}>Primary action</Button>
        <Button variant="outline" aria-haspopup="dialog" onClick={activate}>Popup trigger</Button>
        <Button variant="ghost" size="icon" aria-label="Dismiss" onClick={activate}>
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="link" size="inline" onClick={activate}>Inline action</Button>
        <Button variant="ghost" press="none" onClick={activate}>Wide row exception</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button aria-busy="true" onClick={activate}>Busy action</Button>
        <Button disabled onClick={activate}>Disabled action</Button>
      </div>
      <p role="status">{activations} activations</p>
    </div>
  );
}

export const PressFeedback: Story = {
  render: () => <PressFeedbackStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const status = () => canvas.getByRole("status");
    const activations = () => Number((status().textContent ?? "").replace(/\D/g, ""));
    const expectActivations = async (expected: number) => {
      await waitFor(() => expect(activations()).toBe(expected));
    };

    const primary = canvas.getByRole("button", { name: "Primary action" });
    const popupTrigger = canvas.getByRole("button", { name: "Popup trigger" });
    const iconButton = canvas.getByRole("button", { name: "Dismiss" });
    const rowException = canvas.getByRole("button", { name: "Wide row exception" });

    const input = await pressInput();
    if (input) {
      // Standard action: compresses while held, activates once, returns to rest.
      const standard = await samplePress(input, primary);
      await expect(standard.some((sample) => sample.active)).toBe(true);
      await expect(pressedScale(standard)).toBe("0.97");
      await expectRest(primary);
      await expectActivations(1);

      // Popup triggers were excluded from the shared press treatment before.
      const popup = await samplePress(input, popupTrigger);
      await expect(popup.some((sample) => sample.active)).toBe(true);
      await expect(pressedScale(popup)).toBe("0.97");
      await expectRest(popupTrigger);
      await expectActivations(2);

      // Icon-only controls compress deliberately more.
      const icon = await samplePress(input, iconButton);
      await expect(icon.some((sample) => sample.active)).toBe(true);
      await expect(pressedScale(icon)).toBe("0.95");
      await expectRest(iconButton);
      await expectActivations(3);

      // A wide row exception keeps its whole-surface size while pressed.
      const row = await samplePress(input, rowException);
      await expect(row.some((sample) => sample.active)).toBe(true);
      await expect(pressedScale(row)).toBe("1");
      await expectRest(rowException);
      await expectActivations(4);

      // Press, drag outside, release: no activation and no stuck press state.
      const drag = await samplePress(input, primary, () =>
        input.page.elementLocator(primary).dropTo(input.page.elementLocator(popupTrigger)),
      );
      await expect(drag.some((sample) => sample.active)).toBe(true);
      await expectRest(primary);
      await expectActivations(4);
    }

    const activationsBeforeClicks = activations();
    await userEvent.click(primary);
    await expectActivations(activationsBeforeClicks + 1);

    // A busy control keeps its existing interaction semantics.
    const busy = canvas.getByRole("button", { name: "Busy action" });
    await expect(busy).toBeEnabled();
    await userEvent.click(busy);
    await expectActivations(activationsBeforeClicks + 2);
    await expect(busy).toHaveAttribute("aria-busy", "true");

    const disabled = canvas.getByRole("button", { name: "Disabled action" });
    await expect(disabled).toBeDisabled();
    await fireEvent.click(disabled);
    await expectActivations(activationsBeforeClicks + 2);
  },
};
