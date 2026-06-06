/**
 * 服务端共享类型定义
 *
 * 将原本在 pipeline.ts 中内联定义的类型提取到此文件，
 * 消除 server/client 之间以及 server 内部不同模块之间的类型重复。
 */

// ========== 四维过滤阈值（共享常量） ==========

/** 数据质量评分的基准值：达到这些值即视为该维度的满分 */
export const FILTER_THRESHOLDS = {
  dataQuality: {
    /** 点赞数满分基准 */
    likes: 1000,
    /** 收藏数满分基准 */
    collects: 500,
    /** 评论数满分基准 */
    comments: 5,
  },
} as const;

// ========== Pipeline 进度事件 ==========

export interface ProgressEvent {
  type: "step_start" | "step_progress" | "step_complete" | "step_error" | "pipeline_complete";
  step?: string;
  stepOrder?: number;
  message: string;
  data?: any;
}

// ========== 小红书帖子数据 ==========

export interface ViralPostData {
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
  postType?: "video" | "note";
}

// ========== 四维过滤 ==========

export interface FilterDetail {
  passed: boolean;
  matchPercent: number;
  requirement: string;
  actual: string;
}

export interface VerifyResult {
  passesFilter: boolean;
  filterDetails?: {
    timeliness?: FilterDetail;
    duration?: FilterDetail;
    dataQuality?: FilterDetail;
    authorQuality?: FilterDetail;
  };
}
