type StoryMeta = { id?: string; title: string; parameters?: { library?: { render?: string; order?: number } } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function requireStoryMeta(module: unknown): StoryMeta {
  if (!isRecord(module) || !isRecord(module.default)) throw new Error("Missing story meta");
  const meta = module.default;
  if (typeof meta.title !== "string" || (meta.id !== undefined && typeof meta.id !== "string")) {
    throw new Error("Invalid story meta title or id");
  }
  const parameters = meta.parameters;
  if (parameters !== undefined && !isRecord(parameters)) throw new Error("Invalid story parameters");
  const library = parameters?.library;
  if (library !== undefined && !isRecord(library)) throw new Error("Invalid library parameters");
  const render = library?.render;
  if (render !== undefined && typeof render !== "string") throw new Error("Invalid library render mode");
  const order = library?.order;
  if (order !== undefined && (typeof order !== "number" || !Number.isFinite(order))) throw new Error("Invalid library order");
  return { title: meta.title, id: meta.id, parameters: { library: { render, order } } };
}
