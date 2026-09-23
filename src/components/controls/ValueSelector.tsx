import { valueLabel } from '../../lib/defaultSettings';
import { OptionSelector } from './OptionSelector';

interface ValueSelectorProps<T extends string> {
  label: string;
  values: readonly T[];
  value: T;
  onChange: (value: T) => void;
  /** Display name for a value; defaults to the console's menu labels for settings values */
  labelFor?: (value: T) => string;
}

/** OptionSelector over stored values (e.g. "enhanced-plus"), showing display labels ("Enhanced+") */
export function ValueSelector<T extends string>({ label, values, value, onChange, labelFor = valueLabel }: ValueSelectorProps<T>) {
  return (
    <OptionSelector
      label={label}
      options={values.map(labelFor)}
      value={labelFor(value)}
      onChange={(selected) => {
        const match = values.find((v) => labelFor(v) === selected);
        if (match) onChange(match);
      }}
    />
  );
}
