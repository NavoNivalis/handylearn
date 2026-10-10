import { requestUrl } from "obsidian";

import { HandyLearnSettings } from "src/settings";

/** OpenAI 兼容的对话补全接口。 */
const PROVIDERS: Record<string, { endpoint: string; defaultModel: string }> = {
    deepseek: {
        endpoint: "https://api.deepseek.com/chat/completions",
        defaultModel: "deepseek-chat",
    },
    doubao: {
        endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
        defaultModel: "",
    },
};

export interface GeneratedExample {
    sentence: string;
    translation: string;
}

const SYSTEM_PROMPT = [
    "You write one English example sentence for a vocabulary flashcard.",
    "Rules:",
    "- Use the target word exactly once, in its most common and useful sense.",
    "- Keep the sentence natural and self-contained (roughly B1-B2 level).",
    "- Write an original sentence. Never copy from any dictionary.",
    '- Reply with ONLY a JSON object: {"sentence": "...", "translation": "中文翻译"}',
].join("\n");

function extractJson(content: string): Partial<GeneratedExample> | null {
    const cleaned = content.replace(/```(?:json)?/g, "");
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match === null) return null;
    try {
        return JSON.parse(match[0]) as Partial<GeneratedExample>;
    } catch {
        return null;
    }
}

/** 用 DeepSeek 或豆包生成例句，两者都是 OpenAI 兼容接口。 */
export class VocabAi {
    static isConfigured(settings: HandyLearnSettings): boolean {
        return settings.vocabAiApiKey.trim().length > 0;
    }

    static async generateExample(word: string, settings: HandyLearnSettings): Promise<GeneratedExample> {
        const provider = PROVIDERS[settings.vocabAiProvider] ?? PROVIDERS.deepseek;
        const model = settings.vocabAiModel.trim() || provider.defaultModel;
        if (model.length === 0) {
            throw new Error("AI model is not configured");
        }

        const response = await requestUrl({
            url: provider.endpoint,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${settings.vocabAiApiKey.trim()}`,
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: word },
                ],
                temperature: 0.7,
            }),
            throw: false,
        });

        if (response.status !== 200) {
            throw new Error(`AI request failed: HTTP ${response.status}`);
        }

        const content: string = response.json?.choices?.[0]?.message?.content ?? "";
        const parsed = extractJson(content);
        if (parsed === null || !parsed.sentence) {
            throw new Error("AI returned an unexpected response");
        }

        return {
            sentence: parsed.sentence,
            translation: typeof parsed.translation === "string" ? parsed.translation : "",
        };
    }
}
