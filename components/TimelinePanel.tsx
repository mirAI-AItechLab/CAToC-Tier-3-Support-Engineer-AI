'use client';

import type { Case } from '@/types/api';

function formatToJST(isoLike: string) {
  if (!isoLike) return '';

  let s = isoLike;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !/[zZ]|[+\-]\d{2}:\d{2}$/.test(s)) {
    s = `${s}Z`;
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return isoLike; 

  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function TimelinePanel({ c }: { c: Case }) {
   const events = [...(c.timeline ?? [])].sort((a, b) => {
   const ta = Date.parse(a.timestamp);
   const tb = Date.parse(b.timestamp);
   if (Number.isNaN(ta) || Number.isNaN(tb)) return a.timestamp < b.timestamp ? 1 : -1;
   return tb - ta; 
 });

  return (
    <div>
      <h3 className="font-medium mb-2">Timeline</h3>
      <div className="space-y-2">
        {events.map((e) => (
          <div key={e.id} className="border rounded p-2">
            <div className="text-xs opacity-70 flex flex-wrap gap-2">
              <span>{formatToJST(e.timestamp)}</span>
              <span>{e.type}</span>
              <span>{e.actor}</span>
            </div>
            <div className="text-sm whitespace-pre-wrap">{e.message}</div>
            {e.metadata && (
              <details className="mt-1">
                <summary className="text-xs opacity-70 cursor-pointer">metadata</summary>
                <pre className="text-xs p-2 bg-black/5 rounded overflow-auto">
                  {JSON.stringify(e.metadata, null, 2)}
                </pre>
              </details>
            )}
          </div>
        ))}
        {events.length === 0 && <div className="opacity-60">No timeline events</div>}
      </div>
    </div>
  );
}
