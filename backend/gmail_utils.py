import base64
import os
import json
import re

from email.mime.text import MIMEText
from email.utils import parseaddr
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google.cloud import storage
from dotenv import load_dotenv

load_dotenv()

PROJECT_ID = os.getenv("GCP_PROJECT_ID", "tier3-ops-resolver")
UPLOAD_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME", "tier3-ops-resolver-uploads")
PROCESSED_LABEL_NAME = "OpsResolver_Done"

def get_gmail_service():
    """token.jsonからGmail APIクライアントを生成"""
    SCOPES = [
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.send'
    ]
    creds = Credentials.from_authorized_user_file('token.json', SCOPES)
    return build('gmail', 'v1', credentials=creds)

def get_or_create_label_id(service):
    """処理済みラベルのIDを取得、なければ作成する"""
    results = service.users().labels().list(userId='me').execute()
    labels = results.get('labels', [])
    
    for label in labels:
        if label['name'] == PROCESSED_LABEL_NAME:
            return label['id']
    
    print(f"🏷️ Creating label: {PROCESSED_LABEL_NAME}")
    label_object = {
        'name': PROCESSED_LABEL_NAME,
        'labelListVisibility': 'labelShow',
        'messageListVisibility': 'show'
    }
    created = service.users().labels().create(userId='me', body=label_object).execute()
    return created['id']

def parse_and_upload_attachments(service, user_id, msg_id, parts):
    """添付ファイルをGCSに上げる"""
    files_info = []
    if not parts: return []

    for part in parts:
        if part.get('filename') and part.get('body') and part.get('body').get('attachmentId'):
            att_id = part['body']['attachmentId']
            filename = part['filename']
            try:
                att = service.users().messages().attachments().get(userId=user_id, messageId=msg_id, id=att_id).execute()
                data = base64.urlsafe_b64decode(att['data'].encode('UTF-8'))
                
                storage_client = storage.Client(project=PROJECT_ID)
                bucket = storage_client.bucket(UPLOAD_BUCKET_NAME)
                blob_path = f"emails/{msg_id}/{filename}"
                blob = bucket.blob(blob_path)
                blob.upload_from_string(data, content_type=part.get('mimeType'))
                
                gcs_uri = f"gs://{UPLOAD_BUCKET_NAME}/{blob_path}"
                print(f"📎 Uploaded attachment: {gcs_uri}")
                files_info.append(gcs_uri)
            except Exception as e:
                print(f"⚠️ Attachment upload failed: {e}")
                
        if part.get('parts'):
            files_info.extend(parse_and_upload_attachments(service, user_id, msg_id, part['parts']))
    return files_info

def fetch_history_changes(start_history_id: str):
    """指定された historyId 以降の変更履歴を取得する"""
    service = get_gmail_service()
    try:
        history = service.users().history().list(
            userId='me', 
            startHistoryId=start_history_id, 
            historyTypes=['messageAdded']
        ).execute()
        return history.get('history', []), None
    except HttpError as error:
        if error.resp.status == 404:
            print("⚠️ History ID too old or invalid. Need reset.")
            return [], "RESET_REQUIRED"
        raise error

def _b64url_decode(data: str) -> bytes:
    data = data.replace("-", "+").replace("_", "/")
    data += "=" * (-len(data) % 4)
    return base64.b64decode(data)

def get_email_body(payload: dict) -> str:
    plain_parts = []
    html_parts = []

    def walk(p: dict):
        if not p:
            return
        mime = p.get("mimeType", "")
        body = p.get("body", {}) or {}
        data = body.get("data")

        if data and mime in ("text/plain", "text/html"):
            try:
                text = _b64url_decode(data).decode("utf-8", errors="replace")
            except Exception:
                text = ""
            if mime == "text/plain":
                plain_parts.append(text)
            else:
                html_parts.append(text)

        for child in (p.get("parts") or []):
            walk(child)

    walk(payload)

    if plain_parts:
        return "\n".join(plain_parts).strip()

    if html_parts:
        html = "\n".join(html_parts)
        html = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
        html = re.sub(r"</p\s*>", "\n", html, flags=re.IGNORECASE)
        html = re.sub(r"<[^>]+>", "", html)
        return html.strip()

    return ""

