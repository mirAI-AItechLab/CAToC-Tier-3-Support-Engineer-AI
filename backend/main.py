# backend/main.py
import json
import uuid
import mimetypes
from typing import List, Optional, Union
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from gmail_utils import send_reply 
from gmail_utils import get_gmail_service 
from schemas import ChatRequest
from dotenv import load_dotenv
from pathlib import Path
import os
import re

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import vertexai
from vertexai.generative_models import GenerativeModel, Part
from google.cloud import firestore, storage
from pydantic import BaseModel
from knowledge_utils import search_knowledge_base 
from knowledge_exporter import export_case_to_knowledge
from gmail_utils import fetch_history_changes, process_single_message

from schemas import Case, CreateTriageRequest, AiProposal, EmailDraft, ApproveRequest
from schemas import ReplyIngestRequest, CloseRequest

load_dotenv

# --- 設定 ---
PROJECT_ID = os.getenv("GCP_PROJECT_ID", "tier3-ops-resolver")
LOCATION = os.getenv("GCP_LOCATION", "us-central1")
MODEL_ID = os.getenv("GCP_MODEL_ID", "gemini-2.5-flash")
UPLOAD_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME", "tier3-ops-resolver-uploads")

CURRENT_ACCOUNT = os.getenv("TARGET_EMAIL_ACCOUNT", "0sasurai0@gmail.com")

vertexai.init(project=PROJECT_ID, location=LOCATION)
db = firestore.Client(project=PROJECT_ID)

app = FastAPI(title="OpsResolver API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000","https://tier3-frontend-541297450514.us-central1.run.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
#  Helper Functions
# ==========================================
JST = ZoneInfo("Asia/Tokyo")

def now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def now_jst_iso() -> str:
    return datetime.now(JST).isoformat()

def clean_json_text(text: str) -> str:
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]

    start_idx = text.find("{")
    end_idx = text.rfind("}")
    
    if start_idx != -1 and end_idx != -1:
        text = text[start_idx : end_idx + 1]

    return text

def get_multimodal_content(text_prompt: str, gcs_uris: List[str]) -> List[Union[str, Part]]:
    """テキストとGCS上のファイルをGemini入力用Partに変換する"""
    parts = [text_prompt]
    
    for uri in gcs_uris:
        ext = uri.split('.')[-1].lower()
        mime_type = None

        if ext in ['png']:
            mime_type = "image/png"
        elif ext in ['jpg', 'jpeg']:
            mime_type = "image/jpeg"
        elif ext in ['webp']:
            mime_type = "image/webp"
        elif ext in ['heic', 'heif']:
            mime_type = "image/heif"
            
        elif ext in ['mp4', 'mov', 'mpeg', 'mpg', 'avi']:
            mime_type = "video/mp4"
            
        elif ext in ['pdf']:
            mime_type = "application/pdf"
        elif ext in ['txt', 'log', 'csv', 'json', 'py', 'js', 'html', 'xml']:
            mime_type = "text/plain"

        if mime_type:
            print(f"📎 Attaching to Gemini: {uri} as {mime_type}")
            try:
                parts.append(Part.from_uri(uri=uri, mime_type=mime_type))
            except Exception as e:
                print(f"⚠️ Failed to attach part {uri}: {e}")
        else:
            print(f"⏩ Skipped unsupported file type: {uri} (ext: {ext})")
        
    return parts

def normalize_next_due(next_due_iso: Optional[str], now_jst: datetime, fallback_hours: int = 4) -> str:
    if not next_due_iso:
        return (now_jst + timedelta(hours=fallback_hours)).isoformat()

    s = next_due_iso.strip()
    if not (s.endswith("Z") or re.search(r"[+\-]\d{2}:\d{2}$", s)):
        s = s + "+09:00"

    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return (now_jst + timedelta(hours=fallback_hours)).isoformat()

    dt_jst = dt.astimezone(JST)
    if dt_jst < now_jst:
        return (now_jst + timedelta(hours=fallback_hours)).isoformat()

    return dt_jst.isoformat()

def compute_waiting_for(next_status: str, action_type: Optional[str] = None) -> List[str]:
    """
    status/action から waiting_for を一貫して決める
    """
    s = (next_status or "").upper()

    if s == "PROPOSED":
        return ["Engineer Approval"]
    if s in ["WAITING_CUSTOMER"]:
        return ["Customer Action"]
    if s in ["WAITING_INTERNAL", "VALIDATING"]:
        return ["Engineer Action"]
    if s == "CLOSED":
        return []

    return []

