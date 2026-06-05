import initSqlJs, { Database, BindParams } from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { v4 as uuid } from "uuid";

const DB_PATH = resolve(__dirname, "../data.db");

let db: Database;

// ========== 初始化 ==========

export async function initDB(): Promise<void> {
  // 确保目录存在
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    const { mkdirSync } = await import("fs");
    mkdirSync(dir, { recursive: true });
  }

  const SQL = await initSqlJs();

  // 尝试从文件加载已有数据库
  if (existsSync(DB_PATH)) {
    try {
      const buffer = readFileSync(DB_PATH);
      db = new SQL.Database(buffer);
    } catch {
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  // ========== 原有表 ==========

  db.run(`
    CREATE TABLE IF NOT EXISTS styles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '📝',
      prompt_template TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS scripts (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      style_id TEXT NOT NULL,
      style_name TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (style_id) REFERENCES styles(id)
    )
  `);

  // 为旧 scripts 表补充新字段（忽略已存在错误）
  for (const col of [
    "ALTER TABLE scripts ADD COLUMN session_id TEXT",
    "ALTER TABLE scripts ADD COLUMN source_url TEXT",
    "ALTER TABLE scripts ADD COLUMN original_script TEXT DEFAULT ''",
  ]) {
    try { db.run(col); } catch (_) { /* 字段已存在 */ }
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // ========== 新表：SOP 全链路 ==========

  // 会话表 —— 一次完整的 Pipeline 执行
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      current_step TEXT,
      style_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    )
  `);

  // 步骤产出物表 —— 每个 SOP 步骤的输入输出
  db.run(`
    CREATE TABLE IF NOT EXISTS pipeline_steps (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      step_name TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      input_data TEXT,
      output_data TEXT,
      error_message TEXT,
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `);

  // 关键词缓存表 —— 避免重复调用 AI
  db.run(`
    CREATE TABLE IF NOT EXISTS keyword_banks (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL UNIQUE,
      keywords TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // 小红书爆款帖子表
  db.run(`
    CREATE TABLE IF NOT EXISTS viral_posts (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      xhs_url TEXT NOT NULL,
      title TEXT,
      author_name TEXT,
      author_followers INTEGER,
      likes INTEGER,
      collects INTEGER,
      comments INTEGER,
      duration_seconds INTEGER,
      published_at TEXT,
      script_content TEXT,
      metadata TEXT,
      is_verified INTEGER DEFAULT 0,
      verification_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `);

  // 预置风格
  const existing = db.exec("SELECT COUNT(*) as count FROM styles");
  const count = existing[0]?.values[0]?.[0] as number;

  if (count === 0) {
    const styles = [
      {
        id: uuid(),
        name: "干货教学",
        description: "结构化讲解、分点梳理、知识密集、适合收藏",
        icon: "📚",
        prompt: `【风格：干货教学】
你是一位雅思教学专家，语气专业但不枯燥。脚本要求：
- 开头用"你知道吗？"或数据/事实制造认知落差
- 中间分 3 个要点讲解，每点带具体例子
- 结尾总结 + 引导收藏"以后肯定用得上"
- 句式短小有力，避免长难句
- 适当使用"✅""❌""🔥"等小红书常用符号`,
        order: 1,
      },
      {
        id: uuid(),
        name: "搞笑吐槽",
        description: "幽默调侃、网络热梗、轻松但信息准确",
        icon: "😂",
        prompt: `【风格：搞笑吐槽】
你是一个幽默的雅思过来人，擅长用自嘲和吐槽引发共鸣。脚本要求：
- 开场用夸张对比或崩溃瞬间引起共鸣
- 吐槽雅思考试的"反人类"设计，但暗含备考技巧
- 语气亲切像跟朋友聊天，可以使用网络流行语
- 在搞笑中自然带出正确方法
- 结尾轻松收尾"反正我当时是这么过来的"`,
        order: 2,
      },
      {
        id: uuid(),
        name: "励志鸡血",
        description: "情感激励、逆袭故事、打鸡血但不浮夸",
        icon: "💪",
        prompt: `【风格：励志鸡血】
你是一个从低谷逆袭的雅思过来人，擅长用真实经历打鸡血。脚本要求：
- 开场用"我曾经也以为…"制造共情
- 讲述一个具体的小故事/场景（备考焦虑 → 突破）
- 强调"你也可以做到"，给出具体可执行的第一步
- 语气真诚、温暖、有力量，不空洞喊口号
- 结尾留悬念或互动"你卡在哪个分数段？评论区告诉我"`,
        order: 3,
      },
      {
        id: uuid(),
        name: "情感共鸣",
        description: "备考焦虑共情、温暖鼓励、真实经历",
        icon: "💙",
        prompt: `【风格：情感共鸣】
你是一个温暖陪伴的雅思过来人，理解备考中的焦虑和孤独。脚本要求：
- 开场描述一个备考常见痛点场景（如第N次模考分数没变）
- 先共情"我也经历过，这很正常"
- 再给方法论"但后来我发现了一个方法…"
- 节奏舒缓，给观众思考和吸收的时间
- 结尾温暖鼓励，让观众感觉"被看见"而不是"被说教"`,
        order: 4,
      },
      {
        id: uuid(),
        name: "学霸干货",
        description: "高分技巧、模板分享、数据支撑、权威感",
        icon: "🎓",
        prompt: `【风格：学霸干货】
你是一个雅思高分学霸，擅长用数据和逻辑拆解考试。脚本要求：
- 开场用分数/数据震慑"我雅思8.5分，但我的方法你可能没听过"
- 给出可操作的模板/框架/套路，不是泛泛而谈
- 用对比展示"普通方法 vs 我的方法"的效果差异
- 强调方法论的可复制性"这个方法我带过2000+学员验证过"
- 结尾引导："想知道更多方法的扣1"`,
        order: 5,
      },
    ];

    for (const s of styles) {
      db.run(
        "INSERT INTO styles (id, name, description, icon, prompt_template, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
        [s.id, s.name, s.description, s.icon, s.prompt, s.order]
      );
    }
  }

  // 保存
  saveDB();
}

function saveDB(): void {
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(DB_PATH, buffer);
}

// ========== 样式查询（保留） ==========

export function getStyles() {
  const results: any[] = [];
  const stmt = db.prepare("SELECT * FROM styles ORDER BY sort_order");
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

export function getStyleById(id: string) {
  const stmt = db.prepare("SELECT * FROM styles WHERE id = ?");
  stmt.bind([id]);
  let result: any = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

// ========== 脚本 CRUD（保留 + 扩展） ==========

export function createScript(
  id: string,
  topic: string,
  styleId: string,
  styleName: string,
  content: string,
  sessionId?: string,
  sourceUrl?: string,
  originalScript?: string
) {
  db.run(
    `INSERT INTO scripts (id, topic, style_id, style_name, content, session_id, source_url, original_script)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, topic, styleId, styleName, content, sessionId || null, sourceUrl || null, originalScript || ""]
  );
  saveDB();
}

export function updateScriptContent(id: string, content: string) {
  db.run(
    "UPDATE scripts SET content = ?, updated_at = datetime('now') WHERE id = ?",
    [content, id]
  );
  saveDB();
}

export function getScripts(limit = 50, offset = 0) {
  const results: any[] = [];
  const stmt = db.prepare(
    "SELECT * FROM scripts ORDER BY created_at DESC LIMIT ? OFFSET ?"
  );
  stmt.bind([limit, offset]);
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

export function getScriptById(id: string) {
  const stmt = db.prepare("SELECT * FROM scripts WHERE id = ?");
  stmt.bind([id]);
  let result: any = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

export function deleteScript(id: string) {
  db.run("DELETE FROM scripts WHERE id = ?", [id]);
  saveDB();
}

export function getScriptsCount(): number {
  const stmt = db.prepare("SELECT COUNT(*) as count FROM scripts");
  stmt.bind([]);
  let count = 0;
  if (stmt.step()) {
    count = stmt.getAsObject().count as number;
  }
  stmt.free();
  return count;
}

// ========== 会话管理 (Sessions) ==========

export function createSession(id: string, topic: string, styleId?: string) {
  db.run(
    "INSERT INTO sessions (id, topic, style_id, status) VALUES (?, ?, ?, 'pending')",
    [id, topic, styleId || null]
  );
  saveDB();
}

export function updateSessionStatus(id: string, status: string, currentStep?: string) {
  const now = new Date().toISOString();
  if (status === "completed") {
    db.run(
      "UPDATE sessions SET status = ?, current_step = ?, updated_at = ?, completed_at = ? WHERE id = ?",
      [status, currentStep || null, now, now, id]
    );
  } else {
    db.run(
      "UPDATE sessions SET status = ?, current_step = ?, updated_at = ? WHERE id = ?",
      [status, currentStep || null, now, id]
    );
  }
  saveDB();
}

export function getSessionById(id: string) {
  const stmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
  stmt.bind([id]);
  let result: any = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

export function getSessions(limit = 50, offset = 0) {
  const results: any[] = [];
  const stmt = db.prepare(
    "SELECT * FROM sessions ORDER BY created_at DESC LIMIT ? OFFSET ?"
  );
  stmt.bind([limit, offset]);
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

export function getSessionsCount(): number {
  const stmt = db.prepare("SELECT COUNT(*) as count FROM sessions");
  stmt.bind([]);
  let count = 0;
  if (stmt.step()) {
    count = stmt.getAsObject().count as number;
  }
  stmt.free();
  return count;
}

export function deleteSession(id: string) {
  db.run("DELETE FROM pipeline_steps WHERE session_id = ?", [id]);
  db.run("DELETE FROM viral_posts WHERE session_id = ?", [id]);
  db.run("DELETE FROM sessions WHERE id = ?", [id]);
  saveDB();
}

// ========== 步骤管理 (Pipeline Steps) ==========

export function createStep(
  id: string, sessionId: string, stepName: string, stepOrder: number,
  inputData?: string, maxRetries = 3
) {
  db.run(
    `INSERT INTO pipeline_steps (id, session_id, step_name, step_order, input_data, max_retries, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [id, sessionId, stepName, stepOrder, inputData || null, maxRetries]
  );
  saveDB();
}

export function updateStepStatus(
  id: string, status: string, outputData?: string, errorMessage?: string
) {
  const now = new Date().toISOString();
  if (status === "running") {
    db.run(
      "UPDATE pipeline_steps SET status = ?, started_at = ? WHERE id = ?",
      [status, now, id]
    );
  } else if (status === "completed") {
    db.run(
      "UPDATE pipeline_steps SET status = ?, output_data = ?, completed_at = ? WHERE id = ?",
      [status, outputData || null, now, id]
    );
  } else if (status === "failed") {
    db.run(
      "UPDATE pipeline_steps SET status = ?, error_message = ?, retry_count = retry_count + 1 WHERE id = ?",
      [status, errorMessage || null, id]
    );
  }
  saveDB();
}

export function getStepsBySession(sessionId: string) {
  const results: any[] = [];
  const stmt = db.prepare(
    "SELECT * FROM pipeline_steps WHERE session_id = ? ORDER BY step_order"
  );
  stmt.bind([sessionId]);
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

export function getStepById(id: string) {
  const stmt = db.prepare("SELECT * FROM pipeline_steps WHERE id = ?");
  stmt.bind([id]);
  let result: any = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

// ========== 关键词缓存 (Keyword Banks) ==========

export function getCachedKeywords(topic: string): string[] | null {
  const stmt = db.prepare("SELECT keywords FROM keyword_banks WHERE topic = ?");
  stmt.bind([topic]);
  let result: string | null = null;
  if (stmt.step()) {
    result = stmt.getAsObject().keywords as string;
  }
  stmt.free();
  if (result) {
    try { return JSON.parse(result); } catch { return null; }
  }
  return null;
}

export function cacheKeywords(topic: string, keywords: string[]) {
  // INSERT OR REPLACE
  const existing = getCachedKeywords(topic);
  if (existing) {
    db.run("UPDATE keyword_banks SET keywords = ?, created_at = datetime('now') WHERE topic = ?",
      [JSON.stringify(keywords), topic]);
  } else {
    db.run("INSERT INTO keyword_banks (id, topic, keywords) VALUES (?, ?, ?)",
      [uuid(), topic, JSON.stringify(keywords)]);
  }
  saveDB();
}

// ========== 爆款帖子管理 (Viral Posts) ==========

export function createViralPost(post: {
  id: string; sessionId: string; xhsUrl: string; title?: string;
  authorName?: string; authorFollowers?: number;
  likes?: number; collects?: number; comments?: number;
  durationSeconds?: number; publishedAt?: string;
  scriptContent?: string; metadata?: string;
}) {
  db.run(
    `INSERT INTO viral_posts (id, session_id, xhs_url, title, author_name, author_followers,
     likes, collects, comments, duration_seconds, published_at, script_content, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      post.id, post.sessionId, post.xhsUrl, post.title || null,
      post.authorName || null, post.authorFollowers || null,
      post.likes || null, post.collects || null, post.comments || null,
      post.durationSeconds || null, post.publishedAt || null,
      post.scriptContent || null, post.metadata || null,
    ]
  );
  saveDB();
}

export function updateViralPostVerification(
  id: string, isVerified: boolean, notes?: string
) {
  db.run(
    "UPDATE viral_posts SET is_verified = ?, verification_notes = ? WHERE id = ?",
    [isVerified ? 1 : 0, notes || null, id]
  );
  saveDB();
}

export function getViralPostsBySession(sessionId: string) {
  const results: any[] = [];
  const stmt = db.prepare(
    "SELECT * FROM viral_posts WHERE session_id = ? ORDER BY likes DESC"
  );
  stmt.bind([sessionId]);
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

export function getVerifiedViralPosts(sessionId: string) {
  const results: any[] = [];
  const stmt = db.prepare(
    "SELECT * FROM viral_posts WHERE session_id = ? AND is_verified = 1 ORDER BY likes DESC"
  );
  stmt.bind([sessionId]);
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}
