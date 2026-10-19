import {
    FIELD_EXAM,
    FIELD_EXAMPLE,
    FIELD_FORMS,
    FIELD_FREQUENCY,
    FIELD_GLOSS,
    FIELD_IPA,
    FIELD_SOURCE,
    FIELD_TRANSLATION,
    FieldTemplate,
    LOCKED_FIELD_LABELS,
} from "src/engine/card";

export interface HandyLearnSettings {
    /** 词卡存放目录。 */
    vocabOutputFolder: string;
    /** 阅读模式高亮已建卡单词。 */
    highlightEnabled: boolean;
    /** AI 例句用的 API Key（为空则不用 AI 例句）。 */
    vocabAiApiKey: string;
    /** AI 服务商：deepseek / doubao。 */
    vocabAiProvider: "deepseek" | "doubao";
    /** AI 模型名，留空用服务商默认。 */
    vocabAiModel: string;
    /** 新建词卡时的字段模板（字段名 + 所属面 + 顺序）。 */
    fieldTemplates: FieldTemplate[];
}

/** 默认字段模板，跟旧版词卡格式一致。 */
export const DEFAULT_FIELD_TEMPLATES: FieldTemplate[] = [
    { label: FIELD_GLOSS, side: "back" },
    { label: FIELD_IPA, side: "back" },
    { label: FIELD_EXAMPLE, side: "back" },
    { label: FIELD_TRANSLATION, side: "back" },
    { label: FIELD_FORMS, side: "back" },
    { label: FIELD_EXAM, side: "back" },
    { label: FIELD_FREQUENCY, side: "back" },
    { label: FIELD_SOURCE, side: "back" },
];

export const DEFAULT_SETTINGS: HandyLearnSettings = {
    vocabOutputFolder: "Words",
    highlightEnabled: true,
    vocabAiApiKey: "",
    vocabAiProvider: "deepseek",
    vocabAiModel: "",
    fieldTemplates: DEFAULT_FIELD_TEMPLATES,
};

/**
 * 校验并补全字段模板：
 * - 丢掉名字为空或重复的项；
 * - 锁定字段（释义、音标）强制留在背面且必然存在。
 */
export function normalizeFieldTemplates(input: unknown): FieldTemplate[] {
    const source = Array.isArray(input) ? input : [];
    const result: FieldTemplate[] = [];

    for (const item of source) {
        if (typeof item !== "object" || item === null) continue;
        const label = typeof item.label === "string" ? item.label.trim() : "";
        if (label === "" || result.some((field) => field.label === label)) continue;
        const side = LOCKED_FIELD_LABELS.includes(label)
            ? "back"
            : item.side === "front"
              ? "front"
              : "back";
        result.push({ label, side });
    }

    LOCKED_FIELD_LABELS.forEach((label, index) => {
        if (!result.some((field) => field.label === label)) {
            result.splice(index, 0, { label, side: "back" });
        }
    });

    return result;
}
