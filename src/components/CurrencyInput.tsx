import React, { useRef, useId } from 'react';
import { formatRupiahInput, parseRupiahInput, terbilangRupiah } from '../lib/numberFormat';

export interface CurrencyInputProps {
  value: number | null | undefined;
  onChange: (val: number | null) => void;
  placeholder?: string;
  prefix?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  required?: boolean;
  autoFocus?: boolean;
  showTerbilang?: boolean;
  min?: number;
  max?: number;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  id?: string;
  name?: string;
  'aria-label'?: string;
}

export const CurrencyInput: React.FC<CurrencyInputProps> = ({
  value,
  onChange,
  placeholder = '0',
  prefix = 'Rp',
  disabled = false,
  className = '',
  inputClassName = '',
  required = false,
  autoFocus = false,
  showTerbilang = true,
  min,
  max,
  onFocus,
  onBlur,
  id,
  name,
  'aria-label': ariaLabel
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const autoId = useId();
  const inputId = id || autoId;

  const displayValue = formatRupiahInput(value);
  const terbilangText = showTerbilang && value && value > 0 ? terbilangRupiah(value) : '';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawInput = e.target.value;
    const digitsOnly = rawInput.replace(/\D/g, '');

    if (!digitsOnly) {
      onChange(null);
      return;
    }

    let numVal = parseInt(digitsOnly, 10);
    if (isNaN(numVal)) {
      onChange(null);
      return;
    }

    if (max != null && numVal > max) {
      numVal = max;
    }

    onChange(numVal);
  };

  return (
    <div className={`w-full ${className}`}>
      <div className="relative flex items-center">
        {prefix && (
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 dark:text-slate-500 font-mono select-none pointer-events-none">
            {prefix}
          </span>
        )}
        <input
          ref={inputRef}
          id={inputId}
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          required={required}
          autoFocus={autoFocus}
          value={displayValue}
          placeholder={placeholder}
          aria-label={ariaLabel}
          onFocus={(e) => {
            if (onFocus) onFocus(e);
          }}
          onBlur={onBlur}
          onChange={handleChange}
          className={`w-full ${prefix ? 'pl-11' : 'pl-3.5'} pr-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-mono text-sm font-bold focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${inputClassName}`}
        />
      </div>
      {terbilangText && !disabled && (
        <div className="mt-1 flex items-center gap-1.5 px-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 animate-fadeIn">
          <span className="shrink-0 font-bold">Terbaca:</span>
          <span className="truncate italic text-slate-600 dark:text-slate-300">
            {terbilangText}
          </span>
        </div>
      )}
    </div>
  );
};
