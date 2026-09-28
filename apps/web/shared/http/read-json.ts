export async function readJson(response: Response): Promise<unknown> {
  const value: unknown = await response.json();
  return value;
}
