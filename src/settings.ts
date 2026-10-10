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
}

export const DEFAULT_SETTINGS: HandyLearnSettings = {
    vocabOutputFolder: "Words",
    highlightEnabled: true,
    vocabAiApiKey: "",
    vocabAiProvider: "deepseek",
    vocabAiModel: "",
};
