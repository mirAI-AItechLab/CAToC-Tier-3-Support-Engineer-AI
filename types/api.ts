export type CaseStatus =
  | 'NEW'
  | 'ANALYZING'
  | 'PROPOSED'
  | 'WAITING_CUSTOMER'
  | 'WAITING_INTERNAL'
  | 'VALIDATING'
  | 'CLOSING'
  | 'CLOSED';

export type Priority = 'P0' | 'P1' | 'P2' | 'P3';

export interface AiProposal {
  summary: string; 
  hypotheses: Hypothesis[];
  missing_info: string[];
  evidence_pack: Evidence[];
  next_action_plan: ActionPlan[];

  reply_draft?: EmailDraft;
  internal_note_draft?: string;
  validation_checklist?: string[];
  closure_draft?: ClosureDraft;

  confidence_score: number; 
  next_contact_due_proposal: string; 
  routing_suggestion?: string;
  escalation_suggestion?: string;
  detected_customer_name?: string;
}

export interface Hypothesis {
  cause: string;
  likelihood: 'High' | 'Medium' | 'Low';
  reasoning: string;
}

export interface Evidence {
  type: 'LOG_SNIPPET' | 'DOCUMENT_REF' | 'SANDBOX_RESULT';
  content: string;
  source: string;
  is_verified: boolean;
}

export interface EmailDraft {
  to: string;
  subject: string;
  body: string;
  attachments: string[];
}

export interface ActionPlan {
  type: 'COMMAND' | 'REQUEST_INFO' | 'ESCALATE';
  title: string;
  description: string;
  command?: string;
}

export interface ClosureDraft {
  root_cause: string;
  resolution_steps: string;
  prevention_measure: string;
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: 'INGEST' | 'AI_ANALYSIS' | 'HUMAN_APPROVE' | 'REPLY_RECEIVED' | 'STATUS_CHANGE';
  actor: 'SYSTEM' | 'AI' | 'USER' | 'ENGINEER';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface Case {
  id: string;
  title: string;
  description: string;

  status: CaseStatus;
  priority: Priority;

  created_at: string;
  updated_at: string;
  next_contact_due: string;

  sender_email?: string;
  sender_name?: string;
  customer_name?: string;

  escalation_target?: string | null;
  latest_proposal?: AiProposal;
  timeline: TimelineEvent[];
  waiting_for: string[];
}

export interface CreateTriageRequest {
  title: string;
  description: string;
  logs?: string;
  sender_email?: string;
  file_urls?: string[]; 
  sender_name?: string;
}

export type ApproveActionType = 'SEND_REPLY' | 'EXECUTE_FIX' | 'JUST_UPDATE_STATUS';

export interface ApproveRequest {
  action_type: ApproveActionType;
  operator_name?: string;
  approved_content: {
    reply_body?: string;
    operator_name?: string;
    next_status?: CaseStatus;
  };
}

export interface ReplyIngestRequest {
  reply_text: string;
  new_logs?: string;
}

export interface CloseRequest {
  closure_note: string;
  publish_kb: boolean;
}
