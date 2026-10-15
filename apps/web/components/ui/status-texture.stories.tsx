import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { Skeleton } from "./skeleton";
import { StatusMark, statusTextClass, type StatusTexture } from "./status-texture";

const textures: StatusTexture[] = ["settled", "working", "needs-you", "cant-load", "failed", "done", "loading"];

function TextureTable() {
  return <table className="w-96 max-w-full text-sm">
    <caption className="mb-4 text-start font-medium">Status textures</caption>
    <thead><tr><th scope="col" className="w-12 text-start">Mark</th><th scope="col" className="text-start">Texture</th></tr></thead>
    <tbody>{textures.map((texture) => <tr key={texture} data-texture={texture}>
      <td className="py-3"><StatusMark texture={texture} /></td>
      <td className="py-3"><div className={statusTextClass(texture, "title")}>{texture}</div>{texture === "loading" ? <Skeleton className="mt-1 h-4 w-40" /> : <div className={statusTextClass(texture, "context")}>Account activity</div>}</td>
    </tr>)}</tbody>
  </table>;
}

const meta = {
  id: "ui-status-texture",
  title: "UI/Status Texture",
  component: TextureTable,
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof TextureTable>;
export default meta;
type Story = StoryObj<typeof meta>;

async function verifyMarks(canvasElement: HTMLElement) {
  await expect(within(canvasElement).getAllByRole("row")).toHaveLength(8);
  const spinner = canvasElement.querySelector('[data-slot="status-spinner"]');
  const clock = canvasElement.querySelector('[data-slot="status-clock"]');
  if (!spinner || !clock) throw new Error("Missing working marks");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  await expect(reduced ? clock : spinner).toBeVisible();
  await expect(reduced ? spinner : clock).not.toBeVisible();
  await expect(canvasElement.querySelector('[data-texture="settled"] svg')).toBeNull();
  await expect(canvasElement.querySelector('[data-texture="loading"] svg')).toBeNull();
}

export const Textures: Story = { play: async ({ canvasElement }) => verifyMarks(canvasElement) };
export const Dark: Story = { ...Textures, globals: { theme: "dark" } };
export const ReducedMotion: Story = {
  beforeEach: async () => {
    if (!("__vitest_browser__" in globalThis)) return;
    const { cdp } = await import("@vitest/browser/context");
    await cdp().send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    return async () => { await cdp().send("Emulation.setEmulatedMedia", { features: [] }); };
  },
  play: async ({ canvasElement }) => {
    await verifyMarks(canvasElement);
    if ("__vitest_browser__" in globalThis) await expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
  },
};
