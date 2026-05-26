import { TrendingUp, TrendingDown } from 'lucide-react';

export const KPI = ({ label, value, unit, delta, deltaType, delta2, delta2Type, icon: Icon }) => (
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
