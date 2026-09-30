export type PropValue = string | number | boolean;

export type ArgType = {
  name?: string;
  control?: false | string | { type?: string; disable?: boolean };
  options?: readonly unknown[];
  type?: { name?: string };
  table?: { disable?: boolean; defaultValue?: { summary?: string } };
};

export type PropControl =
  | { name: string; kind: "select"; options: PropValue[]; initial: PropValue | undefined }
  | { name: string; kind: "boolean"; initial: boolean | undefined }
  | { name: string; kind: "number"; initial: number | undefined }
  | { name: string; kind: "text"; initial: string | undefined; enumLike: boolean };

function isPropValue(value: unknown): value is PropValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function stringDefault(argType: ArgType): string | undefined {
  return argType.table?.defaultValue?.summary?.match(/^"([^"]*)"$/)?.[1];
}

export function propControls(argTypes: Record<string, ArgType>, initialArgs: Record<string, unknown>): PropControl[] {
  return Object.entries(argTypes).flatMap(([name, argType]): PropControl[] => {
    const control = argType.control;
    if (control === false || argType.table?.disable || (typeof control === "object" && control.disable)) return [];
    if (argType.type?.name === "function") return [];
    const kind = typeof control === "string" ? control : control?.type;
    const initial = initialArgs[name];
    if (initial !== undefined && !isPropValue(initial)) return [];
    if (Array.isArray(argType.options) && argType.options.length && argType.options.every(isPropValue)) {
      return [{ name, kind: "select", options: [...argType.options], initial }];
    }
    if (kind === "boolean") return [{ name, kind: "boolean", initial: typeof initial === "boolean" ? initial : undefined }];
    if (kind === "number" || kind === "range") {
      return [{ name, kind: "number", initial: typeof initial === "number" ? initial : undefined }];
    }
    if (kind === "text" || kind === "color" || kind === "date") {
      return typeof initial === "number" || typeof initial === "boolean" ? [] :
        [{ name, kind: "text", initial, enumLike: false }];
    }
    const fallback = typeof initial === "string" ? initial : stringDefault(argType);
    return kind === "object" && fallback !== undefined ? [{ name, kind: "text", initial: fallback, enumLike: true }] : [];
  });
}

export function propLabel(name: string): string {
  const words = name.replace(/[-_]+/g, " ").replace(/(?<=[a-z\d])(?=[A-Z])/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

export function storyArgs(controls: PropControl[], initialArgs: Record<string, unknown>,
  overrides: Record<string, PropValue>): Record<string, unknown> {
  return Object.fromEntries(controls.map((control) => [control.name,
    control.name in overrides ? overrides[control.name] : initialArgs[control.name]]));
}
