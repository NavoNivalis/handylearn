import { App, normalizePath } from "obsidian";

/** 词典里的一条词条，字段名与 ecdict-mini.json 保持一致（尽量短）。 */
export interface DictEntry {
    /** 规范 IPA 音标（美式优先），可能为空 */
    ipa?: string;
    /** 中文释义（多行） */
    t?: string;
    /** 考试标签：zk gk cet4 cet6 ky toefl ielts gre */
    tag?: string;
    /** BNC 语料库词频排名 */
    bnc?: string;
    /** 当代语料库词频排名 */
    frq?: string;
    /** 词形变化（exchange） */
    ex?: string;
}

/**
 * 离线英汉词典，数据源为插件目录下的 ecdict-mini.json。
 * 所有词典访问都走这个类，以后换数据源只需改这里。
 */
export class Ecdict {
    private map: Map<string, DictEntry> | null = null;
    private tagCache = new Map<string, string[]>();

    /** 从插件目录加载词典数据。 */
    async load(app: App, pluginId: string): Promise<void> {
        if (this.map !== null) return;

        const path = normalizePath(`${app.vault.configDir}/plugins/${pluginId}/ecdict-mini.json`);
        if (!(await app.vault.adapter.exists(path))) return;

        const raw = await app.vault.adapter.read(path);
        this.map = new Map(Object.entries(JSON.parse(raw) as Record<string, DictEntry>));
    }

    isLoaded(): boolean {
        return this.map !== null;
    }

    /** 精确查一个词；查不到返回 null。 */
    query(word: string): DictEntry | null {
        if (this.map === null) return null;
        return this.map.get(word.trim().toLowerCase()) ?? null;
    }

    /** 模糊搜索，支持英文和中文。英文前缀优先，再子串；中文匹配释义。按词频排序。 */
    search(query: string, limit = 50): { word: string; entry: DictEntry }[] {
        if (this.map === null) return [];

        const q = query.trim().toLowerCase();
        if (q === "") return [];

        const prefix: { word: string; entry: DictEntry; frq: number }[] = [];
        const contains: { word: string; entry: DictEntry; frq: number }[] = [];
        const chinese: { word: string; entry: DictEntry; frq: number }[] = [];

        for (const [word, entry] of this.map) {
            const frq = Number.parseInt(entry.frq ?? "", 10) || 0;
            const lower = word.toLowerCase();

            if (lower.startsWith(q)) prefix.push({ word, entry, frq });
            else if (lower.includes(q)) contains.push({ word, entry, frq });
            else if ((entry.t ?? "").includes(query.trim())) chinese.push({ word, entry, frq });
        }

        const byFrequency = (items: { word: string; entry: DictEntry; frq: number }[]): void => {
            items.sort((a, b) => {
                const left = a.frq === 0 ? Number.MAX_SAFE_INTEGER : a.frq;
                const right = b.frq === 0 ? Number.MAX_SAFE_INTEGER : b.frq;
                return left - right;
            });
        };
        byFrequency(prefix);
        byFrequency(contains);
        byFrequency(chinese);

        const seen = new Set<string>();
        const result: { word: string; entry: DictEntry }[] = [];
        for (const item of [...prefix, ...contains, ...chinese]) {
            if (seen.has(item.word)) continue;
            seen.add(item.word);
            result.push({ word: item.word, entry: item.entry });
            if (result.length >= limit) break;
        }

        return result;
    }

    /** 列出所有带某个考试标签的词，按词频排序。 */
    listByTag(tag: string): string[] {
        if (this.map === null) return [];

        const cached = this.tagCache.get(tag);
        if (cached !== undefined) return cached;

        const matched: { word: string; frq: number }[] = [];
        for (const [word, entry] of this.map) {
            if (!entry.tag || !entry.tag.split(/\s+/).includes(tag)) continue;
            matched.push({ word, frq: Number.parseInt(entry.frq ?? "", 10) || 0 });
        }

        matched.sort((a, b) => {
            const left = a.frq === 0 ? Number.MAX_SAFE_INTEGER : a.frq;
            const right = b.frq === 0 ? Number.MAX_SAFE_INTEGER : b.frq;
            return left - right;
        });

        const result = matched.map((item) => item.word);
        this.tagCache.set(tag, result);
        return result;
    }
}
