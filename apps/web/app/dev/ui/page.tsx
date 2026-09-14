import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const swatches = [
  ["Background", "bg-background text-foreground border-border"],
  ["Card", "bg-card text-card-foreground border-border"],
  ["Primary", "bg-primary text-primary-foreground border-primary"],
  ["Secondary", "bg-secondary text-secondary-foreground border-border"],
  ["Muted", "bg-muted text-muted-foreground border-border"],
  ["Accent", "bg-accent text-accent-foreground border-border"],
  ["Destructive", "bg-destructive text-primary-foreground border-destructive"],
] as const;

export default function UiThemePreviewPage() {
  if (
    process.env.HOME_PLAYWRIGHT_SMOKE !== "1" &&
    process.env.NODE_ENV !== "development"
  ) {
    notFound();
  }

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-3xl gap-8 bg-background p-6 font-sans text-foreground">
      <section className="grid gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Home UI theme</h1>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {swatches.map(([label, className]) => (
            <div
              key={label}
              className={`grid min-h-24 place-items-center rounded-xl border p-3 text-center text-xs ${className}`}
            >
              {label}
            </div>
          ))}
        </div>
      </section>

      <Card>
        <CardHeader><CardTitle>Stock type scale</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3">
            <div className="text-4xl font-semibold tabular-nums">$1,234.56</div>
            <div className="text-2xl font-semibold tracking-tight">Page title</div>
            <div className="text-lg font-semibold">Section title</div>
            <div className="text-sm font-medium">Row title</div>
            <div className="text-sm tabular-nums">1,234.56 USDC</div>
            <div className="text-sm">Body copy</div>
            <div className="text-sm text-muted-foreground">Description</div>
            <div className="text-xs text-muted-foreground">Metadata</div>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Buttons</h2>
        <div className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="destructive">Destructive</Button>
        </div>
      </section>
    </main>
  );
}
