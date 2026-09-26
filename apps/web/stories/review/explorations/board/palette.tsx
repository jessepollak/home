import { useMemo, useState } from "react";
import { Combobox, ComboboxCollection, ComboboxGroup, ComboboxGroupLabel, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { paletteGroups, rankPaletteItems, type PaletteItem } from "./palette-items";
import styles from "./board.module.css";

export function CommandPalette({ open, onOpenChange, returnFocus, items }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: () => HTMLElement | null;
  items: () => PaletteItem[];
}) {
  const [query, setQuery] = useState("");
  const ranked = useMemo(() => rankPaletteItems(query, items()), [query, items]);
  const grouped = useMemo(() => paletteGroups.map((value) => ({
    value, items: ranked.filter((item) => item.group === value),
  })).filter((group) => group.items.length > 0), [ranked]);
  const change = (next: boolean) => {
    if (!next) setQuery("");
    onOpenChange(next);
  };
  return <Dialog open={open} onOpenChange={change}>
    <DialogContent variant="command" finalFocus={() => returnFocus() ?? true} aria-label="Command palette"
      onKeyDownCapture={(event) => {
        if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
        const highlighted = event.currentTarget.querySelector<HTMLElement>("[role='option'][data-highlighted]");
        const item = ranked.find((candidate) => candidate.id === highlighted?.dataset.paletteId);
        if (!item) return;
        event.preventDefault();
        event.stopPropagation();
        change(false);
        item.run(true);
      }}>
      <Combobox<PaletteItem> inline open={open} onOpenChange={(next) => { if (!next) change(false); }}
        items={grouped} filter={null} autoHighlight="always"
        inputValue={query} onInputValueChange={setQuery}
        value={null} itemToStringLabel={(item) => item.label}
        onValueChange={(item) => {
          if (!item) return;
          change(false);
          item.run();
        }}>
        <ComboboxInput aria-label="Search board navigation"
          placeholder="Search commands, frames, boards, stories…" showTrigger={false} variant="search" />
        <ComboboxList className="max-h-[min(22.5rem,56vh)]">
          {(group: { value: string; items: PaletteItem[] }) =>
            <ComboboxGroup key={group.value} items={group.items}>
              <ComboboxGroupLabel>{group.value}</ComboboxGroupLabel>
              <ComboboxCollection>
                {(item: PaletteItem) => <ComboboxItem key={item.id} value={item} data-palette-id={item.id} className="gap-3 px-2.5">
                  <span className={styles.paletteLabel}>{item.label}</span>
                  <span className={styles.paletteDetail}>{item.detail}</span>
                  <span className={styles.paletteKeys}>{item.keys?.[0] && <Kbd>{item.keys[0]}</Kbd>}</span>
                </ComboboxItem>}
              </ComboboxCollection>
            </ComboboxGroup>}
        </ComboboxList>
        {ranked.length === 0 && <p className={styles.paletteEmpty} role="status">No matches</p>}
      </Combobox>
    </DialogContent>
  </Dialog>;
}
