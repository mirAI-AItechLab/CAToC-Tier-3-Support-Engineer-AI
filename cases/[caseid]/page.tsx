// app/cases/[caseId]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import type { Case } from '@/types/api';
import { CaseHeader } from '@/components/CaseHeader';
import { ProposalPanel } from '@/components/ProposalPanel';
import { ActionsPanel } from '@/components/ActionsPanel';
import { TimelinePanel } from '@/components/TimelinePanel';

export default function CaseCockpitPage({ params }: { params: { caseId: string } }) {
  const caseId = params.caseId;
  const [data, setData] = useState<Case | null>(null);
  const [err, setErr] = useState<string>('');
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setErr('');
    try {
      const c = await api.getCase(caseId);
      setData(c);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load case');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000); // simple polling
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  if (err) return <main className="p-4">{err}</main>;
  if (!data) return <main className="p-4">Loading...</main>;

  return (
    <main className="p-4 space-y-3">
      <CaseHeader c={data} loading={loading} onRefresh={refresh} />

      <div className="grid grid-cols-12 gap-3">
        {/* Middle: Proposal */}
        <section className="col-span-12 lg:col-span-7 border rounded p-3 min-h-[420px]">
          <ProposalPanel c={data} />
        </section>

        {/* Right: Actions */}
        <section className="col-span-12 lg:col-span-5 border rounded p-3 min-h-[420px]">
          <ActionsPanel c={data} onUpdated={setData} />
        </section>

        {/* Bottom: Timeline */}
        <section className="col-span-12 border rounded p-3">
          <TimelinePanel c={data} />
        </section>
      </div>
    </main>
  );
}
