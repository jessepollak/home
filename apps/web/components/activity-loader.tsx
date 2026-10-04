import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

export function ActivityLoader({ loading = true, children }: { loading?: boolean; children?: ReactNode }) {
  return (
    <div className="flex min-h-10 w-full items-center justify-center py-2" data-activity-continuation="">
      {loading ? (
        <LoaderCircle
          className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none"
          data-activity-loader=""
          aria-hidden="true"
        />
      ) : children}
    </div>
  );
}
