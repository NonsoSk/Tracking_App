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

  const stop = useCallback(() => { rec.current?.stop(); }, []);
  const start = useCallback(() => {
    const C = Ctor();
    if (!C) return;
    setError(null);
    const r = new C();
    r.lang = 'en-NG';
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
    r.onerror = (e) => setError(e.error === 'not-allowed' || e.error === 'service-not-allowed'
      ? 'Microphone access was blocked. Allow the microphone for this site in your browser settings.'
      : e.error === 'no-speech' ? "We didn't hear anything. Tap the microphone and speak again." : 'Voice typing stopped. Tap the microphone to try again.');
    r.onend = () => { setListening(false); setInterim(''); rec.current = null; };
    rec.current = r;
    r.start();
    setListening(true);
  }, []);

  useEffect(() => () => rec.current?.stop(), []);
  return { supported, listening, interim, error, start, stop };
}
