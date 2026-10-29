import type { ReactNode } from 'react';
import { Switch } from '@robert-stackflow/oneui/Switch';
type ToggleProps = {
  checked: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
  label?: string;
  description?: ReactNode;
  'aria-label'?: string;
};
export function Toggle({
  label,
  description,
  'aria-label': ariaLabel,
  ...props
}: ToggleProps) {
  return (
    <div className="setting-toggle">
      <Switch {...props} label={ariaLabel || label || '开关'} />
      {label && (
        <span>
          {label}
          {description && <small>{description}</small>}
        </span>
      )}
    </div>
  );
}
