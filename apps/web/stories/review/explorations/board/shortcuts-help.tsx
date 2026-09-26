import { Dialog } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { commandGroups, type BoardCommand } from "./commands";
import styles from "./board.module.css";

export function Keys({ keys }: { keys: string[] }) {
  return <span className={styles.keys}>
    {keys.map((key, index) => <span key={key} className={styles.keyAlternative}>
      {index > 0 && <span className={styles.keySeparator}>or</span>}
      <kbd>{key}</kbd>
    </span>)}
  </span>;
}

export function ShortcutList({ commands, label }: { commands: BoardCommand[]; label: string }) {
  return <dl className={styles.shortcuts} aria-label={label}>
    {commands.filter((command) => command.keys.length > 0).map((command) =>
      <div key={command.id}><dt>{command.label}</dt><dd><Keys keys={command.keys} /></dd></div>)}
  </dl>;
}

export function ShortcutsHelp({ open, onOpenChange, commands }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: BoardCommand[];
}) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Backdrop className={styles.overlayBackdrop} />
      <Dialog.Popup className={`${styles.overlay} ${styles.help}`}>
        <div className={styles.helpHeader}>
          <Dialog.Title className={styles.helpTitle}>Keyboard shortcuts</Dialog.Title>
          <Dialog.Close render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}>
            <XIcon />
          </Dialog.Close>
        </div>
        <div className={styles.helpGroups}>
          {commandGroups.map((group) => <section key={group} aria-labelledby={`shortcuts-${group}`}>
            <h3 id={`shortcuts-${group}`}>{group}</h3>
            <ShortcutList label={`${group} shortcuts`}
              commands={commands.filter((command) => command.group === group)} />
          </section>)}
        </div>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}
