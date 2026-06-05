# 破7学院 · 小红书视频脚本生成器

自动生成雅思课程小红书视频脚本的 Web 工具。

## 功能

- 📝 **话题输入**：输入雅思相关话题关键词
- 🎨 **风格选择**：干货教学 / 搞笑吐槽 / 励志鸡血 / 情感共鸣 / 学霸干货
- 🤖 **AI 生成**：调用 DeepSeek 大模型，一键生成小红书风格脚本
- ✏️ **预览编辑**：Markdown 渲染预览，支持手动修改
- 📂 **历史管理**：保存已生成脚本，随时复用
- 📤 **导出**：复制到剪贴板 / 下载 TXT / 下载 Markdown

## 快速开始

```bash
# 1. 安装依赖
npm install
cd server && npm install
cd ../client && npm install
cd ..

# 2. 配置环境变量
# 创建 server/.env 文件，填入：
#   DEEPSEEK_API_KEY=你的DeepSeek API密钥
#   DEEPSEEK_BASE_URL=https://api.deepseek.com

# 3. 启动开发服务器
npm run dev
```

浏览器打开 `http://localhost:5173`

## 技术栈

- 前端：React + TypeScript + TailwindCSS + Vite
- 后端：Express + TypeScript
- 数据库：SQLite（better-sqlite3）
- AI：DeepSeek API
