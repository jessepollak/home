"use client";

import { defaultRangeExtractor, elementScroll, measureElement as measureVirtualElement, observeElementOffset, observeWindowOffset, observeWindowRect, windowScroll, type VirtualItem, type Virtualizer } from "@tanstack/react-virtual";
import { useVirtualizer } from "@tanstack/react-virtual";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type HTMLAttributes } from "react";
import type { ActivityLedgerGroup, ActivityLedgerItem } from "./activity-ledger";
import { shellVirtualKeyMissingEvent, shellVirtualMeasurementsKey, shellVirtualScrollKeyEvent, shellVirtualSnapshotEvent } from "@/client/home/use-shell-document-scroll-restoration";
import { isRecord } from "@/shared/guards";

export type ActivityVirtualRow =
  | { key: string; item: ActivityLedgerItem; child?: boolean }
  | { key: string; group: ActivityLedgerGroup; expanded: boolean; controls?: string };

const keyFor = (row: ActivityVirtualRow) => row.key;

type Anchor = { key: string; top: number; items: readonly ActivityVirtualRow[] };
type RowProps = {
  row: ActivityVirtualRow;
  attentionLabel: string;
  onOpen: (item: ActivityLedgerItem, opener: HTMLElement) => void;
  onToggle: (children: readonly ActivityLedgerItem[], expanded: boolean) => void;
  liProps?: HTMLAttributes<HTMLLIElement> & { ref?: (element: HTMLLIElement | null) => void; "data-index"?: number; "data-row-key"?: string };
};

function asWindowVirtualizer(instance: Virtualizer<HTMLElement, HTMLLIElement>): Virtualizer<Window, HTMLLIElement> {
  if ((instance.scrollElement as EventTarget | null) !== window) throw new Error("Expected window scroll host");
  const checked: unknown = instance;
  return checked as Virtualizer<Window, HTMLLIElement>;
}

export type ActivityListHandle = { restore: (key: string) => boolean };

function scrollHost(list: HTMLUListElement | null): HTMLElement | Window | null {
  if (!list) return null;
  for (let parent = list.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === "auto" || overflow === "scroll") return parent;
  }
  return window;
}

function listMargin(list: HTMLUListElement, host: HTMLElement | Window): number {
  if (host instanceof HTMLElement) {
    return list.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop - host.clientTop;
  }
  return list.getBoundingClientRect().top + window.scrollY;
}

type Props = {
  id: string;
  items: readonly ActivityVirtualRow[];
  exhausted: boolean;
  labelledBy?: string;
  attentionLabel: string;
  onOpen: (item: ActivityLedgerItem, opener: HTMLElement) => void;
  Row: ComponentType<RowProps>;
  onToggle: RowProps["onToggle"];
};

