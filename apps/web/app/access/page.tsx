import { cookies } from "next/headers";
import { brand } from "@/config/brand";
import { Button } from "@/components/ui/button";
import { AccessForm } from "./access-form";
import { readAccessConfig } from "@/server/access/config";
import { readAccessToken } from "@/server/access/token";
import { ACCESS_COOKIE_NAME, parseSafeAccessDestination } from "@/shared/access/contract";

export const dynamic = "force-dynamic";

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const config = readAccessConfig();
  const query = await searchParams;
  const next = parseSafeAccessDestination(
    typeof query.next === "string" ? query.next : undefined,
  );
  const accessCookie = (await cookies()).get(ACCESS_COOKIE_NAME)?.value;
  const hasAccess = config.kind === "enabled" && Boolean(
    accessCookie && readAccessToken(accessCookie, config),
  );

  return (
    <main className="grid min-h-dvh place-items-center px-6 py-12">
      <section className="grid w-full max-w-sm gap-6" aria-labelledby="access-heading">
        <div className="grid gap-2">
          <p className="text-sm font-semibold">{brand.name}</p>
          <h1 id="access-heading" className="text-2xl font-semibold tracking-tight">
            {hasAccess ? "Access granted" : "Enter access password"}
          </h1>
          {!hasAccess && config.kind === "enabled" ? (
            <p className="text-sm text-muted-foreground">
              This deployment is private.
            </p>
          ) : null}
        </div>

        {config.kind === "misconfigured" ? (
          <p role="alert" className="text-sm text-muted-foreground">
            Access is temporarily unavailable.
          </p>
        ) : config.kind === "disabled" ? (
          <a className="text-sm font-medium text-primary underline-offset-4 hover:underline" href={next}>
            Continue to Home
          </a>
        ) : hasAccess ? (
          <div className="grid gap-4">
            <a className="text-sm font-medium text-primary underline-offset-4 hover:underline" href={next}>
              Continue to Home
            </a>
            <form action="/api/access/logout" method="post">
              <Button variant="link" size="inline" type="submit">
                Leave this deployment
              </Button>
            </form>
          </div>
        ) : (
          <AccessForm next={next} />
        )}
      </section>
    </main>
  );
}
