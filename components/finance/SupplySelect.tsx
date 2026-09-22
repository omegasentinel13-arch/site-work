'use client';

import React, { useState, useEffect, useRef, useId } from 'react';
import { ChevronDown, Plus, Check, Package, X } from 'lucide-react';

export interface SupplyItem {
  id: string;
  site_id: string;
  name: string;
  normalized_name: string;
  usage_count: number;
  last_used_at: string;
}

interface SupplySelectProps {
  siteId: string;
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  error?: string;
}

export function SupplySelect({
  siteId,
  value,
  onChange,
  disabled = false,
  required = false,
  id: externalId,
  error,
}: SupplySelectProps) {
  const generatedId = useId();
  const selectId = externalId || generatedId;

  const [supplies, setSupplies] = useState<SupplyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch active supplies for this site
  useEffect(() => {
    let isMounted = true;
    if (!siteId) return;

    async function loadSupplies() {
      setLoading(true);
      try {
        const res = await fetch(`/api/supplies?siteId=${encodeURIComponent(siteId)}`);
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setSupplies(data.supplies || []);
          }
        }
      } catch (err) {
        console.error('Failed to load supplies:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadSupplies();
    return () => {
      isMounted = false;
    };
  }, [siteId]);

  // Sync searchQuery with external value
  useEffect(() => {
    setSearchQuery(value || '');
  }, [value]);

  // Handle outside click to close dropdown and commit typed value
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        if (searchQuery.trim() !== (value || '')) {
          onChange(searchQuery.trim());
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [searchQuery, value, onChange]);

  // Filter and rank supplies:
  // 1. Prefix matches first
  // 2. Substring matches
  // 3. usage_count DESC, last_used_at DESC, name ASC
  const trimmedQuery = searchQuery.trim();
  const lowerQuery = trimmedQuery.toLowerCase();

  const filtered = React.useMemo(() => {
    if (!lowerQuery) {
      return supplies;
    }

    const matches = supplies.filter((s) =>
      s.name.toLowerCase().includes(lowerQuery)
    );

    return matches.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(lowerQuery);
      const bStarts = b.name.toLowerCase().startsWith(lowerQuery);

      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      if (b.usage_count !== a.usage_count) {
        return b.usage_count - a.usage_count;
      }

      const aDate = new Date(a.last_used_at).getTime();
      const bDate = new Date(b.last_used_at).getTime();
      if (bDate !== aDate) {
        return bDate - aDate;
      }

      return a.name.localeCompare(b.name);
    });
  }, [supplies, lowerQuery]);

  const exactMatch = supplies.some(
    (s) => s.name.toLowerCase() === lowerQuery
  );
  const showCreateOption = trimmedQuery.length > 0 && !exactMatch;

  const handleSelect = (name: string) => {
    onChange(name);
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
          handleSelect(chosen.name);
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
          placeholder="e.g. Cement, Steel 12mm, Red Bricks, Sand..."
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
          aria-label="Supply or Item Name"
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
              aria-label="Clear supply input"
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
            aria-label="Toggle supply dropdown"
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
              Loading supplies memory...
            </div>
          )}

          {!loading && filtered.length === 0 && !showCreateOption && (
            <div className="p-3 text-xs text-slate-500 dark:text-[#949BA4] text-center">
              No previous supplies found. Type any item name to create.
            </div>
          )}

          {!loading &&
            filtered.map((item, idx) => {
              const isSelected = (value || '').toLowerCase() === item.name.toLowerCase();
              const isHighlighted = activeIndex === idx;
              return (
                <div
                  key={item.id}
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(item.name);
                  }}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`min-h-[40px] px-3 py-2 flex items-center justify-between text-xs sm:text-sm font-semibold cursor-pointer border-b border-slate-100 dark:border-[#2B2D31] last:border-0 ${
                    isHighlighted
                      ? 'bg-slate-100 dark:bg-[#2B2D31] text-slate-900 dark:text-[#F2F3F5]'
                      : 'text-slate-800 dark:text-[#F2F3F5] hover:bg-slate-50 dark:hover:bg-[#202225]'
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    <Package className="w-4 h-4 text-emerald-600 dark:text-[#1ED760] shrink-0" />
                    <span className="truncate">{item.name}</span>
                  </div>
                  <div className="flex items-center space-x-2 ml-2 shrink-0">
                    {item.usage_count > 1 && (
                      <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#2B2D31] text-slate-500 dark:text-[#949BA4]">
                        {item.usage_count}x
                      </span>
                    )}
                    {isSelected && (
                      <Check className="w-4 h-4 text-emerald-600 dark:text-[#1ED760] shrink-0" />
                    )}
                  </div>
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
                Add <strong>&ldquo;{trimmedQuery}&rdquo;</strong> as new supply item
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
