/**
 * 用浏览器内置语音合成朗读英文。
 * Obsidian 桌面端基于 Chromium，自带 Web Speech API，无需网络与配置。
 */
export function pronounce(text: string, lang = "en-US"): boolean {
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return false;

    const content = text.trim();
    if (content.length === 0) return false;

    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = lang;

    const voice = synth.getVoices().find((item) => item.lang.startsWith(lang.slice(0, 2)));
    if (voice) utterance.voice = voice;

    synth.speak(utterance);
    return true;
}
