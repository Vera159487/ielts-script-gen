/** 脚本风格 */
export interface Style {
  id: string;
  name: string;
  description: string;
  icon: string;
  prompt_template: string;
  sort_order: number;
}

/** 脚本记录 */
export interface Script {
  id: string;
  topic: string;
  style_id: string;
  style_name: string;
  content: string;
  created_at: string;
  updated_at: string;
  /** 新增：关联会话 */
  session_id?: string;
  /** 新增：原爆款链接 */
  source_url?: string;
  /** 新增：原爆款脚本 */
  original_script?: string;
}

/** SSE 数据块 */
export interface SSEChunk {
  type: "chunk" | "done" | "error";
  content?: string;
  scriptId?: string;
  topic?: string;
  styleName?: string;
  message?: string;
}

// ========== Pipeline 新类型 ==========

/** 会话 */
export interface Session {
  id: string;
  topic: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  current_step: string | null;
  style_id?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

/** 步骤状态 */
export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/** Pipeline 步骤 */
export interface PipelineStep {
  id: string;
  session_id: string;
  step_name: "keywords" | "search" | "verify" | "rewrite";
  step_order: number;
  status: StepStatus;
  input_data?: string;
  output_data?: string;
  error_message?: string;
  retry_count: number;
  max_retries: number;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

/** 小红书帖子数据 */
export interface ViralPost {
  id?: string;
  xhsUrl: string;
  title?: string;
  authorName?: string;
  authorFollowers?: number;
  likes?: number;
  collects?: number;
  comments?: number;
  durationSeconds?: number;
  publishedAt?: string;
  scriptContent?: string;
  isVerified?: boolean;
  verificationNotes?: string;
}

/** 验证结果 */
export interface VerifyResult {
  passesFilter: boolean;
  isGenericViral: boolean;
  genericScore: number;
  strength?: string;
  weakness?: string;
  rewriteSuggestion?: string;
  filterDetails?: any;
}

/** Pipeline 进度事件（来自 SSE） */
export interface ProgressEvent {
  type: "step_start" | "step_progress" | "step_complete" | "step_error" | "pipeline_complete";
  step?: string;
  stepOrder?: number;
  message: string;
  data?: any;
}

/** 会话详情（含步骤和帖子） */
export interface SessionDetail {
  session: Session;
  steps: PipelineStep[];
  posts: ViralPost[];
}

/** 流式改写回调 */
export interface RewriteStreamCallbacks {
  onChunk: (text: string) => void;
  onDone: (
    scriptId: string,
    content: string,
    sourceUrl?: string,
    originalScript?: string
  ) => void;
  onError: (message: string) => void;
}
