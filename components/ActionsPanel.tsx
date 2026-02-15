'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import type { Case, CaseStatus, ApproveRequest} from '@/types/api';
import { useAuth } from "@/components/AuthWrapper";

export function ActionsPanel({ c, onUpdated }: { c: Case; onUpdated: (c: Case) => void }) {
  const { user } = useAuth();
  const operatorName = user?.displayName ?? user?.email ?? "サポート担当";

  const draftBody = c.latest_proposal?.reply_draft?.body ?? '';
  const renderedDraftBody = draftBody.replaceAll("[担当者名]", operatorName);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [replyBody, setReplyBody] = useState(renderedDraftBody);
  const [nextStatus, setNextStatus] = useState<CaseStatus>('WAITING_CUSTOMER');

  useEffect(() => {
    setReplyBody(renderedDraftBody);
  }, [c.id, renderedDraftBody]);

  const [replyText, setReplyText] = useState(`お世話になっております。ご案内いただいた切り分けを実施しましたので、結果をご連絡します。

■実施内容と結果
1) DISM /Online /Cleanup-Image /RestoreHealth
→ 完了（エラーなし）

2) sfc /scannow
→ 一部修復しました（「破損ファイルを修復しました」表示）

3) Windows Update コンポーネントのリセット
（SoftwareDistribution / catroot2 のリネーム、BITS/WUAUSERV停止→起動）
→ 実施済み

■更新の再試行結果
・再起動後、「更新プログラムを構成できませんでした。変更を元に戻しています」が再度表示されました
・設定画面では引き続き 0x80070643 が出ています

■添付/共有情報
・WindowsUpdate.log（添付）
・CBS.log（sfc実行後、該当箇所抜粋を別紙添付）
・イベントビューア（WindowsUpdateClient のエラー）スクリーンショット（添付）

上記を踏まえて、次に確認すべき点や追加の手順があれば教えてください。
`);
  const [newLogs, setNewLogs] = useState('');
  const aiClosureNote = (c.latest_proposal as any)?.closure_note || "";
  const [closureNote, setClosureNote] = useState(`【クローズメモ（解決）】
事象：Windows Update 適用失敗（0x80070643）
再起動後に「更新プログラムを構成できませんでした。変更を元に戻しています」が繰り返し発生。

対応：
1) DISM /Online /Cleanup-Image /RestoreHealth 実施
2) sfc /scannow 実施（破損ファイル修復あり）
3) Windows Update コンポーネントをリセット
　（SoftwareDistribution / catroot2 のリネーム、BITS/WUAUSERV 等のサービス再起動）
4) 再起動後、Windows Update を再実行し正常に適用できることを確認

結果：
・エラー 0x80070643 は解消
・「変更を元に戻しています」のループも発生しなくなった
・更新履歴に対象KBが「成功」として記録

ナレッジ化ポイント：
0x80070643 は更新コンポーネント不整合や関連コンポーネント（例：.NET）で発生しやすい。
まず DISM/SFC → WUリセットを優先し、ログ（WindowsUpdate.log/CBS.log）で次アクションを判断する。
`);
  const [publishKb, setPublishKb] = useState(true);

  useEffect(() => {
    if (aiClosureNote) {
      setClosureNote(aiClosureNote);
    }
  }, [aiClosureNote]);

  async function doApproveSendReply() {
    setLoading(true);
    setErr('');
    try {
      const updated = await api.approve(c.id, {
        action_type: 'SEND_REPLY',
        operator_name: operatorName,
        approved_content: {
          reply_body: replyBody,
          next_status: nextStatus,
        },
      });
      onUpdated(updated);
    } catch (e: any) {
      setErr(e?.message ?? 'Approve failed');
    } finally {
      setLoading(false);
    }
  }

  async function doReplyIngest() {
    setLoading(true);
    setErr('');
    try {
      const updated = await api.replyIngest(c.id, {
        reply_text: replyText,
        new_logs: newLogs || undefined,
      });
      onUpdated(updated);
    } catch (e: any) {
      setErr(e?.message ?? 'Reply ingest failed');
    } finally {
      setLoading(false);
    }
  }

  async function doClose() {
    setLoading(true);
    setErr('');
    try {
      const updated = await api.close(c.id, {
        closure_note: closureNote,
        publish_kb: publishKb,
      });
      onUpdated(updated);
    } catch (e: any) {
      setErr(e?.message ?? 'Close failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {err && <div className="border border-red-300 bg-red-50 text-red-700 p-2 rounded">{err}</div>}

      <div className="border rounded p-2 space-y-2">
        <h3 className="font-medium">承認/送信</h3>
        <div className="text-xs opacity-70">
          Action: <b>SEND_REPLY</b> （ステータス更新/タイムライン追加/メール送信）
        </div>

        <label className="text-xs opacity-70">Next Status</label>
        <select className="border rounded px-2 py-1 w-full" value={nextStatus} onChange={(e) => setNextStatus(e.target.value as any)}>
          <option value="WAITING_CUSTOMER">WAITING_CUSTOMER</option>
          <option value="WAITING_INTERNAL">WAITING_INTERNAL</option>
          <option value="VALIDATING">VALIDATING</option>
          <option value="CLOSING">CLOSING</option>
        </select>

        <label className="text-xs opacity-70">返信草案 （承認して送信する本文）</label>
        <textarea
          className="border rounded px-2 py-1 w-full min-h-[140px]"
          value={replyBody}
          onChange={(e) => setReplyBody(e.target.value)}
          placeholder="こんにちは、..."
        />

        <button className="border rounded px-3 py-1" onClick={doApproveSendReply} disabled={loading}>
          {loading ? 'Processing...' : '承認して送信'}
        </button>
      </div>

      <div className="border rounded p-2 space-y-2">
        <h3 className="font-medium">返信取り込み（再解析）</h3>
        <label className="text-xs opacity-70">返信文</label>
        <textarea className="border rounded px-2 py-1 w-full" value={replyText} onChange={(e) => setReplyText(e.target.value)} />

        <label className="text-xs opacity-70">新規ログ (optional)</label>
        <textarea className="border rounded px-2 py-1 w-full" value={newLogs} onChange={(e) => setNewLogs(e.target.value)} />

        <button className="border rounded px-3 py-1" onClick={doReplyIngest} disabled={loading}>
          {loading ? 'Processing...' : '再解析'}
        </button>
      </div>

      <div className="border rounded p-2 space-y-2">
        <h3 className="font-medium">Close</h3>
        <label className="text-xs opacity-70">クローズ メモ</label>
        <textarea className="border rounded px-2 py-1 w-full" value={closureNote} onChange={(e) => setClosureNote(e.target.value)} />

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={publishKb} onChange={(e) => setPublishKb(e.target.checked)} />
          社内KBに反映
        </label>

        <button className="border rounded px-3 py-1" onClick={doClose} disabled={loading}>
          {loading ? 'Processing...' : 'Close Case'}
        </button>
      </div>
    </div>
  );
}
