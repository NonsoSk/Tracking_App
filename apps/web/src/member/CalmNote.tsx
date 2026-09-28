import { useAuth } from '@/app/auth';
import { firstName } from '@/lib/format';
import { cx } from '@/design/ui';
import { calmLine, type CalmPlace } from './calm';

/** A quiet personal line: small, soft, easy to pass over, but there when needed. */
export function CalmNote({ place, sent, settled, className }: { place: CalmPlace; sent?: number; settled?: number; className?: string }) {
  const { profile, userId } = useAuth();
  const text = calmLine(place, { userId, firstName: firstName(profile?.full_name), community: profile?.community_name, sent, settled });
  return (
    <p className={cx('border-l-2 border-brand-200 pl-3 text-[14.5px] italic leading-relaxed text-ink-500 animate-fade-up', className)}>{text}</p>
  );
}
