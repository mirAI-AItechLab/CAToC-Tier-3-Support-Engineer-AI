'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Case } from '@/types/api';
import StatusBadge from '@/components/StatusBadge';
import { useRouter } from 'next/navigation';

function safeDate(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatJSTDateTimeParts(iso?: string | null) {
  const d = safeDate(iso);
  if (!d) return { date: '-', time: '' };

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

function relTime(target?: string | null) {
  const d = safeDate(target);
  if (!d) return { label: '-', isOverdue: false };
  const now = Date.now();
  const diff = d.getTime() - now;
  const abs = Math.abs(diff);

  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);

  const fmt =
    abs < 3600000 ? `${mins}m` : abs < 86400000 ? `${hours}h` : `${days}d`;

  if (diff < 0) return { label: `OVERDUE ${fmt}`, isOverdue: true };
  return { label: `in ${fmt}`, isOverdue: false };
}

function priorityBadge(p?: string | null) {
  const v = (p ?? '').toUpperCase();
  if (v === 'P0') return 'bg-red-50 text-red-700 border-red-200';
  if (v === 'P1') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (v === 'P2') return 'bg-yellow-50 text-yellow-800 border-yellow-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
}

function CopyableId({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); 
    navigator.clipboard.writeText(text);
    
    setCopied(true);
    setTimeout(() => setCopied(false), 2000); 
  };

  return (
    <div
      onClick={handleCopy}
      className="relative z-20 inline-flex items-center gap-2 cursor-copy hover:bg-slate-200/50 px-2 py-1 -ml-2 rounded transition-colors group/copy"
      title="クリックしてIDをコピー"
    >
      <span className="text-[14px] font-semibold font-mono text-slate-800">
        {text}
      </span>
      <span className={`text-[10px] transition-all ${copied ? 'text-green-600 font-bold' : 'text-slate-400 opacity-0 group-hover/copy:opacity-100'}`}>
        {copied ? 'Copied!' : '📋'}
      </span>
    </div>
  );
}

export function CaseList({ cases }: { cases: Case[] }) {
  const router = useRouter();
  return (
    <section className="premium-card no-sheen rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b premium-divider bg-gradient-to-b from-white/95 to-gray-50/80">
        <h2 className="font-semibold text-gray-900">Cases</h2>
        <div className="text-xs text-gray-500">{cases.length} items</div>
      </div>

      <div className="overflow-auto">
        <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-gray-500 bg-gradient-to-b from-white/95 to-gray-50/70">
          <tr>
            <th className="py-2 px-4">CASE ID</th>
            <th className="py-2 px-4">CASE</th>
            <th className="py-2 px-4">STATUS</th>
            <th className="py-2 px-4">PRIORITY</th>
            <th className="py-2 px-4">NEXT DUE</th>
            <th className="py-2 px-4">UPDATED</th>
          </tr>
        </thead>

          <tbody>
            {cases.map((c) => {
              const due = relTime(c.next_contact_due);
              const updated = safeDate(c.updated_at);

              return (
            
<tr
  key={c.id}
  role="link"
  tabIndex={0}
  onClick={() => router.push(`/cases/${encodeURIComponent(c.id)}`)}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      router.push(`/cases/${encodeURIComponent(c.id)}`);
    }
  }}
  className="group border-t border-black/5 cursor-pointer
             hover:bg-indigo-50/60 hover:shadow-[inset_0_0_0_1px_rgba(99,102,241,0.25)]
             focus:outline-none focus:ring-2 focus:ring-indigo-300/70
             transition-colors"
>

                    <td className="py-3 px-4 whitespace-nowrap align-top relative">
                    <CopyableId text={c.id} />
                    </td>

                <td className="py-3 px-4 min-w-[420px]">
                    <Link
                      className="font-semibold text-gray-900 hover:underline"
                      href={`/cases/${encodeURIComponent(c.id)}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {c.title}
                    </Link>
                    <div className="text-xs text-gray-600 line-clamp-1">
                      {c.description}
                    </div>

                    <div className="mt-1 text-[11px] text-gray-600 flex flex-wrap gap-x-3 gap-y-1">
                    <span className="px-2 py-0.5 rounded-full border border-black/10 bg-white/70">
                    From: {c.sender_name ? `${c.sender_name}` : (c.sender_email ?? '（未指定）')}
                    </span>

                    <span className="px-2 py-0.5 rounded-full border border-black/10 bg-white/70">
                    お客様: {c.customer_name ?? '（不明）'}
                    </span>
                  </div>

                    {!!c.waiting_for?.length && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {c.waiting_for.slice(0, 2).map((w) => {
      
                          const isCustomerWait = w.includes('Customer');
                          const badgeColor = isCustomerWait
                            ? "bg-blue-500/10 text-blue-600 border-blue-200" 
                            : "bg-red-500/10 text-red-600 border-red-200";   

                          return (
                            <span
                              key={w}
                              className={`text-[11px] px-2 py-0.5 rounded-full border ${badgeColor}`}
                              title={w}
                            >
                              {isCustomerWait ? '⏳' : '⚡'} Waiting: {w}
                            </span>
                          );
                      })}

                    {c.escalation_target && c.escalation_target !== 'None' && (
                       <div className="mt-2 mb-1">
                         <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-purple-100 text-purple-700 text-xs font-bold border border-purple-200 shadow-sm animate-pulse">
                           🚀 Rec: {c.escalation_target}
                         </span>
                       </div>
                    )}
                                          
                      {c.waiting_for.length > 2 && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full border border-black/10 bg-white/70 text-gray-700">
                            +{c.waiting_for.length - 2}
                          </span>
                        )}
                      </div>
                    )}
                  </td>

                  <td className="py-3 px-4 whitespace-nowrap">
                    <StatusBadge status={c.status} compact />
                  </td>

                  <td className="py-3 px-4 whitespace-nowrap">
                    <span
                      className={[
                        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold',
                        priorityBadge(c.priority),
                      ].join(' ')}
                    >
                      {c.priority ?? '-'}
                    </span>
                  </td>

<td className="py-3 px-4 whitespace-nowrap align-top">
  {(() => {
    const dueInfo = relTime(c.next_contact_due);
    const p = formatJSTDateTimeParts(c.next_contact_due);

    return (
      <div className="leading-tight">
        <div
          className={[
            'inline-flex items-center rounded-full px-2 py-0.5 text-[13px] font-semibold border',
            dueInfo.isOverdue
              ? 'bg-red-50 text-red-700 border-red-200'
              : 'bg-emerald-50 text-emerald-800 border-emerald-200',
          ].join(' ')}
          title={c.next_contact_due ?? ''}
        >
          {dueInfo.label}
        </div>

        <div className="mt-1">
          <div className="text-[12px] text-slate-700">{p.date}</div>
          <div className="text-[12px] text-slate-700">{p.time}</div>
        </div>
      </div>
    );
  })()}
</td>

<td className="py-3 px-4 whitespace-nowrap align-top">
  {(() => {
    const p = formatJSTDateTimeParts(c.updated_at);
    return (
      <div className="leading-tight">
        <div className="text-[12px] text-slate-700 font-medium">{p.date}</div>
        <div className="text-[12px] text-slate-700">{p.time}</div>
      </div>
    );
  })()}
</td>
                </tr>
              );
            })}

            {cases.length === 0 && (
              <tr>
                <td className="py-10 px-4 text-center text-gray-500" colSpan={6}>
                  <div className="text-sm font-semibold">No cases</div>
                  <div className="text-xs mt-1">
                    Run Quick Triage to create the first case.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
