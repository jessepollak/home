export function applyTheme(doc: Document, theme: unknown) {
  doc.documentElement.classList.toggle("dark", theme === "dark");
}
