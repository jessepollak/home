import Link from "next/link";
import { brand } from "@/config/brand";
import { readOperatorPageDecision } from "@/server/operator/page";

export default async function AdminPage() {
  const decision = await readOperatorPageDecision();
  if (decision.kind !== "operator") return null;
  return (
    <main className="grid min-h-dvh place-items-center px-6 py-12">
      <section className="grid w-full max-w-sm gap-6" aria-labelledby="admin-heading">
        <div className="grid gap-2">
          <p className="text-sm font-semibold">{brand.name}</p>
          <h1 id="admin-heading" className="text-2xl font-semibold tracking-tight">Admin</h1>
          <p className="text-sm text-muted-foreground">{decision.address}</p>
        </div>
        <Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" href="/home">Back to Home</Link>
      </section>
    </main>
  );
}
