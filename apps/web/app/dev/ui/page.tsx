import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const swatches = [
  ["Background", "bg-background text-foreground border-border"],
  ["Card", "bg-card text-card-foreground border-border"],
  ["Primary", "bg-primary text-primary-foreground border-primary"],
  ["Muted", "bg-muted text-muted-foreground border-border"],
  ["Accent", "bg-accent text-accent-foreground border-border"],
  ["Destructive", "bg-destructive text-primary-foreground border-destructive"],
  ["Success", "bg-success text-success-foreground border-success"],
  ["Warning", "bg-warning-background text-warning border-warning-border"],
] as const;

export default function UiThemePreviewPage() {
  if (
    process.env.HOME_PLAYWRIGHT_SMOKE !== "1" &&
    process.env.NODE_ENV !== "development"
  ) {
    notFound();
  }

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-3xl gap-8 bg-background p-6 text-foreground font-sans">
      <section className="grid gap-4">
        <div role="heading" aria-level={1} className="text-page-title font-semibold">
          Home UI theme
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {swatches.map(([label, className]) => (
            <div
              key={label}
              className={`grid min-h-24 place-items-center rounded-xl border p-3 text-center text-metadata ${className}`}
            >
              {label}
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-3">
        <div className="text-section-title font-semibold">Type roles</div>
        <div className="text-amount font-mono">$1,234.56</div>
        <div className="text-page-title">Page title</div>
        <div className="text-sheet-title">Sheet title</div>
        <div className="text-section-title">Section title</div>
        <div className="text-row-label">Row label</div>
        <div className="text-row-value font-mono">1,234.56 USDC</div>
        <div className="text-body">Body copy</div>
        <div className="text-secondary text-muted-foreground">Secondary copy</div>
        <div className="text-metadata text-muted-foreground">Metadata</div>
      </section>

      <section className="grid gap-3">
        <div className="text-section-title font-semibold">Button</div>
        <div className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="destructive">Destructive</Button>
        </div>
      </section>
    </main>
  );
}
