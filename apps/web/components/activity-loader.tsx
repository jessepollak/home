import { LoaderCircle } from "lucide-react";

export function ActivityLoader() {
  return (
    <div className="flex h-14 w-full items-center justify-center py-3" data-activity-loader="">
      <LoaderCircle
        className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none"
        aria-hidden="true"
      />
    </div>
  );
}
