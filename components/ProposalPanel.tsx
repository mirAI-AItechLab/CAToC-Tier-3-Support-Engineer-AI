'use client';

import type { Case } from '@/types/api';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

export function ProposalPanel({ c }: { c: Case }) {
  const p = c.latest_proposal;

  if (c.status === 'ANALYZING' || (!p && c.status === 'NEW')) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        <div className="h-32 bg-gray-100 rounded"></div>
      </div>
    );
  }

  if (!p) {
    return (
      <div className="opacity-70 text-center py-10 bg-gray-50 rounded border border-dashed">
        <p>No proposal yet.</p>
        <p className="text-sm">Run Triage to start analysis.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 h-full overflow-y-auto pr-2">
      <div className="bg-blue-50 border border-blue-100 rounded p-3">
        <h3 className="font-bold text-blue-900 mb-1 flex items-center gap-2">
          🤖 AI分析 概要
          <span className="text-xs font-normal bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full">
            Confidence: {Math.round(p.confidence_score * 100)}%
          </span>
        </h3>
        <div className="text-sm text-blue-800 prose prose-sm max-w-none">
          <ReactMarkdown>{p.summary}</ReactMarkdown>
        </div>
      </div>

      <div>
        <h3 className="font-bold border-b pb-1 mb-2">🎯 想定要因</h3>
        <ul className="space-y-2">
          {p.hypotheses?.map((h, idx) => (
            <li key={idx} className="text-sm bg-white border rounded p-2 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold">{h.cause}</span>
                <span className={`text-xs px-2 py-0.5 rounded font-bold ${
                  h.likelihood === 'High' ? 'bg-red-100 text-red-700' :
                  h.likelihood === 'Medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100'
                }`}>
                  {h.likelihood}
                </span>
              </div>
              <p className="text-gray-600 text-xs">{h.reasoning}</p>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="font-bold border-b pb-1 mb-2">🛠️ 次のアクション</h3>
        <div className="space-y-3">
          {p.next_action_plan?.map((a, idx) => (
            <div key={idx} className="border rounded overflow-hidden text-sm">
              <div className="bg-gray-100 px-3 py-1 font-medium flex justify-between items-center">
                <span>[{a.type}] {a.title}</span>
              </div>
              <div className="p-2 bg-white border-b text-gray-700 text-xs">
                {a.description}
              </div>
              {a.command && (
                <SyntaxHighlighter
                  language="powershell"
                  style={vscDarkPlus}
                  customStyle={{ margin: 0, borderRadius: 0, fontSize: '12px' }}
                >
                  {a.command}
                </SyntaxHighlighter>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-bold border-b pb-1 mb-2">🔍 証跡資料</h3>
        <ul className="space-y-2">
          {p.evidence_pack?.map((e, idx) => (
            <li key={idx} className="text-xs border-l-4 border-green-500 bg-gray-50 p-2">
              <div className="font-bold text-gray-500 mb-1">
                {e.source} {e.is_verified && "✅ Verified"}
              </div>
              <div className="font-mono bg-white p-1 border rounded text-gray-700 break-all">
                {e.content}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}