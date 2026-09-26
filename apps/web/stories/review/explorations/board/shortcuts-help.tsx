import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { commandGroups, type BoardCommand } from "./commands";
import styles from "./board.module.css";

function Keys({ keys }: { keys: string[] }) {
  return <KbdGroup className="flex-wrap justify-end">
    {keys.map((key, index) => <KbdGroup key={key}>
      {index > 0 && <span className={styles.keySeparator}>or</span>}
      <Kbd>{key}</Kbd>
    </KbdGroup>)}
  </KbdGroup>;
}

export function ShortcutList({ commands, label }: { commands: BoardCommand[]; label: string }) {
  return <dl className={styles.shortcuts} aria-label={label}>
    {commands.filter((command) => command.keys.length > 0).map((command) =>
      <div key={command.id}><dt>{command.label}</dt><dd><Keys keys={command.keys} /></dd></div>)}
  </dl>;
}

export function ShortcutsHelp({ open, onOpenChange, returnFocus, commands }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: HTMLElement | null;
  commands: BoardCommand[];
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent showCloseButton finalFocus={() => returnFocus ?? true}
      className="max-h-[80vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Keyboard shortcuts</DialogTitle>
      </DialogHeader>
      <div className={styles.helpGroups}>
        {commandGroups.map((group) => <section key={group} aria-labelledby={`shortcuts-${group}`}>
          <h3 id={`shortcuts-${group}`}>{group}</h3>
          <ShortcutList label={`${group} shortcuts`}
            commands={commands.filter((command) => command.group === group)} />
        </section>)}
      </div>
    </DialogContent>
  </Dialog>;
}
