/**
 * Speaks English text using the browser's built-in speech synthesis.
 * Obsidian bundles Chromium, which provides the Web Speech API on desktop and
 * delegates to the system voices on mobile.
 */
export function pronounce(text: string, lang: string = "en-US"): boolean {
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
