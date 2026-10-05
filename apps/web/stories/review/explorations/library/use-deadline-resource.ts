import { useEffect, useState } from "react";
import { startRenderDeadline } from "../board/render-deadline";

export function useDeadlineResource<T>(key: string | undefined, load: (key: string) => Promise<T>, peek?: (key: string) => T | undefined) {
  const [state, setState] = useState<{ key: string; value?: T; failed?: boolean } | null>(null);
  const cached = key === undefined ? undefined : peek?.(key);
  useEffect(() => {
    if (key === undefined || peek?.(key) !== undefined) return;
    let live = true;
    const stop = startRenderDeadline(() => { if (live) setState({ key, failed: true }); });
    load(key).then((value) => {
      if (live) setState({ key, value });
    }, () => {
      if (live) setState({ key, failed: true });
    }).finally(stop);
    return () => {
      live = false;
      stop();
    };
  }, [key, load, peek]);
  const current = state?.key === key ? state : null;
  return { value: cached ?? current?.value, failed: cached === undefined && current?.failed === true };
}
