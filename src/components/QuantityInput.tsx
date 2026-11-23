import React, { useId } from 'react';
import { formatQtyInput, parseQtyInput } from '../lib/numberFormat';

export interface QuantityInputProps {
  value: number | null | undefined;
  onChange: (val: number) => void;
  uom?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  required?: boolean;
  autoFocus?: boolean;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  id?: string;
}

export const QuantityInput: React.FC<QuantityInputProps> = ({
  value,
  onChange,
  uom = '',
  placeholder = '0',
  disabled = false,
  className = '',
  inputClassName = '',
  required = false,
  autoFocus = false,
  onFocus,
  onBlur,
  id
}) => {
  const autoId = useId();
  const inputId = id || autoId;

  // Nilai tampilan
  const [textValue, setTextValue] = React.useState<string>(() => {
    if (value == null || value === 0) return '';
    return formatQtyInput(value);
  });

  // Sinkronkan jika value dari luar berubah drastis
  React.useEffect(() => {
    const currentParsed = parseQtyInput(textValue);
    if (value !== currentParsed) {
      setTextValue(value == null || value === 0 ? '' : formatQtyInput(value));
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    
    // Hanya izinkan angka, titik, dan koma
    if (!/^[\d.,]*$/.test(input)) {
      return;
    }

    setTextValue(input);
    const parsed = parseQtyInput(input);
    onChange(parsed);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    // Format rapi saat blur
    if (value != null && value > 0) {
      setTextValue(formatQtyInput(value));
    }
    if (onBlur) onBlur(e);
  };

  return (
    <div className={`w-full ${className}`}>
      <div className="relative flex items-center">
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          required={required}
          autoFocus={autoFocus}
          value={textValue}
          placeholder={placeholder}
          onFocus={onFocus}
          onBlur={handleBlur}
          onChange={handleChange}
          className={`w-full px-4 py-3 bg-white dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-mono text-base font-extrabold focus:outline-hidden focus:border-blue-500 transition-all ${inputClassName}`}
        />
        {uom && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 dark:text-slate-500 font-mono pointer-events-none select-none">
            {uom}
          </span>
        )}
      </div>
      {value != null && value > 0 && (
        <div className="mt-1 flex items-center gap-1.5 px-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          <span className="shrink-0 font-bold">Terbaca:</span>
          <span className="font-mono font-semibold">
            {formatQtyInput(value)} {uom}
          </span>
        </div>
      )}
    </div>
  );
};
