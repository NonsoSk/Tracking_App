/*
 * Life.py art: Pip's face, simple line icons and initial avatars.
 * Everything is inline SVG so the game works offline and loads instantly.
 */
(function (root) {
  'use strict';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Pip: a rounded screen with a face. States: idle, sleep, happy, oops, confused.
  function pip(state, label) {
    return `<svg class="pip" data-state="${state || 'idle'}" viewBox="0 0 48 48" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'}>` +
      '<rect class="pip-body" x="3" y="5" width="42" height="38" rx="13"/>' +
      '<rect class="pip-screen" x="9" y="11" width="30" height="26" rx="9"/>' +
      '<g class="pip-eyes eyes-open"><rect x="15" y="18" width="5" height="7.5" rx="2.5"/><rect x="28" y="18" width="5" height="7.5" rx="2.5"/></g>' +
      '<g class="pip-eyes eyes-happy"><path d="M14.5 23.5 q3 -4.5 6 0 M27.5 23.5 q3 -4.5 6 0"/></g>' +
      '<g class="pip-eyes eyes-closed"><path d="M14.5 21.5 q3 3 6 0 M27.5 21.5 q3 3 6 0"/></g>' +
      '<g class="pip-mouth mouth-smile"><path d="M20 29.5 q4 3.2 8 0"/></g>' +
      '<g class="pip-mouth mouth-open"><ellipse cx="24" cy="30.5" rx="2.6" ry="3"/></g>' +
      '<g class="pip-mouth mouth-flat"><path d="M20.5 31 h7"/></g>' +
      '<g class="pip-brow"><path d="M27 15.5 l6.5 -1.8"/></g>' +
      '</svg>';
  }

  // Line icons, 24x24, drawn with the current text colour.
  const ICONS = {
    gift: '<rect x="3.5" y="9" width="17" height="11.5" rx="2"/><path d="M2.5 9h19M12 9v11.5"/><path d="M12 9c-1.5-3.5-5.5-4.5-5.5-2s3 2 5.5 2c2.5 0 5.5.5 5.5-2s-4-1.5-5.5 2z"/>',
    chat: '<path d="M4 5h16a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 17h-9l-5 4v-4H4a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 5z"/><path d="M7.5 10h9M7.5 13h5.5"/>',
    blocks: '<rect x="3" y="13" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13" width="7.5" height="7.5" rx="1.5"/><rect x="8.25" y="3.5" width="7.5" height="7.5" rx="1.5"/>',
    bug: '<rect x="7.5" y="7.5" width="9" height="13" rx="4.5"/><path d="M12 11v9.5M7.5 12H3.5M20.5 12h-4M7.5 16.5H4M20 16.5h-3.5M9.5 7.5L8 4.5M14.5 7.5L16 4.5"/>',
    door: '<path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21M3.5 21h17"/><circle cx="14.5" cy="12.5" r="1"/>',
    cake: '<path d="M4 20.5v-7A1.5 1.5 0 0 1 5.5 12h13a1.5 1.5 0 0 1 1.5 1.5v7M2.5 20.5h19"/><path d="M4 16c2 1.5 4 1.5 5.3 0 1.4 1.5 4 1.5 5.4 0 1.3 1.5 3.3 1.5 5.3 0M8 12V9M12 12V9M16 12V9"/><path d="M8 6.5v.01M12 6.5v.01M16 6.5v.01"/>',
    jar: '<path d="M8 3.5h8M8.5 3.5v2.5l-2.2 2.6A3 3 0 0 0 5.5 10.5V19a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-8.5a3 3 0 0 0-.8-1.9L15.5 6V3.5"/><path d="M5.5 13h13"/>',
    plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    people: '<circle cx="8" cy="8.5" r="3"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M2.5 20a5.5 5.5 0 0 1 11 0M13.5 20a4.5 4.5 0 0 1 8 -2.5"/>',
    tree: '<path d="M12 21v-6M12 15c-4.5 0-7-2.6-7-6a7 7 0 0 1 14 0c0 3.4-2.5 6-7 6z"/><path d="M9 21h6"/>',
    loop: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5"/>',
    city: '<path d="M3 21h18M5 21V9l5-3v15M10 21V4h9v17M13 8h3M13 11.5h3M13 15h3"/>',
    pot: '<path d="M4 10h16v7a3.5 3.5 0 0 1-3.5 3.5h-9A3.5 3.5 0 0 1 4 17zM2.5 10h19"/><path d="M9 6.5c0-1.5 1.5-1.5 1.5-3M14 6.5c0-1.5 1.5-1.5 1.5-3"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    book: '<path d="M5 4.5h10.5a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2zM5 18a2 2 0 0 1 2-2h10.5"/><path d="M8.5 8.5h5.5"/>',
    sound: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
    flame: '<path d="M12.5 3c.6 3.4 5 5.3 5 10.1a5.5 5.5 0 0 1-11 0c0-2.3 1.2-3.8 2.5-4.8-.1 1.7.6 3 1.7 3.5-.3-3.9 1.2-6.9 1.8-8.8z"/>',
  };

  function icon(name, cls) {
    return `<svg class="icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.chat}</svg>`;
  }

  // People in the story appear as their initial in a soft colour.
  const TONES = { mum: 'tone-1', grandma: 'tone-2', uncle: 'tone-3', friend: 'tone-4', cousin: 'tone-5' };

  function avatar(who, name) {
    if (who === 'pip') return `<span class="av av-pip">${pip('idle')}</span>`;
    const letter = String(name || '?').replace(/^(Uncle|Tío|Tio|Aunty)\s+/i, '').charAt(0).toUpperCase();
    return `<span class="av ${TONES[who] || 'tone-4'}" aria-hidden="true">${esc(letter)}</span>`;
  }

  root.LifePyArt = { pip, icon, avatar, esc };
})(typeof window !== 'undefined' ? window : globalThis);
