/**
 * Quiet, personal lines for community members.
 *
 * Their job is to lower stress and make people feel heard, never to talk anyone
 * out of raising a concern or to make it seem smaller: every line either
 * reassures, thanks, or invites the person to say what matters in their own
 * words. The same person sees the same line all day (it changes daily), so the
 * screen feels steady rather than busy.
 */

export type CalmPlace = 'home' | 'concern' | 'review' | 'done' | 'saved' | 'waiting' | 'resolved' | 'closed' | 'alerts';

export interface CalmContext {
  userId: string | null | undefined;
  firstName: string;
  community?: string | null;
  /** number of grievances the person has already sent */
  sent?: number;
  /** how many of those were resolved or closed */
  settled?: number;
  now?: Date;
}

function lagosHour(d: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lagos' }).format(d));
}
function lagosDay(d: Date): number {
  const wd = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Africa/Lagos' }).format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
}
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Same line all day for the same person and place; a different one tomorrow. */
export function calmLine(place: CalmPlace, c: CalmContext): string {
  const now = c.now ?? new Date();
  const name = c.firstName || 'friend';
  const where = c.community || 'your community';
  const hour = lagosHour(now);
  const day = lagosDay(now);
  const pool: string[] = [];

  switch (place) {
    case 'home': {
      // Note: home lines avoid the words used for the collection status on the same screen.
      pool.push(
        `Take your time, ${name}. There is no rush here.`,
        `Whatever is on your mind, ${name}, you can say it here calmly, in your own words.`,
        `Every message here is read by a real person in Community Relations, ${name}.`,
        `What happens in ${where} matters to us too. Thank you for staying in touch.`,
        `“However long the night, the dawn will break.”`,
        `“When spider webs unite, they can tie up a lion.” Working together makes things better.`,
        `“A single bracelet does not jingle.” Thank you for being part of the conversation, ${name}.`,
        `Clear, simple words help us understand and act faster. We are listening, ${name}.`,
      );
      if (hour < 12) pool.push(`A fresh morning, ${name}. We are here whenever you need us.`);
      else if (hour < 17) pool.push(`Good to have you here this afternoon, ${name}.`);
      else pool.push(`It has been a long day, ${name}. Rest easy; your messages are safe with us.`);
      if (day === 5) pool.push(`Nearly the weekend, ${name}. We hope it is a peaceful one in ${where}.`);
      if (day === 1) pool.push(`A new week, ${name}. Thank you for helping us keep ${where} in view.`);
      if (!c.sent) pool.push(`Welcome, ${name}. This is a safe place to share what matters to you.`);
      if ((c.settled ?? 0) > 0) pool.push(`Thank you for your patience with us before, ${name}. It helps us get things right.`);
      break;
    }
    case 'concern':
      pool.push(
        'Take a slow breath and tell it the way you would tell a neighbour. What happened, and where?',
        'There is no wrong way to say it. Plain words are best, and details help us act.',
        `Say it in your own words, ${name}. We read every one carefully.`,
        'If it helps, start with where it happened and when you first noticed it.',
      );
      break;
    case 'review':
      pool.push(
        `You have put this into words well, ${name}. Have one last look, then send.`,
        `Thank you for taking the time, ${name}. This helps us understand.`,
      );
      break;
    case 'done':
      pool.push(
        `Thank you, ${name}. You have done your part; it is safely with the team now.`,
        `Well done, ${name}. Someone will look at this, and you will hear from us.`,
      );
      break;
    case 'saved':
      pool.push(
        `It is safe on your phone, ${name}. It will go by itself when you are back online.`,
        'Nothing is lost. It will send on its own as soon as there is signal.',
      );
      break;
    case 'waiting':
      pool.push(
        `We have not forgotten this, ${name}. Someone is working on it, and you will hear from us.`,
        'Good things sometimes take a little time. We will update you as soon as there is news.',
        `Thank you for your patience, ${name}. It is in good hands.`,
      );
      break;
    case 'resolved':
      pool.push(
        `Your honest answer helps us, ${name}, whichever one you choose.`,
        'Tell us how it really feels. If something is still not right, we want to know.',
      );
      break;
    case 'closed':
      pool.push(
        `Thank you for working through this with us, ${name}.`,
        'We are glad this one reached its end. We are always here if anything else comes up.',
      );
      break;
    case 'alerts':
      pool.push(
        'All quiet for now. We will let you know as soon as there is news.',
        `No news is not forgotten, ${name}. We will tell you when anything changes.`,
      );
      break;
  }
  const key = `${c.userId ?? 'guest'}|${place}|${Math.floor((now.getTime() + 3600_000) / 86_400_000)}`;
  return pool[hash(key) % pool.length];
}
