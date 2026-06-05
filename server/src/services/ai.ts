import OpenAI from "openai";
import { DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL } from "../config";

const client = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: DEEPSEEK_BASE_URL,
});

export interface GenerateOptions {
  topic: string;
  stylePrompt: string;
  referenceScript?: string;
}

// ========== 通用 AI 调用 ==========

export interface ChatOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json_object";
}

/**
 * 通用非流式调用
 */
export async function chat(options: ChatOptions): Promise<string> {
  const response = await client.chat.completions.create({
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: options.systemPrompt },
      { role: "user", content: options.userPrompt },
    ],
    temperature: options.temperature ?? 0.8,
    max_tokens: options.maxTokens ?? 4096,
    ...(options.responseFormat === "json_object"
      ? { response_format: { type: "json_object" } }
      : {}),
  });

  const content = response.choices[0]?.message?.content || "";

  if (!content) {
    throw new Error("AI 返回内容为空，请重试");
  }

  return content;
}

/**
 * 通用流式调用
 * 返回 AsyncIterable，逐段产出文本
 */
export async function* chatStream(
  options: ChatOptions
): AsyncIterable<string> {
  const stream = await client.chat.completions.create({
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: options.systemPrompt },
      { role: "user", content: options.userPrompt },
    ],
    temperature: options.temperature ?? 0.8,
    max_tokens: options.maxTokens ?? 4096,
    stream: true,
    ...(options.responseFormat === "json_object"
      ? { response_format: { type: "json_object" } }
      : {}),
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      yield delta;
    }
  }
}

// ========== 旧版脚本生成（保留兼容） ==========

/**
 * 调用 DeepSeek API 生成脚本（非流式）
 */
export async function generateScript(options: GenerateOptions): Promise<string> {
  const { buildSystemPrompt, buildUserPrompt } = await import("./prompt");

  const systemPrompt = buildSystemPrompt(options.stylePrompt);
  const userPrompt = buildUserPrompt(options.topic, options.referenceScript);

  return chat({ systemPrompt, userPrompt });
}

/**
 * 调用 DeepSeek API 生成脚本（流式 SSE）
 */
export async function* generateScriptStream(
  options: GenerateOptions
): AsyncIterable<string> {
  const { buildSystemPrompt, buildUserPrompt } = await import("./prompt");

  const systemPrompt = buildSystemPrompt(options.stylePrompt);
  const userPrompt = buildUserPrompt(options.topic, options.referenceScript);

  yield* chatStream({ systemPrompt, userPrompt });
}
