import { Menu } from "obsidian";

import { SettingsManager } from "src/data/settings-manager";
import { t } from "src/lang/helpers";
import SRPlugin from "src/main";
import { CreateVocabCardModal } from "src/ui/obsidian-ui-components/modals/create-vocab-card-modal";

const WORD_CHAR = /[A-Za-z'’-]/;
const WORD_FULL = /^[A-Za-z][A-Za-z'’-]*$/;

/**
 * 阅读模式：右键一个英文单词即可自动选中并建卡，免去手动划选。
 *
 * 只在 reading view（Markdown post processor）生效；live preview 的编辑部分不在此列。
 */
export class WordContextMenu {
    private plugin: SRPlugin;
    private settingsManager: SettingsManager;

    constructor(plugin: SRPlugin, settingsManager: SettingsManager) {
        this.plugin = plugin;
        this.settingsManager = settingsManager;
    }

    register(): void {
        this.plugin.registerMarkdownPostProcessor((el) => {
            if (el.hasClass("sr-word-menu-bound")) return;
            el.addClass("sr-word-menu-bound");
            el.addEventListener("contextmenu", (event) => this.handleContextMenu(event));
        });
    }

    private handleContextMenu(event: MouseEvent): void {
        const word = this.wordAtPoint(event.clientX, event.clientY);
        if (word === null) return;

        event.preventDefault();
        event.stopPropagation();

        // 视觉上选中这个词
        const selection = window.getSelection();
        if (selection !== null) {
            selection.removeAllRanges();
            selection.addRange(word.range);
        }

        const menu = new Menu();
        menu.addItem((item) =>
            item
                .setTitle(`${t("CREATE_VOCAB_CARD")}：${word.text}`)
                .setIcon("book-plus")
                .onClick(() => {
                    new CreateVocabCardModal(
                        this.plugin.app,
                        this.plugin.dictionary,
                        this.settingsManager,
                        word.text,
                    ).open();
                }),
        );
        menu.showAtMouseEvent(event);
    }

    private wordAtPoint(x: number, y: number): { text: string; range: Range } | null {
        const range = document.caretRangeFromPoint(x, y);
        if (range === null) return null;

        const node = range.startContainer;
        if (node.nodeType !== Node.TEXT_NODE) return null;

        const text = node.textContent ?? "";
        let start = range.startOffset;
        let end = range.endOffset;

        while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
        while (end < text.length && WORD_CHAR.test(text[end])) end++;

        const wordText = text.slice(start, end);
        if (!WORD_FULL.test(wordText)) return null;

        const wordRange = document.createRange();
        wordRange.setStart(node, start);
        wordRange.setEnd(node, end);
        return { text: wordText, range: wordRange };
    }
}
