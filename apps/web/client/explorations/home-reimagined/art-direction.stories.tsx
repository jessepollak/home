import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { reimaginedFundedState, reimaginedLongLocalizedState } from "./fixtures";
import { ReferenceHome } from "./reference-home";
import { homeReimaginedViewports, reviewViewport } from "./story-viewports";
import styles from "./art-direction.module.css";

const meta = {
  id: "explorations-home-art-direction",
  title: "Explorations/Home reimagined/Art direction",
  component: ReferenceHome,
  args: { initialState: reimaginedFundedState() },
  ...reviewViewport("mobile"),
  parameters: {
    ...reviewViewport("mobile").parameters,
    viewport: { options: {
      ...homeReimaginedViewports,
      narrow: { name: "320×844", styles: { width: "320px", height: "844px" } },
      comparison: { name: "1266×928", styles: { width: "1266px", height: "928px" } },
    } },
  },
} satisfies Meta<typeof ReferenceHome>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Stable anonymous review entry: fixed 390×844 scrollports, never scaled to fit. */
export const Comparison: Story = {
  globals: { viewport: { value: "comparison" } },
  render: () => (
    <main className={styles.comparison} aria-label="A/B/C comparison">
      {(["A", "B", "C"] as const).map((label) => (
        <section key={label} aria-label={label}>
          <h2>{label}</h2>
          <div className={styles.frame}>
            <ReferenceHome embedded treatment={label} initialState={reimaginedFundedState()} />
          </div>
        </section>
      ))}
    </main>
  ),
};

/** Keep export names: linked from the anonymous comparison and review record. */
export const A: Story = { args: { treatment: "A" } };
export const B: Story = { args: { treatment: "B" } };
export const C: Story = { args: { treatment: "C" } };

/** Spot checks only; no new content, journey, or state matrix. */
export const ALargeLocal: Story = { args: { treatment: "A", initialState: reimaginedLongLocalizedState() } };
export const BLargeLocal: Story = { args: { treatment: "B", initialState: reimaginedLongLocalizedState() } };
export const CLargeLocal: Story = { args: { treatment: "C", initialState: reimaginedLongLocalizedState() } };
