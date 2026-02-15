'use client';

import type { Case } from '@/types/api';

function fmtJst(iso?: string | null) {
  if (!iso) return { date: '-', time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '-', time: '' };

  const date = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

  const time = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);

  return { date, time };
}

export function CaseHeader({
  c,
  loading,
  onRefresh,
}: {
  c: Case;
  loading: boolean;
  onRefresh: () => void;
}) {
  const due = fmtJst(c.next_contact_due);
  const customerName = c.customer_name || '（AI解析中...）';
  const senderDisplay = c.sender_name 
    ? `${c.sender_name} <${c.sender_email ?? ''}>`
    : (c.sender_email ?? '（不明）');
  
  return (
    <header className="rounded-2xl border border-white/15 bg-slate-900/80 backdrop-blur-md shadow-lg px-5 py-4 text-white">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-white">
              {c.title}
            </h1>

            <span className="text-sm md:text-base font-mono font-semibold text-white/60 bg-white/10 px-2 py-0.5 rounded">
              ID:{c.id?.replace(/^case-/, '')}
            </span>
          </div>

          <div className="mt-3 text-sm text-white/80 flex flex-wrap gap-x-6 gap-y-2 items-center">
            
            <div className="flex items-center gap-2">
              <span className="text-white/50 text-xs uppercase tracking-wider font-bold">Status</span>
              <span className={`font-bold px-2 py-0.5 rounded text-xs ${
                c.status === 'PROPOSED' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 
                c.status === 'WAITING_CUSTOMER' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                'bg-slate-700 text-slate-300'
              }`}>
                {c.status}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-white/50 text-xs uppercase tracking-wider font-bold">Due</span>
              <b className={c.next_contact_due && new Date(c.next_contact_due) < new Date() ? 'text-red-400' : 'text-white'}>
                {due.date}{due.time ? ` ${due.time}` : ''}
              </b>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-white/50 text-xs uppercase tracking-wider font-bold">Client</span>
              <b className="text-white border-b border-white/20 pb-0.5">{customerName}</b>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-white/50 text-xs uppercase tracking-wider font-bold">From</span>
              <span className="text-white/90 font-mono text-xs truncate max-w-[300px]" title={senderDisplay}>
                {senderDisplay}
              </span>
            </div>
          </div>

          {c.waiting_for?.length > 0 && (
            <div className="mt-3 flex gap-2">
               {c.waiting_for.map((w, i) => {
                 
                 const isCustomerWait = w.includes('Customer');
                 const badgeClass = isCustomerWait
                   ? "bg-blue-500/20 text-blue-200 border-blue-500/30" 
                   : "bg-red-500/20 text-red-200 border-red-500/30";   

                 return (
                   <span key={i} className={`text-xs border px-2 py-1 rounded-md flex items-center gap-1 ${badgeClass}`}>
                     {isCustomerWait ? '⏳' : '⚡'} Waiting: {w}
                   </span>
                 );
               })}
            </div>
          )}        
      </div>

        <button
          className="border border-white/25 bg-white/10 hover:bg-white/20 text-white rounded-lg px-4 py-2 text-sm font-semibold self-start md:self-auto transition shadow-sm"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? '...' : 'Refresh'}
        </button>
      </div>
    </header>
  );
}