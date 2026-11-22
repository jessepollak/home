import type { ComponentType, ReactNode } from "react";
import { AuroraBackdrop } from "./aurora";
import { DimensionalBackdrop } from "./dimensional";
import { ShaderBackdrop } from "./shader";

export type BackdropVariant = "none" | "aurora" | "shader" | "dimensional";
export type BackdropRegion = "hero" | "customers" | "team" | "demo";

export type BackdropProps = { region: BackdropRegion; children: ReactNode };

const variants: Record<Exclude<BackdropVariant, "none">, ComponentType<BackdropProps>> = {
  aurora: AuroraBackdrop,
  shader: ShaderBackdrop,
  dimensional: DimensionalBackdrop,
};

export function Backdrop({ variant, region, children }: BackdropProps & { variant: BackdropVariant }) {
  if (variant === "none") return children;
  const Variant = variants[variant];
  return <Variant region={region}>{children}</Variant>;
}
