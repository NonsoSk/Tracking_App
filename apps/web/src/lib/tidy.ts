/**
 * Basic, offline clean-up of dictated text (used when the AI helper is not set up
 * or not reachable): removes filler words and stutters, fixes spacing and
 * capital letters, and ends sentences properly. It never changes the words' meaning.
 */
export function tidyText(input: string): string {
  let t = ` ${input.replace(/\s+/g, ' ').trim()} `;
  t = t.replace(/\s(?:uh+m*|um+|erm+|hmm+|eh+|ehm+)[,.]?(?=\s)/gi, ' ');               // fillers
  t = t.replace(/\b(\w+)(\s+\1\b)+/gi, '$1');                                          // "the the" → "the"
  t = t.replace(/\s+([,.;:!?])/g, '$1').replace(/([,.;:!?])(?=[^\s\d"')\]])/g, '$1 ');  // spacing around punctuation
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/\bi\b/g, 'I').replace(/\bi'(m|ve|ll|d)\b/gi, (_, s: string) => `I'${s.toLowerCase()}`);
  t = t.replace(/(^|[.!?]\s+)([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());  // sentence capitals
  if (t && !/[.!?]$/.test(t)) t += '.';
  return t;
}
