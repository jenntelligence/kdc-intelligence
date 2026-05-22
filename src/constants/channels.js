// Channel constants. Extracted from src/ShippingSLAApp.jsx during PR R1.

// Distribution Channels — in the order the user listed
export const CHANNELS = [
  'CS - Bulk',
  'CS - DSDC',
  'BS-IVY',
  'BS-RED',
  'VIVACE',
  'AST',
  'IIO',
  'KIO',
  'ECOM - AMAZON 1P',
  'ECOM - AMAZON 3P',
  'ECOM - DTC',
];

// PR4b5: Live-mode subset for the Split page only — server-side scope
// is BS-IVY / BS-RED / VIVACE via UPS (see 002 plan §6b). The global
// header filter narrows to these chips so clicking a channel that has
// no live data is no longer possible. Other pages always show all 11.
export const LIVE_SPLIT_CHANNELS = ['BS-IVY', 'BS-RED', 'VIVACE'];

// Channel group colors (for pills)
export const CHANNEL_GROUP_COLORS = {
  'CS': '#1ABC9C',       // Hark Turquoise
  'BS': '#2C3E9B',       // Hark Persian Blue
  'VIVACE': '#E87149',   // Pantone 4011 C (matches CHANNEL_BRAND_COLORS for group-fallback consistency)
  'AST': '#2ECC71',      // Hark Green
  'IIO': '#3498DB',      // Hark Turquoise +10 (lighter blue)
  'KIO': '#1B2A4A',      // Hark Blue (dark navy)
  'ECOM': '#8E44AD',     // Hark Persian Blue +15 (purple shade)
};

// PR Overview-A polish: brand-specific colors for the 3 live channels
// (BS-IVY / BS-RED / VIVACE). Brand override first, then group lookup,
// then a neutral fallback. Non-live channels (CS-*, ECOM-*, AST, IIO,
// KIO) fall through to CHANNEL_GROUP_COLORS unchanged.
export const CHANNEL_BRAND_COLORS = {
  'BS-IVY': '#0033A0',   // Pantone 286 C — Trust Blue
  'VIVACE': '#E87149',   // Pantone 4011 C — Vivid orange/coral
  'BS-RED': '#BF0D3E',   // Pantone 193 C
};
