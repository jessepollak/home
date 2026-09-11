import { Heading, Text } from "@home/ui";
import { FoundationCatalog } from "./foundation-catalog";

export default function Page() {
  return (
    <main className="catalog-shell">
      <header className="catalog-header">
        <Heading level={1}>Home UI foundation</Heading>
        <Text tone="muted">Typography, buttons, and interface icons. Isolated specimens, not a Home preview.</Text>
      </header>
      <FoundationCatalog />
    </main>
  );
}
