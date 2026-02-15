'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/apiClient';
import type { Case } from '@/types/api';
import { CaseHeader } from '@/components/CaseHeader';
import { ProposalPanel } from '@/components/ProposalPanel';
import { ActionsPanel } from '@/components/ActionsPanel';
import { TimelinePanel } from '@/components/TimelinePanel';
import { ChatAssistant } from '@/components/ChatAssistant';
import GlobalHeader from "@/components/GlobalHeader"; 

export default function CaseCockpitPage() {
  const pathname = usePathname();
  const caseId = pathname?.split('/').pop();

  const [data, setData] = useState<Case | null>(null);
  const [err, setErr] = useState<string>('');
  const [loading, setLoading] = useState(false);

  async function refresh() {
    if (!caseId) return;
    if (!data) setLoading(true);
    
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
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [caseId]);

  const card =
    'premium-card no-sheen rounded-2xl overflow-hidden border border-white/40 bg-white/85 shadow-sm backdrop-blur-xl';

  const renderContent = () => {
    if (err) {
      return (
        <div className={`${card} p-4`}>
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
            <h3 className="font-bold">Error Loading Case</h3>
            <p>ID: {caseId}</p>
            <p>{err}</p>
            <p className="text-sm mt-2 text-gray-600">
              <a href="/" className="underline text-blue-600">
                トップページに戻る
              </a>
            </p>
          </div>
        </div>
      );
    }

    if (!data) {
      return (
        <div className={`${card} p-4 flex items-center justify-center h-64 text-slate-500`}>
          Loading case data... (ID: {caseId})
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <CaseHeader c={data} loading={loading} onRefresh={refresh} />

        <div className="grid grid-cols-12 gap-3">
          <section className={`col-span-12 lg:col-span-7 min-h-[420px] ${card}`}>
            <div className="p-4">
              <ProposalPanel c={data} />
            </div>
          </section>

          <section className={`col-span-12 lg:col-span-5 min-h-[420px] ${card}`}>
            <div className="p-4">
              <ActionsPanel c={data} onUpdated={setData} />
              <ChatAssistant caseId={caseId!} onUpdated={setData} />
            </div>

             {data.escalation_target && data.escalation_target !== 'None' && (
               <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                 <div className="text-xs text-purple-600 font-bold uppercase tracking-wider mb-1">
                   Escalation Suggestion
                 </div>
                 <div className="flex items-center gap-2 text-purple-900 font-semibold">
                   <span>🚀</span>
                   <span>{data.escalation_target}</span>
                 </div>
               </div>
             )}

          </section>

          <section className={`col-span-12 ${card}`}>
            <div className="p-4">
              <TimelinePanel c={data} />
            </div>
          </section>
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-screen flex-col bg-transparent">      
      <GlobalHeader />
      <main className="p-4 text-slate-900 flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto">
          {renderContent()}
        </div>
      </main>
    </div>
  );
}