# HandyLearn

Pick up English effortlessly while reading in Obsidian.

HandyLearn turns your vault into a personal English vocabulary notebook. While reading papers, docs, or notes, you can capture unfamiliar words, build flashcards with rich context, and review them with spaced repetition — without leaving Obsidian.

## Features

- **Capture words while reading**: right-click any English word in reading view to create a flashcard instantly.
- **Highlight known words**: words you've already captured are underlined with a dashed line; click one to jump to its card.
- **Extract vocabulary from a note**: scan the current note, group words by exam list (CET-4 / CET-6 / 考研 / 托福 / 雅思 / GRE) or by frequency, then tick and batch-create cards.
- **Batch create from exam lists**: build cards in bulk from a curated exam word list.
- **Spaced repetition (SM2)**: review with recognition cards (recall the meaning) and spelling cards (type the word), with keyboard shortcuts.
- **Pronunciation**: click the speaker icon to hear the word (system text-to-speech).
- **AI example sentences (optional)**: generate example sentences via DeepSeek or Doubao (OpenAI-compatible APIs).
- **Contextual backlinks**: each card records the note(s) where you encountered the word.

## Installation

### From the community directory

1. Open Obsidian → Settings → Community plugins → Browse.
2. Search for "HandyLearn" and install.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Put them in `<vault>/.obsidian/plugins/handylearn/`.
3. Enable the plugin in Settings → Community plugins.

## Usage

- Open the HandyLearn sidebar from the ribbon icon (book) or the "打开顺手学" command.
- **Create a card**: right-click a word in reading view, or run the "新建词卡" command.
- **Extract from note**: run "从当前笔记提取生词" to scan the current note and batch-create cards.
- **Batch create**: run "批量建卡" to create cards from an exam word list.
- **Review**: click "开始今日学习" in the sidebar. Press `Space` to flip a card, then `0` / `1` / `2` / `3` to rate. For spelling cards, type the word and press `Enter`; if wrong, press `Space` to continue.

## Settings

- **Vocab folder**: where flashcards are stored (default `Words`).
- **Highlight known words**: toggle the dashed-underline highlighting in reading view.
- **AI examples**: configure an API key and provider (DeepSeek or Doubao) to generate example sentences. Leave the key empty to disable AI examples.

## Acknowledgments

Parts of the implementation (notably pronunciation and the dictionary / word-card handling) are based on [obsidian-spaced-repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) by Stephen Mwangi, licensed under the MIT License.