def process_single_message(msg_id: str):
    """メッセージIDから詳細を取得し、ターゲットならデータを返す"""
    service = get_gmail_service()
    try:
        message = service.users().messages().get(userId='me', id=msg_id, format='full').execute()
    except HttpError as e:
        if e.resp.status == 404:
            return None
        raise e

    thread_id = message.get('threadId')
    payload = message.get('payload', {})
    headers = payload.get('headers', [])

    label_id = get_or_create_label_id(service)
    if label_id in message.get('labelIds', []):
        print(f"⏩ Already processed: {msg_id}")
        try:
            service.users().messages().modify(
                userId='me', id=msg_id, body={'removeLabelIds': ['UNREAD']}
            ).execute()
        except Exception:
            pass
        return None

    hmap = {h.get('name', '').lower(): h.get('value') for h in headers}
    subject = hmap.get('subject', '(No Subject)')
    raw_from = hmap.get('from', 'Unknown')

    sender_name, sender_email = parseaddr(raw_from)
    if not sender_name:
        sender_name = sender_email

    hmap = {h.get('name', '').lower(): h.get('value') for h in headers}

    message_id = (hmap.get("message-id") or "").strip()
    if message_id and not message_id.startswith("<"):
        message_id = f"<{message_id}>"

    raw_from = next((h['value'] for h in headers if h['name'] == 'From'), 'Unknown')
    sender_name, sender_email = parseaddr(raw_from)
    if not sender_name:
        sender_name = sender_email

    to_address = next((h['value'] for h in headers if h['name'] == 'To'), '')
    delivered_to = next((h['value'] for h in headers if h['name'] == 'Delivered-To'), '')
    
    print(f"🚀 Processing Ticket: {subject} (From: {sender_name})")
    print(f"DEBUG: thread_id={thread_id} message_id={message_id!r}")

    full_body = get_email_body(message.get('payload'))

    if not full_body:
        full_body = message.get('snippet', '')

    file_urls = parse_and_upload_attachments(service, 'me', msg_id, payload.get('parts', []))

    service.users().messages().modify(
        userId='me',
        id=msg_id,
        body={
            'addLabelIds': [label_id],
            'removeLabelIds': ['UNREAD']
        }
    ).execute()
    print("🏷️ Marked as processed (Done + Read).")

    return {
        "title": subject,
        "description": full_body,
        "sender_email": sender_email,
        "sender_name": sender_name,
        "logs": full_body,
        "file_urls": file_urls,
        "gmail_thread_id": thread_id,
        "gmail_message_id": message_id,
    }

def _normalize_msgid(v: str | None) -> str | None:
    if not v:
        return None
    v = v.strip()
    if not v:
        return None
    if not v.startswith("<"):
        v = f"<{v}>"
    return v

def send_reply(
    to_email: str,
    subject: str,
    body: str,
    thread_id: str | None = None,
    in_reply_to: str | None = None,
    references: str | None = None,
):
    """Gmail APIを使ってメールを送信する（スレッド維持対応）"""
    service = get_gmail_service()

    message = MIMEText(body, _charset="utf-8")
    message["to"] = to_email
    message["subject"] = subject

    irt = _normalize_msgid(in_reply_to)
    ref = _normalize_msgid(references) or irt


    if irt:
        message["In-Reply-To"] = irt
    if ref:
        message["References"] = ref
        
    raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")
    message_body = {'raw': raw_message}
    
    if thread_id:
        message_body['threadId'] = thread_id
    
    try:
        body_obj = {"raw": raw_message}
        if thread_id:
            body_obj["threadId"] = thread_id

        sent_message = service.users().messages().send(userId="me", body=body_obj).execute()
        print(f"📧 Sent email to {to_email} (Msg ID: {sent_message['id']})")
        return sent_message
    except Exception as e:
        print(f"❌ Failed to send email: {e}")
        raise
