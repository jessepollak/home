import { describe, expect, test } from "bun:test";
import { boardCommands, commandForKey, type CommandActions } from "../../stories/review/explorations/board/commands";

const actions: CommandActions = {
  fitBoard: () => {}, fitSelection: () => {}, stepSection: () => {}, zoom: () => {}, zoomReset: () => {},
  pan: () => {}, toggleOutline: () => {}, toggleInspector: () => {}, interact: () => {},
  canInteract: true, openStory: () => {}, openCanvas: () => {}, copyLink: () => {},
  openPalette: () => {}, openShortcuts: () => {},
};

function withNavigator(platform: string | undefined, userAgent: string, check: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true, value: { userAgentData: platform ? { platform } : undefined, userAgent },
  });
  try { check(); } finally {
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
}

function key(key: string, modifiers: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {}) {
  return { key, code: key === "0" ? "Digit0" : `Key${key.toUpperCase()}`,
    metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
    ...modifiers } as KeyboardEvent;
}

describe("board platform modifier", () => {
  for (const [platform, agent, modifier, other, display] of [
    ["macOS", "Windows NT", "metaKey", "ctrlKey", "⌘"],
    ["Windows", "Macintosh", "ctrlKey", "metaKey", "Ctrl "],
    [undefined, "Mozilla/5.0 (Macintosh; Intel Mac OS X)", "metaKey", "ctrlKey", "⌘"],
    [undefined, "Mozilla/5.0 (X11; Linux x86_64)", "ctrlKey", "metaKey", "Ctrl "],
  ] as const) {
    test(`matches only the ${platform ?? "user-agent"} modifier`, () => {
      withNavigator(platform, agent, () => {
        const commands = boardCommands(actions);
        const match = (event: KeyboardEvent) => commandForKey(commands, event, false)?.id;
        expect(commands.find((command) => command.id === "command-palette")?.keys).toEqual([`${display}K`]);
        expect(match(key("k", { [modifier]: true }))).toBe("command-palette");
        expect(match(key("k", { [other]: true }))).toBeUndefined();
        expect(match(key("k", { metaKey: true, ctrlKey: true }))).toBeUndefined();
        expect(match(key("k", { [modifier]: true, altKey: true }))).toBeUndefined();
        expect(match(key("0", { [modifier]: true }))).toBe("zoom-reset");
        expect(match(key("0", { [other]: true }))).toBeUndefined();
        expect(match(key("+", { [modifier]: true }))).toBe("zoom-in");
        expect(match(key("-", { [modifier]: true }))).toBe("zoom-out");
        expect(match(key("+", { metaKey: true, ctrlKey: true }))).toBeUndefined();
      });
    });
  }
});
