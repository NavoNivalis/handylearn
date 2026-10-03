import "src/ui/obsidian-ui-components/content-container/card-container/card-container.css";
import moment from "moment";
import { App, Platform, setIcon } from "obsidian";

import { CardType } from "src/data/data-structures/card/questions/question";
import {
    buildQuiz,
    isAnswerCorrect,
    QuizQuestion,
    stripAnswerHints,
} from "src/data/dictionary/vocab-quiz";
import { SRSettings } from "src/data/settings";
import { t } from "src/lang/helpers";
import type SRPlugin from "src/main";
import { RepItemScheduleInfo } from "src/scheduling/algorithms/base/rep-item-schedule-info";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { FlashcardReviewMode } from "src/scheduling/flashcard-review-sequencer";
import ContextSectionComponent from "src/ui/obsidian-ui-components/content-container/card-container/context-section/context-section";
import ResponseSectionComponent from "src/ui/obsidian-ui-components/content-container/card-container/response-section/response-section";
import CardToolbarComponent from "src/ui/obsidian-ui-components/content-container/card-container/toolbar/toolbar";
import {
    CardState,
    SessionData,
} from "src/ui/obsidian-ui-components/content-container/content-manager";
import { ConfirmationModal } from "src/ui/obsidian-ui-components/modals/confirmation-modal";
import { escapeHtml } from "src/utils/escape-html";
import EmulatedPlatform from "src/utils/platform-detector";
import { pronounce } from "src/utils/pronounce";
import { RenderMarkdownWrapper } from "src/utils/renderers";

// TODO: Refactor cloze rendering into the renderers file
export class CardContainer {
    private app: App;
    private plugin: SRPlugin;
    private cardState: CardState;
    private minimal: boolean;

    private view: HTMLDivElement;

    private toolbar: CardToolbarComponent;
    private contextSection: ContextSectionComponent | null = null;

    private scrollWrapper: HTMLDivElement;
    private content: HTMLDivElement;
    private pendingClock: HTMLDivElement | null = null;
    private pendingResumeTimeout: number | null = null;

    private response: ResponseSectionComponent;

    private clozeInputs: NodeListOf<HTMLInputElement> | null = null;
    private clozeAnswers: NodeListOf<Element> | null = null;

    // 正面答题结果，用于在背面顶部显示对错
    private quizResult: { correct: boolean; answer: string } | null = null;

    private processReviewHandler: (response: ReviewResponse) => Promise<void>;
    private skipCardHandler: () => void;
    private showAnswerHandler: () => void;
    private jumpToCardHandler: () => Promise<void>;

    constructor(
        app: App,
        plugin: SRPlugin,
        settings: SRSettings,
        parentEl: HTMLElement,
        deleteCurrentCard: () => void,
        backToDeckHandler: () => Promise<void>,
        editCardHandler: () => void,
        processReviewHandler: (response: ReviewResponse) => Promise<void>,
        skipCardHandler: () => void,
        showAnswerHandler: () => void,
        jumpToCurrentCardHandler: () => Promise<void>,
        displayCurrentCardInfoNoticeHandler: () => void,
        closeModal?: () => void,
        minimal: boolean = false,
    ) {
        // Init properties
        this.app = app;
        this.plugin = plugin;
        this.cardState = CardState.Closed;
        this.minimal = minimal;
        this.processReviewHandler = processReviewHandler;
        this.skipCardHandler = skipCardHandler;
        this.showAnswerHandler = showAnswerHandler;
        this.jumpToCardHandler = jumpToCurrentCardHandler;

        // Build ui
        this.view = parentEl.createDiv();
        this.view.addClasses(["sr-container", "sr-card-container", "sr-is-hidden"]);

        this.setCustomHotKeyState(settings.useCustomHotkeys);

        this.toolbar = new CardToolbarComponent(
            this.view,
            settings.showDeleteButtonInCardView,
            deleteCurrentCard,
            backToDeckHandler,
            editCardHandler,
            jumpToCurrentCardHandler,
            displayCurrentCardInfoNoticeHandler,
            this.skipCardHandler,
            () => {
                new ConfirmationModal(
                    app,
                    t("DELETE_SCHEDULING_DATA_OF_CURRENT_CARD"),
                    t("CONFIRM_SCHEDULING_DATA_DELETION_OF_CURRENT_CARD"),
                    t("SCHEDULING_DATA_DELETION_IN_PROGRESS_OF_CURRENT_CARD"),
                    async () => {
                        await this.processReviewHandler(ReviewResponse.Reset);
                    },
                ).open();
            },
            closeModal,
            minimal,
        );

        this.scrollWrapper = this.view.createDiv();
        this.scrollWrapper.addClass("sr-scroll-wrapper");

        this.content = this.scrollWrapper.createDiv();
        this.content.addClass("sr-content");

        this.response = new ResponseSectionComponent(
            this.view,
            settings,
            this.showAnswerHandler,
            this.processReviewHandler,
        );
    }

