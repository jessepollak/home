import { Suspense, lazy } from "react";

const Dialog = lazy(() => import("\u002e/dialog"));

export function Default() {
  return <Suspense fallback={null}><Dialog /></Suspense>;
}
