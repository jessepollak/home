import type { ComponentProps, ReactNode } from "react";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  align = "center",
  label,
  content,
  className,
  ...props
}: {
  title: ReactNode;
  align?: "center" | "start";
  label?: string;
  content?: ReactNode;
} & Omit<ComponentProps<"div">, "children" | "title" | "content">) {
  const body = (
    <Empty
      className={cn(align === "start" && "items-start justify-start text-left", className)}
      {...props}
    >
      <EmptyHeader className={align === "start" ? "items-start" : undefined}>
        <EmptyTitle>{title}</EmptyTitle>
      </EmptyHeader>
      {content !== undefined ? <EmptyContent>{content}</EmptyContent> : null}
    </Empty>
  );
  if (label !== undefined) {
    return <section aria-label={label}>{body}</section>;
  }
  return body;
}
