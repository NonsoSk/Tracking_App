import { describe, expect, it } from 'vitest';
import { tidyText } from './tidy';

describe('tidyText (offline clean-up of dictation)', () => {
  it('removes fillers and stutters, fixes capitals and the full stop', () => {
    expect(tidyText('uhm we we replaced the the transformer at ogale  yesterday um and i checked it'))
      .toBe('We replaced the transformer at ogale yesterday and I checked it.');
  });
  it('fixes spacing around punctuation and starts sentences with capitals', () => {
    expect(tidyText('the road was graded ,drains cleared.work finished on monday'))
      .toBe('The road was graded, drains cleared. Work finished on monday.');
  });
  it('keeps numbers and amounts untouched', () => {
    expect(tidyText('paid N250,000 to 12 farmers')).toBe('Paid N250,000 to 12 farmers.');
  });
});
