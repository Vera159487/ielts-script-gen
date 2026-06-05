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

/**
 * 调用 DeepSeek API 生成脚本（非流式）
 */
export async function generateScript(options: GenerateOptions): Promise<string> {
  const { buildSystemPrompt, buildUserPrompt } = await import("./prompt");

  const systemPrompt = buildSystemPrompt(options.stylePrompt);
  const userPrompt = buildUserPrompt(options.topic, options.referenceScript);

  const response = await client.chat.completions.create({
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.8,
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content || "";

  if (!content) {
    throw new Error("AI 返回内容为空，请重试");
  }

  return content;
}

/**
 * 调用 DeepSeek API 生成脚本（流式 SSE）
 * 返回一个 AsyncIterable，逐段产出文本
 */
export async function* generateScriptStream(
  options: GenerateOptions
): AsyncIterable<string> {
  const { buildSystemPrompt, buildUserPrompt } = await import("./prompt");

  const systemPrompt = buildSystemPrompt(options.stylePrompt);
  const userPrompt = buildUserPrompt(options.topic, options.referenceScript);

  const stream = await client.chat.completions.create({
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.8,
    max_tokens: 4096,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      yield delta;
    }
  }
}
