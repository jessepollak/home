import { useMemo, useState } from "react";
import { Combobox, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { rank } from "./commands";
import styles from "./board.module.css";

export type PaletteItem = { id: string; label: string; detail: string; keys?: string[]; run: () => void };

export function CommandPalette({ open, onOpenChange, returnFocus, items }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: () => HTMLElement | null;
  items: PaletteItem[];
}) {
  const [query, setQuery] = useState("");
  const ranked = useMemo(() => rank(query, items), [query, items]);
  const change = (next: boolean) => {
    if (!next) setQuery("");
    onOpenChange(next);
  };
  return <Dialog open={open} onOpenChange={change}>
    <DialogContent variant="command" finalFocus={() => returnFocus() ?? true} aria-label="Command palette">
      <Combobox<PaletteItem> inline open={open} onOpenChange={(next) => { if (!next) change(false); }}
        items={ranked} filter={null} autoHighlight="always"
        inputValue={query} onInputValueChange={setQuery}
        value={null} itemToStringLabel={(item) => item.label}
        onValueChange={(item) => {
          if (!item) return;
          change(false);
          item.run();
        }}>
        <ComboboxInput aria-label="Search commands and frames"
          placeholder="Search commands and frames…" showTrigger={false} />
        <ComboboxList className="max-h-[min(22.5rem,56vh)] p-1.5">
          {(item: PaletteItem) => <ComboboxItem key={item.id} value={item} className="gap-3 px-2.5">
            <span className={styles.paletteLabel}>{item.label}</span>
            <span className={styles.paletteDetail}>{item.detail}</span>
            {item.keys?.[0] && <Kbd>{item.keys[0]}</Kbd>}
          </ComboboxItem>}
        </ComboboxList>
        {ranked.length === 0 && <p className={styles.paletteEmpty} role="status">No matches</p>}
      </Combobox>
    </DialogContent>
  </Dialog>;
}
