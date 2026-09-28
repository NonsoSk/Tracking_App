import { useState } from 'react';
import { Check, Mic, Sparkles, Square, Undo2 } from 'lucide-react';
import { api } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { tidyText } from '@/lib/tidy';
import { useDictation } from '@/lib/dictation';
import { Button, Textarea, cx } from '@/design/ui';

/**
 * A text box an officer can speak into, with "Correct wording": the AI helper
 * rewrites the note in clear English, keeping the meaning. The officer sees the
 * suggestion and chooses "Use this" or "Keep mine"; nothing is replaced silently.
 */
export function VoiceText({ id, value, onChange, minHeight = 'min-h-[140px]', placeholder }: {
  id: string; value: string; onChange: (v: string) => void; minHeight?: string; placeholder?: string;
}) {
  const dict = useDictation((t) => onChange(joinText(value, t)));
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<{ text: string; note: string | null } | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);

  const correct = async () => {
    if (dict.listening) dict.stop();
    setBusy(true);
    try {
      setSuggestion({ text: await api.polishResolution(value), note: null });
    } catch (e) {
      const note = e instanceof AppError ? e.message : 'A basic clean-up was done instead.';
      setSuggestion({ text: tidyText(value), note });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Textarea id={id} className={cx(minHeight, dict.listening && 'ring-2 ring-danger/60')} value={dict.listening && dict.interim ? joinText(value, dict.interim) : value}
          onChange={(e) => onChange(e.target.value)} placeholder={placeholder} readOnly={dict.listening} />
        {dict.listening && (
          <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-danger px-2.5 py-1 text-xs font-bold text-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" aria-hidden />Listening…
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {dict.supported && (dict.listening
          ? <Button type="button" size="sm" variant="danger" icon={Square} onClick={dict.stop}>Stop</Button>
          : <Button type="button" size="sm" variant="secondary" icon={Mic} onClick={dict.start}>Speak</Button>)}
        <Button type="button" size="sm" variant="secondary" icon={Sparkles} loading={busy} disabled={value.trim().length < 3} onClick={correct}>Correct wording</Button>
        {previous !== null && <Button type="button" size="sm" variant="ghost" icon={Undo2} onClick={() => { onChange(previous); setPrevious(null); }}>Undo</Button>}
      </div>
      {!dict.supported && <p className="text-xs text-ink-500">Voice typing works in Chrome or Edge. On a phone you can also tap the microphone on your keyboard.</p>}
      {dict.error && <p className="text-xs font-semibold text-danger">{dict.error}</p>}
      {suggestion && (
        <div className="space-y-2 rounded-2xl bg-brand-50 p-3 ring-1 ring-inset ring-brand-200 animate-fade-up" role="region" aria-label="Suggested wording">
          <p className="eyebrow text-brand-700">Suggested wording</p>
          <p className="whitespace-pre-wrap text-[15px] text-ink-900">{suggestion.text}</p>
          {suggestion.note && <p className="text-xs text-ink-500">{suggestion.note}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" icon={Check} onClick={() => { setPrevious(value); onChange(suggestion.text); setSuggestion(null); }}>Use this</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSuggestion(null)}>Keep mine</Button>
          </div>
        </div>
      )}
    </div>
  );
}

const joinText = (a: string, b: string) => (a.trim() ? `${a.trimEnd()} ${b.trim()}` : b.trim());