# ==========================================
#  1. Analyzer Agent (解析担当)
# ==========================================
ANALYZER_INSTRUCTION = """
あなたは "OpsResolver"（Tier-3 サポートエンジニアAI）です。
提供されたインシデント情報（タイトル、詳細、ログ、画像/動画など）を解析し、構造化されたトリアージレポートを作成してください。

# 最優先事項（重要）
1) 出力は必ず **有効なJSON**（パース可能）であること（Markdownコードフェンス不要）
2) JSONは必ず `AiProposal` スキーマに一致すること
3) `next_contact_due_proposal` は **Current Time を基準**に計算し、**過去日時にしない**こと

# 解析方針
- エラーコード/ログ根拠から根本原因を仮説化し、検証コマンドや次アクションを具体的に提案する
- 断定ではなく、根拠（ログの行/ファイル/現象）を添える
- 不足情報があれば具体的な質問として列挙する

# 顧客名の特定（重要）
- メール本文の署名や名乗り（例: "〇〇株式会社の田中です"）から顧客名を抽出し `detected_customer_name` に入れる
- 特定できない場合は null もしくは "ご担当者" とする

# Next Contact Due（次回連絡期限）の計算（重要）
入力プロンプトに与えられる `Current Time`（現在時刻）を必ず基準にし、
Severity/優先度に応じて `next_contact_due_proposal` を計算して出力してください。

- High / P1 (Critical): Current Time + 4 hours
- Medium / P2 (Error):  Current Time + 1 day
- Low / P3 (Warning):  Current Time + 3 days

【制約】
- `next_contact_due_proposal` は必ず ISO8601（例: 2026-02-13T14:00:00+09:00）で timezone 付きで出力すること
- `next_contact_due_proposal` は Current Time より過去にしてはいけない
- 迷った場合は「Current Time + 4 hours」を採用すること

# Windowsパスの扱い（重要）
ログにWindowsパス（例: C:\\Windows\\Logs...）が含まれる場合、JSON文字列に出力する際はバックスラッシュを必ず二重にエスケープすること。
- NG: "C:\\Windows\\System32"
- OK: "C:\\\\Windows\\\\System32"

# 出力形式（AiProposalに準拠したJSONのみ）
{
  "summary": "事象の概要（1-2行）",
  "detected_customer_name": "田中 太郎",
  "hypotheses": [
    {"cause": "原因の仮説", "likelihood": "High/Medium/Low", "reasoning": "理由（ログのxx行目など）"}
  ],
  "missing_info": ["不足情報があればリスト化（具体的に）"],
  "evidence_pack": [
    {"type": "LOG_SNIPPET", "content": "根拠の説明", "source": "file_name or log_line", "is_verified": true}
  ],
  "next_action_plan": [
    {"type": "COMMAND", "title": "アクション名", "description": "詳細", "command": "具体的なコマンド"}
  ],
  "confidence_score": 0.9,
  "next_contact_due_proposal": "2026-02-13T14:00:00+09:00"
}
"""

def analyze_incident(title: str, description: str, logs: str, file_urls: List[str], history: str = "") -> AiProposal:
    model = GenerativeModel(model_name=MODEL_ID, system_instruction=ANALYZER_INSTRUCTION)
    
    search_query = title[:100]    
    knowledge_context = search_knowledge_base(
        query=search_query,
        filters=["fix_case_card", "timeline_event"]
    )
    print(f"📚 [RAG Result]:\n{knowledge_context[:500]}...\n(Total length: {len(knowledge_context)})")

    now_jst = datetime.now(JST)
    current_time_iso = now_jst.isoformat()

    base_prompt = f"""
    【前提情報】
    Current Time: {current_time_iso}

    【これまでの経緯 (History)】
    以下は、このチケットにおける過去のやりとりです。
    既に試した策や、ユーザーの反応を考慮して、次のステップを考えてください。
    --------------------------------------------------
    {history if history else "なし（新規案件）"}
    --------------------------------------------------

    【現在のインシデント】
    Title: {title}
    Description: {description}
    Logs: {logs}
    
    【参考情報：過去の類似症例・解決ログ (RAG)】
    以下の情報は、過去に解決した類似案件の記録です。
    特に『fix_case_card』に記載された解決策や原因分析を参考に、今回の解析を行ってください。
    
    {knowledge_context}
    """

    prompt_parts = get_multimodal_content(base_prompt, file_urls)
    
    try:
        response = model.generate_content(
            prompt_parts, 
            generation_config={"response_mime_type": "application/json"}
        )
        json_text = clean_json_text(response.text)
        data = json.loads(json_text)
        data["next_contact_due_proposal"] = normalize_next_due(
            data.get("next_contact_due_proposal"),
            now_jst=now_jst,
            fallback_hours=4,
        )

        return AiProposal(**data)

    except Exception as e:
        print(f"❌ Analyzer Error: {e}")
        print(f"💀 Raw Response (First 500 chars): {response.text[:500]}")

        return AiProposal(
            summary=f"Analysis failed: {e}",
            hypotheses=[], missing_info=[], evidence_pack=[], next_action_plan=[],
            confidence_score=0.0, next_contact_due_proposal=now_utc_iso()
        )

