import type { ComponentType, ReactNode } from "react";
import { ShaderBackdrop } from "./shader";

export type BackdropVariant = "none" | "shader";
export type BackdropRegion = "hero" | "customers" | "team" | "demo";

export type BackdropProps = { region: BackdropRegion; children: ReactNode };

const variants: Record<Exclude<BackdropVariant, "none">, ComponentType<BackdropProps>> = {
  shader: ShaderBackdrop,
};

export function Backdrop({ variant, region, children }: BackdropProps & { variant: BackdropVariant }) {
  if (variant === "none") return children;
  const Variant = variants[variant];
  return <Variant region={region}>{children}</Variant>;
}