export const VirtualActivityList = memo(forwardRef<ActivityListHandle, Props>(function VirtualActivityList({
  id, items, exhausted, labelledBy, attentionLabel, onOpen, onToggle, Row,
}, ref) {
  const [renderedItems, setRenderedItems] = useState(items);
  const [list, setList] = useState<HTMLUListElement | null>(null);
  const [host, setHost] = useState<HTMLElement | Window | null>(null);
  const [margin, setMargin] = useState(0);
  const marginRef = useRef(0);
  const marginReady = useRef(false);
  const measuredMargin = useRef<{ list: HTMLUListElement; host: HTMLElement | Window } | null>(null);
  const measured = useRef(new Map<VirtualItem["key"], number>());
  const observedRect = useRef<{ host: HTMLElement; rect: { width: number; height: number } } | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const attached = useRef(false);
  const programmaticScroll = useRef(false);
  const pendingFocus = useRef<string | null>(null);
  const anchor = useRef<Anchor | null>(null);
  const pendingCorrection = useRef<Anchor | null>(null);
  const [initialMeasurements] = useState<VirtualItem[]>(() => {
    if (typeof window === "undefined") return [];
    const stored: unknown = window.history.state?.[shellVirtualMeasurementsKey];
    if (!Array.isArray(stored)) return [];
    return stored.filter((entry): entry is VirtualItem => {
      if (!isRecord(entry)) return false;
      const item = entry;
      const indexed = typeof item.index === "number" && Number.isInteger(item.index) && item.index >= 0
        ? items[item.index] : undefined;
      return indexed !== undefined && item.key === keyFor(indexed) &&
        typeof item.size === "number" && Number.isFinite(item.size) && item.size > 0 &&
        typeof item.start === "number" && Number.isFinite(item.start) &&
        typeof item.end === "number" && Number.isFinite(item.end) &&
        typeof item.lane === "number" && Number.isInteger(item.lane);
    });
  });
  const indexByKey = useMemo(() => new Map(renderedItems.map((item, index) => [keyFor(item), index])), [renderedItems]);
  const focusedIndex = focusedKey === null ? null : indexByKey.get(focusedKey) ?? null;
  const rangeExtractor = useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) => {
    const key = pendingCorrection.current?.key ?? (anchor.current && anchor.current.items !== renderedItems ? anchor.current.key : undefined);
    const anchored = key === undefined ? undefined : indexByKey.get(key);
    return [...new Set([...defaultRangeExtractor(range), ...(focusedIndex === null ? [] : [focusedIndex,
      Math.min(focusedIndex + 1, renderedItems.length - 1), Math.max(focusedIndex - 1, 0)]),
      ...(anchored === undefined ? [] : [anchored])])].sort((a, b) => a - b);
  }, [focusedIndex, indexByKey, renderedItems]);
  // oxlint-disable-next-line react/incompatible-library -- The virtualizer owns scroll updates and rendered ranges.
  const virtualizer = useVirtualizer<HTMLElement, HTMLLIElement>({
    count: renderedItems.length,
    getScrollElement: () => host as HTMLElement | null,
    estimateSize: () => 64,
    overscan: 8,
    getItemKey: (index) => keyFor(renderedItems[index]!),
    scrollMargin: margin,
    initialRect: { width: typeof window === "undefined" ? 1024 : window.innerWidth, height: typeof window === "undefined" ? 800 : window.innerHeight },
    initialMeasurementsCache: initialMeasurements,
    initialOffset: () => typeof window === "undefined" ? 0 : host instanceof HTMLElement ? host.scrollTop : host === window ? window.scrollY : 0,
    rangeExtractor,
    observeElementRect: (instance, callback) => {
      if (host === window) return observeWindowRect(asWindowVirtualizer(instance), callback);
      const element = instance.scrollElement;
      const targetWindow = instance.targetWindow;
      if (!element || !targetWindow) return;
      const handler = (rect: { width: number; height: number }) => {
        const rounded = { width: Math.round(rect.width), height: Math.round(rect.height) };
        observedRect.current = { host: element, rect: rounded };
        callback(rounded);
      };
      handler(observedRect.current?.host === element ? observedRect.current.rect : { width: element.offsetWidth, height: element.offsetHeight });
      if (!targetWindow.ResizeObserver) return () => {};
      const observer = new targetWindow.ResizeObserver((entries) => {
        const run = () => {
          const box = entries[0]?.borderBoxSize?.[0];
          handler(box ? { width: box.inlineSize, height: box.blockSize } : { width: element.offsetWidth, height: element.offsetHeight });
        };
        if (instance.options.useAnimationFrameWithResizeObserver) requestAnimationFrame(run);
        else run();
      });
      observer.observe(element, { box: "border-box" });
      return () => observer.unobserve(element);
    },
    observeElementOffset: (instance, callback) => host === window ? observeWindowOffset(asWindowVirtualizer(instance), callback) : observeElementOffset(instance, callback),
    measureElement: (node, entry, instance) => {
      if (!node.isConnected) {
        const index = instance.indexFromElement(node);
        return instance.itemSizeCache.get(instance.options.getItemKey(index)) ?? instance.options.estimateSize(index);
      }
      const key = instance.options.getItemKey(instance.indexFromElement(node));
      const box = entry?.borderBoxSize?.[0];
      if (box) {
        const size = instance.options.horizontal ? box.inlineSize : box.blockSize;
        measured.current.set(key, size);
        return size;
      }
      if (!entry) {
        const cached = instance.itemSizeCache.get(key) ?? measured.current.get(key);
        if (cached !== undefined) return cached;
      }
      const rect = node.getBoundingClientRect();
      const size = instance.options.horizontal ? rect.width : rect.height;
      const measuredSize = size || measureVirtualElement(node, entry, instance);
      measured.current.set(key, measuredSize);
      return measuredSize;
    },
    scrollToFn: (offset, options, instance) => {
      if (!attached.current) return;
      if (offset + (options.adjustments ?? 0) !== (host instanceof HTMLElement ? host.scrollTop : window.scrollY)) programmaticScroll.current = true;
      if (host === window) windowScroll(offset, options, asWindowVirtualizer(instance));
      else elementScroll(offset, options, instance);
    },
  });
  useEffect(() => {
    const snapshot = (event: Event) => {
      if (!(event instanceof CustomEvent) || !isRecord(event.detail)) return;
      const measurements = virtualizer.takeSnapshot();
      if (measurements.length) event.detail.measurements = measurements;
    };
    const measureBeforeJump = () => {
      if (virtualizer.isScrolling && !programmaticScroll.current) return;
      programmaticScroll.current = false;
      if (!list || !host) return;
      const offset = host instanceof HTMLElement ? host.scrollTop : window.scrollY;
      const viewport = host instanceof HTMLElement ? host.clientHeight : window.innerHeight;
      if (Math.abs(offset - (virtualizer.scrollOffset ?? 0)) < viewport) return;
      for (const row of list.querySelectorAll<HTMLLIElement>("li[data-index]")) virtualizer.measureElement(row);
    };
    window.addEventListener(shellVirtualSnapshotEvent, snapshot);
    host?.addEventListener("scroll", measureBeforeJump, { capture: true, passive: true });
    return () => {
      window.removeEventListener(shellVirtualSnapshotEvent, snapshot);
      host?.removeEventListener("scroll", measureBeforeJump, true);
    };
  }, [host, list, virtualizer]);
  useEffect(() => {
    const scrollToKey = (event: Event) => {
      if (!(event instanceof CustomEvent) || !isRecord(event.detail)) return;
      const key = event.detail.key;
      if (typeof key !== "string") return;
      const index = indexByKey.get(key);
      if (index === undefined) {
        if (exhausted) window.dispatchEvent(new CustomEvent(shellVirtualKeyMissingEvent, { detail: { key } }));
        return;
      }
      virtualizer.scrollToIndex(index, { align: "start" });
    };
    window.addEventListener(shellVirtualScrollKeyEvent, scrollToKey);
    return () => window.removeEventListener(shellVirtualScrollKeyEvent, scrollToKey);
  }, [exhausted, indexByKey, virtualizer]);
  useLayoutEffect(() => {
    attached.current = host !== null;
    return () => { attached.current = false; };
  }, [host]);
  const measureElement = useCallback((node: HTMLLIElement | null) => {
    virtualizer.measureElement(node);
  }, [virtualizer]);
  const attachList = useCallback((node: HTMLUListElement | null) => {
    setList(node);
    if (node) {
      attached.current = false;
      setHost(scrollHost(node));
    }
  }, []);
  useLayoutEffect(() => () => {
    if (list?.contains(document.activeElement)) list.closest<HTMLElement>('section[tabindex="-1"]')?.focus();
  }, [list]);
  useLayoutEffect(() => {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (row, _delta, instance) =>
      row.end <= (instance.scrollOffset ?? 0) + instance.scrollAdjustments;
  }, [virtualizer]);
  useLayoutEffect(() => {
    if (!list || !host || typeof ResizeObserver === "undefined") return;
    marginReady.current = false;
    const update = () => {
      const next = listMargin(list, host);
      const previous = marginRef.current;
      if (Math.abs(previous - next) <= 0.5) {
        marginReady.current = true;
        return;
      }
      const offset = host instanceof HTMLElement ? host.scrollTop : window.scrollY;
      if (marginReady.current && attached.current && offset > previous) {
        const delta = next - previous;
        if (host instanceof HTMLElement) host.scrollTop += delta;
        else window.scrollBy(0, delta);
      }
      marginRef.current = next;
      marginReady.current = true;
      setMargin(next);
    };
    if (measuredMargin.current?.list !== list || measuredMargin.current.host !== host) update();
    measuredMargin.current = { list, host };
    const observer = new ResizeObserver(update);
    for (let node: Element | null = list; node; node = node.parentElement) {
      observer.observe(node);
      for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) observer.observe(sibling);
      if (node === host) break;
    }
    return () => {
      observer.disconnect();
      marginReady.current = false;
    };
  }, [list, host]);
  const restore = useCallback((key: string) => {
    const index = indexByKey.get(key);
    if (index === undefined || !list) return false;
    pendingFocus.current = key;
    setFocusedKey(key);
    virtualizer.scrollToIndex(index, { align: "center" });
    return true;
  }, [indexByKey, list, virtualizer]);
  useImperativeHandle(ref, () => ({ restore }), [restore]);
  const virtualItems = virtualizer.getVirtualItems();
  useLayoutEffect(() => {
    if (renderedItems === items) return;
    if (focusedKey !== null && !items.some((item) => keyFor(item) === focusedKey) && list?.contains(document.activeElement)) {
      list.closest<HTMLElement>('section[tabindex="-1"]')?.focus();
      setFocusedKey(null);
    }
    let offset = host instanceof HTMLElement ? host.scrollTop : host === window ? window.scrollY : 0;
    const live = attached.current && list && host ? listMargin(list, host) : 0;
    if (attached.current && host && offset > 0 && offset > marginRef.current) {
      const delta = live - marginRef.current;
      if (Math.abs(delta) > 0.5) {
        if (host instanceof HTMLElement) host.scrollTop += delta;
        else window.scrollBy(0, delta);
        offset += delta;
      }
    }
    if (attached.current && list && host && Math.abs(marginRef.current - live) > 0.5) {
      marginRef.current = live;
      setMargin(live);
    }
    const row = attached.current && offset > 0 && offset > live ? virtualizer.getVirtualItemForOffset(offset - live + virtualizer.options.scrollMargin) : null;
    anchor.current = row ? { key: String(row.key), top: row.start - virtualizer.options.scrollMargin + live - offset, items: renderedItems } : null;
    setRenderedItems(items);
  }, [focusedKey, host, items, list, renderedItems, virtualizer]);
  useLayoutEffect(() => {
    if (!host || !list || !attached.current) {
      anchor.current = null;
      pendingCorrection.current = null;
      return;
    }
    const previous = pendingCorrection.current ?? anchor.current;
    if (!previous || (previous.items === renderedItems && !pendingCorrection.current)) return;
    const live = listMargin(list, host);
    if (Math.abs(marginRef.current - live) > 0.5) {
      marginRef.current = live;
      setMargin(live);
    }
    const index = indexByKey.get(previous.key);
    if (index === undefined) {
      anchor.current = null;
      pendingCorrection.current = null;
      return;
    }
    const row = virtualizer.getVirtualItems().find((rendered) => rendered.index === index);
    if (!row) {
      pendingCorrection.current = previous;
      anchor.current = null;
      return;
    }
    const delta = row.start - virtualizer.options.scrollMargin + live - previous.top - (host instanceof HTMLElement ? host.scrollTop : window.scrollY);
    if (Math.abs(delta) > 0.5) {
      if (host instanceof HTMLElement) host.scrollTop += delta;
      else window.scrollBy(0, delta);
    }
    const previousKeys = new Set(previous.items.map(keyFor));
    const renderedKeys = new Set(virtualItems.map((rendered) => rendered.key));
    const awaitingMeasurement = renderedItems.slice(0, index).some((item) => {
      const key = keyFor(item);
      return !previousKeys.has(key) && renderedKeys.has(key) && !virtualizer.itemSizeCache.has(key);
    });
    pendingCorrection.current = awaitingMeasurement ? previous : null;
    anchor.current = null;
  }, [renderedItems, host, list, indexByKey, virtualizer, virtualItems]);
  useLayoutEffect(() => {
    if (pendingFocus.current === null || !list) return;
    const index = indexByKey.get(pendingFocus.current);
    if (index === undefined) {
      pendingFocus.current = null;
      list.closest<HTMLElement>('section[tabindex="-1"]')?.focus();
      return;
    }
    const button = list.querySelector<HTMLButtonElement>(`li[data-index="${index}"] button`);
    if (button) {
      button.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  }, [focusedIndex, indexByKey, list, virtualItems]);
  const height = Math.max(0, virtualizer.getTotalSize());
  return (
    <ul
      ref={attachList}
      id={id}
      aria-labelledby={labelledBy}
      className="relative list-none p-0"
      style={{ height, overflowAnchor: "none" }}
      onFocusCapture={(event) => {
        const row = (event.target as Element).closest<HTMLLIElement>("li[data-index]");
        if (row) setFocusedKey(keyFor(renderedItems[Number(row.dataset.index)]!));
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedKey(null);
      }}
    >
      {virtualItems.map((virtualRow) => (
        <WindowedRow
          key={virtualRow.key}
          Row={Row}
          row={renderedItems[virtualRow.index]!}
          index={virtualRow.index}
          offset={virtualRow.start - margin}
          setsize={exhausted ? renderedItems.length : -1}
          attentionLabel={attentionLabel}
          onOpen={onOpen}
          onToggle={onToggle}
          measureElement={measureElement}
        />
      ))}
    </ul>
  );
}));

