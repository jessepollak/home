export async function readJson(body: Request | Response): Promise<unknown> {
  const value: unknown = await body.json();
  return value;
}
