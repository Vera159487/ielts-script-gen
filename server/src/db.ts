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

  // 建表
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

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
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

// ========== 查询方法 ==========

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

export function createScript(
  id: string,
  topic: string,
  styleId: string,
  styleName: string,
  content: string
) {
  db.run(
    "INSERT INTO scripts (id, topic, style_id, style_name, content) VALUES (?, ?, ?, ?, ?)",
    [id, topic, styleId, styleName, content]
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
