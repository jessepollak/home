export function moneySheetIntent(...preloads: Array<() => void | Promise<unknown>>) {
  const preload = () => {
    for (const load of preloads) void load();
  };
  return { onPointerDown: preload, onFocus: preload };
}
