# CAToC (Support Cockpit) - Tier-3 サポートエンジニア業務のオーケストレーションAI

Google Cloud AI Hackathon (GenAI/RAG) 提出プロジェクト

| 項目 | URL |
| --- | --- |
| **プロダクト URL** | [Click here to Open App](https://tier3-frontend-541297450514.us-central1.run.app/) |
| **Zenn 記事** | [解説記事を読む](https://zenn.dev/mirai_techlab/articles/b18f86074bd101) |
| **3分 デモ動画** | [YouTubeで見る](https://youtu.be/ES8QfQEsvi0) |

![CAToC Architecture Sketch](./docs/images/dashboard.png)

※プロダクトURLから動作確認を行う場合は、原則"support@neuroring.jp"宛てにメールをお願いします。
"0sasurai0@gmail.com"から返信がきますが、"0sasurai0@gmail.com"宛てにそのまま返信いただいても問題ございません。

## 🚀 プロダクト概要
**"The Invisible Tier-3 Engineer"**

CAToCは、メールを受信した瞬間に「ログ解析・ドラフト作成・エスカレーション判断」までを完了させる、完全自律型のサポートエンジニアリングAIです。

人間のエンジニアは、AIが用意した回答を**「承認（Approve）」**するだけで業務が完了します。
送信プロセスは **Human-in-the-loop** を前提とし、PolicyGuard機能により言い回し・免責・OEM境界などの安全性を担保します。

## 🛠️ 技術スタック & アーキテクチャ

```mermaid
graph TD
    User([Customer]) -->|Email| Gmail
    Gmail -->|Push| PubSub
    PubSub -->|Webhook| CloudRun_Backend["Backend (FastAPI)"]
    
    subgraph "Google Cloud Platform"
        CloudRun_Backend <-->|RAG Search| VertexAI_Search["Vertex AI Search"]
        CloudRun_Backend <-->|LLM| Gemini["Vertex AI (Gemini 2.5 Flash)"]
        CloudRun_Backend <-->|DB| Firestore
        
        CloudRun_Frontend["Frontend (Next.js)"] <-->|Realtime Sync| Firestore
        CloudRun_Frontend -->|API| CloudRun_Backend
    end
    
    Operator([Support Engineer]) -->|Approve/Chat| CloudRun_Frontend

Frontend: Next.js (TypeScript), Tailwind CSS, Firebase Auth/Firestore

Backend: Python (FastAPI), Google Cloud Run

AI/RAG: Vertex AI (Gemini 2.5 Flash), Vertex AI Search (Agent Builder)

Messaging: Gmail API (Pub/Sub Push通知)

Database: Firestore

✨ 主要機能
1. Zero-Touch Triage (完全自動トリアージ)

Gmail受信をトリガーに、トリアージエージェントが RAG (FixCase/Timeline) を検索して自動解析を行い、原因仮説を生成します。
同時並行で、ドラフトエージェントも RAG (PolicyGuard/ReplyDraft) を検索し、ポリシーに準拠した返信草案を即座に生成します。

2. Escalation Manager

過去の解決事例に基づき、SREやネットワークチーム、OEMベンダーへのエスカレーションが必要かを自動判定します。
トップページおよびケース詳細画面にて、推奨されるエスカレーション先（例: 🚀 Rec: SRE Team）をアラート表示します。

3. PM Agent / Editor Agent (Context-Aware Copilot)

画面右下のチャットボットは、状況に応じて役割を切り替えます。

Top Page (PM Agent):

全ケースを俯瞰的に把握。「対応が必要なケースは？」と聞くだけでボトルネックを抽出します。

「Case-xxxxの経緯を教えて」と聞けば、特定ケースのタイムラインを要約します。

Case Detail (Editor Agent):

そのケースの詳細を熟知。「もっと丁寧に書き直して」「クローズメモを作って」といった指示に対し、文脈を踏まえて対話的に実行します。

4. Self-Evolving Knowledge (自己進化するナレッジ)

ケース解決（Close）時に、AIが自動的に解決策と経緯を要約し、ナレッジベース (GCS -> Vertex AI Search) に保存します。
この「解決」が即座に次の「検索対象」となり、使えば使うほどAIの解析精度が向上します。

🔧 ローカル開発セットアップ
前提条件
Google Cloud プロジェクト (Vertex AI, Cloud Run有効化済み)
Firebase プロジェクト

手順

1. リポジトリのクローン
git clone <YOUR_REPO_URL>
cd <REPO_NAME>

2. 環境変数の設定
以下のファイルを所定の場所に配置してください。
backend/.env : GCPプロジェクト情報、API設定
.env.local : Firebase設定
backend/token.json : Gmail API認証情報

3. Backend起動
cd backend
pip install -r requirements.txt
uvicorn main:app --reload

4. Frontend起動
# 別ターミナルでルートディレクトリにて実行
npm install
npm run dev

📜 ライセンス
MIT License