    // #region -> public methods

    /**
     * Shows the FlashcardView if it is hidden
     */
    async openSession(sessionData: SessionData, settings: SRSettings) {
        // Prevents rest of code, from running if this was executed multiple times after one another
        if (!this.view.hasClass("sr-is-hidden")) {
            return;
        }

        await this.drawCardFront(sessionData, settings);

        this.view.removeClass("sr-is-hidden");
        activeDocument.addEventListener("keydown", this._keydownHandler);
    }

    /**
     * Hides the FlashcardView if it is visible
     */
    closeSession() {
        // Prevents the rest of code, from running if this was executed multiple times after one another

        if (this.view.hasClass("sr-is-hidden")) {
            return;
        }
        if (this.pendingResumeTimeout !== null) {
            window.clearTimeout(this.pendingResumeTimeout);
            this.pendingResumeTimeout = null;
        }
        this.cardState = CardState.Closed;
        activeDocument.removeEventListener("keydown", this._keydownHandler);
        this.view.addClass("sr-is-hidden");
    }

    /**
     * Blocks the key input to the FlashcardView
     *
     * @param block
     */
    blockKeyInput(block: boolean) {
        if (block) {
            activeDocument.addEventListener("keydown", this._keydownHandler);
        } else {
            activeDocument.removeEventListener("keydown", this._keydownHandler);
        }
    }

    public async drawCardFront(sessionData: SessionData, settings: SRSettings) {
        this.toolbar.setResetButtonDisabled(true);
        // Update current deck info
        this.cardState = sessionData.cardData.currentCardState;

        this._updateInfoBar(sessionData, settings.flashcardCardOrder);

        // Update card content
        await this.drawCardFrontContent(sessionData, settings);

        // Update response buttons
        this.response.resetResponseButtons();

        // Setup cloze input listeners
        this._setupClozeInputListeners();

        // auto-focus the first cloze input if this card is a cloze card
        if (sessionData.currentQuestion.questionType === CardType.Cloze) {
            const firstInput: HTMLInputElement | null =
                activeDocument.querySelector(".cloze-input");
            if (firstInput) {
                firstInput.focus();
            }
        }
    }

    private drawCardContext(sessionData: SessionData, settings: SRSettings) {
        // 精简模式（复习侧栏）下不显示笔记标题，避免拼卡时透露答案
        if (this.minimal || !settings.showContextInCards) {
            return;
        }
        this.contextSection = new ContextSectionComponent(this.content);
        this.contextSection.updateCardContext(
            settings.showContextInCards,
            sessionData.currentQuestion,
            sessionData.currentNote,
        );
    }

