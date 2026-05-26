export const SectionCard = ({ title, subtitle, children, className = '', tag }) => (
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
