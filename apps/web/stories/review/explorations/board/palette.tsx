import { useMemo, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Combobox, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { rank } from "./commands";
import { Kbd } from "./kbd";
import styles from "./board.module.css";

export type PaletteItem = { id: string; label: string; detail: string; keys?: string[]; run: () => void };

const highlightFirstItem = { autoHighlight: "always" } as unknown as { autoHighlight: boolean };

export function CommandPalette({ open, onOpenChange, returnFocus, items }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: HTMLElement | null;
  items: PaletteItem[];
}) {
  const [query, setQuery] = useState("");
  const ranked = useMemo(() => rank(query, items), [query, items]);
  const change = (next: boolean) => {
    if (!next) setQuery("");
    onOpenChange(next);
  };
  return <Dialog.Root open={open} onOpenChange={change}>
    <Dialog.Portal>
      <Dialog.Backdrop className={styles.overlayBackdrop} />
      <Dialog.Popup className={`${styles.overlay} ${styles.palette}`} finalFocus={() => returnFocus ?? true} aria-label="Command palette">
        <Combobox<PaletteItem> inline open={open} onOpenChange={(next) => { if (!next) change(false); }}
          items={ranked} filter={null} {...highlightFirstItem}
          inputValue={query} onInputValueChange={setQuery}
          value={null} itemToStringLabel={(item) => item.label}
          onValueChange={(item) => {
            if (!item) return;
            change(false);
            item.run();
          }}>
          <ComboboxInput className={styles.paletteSearch} aria-label="Search commands and frames"
            placeholder="Search commands and frames…" showTrigger={false} />
          <ComboboxList className={styles.paletteList}>
            {(item: PaletteItem) => <ComboboxItem key={item.id} value={item} className={styles.paletteItem}>
              <span className={styles.paletteLabel}>{item.label}</span>
              <span className={styles.paletteDetail}>{item.detail}</span>
              {item.keys?.[0] && <Kbd>{item.keys[0]}</Kbd>}
            </ComboboxItem>}
          </ComboboxList>
          {ranked.length === 0 && <p className={styles.paletteEmpty} role="status">No matches</p>}
        </Combobox>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}
