import { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

// PR17a: Searchable combobox. Trigger button mimics the dashboard's
// native <select> visual exactly so it slots into the filter bar without
// a style mismatch (same bg / border / focus / typography). Clicking
// opens a panel with a search input plus a filterable list — keyboard
// (Arrow / Enter / Escape) and pointer both work; outside-click and
// Escape both close the panel.
//
// Props:
//   options: string[]                 — full option list
//   value: string                     — currently selected
//   onChange: (v: string) => void     — fired on selection
//   placeholder?: string              — shown when no value
//   getLabel?: (v: string) => string  — converts option to display text
//
// Custom over a library: we keep bundle size flat, inherit the dashboard's
// design tokens (#232c37 / #2d3744 / #1ABC9C) for free, and have a
// reusable primitive for future searchable dropdowns (customer / channel /
// etc.). Behavior intentionally matches what users expect from
// react-select's basic single-select mode minus the accessibility polish
// — that can be added in a follow-up if operations needs SR support.
export const SearchableDropdown = ({ options, value, onChange, placeholder, getLabel }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef(null);
  const label = (opt) => (getLabel ? getLabel(opt) : opt);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => label(o).toLowerCase().includes(q));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, search]);

  // Close on outside click. Mousedown (not click) so the panel doesn't
  // briefly close-then-reopen when the user clicks inside.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Whenever the filtered list reshuffles (typing), bring the highlight
  // back to the top so Enter selects something obvious.
  useEffect(() => { setHighlighted(0); }, [search]);

  const select = (opt) => {
    onChange(opt);
    setOpen(false);
    setSearch('');
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted(p => Math.min(p + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(p => Math.max(p - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlighted]) select(filtered[highlighted]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setSearch('');
    }
  };

  // PR17a-fix: tokens use the dashboard's CSS variables so the combobox
  // tracks the active theme. Mapping:
  //   trigger / search bg          → var(--bg-input)         (input fields)
  //   panel bg                     → var(--bg-panel-alt)     (dropdown surface)
  //   border / divider             → var(--border)
  //   text                         → var(--text-primary)
  //   placeholder / empty          → var(--text-muted)
  //   selected option              → var(--accent-blue)      (#1ABC9C in both modes)
  //   highlighted option bg        → var(--border)           (subtle elevation in both modes)
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-[12px] font-mono px-2 py-1 rounded outline-none cursor-pointer min-w-[120px] flex items-center justify-between gap-2 focus:border-[#1ABC9C]"
        style={{
          background: 'var(--bg-input)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
        }}
      >
        <span className="truncate">{value ? label(value) : (placeholder || 'Select…')}</span>
        <ChevronDown size={12} className="opacity-60 flex-shrink-0"/>
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1 min-w-full w-max max-w-[260px] rounded shadow-lg z-50 flex flex-col"
          style={{
            maxHeight: 300,
            background: 'var(--bg-panel-alt)',
            border: '1px solid var(--border)',
          }}
        >
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type to search…"
            autoFocus
            className="text-[12px] font-mono px-2 py-1.5 outline-none placeholder:text-[var(--text-muted)]"
            style={{
              background: 'var(--bg-input)',
              borderBottom: '1px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <div className="text-[11px] font-mono px-2 py-2" style={{ color: 'var(--text-muted)' }}>No matches</div>
            ) : filtered.map((opt, idx) => {
              const isSelected = opt === value;
              const isHighlighted = idx === highlighted;
              return (
                <div
                  key={opt}
                  onClick={() => select(opt)}
                  onMouseEnter={() => setHighlighted(idx)}
                  className="text-[12px] font-mono px-2 py-1 cursor-pointer"
                  style={{
                    background: isHighlighted ? 'var(--border)' : 'transparent',
                    color: isSelected ? 'var(--accent-blue)' : 'var(--text-primary)',
                  }}
                >
                  {label(opt)}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
