import type { HTMLAttributes } from "react";

type DividerBaseProps = Omit<HTMLAttributes<HTMLDivElement>, "children" | "role"> & {
  orientation?: "horizontal" | "vertical";
};

type DecorativeDividerProps = DividerBaseProps & {
  decorative?: true;
  "aria-label"?: never;
};

type LabelledDividerProps = DividerBaseProps & {
  decorative: false;
  "aria-label": string;
};

export type DividerProps = DecorativeDividerProps | LabelledDividerProps;

export function Divider({
  orientation = "horizontal",
  decorative = true,
  className,
  ...props
}: DividerProps) {
  return (
    <div
      {...props}
      className={["home-ui-divider", className].filter(Boolean).join(" ")}
      data-orientation={orientation}
      role={decorative ? "presentation" : "separator"}
      aria-orientation={decorative ? undefined : orientation}
    />
  );
}