# ==========================================
#  2. Drafter Agent (代筆担当)
# ==========================================
DRAFTER_INSTRUCTION = """
あなたは熟練のサポートエンジニアです。
解析結果を元に、顧客への一次返信メールを作成してください。

【重要: 宛名と署名】
- 宛名には、解析結果に含まれる `detected_customer_name` を使用してください。（例: 田中 様）
- 署名（あなたの名前）の部分には、必ず `[担当者名]` というプレースホルダーを置いてください。
  （システムが送信時に実際のオペレーター名に置換します）

出力JSON:
{
  "to": "...",
  "subject": "...",
  "body": "田中 様\n\nお世話になっております...\n\n[担当者名]"
}

出力は以下のJSON形式のみを返してください。
{
  "to": "user@example.com",
  "subject": "件名...",
  "body": "本文...",
  "attachments": []
}

【要件】
- 丁寧で共感的な日本語を使うこと。
- 解析結果（原因や解決策）をわかりやすく伝えること。
- 解決策がある場合は、承認を求めること。
"""

def draft_reply(proposal: AiProposal, sender_email: Optional[str], history: str = "") -> EmailDraft:
    model = GenerativeModel(model_name=MODEL_ID, system_instruction=DRAFTER_INSTRUCTION)
    
    search_query = proposal.summary[:100]    
    knowledge_context = search_knowledge_base(
        query=search_query,
        filters=["reply_draft", "policy_guard_card"]
    )
    print(f"📚 [RAG Result for Drafter]:\n{knowledge_context[:500]}...\n")

    context = proposal.model_dump_json()
    prompt = f"""
    【解析結果 JSON】
    {context}
    
    【宛先】
    {sender_email or 'user@example.com'}    
    【参考情報：過去の返信例とポリシー (RAG)】
    以下の情報を元に、ドラフトを作成してください。
    特に『policy_guard_card』のルール（断定禁止など）は厳守してください。

    【これまでの会話履歴】
    以下を参照し、文脈に沿った返信を作成してください。
    - 初回の場合は丁寧な挨拶から始める。
    - 既に何度かやり取りしている場合は、挨拶を簡潔にし、「ご確認ありがとうございます」「引き続き調査します」といった文脈に応じた表現にする。
    --------------------------------------------------
    {history if history else "なし（初回連絡）"}
    --------------------------------------------------
    
    {knowledge_context}
    """
    try:
        response = model.generate_content(
            prompt,
            generation_config={"response_mime_type": "application/json"}
        )
        json_text = clean_json_text(response.text)
        data = json.loads(json_text)
        return EmailDraft(**data)

    except Exception as e:
        print(f"❌ Drafter Error: {e}")
        return EmailDraft(
            to=sender_email or "", 
            subject="Draft Error", 
            body="ドラフト生成に失敗しました。手動で作成してください。"
        )

# ==========================================
#  3. Editor Agent (編集担当)
# ==========================================
EDITOR_INSTRUCTION = """
あなたは、特定のサポートケースを担当する "Copilot" (Editor Agent) です。
エンジニアからの入力（user_query）と、これまでの経緯（Timeline）に基づいて、以下の対応を行ってください。

【対応可能なタスク】
1. **ドラフト修正** (メール本文):
   - 「書き直して」「丁寧に」等の指示に対し、`revised_reply_body` を出力する。
   
2. **クローズメモ作成/修正** (解決要約):
   - 「クローズメモを書いて」「要約して解決にして」等の指示に対し、Timeline全体を要約した解決記事を作成し、`revised_closure_note` を出力する。
   - フォーマット例: 
     【事象】...
     【原因】...
     【対処】...
   
3. **質問回答**:
   - 修正指示でない場合は、`comment` のみで回答する。

【出力形式】
以下のJSON形式のみを返してください。
{
  "revised_reply_body": "修正後のメール本文 (変更なしなら null)",
  "revised_closure_note": "修正後のクローズメモ (変更なしなら null)",
  "comment": "エンジニアへの回答、または処理内容の要約"
}
"""