    private async drawCardFrontContent(
        sessionData: SessionData,
        settings: SRSettings,
        isFront = true,
    ) {
        // Update card content
        this.content.empty();

        // Create context section
        this.drawCardContext(sessionData, settings);

        // Build card content
        const wrapper: RenderMarkdownWrapper = new RenderMarkdownWrapper(
            this.app,
            this.plugin,
            sessionData.currentNote.filePath,
        );

        const card = sessionData.cardData.currentCard;
        const front = card.front.trim();
        const back = card.back.trim();

        // 拼卡的正面不能带音标/词形/例句，否则等于给出答案
        const frontText = isFront ? stripAnswerHints(front, back) : card.front.trimStart();

        // 中文正面（拼卡：看中文输英文）用正常字号，不用 2em 粗体大字
        this.content.toggleClass("sr-content-zh", /[\u4e00-\u9fff]/.test(frontText));

        await wrapper.renderMarkdownWrapper(
            frontText,
            this.content,
            sessionData.currentQuestion.questionText.textDirection,
            // sessionData.cardData.currentCardState
        );

        if (isFront) {
            // 正面：答题区（Anki 式的选择题 / 打字题）
            this.renderQuiz(front, back);

            // 正面：单词发音按钮
            this.addPronounceButton(this.pickSpeakable(front, back));

            // 正面显示可折叠的提示（内容取自背面的例句）
            const hintText = this.extractHint(card.back);
            if (hintText) {
                const details = this.content.createEl("details", { cls: "sr-card-hint" });
                details.createEl("summary", { text: t("HINT") });
                details.createEl("div", { text: hintText });
            }
        }

        // Set scroll position back to top
        this.content.scrollTop = 0;
    }

    // 正面的答题区。非词汇卡不会生成题目，正常走自评流程。
    private renderQuiz(front: string, back: string): void {
        const question = buildQuiz(front, back, this.plugin.dictionary);
        if (question === null) return;

        this.quizResult = null;

        const wrap = this.content.createDiv("sr-quiz");

        if (question.kind === "choice") {
            const optionsEl = wrap.createDiv("sr-quiz-options");
            for (const option of question.options ?? []) {
                const button = optionsEl.createEl("button", {
                    cls: "sr-quiz-option",
                    text: option,
                });
                button.addEventListener("click", (event) => {
                    event.stopPropagation();
                    this.submitQuiz(question, option, wrap);
                });
            }
        } else {
            const input = wrap.createEl("input", {
                cls: "sr-quiz-input",
                type: "text",
                attr: { placeholder: t("QUIZ_TYPE_INPUT") },
            });
            input.addEventListener("keydown", (event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                event.stopPropagation();
                this.submitQuiz(question, input.value, wrap);
            });
            input.focus();
        }
    }

    private submitQuiz(question: QuizQuestion, input: string, wrap: HTMLElement): void {
        const correct = isAnswerCorrect(input, question.answer);
        this.quizResult = { correct, answer: question.answer };

        wrap.addClass(correct ? "sr-quiz-correct" : "sr-quiz-wrong");
        wrap.querySelectorAll("button.sr-quiz-option").forEach((el) => {
            el.setAttribute("disabled", "true");
            if (el.textContent === question.answer) {
                el.classList.add("sr-quiz-option-answer");
            }
        });
        wrap.querySelectorAll("input.sr-quiz-input").forEach((el) => {
            el.setAttribute("disabled", "true");
        });

        // 让用户先看到对错，再自动翻面
        window.setTimeout(() => this.showAnswerHandler(), 650);
    }

