import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/design/ui';

/** New app version available: ask before reloading (never lose a half-written grievance). */
export function UpdatePrompt() {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({ immediate: true });
  if (!needRefresh) return null;
  return (
    <div className="fixed inset-x-3 bottom-24 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-[#1A1F36] p-3 pl-4 text-white shadow-raised sm:bottom-6">
      <RefreshCw className="h-5 w-5 text-sky" aria-hidden />
      <p className="flex-1 text-sm font-medium">A new version of the app is ready.</p>
      <Button size="sm" variant="accent" onClick={() => updateServiceWorker(true)}>Update</Button>
      <button className="px-2 text-sm text-white/70" onClick={() => setNeedRefresh(false)}>Later</button>
    </div>
  );
}
