import { useCallback, useEffect, useRef, useState } from 'react';

/* Minimal typings for the browser's speech recognition (Chrome, Edge, Safari 14.5+). */
interface SpeechResult { isFinal: boolean; 0: { transcript: string } }
interface SpeechEvent { resultIndex: number; results: ArrayLike<SpeechResult> }
interface Recognizer {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: SpeechEvent) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start(): void; stop(): void;
}
type RecognizerCtor = new () => Recognizer;
const Ctor = (): RecognizerCtor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** A plain explanation of why voice typing stopped, telling apart the causes of "not allowed". */
async function explain(code: string): Promise<string> {
  if (code === 'no-speech') return "We didn't hear anything. Tap the microphone and speak again.";
  if (code === 'audio-capture') return 'No microphone was found. Check that one is connected and not in use by another app.';
  if (code === 'network') return 'Voice typing needs an internet connection. Check your signal and try again.';
  if (code === 'aborted') return 'Voice typing stopped. Tap the microphone to try again.';
  if (code === 'service-not-allowed' || code === 'language-not-supported') {
    return "This browser doesn't offer voice typing here. Please use Google Chrome or Microsoft Edge, or use your keyboard's microphone key.";
  }
  if (code === 'not-allowed') {
    let state: string | undefined;
    try { state = (await navigator.permissions?.query({ name: 'microphone' as PermissionName }))?.state; } catch { /* not supported */ }
    if (state === 'granted') {
      // The person allowed it, so an old copy of the site (before the microphone was permitted) is still loaded.
      return 'The microphone is allowed, but this page is out of date. Close the app completely and open it again (or reload the page), then try once more.';
    }
    return 'Microphone access is turned off for this site. Tap the lock icon next to the web address, allow Microphone, then reload the page.';
  }
  return 'Voice typing stopped. Tap the microphone to try again.';
}

/**
 * Voice typing: speak and the words are added to the text as you go.
 * Uses the phone's or browser's own speech service (Nigerian English first).
 */
export function useDictation(onFinalText: (text: string) => void) {
  const supported = !!Ctor();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognizer | null>(null);
  const cb = useRef(onFinalText);
  cb.current = onFinalText;

  const retryLang = useRef<string | null>(null);

  const stop = useCallback(() => { rec.current?.stop(); }, []);
  const startWith = useCallback((lang: string) => {
    const C = Ctor();
    if (!C) return;
    setError(null);
    const r = new C();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) cb.current(res[0].transcript.trim());
        else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onerror = (e) => {
      // Some phones don't offer Nigerian English: quietly try British English once.
      if (e.error === 'language-not-supported' && lang === 'en-NG') { retryLang.current = 'en-GB'; return; }
      void explain(e.error).then(setError);
    };
    r.onend = () => {
      setListening(false); setInterim(''); rec.current = null;
      if (retryLang.current) { const l = retryLang.current; retryLang.current = null; startWith(l); }
    };
    rec.current = r;
    try { r.start(); setListening(true); } catch { setError('Voice typing is busy. Wait a moment and tap the microphone again.'); }
  }, []);
  const start = useCallback(() => startWith('en-NG'), [startWith]);

  useEffect(() => () => rec.current?.stop(), []);
  return { supported, listening, interim, error, start, stop };
}
