'use client';

import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/apiClient';
import type { Case, CaseStatus } from '@/types/api';
import { CaseList } from '@/components/CaseList';
import GlobalHeader from "@/components/GlobalHeader"; 
import { ChatAssistant } from '@/components/ChatAssistant'; 

function safeDate(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isOverdue(iso?: string | null) {
  const d = safeDate(iso);
  if (!d) return false;
  return d.getTime() < Date.now();
}

export default function HomePage() {
  const [cases, setCases] = useState<Case[]>([]);
  const [statusFilter, setStatusFilter] = useState<CaseStatus | 'ALL'>('ALL');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>('');  
  const [title, setTitle] = useState('0x80070643でWindow Updateの適用に失敗します');
  const [description, setDescription] = useState(`Windows Update の適用に失敗します。
昨日の夕方から「更新して再起動」を押下後、再起動後に「更新プログラムを構成できませんでした。変更を元に戻しています」と表示され、しばらく待つとサインイン画面に戻ります。
サインイン後に設定を開くと、更新のところに 0x80070643 が出ていて「再試行」しても同じ表示のままです。

※実施したこと
・2回再起動
・「再試行」を何回か押した
・電源を落として30分置いてから再度適用
→どれも適用できませんでした。

業務で使うPCなので、更新が当たらないと困ります。
対処策を教えてください。`);
  const [logs, setLogs] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const filtered = useMemo(() => {
    if (statusFilter === 'ALL') return cases;
    return cases.filter((c) => c.status === statusFilter);
  }, [cases, statusFilter]);

  const kpi = useMemo(() => {
    const total = cases.length;
    const overdue = cases.filter((c) => isOverdue(c.next_contact_due)).length;
    const dueSoon = cases.filter((c) => {
      const d = safeDate(c.next_contact_due);
      if (!d) return false;
      const diff = d.getTime() - Date.now();
      return diff >= 0 && diff <= 24 * 3600 * 1000;
    }).length;

    const waiting = cases.filter((c) =>
      c.status === 'WAITING_CUSTOMER' || c.status === 'WAITING_INTERNAL'
    ).length;

    const unapproved = cases.filter((c) => c.status === 'PROPOSED').length;

    return { total, overdue, dueSoon, waiting, unapproved };
  }, [cases]);

  useEffect(() => {
    setErr('');
    setLoading(true);

    const base = collection(db, 'cases');
    const q =
      statusFilter === 'ALL'
        ? query(base, orderBy('updated_at', 'desc'))
        : query(base, where('status', '==', statusFilter), orderBy('updated_at', 'desc'));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => d.data() as Case);
        setCases(items);
        setLoading(false);
      },
      (error) => {
        setErr(error?.message ?? 'Failed to subscribe cases');
        setLoading(false);
      }
    );

    return () => unsub();
  }, [statusFilter]);

  async function onCreateTriage() {
    setLoading(true);
    setErr('');
    try {
      const created = await api.triage({
        title,
        description,
        logs: logs || undefined,
        sender_email: senderEmail || undefined,
      });
      setCases((prev) => [created, ...prev]);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to triage');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-transparent">
      <GlobalHeader />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-4 space-y-4">          
          <header className="premium-card rounded-2xl p-4 bg-white shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h1 className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold tracking-tight text-slate-900">Support Cockpit</span>
                  <span className="text-sm font-semibold text-slate-500">サポートオーケストレーションエージェント</span>
                </h1>
                <p className="text-sm text-gray-500">Cases / Analyze / Triage / Draft / Approve / Escalate / to Close</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold bg-gray-50 text-gray-800">
                    Total: {kpi.total}
                  </span>
                  <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold bg-red-50 text-red-800 border-red-200">
                    Overdue: {kpi.overdue}
                  </span>
                  <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold bg-amber-50 text-amber-900 border-amber-200">
                    Due 24h: {kpi.dueSoon}
                  </span>
                  <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold bg-yellow-50 text-yellow-900 border-yellow-200">
                    Waiting: {kpi.waiting}
                  </span>
                  <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold bg-violet-50 text-violet-900 border-violet-200">
                    Unapproved: {kpi.unapproved}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">Filter</label>
                <select
                  className="border rounded-lg px-3 py-2 text-sm bg-white"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                >
                  <option value="ALL">ALL</option>
                  <option value="PROPOSED">PROPOSED</option>
                  <option value="WAITING_CUSTOMER">WAITING_CUSTOMER</option>
                  <option value="WAITING_INTERNAL">WAITING_INTERNAL</option>
                  <option value="VALIDATING">VALIDATING</option>
                  <option value="CLOSING">CLOSING</option>
                  <option value="CLOSED">CLOSED</option>
                </select>
              </div>
            </div>
          </header>

          {err && (
            <div className="rounded-2xl border border-red-200 bg-red-50 text-red-800 p-3">
              {err}
            </div>
          )}

          <section className="premium-card no-sheen rounded-2xl overflow-hidden bg-white shadow-sm">
            <div className="px-4 py-3 border-b premium-divider flex items-center justify-between bg-slate-50">
              <div>
                <h2 className="font-semibold text-slate-800">クイック起票（トリアージ）</h2>
                <p className="text-xs text-gray-500">
                  ケース作成 → 返信草案を自動生成 → &quot;承認&quot;で自動返信
                </p>
              </div>
              <div className="text-xs text-gray-500">
                {loading ? 'Working…' : 'Ready'}
              </div>
            </div>

            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-gray-600">Title</label>
                  <input
                    className="border rounded-lg px-3 py-2 w-full"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="title"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-gray-600">Sender Email (optional)</label>
                  <input
                    className="border rounded-lg px-3 py-2 w-full"
                    value={senderEmail}
                    onChange={(e) => setSenderEmail(e.target.value)}
                    placeholder="sender_email"
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs text-gray-600">Description</label>
                  <textarea
                    className="border rounded-lg px-3 py-2 w-full min-h-[90px]"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="description"
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs text-gray-600">Logs / GCS URL (optional)</label>
                  <textarea
                    className="border rounded-lg px-3 py-2 w-full min-h-[90px]"
                    value={logs}
                    onChange={(e) => setLogs(e.target.value)}
                    placeholder="logs or GCS URL"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-60 transition-colors"
                  onClick={onCreateTriage}
                  disabled={loading}
                >
                  {loading ? 'Running…' : 'Run Triage'}
                </button>

                <span className="text-xs text-gray-500">
                  ヒント：ログ/エラーコードが多いほど、原因仮説が鋭くなります。
                </span>
              </div>
            </div>
          </section>

          <CaseList cases={filtered} />
        </div>
      </main>
      <ChatAssistant /> 
    </div>
  );
}