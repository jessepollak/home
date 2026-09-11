import { expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { IconButton, Heading } from "@home/ui";
import { PlusIcon } from "@home/ui/icons";

// These expressions are typechecked but never rendered. Public API regressions
// cause an unused @ts-expect-error diagnostic during the workspace typecheck.
const iconProps: ComponentProps<typeof IconButton> = { icon: PlusIcon, "aria-label": "Add example" };
// @ts-expect-error Accessible action name is required.
const unnamed: ComponentProps<typeof IconButton> = { icon: PlusIcon };
// @ts-expect-error Title does not substitute for the action name.
const titleOnly: ComponentProps<typeof IconButton> = { icon: PlusIcon, title: "Add example" };
// @ts-expect-error Artwork size is distinct from arbitrary target size.
const oversized: ComponentProps<typeof IconButton> = { ...iconProps, iconSize: 44 };
// @ts-expect-error Semantic heading level must be explicit.
const heading: ComponentProps<typeof Heading> = { children: "Heading" };

test("type-level accessibility contracts are included in validation", () => {
  expect([iconProps, unnamed, titleOnly, oversized, heading]).toHaveLength(5);
});