const WindowedRow = memo(function WindowedRow({ Row, row, index, offset, setsize, attentionLabel, onOpen, onToggle, measureElement }: {
  Row: ComponentType<RowProps>;
  row: ActivityVirtualRow;
  index: number;
  offset: number;
  setsize: number;
  attentionLabel: string;
  onOpen: RowProps["onOpen"];
  onToggle: RowProps["onToggle"];
  measureElement: (node: HTMLLIElement | null) => void;
}) {
  return (
    <Row
      row={row}
      attentionLabel={attentionLabel}
      onOpen={onOpen}
      onToggle={onToggle}
      liProps={{
        ref: measureElement,
        "data-index": index,
        "data-row-key": row.key,
        "aria-posinset": index + 1,
        "aria-setsize": setsize,
        style: { position: "absolute", top: 0, insetInlineStart: 0, inlineSize: "100%", transform: `translateY(${offset}px)` },
      }}
    />
  );
}, (previous, next) => previous.Row === next.Row && previous.index === next.index && previous.offset === next.offset &&
  previous.setsize === next.setsize && previous.attentionLabel === next.attentionLabel &&
  previous.onOpen === next.onOpen && previous.onToggle === next.onToggle && previous.measureElement === next.measureElement &&
  ("item" in previous.row && "item" in next.row
    ? previous.row.item === next.row.item && previous.row.child === next.row.child
    : "group" in previous.row && "group" in next.row && previous.row.group === next.row.group &&
      previous.row.expanded === next.row.expanded && previous.row.controls === next.row.controls));
