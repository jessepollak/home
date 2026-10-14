"use client";

import type { ReactNode } from "react";
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { ChevronDown } from "lucide-react";

export function AccordionDisclosure({ title, summary, attribution, headingLevel = 3, children }: {
  title: string;
  summary: ReactNode;
  attribution?: string;
  headingLevel?: 2 | 3;
  children: ReactNode;
}) {
  return <AccordionPrimitive.Root>
    <AccordionPrimitive.Item value="details">
      <AccordionPrimitive.Header render={(props) => headingLevel === 2 ? <h2 {...props}>{props.children}</h2> : <h3 {...props}>{props.children}</h3>}>
        <AccordionPrimitive.Trigger className="group flex min-h-14 w-full items-center gap-2.5 rounded-lg border border-transparent bg-muted/50 px-3 py-2.5 text-start text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex items-baseline gap-2 font-medium">{title}
              {attribution ? <span className="text-xs font-normal text-foreground">{attribution}</span> : null}
            </span>
            <span role="status" className="text-sm font-normal text-foreground">{summary}</span>
          </span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground group-data-[panel-open]:rotate-180" />
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Panel className="space-y-2 pt-2">{children}</AccordionPrimitive.Panel>
    </AccordionPrimitive.Item>
  </AccordionPrimitive.Root>;
}
