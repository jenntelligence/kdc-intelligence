export const fmtHrs = (min) => (min/60).toFixed(1);
export const fmtPct = (n) => (n*100).toFixed(1) + '%';
export const fmtNum = (n) => n.toLocaleString('en-US');
