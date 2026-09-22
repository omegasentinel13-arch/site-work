'use client';

import React, { useState, useRef, useEffect, useCallback, useId } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ChevronDown, X, Check } from 'lucide-react';
import clsx from 'clsx';

export interface DatePickerProps {
  value: string; // 'YYYY-MM-DD'
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  minDate?: string; // 'YYYY-MM-DD'
  maxDate?: string; // 'YYYY-MM-DD'
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  variant?: 'default' | 'embedded' | 'full';
  align?: 'left' | 'right';
  'aria-label'?: string;
  formatDisplay?: (dateStr: string) => string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const SHORT_MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

// Supported year list: 2018 to 2038
const SUPPORTED_YEARS = Array.from({ length: 21 }, (_, i) => 2018 + i);

function parseISODate(str: string): { year: number; month: number; day: number } | null {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  return { year: y, month: m, day: d };
}

function formatISODate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getTodayISO(): string {
  const d = new Date();
  return formatISODate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function defaultFormatDisplay(dateStr: string): string {
  const parsed = parseISODate(dateStr);
  if (!parsed) return dateStr || 'Select date';
  return `${String(parsed.day).padStart(2, '0')} ${SHORT_MONTH_NAMES[parsed.month - 1]} ${parsed.year}`;
}

export function DatePicker({
  value,
  onChange,
  id,
  name,
  minDate,
  maxDate,
  disabled = false,
  required = false,
  placeholder = 'Select date',
  className,
  triggerClassName,
  variant = 'default',
  align = 'left',
  'aria-label': ariaLabel,
  formatDisplay = defaultFormatDisplay,
}: DatePickerProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'days' | 'months' | 'years'>('days');

  // Derive initial view month & year from value, or fallback to today
  const todayISO = getTodayISO();
  const initialDate = parseISODate(value) || parseISODate(todayISO)!;
  const [viewYear, setViewYear] = useState<number>(initialDate.year);
  const [viewMonth, setViewMonth] = useState<number>(initialDate.month);

  // Sync view when value changes from outside
  useEffect(() => {
    const parsed = parseISODate(value);
    if (parsed) {
      setViewYear(parsed.year);
      setViewMonth(parsed.month);
    }
  }, [value]);

  // Reset viewMode to 'days' when closed
  const closePopover = useCallback(() => {
    setIsOpen(false);
    setViewMode('days');
  }, []);

  // Handle outside click & escape key
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closePopover();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (viewMode !== 'days') {
          setViewMode('days');
        } else {
          closePopover();
          triggerRef.current?.focus();
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, viewMode, closePopover]);

  const notifyChange = useCallback(
    (newDate: string) => {
      if (!onChange) return;
      const eventLike = Object.assign(new String(newDate), {
        target: { value: newDate, name: name || inputId },
        currentTarget: { value: newDate, name: name || inputId },
      });
      try {
        (onChange as (val: any) => void)(eventLike);
      } catch {
        (onChange as (val: string) => void)(newDate);
      }
    },
    [onChange, name, inputId]
  );

  const handleSelectDate = (dateStr: string) => {
    notifyChange(dateStr);
    closePopover();
    triggerRef.current?.focus();
  };

  const handleSelectToday = () => {
    const today = getTodayISO();
    if (minDate && today < minDate) return;
    if (maxDate && today > maxDate) return;
    const parsed = parseISODate(today)!;
    setViewYear(parsed.year);
    setViewMonth(parsed.month);
    setViewMode('days');
    handleSelectDate(today);
  };

  const shiftViewMonth = (delta: number) => {
    let nextM = viewMonth + delta;
    let nextY = viewYear;
    if (nextM > 12) {
      nextM = 1;
      nextY += 1;
    } else if (nextM < 1) {
      nextM = 12;
      nextY -= 1;
    }
    setViewMonth(nextM);
    setViewYear(nextY);
  };

  // Build 42 grid cells (Monday-first)
  const calendarCells = React.useMemo(() => {
    const firstDayOfWeek = new Date(viewYear, viewMonth - 1, 1).getDay();
    const startOffset = (firstDayOfWeek + 6) % 7;

    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth - 1, 0).getDate();

    const cells: {
      dateStr: string;
      dayNum: number;
      isCurrentMonth: boolean;
      isToday: boolean;
      isSelected: boolean;
      isDisabled: boolean;
    }[] = [];

    // Leading days from previous month
    for (let i = startOffset - 1; i >= 0; i--) {
      const dayNum = daysInPrevMonth - i;
      let prevM = viewMonth - 1;
      let prevY = viewYear;
      if (prevM < 1) {
        prevM = 12;
        prevY -= 1;
      }
      const dateStr = formatISODate(prevY, prevM, dayNum);
      cells.push({
        dateStr,
        dayNum,
        isCurrentMonth: false,
        isToday: dateStr === todayISO,
        isSelected: dateStr === value,
        isDisabled: Boolean((minDate && dateStr < minDate) || (maxDate && dateStr > maxDate)),
      });
    }

    // Days in current month
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = formatISODate(viewYear, viewMonth, d);
      cells.push({
        dateStr,
        dayNum: d,
        isCurrentMonth: true,
        isToday: dateStr === todayISO,
        isSelected: dateStr === value,
        isDisabled: Boolean((minDate && dateStr < minDate) || (maxDate && dateStr > maxDate)),
      });
    }

    // Trailing days from next month to complete 35 or 42 grid
    const totalCells = cells.length > 35 ? 42 : 35;
    let nextDayNum = 1;
    while (cells.length < totalCells) {
      let nextM = viewMonth + 1;
      let nextY = viewYear;
      if (nextM > 12) {
        nextM = 1;
        nextY += 1;
      }
      const dateStr = formatISODate(nextY, nextM, nextDayNum);
      cells.push({
        dateStr,
        dayNum: nextDayNum,
        isCurrentMonth: false,
        isToday: dateStr === todayISO,
        isSelected: dateStr === value,
        isDisabled: Boolean((minDate && dateStr < minDate) || (maxDate && dateStr > maxDate)),
      });
      nextDayNum++;
    }

    return cells;
  }, [viewYear, viewMonth, todayISO, value, minDate, maxDate]);

  const displayText = value ? formatDisplay(value) : placeholder;

  return (
    <div ref={containerRef} className={clsx('relative inline-block', variant === 'full' && 'w-full', isOpen && 'z-30', className)}>
      {/* Hidden input for forms / test automation */}
      <input
        type="hidden"
        id={inputId}
        name={name}
        value={value}
        required={required}
        data-custom-calendar="site-work"
      />

      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        id={`${inputId}-trigger`}
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={ariaLabel || (value ? `Selected date: ${displayText}` : 'Choose date')}
        className={clsx(
          'transition-all touch-action-manipulation focus:outline-none',
          variant === 'embedded' && [
            'inline-flex items-center gap-1.5 px-2 py-1 min-h-[44px]',
            'bg-transparent text-[#0F172A] dark:text-[#F2F3F5] text-xs sm:text-sm font-black',
            'hover:bg-slate-200/50 dark:hover:bg-[#2B2D31]/50 rounded-md',
            'focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
          ],
          variant === 'default' && [
            'inline-flex items-center justify-between gap-2.5 min-h-[44px] px-3.5 py-2',
            'bg-white dark:bg-[#202225] hover:bg-slate-50 dark:hover:bg-[#2B2D31]',
            'border border-slate-900 dark:border-[#3A3D42] rounded-lg shadow-sm',
            'text-slate-900 dark:text-[#F2F3F5] text-xs sm:text-sm font-bold',
            'focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
          ],
          variant === 'full' && [
            'w-full flex items-center justify-between min-h-[44px] px-3.5 py-2.5',
            'bg-white dark:bg-[#111214] hover:bg-slate-50 dark:hover:bg-[#1A1C1E]',
            'border border-slate-900 dark:border-[#3A3D42] rounded-lg shadow-sm',
            'text-slate-900 dark:text-[#F2F3F5] text-xs sm:text-sm font-semibold',
            'focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
          ],
          disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
          triggerClassName
        )}
      >
        <span className="inline-flex items-center gap-2 truncate">
          <CalendarIcon className="w-4 h-4 text-slate-500 dark:text-[#949BA4] shrink-0" />
          <span className="truncate">{displayText}</span>
        </span>
      </button>

      {/* Custom SITE WORK Calendar Popover */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="SITE WORK Calendar"
          className={clsx(
            'absolute top-full mt-2 z-[80] p-3 sm:p-4',
            'w-[300px] sm:w-[340px] max-w-[calc(100vw-2rem)]',
            'bg-white dark:bg-[#18191C] text-slate-900 dark:text-[#F2F3F5]',
            'border border-slate-900 dark:border-[#3A3D42] rounded-xl shadow-2xl',
            'animate-in fade-in-50 zoom-in-95 duration-100',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {/* Header: Month Selector [ Month ▼ ] + Year Selector [ Year ▼ ] + Shift Arrows */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#2B2D31] gap-1">
            {/* Interactive Month & Year Controls */}
            <div className="flex items-center gap-1 min-w-0">
              {/* Month Trigger */}
              <button
                type="button"
                id={`${inputId}-month-select-btn`}
                aria-label={`Select Month, current is ${MONTH_NAMES[viewMonth - 1]}`}
                aria-expanded={viewMode === 'months'}
                onClick={() => setViewMode((prev) => (prev === 'months' ? 'days' : 'months'))}
                className={clsx(
                  'inline-flex items-center gap-1 min-h-[38px] px-2.5 py-1 rounded-lg font-black text-xs sm:text-sm transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
                  viewMode === 'months'
                    ? 'bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#07130B]'
                    : 'text-slate-900 dark:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] border border-slate-300 dark:border-[#3A3D42]'
                )}
              >
                <span className="truncate">{MONTH_NAMES[viewMonth - 1]}</span>
                <ChevronDown className="w-3.5 h-3.5 opacity-80 shrink-0" />
              </button>

              {/* Year Trigger */}
              <button
                type="button"
                id={`${inputId}-year-select-btn`}
                aria-label={`Select Year, current is ${viewYear}`}
                aria-expanded={viewMode === 'years'}
                onClick={() => setViewMode((prev) => (prev === 'years' ? 'days' : 'years'))}
                className={clsx(
                  'inline-flex items-center gap-1 min-h-[38px] px-2.5 py-1 rounded-lg font-black text-xs sm:text-sm transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
                  viewMode === 'years'
                    ? 'bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#07130B]'
                    : 'text-slate-900 dark:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] border border-slate-300 dark:border-[#3A3D42]'
                )}
              >
                <span>{viewYear}</span>
                <ChevronDown className="w-3.5 h-3.5 opacity-80 shrink-0" />
              </button>
            </div>

            {/* Secondary Previous / Next Month Arrows */}
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  shiftViewMonth(-1);
                  setViewMode('days');
                }}
                aria-label="Previous Month"
                className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-[#2B2D31] text-slate-700 dark:text-[#F2F3F5] transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
              >
                <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>

              <button
                type="button"
                onClick={() => {
                  shiftViewMonth(1);
                  setViewMode('days');
                }}
                aria-label="Next Month"
                className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-[#2B2D31] text-slate-700 dark:text-[#F2F3F5] transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
              >
                <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
          </div>

          {/* VIEW: 12-Month Selector Grid */}
          {viewMode === 'months' && (
            <div className="py-2 animate-in fade-in-50 duration-100">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] mb-2 px-1">
                Choose Month
              </div>
              <div className="grid grid-cols-3 gap-2">
                {MONTH_NAMES.map((mName, idx) => {
                  const mNum = idx + 1;
                  const isCurrent = mNum === viewMonth;
                  return (
                    <button
                      key={mName}
                      type="button"
                      onClick={() => {
                        setViewMonth(mNum);
                        setViewMode('days');
                      }}
                      className={clsx(
                        'min-h-[44px] px-2 py-2 rounded-lg text-xs sm:text-sm font-bold transition-colors touch-action-manipulation focus:outline-none',
                        'focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
                        isCurrent
                          ? 'bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#07130B] font-black shadow-sm'
                          : 'text-slate-800 dark:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] border border-slate-200 dark:border-[#3A3D42]'
                      )}
                    >
                      {SHORT_MONTH_NAMES[idx]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* VIEW: Year Selector Grid */}
          {viewMode === 'years' && (
            <div className="py-2 animate-in fade-in-50 duration-100">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] mb-2 px-1">
                Choose Year
              </div>
              <div className="grid grid-cols-3 gap-2 max-h-[220px] overflow-y-auto pr-1">
                {SUPPORTED_YEARS.map((y) => {
                  const isCurrent = y === viewYear;
                  return (
                    <button
                      key={y}
                      type="button"
                      onClick={() => {
                        setViewYear(y);
                        setViewMode('days');
                      }}
                      className={clsx(
                        'min-h-[44px] px-2 py-2 rounded-lg text-xs sm:text-sm font-bold transition-colors touch-action-manipulation focus:outline-none',
                        'focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
                        isCurrent
                          ? 'bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#07130B] font-black shadow-sm'
                          : 'text-slate-800 dark:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] border border-slate-200 dark:border-[#3A3D42]'
                      )}
                    >
                      {y}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* VIEW: Day Grid (Default) */}
          {viewMode === 'days' && (
            <>
              {/* Weekday Row */}
              <div className="grid grid-cols-7 gap-1 pt-2 pb-1 text-center">
                {WEEKDAYS.map((wd) => (
                  <div
                    key={wd}
                    className="text-[11px] font-black uppercase text-slate-500 dark:text-[#949BA4] py-1"
                  >
                    {wd}
                  </div>
                ))}
              </div>

              {/* Date Grid */}
              <div className="grid grid-cols-7 gap-1">
                {calendarCells.map((cell) => {
                  return (
                    <button
                      key={cell.dateStr}
                      type="button"
                      disabled={cell.isDisabled}
                      onClick={() => handleSelectDate(cell.dateStr)}
                      aria-label={cell.dateStr}
                      aria-selected={cell.isSelected}
                      aria-current={cell.isToday ? 'date' : undefined}
                      className={clsx(
                        'w-full h-10 sm:h-11 min-w-[38px] min-h-[38px] sm:min-w-[44px] sm:min-h-[44px]',
                        'flex items-center justify-center rounded-lg text-xs sm:text-sm font-bold',
                        'transition-colors touch-action-manipulation focus:outline-none',
                        'focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
                        cell.isDisabled && 'opacity-25 cursor-not-allowed pointer-events-none',
                        cell.isSelected && [
                          'bg-slate-900 text-white font-black hover:bg-slate-800 shadow-sm',
                          'dark:bg-[#1ED760] dark:text-[#07130B] dark:hover:bg-[#1DB954]',
                        ],
                        !cell.isSelected && cell.isToday && [
                          'border-2 border-emerald-600 dark:border-[#1ED760] text-emerald-700 dark:text-[#1ED760]',
                          'font-black bg-emerald-50/60 dark:bg-[#1ED760]/10 hover:bg-emerald-100 dark:hover:bg-[#1ED760]/20',
                        ],
                        !cell.isSelected && !cell.isToday && cell.isCurrentMonth && [
                          'text-slate-800 dark:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#202225]',
                        ],
                        !cell.isSelected && !cell.isToday && !cell.isCurrentMonth && [
                          'text-slate-400 dark:text-[#6D6F78] hover:bg-slate-50 dark:hover:bg-[#202225]/50',
                        ]
                      )}
                    >
                      {cell.dayNum}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* Footer Bar: Today Quick Action & Close */}
          <div className="flex items-center justify-between pt-3 mt-2 border-t border-slate-200 dark:border-[#2B2D31]">
            <button
              type="button"
              onClick={handleSelectToday}
              className="inline-flex items-center justify-center min-h-[44px] px-3 py-1.5 text-xs font-bold text-slate-800 dark:text-[#F2F3F5] bg-slate-100 dark:bg-[#202225] hover:bg-slate-200 dark:hover:bg-[#2B2D31] rounded-lg transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
            >
              Today
            </button>

            <button
              type="button"
              onClick={closePopover}
              className="inline-flex items-center justify-center min-h-[44px] px-3 py-1.5 text-xs font-bold text-slate-500 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5] rounded-lg transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
