from typing import List, Optional, Any, Dict, Literal, Union 
from datetime import datetime
from pydantic import BaseModel, Field, field_validator

CaseStatus = Literal[
    'NEW', 'ANALYZING', 'PROPOSED', 
    'WAITING_CUSTOMER', 'WAITING_INTERNAL', 
    'VALIDATING', 'CLOSING', 'CLOSED'
]
Priority = Literal['P0', 'P1', 'P2', 'P3']

class Hypothesis(BaseModel):
    cause: str
    likelihood: str
    reasoning: str

class Evidence(BaseModel):
    type: str 
    content: str
    source: str
    is_verified: bool

class ActionPlan(BaseModel):
    type: str
    title: str
    description: str
    command: Optional[str] = None

class EmailDraft(BaseModel):
    to: str
    subject: str
    body: Optional[str] = Field(default="", description="Email body content")
    attachments: List[str] = Field(default_factory=list)

class ClosureDraft(BaseModel):
    root_cause: str
    resolution_steps: Union[str, List[str], Any]
    prevention_measure: str

    @field_validator('resolution_steps', mode='before')
    @classmethod
    def parse_steps(cls, v):
        if isinstance(v, list):
            return "\n- ".join(map(str, v))
        return v

class AiProposal(BaseModel):
    summary: str
    hypotheses: List[Hypothesis]
    missing_info: List[str]
    evidence_pack: List[Evidence]
    next_action_plan: List[ActionPlan]
    
    reply_draft: Optional[EmailDraft] = None
    internal_note_draft: Optional[str] = None
    validation_checklist: Optional[List[str]] = None
    closure_draft: Optional[ClosureDraft] = None
    closure_note: Optional[str] = Field(default="", description="Draft content for closing note")    
    
    confidence_score: float
    next_contact_due_proposal: str    
    routing_suggestion: Optional[str] = None
    escalation_suggestion: Optional[str] = None
    detected_customer_name: Optional[str] = None

class TimelineEvent(BaseModel):
    id: str
    timestamp: str
    type: str
    actor: str
    message: str
    metadata: Optional[Dict[str, Any]] = None

class Case(BaseModel):
    id: str
    title: str
    description: str
    status: CaseStatus
    priority: Priority
    created_at: str
    updated_at: str
    next_contact_due: str
    
    sender_email: Optional[str] = None
    sender_name: Optional[str] = None
    customer_name: Optional[str] = None
    gmail_thread_id: Optional[str] = None
    gmail_message_id: Optional[str] = None
    escalation_target: Optional[str] = Field(default=None, description="Suggested escalation department")    

    latest_proposal: Optional[AiProposal] = None
    timeline: List[TimelineEvent] = Field(default_factory=list)
    waiting_for: List[str] = Field(default_factory=list)

class CreateTriageRequest(BaseModel):
    title: str
    description: str
    logs: Optional[str] = None
    sender_email: Optional[str] = None
    sender_name: Optional[str] = None
    customer_name: Optional[str] = None
    gmail_thread_id: Optional[str] = None

    file_urls: List[str] = Field(default_factory=list)

class ApprovedContent(BaseModel):
    reply_body: Optional[str] = None
    next_status: Optional[CaseStatus] = None

class ApproveRequest(BaseModel):
    action_type: Literal['SEND_REPLY', 'EXECUTE_FIX', 'JUST_UPDATE_STATUS']
    approved_content: ApprovedContent
    operator_name: Optional[str] = "サポートチーム"
    is_simulation: bool = False

class ReplyIngestRequest(BaseModel):
    reply_text: str
    new_logs: Optional[str] = None
    new_file_urls: List[str] = Field(default_factory=list)

class CloseRequest(BaseModel):
    closure_note: str = ""
    publish_kb: bool = False

class PubSubMessage(BaseModel):
    message: dict
    subscription: str

class ChatRequest(BaseModel):
    user_query: str  
