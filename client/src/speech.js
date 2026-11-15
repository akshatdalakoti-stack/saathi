// Voice. Saathi talks and listens in the elder's own language.
// 1. If the phone has a voice for the language, use it (instant, works offline).
// 2. If not (common on laptops for Tamil, Telugu, Odia...), ask the server for Gemini's voice.
import { languageOf } from '../../shared/languages.js';

let voices = [];
function refreshVoices() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) voices = window.speechSynthesis.getVoices();
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}

function phoneVoiceFor(code) {
  const speechCode = languageOf(code).speech.toLowerCase();
  const base = speechCode.split('-')[0];
  return voices.find((v) => v.lang.toLowerCase().replace('_', '-') === speechCode)
    || voices.find((v) => v.lang.toLowerCase().startsWith(`${base}-`) || v.lang.toLowerCase() === base);
}

let currentAudio = null;
const audioCache = new Map(); // "ta|text" -> object URL of the spoken audio

function fetchAudio(text, code) {
  const key = `${code}|${text}`;
  // We keep the promise itself, so a second request for the same words waits for the first.
  if (!audioCache.has(key)) {
    const request = fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, lang: code }),
      credentials: 'same-origin',
    }).then(async (res) => {
      if (!res.ok) throw new Error('voice failed');
      return URL.createObjectURL(await res.blob());
    });
    request.catch(() => audioCache.delete(key));
    audioCache.set(key, request);
  }
  return audioCache.get(key);
}

// Gets the voice ready in the background, so pressing "Listen" plays at once.
export function prefetchSpeech(text, code) {
  if (!text || phoneVoiceFor(code)) return;
  fetchAudio(text, code).catch(() => {});
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
}

// Returns a promise that settles when speaking has started (or failed).
export async function speak(text, code = 'en', onLoading) {
  if (!text) return;
  stopSpeaking();
  const voice = phoneVoiceFor(code);
  if (voice) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = 0.88; // a little slower is easier to follow
    window.speechSynthesis.speak(utterance);
    return;
  }
  if (onLoading) onLoading(true);
  try {
    const url = await fetchAudio(text, code);
    currentAudio = new Audio(url);
    await currentAudio.play();
  } catch {
    // Last resort: read it with whatever voice the phone has.
    if ('speechSynthesis' in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  } finally {
    if (onLoading) onLoading(false);
  }
}

export function canListen() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Starts listening. Calls onText(text, isFinal) as words arrive and onEnd() when done.
export function listen(code, onText, onEnd) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new Recognition();
  rec.lang = languageOf(code).speech;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.onresult = (event) => {
    let text = '';
    for (const result of event.results) text += result[0].transcript;
    onText(text, event.results[event.results.length - 1].isFinal);
  };
  rec.onerror = () => onEnd();
  rec.onend = () => onEnd();
  rec.start();
  return () => rec.stop();
}

// Quick understanding of English, Hinglish and Hindi. Other languages are sent to the server (Gemini).
export function quickIntent(text) {
  const t = text.toLowerCase();
  if (/(help|madad|bachao|मदद|बचाओ|emergency)/.test(t)) return 'help';
  if (/(did i|have i|kya maine|kya main|क्या मैंने|क्या मैने|maine li thi)/.test(t)) return 'check';
  if (/(took|taken|have taken|i ate|done|le li|le liya|kha li|kha liya|ले ली|ले लिया|खा ली|खा लिया|ले लीं)/.test(t)) return 'taken';
  if (/(remind|later|baad mein|बाद में|thodi der)/.test(t)) return 'snooze';
  if (/(read|my day|today|aaj|आज|sunao|सुनाओ)/.test(t)) return 'read';
  if (/(i'?m okay|i am okay|i'?m fine|theek hoon|ठीक हूँ|ठीक हूं)/.test(t)) return 'okay';
  return 'other';
}
