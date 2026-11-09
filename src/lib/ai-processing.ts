export type AIProcessingStatus =
  | "analyzing"
  | "retrieving_context"
  | "processing_data"
  | "predicting"
  | "generating"
  | "validating"
  | "retrying"
  | "completed"
  | "error";

export interface AIStatusEvent {
  status: AIProcessingStatus;
}

export interface AICompleteEvent {
  reply: string;
  commands?: Array<{ action: string; args?: Record<string, unknown> }>;
  results?: Array<Record<string, unknown>>;
  suggestions?: string[];
  intent?: string;
  status?: string;
  clarification?: string;
  /** Structured clarification (slot, options, partial understanding) */
  clarification_request?: import("@/types").ClarificationRequest | null;
  confidence?: number;
  error?: string;
  /** Decision Intelligence: structured analysis payload from the agent */
  analysis_payload?: import("@/types").AnalysisPayload | null;
  /** Analysis context (indicator, geography, periods) to send back in follow-ups */
  analysisContext?: Record<string, unknown> | null;
}
