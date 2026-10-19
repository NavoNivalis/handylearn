import { App, normalizePath } from "obsidian";
import bundledDict from "../../ecdict-mini.json";

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
    /** 变体 → 词根 反向索引（由 ex 字段构建，词频优先消歧）。 */
    private variantToBase = new Map<string, string>();

    /** 从插件目录加载词典数据。 */
    async load(app: App, pluginId: string): Promise<void> {
        if (this.map !== null) return;

        // 优先读插件目录下的词典文件（手动安装可替换），
        // 不存在则回退到构建时内联进 main.js 的词典数据，保证社区安装后开箱即用。
        const path = normalizePath(`${app.vault.configDir}/plugins/${pluginId}/ecdict-mini.json`);
        let data: Record<string, DictEntry>;
        if (await app.vault.adapter.exists(path)) {
            const raw = await app.vault.adapter.read(path);
            data = JSON.parse(raw) as Record<string, DictEntry>;
        } else {
            data = bundledDict as Record<string, DictEntry>;
        }

        this.map = new Map(Object.entries(data));
        this.buildVariantIndex();
    }

    isLoaded(): boolean {
        return this.map !== null;
    }

    /** 查一个词；精确查不到时会尝试词形还原（变体 → 词根）再查。 */
    query(word: string): DictEntry | null {
        if (this.map === null) return null;
        const lower = word.trim().toLowerCase();
        const exact = this.map.get(lower);
        if (exact !== undefined) return exact;
        const base = this.variantToBase.get(lower);
        return base === undefined ? null : this.map.get(base) ?? null;
    }

    /** 词形还原：把变体（复数/进行时/过去式等）还原成词根；本身是词根或查不到就原样返回（小写）。 */
    lemma(word: string): string {
        const lower = word.trim().toLowerCase();
        if (lower === "" || this.map === null) return lower;
        if (this.map.has(lower)) return lower;
        return this.variantToBase.get(lower) ?? lower;
    }

    /** 从词典 ex 字段构建「变体 → 词根」反向索引；一个变体对应多个词根时按词频取更常见的。 */
    private buildVariantIndex(): void {
        this.variantToBase.clear();
        if (this.map === null) return;

        const handledTypes = new Set(["p", "d", "i", "3", "r", "t", "s"]);

        for (const [word, entry] of this.map) {
            const ex = entry.ex;
            if (!ex) continue;
            const base = word.toLowerCase();

            for (const part of ex.split("/")) {
                const colon = part.indexOf(":");
                if (colon === -1) continue;
                const type = part.slice(0, colon).trim();
                if (!handledTypes.has(type)) continue;
                const form = part.slice(colon + 1).trim().toLowerCase();
                if (form === "" || form === base) continue;

                const existing = this.variantToBase.get(form);
                if (existing === undefined || this.frequency(base) < this.frequency(existing)) {
                    this.variantToBase.set(form, base);
                }
            }
        }
    }

    /** 词频排名，越小越常见；没有词频视为最大（最不常见）。 */
    private frequency(word: string): number {
        const raw = this.map?.get(word)?.frq;
        const frq = Number.parseInt(raw ?? "", 10);
        return Number.isFinite(frq) && frq > 0 ? frq : Number.MAX_SAFE_INTEGER;
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
