import { App, normalizePath } from "obsidian";

import { ensureVocabFolder } from "src/dictionary/vocab-vault";

/** 简单词列表的文件名（放在词库目录下，`_` 前缀避免和词卡混淆）。 */
const SIMPLE_WORDS_FILENAME = "_simple.md";

export function simpleWordsPath(folder: string): string {
    return normalizePath(`${folder}/${SIMPLE_WORDS_FILENAME}`);
}

/** 读简单词列表，每行一个词。 */
export async function loadSimpleWords(app: App, folder: string): Promise<Set<string>> {
    const path = simpleWordsPath(folder);
    if (!(await app.vault.adapter.exists(path))) return new Set();

    const text = await app.vault.adapter.read(path);
    const words = new Set<string>();
    for (const line of text.split("\n")) {
        const word = line.trim().toLowerCase();
        if (word.length > 0) words.add(word);
    }
    return words;
}

/** 往简单词列表追加一个词（去重、按字母排序）。 */
export async function addSimpleWord(app: App, folder: string, word: string): Promise<void> {
    const lower = word.trim().toLowerCase();
    if (lower.length === 0) return;

    const words = await loadSimpleWords(app, folder);
    if (words.has(lower)) return;
    words.add(lower);

    const content = `${[...words].sort().join("\n")}\n`;
    const path = simpleWordsPath(folder);
    if (await app.vault.adapter.exists(path)) {
        await app.vault.adapter.write(path, content);
    } else {
        await ensureVocabFolder(app, folder);
        await app.vault.create(path, content);
    }
}
