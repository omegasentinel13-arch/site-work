'use client';

import React, { useState, useEffect, useRef, useId } from 'react';
import { ChevronDown, Plus, Check, UserCheck, Search, X } from 'lucide-react';

export interface InvestorItem {
  id: string;
  name: string;
  is_archived: number;
}

interface InvestorSelectProps {
  value: string; // Current selected/typed investor name
  onChange: (name: string, id?: string) => void;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  error?: string;
}

export function InvestorSelect({
  value,
  onChange,
  disabled = false,
  required = false,
  id: externalId,
  error,
}: InvestorSelectProps) {
  const generatedId = useId();
  const selectId = externalId || generatedId;

  const [investors, setInvestors] = useState<InvestorItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch active investors from API
  useEffect(() => {
    let isMounted = true;
    async function loadInvestors() {
      setLoading(true);
      try {
        const res = await fetch('/api/investors');
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setInvestors(data.investors || []);
          }
        }
      } catch (err) {
        console.error('Failed to load investors:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadInvestors();
    return () => {
      isMounted = false;
    };
  }, []);

  // Sync searchQuery when external value changes
  useEffect(() => {
    setSearchQuery(value || '');
  }, [value]);

  // Handle click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        // If query was modified without choosing, commit typed name
        if (searchQuery.trim() !== (value || '')) {
          onChange(searchQuery.trim());
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [searchQuery, value, onChange]);

  // Filtered active investors
  const filtered = investors.filter((inv) =>
    inv.name.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  const trimmedQuery = searchQuery.trim();
  const exactMatch = investors.some(
    (inv) => inv.name.toLowerCase() === trimmedQuery.toLowerCase()
  );
  const showCreateOption = trimmedQuery.length > 0 && !exactMatch;

  const handleSelect = (name: string, id?: string) => {
    onChange(name, id);
    setSearchQuery(name);
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setActiveIndex(0);
      } else {
        const totalItems = filtered.length + (showCreateOption ? 1 : 0);
        if (totalItems > 0) {
          setActiveIndex((prev) => (prev + 1) % totalItems);
        }
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (isOpen) {
        const totalItems = filtered.length + (showCreateOption ? 1 : 0);
        if (totalItems > 0) {
          setActiveIndex((prev) => (prev - 1 + totalItems) % totalItems);
        }
      }
    } else if (e.key === 'Enter') {
      if (isOpen) {
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < filtered.length) {
          const chosen = filtered[activeIndex];
          handleSelect(chosen.name, chosen.id);
        } else if (showCreateOption && activeIndex === filtered.length) {
          handleSelect(trimmedQuery);
        } else if (trimmedQuery) {
          handleSelect(trimmedQuery);
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <input
          id={selectId}
          ref={inputRef}
          type="text"
          disabled={disabled}
          required={required}
          value={searchQuery}
          placeholder="Search or enter investor name..."
          onChange={(e) => {
            setSearchQuery(e.target.value);
            onChange(e.target.value);
            if (!isOpen) setIsOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => {
            if (!disabled) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label="Investor Name"
          className={`w-full min-h-[44px] bg-white dark:bg-[#111214] border ${
            error
              ? 'border-rose-500 focus:ring-rose-500'
              : 'border-slate-900 dark:border-[#3A3D42] focus:ring-slate-900 dark:focus:ring-[#1ED760]'
          } text-[#0F172A] dark:text-[#F2F3F5] rounded-lg pl-3 pr-10 text-sm font-semibold focus:outline-none focus:ring-2 input-no-zoom touch-action-manipulation`}
        />

        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center space-x-1">
          {searchQuery && !disabled && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                onChange('');
                inputRef.current?.focus();
              }}
              aria-label="Clear investor input"
              className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-[#F2F3F5] rounded"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setIsOpen(!isOpen);
              inputRef.current?.focus();
            }}
            aria-label="Toggle investor dropdown"
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-[#F2F3F5] rounded focus:outline-none"
          >
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-1 text-xs text-rose-600 dark:text-[#F87171] font-semibold">{error}</p>
      )}

      {isOpen && (
        <div
          role="listbox"
          className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-lg bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42] shadow-xl custom-scrollbar"
        >
          {loading && (
            <div className="p-3 text-xs text-slate-500 dark:text-[#949BA4] font-medium text-center">
              Loading investors...
            </div>
          )}

          {!loading && filtered.length === 0 && !showCreateOption && (
            <div className="p-3 text-xs text-slate-500 dark:text-[#949BA4] text-center">
              No matching investors found.
            </div>
          )}

          {!loading &&
            filtered.map((inv, idx) => {
              const isSelected = (value || '').toLowerCase() === inv.name.toLowerCase();
              const isHighlighted = activeIndex === idx;
              return (
                <div
                  key={inv.id}
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(inv.name, inv.id);
                  }}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`min-h-[40px] px-3 py-2 flex items-center justify-between text-xs sm:text-sm font-semibold cursor-pointer border-b border-slate-100 dark:border-[#2B2D31] last:border-0 ${
                    isHighlighted
                      ? 'bg-slate-100 dark:bg-[#2B2D31] text-slate-900 dark:text-[#F2F3F5]'
                      : 'text-slate-800 dark:text-[#F2F3F5] hover:bg-slate-50 dark:hover:bg-[#202225]'
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    <UserCheck className="w-4 h-4 text-emerald-600 dark:text-[#1ED760] shrink-0" />
                    <span className="truncate">{inv.name}</span>
                  </div>
                  {isSelected && (
                    <Check className="w-4 h-4 text-emerald-600 dark:text-[#1ED760] shrink-0 ml-2" />
                  )}
                </div>
              );
            })}

          {showCreateOption && (
            <div
              role="option"
              aria-selected={false}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(trimmedQuery);
              }}
              onMouseEnter={() => setActiveIndex(filtered.length)}
              className={`min-h-[44px] px-3 py-2.5 flex items-center space-x-2 text-xs sm:text-sm font-bold cursor-pointer transition-colors bg-emerald-50 dark:bg-[#0F291B] text-emerald-800 dark:text-[#1ED760] hover:bg-emerald-100 dark:hover:bg-[#1A3D29] ${
                activeIndex === filtered.length ? 'ring-2 ring-emerald-500' : ''
              }`}
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span className="truncate">
                Add <strong>&ldquo;{trimmedQuery}&rdquo;</strong> as new investor
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
