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
  session_id?: string;
  source_url?: string;
  original_script?: string;
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

/** 小红书帖子类型 */
export type XHSPostType = "video" | "note";

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
  postType?: XHSPostType;
}

/** 四维过滤详情 */
export interface FilterDetail {
  passed: boolean;
  matchPercent: number;
  requirement: string;
  actual: string;
}

/** 验证结果（纯数学计算，Step 3 仅展示四维数据） */
export interface VerifyResult {
  passesFilter: boolean;
  filterDetails?: {
    timeliness?: FilterDetail;
    duration?: FilterDetail;
    dataQuality?: FilterDetail;
    authorQuality?: FilterDetail;
  };
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

/** 自动搜索小红书结果
 * ⚠️ 与 server/src/services/xhs-search.ts 中的 XHSSearchResult 保持同步 */
export interface XHSSearchResult {
  url: string;
  title: string;
  snippet: string;
  keyword: string;
  xsecToken?: string;
  postType?: XHSPostType;
  likes?: number;
  /** 四维预筛选匹配度均值（0-100），用于前端排序和阈值标注 */
  matchPercent?: number;
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
