import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toAppError } from '@/lib/errors';
import { useToast } from '@/design/ui';

/** Run a change, show a toast (with Undo when given), refresh the listed queries. */
export function useSave() {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const save = async (fn: () => PromiseLike<{ error: unknown } | unknown>, ok: string, keys: string[][] = [['master']], undo?: () => PromiseLike<unknown>) => {
    setBusy(true);
    try {
      const r = (await fn()) as { error?: unknown } | undefined;
      if (r && typeof r === 'object' && 'error' in r && r.error) throw r.error;
      toast(ok, 'success', undo && { label: 'Undo', run: () => { void save(undo, 'Undone', keys); } });
      await Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
      return true;
    } catch (e) { toast(toAppError(e).message, 'warning'); return false; }
    finally { setBusy(false); }
  };
  return { busy, save };
}
