import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, ComposedChart, Area, Scatter, Legend } from 'recharts';
import { Upload, AlertTriangle, TrendingDown, TrendingUp, Package, Truck, MapPin, Clock, Database, Filter, Download, Activity, ChevronRight, ChevronLeft, ChevronDown, Brain, Split, DollarSign, Users, Layers, Zap, Mail, Phone, CheckCircle2, XCircle, Lock, Settings, Shield, UserCog, Eye, LogOut, Save, RotateCcw, Anchor, Warehouse, HardHat, Waves, Cpu, Radar, PiggyBank, MessageCircle, Send, X, Menu, Sun, Moon, Search, FileDown, Calendar, FileText, Trash2, Plus, RefreshCw, UserPlus, Star, Box } from 'lucide-react';
// PR18: Excel export via SheetJS. Used by Container Tracking section
// to export the current search-filtered cohort (searchedSplits) so
// operations can sort/filter/pivot in Excel for downstream analysis.
// Namespace import is the standard SheetJS pattern; tree-shaking is
// limited because the library exposes utils + writeFile as a unified
// API surface.
import * as XLSX from 'xlsx';

// Constants + mock data + helpers extracted to src/{constants,data,utils}/
// Components and pages remain in this file.
import { CHANNELS, LIVE_SPLIT_CHANNELS } from './constants/channels.js';
import { UPS_ZONE_LEAD_TIMES, TRUCK_ROUTE_LEAD_TIMES } from './constants/leadTimes.js';
import { ROOT_CAUSE_LABELS, ROOT_CAUSE_ORDER, CAUSE_COLORS, CAUSE_GRADIENTS, CAUSE_LABELS } from './constants/rootCauses.js';
import { STATE_GRID, STATE_NAMES } from './constants/geo.js';
import { PRESET_LABELS } from './constants/presets.js';
import { ROLES, MOCK_USERS, DEFAULT_SLAS, DEFAULT_KPI_TARGETS, ALL_PAGES, ALL_PAGE_COUNT, FEATURE_PERMISSIONS } from './constants/auth.js';
import {
  MOCK_DOCKS, MOCK_RECEIVING_QUEUE, MOCK_ZONES, MOCK_LABOR, MOCK_WAVES,
  MOCK_OPTIMIZER, MOCK_FORECASTS, MOCK_ANOMALIES, MOCK_ECONOMICS_WATERFALL,
  MOCK_EO_AGING, MOCK_AI_RESPONSES, MOCK_EVENTS, MOCK_DOCUMENTS,
  EVENT_TYPE_COLORS, EVENT_TYPES, SF_DEFAULTS, SF_TABLES, MOCK_AUDIT_LOG,
} from './constants/pageMocks.js';
import { SKUS, CUSTOMER_TIERS, generateMockShipments } from './data/mockShipments.js';
import { getChannelColor, getChannelGroup } from './utils/channels.js';
import { addBusinessDays, diffMin, formatShortDate, presetToDateRange, toDateOrNull } from './utils/dates.js';
import { fmtHrs, fmtNum, fmtPct } from './utils/format.js';
import { getDeliveryLeadDays, getExpectedDeliveryDate, getLeadTimeForState, isDeliveredDelayed } from './utils/leadTime.js';
import { computeRiskScore } from './utils/risk.js';
import { countBy, mapScaleStatusToUps, serverRowsToShipments } from './utils/serverRows.js';

// ============================================================
// SUB-COMPONENTS
// ============================================================
const KPI = ({ label, value, unit, delta, deltaType, delta2, delta2Type, icon: Icon }) => (
  <div className="rounded-md p-3 relative h-full flex flex-col justify-between" style={{ background: 'var(--bg-panel-alt)', border: '1px solid var(--border)', minHeight: 100 }}>
    <div className="flex items-start justify-between gap-1">
      <div className="text-[10px] uppercase tracking-[0.1em] font-semibold leading-tight" style={{ color: 'var(--text-muted)' }}>{label}</div>
      {Icon && <Icon size={13} className="flex-shrink-0" style={{ color: 'var(--text-muted)' }} />}
    </div>
    <div className="font-mono text-xl font-semibold mt-1.5 tracking-tight truncate" style={{ color: 'var(--text-primary)' }}>
      {value}
      {unit && <span className="text-xs ml-1" style={{ color: 'var(--text-secondary)' }}>{unit}</span>}
    </div>
    <div>
      {delta && (
        <div className={`font-mono text-[11px] mt-1 flex items-center gap-1 truncate ${deltaType === 'good' ? 'text-[#2ECC71]' : deltaType === 'bad' ? 'text-[#E74C6F]' : ''}`} style={deltaType !== 'good' && deltaType !== 'bad' ? { color: 'var(--text-secondary)' } : {}}>
          {deltaType === 'good' ? <TrendingUp size={10}/> : deltaType === 'bad' ? <TrendingDown size={10}/> : null}
          <span className="truncate">{delta}</span>
        </div>
      )}
      {delta2 && (
        <div className={`font-mono text-[10px] mt-0.5 flex items-center gap-1 truncate ${delta2Type === 'good' ? 'text-[#2ECC71]' : delta2Type === 'bad' ? 'text-[#E74C6F]' : ''}`} style={delta2Type !== 'good' && delta2Type !== 'bad' ? { color: 'var(--text-muted)' } : {}}>
          {delta2Type === 'good' ? <TrendingUp size={9}/> : delta2Type === 'bad' ? <TrendingDown size={9}/> : null}
          <span className="truncate">{delta2}</span>
        </div>
      )}
    </div>
  </div>
);

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
const SearchableDropdown = ({ options, value, onChange, placeholder, getLabel }) => {
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

const SectionCard = ({ title, subtitle, children, className = '', tag }) => (
  <div className={`rounded-md p-4 ${className}`} style={{ background: 'var(--bg-panel-alt)', border: '1px solid var(--border)' }}>
    <div className="flex items-center justify-between mb-3">
      <div>
        <div className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-primary)' }}>{title}</div>
        {subtitle && <div className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>{subtitle}</div>}
      </div>
      {tag && <div className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1ABC9C]/10 text-[#1ABC9C] border border-[#1ABC9C]/30">{tag}</div>}
    </div>
    {children}
  </div>
);

// ============================================================
// OVERVIEW PAGE — Executive dashboard
// ============================================================
// PR Overview-A: KPI + Dollar cards wired to the master split-shipments
// query via useSplitShipments (same hook Split + Geographic already use).
// Mirrors Geo/Split component pattern: hook → pageData (sample filter +
// channel chips) → liveMetrics → cards. Banner / Channel strip / Donut /
// Bar / Bottleneck stay on the mock data path until Phase C wires
// cause + raid-type signals (Smartsheet Phase 2 → frontend).
// Damage / Backorders KPIs intentionally render "—" placeholders.
const OverviewPage = ({
  filtered,            // mock-derived rows — used by AI banner, donut/bar, detail table
  data,                // raw mock rows — used by Channel strip totals
  metrics,             // App-level mock metrics — donut subtitle ("X delayed shipments")
  causeBreakdown,      // mock — donut data
  trendData,           // mock — stacked bar
  bottleneck,          // mock — bottleneck card
  selectedChannels = [],
  setSelectedChannels,
  sampleOrderFilter = 'exclude_samples',
  dateRange = '7d',
  customRange = {},
  selectedMetric,
  setSelectedMetric,
  setActivePage,
  onMetaChange,
}) => {
  const { data: hookData, loading: hookLoading, source, filter } = useSplitShipments(dateRange, customRange);

  // Publish meta upward so the App-level header (LIVE badge + count +
  // server-resolved date window) renders. Same shape Geo/Split publish.
  useEffect(() => {
    if (!onMetaChange) return;
    onMetaChange({ source, count: hookData ? hookData.length : 0, filter: filter ?? null });
  }, [source, hookData, filter, onMetaChange]);
  useEffect(() => () => { if (onMetaChange) onMetaChange(null); }, [onMetaChange]);

  // PR Overview-A hotfix: sample-order filter intentionally omitted to match
  // Geographic page's cohort. Verified: 2 sample-order DOs (VIVACE NJ + VIVACE
  // MI) were fully-delivered + delayed in the May 13-20 test window — exactly
  // the 689 vs 691 gap between Overview and Geographic. Split page keeps its
  // own sample-exclude filter (separate cohort by design). The sampleOrderFilter
  // prop is retained in the component signature to mirror Split / Geo prop
  // shapes; Geographic also receives and ignores it.
  const pageData = useMemo(() => {
    if (!hookData) return [];
    if (!selectedChannels || selectedChannels.length === 0) return hookData;
    return hookData.filter(r => selectedChannels.includes(r.channel));
  }, [hookData, selectedChannels]);

  // PR Overview-B: lift the strict per-DO delivered aggregation out of
  // liveMetrics so the Detail Table can reuse the same _is_fully_delivered +
  // MAX(delivered_date) values without recomputing. Verbatim port of the
  // GeoPage `deliveredAggregated` useMemo (line ~1452-1479) with one
  // difference: Overview computes this unconditionally (Geo only computes it
  // when delayedMode === 'delivered'). The Detail Table needs the aggregated
  // rows for every metric so we always pay the O(n) cost here.
  const aggregatedPageData = useMemo(() => {
    return pageData.map(r => {
      const cs = Array.isArray(r.containers) ? r.containers : null;
      if (!cs || cs.length === 0) {
        const fully = r.delivered_date != null;
        return { ...r, _is_fully_delivered: fully, delivered_date: fully ? r.delivered_date : null };
      }
      let allDelivered = true;
      let maxDelivered = null;
      for (const c of cs) {
        if (!c.delivered_date) { allDelivered = false; break; }
        if (!maxDelivered || c.delivered_date > maxDelivered) maxDelivered = c.delivered_date;
      }
      return {
        ...r,
        _is_fully_delivered: allDelivered,
        delivered_date: allDelivered ? maxDelivered : null,
      };
    });
  }, [pageData]);

  // PR Overview-A hotfix: live aggregates derived from the master query.
  //   - Ship-confirm cohort (trailing_status ≥ 700) still drives Order→Dock
  //     Cycle and On-Time Ship — those are KDC-side handoff metrics.
  //   - Delayed Orders + On-Time Delivery now use Geographic page's delivered-
  //     mode STRICT per-DO aggregation (line ~1030-1072). A DO counts as
  //     "fully delivered" only when every one of its containers has a
  //     delivered_date; the DO's delivered date = MAX(container.delivered).
  //     This collapses Overview / Geographic onto the same definition.
  //   - Split rate now mirrors SplitShipmentPage's splitData (line ~2841-
  //     2845): UPS-only DOs in settled split_status (SPLIT or NOT_SPLIT),
  //     numerator = is_split_shipment. PENDING / MISSING_TRACKING / UNKNOWN
  //     excluded from the denominator per Split's PR10 rationale.
  // Damage / Backorders still deferred to Phase C (cause / raid type wiring).
  const liveMetrics = useMemo(() => {
    const dateOnlyUTC = (d) => {
      if (typeof d === 'string') return d.slice(0, 10);
      if (d instanceof Date && !Number.isNaN(d.getTime())) {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
      return null;
    };
    const isShipConfirmDelayed = (r) => {
      const orderRaw = r.so_created_date || r.orderCreate;
      if (!r.trailing_status_date || !orderRaw) return false;
      const soStr = dateOnlyUTC(orderRaw);
      const stsStr = dateOnlyUTC(r.trailing_status_date);
      if (!soStr || !stsStr) return false;
      const so = new Date(soStr + 'T00:00:00Z');
      const sts = new Date(stsStr + 'T00:00:00Z');
      if (Number.isNaN(so.getTime()) || Number.isNaN(sts.getTime())) return false;
      return (sts.getTime() - so.getTime()) / 86400000 > 1;
    };

    const total = pageData.length;

    // Ship-confirm cohort — handed off to carrier (drives OTS + cycle hours).
    const shipped = pageData.filter(r =>
      r.trailing_status != null && Number(r.trailing_status) >= 700
    );
    const shippedOnTime  = shipped.filter(r => !isShipConfirmDelayed(r));

    // Strict per-DO delivered aggregation lives in `aggregatedPageData` above
    // (PR Overview-B lift). Same MAX(delivered_date) + _is_fully_delivered
    // semantics — pulled out so the Detail Table reuses the same rows without
    // recomputing.
    const aggregated = aggregatedPageData;
    // Cohort filter mirrors GeoPage cohort useMemo (line ~1063-1072): fully
    // delivered AND state×carrier has a defined lead time.
    const delivered        = aggregated.filter(r => r._is_fully_delivered && getDeliveryLeadDays(r.state, r.carrier) !== null);
    const deliveredDelayed = delivered.filter(isDeliveredDelayed);
    const deliveredOnTime  = delivered.filter(r => !isDeliveredDelayed(r));

    // Split rate — mirror SplitShipmentPage splitData (line ~2841-2845).
    // upsOnly excludes TRUCK; settled excludes PENDING / MISSING_TRACKING /
    // UNKNOWN. Denominator is settled (not upsOnly), numerator is is_split.
    const upsOnly      = pageData.filter(r => r.carrier !== 'TRUCK');
    const splitSettled = upsOnly.filter(r => r.split_status === 'SPLIT' || r.split_status === 'NOT_SPLIT');
    const splitRows    = splitSettled.filter(r => r.is_split_shipment);

    // PR Overview-A cycle wire: container-level (manifest_date_time -
    // order_received_at). avg = sum / count across ALL manifested containers
    // across all DOs (not DO-level MIN/MAX averaging). Cohort = DOs with at
    // least one manifested container — implicit because containers without
    // manifest_date_time are skipped.
    //
    // Both timestamps are ET-converted in master query; treating them as
    // local-time Dates and subtracting cancels the local-TZ shift, so the
    // hours math is timezone-stable.
    let cycleHrsSum = 0;
    let cycleHrsN   = 0;
    for (const r of pageData) {
      if (!r.order_received_at) continue;
      const received = new Date(r.order_received_at);
      if (Number.isNaN(received.getTime())) continue;
      const cs = Array.isArray(r.containers) ? r.containers : [];
      for (const c of cs) {
        if (!c.manifest_date_time) continue;
        const manifested = new Date(c.manifest_date_time);
        if (Number.isNaN(manifested.getTime())) continue;
        cycleHrsSum += (manifested.getTime() - received.getTime()) / 3600000;
        cycleHrsN   += 1;
      }
    }
    const cycleHrs = cycleHrsN ? cycleHrsSum / cycleHrsN : 0;

    // Dollar aggregates from orderValue (per-DO sum of invoice_amount built
    // by serverRowsToShipments). orderValue can be null for DOs that haven't
    // billed yet; Number(...) || 0 collapses both null and NaN to 0.
    const sumValue = (rows) => rows.reduce((s, r) => s + (Number(r.orderValue) || 0), 0);

    return {
      total,
      shippedCount:       shipped.length,
      shippedOnTime:      shippedOnTime.length,
      deliveredCount:     delivered.length,
      deliveredOnTime:    deliveredOnTime.length,
      deliveredDelayed:   deliveredDelayed.length,
      splitSettledCount:  splitSettled.length,
      splitCount:         splitRows.length,
      cycleHrs,
      cycleHrsN,
      onTimeShipPct:  shipped.length      ? shippedOnTime.length    / shipped.length      : 0,
      onTimeDelivPct: delivered.length    ? deliveredOnTime.length  / delivered.length    : 0,
      splitPct:       splitSettled.length ? splitRows.length        / splitSettled.length : 0,
      totalDollars:        sumValue(pageData),
      onTimeShipDollars:   sumValue(shippedOnTime),
      onTimeDelivDollars:  sumValue(deliveredOnTime),
      // $ at Risk now follows the same delivered-mode delayed cohort as the
      // Delayed Deliveries KPI, so the count and the dollar figure agree.
      delayedDollars:      sumValue(deliveredDelayed),
      splitDollars:        sumValue(splitRows),
    };
  }, [pageData, aggregatedPageData]);

  if (hookLoading) {
    return (
      <div className="p-8 text-center text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>
        Loading shipment data…
      </div>
    );
  }

  return (
    <>
      {/* AI Watchlist banner — Phase B will review; currently uses mock
          fields (isOpen, cause, isSplit). Live signal arrives once cause /
          raid type wires through. */}
      {(() => {
        const highRiskOpen = filtered.filter(o => o.isOpen && (o.cause || o.isSplit)).length;
        const splitCount = filtered.filter(o => o.isSplit).length;
        const splitRate = filtered.length ? splitCount/filtered.length : 0;
        return (highRiskOpen > 0 || splitRate > 0.05) && (
          <div className="bg-gradient-to-r from-[#1ABC9C]/15 to-transparent border-l-2 border-[#1ABC9C] rounded p-3 mb-4 flex items-center gap-4">
            <Brain size={20} className="text-[#1ABC9C]"/>
            <div className="flex-1">
              <div className="text-[12px] text-[#1ABC9C] font-semibold uppercase tracking-wider">AI Watchlist</div>
              <div className="text-[13px] mt-0.5 text-[#c5ccd4]">
                <span className="font-mono text-[#E74C6F]">{highRiskOpen}</span> open orders at elevated delay risk ·
                <span className="font-mono text-[#E74C6F] ml-2">{splitCount}</span> split shipments ({fmtPct(splitRate)}) violating customer SLA
              </div>
            </div>
            <button onClick={() => setActivePage('ai')} className="px-3 py-1.5 rounded bg-[#1ABC9C] text-[#0a0e12] text-[12px] font-semibold hover:bg-[#3d8de6] flex items-center gap-1.5">
              View AI Feed <ChevronRight size={12}/>
            </button>
          </div>
        );
      })()}

      {/* KPI + Dollar grids — 5 of 7 each wired to liveMetrics; Damage /
          Backorders render "—" placeholders until Phase C wires the
          cause / raid-type signal. */}
      {(() => {
        const m = liveMetrics;
        const kpiCards = [
          { key: 'cycle',        label: 'Order→Dock Cycle',     value: (m.cycleHrs || 0).toFixed(1), unit: 'hrs', delta: `${fmtNum(m.cycleHrsN || 0)} container manifests`,    deltaType: 'neutral',                                  icon: Clock },
          { key: 'ontime-ship',  label: 'On-Time Ship',         value: fmtPct(m.onTimeShipPct),                  delta: `${fmtNum(m.shippedCount)} shipped (≥700)`, deltaType: m.onTimeShipPct  >= 0.95 ? 'good' : 'bad',  icon: Package },
          { key: 'ontime-deliv', label: 'On-Time Delivery',     value: fmtPct(m.onTimeDelivPct),                 delta: `${fmtNum(m.deliveredCount)} delivered`,              deltaType: m.onTimeDelivPct >= 0.95 ? 'good' : 'bad',  icon: Truck },
          { key: 'delayed',      label: 'Delayed Deliveries',   value: fmtNum(m.deliveredDelayed),               delta: `${fmtPct(m.deliveredDelayed/(m.deliveredCount||1))} of ${fmtNum(m.deliveredCount)} delivered`, deltaType: 'bad',              icon: AlertTriangle },
          { key: 'split',        label: 'Split Shipment',       value: fmtPct(m.splitPct),                       delta: `${fmtNum(m.splitCount)} of ${fmtNum(m.splitSettledCount)} settled UPS`, deltaType: 'bad',              icon: Split },
          { key: 'damage',       label: 'Damage / Problem',     value: '—',                                      delta: 'Coming in Phase C',                                  deltaType: 'neutral',                                  icon: AlertTriangle },
          { key: 'backorder',    label: 'In-Stock Backorders',  value: '—',                                      delta: 'Coming in Phase C',                                  deltaType: 'neutral',                                  icon: Package },
        ];

        const dollarCards = [
          { key: 'cycle',        label: 'Total Volume $',         value: `$${fmtNum(Math.round(m.totalDollars))}`,        delta: `${fmtNum(m.total)} DOs`,           deltaType: 'neutral', icon: DollarSign },
          { key: 'ontime-ship',  label: 'On-Time Ship $',         value: `$${fmtNum(Math.round(m.onTimeShipDollars))}`,   delta: `${fmtNum(m.shippedOnTime)} shipments · ${fmtNum(Math.max(0, m.shippedCount - m.shippedOnTime))} delayed`,   deltaType: 'good',    icon: DollarSign },
          { key: 'ontime-deliv', label: 'On-Time Delivery $',     value: `$${fmtNum(Math.round(m.onTimeDelivDollars))}`,  delta: `${fmtNum(m.deliveredOnTime)} delivered`, deltaType: 'good',    icon: DollarSign },
          { key: 'delayed',      label: '$ at Risk (Delayed)',    value: `$${fmtNum(Math.round(m.delayedDollars))}`,      delta: `${fmtNum(m.deliveredDelayed)} delayed`,  deltaType: 'bad',     icon: DollarSign },
          { key: 'split',        label: 'Split Volume',           value: `$${fmtNum(Math.round(m.splitDollars))}`,        delta: `${fmtNum(m.splitCount)} split DOs`,      deltaType: 'bad',     icon: DollarSign },
          { key: 'damage',       label: 'Damage Chargebacks',     value: '—',                                              delta: 'Coming in Phase C',                      deltaType: 'neutral', icon: DollarSign },
          { key: 'backorder',    label: 'Backorder Value',        value: '—',                                              delta: 'Coming in Phase C',                      deltaType: 'neutral', icon: DollarSign },
        ];

        return (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-2">
              {kpiCards.map(kpi => (
                <div key={kpi.key} onClick={() => setSelectedMetric(selectedMetric === kpi.key ? null : kpi.key)}
                  className="cursor-pointer transition-all" style={{ borderRadius: 8, outline: selectedMetric === kpi.key ? '2px solid #1ABC9C' : '2px solid transparent' }}>
                  <KPI label={kpi.label} value={kpi.value} unit={kpi.unit} delta={kpi.delta} deltaType={kpi.deltaType} icon={kpi.icon}/>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
              {dollarCards.map(kpi => (
                <div key={'$'+kpi.key} onClick={() => setSelectedMetric(selectedMetric === kpi.key ? null : kpi.key)}
                  className="cursor-pointer transition-all" style={{ borderRadius: 8, outline: selectedMetric === kpi.key ? '2px solid #1ABC9C' : '2px solid transparent' }}>
                  <KPI label={kpi.label} value={kpi.value} delta={kpi.delta} deltaType={kpi.deltaType} icon={kpi.icon}/>
                </div>
              ))}
            </div>
          </>
        );
      })()}

      {/* PR Overview-B: Detail Table wired to live DO rows. Per-metric filter
          + format + sort against aggregatedPageData (strict-delivered cohort
          available via _is_fully_delivered). Damage / Backorders render a
          "Coming in Phase C" placeholder until cause / raid type wiring lands. */}
      {selectedMetric && (() => {
        // Days-late helper for the Delayed metric. Both the cohort filter
        // (isDeliveredDelayed) and this display helper share the same
        // expected-date math via getExpectedDeliveryDate (line ~225).
        const computeDaysLate = (r) => {
          if (!r.delivered_date) return 0;
          const expected = getExpectedDeliveryDate(r);
          if (!expected) return 0;
          const delivered = new Date(r.delivered_date);
          delivered.setUTCHours(0, 0, 0, 0);
          if (Number.isNaN(delivered.getTime())) return 0;
          return Math.round((delivered.getTime() - expected.getTime()) / 86400000);
        };

        const metricConfig = {
          // CYCLE — DO rows with at least one manifested container. Each row
          // shows Min Cycle / Max Cycle across the DO's containers, where
          // cycle = manifest_date_time - order_received_at. The KPI card
          // averages every manifested container individually (not DO-level
          // MIN/MAX averaging), so the card value and the table reflect
          // different but complementary views.
          'cycle': {
            title: 'Order→Dock Cycle Time',
            filter: (r) => r.order_received_at != null
                       && Array.isArray(r.containers)
                       && r.containers.some(c => c.manifest_date_time != null),
            cols: ['do_num', 'customer', 'channel', 'carrier', '_orderReceived', '_minCycleHrs', '_maxCycleHrs'],
            formatRow: (r) => {
              const received = new Date(r.order_received_at);
              if (Number.isNaN(received.getTime())) {
                return { ...r, _orderReceived: '—', _minCycleHrs: '—', _maxCycleHrs: '—' };
              }
              // ET-clock display: timestamps were converted UTC → ET in the
              // master query, so toLocaleString with timeZone: 'UTC' on the
              // parsed JS Date renders the ET clock time directly.
              const orderReceivedDisplay = received.toLocaleString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
                hour: 'numeric', minute: '2-digit',
                timeZone: 'UTC',
              });
              const cycles = (r.containers || [])
                .filter(c => c.manifest_date_time)
                .map(c => {
                  const m = new Date(c.manifest_date_time);
                  return Number.isNaN(m.getTime()) ? null : (m.getTime() - received.getTime()) / 3600000;
                })
                .filter(v => v !== null);
              if (cycles.length === 0) {
                return { ...r, _orderReceived: orderReceivedDisplay, _minCycleHrs: '—', _maxCycleHrs: '—' };
              }
              return {
                ...r,
                _orderReceived: orderReceivedDisplay,
                _minCycleHrs: Math.min(...cycles).toFixed(1) + 'h',
                _maxCycleHrs: Math.max(...cycles).toFixed(1) + 'h',
              };
            },
            // Worst-case first — Max Cycle descending.
            sort: (a, b) => parseFloat(b._maxCycleHrs) - parseFloat(a._maxCycleHrs),
          },

          // ON-TIME SHIP — ship-confirm cohort + status badge. Inline delay
          // check mirrors `isShipConfirmDelayed` inside liveMetrics (line
          // ~1001-1011): date-only UTC subtraction > 1 day.
          'ontime-ship': {
            title: 'On-Time Ship — All Ship-Confirmed',
            filter: (r) => r.trailing_status != null && Number(r.trailing_status) >= 700,
            cols: ['do_num', 'customer', 'channel', 'carrier', 'state', 'so_created_date', 'trailing_status_date', '_status'],
            formatRow: (r) => {
              const soDate  = (typeof r.so_created_date     === 'string') ? r.so_created_date.slice(0, 10)     : null;
              const stsDate = (typeof r.trailing_status_date === 'string') ? r.trailing_status_date.slice(0, 10) : null;
              let delayed = false;
              if (soDate && stsDate) {
                const so  = new Date(soDate  + 'T00:00:00Z');
                const sts = new Date(stsDate + 'T00:00:00Z');
                delayed = (sts.getTime() - so.getTime()) > 86400000;
              }
              return { ...r, _status: delayed ? 'Late' : 'On Time' };
            },
            sort: (a, b) => (a._status === 'Late' ? -1 : 1) - (b._status === 'Late' ? -1 : 1),
          },

          // ON-TIME DELIVERY — strict delivered cohort + status badge.
          'ontime-deliv': {
            title: 'On-Time Delivery — Fully Delivered DOs',
            filter: (r) => r._is_fully_delivered && getDeliveryLeadDays(r.state, r.carrier) !== null,
            cols: ['do_num', 'customer', 'channel', 'carrier', 'state', 'so_created_date', 'delivered_date', '_status'],
            formatRow: (r) => ({ ...r, _status: isDeliveredDelayed(r) ? 'Late' : 'On Time' }),
            sort: (a, b) => (a._status === 'Late' ? -1 : 1) - (b._status === 'Late' ? -1 : 1),
          },

          // DELAYED — delayed delivered DOs, sorted by days late descending.
          'delayed': {
            title: 'Delayed Deliveries (Strict Cohort)',
            filter: (r) => r._is_fully_delivered && getDeliveryLeadDays(r.state, r.carrier) !== null && isDeliveredDelayed(r),
            cols: ['do_num', 'customer', 'channel', 'carrier', 'state', 'so_created_date', 'delivered_date', '_daysLate', 'orderValue'],
            formatRow: (r) => ({ ...r, _daysLate: computeDaysLate(r) + 'd' }),
            sort: (a, b) => parseInt(b._daysLate, 10) - parseInt(a._daysLate, 10),
          },

          // SPLIT — settled UPS only + is_split_shipment, sorted by container
          // count desc. splitReason is the adapter's alias for raw
          // split_root_cause (serverRowsToShipments line ~2508); container_cnt
          // falls back to containers.length (same pattern as line ~3095).
          'split': {
            title: 'Split Shipments (Settled UPS)',
            filter: (r) => r.carrier !== 'TRUCK'
                       && (r.split_status === 'SPLIT' || r.split_status === 'NOT_SPLIT')
                       && r.is_split_shipment,
            cols: ['do_num', 'customer', 'channel', 'carrier', 'state', '_containerCount', 'splitReason', 'orderValue'],
            formatRow: (r) => ({
              ...r,
              _containerCount: r.container_cnt != null
                ? Number(r.container_cnt)
                : (Array.isArray(r.containers) ? r.containers.length : 1),
            }),
            sort: (a, b) => b._containerCount - a._containerCount,
          },

          // PHASE C placeholders — cause / raid type wiring pending Smartsheet Phase 2.
          'damage': {
            title: 'Damage / Problem Shipments',
            placeholder: 'Damage tracking requires raid type mapping from Smartsheet — coming in Phase C.',
          },
          'backorder': {
            title: 'In-Stock Backorders (Past Due)',
            placeholder: 'Backorder detection requires separate logic — coming in Phase C.',
          },
        };

        const cfg = metricConfig[selectedMetric];
        if (!cfg) return null;

        if (cfg.placeholder) {
          return (
            <SectionCard title={cfg.title} tag="DETAIL VIEW" className="mb-4">
              <div className="text-center py-10 text-[14px]" style={{ color: 'var(--text-muted)' }}>
                {cfg.placeholder}
              </div>
            </SectionCard>
          );
        }

        const rows = aggregatedPageData
          .filter(cfg.filter)
          .map(cfg.formatRow)
          .sort(cfg.sort || (() => 0))
          .slice(0, 50);

        const colLabels = {
          do_num: 'DO #',
          customer: 'Customer',
          channel: 'Channel',
          carrier: 'Carrier',
          state: 'State',
          so_created_date: 'Order Created',
          trailing_status_date: 'Ship Confirm',
          delivered_date: 'Delivered',
          orderValue: 'Value',
          splitReason: 'Split Reason',
          _orderReceived: 'Order Received',
          _minCycleHrs: 'Min Cycle',
          _maxCycleHrs: 'Max Cycle',
          _status: 'Status',
          _daysLate: 'Days Late',
          _containerCount: 'Containers',
        };

        return (
          <SectionCard title={cfg.title} subtitle={`${rows.length} records (top 50) · click a KPI to switch · click again to close`} tag="DETAIL VIEW" className="mb-4">
            <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 420 }}>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider font-mono" style={{ color: 'var(--text-muted)' }}>
                    {cfg.cols.map(c => <th key={c} className="text-left py-2.5 pr-4 sticky top-0" style={{ background: 'var(--bg-panel)', zIndex: 1 }}>{colLabels[c] || c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.do_num + '-' + i} style={{ borderTop: '1px solid var(--border)' }}>
                      {cfg.cols.map(c => {
                        let val = r[c];
                        // ISO 8601 date strings ("2026-05-14" or "2026-05-14 10:30:00.000")
                        // → UTC-stable "May 14" display.
                        if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
                          const d = new Date(val.slice(0, 10) + 'T00:00:00Z');
                          if (!Number.isNaN(d.getTime())) {
                            val = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
                          }
                        }
                        if (c === 'orderValue') val = (val == null) ? '—' : '$' + Math.round(Number(val) || 0).toLocaleString();
                        if (c === 'splitReason') val = val ? (ROOT_CAUSE_LABELS[val] || val) : '—';
                        if (c === '_status') return (
                          <td key={c} className="py-2 pr-4">
                            <span className="text-[11px] px-2 py-0.5 rounded-full font-mono font-semibold"
                              style={{ background: val === 'On Time' ? '#2ECC7120' : val === 'Late' ? '#E74C6F20' : '#f5a62320',
                                       color:      val === 'On Time' ? '#2ECC71'   : val === 'Late' ? '#E74C6F'   : '#f5a623' }}>
                              {val}
                            </span>
                          </td>
                        );
                        if (c === 'channel') {
                          const cc = getChannelColor(val || '');
                          return <td key={c} className="py-2 pr-4"><span className="text-[11px] px-2 py-0.5 rounded font-mono"
                            style={{ background: cc + '20', color: cc }}>{val}</span></td>;
                        }
                        return <td key={c} className="py-2 pr-4 font-mono" style={{ color: 'var(--text-primary)' }}>{val ?? '—'}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && <div className="text-center py-10 text-[14px]" style={{ color: 'var(--text-muted)' }}>No matching records for this metric</div>}
            </div>
          </SectionCard>
        );
      })()}

      {/* Channel performance strip — only BS-IVY / BS-RED / VIVACE are live
          (LIVE_SPLIT_CHANNELS). The other 8 channels still render so the grid
          shape is preserved, but they are disabled, opacity-dimmed, and show
          '—' instead of mock counts (PR Overview-A polish #6). Mock channel
          metrics were misleading once the live cards above shipped. */}
      <SectionCard title="Performance by Distribution Channel" subtitle={selectedChannels.length > 0 ? `Showing ${selectedChannels.length} selected channel(s)` : `${LIVE_SPLIT_CHANNELS.length} live channels · ${CHANNELS.length - LIVE_SPLIT_CHANNELS.length} disabled until live wiring`} tag="CHANNEL MIX" className="mb-4">
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-11 gap-2">
          {CHANNELS.map(ch => {
            const isLive = LIVE_SPLIT_CHANNELS.includes(ch);
            const chRows = data.filter(r => r.channel === ch);
            const total = chRows.length;
            const delayed = chRows.filter(r => r.cause).length;
            const delayRate = total ? delayed/total : 0;
            const isSelected = selectedChannels.length === 0 || selectedChannels.includes(ch);
            const group = getChannelGroup(ch);
            const color = getChannelColor(ch);
            return (
              <div key={ch}
                onClick={isLive ? () => setSelectedChannels(prev =>
                  prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]
                ) : undefined}
                className={`bg-[#1a2129] rounded border p-2 transition-all ${isLive ? 'cursor-pointer' : 'cursor-not-allowed'} ${isLive && isSelected ? '' : 'opacity-40'}`}
                style={{ borderColor: isLive && selectedChannels.includes(ch) ? color : '#2d3744', opacity: isLive ? undefined : 0.35 }}>
                <div className="flex items-center gap-1 mb-1">
                  <div className="w-1.5 h-1.5 rounded-sm" style={{ background: color }}/>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[#8a95a3] truncate">{ch}</div>
                </div>
                {isLive ? (
                  <>
                    <div className="font-mono text-sm font-semibold">{total}</div>
                    <div className={`font-mono text-[11px] ${delayRate > 0.4 ? 'text-[#E74C6F]' : delayRate > 0.25 ? 'text-[#f5a623]' : 'text-[#2ECC71]'}`}>
                      {fmtPct(delayRate)}
                    </div>
                    <div className="mt-1 h-0.5 bg-[#0f1419] rounded overflow-hidden">
                      <div className="h-full" style={{ width: `${Math.min(delayRate*100*2.5, 100)}%`, background: delayRate > 0.4 ? '#E74C6F' : delayRate > 0.25 ? '#f5a623' : '#2ECC71' }}/>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-mono text-sm font-semibold text-[#5d6b7a]">—</div>
                    <div className="font-mono text-[11px] text-[#5d6b7a]">—</div>
                    <div className="mt-1 h-0.5 bg-[#0f1419] rounded"/>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <SectionCard title="Delay Root Cause Mix" subtitle={`${metrics.delayed} delayed shipments`} tag="DONUT">
          <div className="flex items-center gap-4">
            <ResponsiveContainer width={180} height={180}>
              <PieChart>
                <Pie data={causeBreakdown} dataKey="value" innerRadius={40} outerRadius={75} paddingAngle={2}>
                  {causeBreakdown.map((e, i) => <Cell key={i} fill={CAUSE_GRADIENTS[e.raw] || CAUSE_COLORS[e.raw]}/>)}
                </Pie>
                <Tooltip contentStyle={{ background: '#1a2129', border: '1px solid #2d3744', fontSize: 11 }}/>
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-1.5">
              {causeBreakdown.sort((a,b)=>b.value-a.value).map(c => (
                <div key={c.raw} className="flex items-center justify-between text-[12px]">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-sm" style={{ background: CAUSE_COLORS[c.raw] }}/>
                    <span className="text-[#8a95a3]">{c.name}</span>
                  </div>
                  <span className="font-mono text-[#e8ecef]">{c.value}</span>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Bottleneck Alert" subtitle="Worst performing stage" tag="INSIGHT" className="col-span-2">
          {bottleneck && (
            <div className="flex gap-4">
              <div className="flex-1 bg-[#1a2129] rounded border border-[#E74C6F]/30 p-4">
                <div className="text-[11px] uppercase tracking-wider text-[#E74C6F] font-mono mb-1">Bottleneck Detected</div>
                <div className="text-xl font-semibold mb-2">{bottleneck.name}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mt-3">
                  <div>
                    <div className="text-[10px] uppercase text-[#5d6b7a] font-mono">SLA Target</div>
                    <div className="font-mono text-sm mt-0.5">{bottleneck.target}m</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-[#5d6b7a] font-mono">Actual Avg</div>
                    <div className="font-mono text-sm mt-0.5 text-[#E74C6F]">{bottleneck.avg}m</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-[#5d6b7a] font-mono">Breach %</div>
                    <div className="font-mono text-sm mt-0.5 text-[#E74C6F]">{fmtPct(bottleneck.breachPct)}</div>
                  </div>
                </div>
              </div>
              <div className="flex-1 bg-[#1a2129] rounded border border-[#2d3744] p-4">
                <div className="text-[11px] uppercase tracking-wider text-[#1ABC9C] font-mono mb-2">Recommended Action</div>
                <div className="text-[13px] leading-relaxed text-[#c5ccd4]">
                  {bottleneck.name.includes('Wave') && 'Audit wave release logic. Likely causes: SAP-SCALE sync lag or allocation hold. Review TPA confirmation queue.'}
                  {bottleneck.name.includes('Pick') && 'Pick productivity below target. Check picker staffing by shift, empty-location rate, and zone congestion on top-velocity SKUs.'}
                  {bottleneck.name.includes('Carrier') && 'UPS dwell time elevated. Verify daily pickup cutoff, trailer utilization, and whether load planning is fragmenting trailers.'}
                  {bottleneck.name.includes('Dock') && 'Dock consolidation delay. Review trailer staging sequence and load-splitting rules in SCALE.'}
                  {bottleneck.name.includes('Pack') && 'Pack station backlog. Check labor balance vs pick output and SSRS pack list generation time.'}
                  {bottleneck.name.includes('Order') && 'Order confirmation delay in SAP. Check credit holds and master data completeness.'}
                  {bottleneck.name.includes('Confirm') && 'Delivery document creation lag. Review SAP batch job schedule and delivery type config.'}
                  {bottleneck.name.includes('SAP→SCALE') && 'Interface lag between SAP and SCALE. Check middleware queue and outbound delivery IDoc processing.'}
                </div>
                <div className="mt-3 text-[11px] text-[#5d6b7a] font-mono">Est. impact of fixing: −{Math.round(bottleneck.avg-bottleneck.target)}m per shipment</div>
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Delay Trend by Root Cause" subtitle="Daily counts · stacked" tag="STACKED BAR">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={trendData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d3744"/>
            <XAxis dataKey="date" stroke="#5d6b7a" style={{ fontSize: 10, fontFamily: 'IBM Plex Mono' }}/>
            <YAxis stroke="#5d6b7a" style={{ fontSize: 10, fontFamily: 'IBM Plex Mono' }}/>
            <Tooltip contentStyle={{ background: '#1a2129', border: '1px solid #2d3744', fontSize: 11 }}/>
            <Bar dataKey="UPS" stackId="a" fill="url(#gradCerise)"/>
            <Bar dataKey="DC" stackId="a" fill="url(#gradSkyBlue)"/>
            <Bar dataKey="Missing" stackId="a" fill="url(#gradPurple)"/>
            <Bar dataKey="Damage" stackId="a" fill="url(#gradTurquoise)"/>
            <Bar dataKey="Other" stackId="a" fill="url(#gradGray)"/>
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>
    </>
  );
};

// ============================================================
// GEO PAGE — Heat map with issue-type selector
// ============================================================
const GeoPage = ({ filtered, dateRange = '7d', customRange = {}, selectedChannels = [], sampleOrderFilter = 'exclude_samples', onMetaChange }) => {
  const [selectedIssue, setSelectedIssue] = useState('all'); // PR Geo-3: only 'all' is live; other buttons are disabled placeholders for PR Geo-4
  const [hoveredState, setHoveredState] = useState(null);
  const [carrierView, setCarrierView] = useState('UPS'); // 'UPS' or 'Truck'
  // PR Geo-4: Carrier Lead Time Standards is reference info (static UPS / Truck
  // zone tables) — useful but not the page's primary signal. User asked for it
  // to default collapsed so the heat map + state metrics get the screen real
  // estate, with a click to expand when needed.
  const [standardsExpanded, setStandardsExpanded] = useState(false);
  // PR Geo-Delivered-Mode: two perspectives on "delayed":
  //   'ship_confirm' (default) — KDC-side SLA: did KDC ship within 1 day of
  //     order create? Cohort = trailing_status >= 700 (handed off to carrier).
  //   'delivered' — customer-side SLA: did the parcel arrive within the
  //     carrier lead time? Cohort = delivered_date present + state has a
  //     defined lead time. UPS uses calendar days; TRUCK uses sequential
  //     1 CD KDC + N BD truck per user spec.
  // Default is ship_confirm so PR Geo-3 numbers stay regression-safe.
  const [delayedMode, setDelayedMode] = useState('ship_confirm');

  // PR Geo-3-fix: data source switched from the App-level `filtered` prop
  // (which is built from the App's mock-only pageData) to the same hook
  // SplitShipmentPage uses (`useSplitShipments`). The App-level pageData
  // never wires to Snowflake — only the per-page hook does — so PR Geo-3's
  // initial wiring ran the cohort filter against pure mock and surfaced
  // 0 delayed in the browser. Reusing the hook gives Geo the same
  // live/mock-fallback contract as Split: live rows when the server is
  // up, mock generator rows when it isn't.
  //
  // The legacy `filtered` prop stays in the signature for backward
  // compatibility; nothing in this page reads it anymore.
  // PR Geo-4-fix: also destructure source + filter so we can publish meta to
  // the App-level header (LIVE badge + count + date range), mirroring Split.
  const { data: hookData, loading: hookLoading, source, filter } = useSplitShipments(dateRange, customRange);

  // PR Geo-4-fix: publish meta upward so the App header shows LIVE / count /
  // server-resolved date window. User-stated count rule: hookData.length —
  // the always-total population, NOT filtered by channel chips. This is
  // intentionally different from Split (which publishes upsHookDataCount):
  // Geographic's scope is UPS + Truck, and Ops reads the header as the
  // "what dataset am I looking at" indicator, not a live filter readout.
  useEffect(() => {
    if (!onMetaChange) return;
    onMetaChange({ source, count: hookData ? hookData.length : 0, filter: filter ?? null });
  }, [source, hookData, filter, onMetaChange]);
  // Reset meta when GeoPage unmounts so the LIVE badge doesn't linger on
  // other pages (mirrors SplitShipmentPage cleanup at line ~2125).
  useEffect(() => () => { if (onMetaChange) onMetaChange(null); }, [onMetaChange]);

  // Apply the App-level channel-chip selection (mirrors SplitShipmentPage's
  // pageData useMemo). Empty selection = no filtering.
  //
  // PR Sample-Order-Filter-Visibility-Fix: sample-order filter logic
  // intentionally removed here. User-stated intent ("일단") = sample
  // dropdown is Split-only for now; Geographic operates on every order
  // (samples included) because Ops reads "delayed delivery to Texas" as
  // the full delivery cohort regardless of sales doc type. The
  // sampleOrderFilter prop is kept in the signature so a future page-level
  // toggle (or App-level reversal) can opt back in without re-plumbing.
  const pageData = useMemo(() => {
    if (!hookData) return [];
    if (!selectedChannels || selectedChannels.length === 0) return hookData;
    return hookData.filter(r => selectedChannels.includes(r.channel));
  }, [hookData, selectedChannels]);

  // PR Geo-3: cohort = shipments that reached ship-confirm-or-beyond
  // (trailing_status >= 700). This is the population GeoPage operates on
  // — orders KDC has handed off (or is about to hand off) to the carrier.
  // Shipments still in pick/pack/stage are excluded because their
  // trailing_status_date is null (no SLA decision possible). The user's
  // operational intent for this page: "delay 가 KDC 책임인지 아닌지" —
  // so the cohort is intentionally KDC-side-finished work, regardless
  // of UPS delivery state.
  // PR Geo-Delivered-Mode (Strict aggregation): per-DO aggregation for
  // delivered mode only. User-stated design intent:
  //   1. "모든 shipment 가 delivered 됐을 때를 보는게 맞아"
  //      → Strict cohort: a DO counts only when *every* one of its
  //        containers has a delivered_date.
  //   2. "1개의 tracking 이라도 delay → DO delay"
  //      → ANY-late = DO-late, equivalent to taking MAX(delivered_date)
  //        across the DO's containers and comparing to expected.
  //
  // Why the adapter's `r.delivered_date` isn't enough:
  // serverRowsToShipments at line ~1854 groups raw rows by do_num and then
  // copies `delivered_date` from the *first* container of each group
  // (`doRow.delivered_date` at line ~1964). For SPLIT shipments with
  // multiple tracking_nums delivering on different days, that first-row
  // dedup quietly hid the latest delivery — so the SLA decision was made
  // against a delivered date that might be earlier than the true completion.
  // We can't fix this in the adapter without touching Split page's pipeline
  // (user-stated: do this GeoPage-local). Each DO already carries the full
  // `containers` array, so we re-derive the two aggregates locally.
  //
  // Smoke (May 12-19 window, user-verified):
  //   SQL any-row delivered:      732   (over-counts partial-deliveries)
  //   First-row dedup (BUG):     ~674
  //   Strict (all-containers):    608   ← used as the cohort
  //   Delayed (MAX > expected):   514   (84.5% rate)
  //
  // Returns null when not in delivered mode so downstream useMemos can
  // skip the work.
  const deliveredAggregated = useMemo(() => {
    if (delayedMode !== 'delivered') return null;
    return pageData.map(r => {
      const cs = Array.isArray(r.containers) ? r.containers : null;
      if (!cs || cs.length === 0) {
        // Mock-fallback path (no containers[]) or DO not yet shipped — fall
        // back to the row's own delivered_date as a single-shipment proxy.
        const fully = r.delivered_date != null;
        return { ...r, _is_fully_delivered: fully, delivered_date: fully ? r.delivered_date : null };
      }
      let allDelivered = true;
      let maxDelivered = null;
      for (const c of cs) {
        if (!c.delivered_date) { allDelivered = false; break; }
        if (!maxDelivered || c.delivered_date > maxDelivered) {
          maxDelivered = c.delivered_date;
        }
      }
      return {
        ...r,
        _is_fully_delivered: allDelivered,
        // MAX drives isDeliveredDelayed when fully delivered; null forces
        // the cohort filter (and isDeliveredDelayed's own null guard) to
        // drop partial-delivery DOs.
        delivered_date: allDelivered ? maxDelivered : null,
      };
    });
  }, [pageData, delayedMode]);

  // PR Geo-Delivered-Mode: cohort definition depends on the active mode.
  //   ship_confirm — original PR Geo-3 cohort (handed off to carrier)
  //   delivered    — strictly-aggregated DOs (fully delivered) that go to
  //                  a state with a defined lead time
  const cohort = useMemo(() => {
    if (delayedMode === 'delivered') {
      return (deliveredAggregated || []).filter(r =>
        r._is_fully_delivered && getDeliveryLeadDays(r.state, r.carrier) !== null
      );
    }
    return pageData.filter(r =>
      r.trailing_status != null && Number(r.trailing_status) >= 700
    );
  }, [pageData, delayedMode, deliveredAggregated]);

  // PR Geo-3: day-grain delayed classifier — true if KDC took longer than
  // the kdcTarget (1 day) to reach the trailing status. Comparison is
  // date-only because `sh.TRAILING_STS_DATE` lands at ET midnight in the
  // sample data (live row: "2026-05-10 20:00:00.000" = ET midnight UTC) —
  // hour-grain comparison would be over-precision.
  //
  //   isDelayed(r) ⇔ floor(trailing_date) - floor(order_date) > 1
  //
  // PR Geo-3-fix: the order-date field name differs between live and
  // mock paths. Live (adapter PR4b1 + Geo-1) carries `so_created_date`
  // (ISO string). The hook's mock-fallback path returns raw rows from
  // `generateMockShipments()` which carry `orderCreate` (Date object)
  // — the adapter is NOT applied to mock. We accept either field so the
  // classifier works under both branches without rewiring the mock.
  // `new Date()` handles both ISO strings and Date objects.
  // PR Geo-Delivered-Mode: classifier dispatches by mode.
  //   delivered  → module-level isDeliveredDelayed (UTC-safe, lead-time-aware)
  //   ship_confirm → calendar-day SLA: trailing_status_date occurred more than
  //                  1 calendar day after so_created_date (kdcTarget = 1 day)
  //
  // PR Geo-Delivered-Mode (Ship-Confirm calendar fix): user discovered a
  // false-positive ~37% inflation in the ship_confirm count. Cause: the
  // original implementation did `new Date(orderRaw).getFullYear()/getMonth()/
  // getDate()` — but `getFullYear/Month/Date` return the value in the *local*
  // timezone. Live `so_created_date` arrives as 'YYYY-MM-DD' (UTC midnight on
  // parse) and `trailing_status_date` arrives as 'YYYY-MM-DD HH:MM:SS.000'
  // (ET-normalized timestamp). In US east timezones, the local representation
  // of so_created shifted to the previous day → days delta inflated by 1 →
  // many in-SLA rows mis-flagged as delayed.
  //
  // Smoke (May 12-19 window, user-verified):
  //   NY before fix: 110 delayed   →  after fix: 60 (matches user's SQL `datediff < -1`)
  //   Total before:  1,189         →  after:    744  (445 false-positives removed)
  //
  // The fix mirrors the slice-and-rebuild pattern used in isDeliveredDelayed:
  // extract the 'YYYY-MM-DD' prefix from each string and rebuild both dates
  // as UTC midnight. Now the comparison is purely calendar-day, matching the
  // SQL semantics operations think in.
  const isDelayed = useCallback((r) => {
    if (delayedMode === 'delivered') return isDeliveredDelayed(r);
    const orderRaw = r.so_created_date || r.orderCreate;
    if (!r.trailing_status_date || !orderRaw) return false;
    // Extract 'YYYY-MM-DD' from either string (live) or Date object (mock).
    // Live arrives as 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS.000' — slice(0,10)
    // works. Mock arrives as a JS Date — String(Date).slice(0,10) gives the
    // locale string instead, so use UTC components there.
    const dateOnlyUTC = (d) => {
      if (typeof d === 'string') return d.slice(0, 10);
      if (d instanceof Date && !Number.isNaN(d.getTime())) {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
      return null;
    };
    const soStr = dateOnlyUTC(orderRaw);
    const stsStr = dateOnlyUTC(r.trailing_status_date);
    if (!soStr || !stsStr) return false;
    const so = new Date(soStr + 'T00:00:00Z');
    const sts = new Date(stsStr + 'T00:00:00Z');
    if (Number.isNaN(so.getTime()) || Number.isNaN(sts.getTime())) return false;
    return (sts.getTime() - so.getTime()) / 86400000 > 1; // > 1 calendar day
  }, [delayedMode]);

  // PR Geo-3: convenience — delayed slice of the cohort. Network Total
  // and the Top-5 ranking derive from this. Splitting it out keeps the
  // dependency graph cheap to re-run if other useMemos need just the
  // delayed slice later (e.g. PR Geo-4 will likely subdivide by cause).
  const delayedShipments = useMemo(() => cohort.filter(isDelayed), [cohort, isDelayed]);

  // PR Geo-3: network-wide delayed count = issueTotal denominator for
  // every state's shareOfIssue. With the Issue selector locked to 'all'
  // (PR Geo-4 will wire the others), this is simply delayedShipments.length.
  // Kept selectedIssue in the deps so when PR Geo-4 introduces cause-level
  // filtering, this useMemo extends naturally without rewiring downstream.
  const issueTotal = useMemo(() => {
    if (selectedIssue === 'all') return delayedShipments.length;
    // PR Geo-4 will replace this branch with a real cause filter.
    return delayedShipments.length;
  }, [delayedShipments, selectedIssue]);

  // PR Geo-3: per-state metrics — same object shape the existing JSX
  // (heat map, hover detail, Top 5) consumes, but the source is now the
  // ship-confirm cohort and the "issue" bucket is the day-grain delayed
  // flag rather than mock's random `cause`. Channels still aggregate
  // across the whole cohort (state-level activity heatmap). Causes
  // aggregate only across delayed rows so the hover-detail "top cause"
  // still has meaning once PR Geo-4 maps cause to a real classification.
  const stateMetrics = useMemo(() => {
    const m = {};
    Object.keys(STATE_GRID).forEach(st => {
      m[st] = { state: st, total: 0, issueCount: 0, allDelayed: 0, causes: {}, channels: {} };
    });
    cohort.forEach(r => {
      if (!m[r.state]) return;
      m[r.state].total++;
      m[r.state].channels[r.channel] = (m[r.state].channels[r.channel] || 0) + 1;
      if (isDelayed(r)) {
        m[r.state].allDelayed++;
        const causeKey = r.cause || 'Other';
        m[r.state].causes[causeKey] = (m[r.state].causes[causeKey] || 0) + 1;
      }
      const hit = selectedIssue === 'all' ? isDelayed(r) : (isDelayed(r) && r.cause === selectedIssue);
      if (hit) m[r.state].issueCount++;
    });
    Object.values(m).forEach(s => {
      s.issueRateInState = s.total ? s.issueCount / s.total : 0;
      s.shareOfIssue = issueTotal ? s.issueCount / issueTotal : 0;
      const top = Object.entries(s.causes).sort((a,b) => b[1]-a[1])[0];
      s.topCause = top ? top[0] : null;
      const topCh = Object.entries(s.channels).sort((a,b) => b[1]-a[1])[0];
      s.topChannel = topCh ? topCh[0] : null;
      s.topChannelCount = topCh ? topCh[1] : 0;
    });
    return m;
  }, [cohort, isDelayed, selectedIssue, issueTotal]);

  // Max share for color scaling
  const maxShare = useMemo(() => {
    return Math.max(...Object.values(stateMetrics).map(s => s.shareOfIssue), 0.01);
  }, [stateMetrics]);

  // Rank table — sorted by share of selected issue
  const rankedStates = useMemo(() => {
    return Object.values(stateMetrics)
      .filter(s => s.issueCount > 0)
      .sort((a,b) => b.shareOfIssue - a.shareOfIssue);
  }, [stateMetrics]);

  // Color ramp (dark → bright) based on selected issue color
  const baseColor = selectedIssue === 'all' ? '#E74C6F' : CAUSE_COLORS[selectedIssue];
  const getTileColor = (share) => {
    if (share === 0) return '#1a2129';
    const intensity = Math.min(share / maxShare, 1);
    const alpha = 0.15 + intensity * 0.85;
    return `${baseColor}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
  };

  // PR Geo-3: only 'all' is live ('All Delayed' = day-grain SLA breach
  // in the ship-confirm cohort). The other five buttons are kept as
  // disabled placeholders — visual continuity with the old cause-based
  // page, and a reminder that PR Geo-4 will wire issue categorization
  // once operations defines the classification rules.
  const issueOptions = [
    { key: 'all', label: 'All Delayed', color: '#E74C6F', enabled: true },
    { key: 'UPS', label: 'UPS Carrier', color: CAUSE_COLORS.UPS, enabled: false },
    { key: 'DC', label: 'DC Processing', color: CAUSE_COLORS.DC, enabled: false },
    { key: 'Missing', label: 'Missing Product', color: CAUSE_COLORS.Missing, enabled: false },
    { key: 'Damage', label: 'Damage/Problem', color: CAUSE_COLORS.Damage, enabled: false },
    { key: 'Other', label: 'Other', color: CAUSE_COLORS.Other, enabled: false },
  ];

  // Grid size
  const maxRow = 6, maxCol = 12;
  const cellSize = 52;
  const gap = 4;

  // PR Geo-3-fix: same loading affordance as SplitShipmentPage so the
  // page doesn't flash an empty heat map while the hook resolves.
  if (hookLoading) {
    return <div className="p-8 text-center text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>Loading delayed-shipment data…</div>;
  }

  return (
    <>
      {/* Issue selector — PR Geo-3: only 'All Delayed' is wired.
          The other categories are disabled placeholders (operations
          hasn't defined the classification yet — PR Geo-4). */}
      <SectionCard title="Select Issue Type" subtitle="Heat map recolors by % of this issue's volume per state" tag="SELECTOR">
        <div className="flex flex-wrap gap-2">
          {issueOptions.map(opt => {
            const active = selectedIssue === opt.key;
            const disabled = !opt.enabled;
            return (
              <button
                key={opt.key}
                onClick={() => { if (!disabled) setSelectedIssue(opt.key); }}
                disabled={disabled}
                title={disabled ? 'Coming soon — issue categorization (PR Geo-4)' : undefined}
                className={`px-3 py-2 rounded text-[12px] font-mono uppercase tracking-wider border transition-all ${
                  active
                    ? 'border-transparent text-white font-semibold'
                    : 'border-[#2d3744] text-[#8a95a3] hover:border-[#1ABC9C] hover:text-[#e8ecef]'
                } ${disabled ? 'opacity-40 cursor-not-allowed hover:border-[#2d3744] hover:text-[#8a95a3]' : ''}`}
                style={active ? { background: opt.color, boxShadow: `0 0 0 1px ${opt.color}` } : {}}
              >
                <span className="inline-block w-2 h-2 rounded-sm mr-2" style={{ background: opt.color }}/>
                {opt.label}
                {active && (
                  <span className="ml-2 font-semibold">· {issueTotal} total</span>
                )}
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Carrier Lead Time Standards" subtitle="Select carrier type to view expected transit times by state" tag="LEAD TIME" className="mt-3">
        {/* PR Geo-4: inline collapse — default closed. ChevronDown rotates to
            mirror the date picker pattern at line ~7372. SectionCard left
            untouched (its API has no collapse prop and 30+ call sites depend
            on the current signature). */}
        <button
          onClick={() => setStandardsExpanded(v => !v)}
          className="w-full flex items-center gap-2 text-[12px] font-mono uppercase tracking-wider py-1 mb-2 transition-colors"
          style={{ color: 'var(--text-secondary)' }}>
          <ChevronDown size={12} style={{ transform: standardsExpanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}/>
          <span>{standardsExpanded ? 'Hide reference tables' : 'Show reference tables'}</span>
        </button>
        {standardsExpanded && (<>
        <div className="flex gap-2 mb-4">
          {['UPS', 'Truck'].map(ct => (
            <button key={ct} onClick={() => setCarrierView(ct)}
              className={`px-4 py-2 rounded text-[12px] font-mono uppercase tracking-wider border transition-all ${carrierView === ct ? 'border-[#1ABC9C] text-[#1ABC9C] bg-[#1ABC9C]/10 font-semibold' : 'border-[#2d3744] text-[#8a95a3] hover:border-[#1ABC9C]'}`}>
              {ct === 'UPS' ? 'UPS Parcel' : 'Truck / LTL'}
            </button>
          ))}
        </div>

        {/* Lead Time Table */}
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider font-mono" style={{ color: 'var(--text-muted)' }}>
              <th className="text-left py-2 pr-4">{carrierView === 'UPS' ? 'UPS Zone' : 'Truck Route'}</th>
              <th className="text-left py-2 pr-4">States</th>
              <th className="text-center py-2 pr-4">KDC Target</th>
              <th className="text-center py-2 pr-4">{carrierView === 'UPS' ? 'Carrier LT' : 'Truck LT (BD)'}</th>
              <th className="text-center py-2 pr-4">Total LT {carrierView === 'UPS' ? '(days)' : '(CD)'}</th>
            </tr>
          </thead>
          <tbody>
            {(carrierView === 'UPS' ? UPS_ZONE_LEAD_TIMES : TRUCK_ROUTE_LEAD_TIMES).map((row, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--bg-panel-alt)' }}>
                <td className="py-2.5 pr-4 font-semibold" style={{ color: 'var(--text-primary)' }}>{carrierView === 'UPS' ? row.zone : row.route}</td>
                <td className="py-2.5 pr-4 font-mono text-[12px]" style={{ color: 'var(--text-secondary)' }}>{row.states.length ? row.states.join(', ') : '—'}</td>
                <td className="py-2.5 pr-4 text-center">
                  <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold" style={{ background: '#2ECC7120', color: '#2ECC71' }}>D+1</span>
                </td>
                <td className="py-2.5 pr-4 text-center font-mono" style={{ color: 'var(--text-primary)' }}>
                  {carrierView === 'UPS' ? `${row.carrierLT} day${row.carrierLT > 1 ? 's' : ''}` : `${row.truckLTBD} BD`}
                </td>
                <td className="py-2.5 pr-4 text-center">
                  <span className="px-2 py-0.5 rounded text-[12px] font-mono font-bold" style={{ background: '#1ABC9C20', color: '#1ABC9C' }}>
                    {carrierView === 'UPS' ? `${row.totalLT} days` : `${row.truckLTCD} CD`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </>)}
      </SectionCard>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mt-4">
        {/* MAP */}
        <SectionCard title="US Heat Map" subtitle={`Color intensity = % of ${selectedIssue === 'all' ? 'all delays' : CAUSE_LABELS[selectedIssue]} concentrated in each state`} tag="TILE MAP" className="col-span-2">
          {/* PR Geo-Delivered-Mode: delay basis toggle, top-right of the
              Heat Map card per user-stated placement. Sits above the SVG
              so the toggle is the first thing the eye lands on when the
              user looks at the map. SectionCard has no header-action prop
              (would mutate 30+ call sites), so we inline at top of children
              — same pattern as PR Geo-4's Standards collapse. */}
          <div className="flex items-center justify-end gap-2 mb-3 -mt-1 flex-wrap">
            <span className="text-[11px] uppercase tracking-wider font-mono" style={{ color: 'var(--text-muted)' }}>
              Delay basis
            </span>
            {[
              { key: 'ship_confirm', label: 'Ship Confirm', hint: 'KDC SLA: handed off within 1 day' },
              { key: 'delivered',    label: 'Delivered',    hint: 'Customer SLA: delivered within carrier lead time' },
            ].map(opt => {
              const active = delayedMode === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => setDelayedMode(opt.key)}
                  title={opt.hint}
                  className={`px-3 py-1.5 rounded text-[11px] font-mono uppercase tracking-wider border transition-all ${
                    active
                      ? 'border-[#1ABC9C] text-[#1ABC9C] bg-[#1ABC9C]/15 font-semibold'
                      : 'border-[#2d3744] text-[#8a95a3] hover:border-[#1ABC9C] hover:text-[#e8ecef]'
                  }`}>
                  {opt.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col items-center">
            <svg width={(maxCol+1) * (cellSize+gap)} height={(maxRow+1) * (cellSize+gap) + 20} className="select-none">
              {Object.entries(STATE_GRID).map(([state, pos]) => {
                const metrics = stateMetrics[state];
                const x = pos.c * (cellSize + gap);
                const y = pos.r * (cellSize + gap);
                const fill = getTileColor(metrics.shareOfIssue);
                const isHovered = hoveredState === state;
                const hasIssue = metrics.issueCount > 0;

                return (
                  <g key={state}
                     onMouseEnter={() => setHoveredState(state)}
                     onMouseLeave={() => setHoveredState(null)}
                     style={{ cursor: 'pointer' }}>
                    <rect x={x} y={y} width={cellSize} height={cellSize}
                      fill={fill}
                      stroke={isHovered ? '#e8ecef' : hasIssue ? baseColor : '#2d3744'}
                      strokeWidth={isHovered ? 2 : hasIssue ? 1 : 0.5}
                      rx={3}
                    />
                    <text x={x + cellSize/2} y={y + cellSize/2 - 4}
                      textAnchor="middle" dominantBaseline="middle"
                      fontFamily="IBM Plex Mono, monospace" fontSize="11"
                      fontWeight="600"
                      fill={metrics.shareOfIssue > maxShare * 0.5 ? '#0f1419' : '#e8ecef'}>
                      {state}
                    </text>
                    {hasIssue && (
                      <text x={x + cellSize/2} y={y + cellSize/2 + 10}
                        textAnchor="middle" dominantBaseline="middle"
                        fontFamily="IBM Plex Mono, monospace" fontSize="9"
                        fill={metrics.shareOfIssue > maxShare * 0.5 ? '#0f1419' : '#8a95a3'}>
                        {(metrics.shareOfIssue * 100).toFixed(1)}%
                      </text>
                    )}
                    {/* Lead time label */}
                    <text x={x + cellSize/2} y={y + cellSize/2 + 20}
                      textAnchor="middle" dominantBaseline="middle"
                      fontFamily="IBM Plex Mono, monospace" fontSize="8"
                      fill={metrics.shareOfIssue > maxShare * 0.5 ? '#0f1419' : '#5d6b7a'}>
                      {(() => {
                        const lt = getLeadTimeForState(state, 'UPS');
                        return lt.totalLT !== '?' ? `${lt.totalLT}d` : '';
                      })()}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Legend */}
            <div className="flex items-center gap-3 mt-4 font-mono text-[11px]">
              <span className="text-[#5d6b7a] uppercase tracking-wider">Intensity</span>
              <div className="flex items-center gap-0">
                {[0.1, 0.25, 0.5, 0.75, 1.0].map(v => (
                  <div key={v} className="w-10 h-3" style={{ background: `${baseColor}${Math.round((0.15 + v*0.85) * 255).toString(16).padStart(2, '0')}` }}/>
                ))}
              </div>
              <span className="text-[#5d6b7a]">0% → {(maxShare*100).toFixed(1)}%</span>
            </div>
          </div>
        </SectionCard>

        {/* HOVER DETAIL + TOP STATES */}
        <div className="space-y-3">
          {/* Hover detail or default */}
          <div className="bg-[#232c37] border border-[#2d3744] rounded-md p-4 min-h-[140px]">
            {hoveredState && stateMetrics[hoveredState] ? (
              <>
                <div className="text-[11px] uppercase tracking-wider text-[#5d6b7a] font-mono mb-1">State Detail</div>
                <div className="text-lg font-semibold">{STATE_NAMES[hoveredState]} <span className="font-mono text-[#8a95a3]">({hoveredState})</span></div>
                <div className="mt-3 space-y-1.5 text-[12px]">
                  <div className="flex justify-between">
                    <span className="text-[#8a95a3]">Total shipments</span>
                    <span className="font-mono">{stateMetrics[hoveredState].total}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8a95a3]">{selectedIssue === 'all' ? 'Delayed' : CAUSE_LABELS[selectedIssue]}</span>
                    <span className="font-mono" style={{ color: baseColor }}>{stateMetrics[hoveredState].issueCount}</span>
                  </div>
                  <div className="flex justify-between pt-1.5 border-t border-[#2d3744]">
                    <span className="text-[#8a95a3]">Share of {selectedIssue === 'all' ? 'all delays' : 'this issue'}</span>
                    <span className="font-mono font-semibold" style={{ color: baseColor }}>{fmtPct(stateMetrics[hoveredState].shareOfIssue)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8a95a3]">Rate within state</span>
                    <span className="font-mono">{fmtPct(stateMetrics[hoveredState].issueRateInState)}</span>
                  </div>
                  {(() => {
                    const upsLT = getLeadTimeForState(hoveredState, 'UPS');
                    const truckLT = getLeadTimeForState(hoveredState, 'Truck');
                    return (
                      <>
                        <div className="flex justify-between pt-1.5 border-t border-[#2d3744] mt-1.5">
                          <span className="text-[#8a95a3]">UPS Lead Time</span>
                          <span className="font-mono" style={{ color: '#1ABC9C' }}>{upsLT.zone} · {upsLT.totalLT}d</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#8a95a3]">Truck Lead Time</span>
                          <span className="font-mono" style={{ color: '#1ABC9C' }}>{truckLT.zone} · {truckLT.totalLT} CD</span>
                        </div>
                      </>
                    );
                  })()}
                  {stateMetrics[hoveredState].topChannel && (
                    <div className="flex justify-between pt-1.5 border-t border-[#2d3744]">
                      <span className="text-[#8a95a3]">Top channel</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: (getChannelColor(stateMetrics[hoveredState].topChannel))+'20', color: getChannelColor(stateMetrics[hoveredState].topChannel) }}>
                        {stateMetrics[hoveredState].topChannel} ({stateMetrics[hoveredState].topChannelCount})
                      </span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="text-[11px] uppercase tracking-wider text-[#5d6b7a] font-mono mb-1">Network Total</div>
                <div className="text-lg font-semibold">{selectedIssue === 'all' ? 'All Delayed Shipments' : CAUSE_LABELS[selectedIssue]}</div>
                <div className="font-mono text-3xl mt-2" style={{ color: baseColor }}>{issueTotal}</div>
                {/* PR Geo-3: cohort denominator so ops can read the ratio
                    at a glance — "X delayed out of Y ship-confirmed" frames
                    the rate against KDC's completed work, not all shipments.
                    PR Geo-Cohort-Label: label tracks delayedMode so Delivered
                    mode reads as "delivered (fully delivered DOs)" instead of
                    the ship-confirm wording. Matches the cohort definition in
                    deliveredAggregated (strict: every container delivered). */}
                <div className="text-[11px] font-mono text-[#5d6b7a] mt-1">
                  Cohort: <span style={{ color: '#8a95a3' }}>{cohort.length}</span>{' '}
                  {delayedMode === 'delivered'
                    ? 'delivered (fully delivered DOs)'
                    : 'ship-confirmed (trailing ≥ 700)'}
                </div>
                <div className="text-[12px] text-[#8a95a3] mt-1">Hover a state for details</div>
              </>
            )}
          </div>

          {/* Top 5 states */}
          <div className="bg-[#232c37] border border-[#2d3744] rounded-md p-4">
            <div className="text-[11px] uppercase tracking-wider text-[#5d6b7a] font-mono mb-3">Top 5 States</div>
            <div className="space-y-2">
              {rankedStates.slice(0, 5).map((s, i) => (
                <div key={s.state} className="flex items-center gap-2">
                  <div className="font-mono text-[11px] text-[#5d6b7a] w-5">#{i+1}</div>
                  <div className="font-mono text-[12px] font-semibold w-8">{s.state}</div>
                  <div className="flex-1 h-2 bg-[#0f1419] rounded overflow-hidden">
                    <div className="h-full" style={{ width: `${(s.shareOfIssue / maxShare) * 100}%`, background: baseColor }}/>
                  </div>
                  <div className="font-mono text-[12px] w-14 text-right" style={{ color: baseColor }}>{fmtPct(s.shareOfIssue)}</div>
                  <div className="font-mono text-[11px] text-[#5d6b7a] w-10 text-right">{s.issueCount}</div>
                </div>
              ))}
              {rankedStates.length === 0 && (
                <div className="text-[12px] text-[#5d6b7a] text-center py-4">No data for selected issue</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Insight strip */}
      <div className="mt-3">
        <SectionCard title="Insight" subtitle={`Based on ${selectedIssue === 'all' ? 'all delayed shipments' : CAUSE_LABELS[selectedIssue]}`} tag="AUTO-GENERATED">
          {rankedStates.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              <div className="bg-[#1a2129] rounded border-l-2 p-3" style={{ borderColor: baseColor }}>
                <div className="text-[11px] uppercase tracking-wider font-mono mb-1" style={{ color: baseColor }}>Concentration</div>
                <div className="text-[13px] leading-relaxed">
                  <span className="font-semibold">{rankedStates[0].state}</span> ({STATE_NAMES[rankedStates[0].state]}) accounts for <span className="font-mono font-semibold" style={{ color: baseColor }}>{fmtPct(rankedStates[0].shareOfIssue)}</span> of {selectedIssue === 'all' ? 'all network delays' : `all ${CAUSE_LABELS[selectedIssue]} issues`}.
                </div>
              </div>
              <div className="bg-[#1a2129] rounded border-l-2 border-[#f5a623] p-3">
                <div className="text-[11px] uppercase tracking-wider text-[#f5a623] font-mono mb-1">Top 3 Pareto</div>
                <div className="text-[13px] leading-relaxed">
                  Top 3 states ({rankedStates.slice(0,3).map(s => s.state).join(', ')}) drive <span className="font-mono font-semibold text-[#f5a623]">{fmtPct(rankedStates.slice(0,3).reduce((a,b) => a + b.shareOfIssue, 0))}</span> of this issue's volume.
                </div>
              </div>
              <div className="bg-[#1a2129] rounded border-l-2 border-[#2ECC71] p-3">
                <div className="text-[11px] uppercase tracking-wider text-[#2ECC71] font-mono mb-1">Recommended Action</div>
                <div className="text-[13px] leading-relaxed">
                  {selectedIssue === 'UPS' && `Engage UPS account team on ${rankedStates[0].state} lane. Review tender timing and pickup cutoffs.`}
                  {selectedIssue === 'DC' && `DC-cause delays hitting ${rankedStates[0].state} disproportionately. Review wave plan for these ship-tos.`}
                  {selectedIssue === 'Missing' && `Trigger cycle count on SKUs frequently shipping to ${rankedStates[0].state}. Check SAP-SCALE variance.`}
                  {selectedIssue === 'Damage' && `Audit packaging spec for ${rankedStates[0].state} lane. Likely crush or moisture issue.`}
                  {selectedIssue === 'Other' && `Review address validation and customer master data for ${rankedStates[0].state}.`}
                  {selectedIssue === 'all' && `Lane-level review on ${rankedStates[0].state}. Top cause in state: ${CAUSE_LABELS[stateMetrics[rankedStates[0].state].topCause] || '—'}.`}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-[12px] text-[#5d6b7a] text-center py-6">No data for selected issue type</div>
          )}
        </SectionCard>
      </div>
    </>
  );
};

// ============================================================
// AI RISK PAGE
// ============================================================
const AIRiskPage = ({ filtered: _mockFiltered, data: _mockData }) => {
  // PR AI-Phase1B: live data via useSplitShipments. App-level mockFiltered /
  // mockData props (from generateMockShipments) are intentionally ignored —
  // the AI batch analysis is only meaningful on live operational data. 7-day
  // window matches other live pages (Overview / Geo / Split). The master
  // query is already scoped to BS-IVY / BS-RED / VIVACE (server.js base CTE),
  // so no additional channel filter is needed here.
  const { data: liveData, loading: liveLoading, error: liveError } = useSplitShipments('7d');

  const [filterRisk, setFilterRisk] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState(null);

  // PR AI-Phase1: Gemini batch risk analysis. aiAnalysesMap keyed by do_num.
  // Map mutation creates a new Map for React re-render. aiBatchMeta tracks
  // the most recent successful run for UI status display.
  const [aiAnalysesMap, setAiAnalysesMap] = useState(new Map());
  const [aiBatchLoading, setAiBatchLoading] = useState(false);
  const [aiBatchError, setAiBatchError] = useState(null);
  const [aiBatchMeta, setAiBatchMeta] = useState(null);

  // PR AI-Phase1B: cohort = trailing_status < 900 (any non-Closed order),
  // sorted by so_created_date ASC (oldest first — most stuck wins), top 10
  // as the Phase 1B sample size. computeRiskScore depends on mock-only
  // fields (cause, isOpen, primarySku, tier) so it will return low/null
  // scores on live data — that's the intentional rule-vs-AI contrast signal
  // during the test phase. The fallback risk object keeps rendering safe
  // when computeRiskScore returns null.
  const scoredOrders = useMemo(() => {
    if (!liveData || liveData.length === 0) return [];
    return liveData
      .filter(o => o.trailing_status != null && Number(o.trailing_status) < 900)
      .sort((a, b) => {
        const aDate = new Date(a.so_created_date || 0).getTime();
        const bDate = new Date(b.so_created_date || 0).getTime();
        return aDate - bDate; // oldest first
      })
      .slice(0, 10)
      .map(o => ({
        ...o,
        risk: computeRiskScore(o, liveData) || {
          score: 0,
          riskLevel: 'Low',
          confidence: 0,
          reasons: [],
          predictedLate: false,
          predictedHoursLate: 0,
        },
      }));
  }, [liveData]);

  const summary = useMemo(() => ({
    high: scoredOrders.filter(o => o.risk.riskLevel === 'High').length,
    med: scoredOrders.filter(o => o.risk.riskLevel === 'Medium').length,
    low: scoredOrders.filter(o => o.risk.riskLevel === 'Low').length,
    keyAccountHigh: scoredOrders.filter(o => o.risk.riskLevel === 'High' && o.tier === 'Key').length,
    total: scoredOrders.length,
  }), [scoredOrders]);

  const displayed = filterRisk === 'all' ? scoredOrders : scoredOrders.filter(o => o.risk.riskLevel === filterRisk);

  const riskColor = (level) => level === 'High' ? '#E74C6F' : level === 'Medium' ? '#f5a623' : '#2ECC71';

  // PR AI-Phase1: build the normalized payload for /api/ai/risk-analyze-batch.
  // Strips dollar fields (invoice_amount / orderValue / chargeback) so the
  // model assesses on operational fundamentals only — server.js also strips
  // defensively. Computes container-level cycle hours range from
  // order_received_at + manifest_date_time (same math as Overview Cycle
  // Detail Table, line ~1244-1283).
  const handleBatchAnalyze = async () => {
    setAiBatchLoading(true);
    setAiBatchError(null);

    const computeCycleHours = (o) => {
      if (!o.order_received_at) return { min: null, max: null };
      const received = new Date(o.order_received_at);
      if (Number.isNaN(received.getTime())) return { min: null, max: null };
      const hrs = (Array.isArray(o.containers) ? o.containers : [])
        .filter(c => c.manifest_date_time)
        .map(c => {
          const m = new Date(c.manifest_date_time);
          return Number.isNaN(m.getTime()) ? null : (m.getTime() - received.getTime()) / 3600000;
        })
        .filter(v => v !== null);
      if (hrs.length === 0) return { min: null, max: null };
      return { min: Math.round(Math.min(...hrs) * 10) / 10, max: Math.round(Math.max(...hrs) * 10) / 10 };
    };

    const top10 = scoredOrders.slice(0, 10);
    const normalizedOrders = top10.map(o => {
      const cyc = computeCycleHours(o);
      return {
        do_num: o.do_num || o.id,
        customer: o.customer,
        channel: o.channel,
        state: o.state,
        city: o.city,
        zipcode: o.zipcode,
        zone: o.zone,
        carrier: o.carrier,
        tier: o.tier,
        trailing_status: o.trailing_status,
        trailing_status_date: o.trailing_status_date,
        so_created_date: o.so_created_date,
        order_received_at: o.order_received_at,
        containers_total: Array.isArray(o.containers) ? o.containers.length : null,
        containers_manifested: Array.isArray(o.containers)
          ? o.containers.filter(c => c.manifest_date_time).length
          : null,
        cycle_hours_min: cyc.min,
        cycle_hours_max: cyc.max,
        rule_based_score: o.risk?.score,
        rule_based_level: o.risk?.riskLevel,
        rule_based_reasons: o.risk?.reasons,
      };
    });

    // PR AI-Phase1C: enriched context for deeper pattern analysis. AI uses
    // these stats to identify trends, compare orders, and flag systemic
    // issues vs isolated incidents. All distributions are 7-day window
    // (matches useLiveOpsData fetch window) over open orders only
    // (trailing_status < 900). OTD% is computed off the delivered subset
    // using the same isDeliveredDelayed lead-time logic as Overview.
    const allOpen = (liveData || []).filter(
      o => o.trailing_status != null && Number(o.trailing_status) < 900
    );

    const byState = {};
    const byChannel = {};
    const byCarrier = { UPS: 0, TRUCK: 0 };
    const byStatus = {};
    let oldestSoDate = null;
    let totalCycleHrs = 0;
    let cycleHrsN = 0;

    for (const o of allOpen) {
      if (o.state) byState[o.state] = (byState[o.state] || 0) + 1;
      if (o.channel) byChannel[o.channel] = (byChannel[o.channel] || 0) + 1;
      if (o.carrier === 'UPS' || o.carrier === 'TRUCK') {
        byCarrier[o.carrier]++;
      }
      if (o.trailing_status != null) {
        const key = String(o.trailing_status);
        byStatus[key] = (byStatus[key] || 0) + 1;
      }

      if (o.so_created_date) {
        const d = new Date(o.so_created_date);
        if (!Number.isNaN(d.getTime())) {
          if (!oldestSoDate || d < oldestSoDate) oldestSoDate = d;
        }
      }

      if (o.order_received_at && Array.isArray(o.containers)) {
        const received = new Date(o.order_received_at);
        if (!Number.isNaN(received.getTime())) {
          for (const c of o.containers) {
            if (c.manifest_date_time) {
              const m = new Date(c.manifest_date_time);
              if (!Number.isNaN(m.getTime())) {
                totalCycleHrs += (m.getTime() - received.getTime()) / 3600000;
                cycleHrsN++;
              }
            }
          }
        }
      }
    }

    const delivered = (liveData || []).filter(o => o.delivered_date);
    const deliveredOnTime = delivered.filter(o => !isDeliveredDelayed(o));
    const otdPct = delivered.length
      ? Math.round((deliveredOnTime.length / delivered.length) * 100)
      : null;

    const context = {
      window: 'last 7 days',
      current_time_et: new Date().toLocaleString('en-US', {
        timeZone: 'America/New_York',
      }),

      // Cohort scope
      total_orders_in_window: liveData ? liveData.length : 0,
      total_open_orders: allOpen.length,
      cohort_being_analyzed: 'Top 10 oldest open orders (trailing_status < 900)',

      // KDC baseline performance
      recent_otd_pct: otdPct,
      avg_cycle_hours_manifested:
        cycleHrsN > 0 ? Math.round((totalCycleHrs / cycleHrsN) * 10) / 10 : null,

      // Distribution patterns
      open_orders_by_state: byState,
      open_orders_by_channel: byChannel,
      open_orders_by_carrier: byCarrier,
      open_orders_by_trailing_status: byStatus,

      // Time signal
      oldest_open_order_so_date: oldestSoDate
        ? oldestSoDate.toISOString().slice(0, 10)
        : null,

      // SLA reference
      kdc_target_ship_confirm: 'D+1 from order received',
      scale_trailing_status_legend: {
        '<500': 'Order received, planning',
        '500-699': 'Picking / packing in progress',
        '700': 'Ship Confirm Pending (manifested, awaiting confirm)',
        '800': 'Load Confirm Pending (in transit to carrier)',
        '900': 'Closed (delivered or finalized)',
      },
    };

    try {
      const r = await fetch('http://localhost:3001/api/ai/risk-analyze-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: normalizedOrders, context }),
      });
      const j = await r.json();
      if (!j.success) {
        setAiBatchError(j.error || 'Unknown error');
        return;
      }
      const newMap = new Map(aiAnalysesMap);
      for (const a of j.analyses) {
        newMap.set(a.do_num, a);
      }
      setAiAnalysesMap(newMap);
      setAiBatchMeta({
        count: j.analyses.length,
        latency_ms: j.latency_ms,
        timestamp: new Date(),
      });
    } catch (err) {
      setAiBatchError(err.message || 'Network error');
    } finally {
      setAiBatchLoading(false);
    }
  };

  // PR AI-Phase1B: loading / error guards before main render. liveData is
  // null while the hook is fetching; downstream useMemo/render assume the
  // array shape so an early-return here keeps the JSX simple.
  if (liveLoading) {
    return (
      <div className="text-[14px] py-10 text-center font-mono" style={{ color: 'var(--text-muted)' }}>
        Loading live shipment data for AI analysis…
      </div>
    );
  }
  if (liveError) {
    return (
      <div className="text-[14px] py-10 text-center font-mono text-[#E74C6F]">
        Failed to load live data: {String(liveError)}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        <KPI label="Orders Scored" value={summary.total} delta="Open orders only" deltaType="neutral" icon={Brain}/>
        <KPI label="High Risk" value={summary.high} delta={`${fmtPct(summary.high/(summary.total||1))} of open`} deltaType="bad" icon={AlertTriangle}/>
        <KPI label="Medium Risk" value={summary.med} delta="Monitor closely" deltaType="neutral" icon={Clock}/>
        <KPI label="Key Account High" value={summary.keyAccountHigh} delta="Immediate escalation" deltaType="bad" icon={Users}/>
        <KPI label="Model Confidence" value="87" unit="%" delta="Avg across predictions" deltaType="good" icon={CheckCircle2}/>
      </div>

      {/* PR AI-Phase1: page-level Gemini batch analysis trigger. Rule-based
          scoring (above + below) remains the primary signal; AI provides
          deeper context + recommended actions in a complementary view. */}
      <SectionCard
        title="AI-Powered Analysis"
        subtitle="Gemini 2.5 Flash · top 10 oldest open orders (Phase 1B sample)"
        tag="AI"
        className="mb-4"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="text-[12px] flex-1" style={{ color: 'var(--text-muted)' }}>
            {!aiBatchMeta && !aiBatchLoading && !aiBatchError && (
              <span>
                Run AI analysis on the top 10 high-risk orders for deeper context and recommended actions.
                Rule-based scoring remains the primary signal.
              </span>
            )}
            {aiBatchLoading && (
              <span className="text-[#1ABC9C]">Analyzing 10 orders with Gemini… (~60–90s)</span>
            )}
            {aiBatchError && (
              <span className="text-[#f5a623]">
                AI unavailable: {aiBatchError}. Rule-based reasons still available in detail modal.
              </span>
            )}
            {aiBatchMeta && !aiBatchLoading && (
              <span>
                Analyzed <span className="font-mono">{aiBatchMeta.count}</span> orders in <span className="font-mono">{(aiBatchMeta.latency_ms / 1000).toFixed(1)}s</span>
                {' · '}
                <span className="font-mono">{aiBatchMeta.timestamp.toLocaleTimeString()}</span>
                <span className="ml-2 text-[10px] text-[#5d6b7a]">Click any row below to see AI analysis in detail.</span>
              </span>
            )}
          </div>
          <button
            onClick={handleBatchAnalyze}
            disabled={aiBatchLoading || scoredOrders.length === 0}
            className="px-3 py-1.5 rounded bg-[#1ABC9C] text-[#0a0e12] text-[12px] font-semibold hover:bg-[#3d8de6] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
          >
            <Brain size={12}/>
            {aiBatchMeta ? 'Re-analyze' : 'Analyze Top 10 with AI'}
          </button>
        </div>
      </SectionCard>

      <SectionCard title="At-Risk Orders Feed" subtitle="Top 10 oldest open orders (trailing_status<900) · click row for AI analysis" tag="LIVE PREDICTIONS">
        <div className="flex gap-2 mb-3">
          {['all', 'High', 'Medium', 'Low'].map(r => (
            <button key={r} onClick={() => setFilterRisk(r)}
              className={`px-3 py-1 rounded text-[11px] font-mono uppercase tracking-wider border transition-all ${filterRisk === r ? 'border-[#1ABC9C] bg-[#1ABC9C]/20 text-[#1ABC9C]' : 'border-[#2d3744] text-[#8a95a3]'}`}>
              {r === 'all' ? 'All' : r}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[#5d6b7a] border-b border-[#2d3744] font-mono uppercase text-[11px] tracking-wider">
                <th className="py-2">Risk</th>
                <th className="py-2">Score</th>
                <th className="py-2 text-center" title="AI analyzed">AI</th>
                <th className="py-2">Shipment</th>
                <th className="py-2">Customer</th>
                <th className="py-2">Channel</th>
                <th className="py-2">Destination</th>
                <th className="py-2">Predicted Impact</th>
                <th className="py-2 text-right">Value</th>
                <th className="py-2 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {displayed.slice(0, 20).map(o => (
                <tr key={o.id} className="border-b border-[#2d3744] hover:bg-[#1a2129] cursor-pointer" onClick={() => setSelectedOrder(o)}>
                  <td className="py-2">
                    <span className="inline-block px-2 py-0.5 rounded text-[11px] font-mono uppercase" style={{ background: riskColor(o.risk.riskLevel)+'20', color: riskColor(o.risk.riskLevel) }}>
                      {o.risk.riskLevel}
                    </span>
                  </td>
                  <td className="py-2 font-mono" style={{ color: riskColor(o.risk.riskLevel) }}>{o.risk.score}</td>
                  <td className="py-2 text-center">
                    {aiAnalysesMap.has(o.do_num || o.id) && (
                      <span className="text-[12px] text-[#1ABC9C]" title="AI analyzed">✓</span>
                    )}
                  </td>
                  <td className="py-2 font-mono">{o.id}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-1.5">
                      {o.tier === 'Key' && <span className="text-[10px] px-1 py-0.5 rounded bg-[#1ABC9C]/20 text-[#1ABC9C] font-mono">KEY</span>}
                      {o.customer}
                    </div>
                  </td>
                  <td className="py-2">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: (getChannelColor(o.channel))+'20', color: getChannelColor(o.channel) }}>{o.channel}</span>
                  </td>
                  <td className="py-2 font-mono text-[#8a95a3]">{o.state} · Z{o.zone}</td>
                  <td className="py-2">
                    {o.risk.predictedLate ? (
                      <span className="text-[#E74C6F]">~{o.risk.predictedHoursLate}h late ({o.risk.confidence}% conf)</span>
                    ) : (
                      <span className="text-[#2ECC71]">On-track</span>
                    )}
                  </td>
                  <td className="py-2 font-mono text-right">{o.orderValue != null ? '$' + fmtNum(Math.round(Number(o.orderValue))) : '—'}</td>
                  <td className="py-2 text-center">
                    {o.risk.riskLevel === 'High' && (
                      <button onClick={(e) => { e.stopPropagation(); setSelectedOrder(o); }}
                        className="text-[11px] px-2 py-0.5 rounded bg-[#E74C6F]/20 text-[#E74C6F] border border-[#E74C6F]/30 font-mono hover:bg-[#E74C6F]/30">
                        NOTIFY CS
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {displayed.length === 0 && (
                <tr><td colSpan="10" className="py-6 text-center text-[#5d6b7a]">No orders match this risk level</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Detail modal with CS handoff */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-8" onClick={() => setSelectedOrder(null)}>
          <div className="bg-[#1a2129] border border-[#2d3744] rounded-lg max-w-3xl w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[#5d6b7a] font-mono flex items-center gap-2">
                  <Brain size={12}/> AI Risk Analysis
                </div>
                <div className="text-xl font-semibold font-mono mt-1">{selectedOrder.do_num || selectedOrder.id}</div>
                <div className="text-[12px] text-[#8a95a3] mt-0.5">{selectedOrder.customer} · {selectedOrder.state} · {selectedOrder.orderValue != null ? '$' + fmtNum(Math.round(Number(selectedOrder.orderValue))) : '—'}</div>
              </div>
              <button onClick={() => setSelectedOrder(null)} className="text-[#8a95a3] hover:text-[#e8ecef]">✕</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-4">
              <div className="bg-[#232c37] rounded p-3 border-l-2" style={{ borderColor: riskColor(selectedOrder.risk.riskLevel) }}>
                <div className="text-[10px] uppercase tracking-wider font-mono text-[#5d6b7a]">Risk Level</div>
                <div className="text-xl font-semibold mt-1" style={{ color: riskColor(selectedOrder.risk.riskLevel) }}>{selectedOrder.risk.riskLevel}</div>
                <div className="font-mono text-[12px] text-[#8a95a3] mt-0.5">Score: {selectedOrder.risk.score}/100</div>
              </div>
              <div className="bg-[#232c37] rounded p-3">
                <div className="text-[10px] uppercase tracking-wider font-mono text-[#5d6b7a]">Predicted Delay</div>
                <div className="text-xl font-semibold mt-1 text-[#E74C6F]">{selectedOrder.risk.predictedHoursLate}h late</div>
                <div className="font-mono text-[12px] text-[#8a95a3] mt-0.5">Confidence: {selectedOrder.risk.confidence}%</div>
              </div>
              <div className="bg-[#232c37] rounded p-3">
                <div className="text-[10px] uppercase tracking-wider font-mono text-[#5d6b7a]">Expected Delivery</div>
                {(() => {
                  const exp = getExpectedDeliveryDate(selectedOrder);
                  if (!exp) {
                    return <div className="text-sm font-semibold mt-1 text-[#8a95a3]">—</div>;
                  }
                  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
                  const hoursLate = selectedOrder.risk?.predictedHoursLate || 0;
                  return (
                    <>
                      <div className="text-sm font-semibold mt-1">{fmt(exp)}</div>
                      {hoursLate > 0 && (
                        <div className="font-mono text-[12px] text-[#E74C6F] mt-0.5">
                          New ETA: {fmt(new Date(exp.getTime() + hoursLate * 3600000))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>

            {/* PR AI-Phase1: AI analysis section. Renders only when the
                order is in aiAnalysesMap (populated by handleBatchAnalyze).
                Placed above the rule-based "Why this order is at risk"
                section so reviewers can compare AI vs rule-based side by
                side during the test phase. */}
            <div className="bg-[#232c37] rounded p-4 border border-[#1ABC9C]/30 mb-4">
              <div className="text-[11px] uppercase tracking-wider text-[#1ABC9C] font-mono mb-3 flex items-center gap-2">
                <Brain size={11}/> AI Analysis (Gemini 2.5 Flash)
              </div>
              {(() => {
                const aiResult = aiAnalysesMap.get(selectedOrder.do_num || selectedOrder.id);
                if (!aiResult) {
                  return (
                    <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                      This order has not been analyzed yet. Click <span className="text-[#1ABC9C]">Analyze Top 10 with AI</span> at the top of this page to include it.
                    </div>
                  );
                }
                // PR AI-Phase1C: surfaces deeper structured output.
                // Order: header metrics → Probable Root Cause (top,
                // red) → Pattern (yellow, conditional) → Key Factors
                // → Containment Action (WHO/WHAT/WHEN/WHERE, teal) →
                // Investigation Follow-up (blue, conditional) →
                // Stakeholders chips. Optional fields use falsy
                // check to handle either null or empty-string sentinel
                // from the schema.
                return (
                  <div className="space-y-3">
                    <div className="flex items-center gap-4 text-[12px] flex-wrap">
                      <div>
                        <span className="text-[#5d6b7a] font-mono uppercase text-[10px]">AI Risk: </span>
                        <span className="font-semibold" style={{ color: riskColor(aiResult.risk_level) }}>
                          {aiResult.risk_level} ({aiResult.risk_score}/100)
                        </span>
                      </div>
                      <div>
                        <span className="text-[#5d6b7a] font-mono uppercase text-[10px]">Confidence: </span>
                        <span className="font-mono">{aiResult.confidence_pct}%</span>
                      </div>
                      {aiResult.predicted_delay_hours > 0 && (
                        <div>
                          <span className="text-[#5d6b7a] font-mono uppercase text-[10px]">Predicted: </span>
                          <span className="font-mono text-[#E74C6F]">{aiResult.predicted_delay_hours}h late</span>
                        </div>
                      )}
                    </div>

                    {aiResult.probable_root_cause && (
                      <div className="rounded p-3 border-l-2 border-[#E74C6F]"
                           style={{ background: 'var(--bg-panel-alt)' }}>
                        <div className="text-[10px] uppercase tracking-wider text-[#E74C6F] font-mono mb-1">
                          Probable Root Cause
                        </div>
                        <div className="text-[13px]" style={{ color: 'var(--text-primary)' }}>
                          {aiResult.probable_root_cause}
                        </div>
                      </div>
                    )}

                    {aiResult.pattern_observation && (
                      <div className="rounded p-3 border-l-2 border-[#f5a623]"
                           style={{ background: 'var(--bg-panel-alt)' }}>
                        <div className="text-[10px] uppercase tracking-wider text-[#f5a623] font-mono mb-1">
                          Pattern Detected
                        </div>
                        <div className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
                          {aiResult.pattern_observation}
                        </div>
                      </div>
                    )}

                    {Array.isArray(aiResult.key_factors) && aiResult.key_factors.length > 0 && (
                      <div>
                        <div className="text-[11px] uppercase tracking-wider font-mono mb-1.5"
                             style={{ color: 'var(--text-muted)' }}>Key Factors</div>
                        <div className="space-y-1">
                          {aiResult.key_factors.map((f, i) => (
                            <div key={i} className="flex items-start gap-2 text-[13px]">
                              <div className="w-1 h-1 rounded-full mt-1.5 bg-[#1ABC9C]"/>
                              <div>{f}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {aiResult.containment_action && aiResult.containment_action.what && (
                      <div className="rounded p-3 border-l-2 border-[#1ABC9C]"
                           style={{ background: 'var(--bg-panel-alt)' }}>
                        <div className="text-[10px] uppercase tracking-wider text-[#1ABC9C] font-mono mb-2">
                          Containment Action (Immediate)
                        </div>
                        <div className="space-y-1 text-[12px]" style={{ color: 'var(--text-primary)' }}>
                          <div><span style={{ color: 'var(--text-muted)' }}>WHO:</span> <span className="font-semibold">{aiResult.containment_action.who}</span></div>
                          <div><span style={{ color: 'var(--text-muted)' }}>WHAT:</span> {aiResult.containment_action.what}</div>
                          <div><span style={{ color: 'var(--text-muted)' }}>WHEN:</span> <span className="text-[#f5a623]">{aiResult.containment_action.when}</span></div>
                          {aiResult.containment_action.where && (
                            <div><span style={{ color: 'var(--text-muted)' }}>WHERE:</span> {aiResult.containment_action.where}</div>
                          )}
                        </div>
                      </div>
                    )}

                    {aiResult.investigation_action && (
                      <div className="rounded p-3 border-l-2 border-[#3d8de6]"
                           style={{ background: 'var(--bg-panel-alt)' }}>
                        <div className="text-[10px] uppercase tracking-wider text-[#3d8de6] font-mono mb-1">
                          Investigation Follow-up
                        </div>
                        <div className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
                          {aiResult.investigation_action}
                        </div>
                      </div>
                    )}

                    {Array.isArray(aiResult.stakeholders_to_notify) &&
                     aiResult.stakeholders_to_notify.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wider font-mono"
                              style={{ color: 'var(--text-muted)' }}>
                          Notify:
                        </span>
                        {aiResult.stakeholders_to_notify.map((s, i) => (
                          <span key={i} className="text-[11px] px-2 py-0.5 rounded border"
                                style={{
                                  background: 'var(--bg-panel-alt)',
                                  color: 'var(--text-primary)',
                                  borderColor: 'var(--border)',
                                }}>
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="mb-4">
              <div className="text-[11px] uppercase tracking-wider text-[#5d6b7a] font-mono mb-2">Why this order is at risk</div>
              <div className="space-y-1.5">
                {selectedOrder.risk.reasons.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-[13px]">
                    <div className="w-1 h-1 rounded-full mt-1.5 bg-[#1ABC9C]"/>
                    <div>{r}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#232c37] rounded p-4 border border-[#1ABC9C]/30">
              <div className="text-[11px] uppercase tracking-wider text-[#1ABC9C] font-mono mb-2 flex items-center gap-2">
                <Mail size={11}/> Pre-Drafted Customer Notification
              </div>
              <div className="bg-[#0f1419] rounded p-3 font-mono text-[12px] leading-relaxed text-[#c5ccd4]">
                {(() => {
                  // PR AI-Phase1B: mock-field patches for live data safety.
                  // orderId → do_num (master query DO #).
                  // cartons → container_cnt || containers.length.
                  // promiseDeliver → getExpectedDeliveryDate(selectedOrder).
                  // orderValue can be null on unbilled DOs — render '—'.
                  const doNum = selectedOrder.do_num || selectedOrder.id;
                  const containerCount = selectedOrder.container_cnt != null
                    ? selectedOrder.container_cnt
                    : (Array.isArray(selectedOrder.containers) ? selectedOrder.containers.length : '?');
                  const value = selectedOrder.orderValue != null
                    ? '$' + fmtNum(Math.round(Number(selectedOrder.orderValue))) : '—';
                  const exp = getExpectedDeliveryDate(selectedOrder);
                  const hoursLate = selectedOrder.risk?.predictedHoursLate || 0;
                  const fmtDate = (d) => d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'TBD';
                  const expDisplay = fmtDate(exp);
                  const revisedDisplay = exp && hoursLate > 0 ? fmtDate(new Date(exp.getTime() + hoursLate * 3600000)) : 'TBD';
                  const customerSlug = (selectedOrder.customer || 'customer').toLowerCase().replace(/ /g, '');
                  return (
                    <>
                      <div className="text-[#5d6b7a]">To: buyer@{customerSlug}.com</div>
                      <div className="text-[#5d6b7a]">Subject: Update on Order {doNum}</div>
                      <div className="border-t border-[#2d3744] my-2"/>
                      Hi {selectedOrder.customer} team,<br/><br/>
                      We wanted to proactively notify you that Order <span className="text-[#e8ecef]">{doNum}</span> ({value}, {containerCount} containers) is currently tracking approximately <span className="text-[#E74C6F]">{hoursLate} hours behind</span> the expected delivery of {expDisplay}.<br/><br/>
                      Revised ETA: <span className="text-[#f5a623]">{revisedDisplay}</span><br/><br/>
                      We're working actively to minimize the delay. If you need to adjust receiving plans or have questions, please reply directly.<br/><br/>
                      — KDC Customer Service
                    </>
                  );
                })()}
              </div>
              <div className="flex gap-2 mt-3">
                <button className="px-3 py-1.5 rounded bg-[#1ABC9C] text-[#0a0e12] text-[12px] font-semibold hover:bg-[#3d8de6] flex items-center gap-1.5">
                  <Mail size={12}/> Send Email
                </button>
                <button className="px-3 py-1.5 rounded bg-[#232c37] border border-[#2d3744] text-[12px] hover:border-[#1ABC9C] flex items-center gap-1.5">
                  <Phone size={12}/> Call Customer
                </button>
                <button className="px-3 py-1.5 rounded bg-[#232c37] border border-[#2d3744] text-[12px] hover:border-[#1ABC9C] flex items-center gap-1.5">
                  Edit Template
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ============================================================
// useSplitShipments — data-fetching hook for SplitShipmentPage
// ============================================================

/**
 * useSplitShipments — fetch split-shipment data with mock fallback.
 *
 * PR4b1 upgrade:
 *  - Accepts dateRange + customRange args (was: no args)
 *  - Calls /api/scale/split-shipments?from=&to= (was: no params)
 *  - Adapts server response via serverRowsToShipments (was: assumed shape match)
 *  - Re-fetches when dateRange or customRange changes
 *
 * Output shape matches generateMockShipments() — array of orders with
 * containers[]. Per core-beliefs.md §6, this is the contract: caller
 * components don't need to know if data is mock or live.
 *
 * NOT YET WIRED to SplitShipmentPage — PR4b2 wires it.
 *
 * @param {string} dateRange - '7d' / '30d' / '90d' / 'custom'
 * @param {{from?: string, to?: string}} customRange - YYYY-MM-DD pair
 * @returns {{
 *   data: Array | null,
 *   error: Error | null,
 *   loading: boolean,
 *   source: 'mock' | 'live' | 'mock-fallback' | null,
 *   filter: {from: string, to: string} | null
 * }}
 */
function useSplitShipments(dateRange = '7d', customRange = {}) {
  const [state, setState] = useState({
    data: null,
    error: null,
    loading: true,
    source: null,
    filter: null,
  });

  // Stable JSON of customRange so useEffect dep array reacts only to value changes
  const customKey = JSON.stringify(customRange);

  useEffect(() => {
    const sourceMode = import.meta.env.VITE_DATA_SOURCE || 'mock';

    if (sourceMode === 'mock' || sourceMode === 'csv') {
      if (sourceMode === 'csv') {
        console.warn('[useSplitShipments] csv mode not implemented; falling back to mock');
      }
      setState({
        data: generateMockShipments(),
        error: null,
        loading: false,
        source: 'mock',
        filter: null,
      });
      return;
    }

    // sourceMode === 'live' — fetch with date params
    const { from, to } = presetToDateRange(dateRange, JSON.parse(customKey));
    const url = `http://localhost:3001/api/scale/split-shipments?from=${from}&to=${to}`;

    setState((s) => ({ ...s, loading: true }));

    let cancelled = false;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        if (!json.success) throw new Error(json.error || 'Server reported failure');

        const shipments = serverRowsToShipments(json.data);
        // eslint-disable-next-line no-console
        console.log('[useSplitShipments] Live data loaded:', {
          rows: json.count,
          uniqueDOs: shipments.length,
          filter: json.filter,
          channelDistribution: countBy(shipments, 'channel'),
          splitStatusDistribution: countBy(shipments, 'split_status'),
        });

        setState({
          data: shipments,
          error: null,
          loading: false,
          source: 'live',
          filter: json.filter,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        // Per core-beliefs §6: mock fallback, never blank the page
        console.warn('[useSplitShipments] Live fetch failed, falling back to mock:', err);
        setState({
          data: generateMockShipments(),
          error: err,
          loading: false,
          source: 'mock-fallback',
          filter: null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [dateRange, customKey]);

  return state;
}

// ============================================================
// SPLIT SHIPMENT PAGE
// ============================================================
const SplitShipmentPage = ({ filtered, dateRange = '7d', customRange = {}, selectedChannels = [], filterCause = 'all', filterRegion = 'all', sampleOrderFilter = 'exclude_samples', onMetaChange }) => {
  const [expandedOrder, setExpandedOrder] = useState(null);
  // PR14: page-level expand-all toggle for Container Tracking. The clickable
  // subtitle on that SectionCard flips this; rendering combines it with the
  // per-row `expandedOrder` so individual-row inspection still works when
  // allExpanded is off. When allExpanded is on, every visible row is
  // expanded — per-row clicks become no-ops until the user collapses all.
  const [allExpanded, setAllExpanded] = useState(false);
  // PR15: pagination for Container Tracking. Pre-PR15 the table was hard-
  // capped at `.slice(0, 30)`, hiding 200+ rows in typical windows and
  // making any future filter / search / export incomplete by default.
  // pageSize is user-selectable; default 30 preserves the prior view size.
  // currentPage is 0-indexed (rendered as 1-indexed in the footer).
  const [pageSize, setPageSize] = useState(30);
  const [currentPage, setCurrentPage] = useState(0);
  // PR17b: free-text search over the SPLIT cohort rendered in the Container
  // Tracking table. Scoped to the view (table + pagination), not the
  // dashboard cohort — KPI cards / Channel / Customer / Root Causes are
  // driven by PR16's filteredPageData and should reflect the broader filter
  // selection, not a row-level lookup.
  const [containerSearch, setContainerSearch] = useState('');

  // PR4b2: Live data via hook; mock-fallback preserves the page when API is unreachable.
  // Trust hierarchy: server (master query) → adapter (PR4b1) → this page.
  const { data: hookData, error: hookError, loading: hookLoading, source, filter } = useSplitShipments(dateRange, customRange);

  // PR6: parallel YTD fetch — the Customer ranking section needs a stable,
  // sample-large window (Jan 1 → today) independent of the page's main
  // dateRange. All other sections continue using the main hook. The two
  // calls fire in parallel on mount; YTD response (~30 MB / 4-5s on live)
  // arrives after the main response so the section shows a loading state
  // while other sections render immediately.
  const { data: ytdHookData, loading: ytdLoading } = useSplitShipments('ytd');

  const isLive = source === 'live';

  // Choose data source: live/mock from hook; channel-chip filter applied on top.
  // The legacy `filtered` prop carries header-bar filtering for the mock path on other pages —
  // for the Split page we own filtering ourselves so the hook output (live OR mock) flows through.
  //
  // Live mode: containers[] carries raw server rows (snake_case, status as numeric string).
  // Normalize to the mock shape so the existing table JSX renders without per-cell null guards
  // and without modifying the PR4b1 adapter.
  const pageData = useMemo(() => {
    const base = hookData || [];
    const channelFiltered = selectedChannels.length === 0
      ? base
      : base.filter(o => selectedChannels.includes(o.channel));
    // PR Sample-Order-Filter: App-level sample order filter applied at the
    // pageData boundary — upstream of every metric/UI useMemo (splitData,
    // containerMetrics, ytdCustomerList, regionOptions, upsHookDataCount).
    // Exact-match on 'Sample Order' per user's operational decision; sample
    // variants ('Sample Order EndCust', 'Samplel Returns', 'Branch Sample
    // Order') are handled separately in a future PR.
    const sampleFiltered = sampleOrderFilter === 'exclude_samples'
      ? channelFiltered.filter(o => o.sales_doc_type !== 'Sample Order')
      : sampleOrderFilter === 'samples_only'
      ? channelFiltered.filter(o => o.sales_doc_type === 'Sample Order')
      : channelFiltered;
    if (!isLive) return sampleFiltered;
    return sampleFiltered.map(o => ({
      ...o,
      containers: (o.containers || []).map(c => ({
        ...c,
        containerId:    c.container_id,
        trackingNumber: c.tracking_num || '—',
        status:         mapScaleStatusToUps(c.container_status),
        shipDate:       toDateOrNull(c.container_status_time),
        expectedDelivery: null,                              // §7c #18 - not yet sourced
        actualDelivery:   toDateOrNull(c.delivered_date),
        isLate: false,                                       // derive in PR6
        deliveredDifferentDay: false,                        // derive in PR6
        weight: null,
        items: null,
        lastLocation: c.delivered_state || null,
      })),
    }));
  }, [hookData, selectedChannels, isLive, sampleOrderFilter]);

  // PR16: dashboard-level filter dropdowns ("All causes" + "All regions") in
  // the global filter bar at the top of the page. Pre-PR16 they were mock-UI
  // placeholders that referenced the old CAUSE_LABELS / regions constants —
  // they didn't affect this page. PR16 wires them to filteredPageData so
  // every downstream metric (splitData, containerMetrics, sections) reflects
  // the active filter without each consumer needing to know about the filter.
  //
  // Region filter: applied to **every** DO regardless of split_status.
  //   Operations reads "All NY orders" as "every DO that ships to NY" — split
  //   or not, pending or settled.
  //
  // Root-cause filter: applied **only** to SPLIT DOs. Root cause is a
  //   sub-categorization of the SPLIT outcome; PENDING / NOT_SPLIT /
  //   MISSING_TRACKING are different operational dimensions and shouldn't be
  //   accidentally filtered out when someone narrows by, say, MANIFEST_LEVEL.
  //   We pass non-SPLIT rows through untouched.
  //
  // The filter values come from the App-level global filter bar via props.
  // Unknown values (e.g. user picked an Exec-page cause like 'UPS' and then
  // navigated to Split) collapse to a no-op via the ROOT_CAUSE_LABELS guard.
  const filteredPageData = useMemo(() => {
    const regionActive = filterRegion && filterRegion !== 'all';
    const causeActive  = filterCause && filterCause !== 'all' && ROOT_CAUSE_LABELS[filterCause];
    if (!regionActive && !causeActive) return pageData;
    return pageData.filter(o => {
      if (regionActive && o.state !== filterRegion) return false;
      if (causeActive && o.split_status === 'SPLIT' && o.splitReason !== filterCause) return false;
      return true;
    });
  }, [pageData, filterRegion, filterCause]);

  // PR16: dynamic region options from the unfiltered cohort, sorted. Excludes
  // the '—' fallback that PR13's ytdCustomerList aggregation introduced for
  // missing-state rows. Bubbled up to the App via onMetaChange so the
  // global region dropdown shows only states present in the current window.
  //
  // PR Truck-1-Region-Fix: regionOptions is UPS-only. Every Split-page KPI
  // already filters Truck out (PR Truck-1's splitData / containerMetrics /
  // ytdCustomerList + PR Truck-1-Header-Fix's upsHookDataCount). If the
  // region dropdown included Truck-only states, picking one would zero out
  // every KPI on the page — confusing UX. Same `!== 'TRUCK'` pattern keeps
  // mock-mode rows (carrier='UPS Ground' / 'FedEx Ground') intact.
  const regionOptions = useMemo(() => {
    const states = new Set();
    for (const o of pageData) {
      if (o.carrier === 'TRUCK') continue;
      if (o.state && o.state !== '—') states.add(o.state);
    }
    return ['all', ...Array.from(states).sort()];
  }, [pageData]);

  // PR4b3 + PR16: Lift hook meta (source + count + filter + PR16 regions) up
  // so the App-level header summary dropdown, LIVE/MOCK badge, channel-chips
  // hint, and PR16 region filter dropdown can all react. Single object keeps
  // the interface small and lets the parent treat it as one snapshot.
  //
  // PR Truck-1-Header-Fix: header count is UPS only on the Split page.
  // User-stated invariant — Split page renders Split metrics, where Truck
  // has no split concept (Truck = LTL, single trailer / single pro_num).
  // hookData carries UPS + Truck combined; filter Truck out so the header
  // matches the in-page KPIs (which already use `upsOnly` via PR Truck-1).
  // `!== 'TRUCK'` (not `=== 'UPS'`) preserves mock-mode rows whose carrier
  // reads 'UPS Ground' / 'FedEx Ground' etc. The Geographic page renders
  // its own header (line 7316-7318) and is intentionally untouched —
  // operations there spans both carriers (cohort = 1,852 = UPS + Truck).
  const upsHookDataCount = useMemo(() => {
    if (!hookData) return 0;
    // PR Sample-Order-Filter: respect the App-level sample filter so the
    // header "X DOs" reflects what's actually shown on the page.
    let scope = hookData.filter(o => o.carrier !== 'TRUCK');
    if (sampleOrderFilter === 'exclude_samples') {
      scope = scope.filter(o => o.sales_doc_type !== 'Sample Order');
    } else if (sampleOrderFilter === 'samples_only') {
      scope = scope.filter(o => o.sales_doc_type === 'Sample Order');
    }
    return scope.length;
  }, [hookData, sampleOrderFilter]);
  useEffect(() => {
    if (!onMetaChange) return;
    onMetaChange({ source, count: upsHookDataCount, filter: filter ?? null, regions: regionOptions });
  }, [source, upsHookDataCount, filter, regionOptions, onMetaChange]);
  // Clear the lifted state on unmount so the badge + summary disappear when leaving the page.
  useEffect(() => () => { if (onMetaChange) onMetaChange(null); }, [onMetaChange]);

  const splitData = useMemo(() => {
    // PR10 Split Rate definition (post-PR9 4-category SQL): settled basis is
    // explicit — only DOs whose split outcome is operationally **decided**.
    // That is `SPLIT` (multi-day or partial delivery) and `NOT_SPLIT` (all
    // containers delivered same day, or single tracking already delivered).
    //
    // Excludes:
    //  - PENDING (UPS hasn't scanned anything yet — unknown outcome)
    //  - MISSING_TRACKING (data-integrity gap — surfaced via its own
    //    banner; classifying it here would inflate the denominator)
    //
    // The pre-PR10 filter (`!== 'PENDING' && !== 'UNKNOWN'`) accidentally
    // folded MISSING_TRACKING into settled after PR9 dropped UNKNOWN and
    // added MISSING_TRACKING, deflating split rate by ~40%. The explicit
    // allow-list is safer if more categories ever land.
    //
    // PR Truck-1: Truck DOs excluded from all Split metrics. User-stated
    // invariant — "split shipment 에는 TRUCK 이 포함이 되면 안된다". Truck
    // is LTL (single trailer / single pro_num) with no split concept. The
    // SQL classified CTE already auto-assigns NOT_SPLIT to TRUCK rows, but
    // we also exclude them here so settled/pending/missing denominators
    // reflect UPS-only operations. `!== 'TRUCK'` (not `=== 'UPS'`) preserves
    // mock-mode rows whose carrier reads 'UPS Ground' / 'FedEx Ground' etc.
    const upsOnly = filteredPageData.filter(o => o.carrier !== 'TRUCK');

    const settled = upsOnly.filter(o => o.split_status === 'SPLIT' || o.split_status === 'NOT_SPLIT');
    const split = settled.filter(o => o.isSplit);
    const splitRate = settled.length ? split.length / settled.length : 0;

    // PR4b2: In Transit (PENDING) — surfaced as its own KPI to keep the settled rate clean.
    const pending = upsOnly.filter(o => o.split_status === 'PENDING');
    const pendingRate = upsOnly.length ? pending.length / upsOnly.length : 0;

    // PR10: MISSING_TRACKING — DOs with at least one container missing a
    // UPS `tracking_num`. These are data-integrity / handoff gaps, not
    // operational outcomes. Surfaced via the amber banner above the KPI
    // cards; excluded from `settled` (and therefore from `splitRate`) and
    // from `pending` (since they're not in transit in the UPS-scan sense).
    const missing = upsOnly.filter(o => o.split_status === 'MISSING_TRACKING');
    const missingRate = upsOnly.length ? missing.length / upsOnly.length : 0;

    // By customer
    const byCustomer = {};
    upsOnly.forEach(o => {
      if (!byCustomer[o.customer]) byCustomer[o.customer] = { customer: o.customer, tier: o.tier, total: 0, split: 0 };
      byCustomer[o.customer].total++;
      if (o.isSplit) byCustomer[o.customer].split++;
    });
    const customerList = Object.values(byCustomer).map(c => ({
      ...c, splitRate: c.total ? c.split/c.total : 0
    })).sort((a,b) => b.splitRate - a.splitRate);

    // By shift (mock-only field; live mode produces a single 'unknown' bucket)
    const byShift = {};
    upsOnly.forEach(o => {
      const key = o.shift || (isLive ? 'N/A (live)' : 'unknown');
      if (!byShift[key]) byShift[key] = { shift: key, total: 0, split: 0 };
      byShift[key].total++;
      if (o.isSplit) byShift[key].split++;
    });
    const shiftList = Object.values(byShift).map(s => ({
      ...s, splitRate: s.total ? s.split/s.total : 0
    }));

    // By reason
    const byReason = {};
    split.forEach(o => { const k = o.splitReason || 'Unspecified'; byReason[k] = (byReason[k]||0)+1; });
    const reasonList = Object.entries(byReason).map(([k,v]) => ({ reason: k, count: v })).sort((a,b) => b.count - a.count);

    // By channel — settled basis
    const byChannel = {};
    settled.forEach(o => {
      if (!byChannel[o.channel]) byChannel[o.channel] = { channel: o.channel, total: 0, split: 0, chargeback: 0 };
      byChannel[o.channel].total++;
      if (o.isSplit) {
        byChannel[o.channel].split++;
        byChannel[o.channel].chargeback += (o.chargeback || 0);
      }
    });
    // PR4b2: In live mode the server scopes data to BS-IVY/BS-RED/VIVACE.
    // BS-RED can return zero rows in a short window — keep an explicit 0-row card
    // (grayed) so users see the channel exists rather than wondering where it went.
    if (isLive) {
      const ensure = ['BS-IVY', 'BS-RED', 'VIVACE'];
      ensure.forEach(name => {
        if (!byChannel[name]) byChannel[name] = { channel: name, total: 0, split: 0, chargeback: 0 };
      });
    }
    const channelList = Object.values(byChannel).map(c => ({
      ...c,
      splitRate: c.total ? c.split/c.total : 0,
      group: getChannelGroup(c.channel),
    })).sort((a,b) => b.splitRate - a.splitRate);

    // Chargebacks from splits (mock-only — null-safe in live mode)
    const splitChargebacks = split.reduce((s,o) => s + (o.chargeback || 0), 0);

    // Avg gap — settled SPLIT DOs only. splitGapDays is populated by the
    // mock generator (mock mode) or PR7a's adapter (live mode = max-min of
    // tracking delivered_dates per DO). PENDING SPLITs have splitGapDays
    // null and are excluded from the average.
    const gapItems = split.filter(o => o.splitGapDays != null);
    const gapItemsCount = gapItems.length;
    const avgGap = gapItemsCount ? gapItems.reduce((s,o) => s + o.splitGapDays, 0) / gapItemsCount : 0;
    // PR8: Worst-case gap surfaces outlier customers that average alone
    // hides (e.g. avg 1.7d but one DO at 20d). Pair with avgGap for the
    // "AVG vs Worst" framing in the KPI card subtitle.
    const worstGap = gapItemsCount ? gapItems.reduce((m,o) => o.splitGapDays > m ? o.splitGapDays : m, 0) : 0;

    return {
      split, splitRate, settledCount: settled.length, pendingCount: pending.length, pendingRate, totalCount: upsOnly.length,
      missing, missingCount: missing.length, missingRate,
      customerList, shiftList, reasonList, channelList, splitChargebacks, avgGap, worstGap, gapItemsCount,
    };
  }, [filteredPageData, isLive]);

  // PR8: Container-level metrics. KDC operations sees containers as the
  // work unit alongside DOs as the business unit — both deserve KPI cards.
  // pageData carries already-deduplicated containers per DO (PR7b's
  // distinctContainers in live mode; mock generates one entry per carton),
  // so summing containers.length across DOs gives total unique containers
  // in this window.
  //
  // PR11: denominator parity with DO-level metrics.
  //   - CONTAINERS SPLIT divides by settled containers (containers in
  //     SPLIT or NOT_SPLIT DOs), mirroring DO-level SPLIT RATE's
  //     "outcome-decided" basis from PR10. MISSING_TRACKING / PENDING
  //     containers are excluded so the rate reflects operational truth.
  //   - CONTAINERS IN TRANSIT keeps the totalContainers denominator
  //     (every container in window) to mirror DO-level IN TRANSIT's
  //     proportion-of-window phrasing. UPS scan missing = in transit by
  //     definition, so MISSING_TRACKING containers belong in both
  //     numerator and denominator there.
  //
  // The `isSettled` gate uses the same allow-list pattern as PR10's
  // splitData — explicit `SPLIT || NOT_SPLIT`, so a future SQL category
  // (PR9 added MISSING_TRACKING, more could land) is automatically
  // excluded from settled by default. Pre-PR11 used the pre-PR9
  // deny-list which silently folded MISSING_TRACKING into settled.
  const containerMetrics = useMemo(() => {
    let totalContainers = 0;
    let settledContainers = 0;
    let splitContainers = 0;
    let inTransitContainers = 0;
    for (const o of filteredPageData) {
      // PR Truck-1: exclude TRUCK DOs from container-level Split metrics
      // (paired invariant with splitData above — Truck has no split concept).
      if (o.carrier === 'TRUCK') continue;
      const containers = o.containers || [];
      totalContainers += containers.length;
      const isSettled = o.split_status === 'SPLIT' || o.split_status === 'NOT_SPLIT';
      if (isSettled) {
        settledContainers += containers.length;
        if (o.isSplit) splitContainers += containers.length;
      }
      for (const c of containers) {
        if (c.actualDelivery == null) inTransitContainers += 1;
      }
    }
    return {
      totalContainers,
      settledContainers,
      splitContainers,
      inTransitContainers,
      splitRate: settledContainers > 0 ? splitContainers / settledContainers : 0,
      inTransitRate: totalContainers > 0 ? inTransitContainers / totalContainers : 0,
    };
  }, [filteredPageData]);

  // PR6: YTD customer ranking — top 10 by split count across the full
  // year-to-date window. Independent of the page's main dateRange (so
  // short windows don't show "100% (1/1)" noise). Sort by absolute split
  // count desc; total orders included so we can show split rate as
  // supplementary info on each row.
  //
  // PR13: capture state per customer for the new STATE column. The
  // adapter exposes `state` as a customer-location alias (PR4b1 line
  // 1401) and the mock generator emits the same field, so the lookup
  // is mode-agnostic. A given customer's SOs almost always ship from
  // the same store, so first-seen state is a reliable label; the rare
  // multi-state customer would surface whichever appeared first in the
  // input order. If that becomes a problem the aggregation can switch
  // to "most common" without disturbing the rest of the pipeline.
  const ytdCustomerList = useMemo(() => {
    if (!ytdHookData) return [];
    const byCustomer = new Map();
    for (const o of ytdHookData) {
      // PR Truck-1: exclude TRUCK DOs from YTD customer split ranking
      // (paired invariant with splitData / containerMetrics above).
      if (o.carrier === 'TRUCK') continue;
      const cust = o.customer || 'Unknown';
      if (!byCustomer.has(cust)) {
        byCustomer.set(cust, { customer: cust, tier: o.tier || null, state: o.state || '—', total: 0, splits: 0 });
      }
      const entry = byCustomer.get(cust);
      entry.total += 1;
      if (o.isSplit) entry.splits += 1;
    }
    return Array.from(byCustomer.values())
      .filter(c => c.splits > 0)
      .sort((a, b) => b.splits - a.splits)
      .slice(0, 10)
      .map(c => ({ ...c, splitRate: c.total > 0 ? c.splits / c.total : 0 }));
  }, [ytdHookData]);

  // PR17b: search narrows splitData.split by case-insensitive substring
  // across DO number, customer name, and every container's ID and tracking
  // number. Empty / whitespace query short-circuits to the full cohort so
  // the search bar has zero performance cost when idle.
  const searchedSplits = useMemo(() => {
    const q = containerSearch.trim().toLowerCase();
    if (!q) return splitData.split;
    return splitData.split.filter(o => {
      const doStr = String(o.id || o.do_num || '').toLowerCase();
      if (doStr.includes(q)) return true;
      const custStr = String(o.customer || '').toLowerCase();
      if (custStr.includes(q)) return true;
      const containers = o.containers || [];
      for (const c of containers) {
        const cidStr = String(c.containerId || c.container_id || '').toLowerCase();
        if (cidStr.includes(q)) return true;
        const trackStr = String(c.trackingNumber || c.tracking_num || '').toLowerCase();
        if (trackStr.includes(q)) return true;
      }
      return false;
    });
  }, [splitData.split, containerSearch]);

  // PR18: flatten the current search-filtered cohort into wide-format rows
  // for Excel export. 1 DO with N containers → N rows (each carrying the
  // same DO-level fields). DOs without containers (rare: fresh SOs with no
  // tracking yet) get a single base row so missing-tracking cases stay
  // visible in the export.
  //
  // Field fallbacks: live mode uses snake_case (container_id, tracking_num,
  // container_status, delivered_date, delivered_state); mock mode uses
  // camelCase (containerId, trackingNumber, status). Alert flag combines
  // mock-only (isLate / deliveredDifferentDay) with live's deliveryStatus
  // === 'SPLIT_DAY'.
  const flattenForExport = (splits) => {
    const rows = [];
    for (const o of splits) {
      const hasAlertRow = (o.containers || []).some(
        c => c.isLate || c.deliveredDifferentDay || c.deliveryStatus === 'SPLIT_DAY'
      );
      const baseRow = {
        'Order #': o.id || o.do_num || '',
        'Customer': o.customer || '',
        'State': o.state || o.customer_state || '',
        'Channel': o.channel || o.channel_code || '',
        'Containers': o.container_cnt != null ? o.container_cnt : (o.containers?.length || 0),
        'Split Gap (days)': o.splitGapDays != null ? o.splitGapDays : '',
        'Root Cause': o.splitReason || '',
        'Invoice Value': o.orderValue != null ? Number(o.orderValue).toFixed(2) : '',
        'Alert': hasAlertRow ? 'Y' : 'N',
      };
      const containers = o.containers || [];
      if (containers.length > 0) {
        for (const c of containers) {
          // Normalize delivered_date — live carries 'YYYY-MM-DD' strings,
          // mock carries Date objects. Keep them readable in Excel without
          // forcing a single format (Excel parses both fine for sorting).
          let deliveredOut = '';
          const rawDelivered = c.delivered_date || c.actualDelivery || null;
          if (rawDelivered) {
            if (rawDelivered instanceof Date) {
              deliveredOut = Number.isNaN(rawDelivered.getTime())
                ? ''
                : rawDelivered.toISOString().slice(0, 10);
            } else {
              deliveredOut = String(rawDelivered).slice(0, 10);
            }
          }
          rows.push({
            ...baseRow,
            'Container ID': c.containerId || c.container_id || '',
            'Tracking Number': c.trackingNumber || c.tracking_num || '',
            'Container Status': c.status || c.container_status || '',
            'Delivered Date': deliveredOut,
            'Delivered State': c.deliveredState || c.delivered_state || '',
          });
        }
      } else {
        rows.push({
          ...baseRow,
          'Container ID': '',
          'Tracking Number': '',
          'Container Status': '',
          'Delivered Date': '',
          'Delivered State': '',
        });
      }
    }
    return rows;
  };

  // PR18: export handler. searchedSplits (PR17b's current view source) →
  // flat rows → SheetJS workbook → download. Filename carries an ISO
  // timestamp (':' and '.' rewritten to '-' for Windows/Unix safety) so
  // ops can archive successive exports without overwriting each other.
  const handleExportExcel = () => {
    const rows = flattenForExport(searchedSplits);
    if (rows.length === 0) {
      // Codebase has no shared toast/banner pattern yet — alert() keeps
      // the user from clicking into a silent no-op. Future: replace with
      // a contextual banner near the search bar.
      alert('No split orders to export. Try clearing your search or filters.');
      return;
    }
    const worksheet = XLSX.utils.json_to_sheet(rows);
    // wch = column width in character units. Tuned for the longest plausible
    // value in each column so Excel opens with sensible defaults (no manual
    // resize on the operator's first action).
    worksheet['!cols'] = [
      { wch: 14 },  // Order #
      { wch: 28 },  // Customer
      { wch: 6 },   // State
      { wch: 10 },  // Channel
      { wch: 11 },  // Containers
      { wch: 14 },  // Split Gap (days)
      { wch: 22 },  // Root Cause
      { wch: 14 },  // Invoice Value
      { wch: 8 },   // Alert
      { wch: 22 },  // Container ID
      { wch: 22 },  // Tracking Number
      { wch: 16 },  // Container Status
      { wch: 14 },  // Delivered Date
      { wch: 14 },  // Delivered State
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Split Orders');
    const ts = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    XLSX.writeFile(workbook, `split-orders-${ts}.xlsx`);
  };

  // PR15: pagination math for the Container Tracking table. Derived from
  // splitData.split (post-PR10 settled-basis SPLIT cohort) so the table
  // shows every operationally-decided split, not just the first 30.
  // PR17b: pagination source switched to searchedSplits so the table
  // and "Showing X-Y of Z" footer both reflect the active search.
  const splitTotalCount = searchedSplits.length;
  const splitTotalPages = Math.max(1, Math.ceil(splitTotalCount / pageSize));
  const splitStartIdx = currentPage * pageSize;
  const splitEndIdx = Math.min(splitStartIdx + pageSize, splitTotalCount);
  const paginatedSplits = searchedSplits.slice(splitStartIdx, splitEndIdx);

  // PR15: reset to first page when the underlying data shrinks below the
  // current page or the user picks a different page size. Without this, a
  // user on page 7/9 who narrows the window could end up rendering an
  // empty page with disabled nav.
  // PR17b: `containerSearch` listed explicitly even though splitTotalCount
  // already changes with the search — defensive against future refactors
  // (e.g. if the search ever stops shrinking the cohort).
  useEffect(() => {
    setCurrentPage(0);
  }, [pageSize, splitTotalCount, containerSearch]);

  if (hookLoading) {
    return <div className="p-8 text-center text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>Loading split-shipment data…</div>;
  }

  return (
    <>
      {/* PR4b2: Mock-fallback banner — server unreachable, page is showing degraded mock data.
          Per core-beliefs §6: never blank the page; clearly label degraded mode. */}
      {source === 'mock-fallback' && (
        <div className="rounded p-2.5 mb-4 flex items-start gap-2" style={{ background: '#E74C6F10', border: '1px solid #E74C6F30' }}>
          <AlertTriangle size={14} className="text-[#E74C6F] mt-0.5 flex-shrink-0"/>
          <div className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
            <span className="font-semibold text-[#E74C6F]">Live data unavailable</span>
            {hookError?.message && <span className="font-mono text-[11px] ml-1.5" style={{ color: 'var(--text-secondary)' }}>({hookError.message})</span>}
            <span className="ml-1.5" style={{ color: 'var(--text-secondary)' }}>— showing mock data. Check that <code className="font-mono">node server.js</code> is running.</span>
          </div>
        </div>
      )}
      <div className="bg-gradient-to-r from-[#E74C6F]/20 to-transparent border-l-2 border-[#E74C6F] rounded p-3 mb-4">
        <div className="flex items-center gap-2 text-[12px] text-[#E74C6F] font-semibold uppercase tracking-wider">
          <AlertTriangle size={14}/> Customer Hard Requirement
        </div>
        <div className="text-[13px] mt-1 text-[#c5ccd4]">
          All cartons from a single order must be delivered on the same day. Any split shipment is a compliance violation. Target split rate: <span className="font-mono text-[#2ECC71]">0.0%</span>
        </div>
      </div>

      {/* PR10: MISSING_TRACKING data-integrity banner. PR9's master query
          classifies DOs with `has_null_tracking = 1` as a separate category
          (one or more containers without a UPS tracking_num — either a fresh
          SO not yet handed off, or a genuine data anomaly). These are
          excluded from the split-rate denominator and the in-transit numerator
          so the KPI cards reflect operational outcomes only. The banner
          surfaces the count so operations knows to investigate. Amber matches
          the warehouse "needs attention" convention from CLAUDE.md (amber
          #f5a623) — distinct from the critical red on the requirement banner
          above. Hidden when count = 0 so it doesn't add noise in clean windows. */}
      {splitData.missingCount > 0 && (
        <div className="bg-gradient-to-r from-[#f5a623]/15 to-transparent border-l-2 border-[#f5a623] rounded p-3 mb-4">
          <div className="flex items-center gap-2 text-[12px] text-[#f5a623] font-semibold uppercase tracking-wider">
            <AlertTriangle size={14}/> Data Integrity Alert
          </div>
          <div className="text-[13px] mt-1 text-[#c5ccd4]">
            <span className="font-mono text-[#f5a623]">{fmtNum(splitData.missingCount)}</span> DOs
            (<span className="font-mono text-[#f5a623]">{fmtPct(splitData.missingRate)}</span>)
            have container(s) without a UPS tracking number. Excluded from split-rate
            and in-transit metrics. Likely fresh SOs awaiting UPS handoff or genuine
            data anomalies needing investigation.
          </div>
        </div>
      )}

      {/* Container delivery mismatch summary */}
      {(() => {
        const ordersWithMismatch = splitData.split.filter(o => o.containers?.some(c => c.deliveredDifferentDay || c.isLate));
        if (ordersWithMismatch.length === 0) return null;
        const totalLateContainers = splitData.split.reduce((s, o) => s + (o.containers?.filter(c => c.isLate || c.deliveredDifferentDay).length || 0), 0);
        return (
          <div className="bg-gradient-to-r from-[#E74C6F]/15 to-transparent border-l-2 border-[#E74C6F] rounded p-3 mb-4 flex items-center gap-3">
            <Package size={18} className="text-[#E74C6F]"/>
            <div className="flex-1">
              <div className="text-[12px] text-[#E74C6F] font-semibold uppercase tracking-wider">Container Delivery Mismatch</div>
              <div className="text-[13px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                <span className="font-mono text-[#E74C6F]">{ordersWithMismatch.length}</span> orders have containers arriving on different days.
                <span className="font-mono text-[#E74C6F] ml-2">{totalLateContainers}</span> individual containers flagged (late or split-day delivery).
              </div>
            </div>
          </div>
        );
      })()}

      {/* PR8: 6 KPI cards arranged so the DO unit pairs with its container counterpart.
          Row 1: SPLIT RATE | ORDERS SPLIT (DO) | CONTAINERS SPLIT (container)
          Row 2: IN TRANSIT (DO) | CONTAINERS IN TRANSIT (container) | AVG GAP
          Removed CHARGEBACKS and KEY ACCT IMPACT — both were mock-only N/A in live
          mode (no SLA penalty data source, no customer tier classification). Backlog
          allows reinstating either via a mock-only N/A pattern if a data source lands. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <KPI label="Split Rate" value={fmtPct(splitData.splitRate)} delta={`${splitData.split.length} of ${splitData.settledCount} settled`} deltaType="bad" icon={Split}/>
        <KPI label="Orders Split" value={splitData.split.length} delta={`of ${splitData.settledCount} settled`} deltaType="bad" icon={Package}/>
        {/* PR8: CONTAINERS SPLIT — operations-unit complement to ORDERS SPLIT.
            KDC's warehouse cares how many cartons are affected, not just orders.
            PR11: denominator is settledContainers (containers in SPLIT or
            NOT_SPLIT DOs), parity with DO-level ORDERS SPLIT settled basis. */}
        <KPI label="Containers Split" value={fmtNum(containerMetrics.splitContainers)} delta={`of ${fmtNum(containerMetrics.settledContainers)} settled containers`} deltaType="bad" icon={Box}/>
        <KPI label="In Transit" value={fmtPct(splitData.pendingRate)} delta={`${splitData.pendingCount} of ${splitData.totalCount} pending`} icon={Clock}/>
        {/* PR8: CONTAINERS IN TRANSIT — DO-level pending masks the fact that even
            settled DOs can have individual containers still without a UPS scan.
            Container-level surfaces the true UPS-scan-pending picture. */}
        <KPI label="Containers In Transit" value={fmtPct(containerMetrics.inTransitRate)} delta={`${fmtNum(containerMetrics.inTransitContainers)} of ${fmtNum(containerMetrics.totalContainers)} containers`} icon={Clock}/>
        {/* PR8: AVG GAP activated. PR7a's splitGapDays per DO flows through both
            mock and live paths. Subtitle uses Worst (max) instead of "Between
            partials" so outliers surface even when the average looks fine. */}
        {splitData.gapItemsCount > 0 ? (
          <KPI label="Avg Gap" value={`${splitData.avgGap.toFixed(1)}d`} delta={`Worst: ${splitData.worstGap}d`} deltaType="bad" icon={Clock}/>
        ) : (
          <KPI label="Avg Gap" value="—" delta="No settled splits in window" icon={Clock}/>
        )}
      </div>

      {/* PR4b4: Channel first → Container Tracking → Customer + Root Cause.
          Triage flow: which channel is hurting → which orders → who/why. */}
      <SectionCard title="Split Rate by Distribution Channel" subtitle="ECOM channels typically have zero tolerance for splits" tag="CHANNEL IMPACT" className="mb-4">
        {/* PR4b4: Light-mode-first card redesign per reference dashboard.
            Card bg uses var(--bg-panel) so dark mode stays dark. Border + headline %
            + progress bar all share the same channel color (pink/orange/green by
            splitRate threshold). Empty cards (BS-RED w/ 0 settled) gray out with a
            neutral border so they read as "no data yet" rather than "0.0% violation". */}
        <div className={`grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 ${isLive ? 'lg:grid-cols-3' : 'lg:grid-cols-11'} gap-2 mb-3`}>
          {splitData.channelList.map(c => {
            const isEmpty = c.total === 0;
            const channelColor = c.splitRate > 0.2 ? '#E74C6F' : c.splitRate > 0.1 ? '#f5a623' : '#2ECC71';
            return (
              <div key={c.channel}
                className={`rounded-lg p-3 transition-all ${isEmpty ? 'opacity-40' : ''}`}
                style={{
                  background: 'var(--bg-panel)',
                  border: `1px solid ${isEmpty ? 'var(--border)' : channelColor}`,
                  boxShadow: isEmpty ? 'none' : '0 1px 3px rgba(0,0,0,0.05)',
                }}>
                {/* Channel label + group-color dot */}
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-1.5 h-1.5 rounded-sm flex-shrink-0" style={{ background: getChannelColor(c.channel) }}/>
                  <div className="text-[10px] font-mono uppercase tracking-wider truncate" style={{ color: 'var(--text-muted)' }}>{c.channel}</div>
                </div>
                {/* Headline percentage in the channel color (or muted dash when empty) */}
                {isEmpty ? (
                  <div className="font-mono text-lg font-semibold" style={{ color: 'var(--text-muted)' }}>─</div>
                ) : (
                  <div className="font-mono text-lg font-semibold" style={{ color: channelColor }}>
                    {fmtPct(c.splitRate)}
                  </div>
                )}
                {/* split/total subtitle */}
                <div className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {isEmpty ? '0 orders' : `${c.split}/${c.total}`}
                </div>
                {/* Progress bar — channel color on a light-gray track */}
                <div className="mt-2 h-1 rounded overflow-hidden" style={{ background: 'var(--border)' }}>
                  <div className="h-full transition-all" style={{
                    width: isEmpty ? '0%' : `${Math.min(c.splitRate * 100 * 3, 100)}%`,
                    background: channelColor,
                  }}/>
                </div>
              </div>
            );
          })}
        </div>
        {splitData.channelList[0] && splitData.channelList[0].splitRate > 0.15 && (
          <div className="bg-[#1a2129] rounded p-3 border-l-2 border-[#E74C6F]">
            <div className="text-[11px] uppercase tracking-wider text-[#E74C6F] font-mono mb-1">⚠ Channel Alert</div>
            <div className="text-[12px]">
              <span className="font-semibold">{splitData.channelList[0].channel}</span> has the highest split rate at <span className="font-mono text-[#E74C6F]">{fmtPct(splitData.channelList[0].splitRate)}</span>.
              {splitData.channelList[0].channel.startsWith('ECOM') && ' ECOM channel customers are the most sensitive to splits — expect chargebacks and reviews.'}
              {splitData.channelList[0].channel.startsWith('CS - Bulk') && ' CS Bulk splits often indicate upstream allocation issues. Check TPA confirmation gaps.'}
              {splitData.channelList[0].chargeback > 0 && <>{' '}Chargeback exposure: <span className="font-mono text-[#E74C6F]">${fmtNum(splitData.channelList[0].chargeback)}</span>.</>}
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Container Tracking — Split Orders"
        subtitle={
          <>
            {splitData.split.length} split orders ·{' '}
            {/* PR14: clickable subtitle drives the page-level expand-all toggle.
                Rendered inline as a button so it inherits the parent's font /
                color but flips text + signals clickability with underline +
                pointer cursor. Background / border / padding stripped to
                neutralize the browser's default <button> chrome. */}
            <button
              type="button"
              onClick={() => setAllExpanded(prev => !prev)}
              className="underline hover:no-underline cursor-pointer font-mono"
              style={{ color: 'inherit', background: 'transparent', border: 'none', padding: 0, font: 'inherit' }}
            >
              click to {allExpanded ? 'collapse' : 'expand'} all container details
            </button>
          </>
        }
        tag="CONTAINER TREE"
        className="mb-4"
      >
        {/* PR17b: row-level search above the table. Multi-field substring
            match (DO, customer, container ID, tracking number). View-scoped:
            doesn't disturb KPI cards / sections — those still reflect the
            broader PR16 filter selection. Theme-aware tokens (PR17a-fix
            lesson) so it tracks light/dark.
            PR18: Export-to-Excel button sits in the same flex row,
            justify-between so the search bar anchors the left edge and
            the export button anchors the right edge (vertically aligning
            with the CONTAINER TREE tag). Operational visual flow: search
            (frequent, left) ↔ export (occasional, right). */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="relative" style={{ maxWidth: 400, flex: '1 1 400px' }}>
            <Search
              size={12}
              className="absolute left-2 top-1/2 -translate-y-1/2 opacity-60 pointer-events-none"
              style={{ color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              value={containerSearch}
              onChange={e => setContainerSearch(e.target.value)}
              placeholder="Search by DO, container, customer, tracking…"
              className="w-full text-[12px] font-mono rounded outline-none pl-7 pr-7 py-1 placeholder:text-[var(--text-muted)] focus:border-[#1ABC9C]"
              style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            />
            {containerSearch && (
              <button
                type="button"
                onClick={() => setContainerSearch('')}
                title="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100 cursor-pointer text-[11px] font-mono leading-none"
                style={{ color: 'var(--text-muted)', background: 'transparent', border: 'none', padding: 0 }}
              >
                <X size={12}/>
              </button>
            )}
          </div>
          {/* PR18: Export to Excel. Exports searchedSplits (the current
              filter + search cohort) as a denormalized xlsx — 1 row per
              container so ops can sort/filter/pivot downstream. */}
          <button
            type="button"
            onClick={handleExportExcel}
            title="Export current view to Excel"
            className="text-[12px] font-mono rounded outline-none cursor-pointer flex items-center gap-1.5 px-3 py-1 hover:opacity-90"
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            <Download size={12} className="opacity-80"/>
            Export to Excel
          </button>
        </div>
        <div className="overflow-x-auto" style={{ maxHeight: 500 }}>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider font-mono" style={{ color: 'var(--text-muted)' }}>
                <th className="text-left py-2 pr-3">Order</th>
                <th className="text-left py-2 pr-3">Customer</th>
                <th className="text-left py-2 pr-3">Channel</th>
                <th className="text-center py-2 pr-3">Containers</th>
                <th className="text-center py-2 pr-3">Split Gap</th>
                <th className="text-left py-2 pr-3">Root Cause</th>
                <th className="text-right py-2 pr-3">Value</th>
                <th className="text-center py-2">Alert</th>
              </tr>
            </thead>
            <tbody>
              {paginatedSplits.map(o => {
                // PR14: page-level allExpanded overrides per-row state.
                // Individual clicks still mutate expandedOrder but their
                // effect is masked while allExpanded is on.
                const isExpanded = allExpanded || expandedOrder === o.id;
                const hasAlert = o.containers?.some(c => c.isLate || c.deliveredDifferentDay);
                return (
                  <React.Fragment key={o.id}>
                    {/* Parent shipment row */}
                    <tr onClick={() => setExpandedOrder(isExpanded ? null : o.id)}
                      className="cursor-pointer transition-colors"
                      style={{ borderTop: '1px solid var(--border)', background: isExpanded ? '#1ABC9C10' : 'transparent' }}>
                      <td className="py-2.5 pr-3 font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                        <span className="mr-1.5">{isExpanded ? '\u25BC' : '\u25B6'}</span>{o.id}
                      </td>
                      <td className="py-2.5 pr-3" style={{ color: 'var(--text-primary)' }}>{o.customer}</td>
                      <td className="py-2.5 pr-3">
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: (getChannelColor(o.channel))+'20', color: getChannelColor(o.channel) }}>{o.channel}</span>
                      </td>
                      <td className="py-2.5 pr-3 text-center font-mono">{o.containers?.length || o.splitCartons || 0}x</td>
                      <td className="py-2.5 pr-3 text-center font-mono text-[#E74C6F]">{o.splitGapDays != null ? `${o.splitGapDays}d` : '—'}</td>
                      <td className="py-2.5 pr-3 text-[11px]" style={{ color: 'var(--text-secondary)' }}>{o.splitReason ? (ROOT_CAUSE_LABELS[o.splitReason] || o.splitReason) : '—'}</td>
                      <td className="py-2.5 pr-3 text-right font-mono" style={{ color: 'var(--text-primary)' }}>{o.orderValue != null ? `$${fmtNum(o.orderValue)}` : '—'}</td>
                      <td className="py-2.5 text-center">
                        {hasAlert && <AlertTriangle size={14} className="text-[#E74C6F] mx-auto"/>}
                      </td>
                    </tr>

                    {/* Expanded container rows */}
                    {isExpanded && o.containers && o.containers.map((c, ci) => {
                      const isLastContainer = ci === o.containers.length - 1;

                      // PR7b: deliveryStatus drives the OK / SPLIT DAY / — alert column.
                      // Live mode: adapter (serverRowsToShipments) sets it from
                      // mode-of-day across the DO's distinct tracking_nums.
                      // Mock fallback: derive from mock-specific fields so the UI
                      // stays consistent across both modes.
                      const deliveryStatus = c.deliveryStatus
                        || (c.deliveredDifferentDay ? 'SPLIT_DAY'
                          : c.actualDelivery ? 'OK'
                          : 'PENDING');

                      return (
                        <tr key={c.containerId} style={{ background: ci % 2 === 0 ? 'var(--bg-panel-alt)' : 'transparent', borderLeft: '3px solid #1ABC9C' }}>
                          <td className="py-2 pr-3 pl-8 font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                            <span style={{ color: 'var(--text-muted)' }}>{isLastContainer ? '\u2514\u2500' : '\u251C\u2500'}</span> {c.containerId}
                          </td>
                          <td className="py-2 pr-3 font-mono text-[11px]" style={{ color: 'var(--text-primary)' }}>
                            {c.trackingNumber || '—'}
                            {c.lastLocation && <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{c.lastLocation}</div>}
                          </td>
                          {/* PR7b: DELIVERED badge gated on actualDelivery
                              (= delivered_date in live mode), not on
                              container_status. KDC SCALE container_status = 900
                              means "manifested out from KDC", not "UPS delivered
                              to customer" — pre-PR7b this misleadingly rendered
                              "DELIVERED" for packages still in UPS transit.
                              PR12: 3-state — MISSING TRACKING surfaces containers
                              that never reached UPS handoff. Without this, those
                              packages rendered as IN TRANSIT (misleading: UPS
                              never started processing). c.trackingNumber === '—'
                              is the canonical missing signal (live normalization
                              fills '—' when tracking_num is null; mock always
                              has a real tracking number so it never trips). */}
                          <td className="py-2 pr-3">
                            {c.trackingNumber === '—' ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-mono font-semibold" style={{ background: '#f5a62320', color: '#f5a623' }}>
                                MISSING TRACKING
                              </span>
                            ) : c.actualDelivery ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-mono font-semibold" style={{ background: '#2ECC7120', color: '#2ECC71' }}>
                                DELIVERED
                              </span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-mono font-semibold" style={{ background: '#F39C1220', color: '#F39C12' }}>
                                IN TRANSIT
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-center font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                            {c.items != null || c.weight != null ? `${c.items ?? '—'} items · ${c.weight ?? '—'} lb` : '—'}
                          </td>
                          <td className="py-2 pr-3 text-center font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                            {/* PR7b: was c.shipDate (KDC outbound) — now actualDelivery (UPS delivered_date). */}
                            {c.actualDelivery ? c.actualDelivery.toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'}) : '—'}
                          </td>
                          <td className="py-2 pr-3 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                            {c.expectedDelivery
                              ? `Exp: ${c.expectedDelivery.toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'})}`
                              : <span style={{ color: 'var(--text-muted)' }}>Exp: —</span>}
                            {/* PR7b: removed inline-arrow \u2192 delivered date \u2014 the
                                Date column above now shows actualDelivery directly. */}
                          </td>
                          {/* PR7b: OK / SPLIT DAY / — driven by deliveryStatus
                              (mode-of-day across DO's tracking_nums; tie-breaker
                              = earliest day wins). */}
                          <td className="py-2 pr-3 text-right font-mono text-[11px]">
                            {deliveryStatus === 'OK' && <span className="text-[#2ECC71]">OK</span>}
                            {deliveryStatus === 'SPLIT_DAY' && <span className="text-[#E74C6F]">SPLIT DAY</span>}
                            {deliveryStatus === 'PENDING' && <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          </td>
                          <td className="py-2 text-center">
                            {deliveryStatus === 'SPLIT_DAY' && <AlertTriangle size={12} className="text-[#E74C6F] mx-auto"/>}
                          </td>
                        </tr>
                      );
                    })}

                    {/* Alert banner for expanded order.
                        PR12: also trigger + describe when one or more containers
                        in this DO have no UPS tracking number. Missing-tracking
                        text is amber to match the MISSING TRACKING badge above
                        and the DATA INTEGRITY ALERT banner at page top — visual
                        chain: page banner → row alert → cell badge. */}
                    {isExpanded && o.containers && (() => {
                      const lateContainers = o.containers.filter(c => c.isLate || c.deliveredDifferentDay);
                      const deliveryDates = [...new Set(o.containers.filter(c => c.actualDelivery).map(c => c.actualDelivery.toDateString()))];
                      const missingTrackingCount = o.containers.filter(c => c.trackingNumber === '—').length;
                      if (lateContainers.length === 0 && deliveryDates.length <= 1 && missingTrackingCount === 0) return null;
                      return (
                        <tr>
                          <td colSpan={8} className="py-2 px-4">
                            <div className="rounded p-2.5 flex items-start gap-2" style={{ background: '#E74C6F10', border: '1px solid #E74C6F30' }}>
                              <AlertTriangle size={14} className="text-[#E74C6F] mt-0.5 flex-shrink-0"/>
                              <div className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
                                <span className="font-semibold text-[#E74C6F]">Split Delivery Alert:</span>{' '}
                                {deliveryDates.length > 1 && `Containers delivered across ${deliveryDates.length} different days. `}
                                {lateContainers.length > 0 && `${lateContainers.length} container(s) delivered late or on a different day than the first carton. `}
                                {missingTrackingCount > 0 && <><span className="font-mono font-semibold text-[#f5a623]">{missingTrackingCount}</span><span className="text-[#f5a623]"> container(s) missing UPS tracking number. </span></>}
                                Customer requirement: all cartons same day.{o.chargeback != null && <> Chargeback: <span className="font-mono font-semibold">${fmtNum(o.chargeback)}</span></>}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })()}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* PR15: pagination footer. Range info on the left, page-size select +
            Prev/Next on the right. Styling mirrors the existing dashboard
            select (forecast horizon, line ~4440) so the dropdown reads as
            "same family" rather than a one-off control. Buttons disable at
            the boundaries so the user can't navigate off the edge. */}
        <div className="flex items-center justify-between text-[11px] font-mono mt-3 px-1" style={{ color: 'var(--text-muted)' }}>
          <div>
            {splitTotalCount > 0
              ? <>Showing <span style={{ color: 'var(--text-primary)' }}>{splitStartIdx + 1}-{splitEndIdx}</span> of <span style={{ color: 'var(--text-primary)' }}>{fmtNum(splitTotalCount)}</span></>
              : <>No split orders in window</>}
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5">
              <span>Page size:</span>
              <select
                value={pageSize}
                onChange={e => setPageSize(Number(e.target.value))}
                className="bg-[#232c37] border border-[#2d3744] text-[11px] font-mono px-1.5 py-0.5 rounded text-[#e8ecef] focus:border-[#1ABC9C] outline-none"
              >
                <option value={10}>10</option>
                <option value={30}>30</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="px-2 py-0.5 rounded border border-[#2d3744] text-[#e8ecef] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#232c37]"
              >
                ← Prev
              </button>
              <span className="px-2" style={{ color: 'var(--text-primary)' }}>
                Page {currentPage + 1} of {splitTotalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage(p => Math.min(splitTotalPages - 1, p + 1))}
                disabled={currentPage >= splitTotalPages - 1}
                className="px-2 py-0.5 rounded border border-[#2d3744] text-[#e8ecef] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#232c37]"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* PR4b4: Customer + Root Cause grid moved here from above-channel. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <SectionCard
          title="Split Rate by Customer"
          subtitle={`Year to date · Top 10 by split count${ytdLoading ? ' · Loading…' : ''}`}
          tag="YTD"
        >
          {/* PR6: YTD top 10 customers by absolute split count. Independent
              of the page's main dateRange — short windows show statistical
              noise like "100% (1/1)" which isn't actionable. */}
          <div className="space-y-2">
            {ytdLoading ? (
              <div className="text-[12px] py-4" style={{ color: 'var(--text-muted)' }}>
                Loading YTD data…
              </div>
            ) : ytdCustomerList.length === 0 ? (
              <div className="text-[12px] py-4" style={{ color: 'var(--text-muted)' }}>
                No split data in YTD window.
              </div>
            ) : (() => {
              const maxSplits = ytdCustomerList[0].splits; // top entry; bar scales relative to it
              return ytdCustomerList.map(c => {
                const barWidth = maxSplits > 0 ? (c.splits / maxSplits) * 100 : 0;
                return (
                  <div key={c.customer} className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 w-40">
                      {c.tier === 'Key' && <span className="text-[10px] px-1 py-0.5 rounded bg-[#1ABC9C]/20 text-[#1ABC9C] font-mono">KEY</span>}
                      <div className="text-[12px] truncate" title={c.customer}>{c.customer}</div>
                    </div>
                    {/* PR13: STATE column. Fixed narrow width — state codes are
                        always 2 chars; '—' fallback when null. Reuses the
                        muted secondary-text treatment from the row's right side
                        so the eye reads CUSTOMER as the primary label and
                        STATE / numbers as metadata. Operations can scan the
                        column vertically to spot geographic clustering. */}
                    <div className="font-mono text-[11px] w-8 text-center flex-shrink-0" style={{ color: 'var(--text-muted)' }} title={c.state}>
                      {c.state}
                    </div>
                    <div className="flex-1 h-4 bg-[#0f1419] rounded overflow-hidden">
                      <div className="h-full" style={{
                        width: `${barWidth}%`,
                        background: c.splitRate > 0.25 ? '#E74C6F' : c.splitRate > 0.1 ? '#f5a623' : '#2ECC71',
                      }} />
                    </div>
                    <div className="font-mono text-[11px] text-[#5d6b7a] w-28 text-right">
                      {c.splits} · {fmtPct(c.splitRate)}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </SectionCard>

        <SectionCard title="Root Causes of Splits" subtitle="Why orders are being split" tag="DIAGNOSIS">
          {/* PR5b: 5 Phase B SQL categories with friendly labels via
              ROOT_CAUSE_LABELS. Sorted by count desc; empty categories
              render at 40% opacity so a window with no wave-level splits
              still shows the row instead of disappearing. */}
          <div className="space-y-2">
            {(() => {
              const causeCount = {};
              for (const o of splitData.split) {
                const cause = o.splitReason || 'UNCLASSIFIED_SPLIT';
                causeCount[cause] = (causeCount[cause] || 0) + 1;
              }
              const total = splitData.split.length || 1;
              const rows = ROOT_CAUSE_ORDER.map(cause => ({
                cause,
                label: ROOT_CAUSE_LABELS[cause] || cause,
                count: causeCount[cause] || 0,
                pct: (causeCount[cause] || 0) / total,
              })).sort((a, b) => b.count - a.count);

              return rows.map(r => {
                const isEmpty = r.count === 0;
                const barColor = r.pct > 0.5 ? '#E74C6F'
                              : r.pct > 0.15 ? '#f5a623'
                              : r.pct > 0 ? '#2ECC71'
                              : 'transparent';
                return (
                  <div
                    key={r.cause}
                    className={`flex items-center gap-3 ${isEmpty ? 'opacity-40' : ''}`}
                  >
                    <div className="text-[12px] w-40 flex-shrink-0">{r.label}</div>
                    <div className="flex-1 h-4 rounded overflow-hidden bg-[#1a2129]">
                      <div className="h-full transition-all" style={{
                        width: `${Math.min(r.pct * 100 * 1.2, 100)}%`,
                        background: barColor,
                      }} />
                    </div>
                    <div className="font-mono text-[11px] w-24 text-right text-[#8a95a3]">
                      {r.count} · {fmtPct(r.pct)}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </SectionCard>
      </div>
    </>
  );
};

// ============================================================
// COSTS / $ AT RISK PAGE
// ============================================================
const CostsPage = ({ filtered }) => {
  const costs = useMemo(() => {
    const total = filtered.reduce((s,o) => s + o.chargeback, 0);
    const byReason = { 'UPS': 0, 'DC': 0, 'Missing': 0, 'Damage': 0, 'Other': 0, 'Split': 0 };
    filtered.forEach(o => {
      if (o.cause) byReason[o.cause] += o.chargeback - (o.isSplit ? Math.round(o.chargeback * 0.4) : 0);
      if (o.isSplit) byReason['Split'] += Math.round(o.chargeback * (o.cause ? 0.4 : 1));
    });
    const byTier = { 'Key': 0, 'Growth': 0, 'Mid': 0, 'Small': 0 };
    filtered.forEach(o => { byTier[o.tier] = (byTier[o.tier]||0) + o.chargeback; });
    const dailyTrend = {};
    filtered.forEach(o => {
      const key = o.orderCreate.toISOString().slice(5,10);
      if (!dailyTrend[key]) dailyTrend[key] = { date: key, total: 0, split: 0, damage: 0, delay: 0 };
      dailyTrend[key].total += o.chargeback;
      if (o.isSplit) dailyTrend[key].split += Math.round(o.chargeback * (o.cause ? 0.4 : 1));
      if (o.cause === 'Damage') dailyTrend[key].damage += o.chargeback;
      if (o.cause === 'UPS' || o.cause === 'DC') dailyTrend[key].delay += o.chargeback;
    });
    const valueAtRisk = filtered.filter(o => o.isOpen && (o.cause || o.isSplit)).reduce((s,o) => s + o.orderValue, 0);
    return { total, byReason, byTier, trendList: Object.values(dailyTrend).sort((a,b) => a.date.localeCompare(b.date)), valueAtRisk };
  }, [filtered]);

  const totalChargebacks = costs.total;
  const annualized = totalChargebacks * (365/17); // extrapolate from 17-day window

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        <KPI label="Total Chargebacks" value={`$${fmtNum(costs.total.toFixed(0))}`} delta="17-day window" deltaType="bad" icon={DollarSign}/>
        <KPI label="Annualized" value={`$${(annualized/1000).toFixed(0)}k`} delta="Projected run-rate" deltaType="bad" icon={TrendingUp}/>
        <KPI label="Value at Risk" value={`$${fmtNum(costs.valueAtRisk.toFixed(0))}`} delta="Open at-risk orders" deltaType="bad" icon={AlertTriangle}/>
        <KPI label="Split Penalty $" value={`$${fmtNum(costs.byReason['Split'].toFixed(0))}`} delta={fmtPct(costs.byReason['Split']/costs.total)+ ' of total'} deltaType="bad" icon={Split}/>
        <KPI label="Damage Claims $" value={`$${fmtNum(costs.byReason['Damage'].toFixed(0))}`} delta={fmtPct(costs.byReason['Damage']/costs.total)+ ' of total'} deltaType="bad" icon={Package}/>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <SectionCard title="Chargebacks by Root Cause" subtitle="Dollar impact" tag="BAR">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={Object.entries(costs.byReason).map(([k,v]) => ({ cause: k, amount: v }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3744"/>
              <XAxis dataKey="cause" stroke="#5d6b7a" style={{ fontSize: 10, fontFamily: 'IBM Plex Mono' }}/>
              <YAxis stroke="#5d6b7a" style={{ fontSize: 10, fontFamily: 'IBM Plex Mono' }} tickFormatter={v => `$${v/1000}k`}/>
              <Tooltip contentStyle={{ background: '#1a2129', border: '1px solid #2d3744', fontSize: 11 }} formatter={v => `$${fmtNum(v.toFixed(0))}`}/>
              <Bar dataKey="amount">
                {Object.keys(costs.byReason).map((k,i) => (
                  <Cell key={i} fill={CAUSE_COLORS[k] || '#1ABC9C'}/>
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Chargebacks by Customer Tier" subtitle="Who's driving the cost" tag="DISTRIBUTION">
          <div className="space-y-3 mt-2">
            {Object.entries(costs.byTier).map(([tier, amount]) => {
              const pct = amount / costs.total;
              return (
                <div key={tier}>
                  <div className="flex justify-between text-[12px] mb-1">
                    <span className="font-semibold">{tier} Accounts</span>
                    <span className="font-mono">${fmtNum(amount.toFixed(0))} · {fmtPct(pct)}</span>
                  </div>
                  <div className="h-2 bg-[#0f1419] rounded overflow-hidden">
                    <div className="h-full" style={{ width: `${pct*100}%`, background: tier === 'Key' ? '#1ABC9C' : tier === 'Growth' ? '#2C3E9B' : tier === 'Mid' ? '#f5a623' : '#8a95a3' }}/>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 bg-[#1a2129] rounded p-3 text-[12px]">
            <div className="text-[#1ABC9C] uppercase tracking-wider text-[11px] font-mono mb-1">Executive Take</div>
            <div>Key accounts absorb {fmtPct(costs.byTier['Key']/costs.total)} of chargebacks. Every $1 saved here has outsized relationship value.</div>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Chargebacks by Distribution Channel" subtitle="Where the cost is concentrated" tag="CHANNEL COST" className="mb-4">
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-11 gap-2">
          {(() => {
            const byChannel = {};
            filtered.forEach(o => {
              if (!byChannel[o.channel]) byChannel[o.channel] = { channel: o.channel, total: 0, chargeback: 0, delayed: 0 };
              byChannel[o.channel].total++;
              byChannel[o.channel].chargeback += o.chargeback;
              if (o.cause) byChannel[o.channel].delayed++;
            });
            const max = Math.max(...Object.values(byChannel).map(c => c.chargeback), 1);
            return CHANNELS.map(ch => {
              const c = byChannel[ch] || { channel: ch, total: 0, chargeback: 0, delayed: 0 };
              const group = getChannelGroup(ch);
              const color = getChannelColor(ch);
              return (
                <div key={ch} className="bg-[#1a2129] rounded border border-[#2d3744] p-2">
                  <div className="flex items-center gap-1 mb-1">
                    <div className="w-1.5 h-1.5 rounded-sm" style={{ background: color }}/>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[#8a95a3] truncate">{ch}</div>
                  </div>
                  <div className="font-mono text-sm font-semibold text-[#E74C6F]">${fmtNum(c.chargeback.toFixed(0))}</div>
                  <div className="font-mono text-[10px] text-[#5d6b7a]">{c.delayed}/{c.total} delayed</div>
                  <div className="mt-1 h-0.5 bg-[#0f1419] rounded overflow-hidden">
                    <div className="h-full" style={{ width: `${(c.chargeback/max)*100}%`, background: color }}/>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </SectionCard>

      <SectionCard title="Daily Chargeback Trend" subtitle="Stacked by category" tag="TREND">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={costs.trendList}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d3744"/>
            <XAxis dataKey="date" stroke="#5d6b7a" style={{ fontSize: 10, fontFamily: 'IBM Plex Mono' }}/>
            <YAxis stroke="#5d6b7a" style={{ fontSize: 10, fontFamily: 'IBM Plex Mono' }} tickFormatter={v => `$${v/1000}k`}/>
            <Tooltip contentStyle={{ background: '#1a2129', border: '1px solid #2d3744', fontSize: 11 }} formatter={v => `$${fmtNum(v.toFixed(0))}`}/>
            <Bar dataKey="delay" stackId="a" fill="url(#gradCerise)" name="Delay"/>
            <Bar dataKey="split" stackId="a" fill="url(#gradPersianBlue)" name="Split"/>
            <Bar dataKey="damage" stackId="a" fill="url(#gradTurquoise)" name="Damage"/>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex gap-4 justify-center text-[11px] font-mono mt-2">
          <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-[#E74C6F]"/><span className="text-[#8a95a3]">Delay Penalties</span></div>
          <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-[#2C3E9B]"/><span className="text-[#8a95a3]">Split Penalties</span></div>
          <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-[#1ABC9C]"/><span className="text-[#8a95a3]">Damage Claims</span></div>
        </div>
      </SectionCard>
    </>
  );
};

// ============================================================
// CUSTOMER IMPACT PAGE
// ============================================================
const CustomerImpactPage = ({ filtered }) => {
  const impact = useMemo(() => {
    const byCustomer = {};
    filtered.forEach(o => {
      if (!byCustomer[o.customer]) byCustomer[o.customer] = {
        customer: o.customer, tier: o.tier, total: 0, delayed: 0, split: 0,
        damaged: 0, value: 0, chargeback: 0, onTimeDeliv: 0, withDeliv: 0,
        channels: new Set()
      };
      const c = byCustomer[o.customer];
      c.total++;
      c.value += o.orderValue;
      c.chargeback += o.chargeback;
      c.channels.add(o.channel);
      if (o.cause) c.delayed++;
      if (o.isSplit) c.split++;
      if (o.cause === 'Damage') c.damaged++;
      if (o.onTimeDelivery !== null) {
        c.withDeliv++;
        if (o.onTimeDelivery) c.onTimeDeliv++;
      }
    });
    return Object.values(byCustomer).map(c => ({
      ...c,
      channelList: Array.from(c.channels),
      delayRate: c.total ? c.delayed/c.total : 0,
      splitRate: c.total ? c.split/c.total : 0,
      otdRate: c.withDeliv ? c.onTimeDeliv/c.withDeliv : 0,
      // Health score — 100 minus weighted penalties
      health: Math.max(0, 100 - (c.delayed/c.total*40 + c.split/c.total*30 + c.damaged/c.total*20)),
    })).sort((a,b) => a.health - b.health);
  }, [filtered]);

  const healthColor = (h) => h < 50 ? '#E74C6F' : h < 75 ? '#f5a623' : '#2ECC71';

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        <KPI label="Customers Tracked" value={impact.length} delta="Active in window" deltaType="neutral" icon={Users}/>
        <KPI label="Critical Health" value={impact.filter(c => c.health < 50).length} delta="Below 50% score" deltaType="bad" icon={AlertTriangle}/>
        <KPI label="Key Accts at Risk" value={impact.filter(c => c.tier === 'Key' && c.health < 75).length} delta="Escalation priority" deltaType="bad" icon={Zap}/>
        <KPI label="Best Performer" value={impact[impact.length-1]?.customer.slice(0,10) || '—'} delta={`${impact[impact.length-1]?.health.toFixed(0)} health`} deltaType="good" icon={CheckCircle2}/>
        <KPI label="Worst Performer" value={impact[0]?.customer.slice(0,10) || '—'} delta={`${impact[0]?.health.toFixed(0)} health`} deltaType="bad" icon={XCircle}/>
      </div>

      <SectionCard title="Customer Health Scorecard" subtitle="Ranked by composite health score (100 = perfect)" tag="SCORECARD">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[#5d6b7a] border-b border-[#2d3744] font-mono uppercase text-[11px] tracking-wider">
              <th className="py-2">Health</th>
              <th className="py-2">Customer</th>
              <th className="py-2">Tier</th>
              <th className="py-2">Channels</th>
              <th className="py-2 text-right">Shipments</th>
              <th className="py-2 text-right">Value</th>
              <th className="py-2 text-right">OTD%</th>
              <th className="py-2 text-right">Delay%</th>
              <th className="py-2 text-right">Split%</th>
              <th className="py-2 text-right">Chargeback</th>
            </tr>
          </thead>
          <tbody>
            {impact.map(c => (
              <tr key={c.customer} className="border-b border-[#2d3744] hover:bg-[#1a2129]">
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-1.5 bg-[#0f1419] rounded overflow-hidden">
                      <div className="h-full" style={{ width: `${c.health}%`, background: healthColor(c.health) }}/>
                    </div>
                    <span className="font-mono text-[11px]" style={{ color: healthColor(c.health) }}>{c.health.toFixed(0)}</span>
                  </div>
                </td>
                <td className="py-2">{c.customer}</td>
                <td className="py-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${c.tier === 'Key' ? 'bg-[#1ABC9C]/20 text-[#1ABC9C]' : c.tier === 'Growth' ? 'bg-[#2C3E9B]/20 text-[#2C3E9B]' : 'bg-[#8a95a3]/20 text-[#8a95a3]'}`}>{c.tier.toUpperCase()}</span>
                </td>
                <td className="py-2">
                  <div className="flex gap-0.5 flex-wrap">
                    {c.channelList.slice(0, 4).map(ch => {
                      const color = getChannelColor(ch);
                      return <span key={ch} className="text-[10px] font-mono px-1 py-0.5 rounded" style={{ background: color+'20', color: color }} title={ch}>{ch.replace('ECOM - ', '').replace('CS - ', 'CS-')}</span>;
                    })}
                    {c.channelList.length > 4 && <span className="text-[10px] font-mono text-[#5d6b7a]">+{c.channelList.length - 4}</span>}
                  </div>
                </td>
                <td className="py-2 font-mono text-right">{c.total}</td>
                <td className="py-2 font-mono text-right">${fmtNum(c.value.toFixed(0))}</td>
                <td className={`py-2 font-mono text-right ${c.otdRate < 0.85 ? 'text-[#E74C6F]' : 'text-[#2ECC71]'}`}>{fmtPct(c.otdRate)}</td>
                <td className={`py-2 font-mono text-right ${c.delayRate > 0.3 ? 'text-[#E74C6F]' : 'text-[#8a95a3]'}`}>{fmtPct(c.delayRate)}</td>
                <td className={`py-2 font-mono text-right ${c.splitRate > 0.15 ? 'text-[#E74C6F]' : 'text-[#8a95a3]'}`}>{fmtPct(c.splitRate)}</td>
                <td className="py-2 font-mono text-right text-[#E74C6F]">${fmtNum(c.chargeback.toFixed(0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </>
  );
};

// ============================================================
// SKU PROBLEMS PAGE
// ============================================================
const SKUProblemPage = ({ filtered }) => {
  const skuData = useMemo(() => {
    const bySku = {};
    filtered.forEach(o => {
      if (!bySku[o.primarySku]) bySku[o.primarySku] = {
        sku: o.primarySku, name: o.primarySkuName, category: o.skuCategory, fragile: o.skuFragile,
        total: 0, missing: 0, damage: 0, split: 0, delayed: 0, value: 0,
        channels: {},
      };
      const s = bySku[o.primarySku];
      s.total++;
      s.value += o.orderValue;
      s.channels[o.channel] = (s.channels[o.channel] || 0) + 1;
      if (o.cause === 'Missing') s.missing++;
      if (o.cause === 'Damage') s.damage++;
      if (o.isSplit) s.split++;
      if (o.cause) s.delayed++;
    });
    return Object.values(bySku).map(s => {
      const topCh = Object.entries(s.channels).sort((a,b) => b[1]-a[1])[0];
      return {
        ...s,
        missingRate: s.total ? s.missing/s.total : 0,
        damageRate: s.total ? s.damage/s.total : 0,
        splitRate: s.total ? s.split/s.total : 0,
        issueScore: (s.missing*3 + s.damage*2 + s.split)/s.total * 100,
        topChannel: topCh ? topCh[0] : null,
        channelCount: Object.keys(s.channels).length,
      };
    }).sort((a,b) => b.issueScore - a.issueScore);
  }, [filtered]);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <KPI label="SKUs Tracked" value={skuData.length} delta="Active in window" deltaType="neutral" icon={Layers}/>
        <KPI label="Problem SKUs" value={skuData.filter(s => s.issueScore > 20).length} delta="Score > 20" deltaType="bad" icon={AlertTriangle}/>
        <KPI label="Fragile + Issues" value={skuData.filter(s => s.fragile && s.damage > 0).length} delta="Packaging audit" deltaType="bad" icon={Package}/>
        <KPI label="Worst Offender" value={skuData[0]?.sku || '—'} delta={skuData[0]?.name || ''} deltaType="bad" icon={XCircle}/>
      </div>

      <SectionCard title="SKU Problem Ranking" subtitle="Composite issue score: missing (3x) + damage (2x) + split (1x)" tag="PARETO">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[#5d6b7a] border-b border-[#2d3744] font-mono uppercase text-[11px] tracking-wider">
              <th className="py-2">SKU</th>
              <th className="py-2">Name</th>
              <th className="py-2">Category</th>
              <th className="py-2 text-center">Fragile</th>
              <th className="py-2">Top Channel</th>
              <th className="py-2 text-right">Shipments</th>
              <th className="py-2 text-right">Missing%</th>
              <th className="py-2 text-right">Damage%</th>
              <th className="py-2 text-right">Split%</th>
              <th className="py-2 text-right">Score</th>
              <th className="py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {skuData.map(s => (
              <tr key={s.sku} className="border-b border-[#2d3744] hover:bg-[#1a2129]">
                <td className="py-2 font-mono">{s.sku}</td>
                <td className="py-2">{s.name}</td>
                <td className="py-2 text-[#8a95a3]">{s.category}</td>
                <td className="py-2 text-center">{s.fragile ? <span className="text-[#f5a623]">●</span> : <span className="text-[#5d6b7a]">—</span>}</td>
                <td className="py-2">
                  {s.topChannel ? (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: (getChannelColor(s.topChannel))+'20', color: getChannelColor(s.topChannel) }}>
                      {s.topChannel} {s.channelCount > 1 && <span className="opacity-60">+{s.channelCount-1}</span>}
                    </span>
                  ) : '—'}
                </td>
                <td className="py-2 font-mono text-right">{s.total}</td>
                <td className={`py-2 font-mono text-right ${s.missingRate > 0.15 ? 'text-[#2C3E9B]' : 'text-[#8a95a3]'}`}>{fmtPct(s.missingRate)}</td>
                <td className={`py-2 font-mono text-right ${s.damageRate > 0.1 ? 'text-[#1ABC9C]' : 'text-[#8a95a3]'}`}>{fmtPct(s.damageRate)}</td>
                <td className={`py-2 font-mono text-right ${s.splitRate > 0.2 ? 'text-[#E74C6F]' : 'text-[#8a95a3]'}`}>{fmtPct(s.splitRate)}</td>
                <td className="py-2 font-mono text-right font-semibold" style={{ color: s.issueScore > 30 ? '#E74C6F' : s.issueScore > 15 ? '#f5a623' : '#2ECC71' }}>{s.issueScore.toFixed(0)}</td>
                <td className="py-2 text-[11px] text-[#8a95a3]">
                  {s.missingRate > 0.15 && 'Cycle count · '}
                  {s.damageRate > 0.1 && 'Pack audit · '}
                  {s.splitRate > 0.2 && 'Allocation review'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </>
  );
};

// ============================================================
// SHIFT HEATMAP PAGE
// ============================================================
const ShiftHeatmapPage = ({ filtered }) => {
  const heatmap = useMemo(() => {
    // Build grid: rows = day-of-week, cols = hour
    const grid = {};
    for (let dow = 0; dow < 7; dow++) {
      grid[dow] = {};
      for (let h = 0; h < 24; h++) {
        grid[dow][h] = { total: 0, delayed: 0, value: 0 };
      }
    }
    filtered.forEach(o => {
      const dow = o.waveRelease.getDay();
      const h = o.waveRelease.getHours();
      grid[dow][h].total++;
      grid[dow][h].value += o.orderValue;
      if (o.cause) grid[dow][h].delayed++;
    });
    const cells = [];
    for (let dow = 0; dow < 7; dow++) {
      for (let h = 0; h < 24; h++) {
        const c = grid[dow][h];
        cells.push({ dow, hour: h, total: c.total, delayed: c.delayed, delayRate: c.total ? c.delayed/c.total : 0 });
      }
    }
    const maxDelayRate = Math.max(...cells.map(c => c.delayRate), 0.01);

    // Shift breakdown
    const shifts = {};
    filtered.forEach(o => {
      if (!shifts[o.shift]) shifts[o.shift] = { shift: o.shift, total: 0, delayed: 0 };
      shifts[o.shift].total++;
      if (o.cause) shifts[o.shift].delayed++;
    });
    const shiftList = Object.values(shifts).map(s => ({ ...s, delayRate: s.total ? s.delayed/s.total : 0 }));
    return { cells, maxDelayRate, shiftList };
  }, [filtered]);

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        {heatmap.shiftList.map(s => (
          <div key={s.shift} className="bg-[#232c37] border border-[#2d3744] rounded-md p-4">
            <div className="text-[11px] uppercase tracking-wider text-[#5d6b7a] font-mono">{s.shift}</div>
            <div className="font-mono text-2xl font-semibold mt-2">{s.total}</div>
            <div className="text-[12px] text-[#8a95a3] mt-0.5">{s.delayed} delayed · <span className={s.delayRate > 0.3 ? 'text-[#E74C6F]' : 'text-[#2ECC71]'}>{fmtPct(s.delayRate)}</span> rate</div>
            <div className="mt-2 h-1.5 bg-[#0f1419] rounded overflow-hidden">
              <div className="h-full" style={{ width: `${s.delayRate*100*2}%`, background: s.delayRate > 0.3 ? '#E74C6F' : '#2ECC71' }}/>
            </div>
          </div>
        ))}
      </div>

      <SectionCard title="Delay Rate Heatmap — Day × Hour" subtitle="When during the week are DC issues concentrated?" tag="HEATMAP">
        <div className="overflow-x-auto">
          <div className="inline-block">
            {/* Header row: hours */}
            <div className="flex gap-0.5 ml-10 mb-1">
              {Array.from({length: 24}, (_, h) => (
                <div key={h} className="w-6 text-center font-mono text-[10px] text-[#5d6b7a]">{h}</div>
              ))}
            </div>
            {[1,2,3,4,5,6,0].map(dow => (
              <div key={dow} className="flex gap-0.5 mb-0.5 items-center">
                <div className="w-10 font-mono text-[11px] text-[#5d6b7a] pr-1">{dayLabels[dow]}</div>
                {Array.from({length: 24}, (_, h) => {
                  const cell = heatmap.cells.find(c => c.dow === dow && c.hour === h);
                  const intensity = cell.delayRate / heatmap.maxDelayRate;
                  const bg = cell.total === 0 ? '#1a2129' : `rgba(239, 68, 68, ${0.1 + intensity * 0.9})`;
                  return (
                    <div key={h}
                      className="w-6 h-6 rounded-sm cursor-pointer group relative"
                      style={{ background: bg, border: cell.total > 0 ? '1px solid #2d3744' : 'none' }}
                      title={`${dayLabels[dow]} ${h}:00 — ${cell.delayed}/${cell.total} delays (${fmtPct(cell.delayRate)})`}>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4 font-mono text-[11px]">
          <span className="text-[#5d6b7a] uppercase tracking-wider">Less</span>
          <div className="flex items-center gap-0">
            {[0.1, 0.3, 0.5, 0.7, 0.9].map(v => (
              <div key={v} className="w-8 h-3 border border-[#2d3744]" style={{ background: `rgba(239, 68, 68, ${v})` }}/>
            ))}
          </div>
          <span className="text-[#5d6b7a] uppercase tracking-wider">More Delays</span>
          <span className="ml-auto text-[#8a95a3]">Max cell: {fmtPct(heatmap.maxDelayRate)}</span>
        </div>

        <div className="mt-4 bg-[#1a2129] rounded p-3 border-l-2 border-[#1ABC9C]">
          <div className="text-[11px] uppercase tracking-wider text-[#1ABC9C] font-mono mb-1">Insight</div>
          <div className="text-[13px]">
            Delay concentration suggests labor balancing opportunities. Peak problem windows (dark red cells) typically indicate wave release bottlenecks or staffing gaps. Review labor schedule vs wave plan for those hours.
          </div>
        </div>
      </SectionCard>

      {/* Channel × Shift matrix */}
      <div className="mt-4">
        <SectionCard title="Channel × Shift Matrix" subtitle="Delay rate for each channel by shift · reveals labor balance issues" tag="MATRIX">
          {(() => {
            const matrix = {};
            const shifts = ['1st (6a-2p)', '2nd (2p-10p)', '3rd (10p-6a)'];
            CHANNELS.forEach(ch => {
              matrix[ch] = {};
              shifts.forEach(sh => { matrix[ch][sh] = { total: 0, delayed: 0 }; });
            });
            filtered.forEach(o => {
              if (matrix[o.channel] && matrix[o.channel][o.shift]) {
                matrix[o.channel][o.shift].total++;
                if (o.cause) matrix[o.channel][o.shift].delayed++;
              }
            });
            return (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[#5d6b7a] border-b border-[#2d3744] font-mono uppercase text-[11px] tracking-wider">
                      <th className="py-2 w-40">Channel</th>
                      {shifts.map(sh => <th key={sh} className="py-2 text-center">{sh}</th>)}
                      <th className="py-2 text-right">Total Vol</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CHANNELS.map(ch => {
                      const chTotal = shifts.reduce((s, sh) => s + matrix[ch][sh].total, 0);
                      const group = getChannelGroup(ch);
                      const groupColor = getChannelColor(ch);
                      return (
                        <tr key={ch} className="border-b border-[#2d3744]">
                          <td className="py-2">
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: groupColor+'20', color: groupColor }}>{ch}</span>
                          </td>
                          {shifts.map(sh => {
                            const cell = matrix[ch][sh];
                            const rate = cell.total ? cell.delayed/cell.total : 0;
                            const bg = cell.total === 0 ? '#1a2129' : `rgba(239, 68, 68, ${0.1 + Math.min(rate*1.5, 0.9)})`;
                            return (
                              <td key={sh} className="py-2 text-center">
                                {cell.total > 0 ? (
                                  <div className="inline-flex flex-col items-center px-2 py-1 rounded" style={{ background: bg }}>
                                    <span className="font-mono text-[12px] font-semibold">{fmtPct(rate)}</span>
                                    <span className="font-mono text-[10px] text-[#c5ccd4]">{cell.delayed}/{cell.total}</span>
                                  </div>
                                ) : (
                                  <span className="text-[#5d6b7a] font-mono text-[11px]">—</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="py-2 font-mono text-right font-semibold">{chTotal}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
          <div className="mt-3 text-[12px] text-[#8a95a3]">
            Use this to spot whether specific channels are processed disproportionately on a problem shift. For example, ECOM picks routed to 3rd shift when pickers are light will show up as red cells.
          </div>
        </SectionCard>
      </div>
    </>
  );
};

// ============================================================
// SNOWFLAKE SETTINGS PAGE
// ============================================================
const SnowflakeSettingsPage = () => {
  const [sfConfig, setSfConfig] = useState({ ...SF_DEFAULTS });
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testHistory, setTestHistory] = useState([]);

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('http://localhost:3001/api/snowflake/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sfConfig),
      });
      const json = await res.json();
      const result = { ...json, testedAt: new Date().toISOString() };
      setTestResult(result);
      setTestHistory(prev => [result, ...prev].slice(0, 3));
    } catch (err) {
      const result = { success: false, message: err.message || 'Connection refused — is the API server running?', testedAt: new Date().toISOString() };
      setTestResult(result);
      setTestHistory(prev => [result, ...prev].slice(0, 3));
    } finally {
      setIsTesting(false);
    }
  };

  const inputStyle = {
    background: 'var(--bg-input, #0f1419)',
    border: '1px solid var(--border, #2d3744)',
    color: 'var(--text-primary, #e8ecef)',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 13,
    width: '100%',
    outline: 'none',
    fontFamily: 'IBM Plex Mono, monospace',
  };

  return (
    <div className="space-y-4">
      {/* Connection Configuration */}
      <SectionCard title="Connection Configuration" subtitle="Snowflake account settings — used for live data queries" tag="SNOWFLAKE">
        <div className="grid grid-cols-2 gap-4 mb-4">
          {[
            { key: 'account', label: 'Account Identifier' },
            { key: 'username', label: 'Username / UPN' },
            { key: 'warehouse', label: 'Warehouse' },
            { key: 'database', label: 'Database' },
            { key: 'schema', label: 'Schema' },
            { key: 'role', label: 'Role (optional)' },
          ].map(({ key, label }) => (
            <div key={key}>
              <div className="text-[11px] uppercase tracking-wider font-mono mb-1" style={{ color: 'var(--text-muted, #5d6b7a)' }}>{label}</div>
              <input
                style={inputStyle}
                value={sfConfig[key]}
                onChange={e => setSfConfig(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder={key === 'role' ? 'Leave blank for default' : SF_DEFAULTS[key]}
              />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mb-1">
          <div className="text-[11px] uppercase tracking-wider font-mono" style={{ color: 'var(--text-muted, #5d6b7a)' }}>Authentication</div>
          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold" style={{ background: '#1ABC9C20', color: '#1ABC9C', border: '1px solid #1ABC9C40' }}>
            Entra ID SSO (externalbrowser)
          </span>
        </div>
        <div className="text-[12px]" style={{ color: 'var(--text-secondary, #8a95a3)' }}>
          Authentication method is fixed to Entra ID SSO for this environment and cannot be changed here.
        </div>
      </SectionCard>

      {/* Test Connection */}
      <SectionCard title="Test Connection" subtitle="Verify connectivity to Snowflake with the current settings" tag="DIAGNOSTIC">
        <button
          onClick={handleTest}
          disabled={isTesting}
          className="flex items-center gap-2 px-4 py-2 rounded font-semibold text-[13px] transition-colors mb-4"
          style={{ background: isTesting ? '#2d3744' : '#1ABC9C', color: isTesting ? '#8a95a3' : '#0a0e12', cursor: isTesting ? 'not-allowed' : 'pointer' }}
        >
          {isTesting ? (
            <>
              <RefreshCw size={14} className="animate-spin"/>
              Connecting…
            </>
          ) : (
            <>
              <Database size={14}/>
              Test Connection
            </>
          )}
        </button>

        {testResult && (
          <div className="rounded-md p-3 mb-4" style={testResult.success
            ? { background: '#2ECC7115', border: '1px solid #2ECC7130', color: 'var(--text-primary, #e8ecef)' }
            : { background: '#E74C6F15', border: '1px solid #E74C6F30', color: 'var(--text-primary, #e8ecef)' }
          }>
            {testResult.success ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 size={14} className="text-[#2ECC71]"/>
                  <span className="font-semibold text-[13px] text-[#2ECC71]">Connected successfully</span>
                  {testResult.latencyMs != null && (
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ background: '#2ECC7120', color: '#2ECC71' }}>{testResult.latencyMs}ms</span>
                  )}
                </div>
                {testResult.details && (
                  <div className="grid grid-cols-3 gap-x-6 gap-y-1 text-[12px] font-mono">
                    {[
                      ['User', testResult.details.user],
                      ['Warehouse', testResult.details.warehouse],
                      ['Database', testResult.details.database],
                      ['Schema', testResult.details.schema],
                      ['Role', testResult.details.role],
                      ['Timestamp', testResult.details.timestamp ? new Date(testResult.details.timestamp).toLocaleTimeString() : '—'],
                    ].map(([k, v]) => (
                      <div key={k} className="flex gap-1">
                        <span style={{ color: 'var(--text-muted, #5d6b7a)' }}>{k}:</span>
                        <span style={{ color: 'var(--text-secondary, #8a95a3)' }}>{v || '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <XCircle size={14} className="text-[#E74C6F]"/>
                <span className="text-[13px] text-[#E74C6F] font-semibold">Connection failed</span>
                <span className="text-[12px]" style={{ color: 'var(--text-secondary, #8a95a3)' }}>{testResult.message}</span>
              </div>
            )}
          </div>
        )}

        {testHistory.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wider font-mono mb-2" style={{ color: 'var(--text-muted, #5d6b7a)' }}>Recent Tests</div>
            <div className="space-y-1">
              {testHistory.map((h, i) => (
                <div key={i} className="flex items-center gap-3 text-[12px] font-mono px-2 py-1.5 rounded" style={{ background: 'var(--bg-panel-alt, #232c37)' }}>
                  {h.success
                    ? <CheckCircle2 size={11} className="text-[#2ECC71] flex-shrink-0"/>
                    : <XCircle size={11} className="text-[#E74C6F] flex-shrink-0"/>
                  }
                  <span style={{ color: h.success ? '#2ECC71' : '#E74C6F' }}>{h.success ? 'OK' : 'FAIL'}</span>
                  {h.latencyMs != null && <span style={{ color: 'var(--text-secondary, #8a95a3)' }}>{h.latencyMs}ms</span>}
                  <span className="ml-auto" style={{ color: 'var(--text-muted, #5d6b7a)' }}>{new Date(h.testedAt).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      {/* Data Source Tables */}
      <SectionCard title="Data Source Tables" subtitle="Snowflake tables and views used by this application" tag="SCHEMA">
        <div className="space-y-3">
          {SF_TABLES.map(t => (
            <div key={t.table} className="rounded-md p-3" style={{ background: 'var(--bg-panel-alt, #232c37)', border: '1px solid var(--border, #2d3744)' }}>
              <div className="flex items-center gap-2 mb-1">
                <Database size={12} style={{ color: '#1ABC9C' }}/>
                <span className="text-[13px] font-mono font-semibold" style={{ color: '#1ABC9C' }}>{t.table}</span>
              </div>
              <div className="text-[12px] mb-1.5" style={{ color: 'var(--text-secondary, #8a95a3)' }}>{t.desc}</div>
              <div className="text-[11px] font-mono" style={{ color: 'var(--text-muted, #5d6b7a)' }}>Key columns: {t.columns}</div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
};

// ============================================================
// LOGIN PAGE
// ============================================================
const LoginPage = ({ onLogin, THEME, theme, setTheme }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    const user = MOCK_USERS.find(u => u.username === username && u.password === password);
    if (user) {
      onLogin(user);
    } else {
      setError('Invalid credentials');
    }
  };

  const quickLogin = (user) => onLogin(user);

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif", background: THEME.bgPrimary, color: THEME.textPrimary }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        body { background: ${THEME.bgPrimary}; }
      `}</style>

      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <img src="/kiss-logo.png" alt="KISS Beauty Group" style={{ height: 40 }}/>
          </div>
          <div className="text-xl font-semibold">Operations Intelligence</div>
          <div className="text-[12px] font-mono uppercase tracking-wider mt-1" style={{ color: THEME.textMuted }}>KDC · Savannah GA</div>
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="mt-3 p-2 rounded-full transition-colors" style={{ background: THEME.bgPanelAlt, border: `1px solid ${THEME.border}` }}>
            {theme === 'dark' ? <Sun size={14} style={{ color: THEME.textSecondary }}/> : <Moon size={14} style={{ color: THEME.textSecondary }}/>}
          </button>
        </div>

        <div className="rounded-lg p-6" style={{ background: THEME.bgPanel, border: `1px solid ${THEME.border}` }}>
          <div className="text-[12px] uppercase tracking-[0.08em] font-mono mb-4 flex items-center gap-2" style={{ color: THEME.textMuted }}>
            <Lock size={12}/> Sign In Required
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-[11px] uppercase tracking-wider font-mono" style={{ color: THEME.textMuted }}>Username</label>
              <input type="text" value={username} onChange={e => { setUsername(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                className="w-full mt-1 rounded px-3 py-2 text-[14px] outline-none" style={{ background: THEME.bgInput, border: `1px solid ${THEME.border}`, color: THEME.textPrimary }}/>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider font-mono" style={{ color: THEME.textMuted }}>Password</label>
              <input type="password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                className="w-full mt-1 rounded px-3 py-2 text-[14px] outline-none" style={{ background: THEME.bgInput, border: `1px solid ${THEME.border}`, color: THEME.textPrimary }}/>
            </div>
            {error && <div className="text-[12px] text-[#E74C6F] font-mono">⚠ {error}</div>}
            <button onClick={handleSubmit} className="w-full bg-[#1ABC9C] hover:bg-[#3d8de6] text-[#0a0e12] py-2.5 rounded font-semibold text-[14px] mt-2">
              Sign In
            </button>
          </div>

          <div className="mt-6 pt-4" style={{ borderTop: `1px solid ${THEME.border}` }}>
            <div className="text-[11px] uppercase tracking-wider font-mono mb-2" style={{ color: THEME.textMuted }}>Demo — Quick Login</div>
            <div className="space-y-1.5">
              {MOCK_USERS.map(u => {
                const role = ROLES[u.role];
                const Icon = role.icon;
                return (
                  <button key={u.username} onClick={() => quickLogin(u)}
                    className="w-full rounded px-3 py-2 flex items-center gap-3 hover:border-[#1ABC9C] transition-colors text-left" style={{ background: THEME.bgInput, border: `1px solid ${THEME.border}`, color: THEME.textPrimary }}>
                    <Icon size={16} style={{ color: role.color }}/>
                    <div className="flex-1">
                      <div className="text-[13px] font-semibold">{u.displayName}</div>
                      <div className="text-[11px] font-mono" style={{ color: THEME.textSecondary }}>{u.username} / {u.password}</div>
                    </div>
                    <div className="text-[11px] font-mono uppercase px-1.5 py-0.5 rounded" style={{ background: role.color+'20', color: role.color }}>{role.label}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="text-center mt-4 text-[11px] font-mono" style={{ color: THEME.textMuted }}>
          Prototype · Real deployment will use SSO / Okta
        </div>
      </div>
    </div>
  );
};

// ============================================================
// ADMIN — ACCESS CONTROL (RBAC) PAGE
// ============================================================
const AdminPortalPage = ({ currentUser }) => {
  const roleColors = { admin: '#E74C6F', manager: '#f5a623', viewer: '#1ABC9C' };
  const roleKeys = ['admin', 'manager', 'viewer'];

  // --- initial data builders ---
  const initUsers = () => MOCK_USERS.map(u => ({
    ...u,
    channels: u.role === 'admin' ? [...CHANNELS] :
              u.role === 'manager' ? ['CS - Bulk', 'CS - DSDC', 'BS-IVY', 'BS-RED', 'VIVACE', 'AST', 'ECOM - AMAZON 1P', 'ECOM - AMAZON 3P', 'ECOM - DTC'] :
              ['CS - Bulk', 'CS - DSDC'],
  }));

  const initialRoles = () => ({
    admin: { ...ROLES.admin, pages: [...ROLES.admin.pages] },
    manager: { ...ROLES.manager, pages: [...ROLES.manager.pages] },
    viewer: { ...ROLES.viewer, pages: [...ROLES.viewer.pages] },
  });

  // --- state ---
  const [editingUsers, setEditingUsers] = useState(initUsers);
  const [editingRoles, setEditingRoles] = useState(initialRoles);
  const [savedUsers, setSavedUsers] = useState(initUsers);
  const [savedRoles, setSavedRoles] = useState(initialRoles);
  const [selectedUser, setSelectedUser] = useState(() => MOCK_USERS[0]?.username || '');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', displayName: '', password: '', role: 'viewer', email: '', entraId: '', department: '', authMethod: 'entra' });
  const [saved, setSaved] = useState(false);

  const dirty = JSON.stringify(editingUsers) !== JSON.stringify(savedUsers) ||
    JSON.stringify(editingRoles) !== JSON.stringify(savedRoles);

  const selectedUserObj = editingUsers.find(u => u.username === selectedUser);

  // --- handlers ---
  const handleUserRoleChange = (username, newRole) => {
    setEditingUsers(prev => prev.map(u => {
      if (u.username !== username) return u;
      return { ...u, role: newRole, channels: newRole === 'admin' ? [...CHANNELS] : u.channels };
    }));
  };

  const handleChannelToggle = (username, channel) => {
    setEditingUsers(prev => prev.map(u => {
      if (u.username !== username || u.role === 'admin') return u;
      const has = u.channels.includes(channel);
      return { ...u, channels: has ? u.channels.filter(c => c !== channel) : [...u.channels, channel] };
    }));
  };

  const handleChannelBulk = (username, selectAll) => {
    setEditingUsers(prev => prev.map(u => {
      if (u.username !== username || u.role === 'admin') return u;
      return { ...u, channels: selectAll ? [...CHANNELS] : [] };
    }));
  };

  const handlePageToggle = (roleName, pageId) => {
    if (roleName === 'admin') return;
    setEditingRoles(prev => {
      const pages = prev[roleName].pages.includes(pageId)
        ? prev[roleName].pages.filter(p => p !== pageId)
        : [...prev[roleName].pages, pageId];
      return { ...prev, [roleName]: { ...prev[roleName], pages } };
    });
  };

  const handleFeatureToggle = (roleName, featureKey) => {
    if (roleName === 'admin') return;
    setEditingRoles(prev => ({
      ...prev,
      [roleName]: { ...prev[roleName], [featureKey]: !prev[roleName][featureKey] },
    }));
  };

  const handleCreateUser = () => {
    if (!newUser.displayName.trim()) return;
    const uname = newUser.username.trim() || newUser.email.split('@')[0] || newUser.displayName.toLowerCase().replace(/\s+/g, '.');
    if (editingUsers.some(u => u.username === uname)) return;
    const u = {
      username: uname,
      displayName: newUser.displayName.trim(),
      password: newUser.authMethod === 'local' ? (newUser.password || 'password123') : '',
      role: newUser.role,
      email: newUser.email.trim(),
      entraId: newUser.entraId.trim() || (newUser.email ? newUser.email.replace(/@.*/, '@kissusa.onmicrosoft.com') : ''),
      entraObjId: newUser.authMethod === 'entra' ? crypto.randomUUID() : '',
      department: newUser.department.trim(),
      authMethod: newUser.authMethod,
      channels: newUser.role === 'admin' ? [...CHANNELS] : [],
    };
    setEditingUsers(prev => [...prev, u]);
    setSelectedUser(u.username);
    setShowCreateForm(false);
    setNewUser({ username: '', displayName: '', password: '', role: 'viewer', email: '', entraId: '', department: '', authMethod: 'entra' });
  };

  const handleSave = () => {
    setSavedUsers(JSON.parse(JSON.stringify(editingUsers)));
    setSavedRoles(JSON.parse(JSON.stringify(editingRoles)));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleDiscard = () => {
    setEditingUsers(JSON.parse(JSON.stringify(savedUsers)));
    setEditingRoles(JSON.parse(JSON.stringify(savedRoles)));
  };

  // --- Toggle switch component ---
  const Toggle = ({ checked, onChange, disabled }) => (
    <button
      onClick={disabled ? undefined : onChange}
      className="relative inline-flex items-center rounded-full transition-colors"
      style={{
        width: 36, height: 20,
        background: disabled ? 'var(--border)' : checked ? '#1ABC9C' : 'var(--border)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        className="inline-block rounded-full bg-white transition-transform"
        style={{ width: 16, height: 16, transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
      />
    </button>
  );

  // --- render helpers ---
  const userRole = selectedUserObj ? editingRoles[selectedUserObj.role] : null;
  const isAdmin = selectedUserObj?.role === 'admin';
  const userPageCount = isAdmin ? ALL_PAGE_COUNT : (userRole?.pages?.length || 0);
  const userChannelCount = isAdmin ? CHANNELS.length : (selectedUserObj?.channels?.length || 0);

  return (
    <div className="space-y-4 pb-24">
      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPI label="Total Users" value={editingUsers.length} delta="Active accounts" deltaType="neutral" icon={Users}/>
        <KPI label="Roles Defined" value={3} delta="Admin, Manager, Viewer" deltaType="neutral" icon={Shield}/>
        <KPI label="Pages Available" value={ALL_PAGE_COUNT} delta="Dashboard tabs" deltaType="neutral" icon={Settings}/>
        <KPI label="Permissions" value={FEATURE_PERMISSIONS.length} delta="Feature flags" deltaType="neutral" icon={Lock}/>
      </div>

      {/* Main two-panel layout */}
      <div className="flex gap-4" style={{ minHeight: 600 }}>
        {/* A. User List Panel — left 1/3 */}
        <div className="w-1/3 flex flex-col gap-2">
          <div className="text-[11px] uppercase tracking-[0.08em] font-mono font-semibold" style={{ color: 'var(--text-muted)' }}>Users</div>
          <div className="flex-1 space-y-2 overflow-y-auto" style={{ maxHeight: 520 }}>
            {editingUsers.map(u => {
              const rc = roleColors[u.role];
              const isSelected = u.username === selectedUser;
              const channelCount = u.role === 'admin' ? CHANNELS.length : u.channels.length;
              return (
                <button
                  key={u.username}
                  onClick={() => setSelectedUser(u.username)}
                  className="w-full text-left rounded-lg p-3 transition-colors"
                  style={{
                    background: isSelected ? 'color-mix(in srgb, #1ABC9C 8%, var(--bg-panel-alt))' : 'var(--bg-panel-alt)',
                    border: isSelected ? '1px solid #1ABC9C' : '1px solid var(--border)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-[14px] font-bold flex-shrink-0"
                      style={{ background: rc, color: '#fff' }}>
                      {u.displayName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{u.displayName}</div>
                      <div className="text-[11px] font-mono truncate" style={{ color: 'var(--text-secondary)' }}>{u.email || u.username}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded" style={{ background: rc + '20', color: rc }}>{ROLES[u.role]?.label}</span>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-mono px-1 py-0.5 rounded" style={{ background: u.authMethod === 'entra' ? '#3b82f620' : '#8b5cf620', color: u.authMethod === 'entra' ? '#3b82f6' : '#8b5cf6' }}>{u.authMethod === 'entra' ? 'Entra ID' : 'Local'}</span>
                        <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{channelCount}/{CHANNELS.length}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Create User */}
          {showCreateForm ? (
            <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--bg-panel-alt)', border: '1px solid var(--border)' }}>
              <div className="text-[11px] uppercase tracking-wider font-mono font-semibold" style={{ color: 'var(--text-muted)' }}>New User</div>
              {/* Auth method toggle */}
              <div className="flex rounded overflow-hidden text-[11px] font-mono" style={{ border: '1px solid var(--border)' }}>
                <button onClick={() => setNewUser(p => ({ ...p, authMethod: 'entra' }))}
                  className="flex-1 py-1.5 text-center transition-colors"
                  style={{ background: newUser.authMethod === 'entra' ? '#3b82f6' : 'var(--bg-input)', color: newUser.authMethod === 'entra' ? '#fff' : 'var(--text-secondary)' }}>
                  Entra ID (SSO)
                </button>
                <button onClick={() => setNewUser(p => ({ ...p, authMethod: 'local' }))}
                  className="flex-1 py-1.5 text-center transition-colors"
                  style={{ background: newUser.authMethod === 'local' ? '#8b5cf6' : 'var(--bg-input)', color: newUser.authMethod === 'local' ? '#fff' : 'var(--text-secondary)' }}>
                  Local
                </button>
              </div>
              <input placeholder="Display Name *" value={newUser.displayName} onChange={e => setNewUser(p => ({ ...p, displayName: e.target.value }))}
                className="w-full rounded px-2.5 py-1.5 text-[12px] outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}/>
              <input placeholder="Email *" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))}
                className="w-full rounded px-2.5 py-1.5 text-[12px] outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}/>
              {newUser.authMethod === 'entra' && (
                <input placeholder="Entra UPN (auto-generated if blank)" value={newUser.entraId} onChange={e => setNewUser(p => ({ ...p, entraId: e.target.value }))}
                  className="w-full rounded px-2.5 py-1.5 text-[12px] outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}/>
              )}
              {newUser.authMethod === 'local' && (
                <input placeholder="Password" type="password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))}
                  className="w-full rounded px-2.5 py-1.5 text-[12px] outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}/>
              )}
              <input placeholder="Department" value={newUser.department} onChange={e => setNewUser(p => ({ ...p, department: e.target.value }))}
                className="w-full rounded px-2.5 py-1.5 text-[12px] outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}/>
              <select value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}
                className="w-full rounded px-2.5 py-1.5 text-[12px] font-mono outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                {roleKeys.map(r => <option key={r} value={r}>{ROLES[r].label}</option>)}
              </select>
              {newUser.authMethod === 'entra' && (
                <div className="rounded px-2.5 py-1.5 flex items-center gap-1.5" style={{ background: '#3b82f610', border: '1px solid #3b82f620' }}>
                  <Shield size={10} style={{ color: '#3b82f6' }}/>
                  <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>SSO via Microsoft Entra ID. No local password needed.</span>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={handleCreateUser} className="flex-1 py-1.5 rounded text-[12px] font-semibold bg-[#1ABC9C] text-[#0a0e12]">Create</button>
                <button onClick={() => setShowCreateForm(false)} className="flex-1 py-1.5 rounded text-[12px] font-medium" style={{ background: 'var(--border)', color: 'var(--text-primary)' }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowCreateForm(true)}
              className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-[12px] font-semibold transition-colors"
              style={{ background: 'var(--bg-panel-alt)', border: '1px dashed var(--border)', color: 'var(--text-secondary)' }}>
              <UserPlus size={14}/> Create User
            </button>
          )}
        </div>

        {/* B. User Detail Panel — right 2/3 */}
        <div className="w-2/3 rounded-lg p-5 overflow-y-auto" style={{ background: 'var(--bg-panel-alt)', border: '1px solid var(--border)', maxHeight: 620 }}>
          {selectedUserObj ? (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
                  style={{ background: roleColors[selectedUserObj.role], color: '#fff' }}>
                  {selectedUserObj.displayName.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedUserObj.displayName}</div>
                  <div className="text-[13px] font-mono" style={{ color: 'var(--text-secondary)' }}>{selectedUserObj.email || selectedUserObj.username}</div>
                  <div className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>{selectedUserObj.department || 'No department'}</div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <select
                    value={selectedUserObj.role}
                    onChange={e => handleUserRoleChange(selectedUserObj.username, e.target.value)}
                    className="rounded px-2.5 py-1.5 text-[12px] font-mono outline-none"
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: roleColors[selectedUserObj.role] }}>
                    {roleKeys.map(r => <option key={r} value={r}>{ROLES[r].label}</option>)}
                  </select>
                  <span className="px-2 py-0.5 rounded text-[11px] font-mono" style={{ background: '#2ECC7120', color: '#2ECC71' }}>Active</span>
                </div>
              </div>

              {/* Identity & Authentication */}
              <div>
                <div className="text-[13px] font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Identity & Authentication</div>
                <div className="rounded-md p-4" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded font-semibold" style={{ background: selectedUserObj.authMethod === 'entra' ? '#3b82f620' : '#8b5cf620', color: selectedUserObj.authMethod === 'entra' ? '#3b82f6' : '#8b5cf6' }}>
                      {selectedUserObj.authMethod === 'entra' ? '● Microsoft Entra ID (SSO)' : '● Local Authentication'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider font-mono mb-1" style={{ color: 'var(--text-muted)' }}>Email</div>
                      <div className="text-[12px] font-mono" style={{ color: 'var(--text-primary)' }}>{selectedUserObj.email || '—'}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider font-mono mb-1" style={{ color: 'var(--text-muted)' }}>Department</div>
                      <div className="text-[12px] font-mono" style={{ color: 'var(--text-primary)' }}>{selectedUserObj.department || '—'}</div>
                    </div>
                    {selectedUserObj.authMethod === 'entra' && (
                      <>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider font-mono mb-1" style={{ color: 'var(--text-muted)' }}>Entra UPN</div>
                          <div className="text-[12px] font-mono" style={{ color: 'var(--text-primary)' }}>{selectedUserObj.entraId || '—'}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider font-mono mb-1" style={{ color: 'var(--text-muted)' }}>Object ID</div>
                          <div className="text-[11px] font-mono truncate" style={{ color: 'var(--text-muted)' }}>{selectedUserObj.entraObjId || '—'}</div>
                        </div>
                      </>
                    )}
                  </div>
                  {selectedUserObj.authMethod === 'entra' && (
                    <div className="mt-3 rounded px-3 py-2 flex items-center gap-2" style={{ background: '#3b82f610', border: '1px solid #3b82f620' }}>
                      <Shield size={12} style={{ color: '#3b82f6' }}/>
                      <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Authenticated via Microsoft Entra ID. Password managed by Azure AD. MFA enforced by tenant policy.</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Channel Access */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Channel Access</div>
                    <div className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>Select which distribution channels this user can access</div>
                  </div>
                  <div className="text-[11px] font-mono font-semibold" style={{ color: '#1ABC9C' }}>{userChannelCount} of {CHANNELS.length} channels</div>
                </div>

                {isAdmin ? (
                  <div className="rounded-md px-4 py-3 flex items-center gap-2" style={{ background: roleColors.admin + '10', border: '1px solid ' + roleColors.admin + '30' }}>
                    <Shield size={14} style={{ color: roleColors.admin }}/>
                    <span className="text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>Full Access — Admins have access to all channels</span>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2 mb-3">
                      <button onClick={() => handleChannelBulk(selectedUserObj.username, true)} className="text-[11px] font-mono px-2.5 py-1 rounded" style={{ background: '#1ABC9C20', color: '#1ABC9C' }}>Select All</button>
                      <button onClick={() => handleChannelBulk(selectedUserObj.username, false)} className="text-[11px] font-mono px-2.5 py-1 rounded" style={{ background: '#E74C6F20', color: '#E74C6F' }}>Clear All</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {CHANNELS.map(channel => {
                        const group = getChannelGroup(channel);
                        const groupColor = getChannelColor(channel);
                        const checked = selectedUserObj.channels.includes(channel);
                        return (
                          <button
                            key={channel}
                            onClick={() => handleChannelToggle(selectedUserObj.username, channel)}
                            className="flex items-center gap-2.5 rounded-md p-2.5 text-left transition-colors"
                            style={{
                              background: 'var(--bg-input)',
                              border: '1px solid var(--border)',
                              borderLeft: checked ? `3px solid ${groupColor}` : '1px solid var(--border)',
                            }}
                          >
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: groupColor }}/>
                            <span className="text-[12px] flex-1" style={{ color: 'var(--text-primary)' }}>{channel}</span>
                            <Toggle checked={checked} onChange={() => handleChannelToggle(selectedUserObj.username, channel)}/>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* Page Access */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Page Access</div>
                    <div className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>Dashboard pages this user can view</div>
                  </div>
                  <div className="text-[11px] font-mono font-semibold" style={{ color: '#1ABC9C' }}>{userPageCount} of {ALL_PAGE_COUNT} pages</div>
                </div>

                {isAdmin ? (
                  <div className="rounded-md px-4 py-3 flex items-center gap-2" style={{ background: roleColors.admin + '10', border: '1px solid ' + roleColors.admin + '30' }}>
                    <Shield size={14} style={{ color: roleColors.admin }}/>
                    <span className="text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>Full Access — Admins have access to all pages</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {ALL_PAGES.map(group => (
                      <div key={group.category}>
                        <div className="text-[10px] uppercase tracking-wider font-mono font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>{group.category}</div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {group.pages.map(page => {
                            const checked = editingRoles[selectedUserObj.role].pages.includes(page.id);
                            return (
                              <button
                                key={page.id}
                                onClick={() => handlePageToggle(selectedUserObj.role, page.id)}
                                className="flex items-center justify-between rounded px-2.5 py-1.5 text-left transition-colors"
                                style={{
                                  background: checked ? '#1ABC9C10' : 'var(--bg-input)',
                                  border: checked ? '1px solid #1ABC9C40' : '1px solid var(--border)',
                                }}
                              >
                                <span className="text-[12px]" style={{ color: checked ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{page.label}</span>
                                <Toggle checked={checked} onChange={() => handlePageToggle(selectedUserObj.role, page.id)}/>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Feature Permissions */}
              <div>
                <div className="mb-3">
                  <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Feature Permissions</div>
                  <div className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>Sensitive actions this role can perform</div>
                </div>

                {isAdmin ? (
                  <div className="rounded-md px-4 py-3 flex items-center gap-2" style={{ background: roleColors.admin + '10', border: '1px solid ' + roleColors.admin + '30' }}>
                    <Shield size={14} style={{ color: roleColors.admin }}/>
                    <span className="text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>Full Access — Admins have all permissions</span>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {FEATURE_PERMISSIONS.map(perm => {
                      const checked = !!editingRoles[selectedUserObj.role][perm.key];
                      return (
                        <div
                          key={perm.key}
                          className="flex items-center justify-between rounded px-3 py-2"
                          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
                        >
                          <span className="text-[12px]" style={{ color: 'var(--text-primary)' }}>{perm.label}</span>
                          <Toggle checked={checked} onChange={() => handleFeatureToggle(selectedUserObj.role, perm.key)}/>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-[13px] font-mono" style={{ color: 'var(--text-muted)' }}>Select a user from the list</div>
            </div>
          )}
        </div>
      </div>

      {/* Audit Log */}
      <SectionCard title="Audit Log" subtitle="Recent access control changes" tag="COMPLIANCE">
        <div className="space-y-2">
          {MOCK_AUDIT_LOG.map((entry, i) => (
            <div key={i} className="flex items-start gap-3 py-2" style={{ borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#1ABC9C', marginTop: 6 }}/>
              <div className="flex-1">
                <div className="text-[13px]" style={{ color: 'var(--text-primary)' }}>{entry.message}</div>
                <div className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>{entry.user} · {entry.ago}</div>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Sticky Save/Discard Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-20 px-6 py-3 flex items-center justify-between"
        style={{ background: 'var(--bg-panel)', borderTop: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 text-[12px] font-mono" style={{ color: dirty ? '#f5a623' : 'var(--text-muted)' }}>
          {dirty ? (
            <><AlertTriangle size={13}/> Unsaved changes</>
          ) : saved ? (
            <><CheckCircle2 size={13} className="text-[#2ECC71]"/> <span className="text-[#2ECC71]">Changes saved</span></>
          ) : (
            <>No pending changes</>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleDiscard}
            disabled={!dirty}
            className="px-4 py-2 rounded text-[13px] font-medium transition-colors"
            style={{ background: 'var(--bg-panel-alt)', border: '1px solid var(--border)', color: dirty ? 'var(--text-primary)' : 'var(--text-muted)', cursor: dirty ? 'pointer' : 'not-allowed' }}
          >
            Discard Changes
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty}
            className="px-4 py-2 rounded text-[13px] font-semibold transition-colors flex items-center gap-1.5"
            style={{ background: dirty ? '#1ABC9C' : '#1ABC9C40', color: dirty ? '#0a0e12' : 'var(--text-muted)', cursor: dirty ? 'pointer' : 'not-allowed' }}
          >
            <Save size={13}/> Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// ADMIN — SLA CONFIG PAGE
// ============================================================
const AdminSLAPage = ({ channelSlas, setChannelSlas, kpiTargets, setKpiTargets, currentUser }) => {
  // selectedTab: 'default' | one of CHANNELS
  const [selectedTab, setSelectedTab] = useState('default');
  // editingMap: local copy of channelSlas being edited
  const [editingMap, setEditingMap] = useState(() => JSON.parse(JSON.stringify(channelSlas)));
  const [editingKpis, setEditingKpis] = useState(kpiTargets);
  const [auditLog, setAuditLog] = useState([
    { ts: new Date(Date.now() - 86400000*3), user: 'admin', channel: 'default', action: 'Updated Stage 4 (Wave/Alloc) target from 180m to 240m', reason: 'Account for increased pick complexity on holiday volume' },
    { ts: new Date(Date.now() - 86400000*7), user: 'admin', channel: 'default', action: 'Updated KPI Target: On-Time Ship from 90% to 95%', reason: 'Board-approved stretch goal for FY26' },
  ]);
  const [saved, setSaved] = useState(false);

  // Current tab's SLA array for editing
  const currentSlas = editingMap[selectedTab] || editingMap.default;
  const hasOverride = selectedTab !== 'default' && !!editingMap[selectedTab];
  const overrideCount = Object.keys(editingMap).filter(k => k !== 'default').length;

  const dirty = useMemo(() => {
    return JSON.stringify(editingMap) !== JSON.stringify(channelSlas) || JSON.stringify(editingKpis) !== JSON.stringify(kpiTargets);
  }, [editingMap, channelSlas, editingKpis, kpiTargets]);

  const updateStage = (id, field, value) => {
    setEditingMap(prev => ({
      ...prev,
      [selectedTab]: (prev[selectedTab] || prev.default).map(s =>
        s.id === id ? { ...s, [field]: field === 'target' ? parseInt(value) || 0 : value } : s
      ),
    }));
  };

  const updateKpi = (key, value) => {
    setEditingKpis({ ...editingKpis, [key]: parseFloat(value) || 0 });
  };

  const createOverride = () => {
    setEditingMap(prev => ({
      ...prev,
      [selectedTab]: JSON.parse(JSON.stringify(prev.default)),
    }));
  };

  const removeOverride = () => {
    if (confirm(`Remove custom SLA override for "${selectedTab}"? It will revert to Default targets.`)) {
      setEditingMap(prev => {
        const next = { ...prev };
        delete next[selectedTab];
        return next;
      });
    }
  };

  const handleSave = () => {
    const newEntries = [];
    // Diff each channel SLA set
    Object.keys(editingMap).forEach(ch => {
      const editList = editingMap[ch];
      const origList = channelSlas[ch];
      if (!origList) {
        newEntries.push({ ts: new Date(), user: currentUser.username, channel: ch, action: `Created channel override for ${ch}`, reason: 'Manual override' });
        return;
      }
      editList.forEach(s => {
        const orig = origList.find(o => o.id === s.id);
        if (orig && orig.target !== s.target) {
          newEntries.push({
            ts: new Date(), user: currentUser.username, channel: ch,
            action: `[${ch === 'default' ? 'Default' : ch}] Updated ${s.name} target from ${orig.target}m to ${s.target}m`,
            reason: 'Manual adjustment',
          });
        }
      });
    });
    // Detect removed overrides
    Object.keys(channelSlas).forEach(ch => {
      if (ch !== 'default' && !editingMap[ch]) {
        newEntries.push({ ts: new Date(), user: currentUser.username, channel: ch, action: `Removed channel override for ${ch} (reverts to Default)`, reason: 'Manual removal' });
      }
    });
    // KPI diffs
    Object.keys(editingKpis).forEach(k => {
      if (kpiTargets[k] !== editingKpis[k]) {
        newEntries.push({
          ts: new Date(), user: currentUser.username, channel: 'global',
          action: `Updated KPI Target: ${k} from ${kpiTargets[k]} to ${editingKpis[k]}`,
          reason: 'Manual adjustment',
        });
      }
    });
    if (newEntries.length > 0) setAuditLog([...newEntries, ...auditLog]);
    setChannelSlas(editingMap);
    setKpiTargets(editingKpis);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = () => {
    setEditingMap(JSON.parse(JSON.stringify(channelSlas)));
    setEditingKpis(kpiTargets);
  };

  const handleFactoryReset = () => {
    if (confirm('Reset all SLAs (all channels) and KPI targets to factory defaults? This cannot be undone.')) {
      setEditingMap({ default: DEFAULT_SLAS });
      setEditingKpis(DEFAULT_KPI_TARGETS);
    }
  };

  const totalCycleTarget = currentSlas.reduce((s, x) => s + x.target, 0);

  // Tab list: default + all CHANNELS
  const tabs = ['default', ...CHANNELS];

  return (
    <>
      {/* Admin banner */}
      <div className="bg-gradient-to-r from-[#E74C6F]/15 to-transparent border-l-2 border-[#E74C6F] rounded p-3 mb-4 flex items-center gap-3">
        <Shield size={18} className="text-[#E74C6F]"/>
        <div className="flex-1">
          <div className="text-[12px] text-[#E74C6F] font-semibold uppercase tracking-wider">Admin Zone — SLA Configuration</div>
          <div className="text-[12px] text-[#c5ccd4] mt-0.5">Changes apply immediately to all dashboards and the AI risk model. All edits are logged.</div>
        </div>
        {dirty && (
          <div className="text-[11px] font-mono px-2 py-1 rounded bg-[#f5a623]/20 text-[#f5a623] border border-[#f5a623]/30 uppercase tracking-wider">
            Unsaved Changes
          </div>
        )}
        {saved && (
          <div className="text-[11px] font-mono px-2 py-1 rounded bg-[#2ECC71]/20 text-[#2ECC71] border border-[#2ECC71]/30 uppercase tracking-wider flex items-center gap-1">
            <CheckCircle2 size={11}/> Saved
          </div>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <KPI label="Stages Configured" value={currentSlas.length} delta="All lifecycle stages" deltaType="neutral" icon={Settings}/>
        <KPI label="Total Cycle Target" value={totalCycleTarget} unit="min" delta={`${(totalCycleTarget/60).toFixed(1)} hrs end-to-end`} deltaType="neutral" icon={Clock}/>
        <KPI label="Channel Overrides" value={overrideCount} delta={`${CHANNELS.length - overrideCount} using default`} deltaType="neutral" icon={Activity}/>
        <KPI label="Audit Log Entries" value={auditLog.length} delta="Change history" deltaType="neutral" icon={Database}/>
      </div>

      {/* Override summary strip */}
      <div className="bg-[#1a2129] border border-[#2d3744] rounded-md p-3 mb-4 flex items-center gap-3 flex-wrap">
        <div className="text-[11px] uppercase tracking-wider text-[#5d6b7a] font-mono shrink-0">Channel Overrides:</div>
        {CHANNELS.map(ch => {
          const grp = getChannelGroup(ch);
          const color = getChannelColor(ch);
          const hasOv = !!editingMap[ch];
          return (
            <div key={ch} className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono border"
              style={{ borderColor: hasOv ? color+'60' : '#2d3744', background: hasOv ? color+'15' : 'transparent', color: hasOv ? color : '#5d6b7a' }}>
              {hasOv && <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }}/>}
              {ch}
            </div>
          );
        })}
        <div className="ml-auto text-[11px] text-[#5d6b7a] font-mono">{overrideCount} custom · {CHANNELS.length - overrideCount} default</div>
      </div>

      {/* Channel tab selector */}
      <div className="flex items-center gap-1 mb-4 flex-wrap">
        {tabs.map(tab => {
          const isDefault = tab === 'default';
          const grp = isDefault ? null : getChannelGroup(tab);
          const color = isDefault ? '#1ABC9C' : getChannelColor(tab);
          const hasOv = !isDefault && !!editingMap[tab];
          const active = selectedTab === tab;
          return (
            <button key={tab} onClick={() => setSelectedTab(tab)}
              className="px-3 py-1.5 rounded text-[12px] font-mono font-semibold transition-colors flex items-center gap-1.5"
              style={{
                background: active ? color + '25' : 'transparent',
                color: active ? color : '#8a95a3',
                border: `1px solid ${active ? color + '60' : '#2d3744'}`,
              }}>
              {isDefault ? 'Default (Fallback)' : tab}
              {hasOv && (
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }}/>
              )}
            </button>
          );
        })}
      </div>

      {/* Channel override notice / create button */}
      {selectedTab !== 'default' && !hasOverride && (
        <div className="bg-[#232c37] border border-[#2d3744] rounded-md p-4 mb-4 flex items-center gap-4">
          <div className="flex-1">
            <div className="text-[13px] font-semibold text-[#e8ecef]">{selectedTab} — Using Default SLA Targets</div>
            <div className="text-[12px] text-[#8a95a3] mt-1">
              This channel inherits the Default (Fallback) targets. Create a channel override to set custom per-stage targets for {selectedTab}.
            </div>
          </div>
          <button onClick={createOverride}
            className="px-4 py-2 rounded font-semibold text-[13px] bg-[#1ABC9C] text-[#0a0e12] hover:bg-[#3d8de6] flex items-center gap-2 shrink-0">
            <Settings size={13}/> Create Override from Default
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        {/* STAGE SLAs */}
        <SectionCard
          title={selectedTab === 'default' ? 'Default SLA Targets (Fallback)' : `${selectedTab} — SLA Targets`}
          subtitle={selectedTab === 'default'
            ? 'Applied to all channels without a custom override · affects bottleneck detection and breach %'
            : hasOverride
              ? `Custom targets for ${selectedTab} · overrides Default for this channel`
              : `Showing Default targets (read-only) · create an override to customize`}
          tag="ADMIN ONLY"
          className="col-span-3">

          {/* Remove override button (only for channel tabs with override) */}
          {selectedTab !== 'default' && hasOverride && (
            <div className="flex justify-end mb-3">
              <button onClick={removeOverride}
                className="px-3 py-1 rounded text-[12px] font-mono border border-[#E74C6F]/40 text-[#E74C6F] hover:bg-[#E74C6F]/10 flex items-center gap-1.5">
                <RotateCcw size={11}/> Remove Override (use default)
              </button>
            </div>
          )}

          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[#5d6b7a] border-b border-[#2d3744] font-mono uppercase text-[11px] tracking-wider">
                <th className="py-2">Stage</th>
                <th className="py-2">System</th>
                <th className="py-2 text-right">Target (min)</th>
                <th className="py-2 text-right">Range</th>
                <th className="py-2">Description</th>
              </tr>
            </thead>
            <tbody>
              {currentSlas.map(s => {
                // Compare against saved value for this tab (or default if no override)
                const savedList = channelSlas[selectedTab] || channelSlas.default;
                const orig = savedList.find(o => o.id === s.id);
                const changed = orig && orig.target !== s.target;
                const editable = selectedTab === 'default' || hasOverride;
                return (
                  <tr key={s.id} className="border-b border-[#2d3744]">
                    <td className="py-2 font-semibold">{s.name}</td>
                    <td className="py-2 font-mono text-[#8a95a3]">{s.system}</td>
                    <td className="py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {changed && <div className="w-1.5 h-1.5 rounded-full bg-[#f5a623]" title="Unsaved change"/>}
                        <input type="number" value={s.target} min={s.min} max={s.max}
                          disabled={!editable}
                          onChange={e => updateStage(s.id, 'target', e.target.value)}
                          className={`w-20 bg-[#0f1419] border ${changed ? 'border-[#f5a623]' : 'border-[#2d3744]'} rounded px-2 py-1 text-right font-mono text-[13px] focus:border-[#1ABC9C] outline-none ${!editable ? 'opacity-40 cursor-not-allowed' : ''}`}/>
                      </div>
                    </td>
                    <td className="py-2 font-mono text-right text-[#8a95a3] text-[11px]">{s.min}–{s.max}m</td>
                    <td className="py-2 text-[#8a95a3] text-[11px]">{s.description}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-[#2d3744]">
                <td colSpan="2" className="py-3 font-semibold">Total End-to-End Cycle Target</td>
                <td className="py-3 text-right font-mono text-[#1ABC9C] font-semibold">{totalCycleTarget}m</td>
                <td className="py-3 text-right font-mono text-[#8a95a3] text-[11px]">= {(totalCycleTarget/60).toFixed(1)} hrs</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </SectionCard>

        {/* KPI TARGETS (always global) */}
        <SectionCard title="Executive KPI Targets" subtitle="Global goals — not per-channel" tag="ADMIN ONLY" className="col-span-2">
          <div className="space-y-3">
            {[
              { key: 'onTimeShipPct', label: 'On-Time Ship %', unit: '%', max: 100, step: 0.5, desc: 'Target ship confirm ≤ promise' },
              { key: 'onTimeDelivPct', label: 'On-Time Delivery %', unit: '%', max: 100, step: 0.5, desc: 'UPS POD ≤ promise delivery' },
              { key: 'orderToDockHrs', label: 'Order → Dock Cycle', unit: 'hrs', max: 72, step: 1, desc: 'End-to-end processing time' },
              { key: 'splitRatePct', label: 'Split Rate', unit: '%', max: 20, step: 0.1, desc: 'Hard requirement: 0.0%' },
              { key: 'damageRatePct', label: 'Damage Rate', unit: '%', max: 20, step: 0.1, desc: 'Shipment damage ceiling' },
            ].map(t => {
              const changed = kpiTargets[t.key] !== editingKpis[t.key];
              return (
                <div key={t.key}>
                  <div className="flex justify-between items-center mb-1">
                    <div>
                      <span className="text-[12px] font-semibold">{t.label}</span>
                      <span className="text-[11px] text-[#5d6b7a] ml-2 font-mono">{t.desc}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {changed && <div className="w-1.5 h-1.5 rounded-full bg-[#f5a623]"/>}
                      <input type="number" step={t.step} min={0} max={t.max}
                        value={editingKpis[t.key]}
                        onChange={e => updateKpi(t.key, e.target.value)}
                        className={`w-20 bg-[#0f1419] border ${changed ? 'border-[#f5a623]' : 'border-[#2d3744]'} rounded px-2 py-1 text-right font-mono text-[12px] focus:border-[#1ABC9C] outline-none`}/>
                      <span className="text-[11px] text-[#5d6b7a] font-mono w-6">{t.unit}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 mb-4">
        <button onClick={handleSave} disabled={!dirty}
          className={`px-4 py-2 rounded font-semibold text-[13px] flex items-center gap-2 ${dirty ? 'bg-[#1ABC9C] text-[#0a0e12] hover:bg-[#3d8de6]' : 'bg-[#232c37] text-[#5d6b7a] cursor-not-allowed'}`}>
          <Save size={13}/> Save Changes
        </button>
        <button onClick={handleReset} disabled={!dirty}
          className={`px-4 py-2 rounded font-semibold text-[13px] flex items-center gap-2 border ${dirty ? 'border-[#2d3744] text-[#e8ecef] hover:border-[#1ABC9C]' : 'border-[#2d3744] text-[#5d6b7a] cursor-not-allowed'}`}>
          <RotateCcw size={13}/> Discard
        </button>
        <button onClick={handleFactoryReset} className="ml-auto px-4 py-2 rounded font-semibold text-[13px] flex items-center gap-2 border border-[#E74C6F]/40 text-[#E74C6F] hover:bg-[#E74C6F]/10">
          <AlertTriangle size={13}/> Factory Reset All
        </button>
      </div>

      {/* Audit log */}
      <SectionCard title="Change Audit Log" subtitle="All SLA and KPI target changes are logged with user, channel, timestamp, and reason" tag="COMPLIANCE">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[#5d6b7a] border-b border-[#2d3744] font-mono uppercase text-[11px] tracking-wider">
              <th className="py-2">Timestamp</th>
              <th className="py-2">User</th>
              <th className="py-2">Channel</th>
              <th className="py-2">Change</th>
              <th className="py-2">Reason / Notes</th>
            </tr>
          </thead>
          <tbody>
            {auditLog.slice(0, 15).map((a, i) => {
              const grp = a.channel && a.channel !== 'default' && a.channel !== 'global' ? getChannelGroup(a.channel) : null;
              const color = grp ? getChannelColor(a.channel) : '#5d6b7a';
              return (
                <tr key={i} className="border-b border-[#2d3744]">
                  <td className="py-2 font-mono text-[11px] text-[#8a95a3]">{a.ts.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="py-2 font-mono">{a.user}</td>
                  <td className="py-2">
                    <span className="px-1.5 py-0.5 rounded text-[11px] font-mono" style={{ background: color+'20', color }}>
                      {a.channel || 'default'}
                    </span>
                  </td>
                  <td className="py-2">{a.action}</td>
                  <td className="py-2 text-[#8a95a3] text-[11px]">{a.reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </SectionCard>
    </>
  );
};

// ============================================================
// ACCESS DENIED (for pages outside role permission)
// ============================================================
const AccessDenied = ({ currentUser, page }) => {
  const role = ROLES[currentUser.role];
  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 rounded-full bg-[#E74C6F]/20 flex items-center justify-center mx-auto mb-4">
          <Lock size={24} className="text-[#E74C6F]"/>
        </div>
        <div className="text-lg font-semibold">Access Restricted</div>
        <div className="text-[13px] text-[#8a95a3] mt-2">
          Your role (<span className="font-mono text-[#e8ecef]">{role.label}</span>) does not have permission to view this page.
        </div>
        <div className="text-[12px] text-[#5d6b7a] mt-1">
          Contact your administrator if you need access.
        </div>
      </div>
    </div>
  );
};

// ============================================================
// INBOUND PAGE
// ============================================================
const InboundPage = () => {
  const activeDocks = MOCK_DOCKS.filter(d => d.status === 'UNLOADING' || d.status === 'LOADING').length;
  const totalReceived = MOCK_RECEIVING_QUEUE.reduce((s, r) => s + r.receivedQty, 0);
  const totalExpected = MOCK_RECEIVING_QUEUE.reduce((s, r) => s + r.expectedQty, 0);
  const recvAccuracy = totalExpected ? ((1 - Math.abs(totalReceived - totalExpected) / totalExpected) * 100).toFixed(1) : '100.0';

  const statusColors = { AVAILABLE: '#2ECC71', UNLOADING: '#1ABC9C', LOADING: '#f5a623', SCHEDULED: '#8a95a3', MAINTENANCE: '#E74C6F' };

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <KPI label="Active Docks" value={activeDocks} delta={`of ${MOCK_DOCKS.length} total`} deltaType="neutral" icon={Anchor}/>
        <KPI label="Receiving Accuracy" value={recvAccuracy} unit="%" delta="vs expected qty" deltaType="good" icon={CheckCircle2}/>
        <KPI label="Dock-to-Stock" value="2.4" unit="hrs" delta="Avg today" deltaType="neutral" icon={Clock}/>
        <KPI label="Truck TAT" value="1.8" unit="hrs" delta="Avg turnaround" deltaType="good" icon={Truck}/>
      </div>

      <SectionCard title="Dock Door Grid" subtitle="Real-time door status" tag="LIVE" className="mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {MOCK_DOCKS.map(d => (
            <div key={d.doorId} className="bg-[#232c37] border border-[#2d3744] rounded-md p-3 hover:border-[#1ABC9C] transition-colors">
              <div className="flex items-center justify-between mb-2">
                <div className="font-mono text-[13px] font-semibold">{d.doorId}</div>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full uppercase font-mono tracking-wider" style={{ background: statusColors[d.status]+'20', color: statusColors[d.status] }}>{d.status}</span>
              </div>
              <div className="text-[12px] text-[#8a95a3]">{d.carrier}</div>
              <div className="text-[11px] font-mono text-[#5d6b7a]">{d.trailer}</div>
              {d.arrival && <div className="text-[11px] font-mono text-[#5d6b7a] mt-1">Arrived {d.arrival.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>}
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Receiving Queue" subtitle={`${MOCK_RECEIVING_QUEUE.length} pending receipts`} tag="QUEUE">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[#5d6b7a] border-b border-[#2d3744] font-mono uppercase text-[11px] tracking-wider">
              <th className="py-2">Receipt ID</th>
              <th className="py-2">Shipment</th>
              <th className="py-2">SKU</th>
              <th className="py-2">Dock</th>
              <th className="py-2 text-right">Expected</th>
              <th className="py-2 text-right">Received</th>
              <th className="py-2">Discrepancy</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_RECEIVING_QUEUE.map(r => (
              <tr key={r.receiptId} className="border-b border-[#2d3744] hover:bg-[#1a2129]">
                <td className="py-2 font-mono">{r.receiptId}</td>
                <td className="py-2 font-mono text-[#8a95a3]">{r.shipmentId}</td>
                <td className="py-2 font-mono">{r.sku}</td>
                <td className="py-2 font-mono text-[#8a95a3]">{r.dock}</td>
                <td className="py-2 font-mono text-right">{r.expectedQty}</td>
                <td className="py-2 font-mono text-right">{r.receivedQty}</td>
                <td className="py-2">
                  {r.discrepancy ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full uppercase font-mono tracking-wider" style={{
                      background: (r.discrepancy === 'DAMAGE' ? '#E74C6F' : r.discrepancy === 'SHORTAGE' ? '#f5a623' : '#2C3E9B')+'20',
                      color: r.discrepancy === 'DAMAGE' ? '#E74C6F' : r.discrepancy === 'SHORTAGE' ? '#f5a623' : '#2C3E9B',
                    }}>{r.discrepancy}</span>
                  ) : <span className="text-[#5d6b7a] font-mono text-[11px]">OK</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </>
  );
};

// ============================================================
// STORAGE PAGE
// ============================================================
const StoragePage = () => {
  const avgUtil = (MOCK_ZONES.reduce((s, z) => s + z.utilization, 0) / MOCK_ZONES.length).toFixed(1);
  const activeZones = MOCK_ZONES.filter(z => z.occupiedLocations > 0).length;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <KPI label="Avg Utilization" value={avgUtil} unit="%" delta="Across all zones" deltaType="neutral" icon={Warehouse}/>
        <KPI label="Active Zones" value={activeZones} delta={`of ${MOCK_ZONES.length} total`} deltaType="neutral" icon={Layers}/>
        <KPI label="Inventory Accuracy" value="99.2" unit="%" delta="Last cycle count" deltaType="good" icon={CheckCircle2}/>
        <KPI label="Replen Cycle" value="45" unit="min" delta="Avg replenishment" deltaType="neutral" icon={Clock}/>
      </div>

      <SectionCard title="Zone Utilization" subtitle="Capacity by storage zone" tag="ZONES">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {MOCK_ZONES.map(z => {
            const barColor = z.utilization > 85 ? '#E74C6F' : z.utilization > 70 ? '#f5a623' : '#2ECC71';
            return (
              <div key={z.zone} className="bg-[#232c37] border border-[#2d3744] rounded-md p-3 hover:border-[#1ABC9C] transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[13px] font-semibold">{z.zone}</div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full uppercase font-mono tracking-wider" style={{
                    background: (z.alertLevel === 'CRITICAL' ? '#E74C6F' : z.alertLevel === 'WARNING' ? '#f5a623' : '#2ECC71')+'20',
                    color: z.alertLevel === 'CRITICAL' ? '#E74C6F' : z.alertLevel === 'WARNING' ? '#f5a623' : '#2ECC71',
                  }}>{z.alertLevel}</span>
                </div>
                <div className="text-[12px] text-[#8a95a3] mb-2">{z.occupiedLocations} / {z.totalLocations} locations</div>
                <div className="h-1.5 rounded-full bg-[#232c37] overflow-hidden" style={{ background: '#0f1419' }}>
                  <div className="h-full rounded-full" style={{ width: `${z.utilization}%`, background: barColor }}/>
                </div>
                <div className="font-mono text-[12px] mt-1" style={{ color: barColor }}>{z.utilization}%</div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </>
  );
};

// ============================================================
// LABOR PAGE
// ============================================================
const LaborPage = () => {
  const totalHC = MOCK_LABOR.reduce((s, l) => s + l.headcount, 0);
  const avgProd = Math.round(MOCK_LABOR.reduce((s, l) => s + l.avgProductivity, 0) / MOCK_LABOR.length);
  const avgUtil = (MOCK_LABOR.reduce((s, l) => s + l.utilization, 0) / MOCK_LABOR.length).toFixed(1);
  const activeZones = MOCK_LABOR.filter(l => l.headcount > 0).length;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <KPI label="Total Headcount" value={totalHC} delta={`${MOCK_LABOR.reduce((s,l)=>s+l.planned,0)} planned`} deltaType="neutral" icon={HardHat}/>
        <KPI label="Avg Productivity" value={avgProd} unit="u/hr" delta="Units per hour" deltaType="neutral" icon={Activity}/>
        <KPI label="Avg Utilization" value={avgUtil} unit="%" delta="Across zones" deltaType="neutral" icon={Zap}/>
        <KPI label="Zones Active" value={activeZones} delta={`of ${MOCK_LABOR.length}`} deltaType="neutral" icon={Layers}/>
      </div>

      <SectionCard title="Labor by Zone" subtitle="Headcount, productivity, utilization" tag="WORKFORCE">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {MOCK_LABOR.map(l => {
            const hcMet = l.headcount >= l.planned;
            const prodPct = Math.min((l.avgProductivity / l.targetProductivity) * 100, 100);
            return (
              <div key={l.zone} className="bg-[#232c37] border border-[#2d3744] rounded-md p-3 hover:border-[#1ABC9C] transition-colors">
                <div className="text-[13px] font-semibold mb-2">{l.zone}</div>
                <div className="flex items-center justify-between text-[12px] mb-1">
                  <span className="text-[#8a95a3]">Headcount</span>
                  <span className="font-mono" style={{ color: hcMet ? '#2ECC71' : '#E74C6F' }}>{l.headcount} / {l.planned}</span>
                </div>
                <div className="flex items-center justify-between text-[12px] mb-1">
                  <span className="text-[#8a95a3]">Productivity</span>
                  <span className="font-mono">{l.avgProductivity} / {l.targetProductivity} u/hr</span>
                </div>
                <div className="h-1.5 rounded-full bg-[#0f1419] overflow-hidden mb-1">
                  <div className="h-full rounded-full" style={{ width: `${prodPct}%`, background: prodPct >= 100 ? '#2ECC71' : prodPct >= 80 ? '#f5a623' : '#E74C6F' }}/>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-[#8a95a3]">Utilization</span>
                  <span className="font-mono">{l.utilization}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-[#0f1419] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${l.utilization}%`, background: l.utilization >= 85 ? '#2ECC71' : l.utilization >= 70 ? '#f5a623' : '#E74C6F' }}/>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </>
  );
};

// ============================================================
// WAVES PAGE
// ============================================================
const WavesPage = () => {
  const inProgress = MOCK_WAVES.filter(w => w.status === 'IN_PROGRESS').length;
  const planned = MOCK_WAVES.filter(w => w.status === 'PLANNED' || w.status === 'RELEASED').length;
  const completed = MOCK_WAVES.filter(w => w.status === 'COMPLETED').length;
  const totalUnits = MOCK_WAVES.reduce((s, w) => s + w.unitCount, 0);

  const statusColors = { PLANNED: '#8a95a3', RELEASED: '#1ABC9C', IN_PROGRESS: '#f5a623', COMPLETED: '#2ECC71' };
  const methodColors = { BATCH: '#1ABC9C', DISCRETE: '#2C3E9B', CLUSTER: '#f5a623' };

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <KPI label="In Progress" value={inProgress} delta="Active waves" deltaType="neutral" icon={Waves}/>
        <KPI label="Planned / Released" value={planned} delta="Queued" deltaType="neutral" icon={Clock}/>
        <KPI label="Completed Today" value={completed} delta="Finished" deltaType="good" icon={CheckCircle2}/>
        <KPI label="Total Units" value={fmtNum(totalUnits)} delta="Across all waves" deltaType="neutral" icon={Package}/>
      </div>

      <SectionCard title="Wave Status Board" subtitle="Active and upcoming waves" tag="WAVES">
        <div className="space-y-3">
          {MOCK_WAVES.map(w => {
            const urgencyColor = w.minutesToCutoff > 60 ? '#2ECC71' : w.minutesToCutoff > 30 ? '#f5a623' : '#E74C6F';
            return (
              <div key={w.waveId} className="bg-[#232c37] border border-[#2d3744] rounded-md p-3 hover:border-[#1ABC9C] transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="font-mono text-[13px] font-semibold">Wave {w.waveNumber}</div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full uppercase font-mono tracking-wider" style={{ background: statusColors[w.status]+'20', color: statusColors[w.status] }}>{w.status.replace('_',' ')}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full uppercase font-mono tracking-wider" style={{ background: methodColors[w.pickMethod]+'20', color: methodColors[w.pickMethod] }}>{w.pickMethod}</span>
                  </div>
                  <div className="text-[12px] font-mono" style={{ color: w.status === 'COMPLETED' ? '#5d6b7a' : urgencyColor }}>
                    {w.status === 'COMPLETED' ? 'Done' : w.minutesToCutoff > 0 ? `${w.minutesToCutoff}m to cutoff` : `${Math.abs(w.minutesToCutoff)}m past cutoff`}
                  </div>
                </div>
                <div className="flex items-center gap-6 text-[12px] text-[#8a95a3] mb-2">
                  <span>{w.orderCount} orders</span>
                  <span>{fmtNum(w.unitCount)} units</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] text-[#5d6b7a] font-mono mb-1">Pick {w.pickProgress}%</div>
                    <div className="h-1.5 rounded-full bg-[#0f1419] overflow-hidden">
                      <div className="h-full rounded-full bg-[#2ECC71]" style={{ width: `${w.pickProgress}%` }}/>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#5d6b7a] font-mono mb-1">Pack {w.packProgress}%</div>
                    <div className="h-1.5 rounded-full bg-[#0f1419] overflow-hidden">
                      <div className="h-full rounded-full bg-[#1ABC9C]" style={{ width: `${w.packProgress}%` }}/>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </>
  );
};

// ============================================================
// OPTIMIZER PAGE
// ============================================================
const OptimizerPage = () => {
  const [selectedOpt, setSelectedOpt] = useState(null);
  const [loading, setLoading] = useState(false);

  const runOptimizer = (opt) => {
    setLoading(true);
    setSelectedOpt(null);
    setTimeout(() => {
      setSelectedOpt(opt);
      setLoading(false);
    }, 1200);
  };

  const impactColors = { HIGH: '#E74C6F', MED: '#f5a623', LOW: '#2ECC71' };

  return (
    <>
      <SectionCard title="Optimization Engines" subtitle="Select an optimizer to run" tag="AI-POWERED" className="mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {MOCK_OPTIMIZER.map(opt => {
            const Icon = opt.icon;
            return (
              <button key={opt.id} onClick={() => runOptimizer(opt)}
                className="bg-[#232c37] border border-[#2d3744] rounded-md p-4 hover:border-[#1ABC9C] transition-colors text-left">
                <Icon size={20} className="text-[#1ABC9C] mb-2"/>
                <div className="text-[13px] font-semibold mb-1">{opt.label}</div>
                <div className="text-[11px] text-[#8a95a3]">{opt.description}</div>
              </button>
            );
          })}
        </div>
      </SectionCard>

      {loading && (
        <div className="bg-[#232c37] border border-[#2d3744] rounded-md p-8 text-center">
          <Cpu size={24} className="text-[#1ABC9C] mx-auto mb-2 animate-spin"/>
          <div className="text-[13px] text-[#8a95a3]">Running optimizer...</div>
        </div>
      )}

      {selectedOpt && !loading && (
        <SectionCard title={`${selectedOpt.label} — Results`} subtitle={selectedOpt.results.summary} tag="OPTIMIZED">
          <div className="flex items-center gap-4 mb-4">
            <div className="text-4xl font-mono font-semibold text-[#2ECC71]">+{selectedOpt.results.improvement}%</div>
            <div className="text-[13px] text-[#8a95a3]">Overall improvement</div>
          </div>

          <div className="mb-4">
            <div className="text-[12px] uppercase tracking-[0.08em] text-[#5d6b7a] font-mono mb-2">Metrics Comparison</div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[#5d6b7a] border-b border-[#2d3744] font-mono uppercase text-[11px] tracking-wider">
                  <th className="py-2">Metric</th>
                  <th className="py-2 text-right">Current</th>
                  <th className="py-2 text-right">Optimized</th>
                  <th className="py-2 text-right">Improvement</th>
                </tr>
              </thead>
              <tbody>
                {selectedOpt.results.metrics.map((m, i) => (
                  <tr key={i} className="border-b border-[#2d3744]">
                    <td className="py-2">{m.metric}</td>
                    <td className="py-2 font-mono text-right text-[#8a95a3]">{typeof m.current === 'number' && m.current % 1 !== 0 ? m.current.toFixed(2) : m.current}</td>
                    <td className="py-2 font-mono text-right text-[#2ECC71]">{typeof m.optimized === 'number' && m.optimized % 1 !== 0 ? m.optimized.toFixed(2) : m.optimized}</td>
                    <td className="py-2 font-mono text-right text-[#2ECC71]">{m.improvement}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <div className="text-[12px] uppercase tracking-[0.08em] text-[#5d6b7a] font-mono mb-2">Recommendations</div>
            <div className="space-y-2">
              {selectedOpt.results.recommendations.map((r, i) => (
                <div key={i} className="bg-[#1a2129] rounded p-3 border-l-2" style={{ borderColor: impactColors[r.impact] }}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full uppercase font-mono tracking-wider" style={{ background: impactColors[r.impact]+'20', color: impactColors[r.impact] }}>{r.impact}</span>
                      <span className="text-[13px] font-semibold">{r.action}</span>
                    </div>
                    <span className="text-[12px] font-mono text-[#2ECC71]">{r.savings}</span>
                  </div>
                  <div className="text-[12px] text-[#8a95a3]">{r.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      )}
    </>
  );
};

// ============================================================
// FORECAST PAGE
// ============================================================
const ForecastPage = () => {
  const [horizon, setHorizon] = useState(14);

  const severityColors = { CRITICAL: '#E74C6F', HIGH: '#f5a623', MEDIUM: '#1ABC9C', LOW: '#8a95a3' };

  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <div className="text-[12px] uppercase tracking-[0.08em] text-[#5d6b7a] font-mono">Forecast Horizon</div>
        <select value={horizon} onChange={e => setHorizon(Number(e.target.value))}
          className="bg-[#232c37] border border-[#2d3744] text-[12px] font-mono px-2 py-1 rounded text-[#e8ecef] focus:border-[#1ABC9C] outline-none">
          <option value={3}>3 days</option>
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        {MOCK_FORECASTS.map(f => {
          const displayData = f.data.slice(0, horizon);
          return (
            <SectionCard key={f.metric} title={f.metric} subtitle={`MAPE: ${f.mape}%`} tag="FORECAST">
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={displayData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2d3744"/>
                  <XAxis dataKey="date" stroke="#5d6b7a" style={{ fontSize: 9, fontFamily: 'IBM Plex Mono' }}/>
                  <YAxis stroke="#5d6b7a" style={{ fontSize: 9, fontFamily: 'IBM Plex Mono' }}/>
                  <Tooltip contentStyle={{ background: '#1a2129', border: '1px solid #2d3744', fontSize: 11 }}/>
                  <Area type="monotone" dataKey="confidenceHigh" stackId="band" stroke="none" fill="#1ABC9C" fillOpacity={0.1}/>
                  <Area type="monotone" dataKey="confidenceLow" stackId="band" stroke="none" fill="#0f1419" fillOpacity={1}/>
                  <Line type="monotone" dataKey="predicted" stroke="#1ABC9C" strokeWidth={2} dot={false} name="Predicted"/>
                  <Scatter dataKey="actual" fill="#2ECC71" name="Actual" r={3}/>
                </ComposedChart>
              </ResponsiveContainer>
            </SectionCard>
          );
        })}
      </div>

      <SectionCard title="Detected Anomalies" subtitle="Statistical outliers in warehouse metrics" tag="ANOMALIES">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[#5d6b7a] border-b border-[#2d3744] font-mono uppercase text-[11px] tracking-wider">
              <th className="py-2">Severity</th>
              <th className="py-2">Metric</th>
              <th className="py-2">Area</th>
              <th className="py-2 text-right">Expected</th>
              <th className="py-2 text-right">Actual</th>
              <th className="py-2 text-right">Deviation</th>
              <th className="py-2">Explanation</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_ANOMALIES.map(a => (
              <tr key={a.id} className="border-b border-[#2d3744] hover:bg-[#1a2129]">
                <td className="py-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full uppercase font-mono tracking-wider" style={{ background: severityColors[a.severity]+'20', color: severityColors[a.severity] }}>{a.severity}</span>
                </td>
                <td className="py-2 font-semibold">{a.metric}</td>
                <td className="py-2 font-mono text-[#8a95a3]">{a.area}</td>
                <td className="py-2 font-mono text-right">{a.expected}</td>
                <td className="py-2 font-mono text-right" style={{ color: a.severity === 'CRITICAL' ? '#E74C6F' : '#f5a623' }}>{a.actual}</td>
                <td className="py-2 font-mono text-right text-[#E74C6F]">{a.deviation}%</td>
                <td className="py-2 text-[11px] text-[#8a95a3] max-w-xs">{a.explanation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </>
  );
};

// ============================================================
// FLIGHT BOARD PAGE
// ============================================================
const FlightBoardPage = ({ data: allData }) => {
  const [fbFilter, setFbFilter] = useState('all');

  const flightData = useMemo(() => {
    return allData.filter(o => o.isOpen).map(o => {
      const now = Date.now();
      const stages = [o.confirm, o.deliveryPost, o.scaleReceived, o.waveRelease, o.pickComplete, o.packComplete, o.shipConfirm, o.carrierScan, o.delivered];
      let currentStage = 1;
      for (let i = 0; i < stages.length; i++) {
        if (stages[i] && stages[i].getTime() <= now) currentStage = i + 2;
      }
      currentStage = Math.min(currentStage, 9);
      const lastStageTime = stages[currentStage - 2] || o.orderCreate;
      const ageInStage = ((now - lastStageTime.getTime()) / 3600000).toFixed(1);
      const breachRisk = Math.min(100, Math.round((parseFloat(ageInStage) / 24) * 100 + (o.cause ? 30 : 0)));
      const etaConfidence = breachRisk < 30 ? 'HIGH' : breachRisk < 60 ? 'MEDIUM' : 'LOW';
      const status = breachRisk >= 70 ? 'BREACH' : breachRisk >= 40 ? 'AT_RISK' : 'OK';
      return { ...o, currentStage, ageInStage: parseFloat(ageInStage), breachRisk, etaConfidence, flightStatus: status };
    }).sort((a, b) => b.breachRisk - a.breachRisk);
  }, [allData]);

  const counts = useMemo(() => ({
    atWms: flightData.filter(o => o.currentStage <= 3).length,
    onFloor: flightData.filter(o => o.currentStage >= 4 && o.currentStage <= 6).length,
    readyShip: flightData.filter(o => o.currentStage === 7).length,
    inTransit: flightData.filter(o => o.currentStage >= 8).length,
    breaching: flightData.filter(o => o.flightStatus === 'BREACH').length,
    atRisk: flightData.filter(o => o.flightStatus === 'AT_RISK').length,
  }), [flightData]);

  const displayed = fbFilter === 'all' ? flightData : fbFilter === 'breach' ? flightData.filter(o => o.flightStatus === 'BREACH') : flightData.filter(o => o.flightStatus === 'AT_RISK');

  const stageColors = ['#8a95a3','#1ABC9C','#6366f1','#8b5cf6','#2C3E9B','#f5a623','#f97316','#E74C6F','#2ECC71'];
  const statusColors = { OK: '#2ECC71', AT_RISK: '#f5a623', BREACH: '#E74C6F' };
  const confColors = { HIGH: '#2ECC71', MEDIUM: '#f5a623', LOW: '#E74C6F' };

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mb-4">
        <KPI label="At WMS" value={counts.atWms} delta="Stages 1-3" deltaType="neutral" icon={Database}/>
        <KPI label="On Floor" value={counts.onFloor} delta="Pick/Pack/Ship" deltaType="neutral" icon={Package}/>
        <KPI label="Ready Ship" value={counts.readyShip} delta="Stage 7" deltaType="neutral" icon={Truck}/>
        <KPI label="In Transit" value={counts.inTransit} delta="Stages 8-9" deltaType="neutral" icon={MapPin}/>
        <KPI label="Breaching Now" value={counts.breaching} delta="Immediate action" deltaType="bad" icon={AlertTriangle}/>
        <KPI label="At Risk" value={counts.atRisk} delta="Monitor closely" deltaType="bad" icon={Clock}/>
      </div>

      <SectionCard title="Order Flight Board" subtitle="Real-time order progression tracker" tag="LIVE">
        <div className="flex gap-2 mb-3">
          {[
            { key: 'all', label: 'All', count: flightData.length },
            { key: 'breach', label: 'Breaching', count: counts.breaching },
            { key: 'atrisk', label: 'At Risk', count: counts.atRisk },
          ].map(f => (
            <button key={f.key} onClick={() => setFbFilter(f.key)}
              className={`px-3 py-1 rounded text-[11px] font-mono uppercase tracking-wider border transition-all ${fbFilter === f.key ? 'border-[#1ABC9C] bg-[#1ABC9C]/20 text-[#1ABC9C]' : 'border-[#2d3744] text-[#8a95a3]'}`}>
              {f.label} <span className="ml-1 opacity-60">{f.count}</span>
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[#5d6b7a] border-b border-[#2d3744] font-mono uppercase text-[11px] tracking-wider">
                <th className="py-2">Stage</th>
                <th className="py-2 text-right">Age (h)</th>
                <th className="py-2">Order</th>
                <th className="py-2">Customer</th>
                <th className="py-2">State</th>
                <th className="py-2">Channel</th>
                <th className="py-2">Carrier</th>
                <th className="py-2 text-right">Value</th>
                <th className="py-2">RDD</th>
                <th className="py-2">Status</th>
                <th className="py-2">ETA Conf</th>
              </tr>
            </thead>
            <tbody>
              {displayed.slice(0, 25).map(o => (
                <tr key={o.id} className="border-b border-[#2d3744] hover:bg-[#1a2129]">
                  <td className="py-2">
                    <div className="flex gap-0.5">
                      {Array.from({length: 9}, (_, i) => (
                        <div key={i} className="w-2 h-2 rounded-full" style={{ background: i < o.currentStage ? stageColors[i] : '#2d3744' }}/>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 font-mono text-right" style={{ color: o.ageInStage > 8 ? '#E74C6F' : o.ageInStage > 4 ? '#f5a623' : '#8a95a3' }}>{o.ageInStage}</td>
                  <td className="py-2 font-mono">{o.id}</td>
                  <td className="py-2">{o.customer}</td>
                  <td className="py-2 font-mono text-[#8a95a3]">{o.state}</td>
                  <td className="py-2">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: (getChannelColor(o.channel))+'20', color: getChannelColor(o.channel) }}>{o.channel}</span>
                  </td>
                  <td className="py-2 text-[#8a95a3]">{o.carrier}</td>
                  <td className="py-2 font-mono text-right">${fmtNum(o.orderValue.toFixed(0))}</td>
                  <td className="py-2 font-mono text-[11px] text-[#8a95a3]">{o.promiseDeliver.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td className="py-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full uppercase font-mono tracking-wider" style={{ background: statusColors[o.flightStatus]+'20', color: statusColors[o.flightStatus] }}>{o.flightStatus.replace('_',' ')}</span>
                  </td>
                  <td className="py-2">
                    <span className="text-[10px] font-mono" style={{ color: confColors[o.etaConfidence] }}>{o.etaConfidence}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </>
  );
};

// ============================================================
// ECONOMICS PAGE
// ============================================================
const EconomicsPage = ({ filtered }) => {
  const customerPL = useMemo(() => {
    const byCustomer = {};
    filtered.forEach(o => {
      if (!byCustomer[o.customer]) byCustomer[o.customer] = {
        customer: o.customer, channel: '', tier: o.tier, total: 0, onTime: 0, withDeliv: 0,
        chargeback: 0, mabdCompliant: 0, channels: new Set(),
      };
      const c = byCustomer[o.customer];
      c.total++;
      c.chargeback += o.chargeback;
      c.channels.add(o.channel);
      if (o.onTimeDelivery !== null) {
        c.withDeliv++;
        if (o.onTimeDelivery) c.onTime++;
      }
      if (!o.cause) c.mabdCompliant++;
    });
    return Object.values(byCustomer).map(c => ({
      ...c,
      channel: Array.from(c.channels).join(', '),
      otifD: c.withDeliv ? (c.onTime / c.withDeliv * 100).toFixed(1) : '—',
      mabdPct: c.total ? (c.mabdCompliant / c.total * 100).toFixed(1) : '—',
    })).sort((a, b) => b.chargeback - a.chargeback);
  }, [filtered]);

  const waterfallData = MOCK_ECONOMICS_WATERFALL.map(w => ({
    ...w,
    fill: w.value >= 0 ? '#2ECC71' : '#E74C6F',
    displayValue: Math.abs(w.value),
  }));

  const agingColors = { '0-30d': '#2ECC71', '31-60d': '#f5a623', '61-90d': '#f97316', '90+d': '#E74C6F' };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <SectionCard title="Cost Waterfall" subtitle="Order Value to Contribution Margin" tag="P&L">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={waterfallData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3744"/>
              <XAxis dataKey="label" stroke="#5d6b7a" style={{ fontSize: 9, fontFamily: 'IBM Plex Mono' }} angle={-20} textAnchor="end" height={60}/>
              <YAxis stroke="#5d6b7a" style={{ fontSize: 9, fontFamily: 'IBM Plex Mono' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`}/>
              <Tooltip contentStyle={{ background: '#1a2129', border: '1px solid #2d3744', fontSize: 11 }} formatter={v => `$${fmtNum(v)}`}/>
              <Bar dataKey="displayValue" name="Amount">
                {waterfallData.map((e, i) => <Cell key={i} fill={e.fill}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="E&O Aging" subtitle="Excess & Obsolete inventory by age bucket" tag="INVENTORY">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={MOCK_EO_AGING} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3744"/>
              <XAxis type="number" stroke="#5d6b7a" style={{ fontSize: 9, fontFamily: 'IBM Plex Mono' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`}/>
              <YAxis dataKey="bucket" type="category" stroke="#5d6b7a" style={{ fontSize: 10, fontFamily: 'IBM Plex Mono' }} width={60}/>
              <Tooltip contentStyle={{ background: '#1a2129', border: '1px solid #2d3744', fontSize: 11 }} formatter={(v, name) => name === 'value' ? `$${fmtNum(v)}` : fmtNum(v)}/>
              <Bar dataKey="value" name="Value">
                {MOCK_EO_AGING.map((e, i) => <Cell key={i} fill={agingColors[e.bucket]}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-3 justify-center text-[11px] font-mono mt-2">
            {Object.entries(agingColors).map(([k, c]) => (
              <div key={k} className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm" style={{ background: c }}/><span className="text-[#8a95a3]">{k}</span></div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Customer P&L" subtitle="Profitability and compliance by customer" tag="MARGIN">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[#5d6b7a] border-b border-[#2d3744] font-mono uppercase text-[11px] tracking-wider">
              <th className="py-2">Customer</th>
              <th className="py-2">Channel</th>
              <th className="py-2">Tier</th>
              <th className="py-2 text-right">OTIF-D %</th>
              <th className="py-2 text-right">Chargebacks</th>
              <th className="py-2 text-right">MABD Compliance %</th>
            </tr>
          </thead>
          <tbody>
            {customerPL.map(c => (
              <tr key={c.customer} className="border-b border-[#2d3744] hover:bg-[#1a2129]">
                <td className="py-2 font-semibold">{c.customer}</td>
                <td className="py-2 text-[11px] text-[#8a95a3] max-w-[180px] truncate">{c.channel}</td>
                <td className="py-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${c.tier === 'Key' ? 'bg-[#1ABC9C]/20 text-[#1ABC9C]' : c.tier === 'Growth' ? 'bg-[#2C3E9B]/20 text-[#2C3E9B]' : 'bg-[#8a95a3]/20 text-[#8a95a3]'}`}>{c.tier.toUpperCase()}</span>
                </td>
                <td className={`py-2 font-mono text-right ${parseFloat(c.otifD) < 85 ? 'text-[#E74C6F]' : 'text-[#2ECC71]'}`}>{c.otifD}%</td>
                <td className="py-2 font-mono text-right text-[#E74C6F]">${fmtNum(c.chargeback.toFixed(0))}</td>
                <td className={`py-2 font-mono text-right ${parseFloat(c.mabdPct) < 90 ? 'text-[#f5a623]' : 'text-[#2ECC71]'}`}>{c.mabdPct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </>
  );
};

// ============================================================
// AI CHAT PANEL (floating)
// ============================================================
const AiChatPanel = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'ai', text: 'Hello! I\'m your warehouse AI assistant. Ask me about pick rates, dock status, carrier performance, wave progress, or split shipments.' },
  ]);
  const [input, setInput] = useState('');
  const chatEndRef = useRef(null);

  const [isThinking, setIsThinking] = useState(false);

  // Auto-scroll to bottom when messages change or thinking state changes
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  const handleSend = () => {
    if (!input.trim() || isThinking) return;
    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setInput('');
    setIsThinking(true);

    fetch('http://localhost:3001/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userMsg }),
    })
      .then(r => r.json())
      .then(d => {
        const src = d.source === 'gemini' ? '' : ' [mock]';
        setMessages(prev => [...prev, { role: 'ai', text: d.response + src }]);
      })
      .catch(() => {
        setMessages(prev => [...prev, { role: 'ai', text: 'Unable to reach AI service. Make sure the API server is running (npm run server).' }]);
      })
      .finally(() => setIsThinking(false));
  };

  const suggestions = ["What's today's pick rate?", "Which dock is most behind?", "Carrier performance this week?"];

  return (
    <>
      {/* Floating button */}
      <button onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-[#1ABC9C] text-[#0a0e12] flex items-center justify-center shadow-lg hover:bg-[#3d8de6] transition-colors"
        title="AI Assistant">
        {isOpen ? <X size={22}/> : <Brain size={22}/>}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-96 h-[500px] bg-[#1a2129] border border-[#2d3744] rounded-lg shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2d3744] bg-[#232c37]">
            <Brain size={16} className="text-[#1ABC9C]"/>
            <div className="text-[13px] font-semibold">KDC AI Assistant</div>
            <div className="ml-auto flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-[#2ECC71] animate-pulse"/>
              <span className="text-[10px] font-mono text-[#8a95a3]">ONLINE</span>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[#1ABC9C] text-[#0a0e12]'
                    : 'bg-[#232c37] border border-[#2d3744] text-[#e8ecef]'
                }`}>
                  {m.text}
                </div>
              </div>
            ))}
            {isThinking && (
              <div className="flex justify-start">
                <div className="bg-[#232c37] border border-[#2d3744] rounded-lg px-3 py-2 text-[13px] text-[#8a95a3] flex items-center gap-2">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#1ABC9C] animate-bounce" style={{ animationDelay: '0ms' }}/>
                    <div className="w-1.5 h-1.5 rounded-full bg-[#1ABC9C] animate-bounce" style={{ animationDelay: '150ms' }}/>
                    <div className="w-1.5 h-1.5 rounded-full bg-[#1ABC9C] animate-bounce" style={{ animationDelay: '300ms' }}/>
                  </div>
                  Thinking...
                </div>
              </div>
            )}
            <div ref={chatEndRef}/>
          </div>

          {/* Suggestions */}
          {messages.length <= 2 && (
            <div className="px-4 pb-2 flex gap-1.5 flex-wrap">
              {suggestions.map((s, i) => (
                <button key={i} onClick={() => { setInput(s); }}
                  className="text-[11px] px-2 py-1 rounded border border-[#2d3744] text-[#8a95a3] hover:border-[#1ABC9C] hover:text-[#1ABC9C] transition-colors font-mono">
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="flex items-center gap-2 px-4 py-3 border-t border-[#2d3744]">
            <input type="text" value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Ask about warehouse ops..."
              className="flex-1 bg-[#0f1419] border border-[#2d3744] rounded px-3 py-2 text-[13px] focus:border-[#1ABC9C] outline-none text-[#e8ecef] placeholder-[#5d6b7a]"/>
            <button onClick={handleSend} className="w-8 h-8 rounded bg-[#1ABC9C] text-[#0a0e12] flex items-center justify-center hover:bg-[#3d8de6]">
              <Send size={14}/>
            </button>
          </div>
        </div>
      )}
    </>
  );
};

// ============================================================
// DATA HUB PAGE
// ============================================================

const DATA_HUB_DATASETS = {
  raw: [
    { title: 'Shipment Records', desc: 'All raw shipment events from SAP/SCALE', records: 3240, updated: 'Live', live: true },
    { title: 'Carrier Scans', desc: 'UPS/FedEx/R&L scan events', records: 8120, updated: '15m ago', live: false },
    { title: 'Order Master', desc: 'SAP sales order extract', records: 1890, updated: '1h ago', live: false },
    { title: 'Dock Events', desc: 'Inbound/outbound dock activity log', records: 2450, updated: 'Live', live: true },
  ],
  processed: [
    { title: 'SLA Breach Report', desc: 'Orders exceeding stage targets', records: 186, updated: '30m ago', live: false },
    { title: 'Split Shipment Analysis', desc: 'Multi-carton split tracking', records: 94, updated: '1h ago', live: false },
    { title: 'Channel Performance', desc: 'Per-channel SLA and volume metrics', records: 11, updated: '30m ago', live: false },
    { title: 'Customer Scorecards', desc: 'OTD, delay, chargeback per customer', records: 10, updated: '2h ago', live: false },
  ],
  analyzed: [
    { title: 'AI Risk Predictions', desc: 'ML-scored open orders with breach probability', records: 64, updated: '5m ago', live: false },
    { title: 'Root Cause Patterns', desc: 'Clustered delay causes with fix recommendations', records: 28, updated: '1h ago', live: false },
    { title: 'Demand Forecast', desc: '14-day volume predictions by channel', records: 154, updated: '6h ago', live: false },
    { title: 'Cost Optimization', desc: 'Carrier/lane cost-saving opportunities', records: 12, updated: '4h ago', live: false },
  ],
};

const DATA_HUB_MOCK_QUERY_HISTORY = [
  { query: 'Delayed shipments by carrier — April 2026', time: '2 min ago', results: 186 },
  { query: 'Top 5 customers by chargeback exposure', time: '15 min ago', results: 5 },
  { query: 'Split rate trend by channel, last 30 days', time: '1 hr ago', results: 330 },
  { query: 'UPS vs FedEx on-time comparison', time: '3 hrs ago', results: 2 },
];

const DATA_HUB_PREVIEW_DATA = {
  'Shipment Records': [
    { id: 'SH-40291', customer: 'Ulta Beauty', carrier: 'UPS Ground', status: 'Delivered', date: '2026-04-17' },
    { id: 'SH-40292', customer: 'Target DC', carrier: 'FedEx Ground', status: 'In Transit', date: '2026-04-17' },
    { id: 'SH-40293', customer: 'CVS Warehouse', carrier: 'R&L LTL', status: 'Delivered', date: '2026-04-16' },
    { id: 'SH-40294', customer: 'Amazon FBA', carrier: 'UPS 2-Day', status: 'Delayed', date: '2026-04-16' },
    { id: 'SH-40295', customer: 'Sally Beauty', carrier: 'UPS Ground', status: 'Delivered', date: '2026-04-15' },
  ],
  'Carrier Scans': [
    { scan_id: 'CS-88101', carrier: 'UPS', event: 'Pickup Scan', location: 'Savannah, GA', timestamp: '2026-04-17 14:22' },
    { scan_id: 'CS-88102', carrier: 'FedEx', event: 'Departure Scan', location: 'Atlanta, GA', timestamp: '2026-04-17 13:45' },
    { scan_id: 'CS-88103', carrier: 'UPS', event: 'Delivery', location: 'New York, NY', timestamp: '2026-04-17 11:30' },
    { scan_id: 'CS-88104', carrier: 'R&L', event: 'In Transit', location: 'Charlotte, NC', timestamp: '2026-04-17 09:15' },
    { scan_id: 'CS-88105', carrier: 'FedEx', event: 'Pickup Scan', location: 'Savannah, GA', timestamp: '2026-04-17 08:00' },
  ],
  'Order Master': [
    { order: 'SO-120001', customer: 'Walmart RDC', items: 24, value: '$4,280', channel: 'CS - Bulk' },
    { order: 'SO-120002', customer: 'Ulta Beauty', items: 12, value: '$1,890', channel: 'CS - DSDC' },
    { order: 'SO-120003', customer: 'Amazon FBA', items: 48, value: '$6,720', channel: 'ECOM - AMAZON 1P' },
    { order: 'SO-120004', customer: 'Target DC', items: 36, value: '$3,150', channel: 'CS - Bulk' },
    { order: 'SO-120005', customer: 'CVS Warehouse', items: 8, value: '$920', channel: 'BS-IVY' },
  ],
  'Dock Events': [
    { dock: 'D-04', type: 'Outbound', carrier: 'UPS', trailers: 2, status: 'Loading', time: '14:30' },
    { dock: 'D-07', type: 'Inbound', carrier: 'XPO', trailers: 1, status: 'Unloading', time: '13:15' },
    { dock: 'D-02', type: 'Outbound', carrier: 'FedEx', trailers: 1, status: 'Complete', time: '12:00' },
    { dock: 'D-09', type: 'Inbound', carrier: 'Estes', trailers: 3, status: 'Waiting', time: '11:45' },
    { dock: 'D-01', type: 'Outbound', carrier: 'R&L', trailers: 1, status: 'Loading', time: '10:30' },
  ],
  'SLA Breach Report': [
    { order: 'SO-119840', customer: 'Ulta Beauty', stage: 'Pick', target: '60m', actual: '142m', breach: '+82m' },
    { order: 'SO-119855', customer: 'Target DC', stage: 'Ship', target: '120m', actual: '310m', breach: '+190m' },
    { order: 'SO-119861', customer: 'Amazon FBA', stage: 'Pack', target: '45m', actual: '98m', breach: '+53m' },
    { order: 'SO-119873', customer: 'CVS Warehouse', stage: 'Label', target: '30m', actual: '67m', breach: '+37m' },
    { order: 'SO-119880', customer: 'Sally Beauty', stage: 'Pick', target: '60m', actual: '125m', breach: '+65m' },
  ],
  'Split Shipment Analysis': [
    { order: 'SO-119790', customer: 'Walmart RDC', cartons: 4, split: true, reason: 'Inventory shortage', rate: '12%' },
    { order: 'SO-119802', customer: 'Costco Regional', cartons: 6, split: true, reason: 'Weight limit', rate: '8%' },
    { order: 'SO-119815', customer: 'Target DC', cartons: 3, split: false, reason: '—', rate: '0%' },
    { order: 'SO-119821', customer: 'Ulta Beauty', cartons: 2, split: true, reason: 'Zone mismatch', rate: '15%' },
    { order: 'SO-119830', customer: 'Amazon FBA', cartons: 8, split: true, reason: 'Inventory shortage', rate: '22%' },
  ],
  'Channel Performance': [
    { channel: 'CS - Bulk', volume: 1240, onTime: '94.2%', avgCycle: '18.4h', sla: 'Met' },
    { channel: 'ECOM - AMAZON 1P', volume: 890, onTime: '91.8%', avgCycle: '12.1h', sla: 'Met' },
    { channel: 'ECOM - DTC', volume: 760, onTime: '88.5%', avgCycle: '8.6h', sla: 'At Risk' },
    { channel: 'BS-IVY', volume: 420, onTime: '96.1%', avgCycle: '22.3h', sla: 'Met' },
    { channel: 'VIVACE', volume: 310, onTime: '85.2%', avgCycle: '26.7h', sla: 'Breached' },
  ],
  'Customer Scorecards': [
    { customer: 'Ulta Beauty', otd: '95.1%', delays: 12, chargebacks: '$2,400', tier: 'Key' },
    { customer: 'Target DC', otd: '93.8%', delays: 18, chargebacks: '$4,100', tier: 'Key' },
    { customer: 'Amazon FBA', otd: '90.2%', delays: 31, chargebacks: '$8,200', tier: 'Growth' },
    { customer: 'Walmart RDC', otd: '96.4%', delays: 8, chargebacks: '$1,200', tier: 'Key' },
    { customer: 'Sally Beauty', otd: '94.5%', delays: 14, chargebacks: '$2,800', tier: 'Key' },
  ],
  'AI Risk Predictions': [
    { order: 'SO-120010', risk: 'High', probability: '89%', factor: 'Carrier delay pattern', eta: '2026-04-19' },
    { order: 'SO-120015', risk: 'Medium', probability: '62%', factor: 'Volume surge', eta: '2026-04-19' },
    { order: 'SO-120022', risk: 'High', probability: '91%', factor: 'Missing inventory', eta: '2026-04-20' },
    { order: 'SO-120028', risk: 'Low', probability: '18%', factor: 'Normal flow', eta: '2026-04-18' },
    { order: 'SO-120031', risk: 'Medium', probability: '55%', factor: 'DC congestion', eta: '2026-04-19' },
  ],
  'Root Cause Patterns': [
    { cluster: 'UPS Delay Wave', occurrences: 42, impact: 'High', fix: 'Shift pickup window to 14:00', confidence: '87%' },
    { cluster: 'Pick Bottleneck', occurrences: 28, impact: 'Medium', fix: 'Add 2nd shift pickers', confidence: '79%' },
    { cluster: 'Label Printer Jam', occurrences: 15, impact: 'Low', fix: 'Replace Zone B printers', confidence: '92%' },
    { cluster: 'Inventory Mismatch', occurrences: 31, impact: 'High', fix: 'Daily SAP-SCALE reconciliation', confidence: '84%' },
    { cluster: 'Dock Congestion PM', occurrences: 19, impact: 'Medium', fix: 'Stagger outbound appointments', confidence: '76%' },
  ],
  'Demand Forecast': [
    { date: '2026-04-19', channel: 'CS - Bulk', predicted: 142, confidence: '±12', trend: 'Up' },
    { date: '2026-04-19', channel: 'ECOM - DTC', predicted: 98, confidence: '±8', trend: 'Stable' },
    { date: '2026-04-20', channel: 'CS - Bulk', predicted: 156, confidence: '±15', trend: 'Up' },
    { date: '2026-04-20', channel: 'ECOM - AMAZON 1P', predicted: 110, confidence: '±10', trend: 'Up' },
    { date: '2026-04-21', channel: 'BS-IVY', predicted: 45, confidence: '±6', trend: 'Down' },
  ],
  'Cost Optimization': [
    { lane: 'SAV→NYC', current: 'UPS Ground', savings: '$1,240/mo', recommendation: 'Switch to FedEx Ground', risk: 'Low' },
    { lane: 'SAV→LAX', current: 'UPS 2-Day', savings: '$3,100/mo', recommendation: 'Consolidate with LTL', risk: 'Medium' },
    { lane: 'SAV→CHI', current: 'FedEx Ground', savings: '$890/mo', recommendation: 'Zone skip via ATL hub', risk: 'Low' },
    { lane: 'SAV→DAL', current: 'R&L LTL', savings: '$420/mo', recommendation: 'Maintain current', risk: 'None' },
    { lane: 'SAV→MIA', current: 'UPS Ground', savings: '$1,680/mo', recommendation: 'Regional carrier pilot', risk: 'Medium' },
  ],
};

const getQueryMockResponse = (query) => {
  const q = query.toLowerCase();
  if (q.includes('delay')) {
    return {
      columns: ['Order', 'Customer', 'Carrier', 'Cause', 'Delay (hrs)'],
      rows: [
        ['SO-119840', 'Ulta Beauty', 'UPS Ground', 'Carrier Late Pickup', '4.2'],
        ['SO-119855', 'Target DC', 'FedEx Ground', 'DC Congestion', '6.8'],
        ['SO-119861', 'Amazon FBA', 'UPS 2-Day', 'Missing Product', '3.1'],
        ['SO-119873', 'CVS Warehouse', 'R&L LTL', 'Carrier Late Pickup', '5.5'],
        ['SO-119880', 'Sally Beauty', 'UPS Ground', 'Dock Queue', '2.9'],
      ],
    };
  }
  if (q.includes('carrier')) {
    return {
      columns: ['Carrier', 'Shipments', 'On-Time %', 'Avg Transit (days)'],
      rows: [
        ['UPS Ground', '1,240', '93.2%', '3.4'],
        ['UPS 2-Day', '680', '96.1%', '2.1'],
        ['FedEx Ground', '520', '91.8%', '3.8'],
        ['R&L LTL', '310', '88.4%', '5.2'],
        ['UPS Next Day', '190', '97.5%', '1.1'],
      ],
    };
  }
  if (q.includes('customer') || q.includes('chargeback')) {
    return {
      columns: ['Customer', 'Chargebacks ($)', 'OTD %', 'Tier'],
      rows: [
        ['Amazon FBA', '$8,200', '90.2%', 'Growth'],
        ['Target DC', '$4,100', '93.8%', 'Key'],
        ['Sally Beauty', '$2,800', '94.5%', 'Key'],
        ['Ulta Beauty', '$2,400', '95.1%', 'Key'],
        ['Walmart RDC', '$1,200', '96.4%', 'Key'],
      ],
    };
  }
  if (q.includes('split')) {
    return {
      columns: ['Customer', 'Split Rate %', 'Cartons', 'Primary Reason'],
      rows: [
        ['Amazon FBA', '22%', '8', 'Inventory shortage'],
        ['Costco Regional', '15%', '6', 'Weight limit'],
        ['Ulta Beauty', '12%', '4', 'Zone mismatch'],
        ['Walmart RDC', '8%', '3', 'Inventory shortage'],
        ['Target DC', '5%', '2', 'Weight limit'],
      ],
    };
  }
  return {
    columns: ['Metric', 'Value', 'Trend', 'Period'],
    rows: [
      ['Total Shipments', '3,240', '↑ 8%', 'This Week'],
      ['Delayed', '186', '↓ 12%', 'This Week'],
      ['On-Time %', '94.3%', '↑ 1.2pp', 'This Week'],
      ['Avg Cycle (hrs)', '16.4', '↓ 0.8', 'This Week'],
      ['Split Rate', '6.2%', '↓ 0.5pp', 'This Week'],
    ],
  };
};

const downloadFile = (filename, content, type) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const generateCSV = (title, previewRows) => {
  if (!previewRows || previewRows.length === 0) return '';
  const headers = Object.keys(previewRows[0]);
  const lines = [headers.join(',')];
  previewRows.forEach(row => {
    lines.push(headers.map(h => `"${String(row[h]).replace(/"/g, '""')}"`).join(','));
  });
  return lines.join('\n');
};

const generateJSON = (title, previewRows) => {
  return JSON.stringify(previewRows || [], null, 2);
};

const DataHubPage = ({ data }) => {
  const [activeCategory, setActiveCategory] = useState('raw');
  const [previewOpen, setPreviewOpen] = useState({});
  const [queryInput, setQueryInput] = useState('');
  const [queryHistory, setQueryHistory] = useState(DATA_HUB_MOCK_QUERY_HISTORY);
  const [activeQuery, setActiveQuery] = useState(null);
  const [isThinking, setIsThinking] = useState(false);

  const categories = [
    { key: 'raw', label: 'Raw Data' },
    { key: 'processed', label: 'Processed' },
    { key: 'analyzed', label: 'Analyzed' },
  ];

  const datasets = DATA_HUB_DATASETS[activeCategory];

  const handleSubmitQuery = () => {
    if (!queryInput.trim()) return;
    setIsThinking(true);
    setActiveQuery(null);
    const q = queryInput.trim();
    const newEntry = { query: q, time: 'Just now', results: Math.floor(Math.random() * 300) + 5 };
    setQueryHistory(prev => [newEntry, ...prev.slice(0, 9)]);
    setTimeout(() => {
      setIsThinking(false);
      setActiveQuery({ query: q, response: getQueryMockResponse(q) });
    }, 800);
    setQueryInput('');
  };

  const handleRerun = (entry) => {
    setQueryInput(entry.query);
    setIsThinking(true);
    setActiveQuery(null);
    setTimeout(() => {
      setIsThinking(false);
      setActiveQuery({ query: entry.query, response: getQueryMockResponse(entry.query) });
    }, 800);
  };

  const togglePreview = (idx) => {
    setPreviewOpen(prev => ({ ...prev, [activeCategory + '-' + idx]: !prev[activeCategory + '-' + idx] }));
  };

  const handleDownloadCSV = (ds) => {
    const rows = DATA_HUB_PREVIEW_DATA[ds.title];
    if (!rows) return;
    const csv = generateCSV(ds.title, rows);
    const dateSuffix = new Date().toISOString().slice(0, 10);
    downloadFile(`${ds.title.toLowerCase().replace(/\s+/g, '-')}-${dateSuffix}.csv`, csv, 'text/csv');
  };

  const handleDownloadJSON = (ds) => {
    const rows = DATA_HUB_PREVIEW_DATA[ds.title];
    if (!rows) return;
    const json = generateJSON(ds.title, rows);
    const dateSuffix = new Date().toISOString().slice(0, 10);
    downloadFile(`${ds.title.toLowerCase().replace(/\s+/g, '-')}-${dateSuffix}.json`, json, 'application/json');
  };

  const handleDownloadQueryResult = (queryObj) => {
    if (!queryObj || !queryObj.response) return;
    const { columns, rows } = queryObj.response;
    const lines = [columns.join(',')];
    rows.forEach(r => lines.push(r.map(c => `"${c}"`).join(',')));
    const dateSuffix = new Date().toISOString().slice(0, 10);
    downloadFile(`query-result-${dateSuffix}.csv`, lines.join('\n'), 'text/csv');
  };

  return (
    <div className="space-y-4">
      {/* A. Search / Prompt Bar */}
      <div className="bg-[#232c37] border border-[#2d3744] rounded-lg flex items-center gap-3 px-4 py-3">
        <Database size={20} className="text-[#1ABC9C] shrink-0" />
        <input
          type="text"
          value={queryInput}
          onChange={e => setQueryInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmitQuery()}
          placeholder="Ask for data... e.g., 'Show me delayed shipments by carrier this week'"
          className="bg-transparent border-none outline-none text-[14px] w-full placeholder-[#5d6b7a]"
          style={{ color: 'var(--text-primary)' }}
        />
        <button
          onClick={handleSubmitQuery}
          className="bg-[#1ABC9C] hover:bg-[#3b8de6] text-[#0a0e12] px-4 py-1.5 rounded-md text-[13px] font-semibold flex items-center gap-1.5 transition-colors shrink-0"
        >
          <Send size={14} /> Query
        </button>
      </div>

      {/* B. KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPI label="Available Datasets" value="24" delta="Across all categories" icon={Database} />
        <KPI label="Last Export" value="2h ago" delta="By GMC" icon={Download} />
        <KPI label="Data Freshness" value="Live" delta="Real-time sync" deltaType="good" icon={Activity} />
        <KPI label="Total Records" value="12.4K" delta="Across active filters" icon={Layers} />
      </div>

      {/* C. Category Tabs */}
      <div className="flex items-center gap-2">
        {categories.map(cat => (
          <button
            key={cat.key}
            onClick={() => setActiveCategory(cat.key)}
            className={`px-4 py-1.5 rounded-full text-[12px] font-semibold transition-colors ${
              activeCategory === cat.key
                ? 'bg-[#1ABC9C] text-[#0a0e12]'
                : 'bg-[#232c37] text-[#8a95a3] border border-[#2d3744] hover:text-[#e8ecef]'
            }`}
          >
            {cat.label}
          </button>
        ))}
        <div className="ml-auto text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
          {datasets.length} datasets in {categories.find(c => c.key === activeCategory)?.label}
        </div>
      </div>

      {/* D. Dataset Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {datasets.map((ds, idx) => {
          const isOpen = previewOpen[activeCategory + '-' + idx];
          const previewRows = DATA_HUB_PREVIEW_DATA[ds.title];
          return (
            <div key={ds.title} className="bg-[#232c37] border border-[#2d3744] rounded-lg p-4 hover:border-[#1ABC9C] transition-colors">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{ds.title}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{ds.desc}</div>
                </div>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1ABC9C]/10 text-[#1ABC9C] border border-[#1ABC9C]/30">
                    {ds.records.toLocaleString()} records
                  </span>
                  <div className="flex items-center gap-1">
                    {ds.live && (
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2ECC71] opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#2ECC71]"></span>
                      </span>
                    )}
                    {!ds.live && <span className="inline-flex rounded-full h-2 w-2 bg-[#5d6b7a]"></span>}
                    <span className="text-[10px] font-mono" style={{ color: ds.live ? '#2ECC71' : 'var(--text-muted)' }}>{ds.updated}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => togglePreview(idx)}
                  className="text-[11px] font-semibold px-3 py-1 rounded border transition-colors"
                  style={{
                    borderColor: isOpen ? '#1ABC9C' : '#2d3744',
                    color: isOpen ? '#1ABC9C' : '#8a95a3',
                    background: isOpen ? 'rgba(74,158,255,0.08)' : 'transparent',
                  }}
                >
                  {isOpen ? 'Hide Preview' : 'Preview'}
                </button>
                <button
                  onClick={() => handleDownloadCSV(ds)}
                  className="text-[11px] font-semibold px-3 py-1 rounded border border-[#2d3744] text-[#8a95a3] hover:text-[#e8ecef] hover:border-[#1ABC9C] transition-colors flex items-center gap-1"
                >
                  <FileDown size={11} /> CSV
                </button>
                <button
                  onClick={() => handleDownloadJSON(ds)}
                  className="text-[11px] font-semibold px-3 py-1 rounded border border-[#2d3744] text-[#8a95a3] hover:text-[#e8ecef] hover:border-[#1ABC9C] transition-colors flex items-center gap-1"
                >
                  <FileDown size={11} /> JSON
                </button>
              </div>

              {/* Inline Preview Table */}
              {isOpen && previewRows && (
                <div className="mt-3 rounded border border-[#2d3744] overflow-hidden">
                  <table className="w-full text-[11px] font-mono">
                    <thead>
                      <tr className="bg-[#1a2129]">
                        {Object.keys(previewRows[0]).map(col => (
                          <th key={col} className="px-2 py-1.5 text-left font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, ri) => (
                        <tr key={ri} className={ri % 2 === 0 ? 'bg-[#232c37]' : 'bg-[#1e2730]'}>
                          {Object.values(row).map((val, ci) => (
                            <td key={ci} className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>{val}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* F. Prompt Response Area */}
      {isThinking && (
        <SectionCard title="Processing Query" subtitle="Analyzing data...">
          <div className="flex items-center gap-2 py-4">
            <div className="flex gap-1">
              <span className="w-2 h-2 rounded-full bg-[#1ABC9C] animate-bounce" style={{ animationDelay: '0ms' }}></span>
              <span className="w-2 h-2 rounded-full bg-[#1ABC9C] animate-bounce" style={{ animationDelay: '150ms' }}></span>
              <span className="w-2 h-2 rounded-full bg-[#1ABC9C] animate-bounce" style={{ animationDelay: '300ms' }}></span>
            </div>
            <span className="text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>Searching across datasets...</span>
          </div>
        </SectionCard>
      )}

      {activeQuery && !isThinking && (
        <SectionCard title="Query Result" subtitle={activeQuery.query}>
          <div className="mb-3 px-3 py-2 rounded bg-[#1a2129] border border-[#2d3744]">
            <div className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
              <Search size={11} className="inline mr-1.5" style={{ verticalAlign: 'middle' }}/>
              {activeQuery.query}
            </div>
          </div>
          <div className="rounded border border-[#2d3744] overflow-hidden mb-3">
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="bg-[#1a2129]">
                  {activeQuery.response.columns.map(col => (
                    <th key={col} className="px-3 py-2 text-left font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeQuery.response.rows.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? 'bg-[#232c37]' : 'bg-[#1e2730]'}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              ⚠ The data shown is based on mock data. Connect to live sources for real results.
            </div>
            <button
              onClick={() => handleDownloadQueryResult(activeQuery)}
              className="text-[11px] font-semibold px-3 py-1 rounded border border-[#2d3744] text-[#8a95a3] hover:text-[#e8ecef] hover:border-[#1ABC9C] transition-colors flex items-center gap-1"
            >
              <FileDown size={11} /> Download Result
            </button>
          </div>
        </SectionCard>
      )}

      {/* E. Query History Section */}
      <SectionCard title="Recent Queries" subtitle={`${queryHistory.length} queries`}>
        <div className="space-y-1">
          {queryHistory.map((entry, i) => (
            <div key={i} className="flex items-center justify-between py-2 px-3 rounded transition-colors hover:bg-[#1a2129]" style={{ borderBottom: i < queryHistory.length - 1 ? '1px solid #2d3744' : 'none' }}>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-mono truncate" style={{ color: 'var(--text-primary)' }}>{entry.query}</div>
                <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>{entry.time} · {entry.results} results</div>
              </div>
              <div className="flex items-center gap-2 ml-3 shrink-0">
                <button
                  onClick={() => handleRerun(entry)}
                  className="text-[10px] font-semibold px-2 py-0.5 rounded border border-[#2d3744] text-[#1ABC9C] hover:bg-[#1ABC9C]/10 transition-colors"
                >
                  Re-run
                </button>
                <button
                  onClick={() => {
                    const resp = getQueryMockResponse(entry.query);
                    const lines = [resp.columns.join(',')];
                    resp.rows.forEach(r => lines.push(r.map(c => `"${c}"`).join(',')));
                    downloadFile(`query-${Date.now()}.csv`, lines.join('\n'), 'text/csv');
                  }}
                  className="text-[10px] font-semibold px-2 py-0.5 rounded border border-[#2d3744] text-[#8a95a3] hover:text-[#e8ecef] transition-colors flex items-center gap-1"
                >
                  <Download size={10} /> Download
                </button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
};

// ============================================================
// EVENT CALENDAR PAGE
// ============================================================
const EventCalendarPage = ({ currentUser }) => {
  const [calendarMonth, setCalendarMonth] = useState(new Date(2026, 3, 1));
  const [selectedDate, setSelectedDate] = useState(null);
  const [events, setEvents] = useState(MOCK_EVENTS);
  const [documents, setDocuments] = useState(MOCK_DOCUMENTS);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedData, setParsedData] = useState(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const fileInputRef = useRef(null);

  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const today = new Date();
  const isToday = (d) => d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  const isSameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const getEventsForDay = (date) => events.filter(e => {
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
    return e.startDate <= dayEnd && e.endDate >= dayStart;
  });

  const monthEvents = useMemo(() => events.filter(e => {
    const mStart = new Date(year, month, 1);
    const mEnd = new Date(year, month + 1, 0, 23, 59, 59);
    return e.startDate <= mEnd && e.endDate >= mStart;
  }), [events, year, month]);

  const upcomingEvents = useMemo(() => {
    const now = new Date(2026, 3, 18);
    const twoWeeks = new Date(now.getTime() + 14 * 86400000);
    return events.filter(e => e.startDate >= now && e.startDate <= twoWeeks).sort((a, b) => a.startDate - b.startDate);
  }, [events]);

  const highImpactCount = monthEvents.filter(e => e.impact === 'High').length;
  const nextMajor = useMemo(() => {
    const now = new Date(2026, 3, 18);
    return events.filter(e => e.endDate >= now && e.impact === 'High').sort((a, b) => a.startDate - b.startDate)[0];
  }, [events]);
  const daysUntilNext = nextMajor ? Math.max(0, Math.ceil((nextMajor.startDate - new Date(2026, 3, 18)) / 86400000)) : null;

  const avgUplift = useMemo(() => {
    const withUplift = monthEvents.filter(e => e.volumeImpact.startsWith('+'));
    if (!withUplift.length) return 0;
    return Math.round(withUplift.reduce((s, e) => s + parseInt(e.volumeImpact.replace('+', '').replace('%', '')), 0) / withUplift.length);
  }, [monthEvents]);

  const docsThisMonth = documents.filter(d => d.uploadedAt.getMonth() === month && d.uploadedAt.getFullYear() === year).length;

  // Build calendar grid
  const calendarCells = [];
  for (let i = 0; i < firstDayOfWeek; i++) {
    const day = prevMonthDays - firstDayOfWeek + 1 + i;
    calendarCells.push({ day, date: new Date(year, month - 1, day), isCurrentMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    calendarCells.push({ day: d, date: new Date(year, month, d), isCurrentMonth: true });
  }
  const remaining = 42 - calendarCells.length;
  for (let i = 1; i <= remaining; i++) {
    calendarCells.push({ day: i, date: new Date(year, month + 1, i), isCurrentMonth: false });
  }

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const impactColor = (level) => level === 'High' ? '#E74C6F' : level === 'Medium' ? '#f5a623' : '#2ECC71';

  // Timeline Gantt data
  const timelineTypes = useMemo(() => {
    const typeMap = {};
    monthEvents.forEach(e => {
      if (!typeMap[e.type]) typeMap[e.type] = [];
      typeMap[e.type].push(e);
    });
    return typeMap;
  }, [monthEvents]);

  // Mock AI parser
  const mockParse = (file) => {
    const fname = file.name.toLowerCase();
    let type = 'Promotion', impact = 'Medium', volumeImpact = '+35%';
    let name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    if (fname.includes('promo')) { type = 'Promotion'; volumeImpact = '+' + (30 + Math.floor(Math.random() * 20)) + '%'; }
    else if (fname.includes('prepack')) { type = 'Prepack'; volumeImpact = '+' + (25 + Math.floor(Math.random() * 30)) + '%'; }
    else if (fname.includes('show') || fname.includes('expo')) { type = 'Show/Expo'; volumeImpact = '+' + (15 + Math.floor(Math.random() * 15)) + '%'; }
    else if (fname.includes('launch')) { type = 'Product Launch'; impact = 'High'; volumeImpact = '+' + (40 + Math.floor(Math.random() * 20)) + '%'; }
    const start = new Date(2026, 3, 20 + Math.floor(Math.random() * 8));
    const end = new Date(start.getTime() + (2 + Math.floor(Math.random() * 5)) * 86400000);
    return { name, type, startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), impact, channels: ['CS - Bulk', 'ECOM - DTC'], volumeImpact, notes: `Extracted from ${file.name}. Please verify details.`, source: file.name };
  };

  const handleFilePick = (e) => {
    const f = e.target.files?.[0];
    if (f) setUploadFile(f);
  };

  const handleParse = () => {
    setIsParsing(true);
    setTimeout(() => {
      setIsParsing(false);
      setParsedData(mockParse(uploadFile));
      setIsConfirming(true);
    }, 1500);
  };

  const handleConfirm = () => {
    const newEvent = {
      id: events.length + 1,
      name: parsedData.name,
      type: parsedData.type,
      startDate: new Date(parsedData.startDate),
      endDate: new Date(parsedData.endDate),
      impact: parsedData.impact,
      channels: parsedData.channels,
      volumeImpact: parsedData.volumeImpact,
      notes: parsedData.notes,
      contributor: currentUser?.displayName || 'Unknown',
      contributedAt: new Date(),
      sourceDoc: parsedData.source,
    };
    const newDoc = {
      id: documents.length + 1,
      name: parsedData.source,
      type: parsedData.source.split('.').pop(),
      uploadedBy: currentUser?.displayName || 'Unknown',
      uploadedAt: new Date(),
      linkedEvent: parsedData.name,
      status: 'Confirmed',
    };
    setEvents(prev => [...prev, newEvent]);
    setDocuments(prev => [...prev, newDoc]);
    setUploadSuccess(true);
    setTimeout(() => setUploadSuccess(false), 3000);
    setParsedData(null);
    setIsConfirming(false);
    setUploadFile(null);
    setShowUploadForm(false);
  };

  const handleCancel = () => {
    setParsedData(null);
    setIsConfirming(false);
    setUploadFile(null);
    setIsParsing(false);
  };

  const selectedDayEvents = selectedDate ? getEventsForDay(selectedDate) : [];

  return (
    <div className="space-y-4">
      {/* Success toast */}
      {uploadSuccess && (
        <div className="fixed top-4 right-4 z-50 bg-[#2ECC71]/15 border border-[#2ECC71]/40 text-[#2ECC71] px-4 py-3 rounded-lg flex items-center gap-2 text-[13px] font-medium shadow-lg">
          <CheckCircle2 size={16}/> Event logged and document uploaded successfully.
        </div>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPI label="Events This Month" value={monthEvents.length} icon={Calendar} delta={`${highImpactCount} high-impact`} deltaType="neutral"/>
        <KPI label="Next Major Event" value={nextMajor ? nextMajor.name.slice(0, 22) + (nextMajor.name.length > 22 ? '...' : '') : 'None'} icon={AlertTriangle} delta={daysUntilNext !== null ? `in ${daysUntilNext} days` : '—'} deltaType="neutral"/>
        <KPI label="Avg Volume Uplift" value={`${avgUplift}%`} icon={TrendingUp} delta="During events" deltaType="neutral"/>
        <KPI label="Documents Uploaded" value={documents.length} icon={FileText} delta={`${docsThisMonth} this month`} deltaType="neutral"/>
      </div>

      {/* Calendar + Detail Panel */}
      <div className="grid grid-cols-3 gap-4">
        {/* Calendar Grid */}
        <div className="col-span-2">
          <SectionCard title="Distribution Event Calendar" subtitle={`${monthNames[month]} ${year}`}>
            {/* Month nav */}
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => setCalendarMonth(new Date(year, month - 1, 1))} className="p-1 rounded hover:bg-[#232c37] transition-colors" style={{ color: 'var(--text-secondary)' }}>
                <ChevronLeft size={18}/>
              </button>
              <div className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{monthNames[month]} {year}</div>
              <button onClick={() => setCalendarMonth(new Date(year, month + 1, 1))} className="p-1 rounded hover:bg-[#232c37] transition-colors" style={{ color: 'var(--text-secondary)' }}>
                <ChevronRight size={18}/>
              </button>
            </div>
            {/* Day headers */}
            <div className="grid grid-cols-7 mb-1">
              {dayNames.map(d => (
                <div key={d} className="text-center text-[10px] font-semibold uppercase tracking-wider py-1" style={{ color: 'var(--text-muted)' }}>{d}</div>
              ))}
            </div>
            {/* Day cells */}
            <div className="grid grid-cols-7">
              {calendarCells.map((cell, i) => {
                const dayEvents = getEventsForDay(cell.date);
                const isSelected = isSameDay(selectedDate, cell.date);
                const isTodayCell = isToday(cell.date);
                const uniqueTypes = [...new Set(dayEvents.map(e => e.type))];
                return (
                  <div
                    key={i}
                    onClick={() => cell.isCurrentMonth && setSelectedDate(cell.date)}
                    className={`w-full aspect-square flex flex-col items-center justify-start pt-1 text-[12px] border cursor-pointer hover:bg-[#232c37] transition-colors ${isSelected ? 'bg-[#1ABC9C]/10' : ''} ${isTodayCell ? 'ring-2 ring-[#1ABC9C]' : ''}`}
                    style={{
                      borderColor: 'var(--border)',
                      color: cell.isCurrentMonth ? 'var(--text-primary)' : 'var(--text-muted)',
                      opacity: cell.isCurrentMonth ? 1 : 0.4,
                    }}
                  >
                    <span className="font-mono text-[11px]">{cell.day}</span>
                    <div className="flex gap-[3px] mt-auto mb-1 flex-wrap justify-center">
                      {uniqueTypes.slice(0, 4).map((t, j) => (
                        <div key={j} className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: EVENT_TYPE_COLORS[t] || '#8a95a3' }}/>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
              {EVENT_TYPES.map(t => (
                <div key={t} className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                  <div className="w-[8px] h-[8px] rounded-full" style={{ backgroundColor: EVENT_TYPE_COLORS[t] }}/>
                  {t}
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        {/* Event Detail Panel */}
        <div className="col-span-1">
          <SectionCard title={selectedDate ? selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : 'Upcoming Events'} subtitle={selectedDate ? `${selectedDayEvents.length} event(s)` : 'Next 14 days'}>
            <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
              {(selectedDate ? selectedDayEvents : upcomingEvents).length === 0 ? (
                <div className="text-[12px] py-6 text-center" style={{ color: 'var(--text-muted)' }}>No events {selectedDate ? 'on this day' : 'upcoming'}.</div>
              ) : (selectedDate ? selectedDayEvents : upcomingEvents).map(ev => (
                <div key={ev.id} className="rounded-md p-3 space-y-2" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: EVENT_TYPE_COLORS[ev.type] + '33', color: EVENT_TYPE_COLORS[ev.type] }}>{ev.type}</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: impactColor(ev.impact) + '33', color: impactColor(ev.impact) }}>{ev.impact}</span>
                  </div>
                  <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{ev.name}</div>
                  {ev.channels.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {ev.channels.map(ch => (
                        <span key={ch} className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: (getChannelColor(ch)) + '22', color: getChannelColor(ch) }}>{ch}</span>
                      ))}
                    </div>
                  )}
                  <div className="text-[11px] font-mono font-semibold" style={{ color: ev.volumeImpact.startsWith('+') ? '#2ECC71' : '#E74C6F' }}>{ev.volumeImpact} volume</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {ev.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} — {ev.endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{ev.notes}</div>
                  {ev.sourceDoc && (
                    <div className="flex items-center gap-1 text-[10px]" style={{ color: '#1ABC9C' }}>
                      <FileText size={10}/> {ev.sourceDoc}
                    </div>
                  )}
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{ev.contributor} · {ev.contributedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>

      {/* Timeline Gantt */}
      <SectionCard title="Event Timeline" subtitle={`${monthNames[month]} ${year} — Duration View`}>
        <div className="space-y-2">
          {Object.entries(timelineTypes).map(([type, typeEvents]) => (
            <div key={type} className="flex items-center gap-3">
              <div className="w-[100px] text-[10px] font-semibold truncate" style={{ color: EVENT_TYPE_COLORS[type] || '#8a95a3' }}>{type}</div>
              <div className="flex-1 relative h-[22px] rounded" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
                {typeEvents.map(ev => {
                  const evStart = Math.max(1, ev.startDate.getDate());
                  const evEnd = Math.min(daysInMonth, ev.endDate.getMonth() === month ? ev.endDate.getDate() : daysInMonth);
                  const startPct = ((evStart - 1) / daysInMonth) * 100;
                  const widthPct = Math.max(((evEnd - evStart + 1) / daysInMonth) * 100, 2);
                  return (
                    <div
                      key={ev.id}
                      className="absolute top-[3px] h-[16px] rounded-sm flex items-center justify-center text-[8px] font-semibold text-white truncate px-1 cursor-default"
                      style={{ left: `${startPct}%`, width: `${widthPct}%`, backgroundColor: EVENT_TYPE_COLORS[ev.type] + 'cc' }}
                      title={ev.name}
                    >
                      {widthPct > 10 ? ev.name.slice(0, 18) : ''}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {/* Day markers */}
        <div className="flex items-center mt-2 ml-[112px]">
          {[1, 5, 10, 15, 20, 25, daysInMonth].map(d => (
            <div key={d} className="text-[9px] font-mono" style={{ color: 'var(--text-muted)', position: 'absolute', left: `calc(112px + ${((d - 1) / daysInMonth) * 100}% * (100% - 112px) / 100%)` }}/>
          ))}
          <div className="flex-1 flex justify-between text-[9px] font-mono" style={{ color: 'var(--text-muted)' }}>
            <span>1</span><span>5</span><span>10</span><span>15</span><span>20</span><span>25</span><span>{daysInMonth}</span>
          </div>
        </div>
      </SectionCard>

      {/* Document Repository */}
      <SectionCard title="Event Documents" subtitle="Collaborative Upload Hub">
        {/* Upload Button + Form */}
        <div className="mb-4">
          {!showUploadForm ? (
            <button onClick={() => setShowUploadForm(true)} className="flex items-center gap-2 px-3 py-2 rounded text-[12px] font-semibold bg-[#1ABC9C]/10 text-[#1ABC9C] border border-[#1ABC9C]/30 hover:bg-[#1ABC9C]/20 transition-colors">
              <Plus size={14}/> Upload Document
            </button>
          ) : (
            <div className="rounded-lg p-4 space-y-4" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
              {/* Drop zone */}
              {!uploadFile && !isParsing && !isConfirming && (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[#1ABC9C] transition-colors"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <Upload size={28} style={{ color: 'var(--text-muted)' }}/>
                  <div className="text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>Drop files here or click to browse</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>.pdf, .xlsx, .xls, .csv, .doc, .docx, .png, .jpg</div>
                  <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.xlsx,.xls,.csv,.doc,.docx,.png,.jpg" onChange={handleFilePick}/>
                </div>
              )}
              {/* File selected — pre-parse */}
              {uploadFile && !isParsing && !isConfirming && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText size={16} style={{ color: '#1ABC9C' }}/>
                    <div>
                      <div className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{uploadFile.name}</div>
                      <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{(uploadFile.size / 1024).toFixed(1)} KB</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleParse} className="px-3 py-1.5 rounded text-[11px] font-semibold bg-[#1ABC9C] text-white hover:bg-[#1ABC9C]/80 transition-colors">Parse Document</button>
                    <button onClick={handleCancel} className="px-3 py-1.5 rounded text-[11px] font-semibold hover:bg-[#232c37] transition-colors" style={{ color: 'var(--text-secondary)' }}>Cancel</button>
                  </div>
                </div>
              )}
              {/* Parsing animation */}
              {isParsing && (
                <div className="flex items-center justify-center gap-3 py-6">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-[#1ABC9C] animate-pulse" style={{ animationDelay: '0ms' }}/>
                    <div className="w-2 h-2 rounded-full bg-[#1ABC9C] animate-pulse" style={{ animationDelay: '200ms' }}/>
                    <div className="w-2 h-2 rounded-full bg-[#1ABC9C] animate-pulse" style={{ animationDelay: '400ms' }}/>
                  </div>
                  <span className="text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>AI is parsing document...</span>
                </div>
              )}
              {/* Extracted data form */}
              {isConfirming && parsedData && (
                <div className="space-y-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Extracted Information</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold uppercase mb-1 block" style={{ color: 'var(--text-muted)' }}>Event Name</label>
                      <input value={parsedData.name} onChange={e => setParsedData(p => ({ ...p, name: e.target.value }))} className="w-full px-2 py-1.5 rounded text-[12px] font-mono" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}/>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold uppercase mb-1 block" style={{ color: 'var(--text-muted)' }}>Event Type</label>
                      <select value={parsedData.type} onChange={e => setParsedData(p => ({ ...p, type: e.target.value }))} className="w-full px-2 py-1.5 rounded text-[12px] font-mono" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                        {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold uppercase mb-1 block" style={{ color: 'var(--text-muted)' }}>Start Date</label>
                      <input type="date" value={parsedData.startDate} onChange={e => setParsedData(p => ({ ...p, startDate: e.target.value }))} className="w-full px-2 py-1.5 rounded text-[12px] font-mono" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}/>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold uppercase mb-1 block" style={{ color: 'var(--text-muted)' }}>End Date</label>
                      <input type="date" value={parsedData.endDate} onChange={e => setParsedData(p => ({ ...p, endDate: e.target.value }))} className="w-full px-2 py-1.5 rounded text-[12px] font-mono" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}/>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold uppercase mb-1 block" style={{ color: 'var(--text-muted)' }}>Impact Level</label>
                      <select value={parsedData.impact} onChange={e => setParsedData(p => ({ ...p, impact: e.target.value }))} className="w-full px-2 py-1.5 rounded text-[12px] font-mono" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                        {['High','Medium','Low'].map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold uppercase mb-1 block" style={{ color: 'var(--text-muted)' }}>Expected Volume Impact</label>
                      <input value={parsedData.volumeImpact} onChange={e => setParsedData(p => ({ ...p, volumeImpact: e.target.value }))} className="w-full px-2 py-1.5 rounded text-[12px] font-mono" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}/>
                    </div>
                  </div>
                  {/* Channel checkboxes */}
                  <div>
                    <label className="text-[10px] font-semibold uppercase mb-1 block" style={{ color: 'var(--text-muted)' }}>Affected Channels</label>
                    <div className="flex flex-wrap gap-2">
                      {CHANNELS.map(ch => (
                        <label key={ch} className="flex items-center gap-1 text-[10px] cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                          <input type="checkbox" checked={parsedData.channels.includes(ch)} onChange={e => {
                            setParsedData(p => ({
                              ...p,
                              channels: e.target.checked ? [...p.channels, ch] : p.channels.filter(c => c !== ch),
                            }));
                          }}/>
                          {ch}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold uppercase mb-1 block" style={{ color: 'var(--text-muted)' }}>Notes</label>
                    <textarea value={parsedData.notes} onChange={e => setParsedData(p => ({ ...p, notes: e.target.value }))} rows={2} className="w-full px-2 py-1.5 rounded text-[12px] font-mono resize-none" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}/>
                  </div>
                  <div className="text-[10px] flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                    <FileText size={10}/> Source: {parsedData.source}
                  </div>
                  {/* Confirmation banner */}
                  <div className="bg-[#f5a623]/10 border border-[#f5a623]/30 rounded-lg p-3 flex items-start gap-2">
                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" style={{ color: '#f5a623' }}/>
                    <span className="text-[11px]" style={{ color: '#f5a623' }}>Please verify all extracted information for accuracy before submitting.</span>
                  </div>
                  {/* Action buttons */}
                  <div className="flex items-center gap-2">
                    <button onClick={handleConfirm} className="px-4 py-2 rounded text-[12px] font-semibold bg-[#1ABC9C] text-white hover:bg-[#1ABC9C]/80 transition-colors">Confirm &amp; Log Event</button>
                    <button onClick={() => setIsConfirming(false)} className="px-4 py-2 rounded text-[12px] font-semibold border hover:bg-[#232c37] transition-colors" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Edit &amp; Revise</button>
                    <button onClick={handleCancel} className="px-4 py-2 rounded text-[12px] font-semibold hover:bg-[#232c37] transition-colors" style={{ color: 'var(--text-muted)' }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Document Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Document Name','Type','Uploaded By','Date','Linked Event','Status','Actions'].map(h => (
                  <th key={h} className="text-left py-2 px-2 font-semibold uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {documents.map(doc => (
                <tr key={doc.id} className="hover:bg-[#232c37] transition-colors" style={{ borderBottom: '1px solid var(--border)' }}>
                  <td className="py-2 px-2 font-mono font-medium" style={{ color: 'var(--text-primary)' }}>
                    <div className="flex items-center gap-1.5">
                      <FileText size={12} style={{ color: '#1ABC9C' }}/> {doc.name}
                    </div>
                  </td>
                  <td className="py-2 px-2">
                    <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded uppercase" style={{
                      backgroundColor: doc.type === 'pdf' ? '#E74C6F' + '22' : doc.type === 'xlsx' ? '#2ECC71' + '22' : '#1ABC9C' + '22',
                      color: doc.type === 'pdf' ? '#E74C6F' : doc.type === 'xlsx' ? '#2ECC71' : '#1ABC9C',
                    }}>{doc.type}</span>
                  </td>
                  <td className="py-2 px-2" style={{ color: 'var(--text-secondary)' }}>{doc.uploadedBy}</td>
                  <td className="py-2 px-2 font-mono" style={{ color: 'var(--text-secondary)' }}>{doc.uploadedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td className="py-2 px-2" style={{ color: 'var(--text-secondary)' }}>{doc.linkedEvent}</td>
                  <td className="py-2 px-2">
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded" style={{
                      backgroundColor: doc.status === 'Confirmed' ? '#2ECC71' + '22' : '#f5a623' + '22',
                      color: doc.status === 'Confirmed' ? '#2ECC71' : '#f5a623',
                    }}>{doc.status}</span>
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-2">
                      <button className="hover:text-[#1ABC9C] transition-colors" style={{ color: 'var(--text-muted)' }} title="View"><Eye size={13}/></button>
                      <button className="hover:text-[#1ABC9C] transition-colors" style={{ color: 'var(--text-muted)' }} title="Download"><Download size={13}/></button>
                      <button className="hover:text-[#E74C6F] transition-colors" style={{ color: 'var(--text-muted)' }} title="Delete"><Trash2 size={13}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
};

// ============================================================
// MAIN APP
// ============================================================
export default function ShippingSLAApp() {
  // Restore session from localStorage
  const savedSession = useRef(() => {
    try {
      const s = localStorage.getItem('kdc_session');
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  });
  const initSession = savedSession.current();

  const [currentUser, setCurrentUser] = useState(initSession?.user || null);
  const [channelSlas, setChannelSlas] = useState({ default: DEFAULT_SLAS });
  const [kpiTargets, setKpiTargets] = useState(DEFAULT_KPI_TARGETS);
  const [rawData, setRawData] = useState(generateMockShipments());
  const [uploadedData, setUploadedData] = useState(null);
  const [activePage, setActivePage] = useState(initSession?.page || 'exec');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kdc_favorites')) || []; } catch { return []; }
  });
  const toggleFavorite = (id) => {
    setFavorites(prev => {
      const next = prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id];
      localStorage.setItem('kdc_favorites', JSON.stringify(next));
      return next;
    });
  };
  const [filterCause, setFilterCause] = useState('all');
  // PR4b2: default 7d (was 90d) keeps initial Snowflake payload small (~6MB for 1 week)
  const [dateRange, setDateRange] = useState('7d');
  // PR4b2: custom date range {from, to} as YYYY-MM-DD strings (only used when dateRange === 'custom')
  const [customRange, setCustomRange] = useState({});
  // PR4b2/PR4b3: lifted from SplitShipmentPage hook so header summary + badge + filter-bar hint can react to it.
  // Shape: { source: 'live'|'mock'|'mock-fallback', count: number, filter: {from, to}|null } | null
  const [splitMeta, setSplitMeta] = useState(null);
  const splitSource = splitMeta?.source ?? null;  // legacy alias used by badge/hint
  // PR Geo-4-fix: GeoPage now publishes the same meta shape so the App-level
  // header (LIVE badge + count + date picker) can mirror Split's pattern.
  // currentMeta dispatches by activePage so a single header block renders
  // correctly for either page. Note count semantics differ by page: Split
  // ships UPS-only count (upsHookDataCount), Geographic ships hookData.length
  // (UPS + Truck — user-stated decision: always-total, channel-filter-immune).
  const [geoMeta, setGeoMeta] = useState(null);
  // PR Overview-A: Overview now publishes the same meta shape via OverviewPage's
  // useSplitShipments hook, so the header LIVE badge + count + date window
  // also light up on the exec page.
  const [overviewMeta, setOverviewMeta] = useState(null);
  const currentMeta = activePage === 'split' ? splitMeta
    : activePage === 'geo'  ? geoMeta
    : activePage === 'exec' ? overviewMeta
    : null;
  const currentSource = currentMeta?.source ?? null;
  // PR4b3: drives the header summary dropdown on the Split page.
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const datePickerRef = useRef(null);
  const [filterRegion, setFilterRegion] = useState('all');
  // PR Sample-Order-Filter: App-level sample order filter.
  // Operations team standard: sample orders (Sales_doc._type = 'Sample Order')
  // are excluded from default views since they're not part of standard
  // operational fact. User intent (verbatim): "default 에서는 sample order
  // 를 포함하지 않고 보여주고 뭔가 버튼을 추가하면 sample order 도 같이 볼
  // 수 있는 필터". Toggle states:
  //   - 'exclude_samples' (default) — hide Sample Order rows
  //   - 'all' — show every row (sample + non-sample)
  //   - 'samples_only' — show only Sample Order rows
  // Page-aware: passed as prop to SplitShipmentPage and GeoPage; each page
  // applies the filter at its pageData level (upstream of all metric/UI
  // useMemos), so a single source-of-truth toggle drives Split + Geographic
  // simultaneously. Other pages (Exec / SKU / etc.) stay on mock and aren't
  // affected operationally.
  const [sampleOrderFilter, setSampleOrderFilter] = useState('exclude_samples');
  const [selectedChannels, setSelectedChannels] = useState([]); // empty = All channels
  const [selectedShipment, setSelectedShipment] = useState(null);
  const [selectedMetric, setSelectedMetric] = useState(null);
  const [theme, setTheme] = useState(initSession?.theme || 'light');
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dataSource, setDataSource] = useState('mock'); // 'mock' | 'live'
  const [isConnecting, setIsConnecting] = useState(false);
  const [liveToast, setLiveToast] = useState(null);
  const fileInputRef = useRef(null);

  const handleDataSourceToggle = useCallback(async () => {
    if (dataSource === 'live') {
      setDataSource('mock');
      return;
    }
    setIsConnecting(true);
    try {
      const res = await fetch('http://localhost:3001/api/health');
      if (!res.ok) throw new Error('API server returned an error');
      setDataSource('live');
      setLiveToast({ type: 'success', msg: 'Connected to live Snowflake data' });
    } catch {
      setLiveToast({ type: 'error', msg: 'API server unreachable — staying in Mock mode' });
    } finally {
      setIsConnecting(false);
      setTimeout(() => setLiveToast(null), 3500);
    }
  }, [dataSource]);

  // Persist session to localStorage
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('kdc_session', JSON.stringify({ user: currentUser, page: activePage, theme }));
    } else {
      localStorage.removeItem('kdc_session');
    }
  }, [currentUser, activePage, theme]);

  // PR4b3: Close date-picker dropdown when clicking outside it.
  useEffect(() => {
    if (!datePickerOpen) return;
    const onMouseDown = (e) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target)) {
        setDatePickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [datePickerOpen]);

  // PR4b3 → PR Overview-A: Close the dropdown when leaving any page that uses
  // the live date picker. Originally Split-only; now Split + Geographic + Overview.
  useEffect(() => {
    if (activePage !== 'split' && activePage !== 'geo' && activePage !== 'exec') {
      setDatePickerOpen(false);
    }
  }, [activePage]);

  // Data refresh handler
  const handleDataRefresh = useCallback(() => {
    setIsRefreshing(true);
    setTimeout(() => {
      setRawData(generateMockShipments());
      setLastRefresh(new Date());
      setIsRefreshing(false);
    }, 800);
  }, []);

  const THEME = theme === 'dark' ? {
    bgPrimary: '#0f1419',
    bgPanel: '#1a2129',
    bgPanelAlt: '#232c37',
    bgInput: '#0f1419',
    border: '#2d3744',
    textPrimary: '#e8ecef',
    textSecondary: '#8a95a3',
    textMuted: '#5d6b7a',
    accentBlue: '#1ABC9C',
    green: '#2ECC71',
    amber: '#f5a623',
    red: '#E74C6F',
    purple: '#2C3E9B',
    brandRed: '#CE1126',
    topBar: '#1a2129',
  } : {
    bgPrimary: '#F0EDE5',
    bgPanel: '#ffffff',
    bgPanelAlt: '#F5F2EC',
    bgInput: '#FAFAF8',
    border: '#DDD9D1',
    textPrimary: '#1e293b',
    textSecondary: '#475569',
    textMuted: '#94a3b8',
    accentBlue: '#1ABC9C',
    green: '#27AE60',
    amber: '#E67E22',
    red: '#E74C6F',
    purple: '#2C3E9B',
    brandRed: '#CE1126',
    topBar: '#CE1126',
  };

  const data = uploadedData || rawData;
  const userRole = currentUser ? ROLES[currentUser.role] : null;

  const getSlas = (channel) => channelSlas[channel] || channelSlas.default;

  const filtered = useMemo(() => {
    return data.filter(r => {
      if (filterCause !== 'all' && r.cause !== filterCause) return false;
      if (filterRegion !== 'all' && r.region !== filterRegion) return false;
      if (selectedChannels.length > 0 && !selectedChannels.includes(r.channel)) return false;
      return true;
    });
  }, [data, filterCause, filterRegion, selectedChannels]);

  // ============================================================
  // METRICS
  // ============================================================
  const metrics = useMemo(() => {
    const total = filtered.length;
    const delayed = filtered.filter(r => r.cause !== '').length;
    const onTimeShip = filtered.filter(r => r.onTimeShip).length;
    const withDelivery = filtered.filter(r => r.onTimeDelivery !== null);
    const onTimeDeliv = withDelivery.filter(r => r.onTimeDelivery).length;
    const damageCount = filtered.filter(r => r.cause === 'Damage').length;

    const avgO2D = filtered.reduce((s, r) => s + diffMin(r.orderCreate, r.shipConfirm), 0) / (total || 1);

    return {
      total,
      delayed,
      onTimeShipPct: total ? onTimeShip/total : 0,
      onTimeDelivPct: withDelivery.length ? onTimeDeliv/withDelivery.length : 0,
      damageRate: total ? damageCount/total : 0,
      avgO2DHrs: avgO2D/60,
    };
  }, [filtered]);

  // Cause breakdown
  const causeBreakdown = useMemo(() => {
    const counts = {};
    filtered.forEach(r => { if (r.cause) counts[r.cause] = (counts[r.cause]||0)+1; });
    return Object.entries(counts).map(([k,v]) => ({ name: CAUSE_LABELS[k], value: v, raw: k }));
  }, [filtered]);

  // Trend by day
  const trendData = useMemo(() => {
    const byDay = {};
    filtered.forEach(r => {
      const key = r.orderCreate.toISOString().slice(0,10);
      if (!byDay[key]) byDay[key] = { date: key.slice(5), UPS:0, DC:0, Missing:0, Damage:0, Other:0, total:0 };
      byDay[key].total++;
      if (r.cause) byDay[key][r.cause]++;
    });
    return Object.values(byDay).sort((a,b) => a.date.localeCompare(b.date));
  }, [filtered]);

  // Stage durations — targets pulled from admin-configured SLAs (per channel)
  const stageData = useMemo(() => {
    const getters = {
      stage1: r => diffMin(r.orderCreate, r.confirm),
      stage2: r => diffMin(r.confirm, r.deliveryPost),
      stage3: r => diffMin(r.deliveryPost, r.scaleReceived),
      stage4: r => diffMin(r.scaleReceived, r.waveRelease),
      stage5: r => diffMin(r.waveRelease, r.pickComplete),
      stage6: r => diffMin(r.pickComplete, r.packComplete),
      stage7: r => diffMin(r.packComplete, r.shipConfirm),
      stage8: r => diffMin(r.shipConfirm, r.carrierScan),
    };
    const baseSlas = channelSlas.default;
    return baseSlas.map(s => {
      const get = getters[s.key];
      const vals = filtered.map(r => {
        const channelTarget = (channelSlas[r.channel] || channelSlas.default).find(x => x.key === s.key)?.target || s.target;
        return { val: get(r), target: channelTarget };
      }).filter(v => v.val >= 0);
      const avg = vals.reduce((a, b) => a + b.val, 0) / (vals.length || 1);
      const sorted = [...vals].map(v => v.val).sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
      const breaches = vals.filter(v => v.val > v.target).length;
      return {
        name: `${s.id}. ${s.name}`, system: s.system, target: s.target,
        avg: Math.round(avg), p95: Math.round(p95),
        breachPct: vals.length ? breaches / vals.length : 0,
        overTarget: avg > s.target,
      };
    });
  }, [filtered, channelSlas]);

  const bottleneck = useMemo(() => {
    const ranked = [...stageData].sort((a,b) => b.breachPct - a.breachPct);
    return ranked[0];
  }, [stageData]);

  // Regional data
  const regionalData = useMemo(() => {
    const byRegion = {};
    filtered.forEach(r => {
      if (!byRegion[r.region]) byRegion[r.region] = { region: r.region, total: 0, delayed: 0, causes: {} };
      byRegion[r.region].total++;
      if (r.cause) {
        byRegion[r.region].delayed++;
        byRegion[r.region].causes[r.cause] = (byRegion[r.region].causes[r.cause]||0)+1;
      }
    });
    return Object.values(byRegion).map(d => {
      const topCause = Object.entries(d.causes).sort((a,b) => b[1]-a[1])[0];
      return {
        ...d,
        delayRate: d.total ? d.delayed/d.total : 0,
        topCause: topCause ? CAUSE_LABELS[topCause[0]] : '—',
        topCauseKey: topCause ? topCause[0] : null,
      };
    }).sort((a,b) => b.delayRate - a.delayRate);
  }, [filtered]);

  // State-level data
  const stateData = useMemo(() => {
    const byState = {};
    filtered.forEach(r => {
      if (!byState[r.state]) byState[r.state] = { state: r.state, zone: r.zone, total: 0, delayed: 0, damage: 0 };
      byState[r.state].total++;
      if (r.cause) byState[r.state].delayed++;
      if (r.cause === 'Damage') byState[r.state].damage++;
    });
    return Object.values(byState).map(d => ({
      ...d,
      delayRate: d.total ? d.delayed/d.total : 0,
      damageRate: d.total ? d.damage/d.total : 0,
    })).sort((a,b) => b.delayRate - a.delayRate);
  }, [filtered]);

  const regions = ['all', ...new Set(data.map(r => r.region))];

  // CSV Upload
  const handleUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        const lines = text.split('\n').filter(l => l.trim());
        const headers = lines[0].split(',').map(h => h.trim());
        const parsed = lines.slice(1).map((line, i) => {
          const cols = line.split(',');
          const obj = {};
          headers.forEach((h, idx) => { obj[h] = cols[idx]?.trim(); });
          return {
            id: obj.ShipmentID || `UP-${i}`,
            orderId: obj.OrderID || '',
            customer: obj.CustomerID || '',
            carrier: obj.CarrierID || '',
            state: obj.ShipToState || 'GA',
            zone: 3, region: 'Southeast',
            orderCreate: new Date(obj.SAP_OrderCreate),
            confirm: new Date(obj.SAP_OrderConfirm),
            deliveryPost: new Date(obj.SAP_DeliveryPost),
            scaleReceived: new Date(obj.SCALE_Received),
            waveRelease: new Date(obj.SCALE_WaveRelease),
            pickComplete: new Date(obj.SCALE_PickComplete),
            packComplete: new Date(obj.SCALE_PackComplete),
            shipConfirm: new Date(obj.SCALE_ShipConfirm),
            carrierScan: new Date(obj.UPS_CarrierScan),
            delivered: obj.UPS_Delivered ? new Date(obj.UPS_Delivered) : null,
            promiseShip: new Date(obj.Promise_ShipDate),
            promiseDeliver: new Date(obj.Promise_DeliveryDate),
            orderValue: parseFloat(obj.OrderValue) || 0,
            cartons: parseInt(obj.Cartons) || 1,
            cause: obj.DelayRootCause || '',
            onTimeShip: new Date(obj.SCALE_ShipConfirm) <= new Date(obj.Promise_ShipDate),
            onTimeDelivery: obj.UPS_Delivered ? new Date(obj.UPS_Delivered) <= new Date(obj.Promise_DeliveryDate) : null,
          };
        });
        setUploadedData(parsed);
        setActivePage('exec');
      } catch (err) {
        alert('Parse error: ' + err.message);
      }
    };
    reader.readAsText(file);
  };

  // Login gate — must log in before anything else renders
  if (!currentUser) {
    return <LoginPage onLogin={(user) => { setCurrentUser(user); setActivePage('exec'); setLastRefresh(new Date()); }} THEME={THEME} theme={theme} setTheme={setTheme}/>;
  }

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="min-h-screen font-sans" style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif", background: theme === 'dark' ? `radial-gradient(ellipse at top right, rgba(26,188,156,0.06) 0%, rgba(44,62,155,0.03) 30%, transparent 60%), ${THEME.bgPrimary}` : `radial-gradient(ellipse at top right, rgba(26,188,156,0.08) 0%, rgba(44,62,155,0.04) 30%, transparent 60%), ${THEME.bgPrimary}`, color: THEME.textPrimary }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        body { font-family: 'IBM Plex Sans', system-ui, sans-serif; background: ${THEME.bgPrimary}; color: ${THEME.textPrimary}; }
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
        :root {
          --bg-primary: ${THEME.bgPrimary};
          --bg-panel: ${THEME.bgPanel};
          --bg-panel-alt: ${THEME.bgPanelAlt};
          --bg-input: ${THEME.bgInput};
          --border: ${THEME.border};
          --text-primary: ${THEME.textPrimary};
          --text-secondary: ${THEME.textSecondary};
          --text-muted: ${THEME.textMuted};
          --accent-blue: ${THEME.accentBlue};
          --green: ${THEME.green};
          --amber: ${THEME.amber};
          --red: ${THEME.red};
          --purple: ${THEME.purple};
        }
        /* Fluid typography — scales with viewport width */
        html { font-size: clamp(13px, 0.85vw + 6px, 18px); }

        @media (max-width: 640px) {
          html { font-size: 14px; }
          .recharts-wrapper { font-size: 10px; }
          .hide-mobile { display: none !important; }
          .mobile-stack { flex-direction: column !important; }
        }
        @media (max-width: 768px) {
          .hide-tablet { display: none !important; }
        }
        @media (min-width: 1920px) {
          html { font-size: 16px; }
        }
        @media (min-width: 2560px) {
          html { font-size: 18px; }
        }
        @media (min-width: 3840px) {
          html { font-size: 22px; }
        }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: ${THEME.bgPrimary}; }
        ::-webkit-scrollbar-thumb { background: ${THEME.border}; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: ${THEME.textMuted}; }
        ${theme === 'light' ? `
        /* Light mode overrides for hardcoded dark-theme colors */
        .bg-\\[\\#0f1419\\] { background-color: ${THEME.bgPrimary} !important; }
        .bg-\\[\\#1a2129\\] { background-color: ${THEME.bgPanel} !important; }
        .bg-\\[\\#232c37\\] { background-color: ${THEME.bgPanelAlt} !important; }
        .bg-\\[\\#151b22\\] { background-color: ${THEME.bgPrimary} !important; }
        .border-\\[\\#2d3744\\] { border-color: ${THEME.border} !important; }
        .text-\\[\\#e8ecef\\] { color: ${THEME.textPrimary} !important; }
        .text-\\[\\#8a95a3\\] { color: ${THEME.textSecondary} !important; }
        .text-\\[\\#5d6b7a\\] { color: ${THEME.textMuted} !important; }
        .text-\\[\\#c5ccd4\\] { color: ${THEME.textSecondary} !important; }
        .hover\\:bg-\\[\\#232c37\\]:hover { background-color: ${THEME.bgPanelAlt} !important; }
        .hover\\:bg-\\[\\#1a2129\\]:hover { background-color: ${THEME.bgPanelAlt} !important; }
        .hover\\:border-\\[\\#1ABC9C\\]:hover { border-color: ${THEME.accentBlue} !important; }
        .hover\\:text-\\[\\#1ABC9C\\]:hover { color: ${THEME.accentBlue} !important; }
        .hover\\:text-\\[\\#8a95a3\\]:hover { color: ${THEME.textSecondary} !important; }
        .hover\\:text-\\[\\#e8ecef\\]:hover { color: ${THEME.textPrimary} !important; }
        .focus\\:border-\\[\\#1ABC9C\\]:focus { border-color: ${THEME.accentBlue} !important; }
        select, input[type="number"], input[type="text"], input[type="password"] {
          background-color: ${THEME.bgInput} !important;
          border-color: ${THEME.border} !important;
          color: ${THEME.textPrimary} !important;
        }
        option { background-color: ${THEME.bgPanel}; color: ${THEME.textPrimary}; }
        .recharts-cartesian-grid line { stroke: ${THEME.border} !important; }
        .recharts-text { fill: ${THEME.textSecondary} !important; }
        .recharts-tooltip-wrapper .recharts-default-tooltip { background: ${THEME.bgPanel} !important; border-color: ${THEME.border} !important; }
        .recharts-tooltip-wrapper .recharts-default-tooltip .recharts-tooltip-label { color: ${THEME.textPrimary} !important; }
        .recharts-tooltip-wrapper .recharts-default-tooltip .recharts-tooltip-item { color: ${THEME.textPrimary} !important; }
        .recharts-tooltip-wrapper .recharts-default-tooltip .recharts-tooltip-item-name { color: ${THEME.textSecondary} !important; }
        ` : ''}
      `}</style>

      {/* SVG gradient definitions for charts */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <linearGradient id="gradTurquoise" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1ABC9C" stopOpacity={0.8}/>
            <stop offset="100%" stopColor="#1ABC9C" stopOpacity={0.2}/>
          </linearGradient>
          <linearGradient id="gradGreen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2ECC71" stopOpacity={0.8}/>
            <stop offset="100%" stopColor="#2ECC71" stopOpacity={0.2}/>
          </linearGradient>
          <linearGradient id="gradCerise" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E74C6F" stopOpacity={0.8}/>
            <stop offset="100%" stopColor="#E74C6F" stopOpacity={0.2}/>
          </linearGradient>
          <linearGradient id="gradPersianBlue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2C3E9B" stopOpacity={0.8}/>
            <stop offset="100%" stopColor="#2C3E9B" stopOpacity={0.2}/>
          </linearGradient>
          <linearGradient id="gradSkyBlue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3498DB" stopOpacity={0.8}/>
            <stop offset="100%" stopColor="#3498DB" stopOpacity={0.2}/>
          </linearGradient>
          <linearGradient id="gradPurple" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8E44AD" stopOpacity={0.8}/>
            <stop offset="100%" stopColor="#8E44AD" stopOpacity={0.2}/>
          </linearGradient>
          <linearGradient id="gradAmber" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F39C12" stopOpacity={0.8}/>
            <stop offset="100%" stopColor="#F39C12" stopOpacity={0.2}/>
          </linearGradient>
          <linearGradient id="gradGray" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7F8C8D" stopOpacity={0.8}/>
            <stop offset="100%" stopColor="#7F8C8D" stopOpacity={0.2}/>
          </linearGradient>
        </defs>
      </svg>

      {/* Sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setSidebarOpen(false)}/>
      )}

      {/* Sidebar drawer */}
      <div className={`fixed top-0 left-0 h-full w-72 z-50 transform transition-transform duration-200 ease-in-out flex flex-col ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`} style={{ background: THEME.bgPanel, borderRight: `1px solid ${THEME.border}` }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${THEME.border}` }}>
          <div className="flex items-center gap-2.5">
            <img src="/kiss-logo.png" alt="KISS" style={{ height: 24 }}/>
            <div className="h-5 w-px" style={{ background: THEME.border }}/>
            <div>
              <div className="text-sm font-semibold tracking-tight" style={{ color: THEME.textPrimary }}>Operations Intelligence</div>
              <div className="text-[11px] font-mono uppercase tracking-wider" style={{ color: THEME.textMuted }}>KDC · Savannah GA</div>
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="p-1.5 rounded transition-colors" style={{ color: THEME.textSecondary }}>
            <X size={16}/>
          </button>
        </div>

        {/* Navigation items — categorized */}
        <div className="overflow-y-auto py-2 flex-1 min-h-0">
          {[
            { category: 'Executive', items: [
              { id: 'exec', label: 'Overview', icon: Activity },
              { id: 'ai', label: 'AI Risk & Alerts', icon: Brain },
              { id: 'costs', label: '$ at Risk', icon: DollarSign },
              { id: 'economics', label: 'Economics', icon: PiggyBank },
              { id: 'customers', label: 'Customer Impact', icon: Users },
            ]},
            { category: 'Shipping', items: [
              { id: 'timeline', label: 'SLA Timeline', icon: Clock },
              { id: 'split', label: 'Split Shipments', icon: Split },
              { id: 'flightboard', label: 'Flight Board', icon: Radar },
              { id: 'rootcause', label: 'Root Cause', icon: AlertTriangle },
              { id: 'geo', label: 'Geographic', icon: MapPin },
              { id: 'sku', label: 'SKU Problems', icon: Layers },
              { id: 'waves', label: 'Wave Management', icon: Waves },
            ]},
            { category: 'Inventory', items: [
              { id: 'storage', label: 'Storage & Zones', icon: Warehouse },
            ]},
            { category: 'Receiving', items: [
              { id: 'inbound', label: 'Inbound Ops', icon: Anchor },
            ]},
            { category: 'Labor', items: [
              { id: 'labor', label: 'Workforce', icon: HardHat },
              { id: 'shift', label: 'Shift Heatmap', icon: Zap },
            ]},
            { category: 'Analytics', items: [
              { id: 'forecasts', label: 'Forecasts', icon: TrendingUp },
              { id: 'optimizer', label: 'Optimizer', icon: Cpu },
            ]},
            { category: 'Data', items: [
              { id: 'datahub', label: 'Data Hub', icon: Database },
            ]},
            { category: 'Planning', items: [
              { id: 'events', label: 'Event Calendar', icon: Calendar },
            ]},
            { category: 'Admin', items: [
              { id: 'admin', label: 'SLA Config', icon: Settings, adminOnly: true },
              { id: 'adminportal', label: 'Access Control', icon: Shield, adminOnly: true },
              { id: 'snowflake', label: 'Snowflake Config', icon: Database, adminOnly: true },
            ]},
          ].map((group, _gi, allGroups) => {
            const visibleItems = group.items.filter(tab => userRole.pages.includes(tab.id));
            if (visibleItems.length === 0) return null;

            // Collect all visible items for favorites lookup (only on first group render)
            const allItems = allGroups.flatMap(g => g.items).filter(t => userRole.pages.includes(t.id));

            return (
              <React.Fragment key={group.category}>
                {/* Favorites section — only render once, before first category */}
                {group.category === 'Executive' && favorites.length > 0 && (
                  <div className="mb-1">
                    <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-[0.12em] font-mono font-semibold flex items-center gap-1.5" style={{ color: '#f5a623' }}>
                      <Star size={10} fill="#f5a623"/> Favorites
                    </div>
                    {favorites.map(favId => {
                      const tab = allItems.find(t => t.id === favId);
                      if (!tab) return null;
                      const Icon = tab.icon;
                      return (
                        <button key={'fav-'+tab.id} onClick={() => { setActivePage(tab.id); setSidebarOpen(false); }}
                          className={`w-full flex items-center gap-3 px-4 py-2 text-[13px] font-medium transition-colors ${activePage === tab.id ? 'bg-[#1ABC9C]/10 text-[#1ABC9C] border-r-2 border-[#1ABC9C]' : ''}`}
                          style={activePage !== tab.id ? { color: THEME.textSecondary } : {}}>
                          <Icon size={14}/>
                          <span>{tab.label}</span>
                          <Star size={11} className="ml-auto flex-shrink-0" fill="#f5a623" style={{ color: '#f5a623' }}/>
                        </button>
                      );
                    })}
                    <div className="mx-4 my-1" style={{ borderBottom: `1px solid ${THEME.border}` }}/>
                  </div>
                )}

                <div className="mb-1">
                  <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-[0.12em] font-mono font-semibold" style={{ color: THEME.textMuted }}>{group.category}</div>
                  {visibleItems.map(tab => {
                    const Icon = tab.icon;
                    const isFav = favorites.includes(tab.id);
                    return (
                      <div key={tab.id} className="flex items-center">
                        <button onClick={() => { setActivePage(tab.id); setSidebarOpen(false); }}
                          className={`flex-1 flex items-center gap-3 px-4 py-2 text-[13px] font-medium transition-colors ${activePage === tab.id ? 'bg-[#1ABC9C]/10 text-[#1ABC9C] border-r-2 border-[#1ABC9C]' : ''}`}
                          style={activePage !== tab.id ? { color: THEME.textSecondary } : {}}>
                          <Icon size={14}/>
                          <span>{tab.label}</span>
                          {tab.adminOnly && <Lock size={10} className="text-[#E74C6F] ml-auto"/>}
                        </button>
                        {!tab.adminOnly && (
                          <button onClick={(e) => { e.stopPropagation(); toggleFavorite(tab.id); }}
                            className="px-2 py-2 transition-colors" title={isFav ? 'Remove from favorites' : 'Add to favorites'}>
                            <Star size={12} fill={isFav ? '#f5a623' : 'none'} style={{ color: isFav ? '#f5a623' : THEME.textMuted }} />
                          </button>
                        )}
                      </div>
                  );
                })}
              </div>
            </React.Fragment>
            );
          })}
        </div>

        {/* Sidebar footer — user badge + sign out */}
        <div className="flex-shrink-0 px-4 py-3" style={{ borderTop: `1px solid ${THEME.border}`, background: THEME.bgPanel }}>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 flex-1 px-2 py-1.5 rounded border" style={{ background: userRole.color+'15', borderColor: userRole.color+'40' }}>
              {(() => { const I = userRole.icon; return <I size={12} style={{ color: userRole.color }}/>; })()}
              <div className="leading-tight">
                <div className="text-[12px]" style={{ color: userRole.color }}>{currentUser.displayName}</div>
                <div className="text-[10px] text-[#8a95a3] uppercase tracking-wider">{userRole.label}</div>
              </div>
            </div>
            <button onClick={() => { setCurrentUser(null); setActivePage('exec'); setSidebarOpen(false); }}
              className="px-2 py-2 rounded bg-[#232c37] border border-[#2d3744] hover:border-[#E74C6F] hover:text-[#E74C6F] transition-colors text-[#8a95a3]" title="Sign out">
              <LogOut size={12}/>
            </button>
          </div>
        </div>
      </div>

      {/* Top bar */}
      <div className="sticky top-0 z-10" style={{ background: THEME.topBar, borderBottom: theme === 'dark' ? `1px solid ${THEME.border}` : 'none' }}>
        <div className="max-w-[2560px] mx-auto px-3 sm:px-4 md:px-6 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5 sm:gap-3">
            <button onClick={() => setSidebarOpen(true)} className="p-1.5 sm:p-2 rounded transition-colors" style={{ background: theme === 'light' ? 'rgba(255,255,255,0.15)' : THEME.bgPanelAlt, border: theme === 'light' ? '1px solid rgba(255,255,255,0.2)' : `1px solid ${THEME.border}`, color: theme === 'light' ? '#ffffff' : THEME.textSecondary }}>
              <Menu size={16}/>
            </button>
            <div className="flex items-center gap-2">
              {/* KISS logo */}
              <img src="/kiss-logo.png" alt="KISS" onClick={() => setActivePage('exec')} className="cursor-pointer" style={{ height: 24, filter: theme === 'light' ? 'brightness(0) invert(1)' : 'none' }}/>
              <div className="hidden sm:flex items-center gap-2">
                <div className="h-4 w-px" style={{ background: theme === 'light' ? 'rgba(255,255,255,0.3)' : THEME.border }}/>
                <div>
                  <div className="text-xs font-semibold tracking-tight" style={{ color: theme === 'light' ? '#ffffff' : THEME.textPrimary }}>Ops Intelligence</div>
                  <div className="hidden md:block text-[10px] font-mono uppercase tracking-wider" style={{ color: theme === 'light' ? 'rgba(255,255,255,0.7)' : THEME.textMuted }}>KDC · Savannah GA</div>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            {/* PR4b6: Removed the dim 7d/30d/90d/Custom preset buttons. PR4b3's gray-bar
                dropdown already covers all four presets including Custom From/To inputs, so
                this header strip was strictly redundant. dateRange / customRange state are
                preserved — the dropdown still uses them. */}
            {/* PR4b2: Split page hook source indicator (LIVE / MOCK / MOCK-FALLBACK).
                Shown only when activePage === 'split' since the hook only runs there. */}
            {/* PR Geo-4-fix: badge now driven by currentMeta so Geographic
                also gets LIVE / MOCK-FALLBACK / MOCK indication. */}
            {currentSource && (
              <span className="h-8 flex items-center px-2 rounded text-[10px] font-mono uppercase tracking-wider"
                style={
                  currentSource === 'live' ? { background: '#2ECC7120', border: '1px solid #2ECC7160', color: '#2ECC71', fontWeight: 600 } :
                  currentSource === 'mock-fallback' ? { background: '#E74C6F20', border: '1px solid #E74C6F60', color: '#E74C6F', fontWeight: 600 } :
                  { background: '#f5a62320', border: '1px solid #f5a62360', color: '#f5a623', fontWeight: 600 }
                }>
                {currentSource === 'mock-fallback' ? 'MOCK-FALLBACK' : currentSource.toUpperCase()}
              </span>
            )}
            {/* Data source toggle */}
            <button onClick={handleDataSourceToggle} disabled={isConnecting}
              title={dataSource === 'mock' ? 'Switch to Live Snowflake data' : 'Switch to Mock data'}
              className="h-8 flex items-center gap-1.5 px-2.5 rounded transition-colors"
              style={{ background: theme === 'light' ? 'rgba(255,255,255,0.15)' : THEME.bgPanelAlt, border: theme === 'light' ? '1px solid rgba(255,255,255,0.2)' : `1px solid ${THEME.border}`, cursor: isConnecting ? 'not-allowed' : 'pointer' }}>
              {isConnecting ? (
                <><RefreshCw size={11} className="animate-spin" style={{ color: '#1ABC9C' }}/><span style={{ color: theme === 'light' ? 'rgba(255,255,255,0.7)' : THEME.textSecondary }}>Connecting…</span></>
              ) : dataSource === 'live' ? (
                <><div className="w-1.5 h-1.5 rounded-full bg-[#1ABC9C] animate-pulse"/><span style={{ color: theme === 'light' ? '#ffffff' : '#1ABC9C' }}>LIVE</span></>
              ) : (
                <><div className="w-1.5 h-1.5 rounded-full bg-[#2ECC71] animate-pulse"/><span style={{ color: theme === 'light' ? '#ffffff' : THEME.textPrimary }}>{uploadedData ? 'CSV' : 'MOCK'}</span></>
              )}
            </button>
            {liveToast && (
              <div className="fixed top-12 right-4 z-50 px-3 py-2 rounded-md text-[12px] font-medium shadow-lg"
                style={liveToast.type === 'success' ? { background: '#2ECC7115', border: '1px solid #2ECC7130', color: '#2ECC71' } : { background: '#E74C6F15', border: '1px solid #E74C6F30', color: '#E74C6F' }}>
                {liveToast.msg}
              </div>
            )}
            {/* Data refresh */}
            <button onClick={handleDataRefresh} disabled={isRefreshing}
              className="h-8 flex items-center gap-1.5 px-2.5 rounded transition-colors"
              style={{ background: theme === 'light' ? 'rgba(255,255,255,0.15)' : THEME.bgPanelAlt, border: theme === 'light' ? '1px solid rgba(255,255,255,0.2)' : `1px solid ${THEME.border}`, color: theme === 'light' ? '#ffffff' : THEME.textSecondary }} title="Refresh data">
              <RefreshCw size={11} className={isRefreshing ? 'animate-spin' : ''}/>
              <span style={{ color: theme === 'light' ? 'rgba(255,255,255,0.6)' : THEME.textMuted }}>{lastRefresh.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
            </button>
            {/* Theme toggle — hidden on mobile */}
            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="h-8 w-8 hidden md:flex items-center justify-center rounded transition-colors"
              style={{ background: theme === 'light' ? 'rgba(255,255,255,0.15)' : THEME.bgPanelAlt, border: theme === 'light' ? '1px solid rgba(255,255,255,0.2)' : `1px solid ${THEME.border}`, color: theme === 'light' ? '#ffffff' : THEME.textSecondary }} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
              {theme === 'dark' ? <Sun size={13}/> : <Moon size={13}/>}
            </button>
            {userRole.canUploadData && (
              <button onClick={() => fileInputRef.current?.click()}
                className="h-8 hidden md:flex items-center gap-1.5 px-2.5 rounded transition-colors"
                style={{ background: theme === 'light' ? 'rgba(255,255,255,0.15)' : THEME.bgPanelAlt, border: theme === 'light' ? '1px solid rgba(255,255,255,0.2)' : `1px solid ${THEME.border}`, color: theme === 'light' ? '#ffffff' : THEME.textSecondary }}>
                <Upload size={11}/> Upload CSV
              </button>
            )}
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleUpload} className="hidden"/>
            {uploadedData && userRole.canResetData && (
              <button onClick={() => setUploadedData(null)} className="px-3 py-1.5 rounded transition-colors hidden md:block" style={{ background: theme === 'light' ? 'rgba(255,255,255,0.15)' : THEME.bgPanelAlt, border: theme === 'light' ? '1px solid rgba(255,255,255,0.2)' : `1px solid ${THEME.border}`, color: theme === 'light' ? '#ffffff' : THEME.textSecondary }}>
                Reset to Mock
              </button>
            )}
            {/* User badge */}
            <div className="h-8 flex items-center gap-1.5 px-2.5 rounded" style={{ background: theme === 'light' ? 'rgba(255,255,255,0.15)' : userRole.color+'15', border: theme === 'light' ? '1px solid rgba(255,255,255,0.25)' : `1px solid ${userRole.color}40` }}>
              {(() => { const I = userRole.icon; return <I size={11} style={{ color: theme === 'light' ? '#ffffff' : userRole.color }}/>; })()}
              <span className="text-[11px] font-medium hidden md:inline" style={{ color: theme === 'light' ? '#ffffff' : userRole.color }}>{currentUser.displayName}</span>
              <span className="text-[11px] font-medium md:hidden" style={{ color: theme === 'light' ? '#ffffff' : userRole.color }}>{currentUser.displayName?.charAt(0)}</span>
            </div>
            <button onClick={() => { setCurrentUser(null); setActivePage('exec'); }}
              className="h-8 w-8 flex items-center justify-center rounded transition-colors"
              style={{ background: theme === 'light' ? 'rgba(255,255,255,0.15)' : THEME.bgPanelAlt, border: theme === 'light' ? '1px solid rgba(255,255,255,0.2)' : `1px solid ${THEME.border}`, color: theme === 'light' ? '#ffffff' : THEME.textSecondary }} title="Sign out">
              <LogOut size={11}/>
            </button>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="max-w-[2560px] mx-auto px-3 sm:px-4 md:px-6 py-3 space-y-2" style={{ borderBottom: `1px solid ${THEME.border}`, background: THEME.bgPrimary }}>
        <div className="flex items-center gap-3 flex-wrap">
          {/* PR Sample-Order-Filter-Visibility-Fix: gate the entire filter
              cluster (Filters label + All causes + All regions + Exclude
              samples) behind activePage === 'split'. User-stated intent
              ("일단" = for now): all three dropdowns are Split-only — other
              pages don't show them. Filter STATE remains App-level so the
              values persist across navigation and a future page can opt back
              in by removing this gate. */}
          {activePage === 'split' && (
            <>
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-[#5d6b7a] font-mono">
                <Filter size={11}/> Filters
              </div>
              {/* PR16: drives Split's filteredPageData pipeline. ROOT_CAUSE_LABELS
                  (Manifest / UPS Trailer / Zone / Wave / Unclassified) is the
                  only option list now that this is Split-only. */}
              {/* PR Sample-Order-Filter-Style-Fix: theme-aware via CSS variables
                  (matches SearchableDropdown + sampleOrderFilter). */}
              <select value={filterCause} onChange={e => setFilterCause(e.target.value)}
                className="text-[12px] font-mono px-2 py-1 rounded outline-none focus:border-[#1ABC9C]"
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                }}>
                <option value="all">All causes</option>
                {ROOT_CAUSE_ORDER.map(k => <option key={k} value={k}>{ROOT_CAUSE_LABELS[k]}</option>)}
              </select>
              {/* PR17a: SearchableDropdown for the 20-30 state codes lifted
                  from splitMeta.regions. */}
              <SearchableDropdown
                options={splitMeta?.regions || ['all']}
                value={filterRegion}
                onChange={setFilterRegion}
                placeholder="All regions"
                getLabel={r => r === 'all' ? 'All regions' : r}
              />
              {/* PR Sample-Order-Filter: App-level sample order toggle. Now
                  Split-only per PR Sample-Order-Filter-Visibility-Fix; the
                  STATE stays App-level so future pages (Geographic etc.) can
                  opt back in without re-plumbing.

                  PR Sample-Order-Filter-Style-Fix: CSS variables for
                  light+dark consistency with SearchableDropdown. */}
              <select value={sampleOrderFilter} onChange={e => setSampleOrderFilter(e.target.value)}
                className="text-[12px] font-mono px-2 py-1 rounded outline-none focus:border-[#1ABC9C]"
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                }}>
                <option value="exclude_samples">Exclude samples</option>
                <option value="all">All orders</option>
                <option value="samples_only">Samples only</option>
              </select>
            </>
          )}
          {/* PR4b3 → PR Geo-4-fix: live, clickable summary dropdown for any
              page that publishes meta via onMetaChange. Currently Split +
              Geographic; future live pages just need to set their meta to
                opt in. References changed from splitMeta to currentMeta
              so the same dropdown renders for whichever page is active. */}
          {(activePage === 'split' || activePage === 'geo' || activePage === 'exec') ? (
            <div className="ml-auto relative hidden sm:block" ref={datePickerRef}>
              <button
                onClick={() => setDatePickerOpen(o => !o)}
                className="text-[11px] font-mono flex items-center gap-1.5 px-2 py-1 rounded transition-colors"
                style={{ color: THEME.textSecondary, background: datePickerOpen ? THEME.bgPanelAlt : 'transparent', border: `1px solid ${datePickerOpen ? THEME.border : 'transparent'}` }}>
                <Calendar size={11} style={{ color: THEME.textMuted }}/>
                <span>{PRESET_LABELS[dateRange] || PRESET_LABELS['7d']}</span>
                <span style={{ color: THEME.textMuted }}>·</span>
                <span style={{ color: THEME.textPrimary }}>
                  {fmtNum(currentMeta?.count ?? 0)} {currentMeta?.source === 'live' ? 'DOs' : 'shipments'}
                </span>
                {currentMeta?.filter?.from && currentMeta?.filter?.to && (
                  <>
                    <span style={{ color: THEME.textMuted }}>·</span>
                    <span style={{ color: THEME.textSecondary }}>{formatShortDate(currentMeta.filter.from)} – {formatShortDate(currentMeta.filter.to)}</span>
                  </>
                )}
                <ChevronDown size={11} style={{ color: THEME.textMuted, transform: datePickerOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}/>
              </button>

              {datePickerOpen && (
                <div className="absolute right-0 top-full mt-1 rounded-md shadow-lg z-50 min-w-[240px] p-1"
                  style={{ background: THEME.bgPanelAlt, border: `1px solid ${THEME.border}` }}>
                  {Object.entries(PRESET_LABELS).map(([value, label]) => {
                    const active = dateRange === value;
                    return (
                      <button key={value}
                        onClick={() => {
                          setDateRange(value);
                          if (value !== 'custom') {
                            setCustomRange({});
                            setDatePickerOpen(false);
                          }
                        }}
                        className="w-full text-left px-3 py-1.5 text-[12px] font-mono rounded transition-colors flex items-center justify-between"
                        style={active
                          ? { background: '#1ABC9C20', color: '#1ABC9C', fontWeight: 600 }
                          : { color: THEME.textSecondary, background: 'transparent' }}>
                        <span>{label}</span>
                        {active && <CheckCircle2 size={11}/>}
                      </button>
                    );
                  })}

                  {dateRange === 'custom' && (
                    <div className="mt-1 pt-2 px-2 pb-1" style={{ borderTop: `1px solid ${THEME.border}` }}>
                      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: THEME.textMuted }}>From</div>
                      <input type="date" value={customRange.from || ''}
                        onChange={e => setCustomRange(r => ({ ...r, from: e.target.value }))}
                        className="w-full h-7 px-2 rounded text-[11px] font-mono outline-none mb-2"
                        style={{ background: THEME.bgPrimary, border: `1px solid ${THEME.border}`, color: THEME.textPrimary, colorScheme: theme === 'light' ? 'light' : 'dark' }}/>
                      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: THEME.textMuted }}>To</div>
                      <input type="date" value={customRange.to || ''}
                        onChange={e => setCustomRange(r => ({ ...r, to: e.target.value }))}
                        className="w-full h-7 px-2 rounded text-[11px] font-mono outline-none"
                        style={{ background: THEME.bgPrimary, border: `1px solid ${THEME.border}`, color: THEME.textPrimary, colorScheme: theme === 'light' ? 'light' : 'dark' }}/>
                      <button
                        onClick={() => setDatePickerOpen(false)}
                        disabled={!customRange.from || !customRange.to}
                        className="mt-2 w-full h-7 text-[11px] font-mono uppercase tracking-wider rounded transition-colors"
                        style={(!customRange.from || !customRange.to)
                          ? { background: THEME.bgPanelAlt, border: `1px solid ${THEME.border}`, color: THEME.textMuted, cursor: 'not-allowed' }
                          : { background: '#1ABC9C', border: '1px solid #1ABC9C', color: '#0a0e12', fontWeight: 600 }}>
                        Apply
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="ml-auto text-[11px] font-mono text-[#5d6b7a] hidden sm:block">
              {fmtNum(filtered.length)} / {fmtNum(data.length)} shipments · Apr 1–17, 2026
            </div>
          )}
        </div>

        {/* Channel multi-select — hidden on mobile */}
        <div className="hidden sm:flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-[#5d6b7a] font-mono">
            Channel
          </div>
          <button onClick={() => setSelectedChannels([])}
            className={`px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wider border transition-all ${selectedChannels.length === 0 ? 'border-[#1ABC9C] bg-[#1ABC9C]/20 text-[#1ABC9C]' : 'border-[#2d3744] text-[#8a95a3] hover:border-[#1ABC9C]'}`}>
            All
          </button>
          {/* PR4b5 → PR Geo-4 → PR Overview-A polish: Narrow the chip set to
              the 3 live channels (BS-IVY / BS-RED / VIVACE) on Split, Geo,
              AND Exec (Overview) — these are the three pages with live wiring
              (BS-IVY/BS-RED/VIVACE via UPS, 002 plan §6b). Split's mock-mode
              also gets the 3-chip subset (PR Geo-4 user decision) so the chip
              set is page-driven, not source-driven. SKU / Reports / etc. keep
              all 11 chips so their mock data renders correctly.
              selectedChannels state is untouched — a user's BS-IVY pick
              survives navigation. */}
          {((activePage === 'split' || activePage === 'geo' || activePage === 'exec') ? LIVE_SPLIT_CHANNELS : CHANNELS).map(ch => {
            const group = getChannelGroup(ch);
            const color = getChannelColor(ch);
            const active = selectedChannels.includes(ch);
            return (
              <button key={ch}
                onClick={() => {
                  setSelectedChannels(prev =>
                    prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]
                  );
                }}
                className={`px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wider border transition-all flex items-center gap-1.5`}
                style={active ? {
                  background: color + '30',
                  borderColor: color,
                  color: color,
                  fontWeight: 600,
                } : {
                  background: 'transparent',
                  borderColor: '#2d3744',
                  color: '#8a95a3',
                }}>
                <span className="inline-block w-1.5 h-1.5 rounded-sm" style={{ background: color }}/>
                {ch}
                {active && <CheckCircle2 size={10}/>}
              </button>
            );
          })}
          {selectedChannels.length > 0 && (
            <button onClick={() => setSelectedChannels([])}
              className="px-2 py-1 rounded text-[11px] font-mono uppercase tracking-wider border border-[#E74C6F]/40 text-[#E74C6F] hover:bg-[#E74C6F]/10 flex items-center gap-1">
              <XCircle size={10}/> Clear ({selectedChannels.length})
            </button>
          )}
        </div>
      </div>

      <div className="max-w-[2560px] mx-auto p-3 sm:p-4 md:p-6">

        {/* ======================================================
            PAGE 1: EXECUTIVE SUMMARY
        ====================================================== */}
        {activePage === 'exec' && (
          <OverviewPage
            filtered={filtered}
            data={data}
            metrics={metrics}
            causeBreakdown={causeBreakdown}
            trendData={trendData}
            bottleneck={bottleneck}
            selectedChannels={selectedChannels}
            setSelectedChannels={setSelectedChannels}
            sampleOrderFilter={sampleOrderFilter}
            dateRange={dateRange}
            customRange={customRange}
            selectedMetric={selectedMetric}
            setSelectedMetric={setSelectedMetric}
            setActivePage={setActivePage}
            onMetaChange={setOverviewMeta}
          />
        )}

        {/* ======================================================
            PAGE 2: SLA STAGE TIMELINE
        ====================================================== */}
        {activePage === 'timeline' && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <KPI label="SAP Stages (1-3)" value={stageData.slice(0,3).reduce((s,x)=>s+x.avg,0)} unit="m" delta="order→SCALE handoff" deltaType="neutral"/>
              <KPI label="SCALE Stages (4-7)" value={stageData.slice(3,7).reduce((s,x)=>s+x.avg,0)} unit="m" delta="receive→ship confirm" deltaType="neutral"/>
              <KPI label="Carrier Stage (8)" value={stageData[7]?.avg || 0} unit="m" delta="ship confirm→scan" deltaType="neutral"/>
              <KPI label="Total Cycle" value={stageData.reduce((s,x)=>s+x.avg,0)} unit="m" delta={`${(stageData.reduce((s,x)=>s+x.avg,0)/60).toFixed(1)} hrs end-to-end`} deltaType="neutral"/>
            </div>

            <SectionCard title="Stage Performance — Avg vs SLA Target" subtitle="8-stage order lifecycle" tag="WATERFALL">
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={stageData} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2d3744"/>
                  <XAxis dataKey="name" stroke="#5d6b7a" style={{ fontSize: 10, fontFamily: 'IBM Plex Mono' }} angle={-15} textAnchor="end" height={60}/>
                  <YAxis stroke="#5d6b7a" style={{ fontSize: 10, fontFamily: 'IBM Plex Mono' }} label={{ value: 'Minutes', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#5d6b7a' } }}/>
                  <Tooltip contentStyle={{ background: '#1a2129', border: '1px solid #2d3744', fontSize: 11 }}/>
                  <Bar dataKey="avg" name="Avg (min)">
                    {stageData.map((e, i) => <Cell key={i} fill={e.overTarget ? '#E74C6F' : '#2ECC71'}/>)}
                  </Bar>
                  <Line type="monotone" dataKey="target" name="SLA Target" stroke="#f5a623" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }}/>
                </ComposedChart>
              </ResponsiveContainer>
            </SectionCard>

            <div className="mt-4">
              <SectionCard title="Stage Detail Table" subtitle="All 8 stages with SLA compliance">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[#5d6b7a] border-b border-[#2d3744] font-mono uppercase text-[11px] tracking-wider">
                      <th className="py-2 font-semibold">Stage</th>
                      <th className="py-2 font-semibold">System</th>
                      <th className="py-2 font-semibold text-right">Target</th>
                      <th className="py-2 font-semibold text-right">Avg</th>
                      <th className="py-2 font-semibold text-right">P95</th>
                      <th className="py-2 font-semibold text-right">Variance</th>
                      <th className="py-2 font-semibold text-right">Breach %</th>
                      <th className="py-2 font-semibold text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stageData.map((s, i) => (
                      <tr key={i} className="border-b border-[#2d3744] hover:bg-[#1a2129]">
                        <td className="py-2.5 font-medium">{s.name}</td>
                        <td className="py-2.5 font-mono text-[#8a95a3]">{s.system}</td>
                        <td className="py-2.5 font-mono text-right text-[#8a95a3]">{s.target}m</td>
                        <td className={`py-2.5 font-mono text-right ${s.overTarget ? 'text-[#E74C6F]' : 'text-[#2ECC71]'}`}>{s.avg}m</td>
                        <td className="py-2.5 font-mono text-right text-[#8a95a3]">{s.p95}m</td>
                        <td className={`py-2.5 font-mono text-right ${s.overTarget ? 'text-[#E74C6F]' : 'text-[#2ECC71]'}`}>
                          {s.overTarget ? '+' : ''}{s.avg - s.target}m
                        </td>
                        <td className="py-2.5 font-mono text-right">{fmtPct(s.breachPct)}</td>
                        <td className="py-2.5 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono uppercase ${s.overTarget ? 'bg-[#E74C6F]/20 text-[#E74C6F]' : 'bg-[#2ECC71]/20 text-[#2ECC71]'}`}>
                            {s.overTarget ? 'OVER' : 'OK'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </SectionCard>
            </div>

            <div className="mt-4">
              <SectionCard title="Individual Shipment Timeline" subtitle="Click a row to see full lifecycle" tag="GANTT">
                <div className="space-y-1.5">
                  {filtered.filter(r => r.cause).slice(0, 6).map((r) => {
                    const total = diffMin(r.orderCreate, r.carrierScan) || 1;
                    const segs = [
                      { w: diffMin(r.orderCreate, r.confirm), color: '#1ABC9C', label: 'Confirm' },
                      { w: diffMin(r.confirm, r.deliveryPost), color: '#6366f1', label: 'Delivery' },
                      { w: diffMin(r.deliveryPost, r.scaleReceived), color: '#8b5cf6', label: 'Handoff' },
                      { w: diffMin(r.scaleReceived, r.waveRelease), color: '#2C3E9B', label: 'Wave' },
                      { w: diffMin(r.waveRelease, r.pickComplete), color: '#f5a623', label: 'Pick' },
                      { w: diffMin(r.pickComplete, r.packComplete), color: '#f97316', label: 'Pack' },
                      { w: diffMin(r.packComplete, r.shipConfirm), color: '#E74C6F', label: 'Ship' },
                      { w: diffMin(r.shipConfirm, r.carrierScan), color: '#2ECC71', label: 'Carrier' },
                    ];
                    return (
                      <div key={r.id} onClick={() => setSelectedShipment(r)} className="cursor-pointer hover:bg-[#1a2129] rounded p-1.5 -m-1.5">
                        <div className="flex items-center gap-3 mb-1">
                          <div className="font-mono text-[11px] text-[#e8ecef] w-20">{r.id}</div>
                          <div className="text-[11px] text-[#8a95a3] flex-1">{r.customer} · {r.state}</div>
                          <div className="text-[11px] font-mono" style={{ color: CAUSE_COLORS[r.cause] }}>{CAUSE_LABELS[r.cause]}</div>
                          <div className="font-mono text-[11px] text-[#5d6b7a] w-16 text-right">{fmtHrs(total)}h</div>
                        </div>
                        <div className="flex h-3 rounded overflow-hidden">
                          {segs.map((s, i) => (
                            <div key={i} style={{ width: `${(s.w/total)*100}%`, background: s.color }} title={`${s.label}: ${s.w}m`}/>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
            </div>
          </>
        )}

        {/* ======================================================
            PAGE 3: GEOGRAPHIC ISSUES (HEAT MAP + ISSUE SELECTOR)
        ====================================================== */}
        {/* Role-gated pages */}
        {!userRole.pages.includes(activePage) ? (
          <AccessDenied currentUser={currentUser} page={activePage}/>
        ) : (
          <>
            {activePage === 'geo' && <GeoPage filtered={filtered} dateRange={dateRange} customRange={customRange} selectedChannels={selectedChannels} sampleOrderFilter={sampleOrderFilter} onMetaChange={setGeoMeta}/>}
            {activePage === 'ai' && <AIRiskPage filtered={filtered} data={data}/>}
            {activePage === 'split' && <SplitShipmentPage filtered={filtered} dateRange={dateRange} customRange={customRange} selectedChannels={selectedChannels} filterCause={filterCause} filterRegion={filterRegion} sampleOrderFilter={sampleOrderFilter} onMetaChange={setSplitMeta}/>}
            {activePage === 'costs' && <CostsPage filtered={filtered}/>}
            {activePage === 'customers' && <CustomerImpactPage filtered={filtered}/>}
            {activePage === 'sku' && <SKUProblemPage filtered={filtered}/>}
            {activePage === 'shift' && <ShiftHeatmapPage filtered={filtered}/>}
            {activePage === 'inbound' && <InboundPage />}
            {activePage === 'storage' && <StoragePage />}
            {activePage === 'labor' && <LaborPage />}
            {activePage === 'waves' && <WavesPage />}
            {activePage === 'optimizer' && <OptimizerPage />}
            {activePage === 'forecasts' && <ForecastPage />}
            {activePage === 'flightboard' && <FlightBoardPage data={data}/>}
            {activePage === 'economics' && <EconomicsPage filtered={filtered}/>}
            {activePage === 'datahub' && <DataHubPage data={filtered}/>}
            {activePage === 'events' && <EventCalendarPage currentUser={currentUser}/>}
            {activePage === 'admin' && userRole.canEditSLA && (
              <AdminSLAPage channelSlas={channelSlas} setChannelSlas={setChannelSlas} kpiTargets={kpiTargets} setKpiTargets={setKpiTargets} currentUser={currentUser}/>
            )}
            {activePage === 'adminportal' && (
              <AdminPortalPage currentUser={currentUser}/>
            )}
            {activePage === 'snowflake' && (
              <SnowflakeSettingsPage />
            )}

        {/* ======================================================
            PAGE 4: ROOT CAUSE DEEP DIVE
        ====================================================== */}
        {activePage === 'rootcause' && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {['UPS', 'DC', 'Missing', 'Damage'].map(cause => {
                const count = filtered.filter(r => r.cause === cause).length;
                const pct = metrics.total ? count/metrics.total : 0;
                return (
                  <div key={cause} className="bg-[#232c37] border border-[#2d3744] rounded-md p-4 hover:border-[#1ABC9C] transition-colors cursor-pointer" onClick={() => setFilterCause(cause)}>
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] uppercase tracking-wider text-[#5d6b7a] font-mono">{CAUSE_LABELS[cause]}</div>
                      <div className="w-2 h-2 rounded-full" style={{ background: CAUSE_COLORS[cause] }}/>
                    </div>
                    <div className="font-mono text-2xl font-semibold mt-2">{count}</div>
                    <div className="font-mono text-[12px] text-[#8a95a3] mt-0.5">{fmtPct(pct)} of total</div>
                    <div className="mt-2 flex items-center gap-1 text-[11px] text-[#1ABC9C] font-mono">
                      Drill in <ChevronRight size={10}/>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <SectionCard title={`${CAUSE_LABELS[filterCause] || 'All Causes'} — Breakdown`} subtitle="By customer & carrier">
                <div className="space-y-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-[#5d6b7a] font-mono mb-2">Top Customers Affected</div>
                    <div className="space-y-1">
                      {Object.entries(filtered.filter(r => filterCause === 'all' ? r.cause : r.cause === filterCause).reduce((acc, r) => { acc[r.customer] = (acc[r.customer]||0)+1; return acc; }, {})).sort((a,b) => b[1]-a[1]).slice(0,5).map(([k, v]) => (
                        <div key={k} className="flex items-center gap-2">
                          <div className="text-[12px] flex-1">{k}</div>
                          <div className="flex-1 h-1.5 bg-[#1a2129] rounded overflow-hidden">
                            <div className="h-full bg-[#1ABC9C]" style={{ width: `${(v/metrics.delayed)*100}%` }}/>
                          </div>
                          <div className="text-[12px] font-mono w-8 text-right">{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-[#5d6b7a] font-mono mb-2">Top Carriers Affected</div>
                    <div className="space-y-1">
                      {Object.entries(filtered.filter(r => filterCause === 'all' ? r.cause : r.cause === filterCause).reduce((acc, r) => { acc[r.carrier] = (acc[r.carrier]||0)+1; return acc; }, {})).sort((a,b) => b[1]-a[1]).slice(0,5).map(([k, v]) => (
                        <div key={k} className="flex items-center gap-2">
                          <div className="text-[12px] flex-1">{k}</div>
                          <div className="flex-1 h-1.5 bg-[#1a2129] rounded overflow-hidden">
                            <div className="h-full bg-[#f5a623]" style={{ width: `${(v/metrics.delayed)*100}%` }}/>
                          </div>
                          <div className="text-[12px] font-mono w-8 text-right">{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Proposed Fix Plan" subtitle="Principal-level recommendation" tag="ACTION">
                <div className="space-y-3">
                  {filterCause === 'UPS' && (
                    <>
                      <div className="bg-[#1a2129] rounded p-3 border-l-2 border-[#E74C6F]">
                        <div className="text-[11px] uppercase tracking-wider text-[#E74C6F] font-mono">Problem</div>
                        <div className="text-[13px] mt-1">UPS dwell time post-ship-confirm is elevated, especially for Zones 7-8. Root cause likely: late tender, trailer fragmentation, or missed pickup cutoff.</div>
                      </div>
                      <div className="bg-[#1a2129] rounded p-3 border-l-2 border-[#1ABC9C]">
                        <div className="text-[11px] uppercase tracking-wider text-[#1ABC9C] font-mono">Fix (3 steps)</div>
                        <ol className="text-[13px] mt-1 space-y-1 list-decimal pl-4">
                          <li>Move ship-confirm cutoff from 18:00 → 16:30 to align with UPS pickup window.</li>
                          <li>Consolidate Zone 7-8 LTL trailers; evaluate regional carrier for West Coast.</li>
                          <li>Set up daily UPS tender-to-scan SLA scorecard. Escalate any lane {'>'}8h.</li>
                        </ol>
                      </div>
                      <div className="bg-[#1a2129] rounded p-3 border-l-2 border-[#2ECC71]">
                        <div className="text-[11px] uppercase tracking-wider text-[#2ECC71] font-mono">Expected Impact</div>
                        <div className="text-[13px] mt-1">−35% UPS-cause delays within 30 days · OTD +2.5pp</div>
                      </div>
                    </>
                  )}
                  {filterCause === 'DC' && (
                    <>
                      <div className="bg-[#1a2129] rounded p-3 border-l-2 border-[#E74C6F]">
                        <div className="text-[11px] uppercase tracking-wider text-[#E74C6F] font-mono">Problem</div>
                        <div className="text-[13px] mt-1">Internal DC processing time exceeds SLA. Waves held, pick zones congested, pack backlogs.</div>
                      </div>
                      <div className="bg-[#1a2129] rounded p-3 border-l-2 border-[#1ABC9C]">
                        <div className="text-[11px] uppercase tracking-wider text-[#1ABC9C] font-mono">Fix (3 steps)</div>
                        <ol className="text-[13px] mt-1 space-y-1 list-decimal pl-4">
                          <li>Re-slot top 50 velocity SKUs to forward pick area. Rerun ABC analysis monthly.</li>
                          <li>Shift labor from 2nd shift to 1st shift cover peak morning waves.</li>
                          <li>Review wave release logic in SCALE — eliminate holds with no defensible reason.</li>
                        </ol>
                      </div>
                      <div className="bg-[#1a2129] rounded p-3 border-l-2 border-[#2ECC71]">
                        <div className="text-[11px] uppercase tracking-wider text-[#2ECC71] font-mono">Expected Impact</div>
                        <div className="text-[13px] mt-1">DC cycle time −90 min avg · Order-to-dock −15%</div>
                      </div>
                    </>
                  )}
                  {filterCause === 'Missing' && (
                    <>
                      <div className="bg-[#1a2129] rounded p-3 border-l-2 border-[#E74C6F]">
                        <div className="text-[11px] uppercase tracking-wider text-[#E74C6F] font-mono">Problem</div>
                        <div className="text-[13px] mt-1">Pickers hitting empty locations. Three-layer inventory discrepancy: SAP ↔ SCALE ↔ physical.</div>
                      </div>
                      <div className="bg-[#1a2129] rounded p-3 border-l-2 border-[#1ABC9C]">
                        <div className="text-[11px] uppercase tracking-wider text-[#1ABC9C] font-mono">Fix (3 steps)</div>
                        <ol className="text-[13px] mt-1 space-y-1 list-decimal pl-4">
                          <li>Daily SAP-SCALE variance report — any SKU with {'>'} 5% gap gets cycle count.</li>
                          <li>Fix TPA confirmation timing window (currently allows phantom committed inventory).</li>
                          <li>Empty-location alert in real-time for operators; auto-triggers cycle count.</li>
                        </ol>
                      </div>
                      <div className="bg-[#1a2129] rounded p-3 border-l-2 border-[#2ECC71]">
                        <div className="text-[11px] uppercase tracking-wider text-[#2ECC71] font-mono">Expected Impact</div>
                        <div className="text-[13px] mt-1">Inventory accuracy 97% → 99.3% · Missing-cause delays −60%</div>
                      </div>
                    </>
                  )}
                  {filterCause === 'Damage' && (
                    <>
                      <div className="bg-[#1a2129] rounded p-3 border-l-2 border-[#E74C6F]">
                        <div className="text-[11px] uppercase tracking-wider text-[#E74C6F] font-mono">Problem</div>
                        <div className="text-[13px] mt-1">Damage rate elevated on specific lanes. Likely causes: undersized cartons, insufficient dunnage, rough carrier handling.</div>
                      </div>
                      <div className="bg-[#1a2129] rounded p-3 border-l-2 border-[#1ABC9C]">
                        <div className="text-[11px] uppercase tracking-wider text-[#1ABC9C] font-mono">Fix (3 steps)</div>
                        <ol className="text-[13px] mt-1 space-y-1 list-decimal pl-4">
                          <li>ISTA-3A test on top-5 damaged SKU carton specs.</li>
                          <li>Upgrade dunnage for liquid-cosmetics lanes.</li>
                          <li>Damage claim data shared weekly with carrier for lane-level feedback.</li>
                        </ol>
                      </div>
                      <div className="bg-[#1a2129] rounded p-3 border-l-2 border-[#2ECC71]">
                        <div className="text-[11px] uppercase tracking-wider text-[#2ECC71] font-mono">Expected Impact</div>
                        <div className="text-[13px] mt-1">Damage rate 4.8% → 1.5% · Claims costs −$80k/qtr</div>
                      </div>
                    </>
                  )}
                  {filterCause === 'all' && (
                    <div className="text-[12px] text-[#8a95a3] text-center py-10">
                      Select a root cause above or from the filter to see the prescriptive fix plan.
                    </div>
                  )}
                </div>
              </SectionCard>
            </div>

            <SectionCard title="Affected Shipments" subtitle={`${filtered.filter(r => filterCause === 'all' ? r.cause : r.cause === filterCause).length} rows`}>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[#5d6b7a] border-b border-[#2d3744] font-mono uppercase text-[11px] tracking-wider">
                      <th className="py-2">Shipment</th>
                      <th className="py-2">Customer</th>
                      <th className="py-2">State</th>
                      <th className="py-2">Zone</th>
                      <th className="py-2">Carrier</th>
                      <th className="py-2">Cause</th>
                      <th className="py-2 text-right">Cycle (h)</th>
                      <th className="py-2 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.filter(r => filterCause === 'all' ? r.cause : r.cause === filterCause).slice(0, 12).map(r => (
                      <tr key={r.id} className="border-b border-[#2d3744] hover:bg-[#1a2129]">
                        <td className="py-2 font-mono">{r.id}</td>
                        <td className="py-2">{r.customer}</td>
                        <td className="py-2 font-mono">{r.state}</td>
                        <td className="py-2 font-mono text-[#8a95a3]">Z{r.zone}</td>
                        <td className="py-2 text-[#8a95a3]">{r.carrier}</td>
                        <td className="py-2">
                          <span className="font-mono text-[11px] px-1.5 py-0.5 rounded" style={{ color: CAUSE_COLORS[r.cause], background: `${CAUSE_COLORS[r.cause]}20` }}>
                            {CAUSE_LABELS[r.cause]}
                          </span>
                        </td>
                        <td className="py-2 font-mono text-right">{fmtHrs(diffMin(r.orderCreate, r.carrierScan))}</td>
                        <td className="py-2 font-mono text-right">${fmtNum(r.orderValue.toFixed(0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </>
        )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-[#2d3744] mt-8">
        <div className="max-w-[2560px] mx-auto px-3 sm:px-4 md:px-6 py-3 flex items-center justify-between text-[11px] font-mono text-[#5d6b7a]">
          <div className="flex items-center gap-4">
            <span>KDC Shipping SLA · v0.1 Prototype</span>
            <span>·</span>
            <span className="flex items-center gap-1"><Database size={10}/> {uploadedData ? 'User CSV' : 'Mock Data'}</span>
          </div>
          <div>Last refresh: {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      </div>

      {/* AI Chat Panel — admin and manager only */}
      {(currentUser.role === 'admin' || currentUser.role === 'manager') && <AiChatPanel />}

      {/* Shipment detail drawer */}
      {selectedShipment && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-8" onClick={() => setSelectedShipment(null)}>
          <div className="bg-[#1a2129] border border-[#2d3744] rounded-lg max-w-2xl w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[#5d6b7a] font-mono">Shipment Detail</div>
                <div className="text-xl font-semibold font-mono">{selectedShipment.id}</div>
                <div className="text-[12px] text-[#8a95a3] mt-1">{selectedShipment.customer} · {selectedShipment.state} · {selectedShipment.carrier}</div>
              </div>
              <button onClick={() => setSelectedShipment(null)} className="text-[#8a95a3] hover:text-[#e8ecef]">✕</button>
            </div>
            <div className="space-y-2">
              {[
                ['Order Create', selectedShipment.orderCreate],
                ['Order Confirm', selectedShipment.confirm],
                ['Delivery Post (SAP)', selectedShipment.deliveryPost],
                ['SCALE Received', selectedShipment.scaleReceived],
                ['Wave Release', selectedShipment.waveRelease],
                ['Pick Complete', selectedShipment.pickComplete],
                ['Pack Complete', selectedShipment.packComplete],
                ['Ship Confirm', selectedShipment.shipConfirm],
                ['Carrier Scan', selectedShipment.carrierScan],
                ['Delivered', selectedShipment.delivered],
              ].map(([label, val], i) => (
                <div key={i} className="flex justify-between items-center py-1.5 border-b border-[#2d3744] text-[12px]">
                  <span className="text-[#8a95a3]">{label}</span>
                  <span className="font-mono">{val ? val.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
