import Link from "next/link";
import { brand } from "@/config/brand";

export default function AdminNotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 py-12">
      <section className="grid w-full max-w-sm gap-6" aria-labelledby="admin-not-found-heading">
        <div className="grid gap-2">
          <p className="text-sm font-semibold">{brand.name}</p>
          <h1 id="admin-not-found-heading" className="text-2xl font-semibold tracking-tight">Admin page not found</h1>
          <p className="text-sm text-muted-foreground">This page is not available.</p>
        </div>
        <Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" href="/admin">Back to Admin</Link>
      </section>
    </main>
  );
}
