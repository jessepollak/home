import { useId } from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { inputPropValue, propLabel, type PropControl, type PropValue } from "./controls";
import styles from "./library.module.css";

export function PropsBar({ name, controls, values, onChange }: {
  name: string;
  controls: PropControl[] | null;
  values: Record<string, unknown>;
  onChange: (name: string, value: PropValue | undefined) => void;
}) {
  const id = useId();
  if (!controls) return <div className={styles.propsBar} role="status">Loading props…</div>;
  if (!controls.length) return <div className={styles.propsBar} role="status">{name} has no editable props</div>;
  return <form className={styles.propsBar} aria-label={`${name} props`} onSubmit={(event) => event.preventDefault()}>
    {controls.map((control) => {
      const fieldId = `${id}-${control.name}`;
      const label = propLabel(control.name);
      const value = values[control.name];
      if (control.kind === "boolean") return <span key={control.name} className={styles.propField}>
        <span id={fieldId}>{label}</span>
        <Switch aria-labelledby={fieldId} checked={value === true}
          onCheckedChange={(checked) => onChange(control.name, checked)} />
      </span>;
      if (control.kind === "select") return <span key={control.name} className={styles.propField}>
        <label htmlFor={fieldId}>{label}</label>
        <NativeSelect id={fieldId} className={styles.propSelect} value={value === undefined ? "" : String(value)}
          onChange={(event) => onChange(control.name,
            control.options.find((option) => String(option) === event.target.value))}>
          {control.initial === undefined && <option value="">Default</option>}
          {control.options.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
        </NativeSelect>
      </span>;
      return <span key={control.name} className={styles.propField}>
        <label htmlFor={fieldId}>{label}</label>
        <Input id={fieldId} className={styles.propInput} type={control.kind === "number" ? "number" : "text"}
          value={value === undefined ? "" : String(value)}
          placeholder={control.kind === "text" && control.enumLike ? control.initial : undefined}
          onChange={(event) => onChange(control.name, inputPropValue(control, event.target.value))} />
      </span>;
    })}
  </form>;
}
