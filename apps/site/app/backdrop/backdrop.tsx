import { DiffuseBackdrop } from "./diffuse";

export type BackdropVariant = "none" | "diffuse";

export function Backdrop({ variant }: { variant: BackdropVariant }) {
  if (variant === "none") return null;
  return <DiffuseBackdrop />;
}
