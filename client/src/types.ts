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
