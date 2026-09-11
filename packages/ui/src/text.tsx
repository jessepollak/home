import type { HTMLAttributes } from "react";

export type TextStyle =
  | "amount"
  | "page-title"
  | "sheet-title"
  | "section-title"
  | "row-label"
  | "row-value"
  | "body"
  | "input"
  | "control"
  | "secondary"
  | "metadata";

type TypographyProps = HTMLAttributes<HTMLElement> & {
  /** Visual role only; never changes HTML semantics or the document outline. */
  textStyle?: TextStyle;
  tone?: "default" | "muted";
};

export type TextProps = TypographyProps & {
  as?: "p" | "span" | "div" | "strong" | "em" | "small";
};

export function Text({
  as: Element = "p",
  textStyle = "body",
  tone = "default",
  className,
  ...props
}: TextProps) {
  return (
    <Element
      {...props}
      className={["home-ui-text", className].filter(Boolean).join(" ")}
      data-text-style={textStyle}
      data-tone={tone}
    />
  );
}

export type HeadingProps = TypographyProps & {
  level: 1 | 2 | 3 | 4 | 5 | 6;
};

export function Heading({
  level,
  textStyle = "page-title",
  tone = "default",
  className,
  ...props
}: HeadingProps) {
  const Element = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <Element
      {...props}
      className={["home-ui-text", className].filter(Boolean).join(" ")}
      data-text-style={textStyle}
      data-tone={tone}
    />
  );
}