    // 卡片上该朗读的英文单词（认卡在正面，拼卡在背面）
    private pickSpeakable(front: string, back: string): string {
        const pattern = /^[A-Za-z][A-Za-z\s'’-]{0,59}$/;
        if (pattern.test(front)) return front;
        if (pattern.test(back)) return back;
        return "";
    }

    // 正面加一个发音按钮（仅当正面看起来是一个英文单词/短语时）
    private addPronounceButton(text: string): void {
        if (!/^[A-Za-z][A-Za-z\s'’-]{0,59}$/.test(text)) return;

        const button = this.content.createEl("button", {
            cls: "sr-pronounce-button",
            attr: { "aria-label": t("PRONOUNCE") },
        });
        setIcon(button, "volume-2");
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            pronounce(text);
        });
    }

    // 从背面提取提示：优先 "**例句：** xxx"，其次第一条 "> " 引用行
    private extractHint(back: string): string | null {
        const lines = back.split("\n");
        for (const line of lines) {
            const text = line.trim();
            if (text.startsWith("**例句")) {
                return text.replace(/^\*\*例句[：:]\*\*\s*/, "").trim();
            }
        }
        for (const line of lines) {
            const text = line.trim();
            if (text.startsWith("> ")) {
                return text.slice(2).trim();
            }
        }
        return null;
    }

    public drawPendingState(nextPendingDueUnix: number): void {
        this.toolbar.setResetButtonDisabled(true);
        this.cardState = CardState.Front;
        this.content.empty();
        this.response.hideAllButtons();
        this.pendingClock = this.content.createDiv({
            cls: "sr-centered",
        });

        const updatePendingClock = () => {
            const startTime = moment();
            const endTime = moment(nextPendingDueUnix);

            // Calculate the difference in milliseconds
            const duration = moment.duration(endTime.diff(startTime));

            const hours = Math.floor(duration.asHours());
            const minutes = duration.minutes();
            const seconds = duration.seconds();

            const formatted = `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

            this.pendingClock?.setText(
                `Waiting for the next FSRS review step. Next card due in ${formatted} (HH:mm:ss).`,
            );
            this.pendingResumeTimeout = window.setTimeout(() => {
                updatePendingClock();
            }, 1000);
        };

        updatePendingClock();
    }

    // #region -> Deck Info

    private setCustomHotKeyState(state: boolean) {
        if (state) {
            if (!this.view.hasClass("sr-custom-hotkeys")) {
                this.view.addClass("sr-custom-hotkeys");
            }
        } else {
            if (this.view.hasClass("sr-custom-hotkeys")) {
                this.view.removeClass("sr-custom-hotkeys");
            }
        }
    }

    private _updateInfoBar(sessionData: SessionData, flashcardCardOrder: string) {
        if (sessionData.deckData.chosenDeck === null || sessionData.deckData.currentDeck === null)
            return;

        this.toolbar.updateInfo(
            sessionData.deckData.chosenDeck,
            sessionData.deckData.currentDeck,
            sessionData.deckData.chosenDeckStats,
            sessionData.deckData.currentDeckStats,
            sessionData.totalCardsInSession,
            sessionData.totalDecksInSession,
            sessionData.deckData.currentDeckTotalCardsInQueue,
            flashcardCardOrder,
        );
    }

    private _setupClozeInputListeners(): void {
        this.clozeInputs = activeDocument.querySelectorAll(".cloze-input");

        this.clozeInputs.forEach((input) => {
            input.addEventListener("keydown", (e: KeyboardEvent) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    (input as HTMLElement).blur();
                    this.showAnswerHandler();
                }
            });
        });
    }
    private _evaluateClozeAnswers(): void {
        this.clozeAnswers = activeDocument.querySelectorAll(".cloze-answer");

        if (this.clozeInputs !== null && this.clozeAnswers.length === this.clozeInputs.length) {
            for (let i = 0; i < this.clozeAnswers.length; i++) {
                const clozeInput = this.clozeInputs[i];
                const clozeAnswer = this.clozeAnswers[i] as HTMLElement;

                const inputText = clozeInput.value.trim();
                const answerText = clozeAnswer.innerText.trim();

                clozeAnswer.empty();

                const answerElement = clozeAnswer.createSpan({
                    text: escapeHtml(inputText),
                    cls: "cloze-answer",
                });

                answerElement.setCssProps({
                    color: inputText === answerText ? "green" : "red",
                    "text-Decoration": inputText === answerText ? "none" : "line-through",
                });

                if (inputText !== answerText) {
                    const span = clozeAnswer.createSpan({
                        text: escapeHtml(answerText),
                        cls: "cloze-answer-wrong",
                    });
                    span.setCssProps({
                        color: "green",
                        "text-decoration": "none",
                    });
                }
            }
        }
    }

    public async drawBack(
        sessionData: SessionData,
        reviewMode: FlashcardReviewMode,
        settings: SRSettings,
        determineButtonSchedule: (response: ReviewResponse) => RepItemScheduleInfo | null,
    ) {
        this.setCustomHotKeyState(settings.useCustomHotkeys);
        this.cardState = sessionData.cardData.currentCardState;

        this.toolbar.setResetButtonDisabled(false);

        // Show answer text
        if (sessionData.currentQuestion.questionType !== CardType.Cloze) {
            await this.drawCardFrontContent(sessionData, settings, false);

            // 答题结果（如果刚才答过题）
            if (this.quizResult !== null) {
                const result = this.quizResult;
                this.quizResult = null;

                const banner = this.content.createDiv({
                    cls: `sr-quiz-result ${
                        result.correct ? "sr-quiz-result-correct" : "sr-quiz-result-wrong"
                    }`,
                });
                banner.setText(
                    result.correct
                        ? t("QUIZ_CORRECT")
                        : t("QUIZ_WRONG", { answer: result.answer }),
                );
            }

            const hr: HTMLElement = activeDocument.createElement("hr");
            this.content.appendChild(hr);
        } else {
            this.content.empty();
            this.drawCardContext(sessionData, settings);
        }

        const wrapper: RenderMarkdownWrapper = new RenderMarkdownWrapper(
            this.app,
            this.plugin,
            sessionData.currentNote.filePath,
        );
        await wrapper.renderMarkdownWrapper(
            sessionData.cardData.currentCard.back,
            this.content,
            sessionData.currentQuestion.questionText.textDirection,
            // sessionData.cardData.currentCardState,
        );

        // Evaluate cloze answers
        this._evaluateClozeAnswers();

        // Show response buttons
        this.response.showRatingButtons(
            reviewMode,
            settings.flashcardAgainText,
            settings.flashcardHardText,
            settings.flashcardGoodText,
            settings.flashcardEasyText,
            settings.showIntervalInReviewButtons,
            determineButtonSchedule,
        );
        // NEW: restore keyboard focus after cloze confirmation
        if (this.plugin.uiManager === null) throw new Error("UI manager not initialized!!!");
        this.plugin.uiManager.setSRViewInFocus(true);
        this.response.againButton.buttonEl.focus();
    }

    private _keydownHandler = (e: KeyboardEvent) => {
        if (!this.plugin.isInitialized) throw new Error("SR plugin or data not initialized!!!");
        if (this.plugin.uiManager === null) throw new Error("UI manager not initialized!!!");
        // Prevents any input, if the edit modal is open or if the view is not in focus
        if (
            this.plugin.dataManager.data.settings.useCustomHotkeys ||
            (activeDocument.activeElement !== null &&
                (activeDocument.activeElement.nodeName === "TEXTAREA" ||
                    activeDocument.activeElement.nodeName === "INPUT")) ||
            this.cardState === CardState.Closed ||
            !this.plugin.uiManager.getSRInFocusState() ||
            Platform.isMobile || // No keyboard events on mobile
            EmulatedPlatform().isMobile
        ) {
            return;
        }

        const consumeKeyEvent = () => {
            e.preventDefault();
            e.stopPropagation();
        };

        switch (e.code) {
            case "KeyS":
                this.skipCardHandler();
                consumeKeyEvent();
                break;
            case "KeyJ":
                void this.jumpToCardHandler();
                consumeKeyEvent();
                break;
            case "Enter":
            case "NumpadEnter":
            case "Space":
                if (this.cardState === CardState.Front) {
                    this.showAnswerHandler();
                    consumeKeyEvent();
                } else if (this.cardState === CardState.Back) {
                    void this.processReviewHandler(ReviewResponse.Good);
                    consumeKeyEvent();
                }
                break;
            case "Numpad1":
            case "Digit1":
                if (this.cardState !== CardState.Back) {
                    break;
                }
                void this.processReviewHandler(ReviewResponse.Hard);
                consumeKeyEvent();
                break;
            case "Numpad2":
            case "Digit2":
                if (this.cardState !== CardState.Back) {
                    break;
                }
                void this.processReviewHandler(ReviewResponse.Good);
                consumeKeyEvent();
                break;
            case "Numpad3":
            case "Digit3":
                if (this.cardState !== CardState.Back) {
                    break;
                }
                void this.processReviewHandler(ReviewResponse.Easy);
                consumeKeyEvent();
                break;
            case "Numpad0":
            case "Digit0":
                if (this.cardState !== CardState.Back) {
                    break;
                }
                void this.processReviewHandler(ReviewResponse.Again);
                consumeKeyEvent();
                break;
            default:
                break;
        }
    };
}