@app.post("/cases/{case_id}/chat")
def chat_with_case(case_id: str, req: ChatRequest):
    doc_ref = db.collection("cases").document(case_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Case not found")
    
    case = Case(**doc.to_dict())
    
    if not case.latest_proposal:
        raise HTTPException(status_code=400, detail="No proposal to edit")

    current_draft = "（ドラフト未生成）"
    if case.latest_proposal and case.latest_proposal.reply_draft:
        current_draft = case.latest_proposal.reply_draft.body

    current_closure = "（未記入）"    
    if case.latest_proposal.closure_note:
        current_closure = case.latest_proposal.closure_note
      
    history_lines = []
    for event in case.timeline:
        d = event.dict() if hasattr(event, "dict") else event        
        ts = d.get("timestamp", "")
        actor = d.get("actor", "UNKNOWN")
        evt_type = d.get("type", "EVENT")
        msg = d.get("message", "")        
        line = f"[{ts}] {actor} ({evt_type}): {msg}"
        history_lines.append(line)
    
    history_text = "\n".join(history_lines) if history_lines else "（履歴なし）"    

    prompt = f"""
    
    【ケース基本情報】
    Title: {case.title}
    Description: {case.description}
    Customer: {case.customer_name}
    
    【これまでの全経緯 (Timeline History)】
    AIはこの履歴を参照して、ユーザーの「過去と同じにして」等の指示に対応しなければなりません。
    --------------------------------------------------
    {history_text}
    --------------------------------------------------    
    【現在の編集対象】
    [Email Draft]: {current_draft}
    [Closure Note]: {current_closure}
    
    【エンジニアからの指示】
    {req.user_query}
    
    【指示】
    - メール修正指示なら revised_reply_body を出力。
    - クローズメモ/要約指示なら revised_closure_note を出力。
    - 質問なら comment のみで回答。
    """
    
    model = GenerativeModel(model_name=MODEL_ID, system_instruction=EDITOR_INSTRUCTION)
    try:
        response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
        data = json.loads(clean_json_text(response.text))
        reply_msg = data.get("comment", "処理完了しました。")
        
        updated = False

        new_body = data.get("revised_reply_body")
        if new_body and new_body.strip() and new_body != "null":
            if case.latest_proposal and case.latest_proposal.reply_draft:
                case.latest_proposal.reply_draft.body = new_body
                updated = True
                reply_msg = f"メールドラフトを修正しました。\n({data.get('comment', '')})"

        new_note = data.get("revised_closure_note")
        if new_note and new_note.strip() and new_note != "null":
            if case.latest_proposal:
                case.latest_proposal.closure_note = new_note
                updated = True
                reply_msg = f"クローズメモを更新しました。\n({data.get('comment', '')})"

        if updated:
            case.updated_at = now_utc_iso()
            doc_ref.set(case.model_dump())

        return {
            "status": "success", 
            "reply": data.get("comment", "修正しました。"),
            "updated_case": case
        }
        
    except Exception as e:
        print(f"Chat Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
#  4. PM Agent (編集担当)
# ==========================================
PM_INSTRUCTION = """
あなたは、サポート状況を監視するシステム・オブザーバーです。
現在進行中のすべてのインシデント（Case一覧）のデータを分析し、ユーザーの質問に対して「事実」と「数字」に基づいて簡潔に回答してください。

【回答のルール】
- 挨拶や自己紹介（「お疲れ様です」「PMです」等）は一切不要。
- 結論から先に述べる。
- リストアップが必要な場合は、IDと期限、ステータスを箇条書きにする。
- 感情的な表現は避け、客観的な分析結果のみを出力する。

【詳細情報の扱い】
- ユーザーが特定のケースID（例: case-xxxxx）について質問しており、その詳細データ（Detailed Context）が提供されている場合は、その「タイムライン（History）」を要約して回答すること。

【判断基準】
- `next_contact_due` が過ぎている（Overdue）案件は最優先で警告対象とする。
- `status` が `WAITING_INTERNAL` や `PROPOSED` のまま放置されている案件をボトルネックとして扱う。
- 特定の案件についての質問には、IDとタイトルを照合して回答する。
"""

@app.post("/global/chat")
def global_chat(req: ChatRequest):
    docs = db.collection("cases").where("status", "!=", "CLOSED").stream()
    
    active_cases = []
    focused_case_details = ""
    target_case_id = None

    print(f"🕵️ PM Chat Query: {req.user_query}")
    match = re.search(r"(?:case-)?([a-f0-9]{8})", req.user_query, re.IGNORECASE)

    if match:
        extracted_hash = match.group(1).lower()
        target_case_id = f"case-{extracted_hash}"
        print(f"🎯 Target ID identified: {target_case_id} (from input:'{match.group(0)}')")
    else:
        print("👀 No specific Case ID detected in query.")

    for doc in docs:
        d = doc.to_dict()
        doc_id = d.get("id")

        if target_case_id and doc_id == target_case_id:
            print(f"✅ Found detail data for: {target_case_id}")
            history_text = ""
            timeline = d.get("timeline", [])
            for event in timeline:
                ts = event.get("timestamp", "")
                actor = event.get("actor", "UNKNOWN")
                msg = event.get("message", "")
                evt_type = event.get("type", "")
                history_text += f"[{ts}] {actor} ({evt_type}): {msg}\n"
            if not history_text:
                history_text = "(Timeline is empty)"
            
            focused_case_details = f"""
            === ユーザーが指定したケースの詳細 (ID: {target_case_id}) ===
            Target ID: {target_case_id}
            Title: {d.get("title")}
            Description: {d.get("description")}
            Status: {d.get("status")}
            Priority: {d.get("priority")}
            Next Due: {d.get("next_contact_due")}
            
            【Timeline (History)】
            {history_text}
            =======================================================
            """

        active_cases.append({
            "id": d.get("id"),
            "title": d.get("title"),
            "status": d.get("status"),
            "priority": d.get("priority"),
            "waiting_for": d.get("waiting_for"),
            "next_due": d.get("next_contact_due"),
            "customer": d.get("customer_name")
        })
    
    from datetime import timedelta, timezone
    now_jst = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M:%S (JST)")
    
    context = json.dumps(active_cases, ensure_ascii=False, indent=2)
    prompt = f"""
    
    【前提情報】
    Current Time: {now_jst}  
    
    【現在進行中の案件リスト (JSON)】
    {context}

    {focused_case_details}
    
    【ユーザーの質問】
    {req.user_query}
    
    上記の情報を元に、PMとして回答してください。
    指定されたケースの詳細情報（Detail Context）がある場合は、その経緯（Timeline）を要約・参照して回答してください。    
    """

    model = GenerativeModel(model_name=MODEL_ID, system_instruction=PM_INSTRUCTION)
    try:
        response = model.generate_content(prompt)
        return {"status": "success", "reply": response.text}
    except Exception as e:
        print(f"PM Chat Error: {e}")
        return {"status": "error", "reply": "申し訳ありません。現在状況の分析に失敗しました。"}

# ==========================================
#  5. Escalation Manager (エスカレーション判定)
# ==========================================
ESCALATION_INSTRUCTION = """
あなたは、サポートセンターの「エスカレーション・マネージャー」です。
インシデントの内容と過去の解決履歴（RAG）を分析し、この案件を**「他部署にエスカレーションすべきか」**判定してください。

【判定基準】
- 技術的にTier-3（現在）で解決可能なら、`target` は "None" とする。
- 過去の類似事例が特定のチーム（SRE, Network, Dev, Billing, Legalなど）で解決されている場合は、そのチーム名を推奨する。
- 迷った場合は "None" (自己解決) を優先する。

【出力形式】
JSONのみを出力してください。
{
  "target": "SRE Team",  // エスカレーション先、または "None"
  "reason": "過去の類似ログ(Case-123)でDB再起動が必要と判断され、SREに移管されているため。"
}
"""

def consult_escalation_manager(title: str, description: str, logs: str) -> Optional[str]:
    query = f"{title} escalation transfer history"
    knowledge = search_knowledge_base(query, filters=["escalation"])
    
    prompt = f"""
    【インシデント情報】
    Title: {title}
    Desc: {description}
    Logs: {logs[:1000]}
    
    【参考情報：過去のエスカレーション/解決実績】
    {knowledge}
    
    上記に基づき、エスカレーション先を判定してください。
    Tier-3エンジニア自身で解決すべきなら "None" を返してください。
    """
    
    model = GenerativeModel(model_name=MODEL_ID, system_instruction=ESCALATION_INSTRUCTION)
    try:
        response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
        data = json.loads(clean_json_text(response.text))
        
        target = data.get("target")
        if not target or target.upper() == "NONE":
            return None
            
        return target
    except Exception as e:
        print(f"⚠️ Escalation Manager Error: {e}")
        return None

# ==========================================
#  6. Closer Agent (クローズ & KB化担当)
# ==========================================
CLOSER_INSTRUCTION = """
あなたは、インシデントの事後分析を行う "Closer Agent" です。
提供されたケースの全履歴（Timeline）と最終状態を分析し、
ナレッジベース（KB）登録用の要約データをJSON形式で作成してください。

【出力JSONの要件】
- root_cause: 根本原因（技術的な要因を特定する）
- resolution_steps: 解決に至った具体的な手順（箇条書き、または改行区切りの文字列）
- prevention_measure: 再発防止策（もしあれば。なければ「特になし」）
- knowledge_title: 今後検索しやすい、簡潔かつ具体的なKBタイトル

【出力形式】
以下のJSONのみを返してください。
{
  "root_cause": "...",
  "resolution_steps": "1. ...\\n2. ...",
  "prevention_measure": "...",
  "knowledge_title": "..."
}
"""

# ==========================================
#  End Points
# ==========================================

class PubSubMessage(BaseModel):
    message: dict
    subscription: str

@app.post("/webhook/gmail")
async def gmail_webhook(data: PubSubMessage):
    try:
        import base64
        import re
        
        pubsub_data = base64.b64decode(data.message['data']).decode('utf-8')
        json_data = json.loads(pubsub_data)
        email_address = json_data.get('emailAddress')
        
        print(f"🔔 Push Notification received from: {email_address}")

        CURRENT_ACCOUNT = "0sasurai0@gmail.com"
        if email_address != CURRENT_ACCOUNT:
            return {"status": "ignored", "reason": "wrong_account"}

        print("🔍 Scanning for UNREAD messages...")
        
        service = get_gmail_service()
        query = "is:unread -from:me -label:OpsResolver_Done"        
        results = service.users().messages().list(
            userId='me', 
            q=query,
            maxResults=5 
        ).execute()
        
        messages = results.get('messages', [])
        
        if not messages:
            print("📭 No unread messages found.")
            return {"status": "no_unread_messages"}

        print(f"📥 Found {len(messages)} unread messages. Processing...")

        for msg in messages:
            msg_id = msg['id']
            
            incident_data = process_single_message(msg_id)            
            if not incident_data:
                continue

            subject = incident_data['title']
            thread_id = incident_data.get("gmail_thread_id")
            gmail_message_id = incident_data.get("gmail_message_id")            
            
            print(f"📨 Processing: {subject}")
            
            existing_case = None
            if thread_id:
                docs = db.collection("cases").where("gmail_thread_id", "==", thread_id).limit(1).stream()
                for d in docs:
                    existing_case = Case(**d.to_dict())
                    print(f"🔗 Found existing case by Thread ID: {existing_case.id}")
                    break
            
            match = re.search(r"\[Case:\s*(case-[a-f0-9]+)\]", subject, re.IGNORECASE)
            if match:
                extracted_id = match.group(1)
                print(f"🔗 Found Case ID tag: {extracted_id}")
                doc = db.collection("cases").document(extracted_id).get()
                if doc.exists:
                    existing_case = Case(**doc.to_dict())

            if existing_case:

                thread_id = incident_data.get("gmail_thread_id")
                gmail_message_id = incident_data.get("gmail_message_id")
                if not getattr(existing_case, "gmail_thread_id", None) and thread_id:
                    existing_case.gmail_thread_id = thread_id
                if not getattr(existing_case, "gmail_message_id", None) and gmail_message_id:
                    existing_case.gmail_message_id = gmail_message_id
                
                print(f"🔄 Updating Case: {existing_case.id}")
                
                existing_case.timeline.append({
                    "id": f"evt-{uuid.uuid4().hex[:4]}",
                    "timestamp": now_utc_iso(),
                    "type": "REPLY_RECEIVED",
                    "actor": "USER",
                    "message": incident_data['description'],
                    "metadata": {"has_logs": bool(incident_data['file_urls'])}
                })
                
                history_text = ""
                for event in existing_case.timeline:
                    evt_dict = event.dict() if hasattr(event, "dict") else event
                            
                    ts = evt_dict.get("timestamp", "")
                    actor = evt_dict.get("actor", "UNKNOWN")
                    msg = evt_dict.get("message", "")
                            
                    history_text += f"[{ts}] {actor}: {msg}\n"

                combined_logs = f"""
                【これまでの経緯】
                Title: {existing_case.title}
                Description: {existing_case.description}
                
                【ユーザーからの最新の返信】
                {incident_data['description']}
                
                【新規添付ログ/ファイル】
                {incident_data['file_urls']}
                """
                
                print("🧠 Running Re-Analysis...")
                new_proposal = analyze_incident(
                    title=existing_case.title, 
                    description=existing_case.description, 
                    logs=combined_logs,
                    file_urls=incident_data['file_urls'],
                    history=history_text
                )
                
                new_draft = draft_reply(new_proposal, incident_data['sender_email'])
                new_proposal.reply_draft = new_draft
                
                existing_case.latest_proposal = new_proposal
                existing_case.status = "PROPOSED" 
                existing_case.waiting_for = compute_waiting_for("PROPOSED")
                if new_proposal.next_contact_due_proposal:
                    existing_case.next_contact_due = new_proposal.next_contact_due_proposal
                existing_case.updated_at = now_utc_iso()
                
                db.collection("cases").document(existing_case.id).set(existing_case.model_dump(), merge=True)
                print(f"✅ Case {existing_case.id} Updated")

            else:
                print(f"🆕 Creating NEW case: {subject}")
                thread_id = incident_data.get("gmail_thread_id")
                gmail_message_id = incident_data.get("gmail_message_id")

                print("DEBUG CREATE before pop:",
                      "thread_id=", incident_data.get("gmail_thread_id"),
                      "message_id=", incident_data.get("gmail_message_id"),
                      "saved_thread_id=", thread_id,
                      "saved_message_id=", gmail_message_id)

                incident_data.pop("gmail_thread_id", None)
                incident_data.pop("gmail_message_id", None)

                req = CreateTriageRequest(**incident_data)  
                proposal = analyze_incident(req.title, req.description, req.logs or "", req.file_urls)
                draft = draft_reply(proposal, req.sender_email)
                proposal.reply_draft = draft

                initial_timeline_event = {
                    "id": f"evt-{uuid.uuid4().hex[:4]}",
                    "timestamp": now_utc_iso(),
                    "type": "INGEST", 
                    "actor": "USER",
                    "message": incident_data['description'], 
                    "metadata": {
                        "subject": incident_data['title'],
                        "from": incident_data['sender_email'],
                        "files": len(incident_data['file_urls']),
                        "gmail_thread_id": thread_id,
                        "gmail_message_id": gmail_message_id,
                    }
                }          

                esc_target = consult_escalation_manager(req.title, req.description, req.logs or "")
                print(f"⚖️ Escalation Judgment: {esc_target}")      

                print("DEBUG new_case fields:",
                      "case_id(planned)=", f"case-{uuid.uuid4().hex[:8]}",
                      "gmail_thread_id=", thread_id,
                      "gmail_message_id=", gmail_message_id)

                new_case = Case(
                    id=f"case-{uuid.uuid4().hex[:8]}",
                    title=req.title,
                    description=req.description,
                    status="PROPOSED",
                    priority="P1",
                    created_at=now_utc_iso(),
                    updated_at=now_utc_iso(),
                    next_contact_due=proposal.next_contact_due_proposal,
                    waiting_for=compute_waiting_for("PROPOSED"),
                    latest_proposal=proposal,
                    sender_email=req.sender_email,
                    sender_name=req.sender_name, 
                    customer_name=proposal.detected_customer_name, 
                    gmail_thread_id=thread_id,
                    gmail_message_id=gmail_message_id,
                    timeline=[initial_timeline_event],
                    escalation_target=esc_target,                      
                )
                db.collection("cases").document(new_case.id).set(new_case.model_dump())
                print(f"✅ New Case Created: {new_case.id}")

        return {"status": "ok"}

    except Exception as e:
        print(f"❌ Webhook Error: {e}")
        import traceback
        traceback.print_exc()
        return {"status": "error", "detail": str(e)}

@app.get("/cases", response_model=List[Case])
def list_cases():
    docs = db.collection("cases").order_by("updated_at", direction=firestore.Query.DESCENDING).stream()
    cases = []
    for doc in docs:
        cases.append(Case(**doc.to_dict()))
    return cases

@app.get("/cases/{case_id}", response_model=Case)
def get_case(case_id: str):
    doc_ref = db.collection("cases").document(case_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Case not found")
    return Case(**doc.to_dict())

@app.post("/triage", response_model=Case)
def create_triage(req: CreateTriageRequest):
    print(f"🚀 Triage started: {req.title} with {len(req.file_urls)} files")
    
    proposal = analyze_incident(
        req.title, 
        req.description, 
        req.logs or "", 
        req.file_urls 
    )
    
    draft = draft_reply(proposal, req.sender_email)
    proposal.reply_draft = draft
    esc_target = consult_escalation_manager(req.title, req.description, req.logs or "")

    new_case = Case(
        id=f"case-{uuid.uuid4().hex[:8]}",
        title=req.title,
        description=req.description,
        status="PROPOSED",
        priority="P1",
        created_at=now_utc_iso(),
        updated_at=now_utc_iso(),
        next_contact_due=proposal.next_contact_due_proposal,
        waiting_for=["Engineer Approval"],
        latest_proposal=proposal,
        customer_name=proposal.detected_customer_name,
        escalation_target=esc_target,         
    )
        
    db.collection("cases").document(new_case.id).set(new_case.model_dump())
    print(f"✅ Case created in Firestore: {new_case.id}")

    return new_case

@app.post("/cases/{case_id}/approve", response_model=Case)
def approve_case(case_id: str, req: ApproveRequest):
    doc_ref = db.collection("cases").document(case_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Case not found")

    target_case = Case(**doc.to_dict())
    
    if hasattr(req.approved_content, "model_dump"):
        content_data = req.approved_content.model_dump()
    elif hasattr(req.approved_content, "dict"):
        content_data = req.approved_content.dict()
    else:
        content_data = req.approved_content

    # =========================================================
    # 🛡️ Guardrails (安全弁)
    # =========================================================    
    if req.action_type == "SEND_REPLY":
        
        reply_to = target_case.latest_proposal.reply_draft.to
        reply_body = content_data.get("reply_body") or target_case.latest_proposal.reply_draft.body
        original_sender = target_case.sender_email 

        if original_sender and (reply_to != original_sender):
            
            if not reply_to.endswith("@neurorin.jp"):
                 print(f"🛡️ Blocked: Reply-to {reply_to} does not match original sender {original_sender}")
                 raise HTTPException(status_code=400, detail=f"Security Alert: You can only reply to the original sender ({original_sender}) or @neurorin.jp addresses.")
                 
        forbidden_words = ["社外秘", "Confidential", "パスワードは"]
        for word in forbidden_words:
            if word in reply_body:
                raise HTTPException(status_code=400, detail=f"Security Alert: Reply contains forbidden word: '{word}'")

        final_body = reply_body.replace("[担当者名]", req.operator_name or "サポート担当")        
        print(f"🚀 Approving & Sending reply to {reply_to}...")
        try:
            case_tag = f"[Case: {target_case.id}]"
            email_subject = f"{target_case.title} [Case: {target_case.id}]"

            print(
              "DEBUG approve threading:",
              "case_id=", target_case.id,
              "thread_id=", getattr(target_case, "gmail_thread_id", None),
              "message_id=", getattr(target_case, "gmail_message_id", None),
              "subject=", f"{target_case.title} [Case: {target_case.id}]",
              "to=", reply_to,
            )

            send_reply(
                to_email=reply_to,
                subject=email_subject,
                body=final_body,
                thread_id=target_case.gmail_thread_id,
                in_reply_to=target_case.gmail_message_id,
                references=target_case.gmail_message_id,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Email sending failed: {e}")

    next_status = content_data.get("next_status", "WAITING_CUSTOMER")
    target_case = Case(**doc.to_dict())
    target_case.status = next_status
    target_case.updated_at = now_utc_iso()

    if next_status == "WAITING_CUSTOMER":
        target_case.waiting_for = ["Customer Reply"]
    elif next_status == "WAITING_INTERNAL":
        target_case.waiting_for = ["Internal Action"]
    elif next_status == "VALIDATING":
        target_case.waiting_for = ["Validation Result"]
    elif next_status == "CLOSED":
        target_case.waiting_for = []
    else:
        target_case.waiting_for = []

    target_case.timeline.append({
        "id": f"evt-{uuid.uuid4().hex[:4]}",
        "timestamp": now_utc_iso(),
        "type": "HUMAN_APPROVE",
        "actor": "ENGINEER",
        "message": f"Action Approved. Status changed to {next_status}.",
        "metadata": content_data
    })

    doc_ref.set(target_case.model_dump(), merge=True)
    return target_case

@app.post("/cases/{case_id}/reply_ingest", response_model=Case)
def ingest_reply(case_id: str, req: ReplyIngestRequest):
    print(f"🔄 Processing reply for case: {case_id}")

    doc_ref = db.collection("cases").document(case_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Case not found")
    
    target_case.timeline.append({
        "id": f"evt-{uuid.uuid4().hex[:4]}",
        "timestamp": now_utc_iso(),
        "type": "REPLY_RECEIVED",
        "actor": "USER",
        "message": req.reply_text,
        "metadata": {"has_logs": bool(req.new_logs)}
    })

    combined_logs = f"""
    [Original Logs] (Previous context)
    [User Reply] {req.reply_text}
    [New Logs Provided] {req.new_logs or "(No new logs)"}
    """

    target_case = Case(**doc.to_dict())
    
    new_proposal = analyze_incident(target_case.title, target_case.description, combined_logs, [])
    
    sender = target_case.latest_proposal.reply_draft.to if target_case.latest_proposal and target_case.latest_proposal.reply_draft else None
    new_draft = draft_reply(new_proposal, sender)
    new_proposal.reply_draft = new_draft

    target_case.latest_proposal = new_proposal
    target_case.status = "PROPOSED"
    target_case.waiting_for = compute_waiting_for("PROPOSED")
    target_case.updated_at = now_utc_iso()
    
    doc_ref.set(target_case.model_dump(), merge=True)
    return target_case

def generate_closure_summary(case: Case) -> dict:
    model = GenerativeModel(model_name=MODEL_ID, system_instruction=CLOSER_INSTRUCTION)
    
    timeline_logs = []
    for t in case.timeline:
        if isinstance(t, dict): d = t
        else: d = t.model_dump() if hasattr(t, "model_dump") else t.dict()
        timeline_logs.append(f"[{d.get('timestamp')}] {d.get('actor')}: {d.get('message')}")
    
    timeline_str = "\n".join(timeline_logs)
    
    prompt = f"Title: {case.title}\nDescription: {case.description}\nHistory:\n{timeline_str}\nLatest Analysis: {case.latest_proposal.model_dump_json() if case.latest_proposal else 'N/A'}"
    
    try:
        response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
        return json.loads(clean_json_text(response.text))
    except Exception as e:
        print(f"Closer Error: {e}")
        return {"root_cause": "Error", "resolution_steps": "N/A", "prevention_measure": "N/A", "knowledge_title": "Error"}

@app.post("/cases/{case_id}/close", response_model=Case)
def close_case(case_id: str, req: CloseRequest):
    doc_ref = db.collection("cases").document(case_id)
    doc = doc_ref.get()
    if not doc.exists: raise HTTPException(status_code=404, detail="Case not found")
    target_case = Case(**doc.to_dict())

    print(f"🔒 Closing case: {case_id}")
    closure_data = generate_closure_summary(target_case)
    
    if target_case.latest_proposal:
        res_steps = closure_data.get("resolution_steps", "")
        if isinstance(res_steps, list): res_steps = "\n- ".join(res_steps)
        target_case.latest_proposal.closure_draft = {
            "root_cause": closure_data.get("root_cause", ""),
            "resolution_steps": res_steps, 
            "prevention_measure": closure_data.get("prevention_measure", "")
        }

    target_case.status = "CLOSED"
    target_case.updated_at = now_utc_iso()
    target_case.timeline.append({
        "id": f"evt-{uuid.uuid4().hex[:4]}", "timestamp": now_utc_iso(),
        "type": "STATUS_CHANGE", "actor": "ENGINEER",
        "message": f"Case Closed. Knowledge: {closure_data.get('knowledge_title')}", "metadata": closure_data
    })
    doc_ref.set(target_case.model_dump())  

    if req.publish_kb:
        print(f"🔄 Feedback Loop: Converting Case {case_id} to Knowledge...")
        export_case_to_knowledge(target_case, req.closure_note)

    return target_case