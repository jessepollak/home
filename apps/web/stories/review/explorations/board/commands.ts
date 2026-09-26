export type CommandGroup = "Canvas" | "Selection" | "Panels" | "General";
export const commandGroups: CommandGroup[] = ["Canvas", "Selection", "Panels", "General"];

export type BoardCommand = {
  id: string;
  label: string;
  group: CommandGroup;
  keys: string[];
  match?: (event: KeyboardEvent) => boolean;
  run?: (event?: KeyboardEvent) => void;
  enabled?: boolean;
  palette?: boolean;
  anywhere?: boolean;
  featured?: boolean;
};

export type CommandActions = {
  fitBoard: () => void;
  fitSelection: () => void;
  zoom: (factor: number) => void;
  zoomReset: () => void;
  pan: (x: number, y: number) => void;
  toggleOutline: () => void;
  toggleInspector: () => void;
  interact: () => void;
  canInteract: boolean;
  openStory: () => void;
  openCanvas: () => void;
  copyLink: () => void;
  openPalette: () => void;
  openShortcuts: () => void;
};

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl ";
const hasMod = (event: KeyboardEvent) => event.metaKey || event.ctrlKey;
const plain = (event: KeyboardEvent) => !hasMod(event) && !event.altKey;
const withMod = (event: KeyboardEvent) => hasMod(event) && !event.altKey;

export function boardCommands(actions: CommandActions): BoardCommand[] {
  const zoomIn = () => actions.zoom(1.2);
  const zoomOut = () => actions.zoom(1 / 1.2);
  return [
    { id: "fit-board", label: "Fit board", group: "Canvas", keys: ["⇧1"], featured: true,
      match: (event) => plain(event) && event.code === "Digit1", run: actions.fitBoard },
    { id: "fit-selection", label: "Fit selection", group: "Canvas", keys: ["⇧2", "F"], featured: true,
      match: (event) => plain(event) && (event.code === "Digit2" || event.key.toLowerCase() === "f"),
      run: actions.fitSelection },
    { id: "zoom-in", label: "Zoom in", group: "Canvas", keys: ["+", `${mod}+`],
      match: (event) => (plain(event) || withMod(event)) && (event.key === "+" || event.key === "="),
      run: zoomIn },
    { id: "zoom-out", label: "Zoom out", group: "Canvas", keys: ["−", `${mod}−`],
      match: (event) => (plain(event) || withMod(event)) && event.key === "-", run: zoomOut },
    { id: "zoom-reset", label: "Zoom to 100%", group: "Canvas", keys: [`${mod}0`], featured: true,
      match: (event) => (plain(event) && event.code === "Digit0") || (withMod(event) && event.key === "0"),
      run: actions.zoomReset },
    { id: "pan-keys", label: "Pan", group: "Canvas", keys: ["Arrow keys"], palette: false,
      match: (event) => plain(event) && event.key.startsWith("Arrow"),
      run: (event) => {
        if (!event) return;
        const step = event.shiftKey ? 120 : 40;
        actions.pan(event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0,
          event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0);
      } },
    { id: "pan-scroll", label: "Pan", group: "Canvas", keys: ["Scroll", "Space + Drag"], featured: true },
    { id: "zoom-gesture", label: "Zoom", group: "Canvas", keys: [`${mod}Scroll`, "Pinch"], featured: true },
    { id: "interact", label: "Interact with selection", group: "Selection", keys: ["Enter", "Double-click"],
      featured: true, enabled: actions.canInteract,
      match: (event) => plain(event) && event.key === "Enter", run: actions.interact },
    { id: "exit-interact", label: "Stop interacting", group: "Selection", keys: ["Esc"] },
    { id: "open-story", label: "Open story", group: "Selection", keys: [], run: actions.openStory },
    { id: "open-canvas", label: "Open canvas", group: "Selection", keys: [], run: actions.openCanvas },
    { id: "copy-link", label: "Copy link", group: "Selection", keys: [], run: actions.copyLink },
    { id: "toggle-outline", label: "Toggle outline", group: "Panels", keys: ["["], featured: true, anywhere: true,
      match: (event) => plain(event) && event.key === "[", run: actions.toggleOutline },
    { id: "toggle-inspector", label: "Toggle inspector", group: "Panels", keys: ["]"], featured: true,
      anywhere: true, match: (event) => plain(event) && event.key === "]", run: actions.toggleInspector },
    { id: "command-palette", label: "Command palette", group: "General", keys: [`${mod}K`], palette: false,
      featured: true, anywhere: true,
      match: (event) => withMod(event) && !event.shiftKey && event.key.toLowerCase() === "k",
      run: actions.openPalette },
    { id: "show-shortcuts", label: "Show keyboard shortcuts", group: "General", keys: ["?"], featured: true,
      anywhere: true, match: (event) => plain(event) && event.key === "?", run: actions.openShortcuts },
  ];
}

export function commandForKey(commands: BoardCommand[], event: KeyboardEvent, onControl: boolean) {
  return commands.find((command) => command.run && command.enabled !== false &&
    (!onControl || command.anywhere) && command.match?.(event));
}

export function fuzzyScore(query: string, text: string): number | null {
  const needle = query.toLowerCase().replace(/\s+/g, "");
  if (!needle) return 0;
  const haystack = text.toLowerCase();
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const char of needle) {
    const found = haystack.indexOf(char, from);
    if (found < 0) return null;
    if (found === previous + 1) score += 2;
    if (found === 0 || /[\s·/-]/.test(haystack[found - 1])) score += 3;
    score -= (found - from) * 0.05;
    previous = found;
    from = found + 1;
  }
  return score - haystack.length * 0.01;
}

export function rank<T extends { label: string; detail?: string }>(query: string, items: T[]): T[] {
  if (!query.trim()) return items;
  return items.flatMap((item, order) => {
    const score = fuzzyScore(query, item.label) ?? fuzzyScore(query, `${item.label} ${item.detail ?? ""}`);
    return score === null ? [] : [{ item, score, order }];
  }).sort((a, b) => b.score - a.score || a.order - b.order).map(({ item }) => item);
}
