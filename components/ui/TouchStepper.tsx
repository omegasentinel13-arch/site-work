'use client';

import React from 'react';
import { Minus, Plus } from 'lucide-react';

interface TouchStepperProps {
  value: number;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  label?: string;
  disabled?: boolean;
}

export function TouchStepper({
  value,
  onChange,
  min = 0,
  max = 999,
  label,
  disabled = false,
}: TouchStepperProps) {
  const handleDecrement = () => {
    if (disabled) return;
    onChange(Math.max(min, value - 1));
  };

  const handleIncrement = () => {
    if (disabled) return;
    onChange(Math.min(max, value + 1));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const parsed = parseInt(e.target.value, 10);
    if (isNaN(parsed)) {
      onChange(min);
    } else {
      onChange(Math.max(min, Math.min(max, parsed)));
    }
  };

  return (
    <div className="flex flex-col w-full">
      {label && <span className="text-[11px] font-bold text-slate-500 dark:text-[#949BA4] uppercase tracking-wider mb-1">{label}</span>}
      <div className="inline-flex items-center justify-between sm:justify-start w-full sm:w-auto h-11 border border-slate-900 dark:border-[#3A3D42] rounded-lg bg-white dark:bg-[#18191C] shadow-sm overflow-hidden focus-within:ring-2 focus-within:ring-slate-900 dark:focus-within:ring-[#1ED760] focus-within:border-slate-900 dark:focus-within:border-[#1ED760] transition-colors">
        <button
          type="button"
          onClick={handleDecrement}
          disabled={disabled || value <= min}
          className="w-11 h-11 flex items-center justify-center text-slate-700 dark:text-[#B5BAC1] hover:bg-slate-100 dark:hover:bg-[#2B2D31] active:bg-slate-200 dark:active:bg-[#3A3D42] active:text-slate-900 dark:active:text-[#1ED760] disabled:opacity-25 disabled:hover:bg-transparent transition-colors touch-action-manipulation shrink-0 focus:outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-[#2B2D31]"
          aria-label="Decrease"
        >
          <Minus className="w-4 h-4" />
        </button>

        <input
          type="number"
          min={min}
          max={max}
          value={value === 0 ? '' : value}
          placeholder="0"
          onChange={handleInputChange}
          disabled={disabled}
          className="w-full sm:w-12 h-11 text-center font-black text-slate-900 dark:text-[#F2F3F5] bg-transparent border-x border-slate-900 dark:border-[#3A3D42] focus:outline-none text-base sm:text-sm input-no-zoom"
        />

        <button
          type="button"
          onClick={handleIncrement}
          disabled={disabled || value >= max}
          className="w-11 h-11 flex items-center justify-center text-slate-700 dark:text-[#B5BAC1] hover:bg-slate-100 dark:hover:bg-[#2B2D31] active:bg-slate-200 dark:active:bg-[#3A3D42] active:text-slate-900 dark:active:text-[#1ED760] disabled:opacity-25 disabled:hover:bg-transparent transition-colors touch-action-manipulation shrink-0 focus:outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-[#2B2D31]"
          aria-label="Increase"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}