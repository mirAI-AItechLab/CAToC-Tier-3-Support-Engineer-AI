import type {
  Case,
  CreateTriageRequest,
  ApproveRequest,
  ReplyIngestRequest,
  CloseRequest,
} from '@/types/api';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    let errorMessage = `API Error ${res.status}`;
    try {
      const errorData = await res.json();
      if (errorData.detail) {
        errorMessage = Array.isArray(errorData.detail) 
          ? JSON.stringify(errorData.detail) 
          : errorData.detail;
      }
    } catch {
      const text = await res.text().catch(() => '');
      if (text) errorMessage = text;
    }
    throw new Error(errorMessage);
  }
  
  return (await res.json()) as T;
}

export const api = {
  listCases: (status?: string) => {
    const qs = status && status !== 'ALL' ? `?status=${encodeURIComponent(status)}` : '';
    return http<Case[]>(`/cases${qs}`);
  },

  getCase: (caseId: string) => http<Case>(`/cases/${encodeURIComponent(caseId)}`),

  triage: (payload: CreateTriageRequest) =>
    http<Case>(`/triage`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  approve: (caseId: string, payload: ApproveRequest) =>
    http<Case>(`/cases/${encodeURIComponent(caseId)}/approve`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  replyIngest: (caseId: string, payload: ReplyIngestRequest) =>
    http<Case>(`/cases/${encodeURIComponent(caseId)}/reply_ingest`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  close: (caseId: string, payload: CloseRequest) =>
    http<Case>(`/cases/${encodeURIComponent(caseId)}/close`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  
  getUploadUrl: (filename: string, contentType: string) => 
    http<{ upload_url: string; gcs_uri: string }>('/upload/signed-url', {
      method: 'POST',
      body: JSON.stringify({ filename, content_type: contentType }),
    }),

  uploadFileToGCS: async (uploadUrl: string, file: File) => {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type, 
      },
      body: file,
    });
    if (!res.ok) {
      throw new Error('Failed to upload file to storage');
    }
  },

  chatAssistant: (caseId: string, query: string) =>
    http<{ status: string; reply: string; updated_case?: Case }>(
      `/cases/${encodeURIComponent(caseId)}/chat`, 
      {
        method: 'POST',
        body: JSON.stringify({ user_query: query }),
      }
    ),

  chatGlobal: (query: string) =>
    http<{ status: string; reply: string }>('/global/chat', {
      method: 'POST',
      body: JSON.stringify({ user_query: query }),
    }),

};