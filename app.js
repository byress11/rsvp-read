(function(){
'use strict';

/* ─────────────────────────────────────────────
   CONFIG & CONSTANTS
   ───────────────────────────────────────────── */
const PUNCTUATION_RE = /[.!?;:,…—–\-\u0964\u0965]/;
const SENTENCE_END_RE = /[.!?…]$/;
const LS_SETTINGS  = 'rsvp_settings';
const LS_STATS     = 'rsvp_stats';
const LS_AUDIO     = 'rsvp_audio';

/* ─────────────────────────────────────────────
   STATE
   ───────────────────────────────────────────── */
const state = {
  words: [],
  headingIndices: new Set(),
  currentIndex: 0,
  playing: false,
  timer: null,
  fileHash: '',
  fileName: '',
  pdfPages: [],
  selectedPageIndex: 0,

  settings: {
    theme: 'dark',
    bgColor: '#0D0D0D',
    fontFamily: 'serif',
    fontSize: 32,
    wpm: 300,
    chunkSize: 1,
    pauseMultiplier: 50,
  },

  stats: {
    todayDate: '',
    todayWords: 0,
  },

  audio: {
    currentSound: null,
    volume: 70,
    muted: false,
  },
};

/* ─────────────────────────────────────────────
   DOM REFS
   ───────────────────────────────────────────── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const homeScreen     = $('#home-screen');
const readScreen     = $('#read-screen');
const settingsOvl    = $('#settings-overlay');
const dropZone       = $('#drop-zone');
const fileInput      = $('#file-input');
const textInput      = $('#text-input');
const rsvpWord       = $('#rsvp-word');
const progressFill   = $('#progress-fill');
const progressBar    = $('#progress-bar');
const progressWords  = $('#progress-words');
const progressPct    = $('#progress-pct');
const statWpm        = $('#stat-wpm');
const statRemaining  = $('#stat-remaining');
const statToday      = $('#stat-today');
const speedSlider    = $('#speed-slider');
const speedVal       = $('#speed-val');
const fontsizeSlider = $('#fontsize-slider');
const fontsizeVal    = $('#fontsize-val');
const pauseSlider    = $('#pause-slider');
const pauseVal       = $('#pause-val');
const musicDrawer    = $('#music-drawer');
const musicVolume    = $('#music-volume');
const volumeValEl    = $('#volume-val');
const bgCustom       = $('#bg-custom');
const bgmStreamEl    = $('#bgm-stream');

/* Klasik müzik: Wikimedia Commons public domain (doğrulanmış URL'ler, internet gerektirir) */
const STREAM_URLS = {
  bach:      'https://upload.wikimedia.org/wikipedia/commons/4/43/JOHN_MICHEL_CELLO-J_S_BACH_CELLO_SUITE_1_in_G_Prelude.ogg',
  beethoven: 'https://upload.wikimedia.org/wikipedia/commons/4/47/Beethoven_Moonlight_2nd_movement.ogg',
  chopin:    'https://upload.wikimedia.org/wikipedia/commons/a/a7/Chopin%2C_Nocturne_op_32_no_1.ogg',
  mozart:    'https://upload.wikimedia.org/wikipedia/commons/2/24/Mozart_-_Eine_kleine_Nachtmusik_-_1._Allegro.ogg',
  debussy:   'https://upload.wikimedia.org/wikipedia/commons/b/be/Clair_de_lune_%28Claude_Debussy%29_Suite_bergamasque.ogg',
  vivaldi:   'https://upload.wikimedia.org/wikipedia/commons/f/ff/Vivaldi_-_Four_Seasons_1_Spring_mvt_1_Allegro_-_John_Harrison_violin.oga',
};

const PROC_AUDIO_GAIN = 0.88;

function isStreamSound(name) {
  return name && Object.prototype.hasOwnProperty.call(STREAM_URLS, name);
}

function streamVolume() {
  if (state.audio.muted) return 0;
  return Math.min(1, state.audio.volume / 100);
}

function playBgmRobust() {
  if (!bgmStreamEl) return;
  bgmStreamEl.volume = streamVolume();
  const p = bgmStreamEl.play();
  if (!p || typeof p.then !== 'function') return;
  p.catch(() => {
    try {
      bgmStreamEl.muted = true;
      const p2 = bgmStreamEl.play();
      if (p2 && typeof p2.then === 'function') {
        p2.then(() => {
          bgmStreamEl.muted = false;
          bgmStreamEl.volume = streamVolume();
        }).catch(() => {
          bgmStreamEl.muted = false;
          showToast('Ses açılamadı: telefon sessiz anahtarı / tarayıcı sesine bakın');
        });
      }
    } catch(e) {
      bgmStreamEl.muted = false;
      showToast('Ses çalınamadı — sayfayı yenileyip tekrar deneyin');
    }
  });
}

function unlockWebAudioFromGesture() {
  try {
    initAudio();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  } catch(e) {}
}

function closeInlineMusicDrawer() {
  const d = $('#music-drawer-inline');
  const b = $('#music-drawer-backdrop');
  if (d) d.classList.remove('open');
  if (b) b.classList.remove('open');
}

/* ─────────────────────────────────────────────
   UTILITY FUNCTIONS
   ───────────────────────────────────────────── */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < Math.min(str.length, 5000); i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return 'h' + Math.abs(hash).toString(36);
}

function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function formatTime(minutes) {
  if (minutes < 1) return '<1 dk';
  if (minutes < 60) return Math.ceil(minutes) + ' dk';
  const h = Math.floor(minutes / 60);
  const m = Math.ceil(minutes % 60);
  return h + ' sa ' + m + ' dk';
}

/* ─────────────────────────────────────────────
   LOCAL STORAGE — SETTINGS
   ───────────────────────────────────────────── */
function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (raw) Object.assign(state.settings, JSON.parse(raw));
  } catch(e) {}
}

function saveSettings() {
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings)); } catch(e) {}
}

function loadStats() {
  try {
    const raw = localStorage.getItem(LS_STATS);
    if (raw) Object.assign(state.stats, JSON.parse(raw));
    const today = new Date().toDateString();
    if (state.stats.todayDate !== today) {
      state.stats.todayDate = today;
      state.stats.todayWords = 0;
    }
  } catch(e) {}
}

function saveStats() {
  try { localStorage.setItem(LS_STATS, JSON.stringify(state.stats)); } catch(e) {}
}

function loadAudioPref() {
  try {
    const raw = localStorage.getItem(LS_AUDIO);
    if (raw) Object.assign(state.audio, JSON.parse(raw));
  } catch(e) {}
}

function saveAudioPref() {
  try {
    localStorage.setItem(LS_AUDIO, JSON.stringify({
      currentSound: state.audio.currentSound,
      volume: state.audio.volume,
      muted: state.audio.muted,
    }));
  } catch(e) {}
}

/* ─────────────────────────────────────────────
   PDF PAGE VIEWER — AUTO-CLEANUP ENGINE
   ───────────────────────────────────────────── */
let editorUndoStack = [];
let pendingEditorText = '';

function openEditor(rawText, sourceName) {
  pendingEditorText = rawText;
  editorUndoStack = [];

  const ta = $('#editor-textarea');
  const strip = $('#page-strip');
  const indicator = $('#page-indicator');
  const stripContainer = $('#page-strip-container');

  // Check if we have per-page data
  if (state.pdfPages.length > 0) {
    // Show page strip and first page
    stripContainer.style.display = '';
    state.selectedPageIndex = 0;
    renderPageStrip();
    showPage(0);
  } else {
    // No page data (e.g. txt/epub or single block) — show all text, hide strip
    stripContainer.style.display = 'none';
    ta.value = rawText;
    ta.removeAttribute('readonly');
    if (indicator) indicator.textContent = '';
  }

  updateEditorStats();
  $('#editor-overlay').classList.add('active');
}

function renderPageStrip() {
  const strip = $('#page-strip');
  strip.innerHTML = '';

  state.pdfPages.forEach((pageText, idx) => {
    const card = document.createElement('div');
    card.className = 'page-card' + (idx === state.selectedPageIndex ? ' active' : '');
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', 'Sayfa ' + (idx + 1));

    // Mini preview lines
    let previewHtml = '<div class="page-card-preview">';
    for (let i = 0; i < 8; i++) {
      previewHtml += '<div class="page-card-preview-line"></div>';
    }
    previewHtml += '</div>';

    card.innerHTML = previewHtml +
      '<span class="page-card-num">' + (idx + 1) + '</span>' +
      '<span class="page-card-label">sayfa</span>';

    card.addEventListener('click', () => {
      state.selectedPageIndex = idx;
      showPage(idx);
      // Update active state
      strip.querySelectorAll('.page-card').forEach((c, i) => {
        c.classList.toggle('active', i === idx);
      });
    });

    strip.appendChild(card);
  });
}

function showPage(pageIdx) {
  const ta = $('#editor-textarea');
  const indicator = $('#page-indicator');

  if (state.pdfPages.length > 0 && pageIdx < state.pdfPages.length) {
    ta.value = state.pdfPages[pageIdx];
    ta.setAttribute('readonly', 'readonly');
    if (indicator) {
      indicator.textContent = '— Sayfa ' + (pageIdx + 1) + ' / ' + state.pdfPages.length;
    }
    // Scroll to top of textarea
    ta.scrollTop = 0;
    // Scroll the active card into view
    const strip = $('#page-strip');
    const activeCard = strip.children[pageIdx];
    if (activeCard) {
      activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }
  updateEditorStats();
}

function updateEditorStats() {
  const ta = $('#editor-textarea');
  const text = ta.value;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const charCount = text.length;

  let statsText = wordCount + ' kelime · ' + charCount + ' karakter';

  if (state.pdfPages.length > 0) {
    // Calculate total word count across all pages from selectedPage onwards
    const remainingPages = state.pdfPages.length - state.selectedPageIndex;
    const totalWords = state.pdfPages.slice(state.selectedPageIndex)
      .join(' ').trim().split(/\s+/).filter(w => w.length > 0).length;
    statsText += ' · Sayfa ' + (state.selectedPageIndex + 1) + '/' + state.pdfPages.length;
    statsText += ' · Kalan ' + remainingPages + ' sayfa (' + totalWords + ' kelime)';
  }

  $('#editor-stats').textContent = statsText;
}

function pushEditorUndo() {
  if (state.pdfPages.length > 0) {
    editorUndoStack.push(JSON.parse(JSON.stringify(state.pdfPages)));
  } else {
    editorUndoStack.push($('#editor-textarea').value);
  }
  if (editorUndoStack.length > 30) editorUndoStack.shift();
}

function editorUndo() {
  if (!editorUndoStack.length) { showToast('Geri alınacak değişiklik yok'); return; }
  const prev = editorUndoStack.pop();
  if (state.pdfPages.length > 0 && Array.isArray(prev)) {
    state.pdfPages = prev;
    showPage(state.selectedPageIndex);
  } else if (typeof prev === 'string') {
    $('#editor-textarea').value = prev;
  }
  updateEditorStats();
}

// Helper: apply a text transformation function to all pages (or textarea if no pages)
function applyToAllPages(transformFn) {
  pushEditorUndo();
  if (state.pdfPages.length > 0) {
    state.pdfPages = state.pdfPages.map(pageText => transformFn(pageText));
    showPage(state.selectedPageIndex);
  } else {
    const ta = $('#editor-textarea');
    ta.value = transformFn(ta.value);
  }
  updateEditorStats();
}

const TR_WORD_TOKEN_RE = /^[A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛûÊêÔô]+$/;
const TR_VOWEL_CHAR_RE = /[aeıioöuüâîûêô]/i;
const TR_CONSONANT_CHAR_RE = /[bcçdfgğhjklmnprsştvyz]/i;

const TR_COMMON_STANDALONE_WORDS = new Set([
  've','ile','ama','fakat','ancak','lakin','çünkü','veya','ya','da','de','ki',
  'mi','mı','mu','mü','bir','bu','şu','o','ben','sen','biz','siz','onlar',
  'için','gibi','kadar','sonra','önce','en','çok','az','daha','hem','her','hiç',
  'ne','neden','niye','nasıl','nerede','nereye','burada','orada','şimdi','artık',
  'var','yok','olan','olur','olmaz','oldu','ise','idi','diye','bile','yalnız',
  'sadece','evet','hayır','şey','insan','kişi','gün','ay','yıl','saat',
  'ilk','son','orta','alt','üst','sağ','sol','ev','okul','iş'
]);

const TR_JOIN_BLOCKER_WORDS = new Set([
  've','ile','ama','fakat','ancak','lakin','çünkü','veya','ya','da','de','ki',
  'mi','mı','mu','mü','için','gibi','kadar','bu','şu','o','bir','çok','az','en',
  'her','hiç','ne','neden','niye','nasıl','nerede','nereye','şey'
]);

const TR_SUFFIX_FRAGMENTS = new Set([
  'lar','ler','ları','leri','ların','lerin',
  'lık','lik','luk','lük','lı','li','lu','lü',
  'sız','siz','suz','süz','cı','ci','cu','cü','çı','çi','çu','çü',
  'dan','den','tan','ten','dır','dir','dur','dür','tır','tir','tur','tür',
  'mış','miş','muş','müş','dı','di','du','dü','tı','ti','tu','tü',
  'mak','mek','yor','acak','ecek','ken',
  'ım','im','um','üm','ın','in','un','ün',
  'ımız','imiz','umuz','ümüz','ınız','iniz','unuz','ünüz',
  'sin','sın','sun','sün','siniz','sınız','sunuz','sünüz'
]);

function trNorm(word) {
  return (word || '').toLocaleLowerCase('tr-TR');
}

function isTrWordToken(word) {
  return TR_WORD_TOKEN_RE.test(word || '');
}

function shouldMergeBrokenTurkishPair(left, right) {
  if (!isTrWordToken(left) || !isTrWordToken(right)) return false;

  const l = trNorm(left);
  const r = trNorm(right);
  const totalLen = l.length + r.length;

  if (totalLen < 4 || totalLen > 20) return false;
  if (!TR_VOWEL_CHAR_RE.test(l + r)) return false;

  const leftCommon = TR_COMMON_STANDALONE_WORDS.has(l);
  const rightCommon = TR_COMMON_STANDALONE_WORDS.has(r);

  if (leftCommon && rightCommon) return false;
  if (TR_JOIN_BLOCKER_WORDS.has(r)) return false;
  if (TR_JOIN_BLOCKER_WORDS.has(l) && rightCommon) return false;

  if (leftCommon && !rightCommon && !TR_SUFFIX_FRAGMENTS.has(r)) return false;

  if (l.length > 3 && r.length > 3) return false;

  let score = 0;
  if (!leftCommon) score += 1;
  if (!rightCommon) score += 1;
  if (l.length <= 2) score += 1;
  if (r.length <= 2) score += 1;

  const leftLast = l[l.length - 1];
  const rightFirst = r[0];
  if (TR_CONSONANT_CHAR_RE.test(leftLast) && TR_VOWEL_CHAR_RE.test(rightFirst)) score += 1;
  if (TR_VOWEL_CHAR_RE.test(leftLast) && TR_CONSONANT_CHAR_RE.test(rightFirst)) score += 1;
  if (TR_SUFFIX_FRAGMENTS.has(r)) score += 1;

  return score >= 3;
}

function mergeBrokenTurkishWords(text) {
  if (!text) return { text: '', count: 0 };

  let fixed = text;
  let mergedCount = 0;
  const letterClass = 'A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛûÊêÔô';
  const inlinePattern = new RegExp('([' + letterClass + ']{1,16})([ \\t]+)([' + letterClass + ']{1,16})', 'g');
  const lineBreakPattern = new RegExp('([' + letterClass + ']{2,16})(\\n)([' + letterClass + ']{1,10})', 'g');

  for (let pass = 0; pass < 3; pass++) {
    let changed = 0;

    fixed = fixed.replace(inlinePattern, function(match, left, gap, right) {
      if (!shouldMergeBrokenTurkishPair(left, right)) return match;
      changed++;
      return left + right;
    });

    fixed = fixed.replace(lineBreakPattern, function(match, left, br, right) {
      if (/^[A-ZÇĞİÖŞÜÂÎÛÊÔ]/.test(right)) return match;
      if (!shouldMergeBrokenTurkishPair(left, right)) return match;
      changed++;
      return left + right;
    });

    mergedCount += changed;
    if (!changed) break;
  }

  return { text: fixed, count: mergedCount };
}

const TR_HEADING_CANDIDATE_WORDS = new Set([
  'giriş','önsöz','sonsöz','sonuç','özet','teşekkür','kaynakça','içindekiler',
  'bölüm','kısım','ek','abstract','chapter','part','section'
]);

const TR_LINE_CONTINUATION_HINT_WORDS = new Set([
  've','veya','ya','ama','fakat','ancak','lakin','çünkü','ki','de','da',
  'ile','için','gibi','kadar','sonra','önce','yoksa','ise','diye','mi','mı','mu','mü'
]);

function fixIsolatedSingleLetterLines(text) {
  if (!text) return { text: '', count: 0 };

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let fixedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const cur = (lines[i] || '').trim();
    if (!/^[A-ZÇĞİÖŞÜ]$/.test(cur)) continue;

    let nextIdx = i + 1;
    while (nextIdx < lines.length && !(lines[nextIdx] || '').trim()) nextIdx++;
    if (nextIdx >= lines.length) continue;

    const nextLine = (lines[nextIdx] || '').trim();
    if (!/^[a-zçğıöşüâîûêô]/.test(nextLine)) continue;

    const nextWordMatch = nextLine.match(/^([A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛûÊêÔô]+)/);
    const nextFirstWord = trNorm(nextWordMatch ? nextWordMatch[1] : '');

    let prevIdx = i - 1;
    while (prevIdx >= 0 && !(lines[prevIdx] || '').trim()) prevIdx--;
    const prevLine = prevIdx >= 0 ? (lines[prevIdx] || '').trim() : '';
    const prevEndsSentence = /[.!?…:]$/.test(prevLine);

    if (nextFirstWord && TR_LINE_CONTINUATION_HINT_WORDS.has(nextFirstWord) && prevLine && !prevEndsSentence) {
      lines[i] = '';
      fixedCount++;
      continue;
    }

    const paragraphStart = !prevLine || prevEndsSentence || (i > 0 && !(lines[i - 1] || '').trim());
    if (paragraphStart) {
      lines[nextIdx] = cur + nextLine;
      lines[i] = '';
      fixedCount++;
    }
  }

  return { text: lines.join('\n'), count: fixedCount };
}

function isLikelyHeadingLikeLine(line) {
  const t = (line || '').trim();
  if (!t) return false;
  if (t.length > 80) return false;

  if (/^#{1,6}\s/.test(t)) return true;
  if (/^(?:\d+|[IVXLCDM]+)[.)]\s+\S+/i.test(t)) return true;

  if (/^[A-ZÇĞİÖŞÜ0-9\s]{3,}$/.test(t) && t.split(/\s+/).length <= 10) return true;

  const words = t.split(/\s+/).filter(Boolean);
  const firstWord = trNorm((words[0] || '').replace(/[^A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛûÊêÔô]/g, ''));

  if (firstWord && TR_HEADING_CANDIDATE_WORDS.has(firstWord) && words.length <= 4) return true;
  if (/:$/.test(t) && words.length <= 8) return true;

  return false;
}

function shouldJoinWrappedLines(prevLine, nextLine) {
  const prev = (prevLine || '').trim();
  const next = (nextLine || '').trim();
  if (!prev || !next) return false;

  if (isLikelyHeadingLikeLine(prev) || isLikelyHeadingLikeLine(next)) return false;
  if (/^[-–—•*]\s+/.test(next) || /^\d+[.)]\s+/.test(next)) return false;

  if (/[.!?…]$/.test(prev)) return false;
  if (/[,:;]$/.test(prev)) return true;

  const nextFirstWord = trNorm(((next.match(/^([A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛûÊêÔô]+)/) || [,''])[1]));
  if (nextFirstWord && TR_LINE_CONTINUATION_HINT_WORDS.has(nextFirstWord)) return true;

  if (/^[a-zçğıöşüâîûêô0-9("“'‘]/.test(next)) return true;

  if (prev.length >= 35 && next.length >= 2) return true;

  return false;
}

function fixBrokenParagraphLines(text) {
  if (!text) return { text: '', count: 0 };

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let joinedCount = 0;

  lines.forEach((rawLine) => {
    const line = rawLine.trim();

    if (!line) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      return;
    }

    if (!out.length || out[out.length - 1] === '') {
      out.push(line);
      return;
    }

    const prev = out[out.length - 1];
    if (shouldJoinWrappedLines(prev, line)) {
      out[out.length - 1] = prev + ' ' + line;
      joinedCount++;
    } else {
      out.push(line);
    }
  });

  const rebuilt = out.join('\n').replace(/[^\S\n]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { text: rebuilt, count: joinedCount };
}

function preCleanPdfPageText(text) {
  let t = text || '';
  if (!t) return { text: '', mergedCount: 0, wrappedCount: 0, isolatedCount: 0 };

  t = t.replace(/(\w)-\s*\n\s*(\w)/g, '$1$2');
  t = t.replace(/[^\S\n]{2,}/g, ' ');
  t = t.split('\n').map(line => line.trim()).join('\n');

  const isolated = fixIsolatedSingleLetterLines(t);
  t = isolated.text;

  const wrapped = fixBrokenParagraphLines(t);
  t = wrapped.text;

  const merged = mergeBrokenTurkishWords(t);
  t = merged.text;

  t = t.replace(/([a-zçğıöşü])([A-ZÇĞİÖŞÜ])/g, '$1 $2');
  t = t.replace(/([.!?;:,])([A-ZÇĞİÖŞÜa-zçğıöşü])/g, '$1 $2');
  t = t.replace(/\(\s+/g, '(');
  t = t.replace(/\s+\)/g, ')');
  t = t.replace(/^\s+$/gm, '');

  return {
    text: t.trim(),
    mergedCount: merged.count,
    wrappedCount: wrapped.count,
    isolatedCount: isolated.count,
  };
}

function autoFixText() {
  let mergedTotal = 0;
  let wrappedJoinTotal = 0;
  let isolatedLetterTotal = 0;

  applyToAllPages(function(t) {
    t = t.replace(/(\w)-\s*\n\s*(\w)/g, '$1$2');
    t = t.replace(/^\s*\d{1,4}\s*$/gm, '');
    t = removeRepeatingHeaderFooter(t);
    t = t.replace(/\n{3,}/g, '\n\n');
    t = t.replace(/[^\S\n]{2,}/g, ' ');
    t = t.split('\n').map(line => line.trim()).join('\n');

    const isolated = fixIsolatedSingleLetterLines(t);
    isolatedLetterTotal += isolated.count;
    t = isolated.text;

    const wrapped = fixBrokenParagraphLines(t);
    wrappedJoinTotal += wrapped.count;
    t = wrapped.text;

    t = t.replace(/([a-zçğıöşü])([A-ZÇĞİÖŞÜ])/g, '$1 $2');
    t = t.replace(/([.!?;:,])([A-ZÇĞİÖŞÜa-zçğıöşü])/g, '$1 $2');
    t = t.replace(/\(\s+/g, '(');
    t = t.replace(/\s+\)/g, ')');
    t = t.replace(/^\s+$/gm, '');

    const merged = mergeBrokenTurkishWords(t);
    mergedTotal += merged.count;
    t = merged.text;

    return t.trim();
  });

  const details = [];
  if (wrappedJoinTotal > 0) details.push(wrappedJoinTotal + ' satır birleştirildi');
  if (isolatedLetterTotal > 0) details.push(isolatedLetterTotal + ' tek harf satırı düzeltildi');
  if (mergedTotal > 0) details.push(mergedTotal + ' bölünmüş kelime birleştirildi');

  if (details.length) {
    showToast('Otomatik düzeltmeler uygulandı · ' + details.join(' · '));
  } else {
    showToast('Otomatik düzeltmeler uygulandı');
  }
}

function removeHyphens() {
  applyToAllPages(function(t) {
    return t.replace(/(\w)-\s*\n\s*(\w)/g, '$1$2');
  });
  showToast('Satır sonu tireleri birleştirildi');
}

function removePageNumbers() {
  applyToAllPages(function(t) {
    return t.replace(/^\s*\d{1,4}\s*$/gm, '').replace(/\n{3,}/g, '\n\n');
  });
  showToast('Sayfa numaraları kaldırıldı');
}

function removeExtraSpaces() {
  applyToAllPages(function(t) {
    t = t.replace(/[^\S\n]{2,}/g, ' ');
    t = t.split('\n').map(l => l.trim()).join('\n');
    t = t.replace(/\n{3,}/g, '\n\n');
    return t;
  });
  showToast('Boşluklar düzeltildi');
}

function removeRepeatingHeaderFooter(text) {
  const lines = text.split('\n');
  if (lines.length < 20) return text;

  const freq = {};
  lines.forEach(line => {
    const trimmed = line.trim();
    if (trimmed.length > 3 && trimmed.length < 100) {
      freq[trimmed] = (freq[trimmed] || 0) + 1;
    }
  });

  const repeating = new Set();
  const threshold = Math.max(3, Math.floor(lines.length / 30));
  for (const [line, count] of Object.entries(freq)) {
    if (count >= threshold) repeating.add(line);
  }

  if (!repeating.size) return text;

  return lines.filter(line => !repeating.has(line.trim())).join('\n');
}

function removeHeaders() {
  applyToAllPages(function(t) {
    t = removeRepeatingHeaderFooter(t);
    return t.replace(/\n{3,}/g, '\n\n').trim();
  });
  showToast('Tekrarlayan üstbilgi/altbilgiler kaldırıldı');
}

/* ─────────────────────────────────────────────
   BUL & DEĞİŞTİR
   ───────────────────────────────────────────── */
let frCurrentIndex = -1; // şu an vurgulanan eşleşme indeksi (replacOne için)

function frBuildRegex() {
  const raw = $('#fr-find').value;
  if (!raw) return null;
  const caseSensitive = $('#fr-case').checked;
  const wholeWord = $('#fr-word').checked;
  let escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord) escaped = '\\b' + escaped + '\\b';
  const flags = caseSensitive ? 'g' : 'gi';
  try { return new RegExp(escaped, flags); } catch { return null; }
}

function frCloneRegex(re, globalMode) {
  if (!re) return null;
  let flags = re.flags || '';
  if (globalMode) {
    if (!flags.includes('g')) flags += 'g';
  } else {
    flags = flags.replace(/g/g, '');
  }
  return new RegExp(re.source, flags);
}

function frGetTargetTexts() {
  if (state.pdfPages.length > 0) return state.pdfPages.slice();
  return [$('#editor-textarea').value];
}

function frSetTargetTexts(texts) {
  if (state.pdfPages.length > 0) {
    state.pdfPages = texts;
    showPage(state.selectedPageIndex);
    return;
  }
  $('#editor-textarea').value = texts[0] || '';
}

function frCountMatches(re) {
  let total = 0;
  const texts = frGetTargetTexts();
  texts.forEach((text) => {
    const m = text.match(frCloneRegex(re, true));
    if (m) total += m.length;
  });
  return total;
}

function frUpdateCount() {
  const countEl = $('#fr-match-count');
  const re = frBuildRegex();
  if (!re) { countEl.textContent = ''; return; }
  const n = frCountMatches(re);
  countEl.textContent = n === 0 ? 'Bulunamadı' : n + ' eşleşme';
}

function frReplaceOne() {
  const re = frBuildRegex();
  if (!re) { showToast('Aranacak metin boş'); return; }
  const replacement = $('#fr-replace').value;
  const texts = frGetTargetTexts();
  const singleRe = frCloneRegex(re, false);

  let changed = false;
  for (let i = 0; i < texts.length; i++) {
    if (!singleRe.test(texts[i])) continue;
    texts[i] = texts[i].replace(singleRe, replacement);
    changed = true;
    break;
  }

  if (!changed) { showToast('Eşleşme bulunamadı'); return; }

  pushEditorUndo();
  frSetTargetTexts(texts);
  updateEditorStats();
  frUpdateCount();
  showToast('Bir eşleşme değiştirildi');
}

function frReplaceAll() {
  const re = frBuildRegex();
  if (!re) { showToast('Aranacak metin boş'); return; }
  const replacement = $('#fr-replace').value;
  const total = frCountMatches(re);
  if (!total) { showToast('Eşleşme bulunamadı'); return; }

  const texts = frGetTargetTexts().map((text) => text.replace(frCloneRegex(re, true), replacement));
  pushEditorUndo();
  frSetTargetTexts(texts);
  updateEditorStats();
  frUpdateCount();
  showToast(total + ' eşleşme değiştirildi');
}

function frDeleteAll() {
  const re = frBuildRegex();
  if (!re) { showToast('Aranacak metin boş'); return; }
  const total = frCountMatches(re);
  if (!total) { showToast('Eşleşme bulunamadı'); return; }

  const texts = frGetTargetTexts().map((text) => text.replace(frCloneRegex(re, true), ''));
  pushEditorUndo();
  frSetTargetTexts(texts);
  updateEditorStats();
  frUpdateCount();
  showToast(total + ' eşleşme silindi');
}

let lastSaveFlash = 0;
function savePosition() {
  if (!state.fileHash || !state.words.length) return;
  try {
    localStorage.setItem('rsvp_pos_' + state.fileHash, String(state.currentIndex));
    const now = Date.now();
    if (now - lastSaveFlash > 10000) {
      lastSaveFlash = now;
      const pct = Math.round((state.currentIndex / state.words.length) * 100);
      flashSaveIndicator('💾 %' + pct + ' kaydedildi');
    }
  } catch(e) {}
}

function loadPosition() {
  if (!state.fileHash) return 0;
  try {
    const v = localStorage.getItem('rsvp_pos_' + state.fileHash);
    return v ? Math.max(0, parseInt(v, 10) || 0) : 0;
  } catch(e) { return 0; }
}

/* ─────────────────────────────────────────────
   READING LIBRARY — Son Okunan Dosyalar
   ───────────────────────────────────────────── */
const LS_LIBRARY = 'rsvp_library';

function loadLibrary() {
  try {
    const raw = localStorage.getItem(LS_LIBRARY);
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

function saveLibrary(lib) {
  try { localStorage.setItem(LS_LIBRARY, JSON.stringify(lib)); } catch(e) {}
}

function addToLibrary(fileName, fileHash, wordCount, fullText) {
  const lib = loadLibrary();
  const existing = lib.findIndex(item => item.hash === fileHash);
  const entry = {
    name: fileName || 'Adsız metin',
    hash: fileHash,
    wordCount: wordCount,
    lastRead: Date.now(),
  };

  if (existing >= 0) {
    lib[existing] = { ...lib[existing], ...entry };
  } else {
    lib.unshift(entry);
  }

  if (lib.length > 20) {
    const removed = lib.splice(20);
    removed.forEach(r => {
      try { localStorage.removeItem('rsvp_text_' + r.hash); } catch(e) {}
    });
  }
  saveLibrary(lib);

  try {
    localStorage.setItem('rsvp_text_' + fileHash, fullText);
  } catch(e) {
    console.warn('Metin localStorage\' a sığmadı, devam et özelliği sınırlı olacak');
  }
}

function removeFromLibrary(fileHash) {
  const lib = loadLibrary().filter(item => item.hash !== fileHash);
  saveLibrary(lib);
  try { localStorage.removeItem('rsvp_pos_' + fileHash); } catch(e) {}
  try { localStorage.removeItem('rsvp_bm_' + fileHash); } catch(e) {}
  try { localStorage.removeItem('rsvp_text_' + fileHash); } catch(e) {}
  renderLibrary();
}

function renderLibrary() {
  const lib = loadLibrary();
  const section = $('#library-section');
  const list = $('#library-list');

  if (!lib.length) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  list.innerHTML = '';

  lib.sort((a, b) => b.lastRead - a.lastRead);

  lib.forEach(item => {
    const pos = loadPositionFor(item.hash);
    const pct = item.wordCount ? Math.round((pos / item.wordCount) * 100) : 0;
    const dateStr = new Date(item.lastRead).toLocaleDateString('tr-TR', {
      day: 'numeric', month: 'short',
    });

    const el = document.createElement('div');
    el.className = 'library-item';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.innerHTML =
      '<div class="library-item-info">' +
        '<div class="library-item-name">' + escHtml(item.name) + '</div>' +
        '<div class="library-item-meta">' +
          '<span>' + pct + '% · ' + item.wordCount + ' kelime</span>' +
          '<span>' + dateStr + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="library-item-progress"><div class="library-item-progress-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="library-item-actions">' +
        '<button class="lib-resume" data-hash="' + item.hash + '" title="Devam et" aria-label="Devam et">▶</button>' +
        '<button class="lib-delete" data-hash="' + item.hash + '" title="Sil" aria-label="Listeden sil">✕</button>' +
      '</div>';

    el.addEventListener('click', (e) => {
      if (e.target.closest('.lib-delete')) {
        e.stopPropagation();
        removeFromLibrary(item.hash);
        return;
      }
      resumeFromLibrary(item);
    });

    list.appendChild(el);
  });
}

function resumeFromLibrary(item) {
  let text = null;
  try { text = localStorage.getItem('rsvp_text_' + item.hash); } catch(e) {}
  if (!text) {
    showToast('Metin verisi bulunamadı — dosyayı tekrar yükleyin');
    return;
  }
  state.fileName = item.name;
  loadText(text, true);
}

function loadPositionFor(hash) {
  try {
    const v = localStorage.getItem('rsvp_pos_' + hash);
    return v ? Math.max(0, parseInt(v, 10) || 0) : 0;
  } catch(e) { return 0; }
}

/* ─────────────────────────────────────────────
   BOOKMARKS
   ───────────────────────────────────────────── */
function getBookmarks() {
  if (!state.fileHash) return [];
  try {
    const raw = localStorage.getItem('rsvp_bm_' + state.fileHash);
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

function saveBookmarks(bm) {
  if (!state.fileHash) return;
  try { localStorage.setItem('rsvp_bm_' + state.fileHash, JSON.stringify(bm)); } catch(e) {}
}

function addBookmark() {
  if (!state.words.length) return;
  const bm = getBookmarks();
  const pct = Math.round((state.currentIndex / state.words.length) * 100);
  const contextWords = state.words.slice(state.currentIndex, state.currentIndex + 6).join(' ');

  if (bm.some(b => b.index === state.currentIndex)) {
    showToast('Bu konum zaten yer imlerinde');
    return;
  }

  bm.push({
    index: state.currentIndex,
    pct: pct,
    context: contextWords,
    date: Date.now(),
  });

  bm.sort((a, b) => a.index - b.index);
  saveBookmarks(bm);
  showToast('🔖 Yer imi eklendi — %' + pct);
  flashSaveIndicator('🔖 Kaydedildi');
}

function removeBookmark(index) {
  const bm = getBookmarks().filter(b => b.index !== index);
  saveBookmarks(bm);
  renderBookmarks();
}

function goToBookmark(index) {
  const wasPlaying = state.playing;
  stopRSVP();
  state.currentIndex = Math.min(index, state.words.length - 1);
  displayCurrentWord();
  updateProgressUI();
  $('#bookmarks-overlay').classList.remove('active');
  if (wasPlaying) startRSVP();
  else updateContextViewer(true);
}

function renderBookmarks() {
  const bm = getBookmarks();
  const list = $('#bookmarks-list');
  const empty = $('#bookmarks-empty');

  if (!bm.length) {
    empty.style.display = '';
    list.innerHTML = '';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = '';

  bm.forEach(b => {
    const el = document.createElement('div');
    el.className = 'bookmark-item';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.innerHTML =
      '<div class="bookmark-item-info">' +
        '<div class="bookmark-item-label">%' + b.pct + ' — Kelime ' + b.index + '</div>' +
        '<div class="bookmark-item-detail">"' + escHtml(b.context) + '…"</div>' +
      '</div>' +
      '<div class="bookmark-item-actions">' +
        '<button class="bm-goto" title="Git" aria-label="Bu yer imine git">→</button>' +
        '<button class="bm-delete" title="Sil" aria-label="Yer imini sil">✕</button>' +
      '</div>';

    el.addEventListener('click', (e) => {
      if (e.target.closest('.bm-delete')) {
        e.stopPropagation();
        removeBookmark(b.index);
        return;
      }
      goToBookmark(b.index);
    });

    list.appendChild(el);
  });
}

/* ─────────────────────────────────────────────
   SAVE POSITION INDICATOR
   ───────────────────────────────────────────── */
let saveIndicatorTimer = null;

function flashSaveIndicator(msg) {
  const el = $('#save-indicator');
  if (!el) return;
  el.textContent = msg || '💾 Kaydedildi';
  el.classList.add('visible');
  clearTimeout(saveIndicatorTimer);
  saveIndicatorTimer = setTimeout(() => el.classList.remove('visible'), 2000);
}

function updateFileNameUI() {
  const el = $('#read-file-name');
  if (el) {
    el.textContent = state.fileName || '';
    el.title = state.fileName || '';
  }
}

/* ─────────────────────────────────────────────
   SCREEN WAKE LOCK (telefon ekranını açık tut)
   ───────────────────────────────────────────── */
let wakeLockSentinel = null;
let wakeLockLastErrorAt = 0;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  if (wakeLockSentinel) return;
  if (document.visibilityState !== 'visible') return;

  try {
    wakeLockSentinel = await navigator.wakeLock.request('screen');

    wakeLockSentinel.addEventListener('release', () => {
      wakeLockSentinel = null;
      if (state.playing && document.visibilityState === 'visible') {
        requestWakeLock();
      }
    });
  } catch (err) {
    const now = Date.now();
    if (now - wakeLockLastErrorAt > 30000) {
      wakeLockLastErrorAt = now;
      showToast('Ekran kilidi açılamadı (tarayıcı/pil tasarrufu engeli olabilir)');
    }
  }
}

async function releaseWakeLock() {
  if (!wakeLockSentinel) return;
  try {
    await wakeLockSentinel.release();
  } catch (err) {}
  wakeLockSentinel = null;
}

/* ─────────────────────────────────────────────
   ROUTER
   ───────────────────────────────────────────── */
function navigate(screen) {
  closeInlineMusicDrawer();
  $$('.screen').forEach(s => s.classList.remove('active'));
  if (screen === 'read') {
    readScreen.classList.add('active');
    window.location.hash = '#read';
  } else {
    homeScreen.classList.add('active');
    window.location.hash = '#home';
    stopRSVP();
  }
}

function handleHash() {
  const hash = window.location.hash;
  if (hash === '#read' && state.words.length) {
    navigate('read');
  } else {
    navigate('home');
  }
}

/* ─────────────────────────────────────────────
   THEME & SETTINGS APPLICATION
   ───────────────────────────────────────────── */
function applyTheme(theme) {
  if (theme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.body.setAttribute('data-theme', theme);
  }
  state.settings.theme = theme;

  $$('[data-theme-pick]').forEach(b => {
    b.classList.toggle('active', b.dataset.themePick === theme);
  });
  saveSettings();
}

function applyBgColor(color) {
  document.documentElement.style.setProperty('--bg', color);
  state.settings.bgColor = color;
  bgCustom.value = color;

  $$('.bg-presets button').forEach(b => {
    b.classList.toggle('active', b.dataset.bg === color);
  });
  saveSettings();
}

function applyFont(font) {
  const map = {
    serif:    "'Lora', Georgia, serif",
    sans:     "system-ui, -apple-system, 'Segoe UI', sans-serif",
    mono:     "'Courier New', Consolas, monospace",
    garamond: "'EB Garamond', Georgia, serif",
  };
  document.documentElement.style.setProperty('--font-reading', map[font] || map.serif);
  state.settings.fontFamily = font;

  $$('[data-font]').forEach(b => {
    b.classList.toggle('active', b.dataset.font === font);
  });
  saveSettings();
}

function applyFontSize(size) {
  document.documentElement.style.setProperty('--rsvp-font-size', size + 'px');
  state.settings.fontSize = size;
  fontsizeSlider.value = size;
  fontsizeVal.textContent = size;
  saveSettings();
}

function applyChunk(n) {
  state.settings.chunkSize = n;
  $$('[data-chunk]').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.chunk) === n);
  });
  saveSettings();
}

function applyAllSettings() {
  applyTheme(state.settings.theme);
  if (state.settings.theme === 'dark' || state.settings.theme === 'auto') {
    applyBgColor(state.settings.bgColor);
  }
  applyFont(state.settings.fontFamily);
  applyFontSize(state.settings.fontSize);
  applyChunk(state.settings.chunkSize);

  speedSlider.value = state.settings.wpm;
  speedVal.textContent = state.settings.wpm;
  pauseSlider.value = state.settings.pauseMultiplier;
  pauseVal.textContent = '%' + state.settings.pauseMultiplier;

  musicVolume.value = state.audio.volume;
  volumeValEl.textContent = state.audio.volume;
  $('#music-mute').textContent = state.audio.muted ? '🔇' : '🔊';
}

/* ─────────────────────────────────────────────
   FILE PARSING
   ───────────────────────────────────────────── */
function handleFile(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  state.fileName = file.name;

  if (ext === 'txt') {
    const reader = new FileReader();
    reader.onload = (e) => loadText(e.target.result);
    reader.onerror = () => showToast('Dosya okunamadı');
    reader.readAsText(file);
  } else if (ext === 'epub') {
    parseEPUB(file);
  } else if (ext === 'pdf') {
    parsePDF(file);
  } else {
    showToast('Desteklenmeyen format: .' + ext);
  }
}

async function parseEPUB(file) {
  if (typeof ePub === 'undefined') {
    showToast('epub.js yükleniyor, lütfen bekleyin...');
    await new Promise(r => setTimeout(r, 2000));
    if (typeof ePub === 'undefined') {
      showToast('epub.js yüklenemedi');
      return;
    }
  }
  try {
    showToast('EPUB ayrıştırılıyor...');
    const arrayBuffer = await file.arrayBuffer();
    const book = ePub(arrayBuffer);
    await book.ready;
    await book.loaded.spine;

    const spine = book.spine;
    const items = spine.spineItems || spine.items || [];
    let allText = '';

    for (let i = 0; i < items.length; i++) {
      try {
        const section = items[i];
        const doc = await section.load(book.load.bind(book));
        if (doc && doc.body) {
          allText += doc.body.textContent + ' ';
        } else if (doc && typeof doc === 'object' && doc.documentElement) {
          allText += doc.documentElement.textContent + ' ';
        }
      } catch(sectionErr) {
        console.warn('EPUB section ' + i + ' skipped:', sectionErr);
      }
    }

    if (!allText.trim() && items.length) {
      for (let i = 0; i < items.length; i++) {
        try {
          const raw = await book.load(items[i].href);
          if (typeof raw === 'string') {
            const parsed = new DOMParser().parseFromString(raw, 'text/html');
            allText += parsed.body.textContent + ' ';
          } else if (raw && raw.body) {
            allText += raw.body.textContent + ' ';
          }
        } catch(e2) {}
      }
    }

    if (allText.trim()) {
      loadText(allText);
    } else {
      showToast('EPUB içeriği okunamadı');
    }
  } catch(e) {
    console.error('EPUB parse error:', e);
    showToast('EPUB dosyası okunamadı');
  }
}

function extractPdfPageText(content) {
  const items = content && Array.isArray(content.items) ? content.items : [];
  if (!items.length) return '';

  const lineBuckets = [];
  const lineTolerance = 2.5;

  items.forEach((item) => {
    const raw = item && typeof item.str === 'string' ? item.str : '';
    const str = raw.trim();
    if (!str) return;

    const tr = Array.isArray(item.transform) ? item.transform : [];
    const x = Number(tr[4]) || 0;
    const y = Number(tr[5]) || 0;

    let bucket = null;
    for (let i = 0; i < lineBuckets.length; i++) {
      if (Math.abs(lineBuckets[i].y - y) <= lineTolerance) {
        bucket = lineBuckets[i];
        break;
      }
    }

    if (!bucket) {
      bucket = { y, chunks: [] };
      lineBuckets.push(bucket);
    }

    bucket.chunks.push({ x, str });
  });

  lineBuckets.sort((a, b) => b.y - a.y);

  const lines = lineBuckets.map((bucket) => {
    bucket.chunks.sort((a, b) => a.x - b.x);
    let line = '';

    bucket.chunks.forEach((chunk) => {
      if (!line) {
        line = chunk.str;
        return;
      }

      if (/^[,.;:!?%)\]}]/.test(chunk.str)) {
        line += chunk.str;
      } else if (/[([\{]$/.test(line)) {
        line += chunk.str;
      } else {
        line += ' ' + chunk.str;
      }
    });

    return line.trim();
  }).filter(Boolean);

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function parsePDF(file) {
  if (typeof pdfjsLib === 'undefined') {
    showToast('PDF.js yükleniyor, lütfen bekleyin...');
    await new Promise(r => setTimeout(r, 1500));
    if (typeof pdfjsLib === 'undefined') {
      showToast('PDF.js yüklenemedi');
      return;
    }
  }
  try {
    showToast('PDF ayrıştırılıyor...');
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    if (typeof pdfjsLib.VerbosityLevel !== 'undefined') {
      pdfjsLib.verbosity = pdfjsLib.VerbosityLevel.ERRORS;
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({
      data: arrayBuffer,
      stopAtErrors: false,
      disableFontFace: true,
      useSystemFonts: true,
    }).promise;

    // Store text per page
    state.pdfPages = [];
    let allText = '';
    let preFixMergedTotal = 0;
    let preFixWrappedTotal = 0;
    let preFixIsolatedTotal = 0;

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const rawPageText = extractPdfPageText(content);
      const preFixed = preCleanPdfPageText(rawPageText);
      const pageText = preFixed.text;

      preFixMergedTotal += preFixed.mergedCount;
      preFixWrappedTotal += preFixed.wrappedCount;
      preFixIsolatedTotal += preFixed.isolatedCount;

      state.pdfPages.push(pageText);
      if (pageText) {
        allText += (allText ? '\n\n' : '') + pageText;
      }
    }

    if (allText.trim()) {
      const details = [];
      if (preFixWrappedTotal > 0) details.push(preFixWrappedTotal + ' satır birleştirildi');
      if (preFixIsolatedTotal > 0) details.push(preFixIsolatedTotal + ' tek harf satırı düzeltildi');
      if (preFixMergedTotal > 0) details.push(preFixMergedTotal + ' bölünmüş kelime birleştirildi');

      if (details.length) {
        showToast(pdf.numPages + ' sayfa yüklendi · Ön düzeltme: ' + details.join(' · '));
      } else {
        showToast(pdf.numPages + ' sayfa yüklendi');
      }
      openEditor(allText.trim(), state.fileName || 'PDF');
    } else {
      showToast('PDF içeriği boş');
    }
  } catch(e) {
    console.error('PDF parse error:', e);
    showToast('PDF dosyası okunamadı');
  }
}

/* ─────────────────────────────────────────────
   TEXT → WORDS
   ───────────────────────────────────────────── */
function detectHeadings(rawText) {
  const headings = new Set();
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  let wordIdx = 0;

  const HEADING_RE = /^(CHAPTER|PART|SECTION|BÖLÜM|KISIM|GİRİŞ|ÖNSÖZ|SONUÇ|KAYNAKÇA|İÇİNDEKİLER|EKLER|ÖZET|ABSTRACT|SUNUŞ|TAKDIM|BAŞLANGIÇ|SONSÖZ)\b/i;
  const ROMAN_RE = /^[IVXLCDM]+[.:]?\s/;

  for (const raw of lines) {
    const line = raw.trim();
    const lineWords = line.split(/\s+/).filter(w => w.length > 0);

    if (lineWords.length === 0) continue;

    let isHeading = false;

    if (lineWords.length <= 12) {
      const letters = line.replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜ]/g, '');
      const uppers = line.replace(/[^A-ZÇĞİÖŞÜ]/g, '');
      if (letters.length > 2 && uppers.length / letters.length > 0.7) isHeading = true;
    }

    if (HEADING_RE.test(line)) isHeading = true;
    if (ROMAN_RE.test(line) && lineWords.length <= 8) isHeading = true;

    if (lineWords.length <= 6 && /^\d+[.):]\s/.test(line)) isHeading = true;
    if (lineWords.length <= 6 && /^#{1,6}\s/.test(line)) isHeading = true;

    if (isHeading) {
      for (let i = 0; i < lineWords.length; i++) {
        headings.add(wordIdx + i);
      }
    }

    wordIdx += lineWords.length;
  }
  return headings;
}

function loadText(text, fromLibrary) {
  const fullText = text;
  state.headingIndices = detectHeadings(fullText);
  text = text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
  if (!text) {
    showToast('Metin boş');
    return;
  }

  state.fullText = fullText;
  $('#context-viewer-inner')._lastWordCount = 0;
  state.words = text.split(/\s+/).filter(w => w.length > 0);
  state.fileHash = simpleHash(text);

  addToLibrary(state.fileName, state.fileHash, state.words.length, fullText);

  const savedPos = loadPosition();
  state.currentIndex = Math.min(savedPos, state.words.length - 1);

  updateFileNameUI();
  updateProgressUI();
  updateStatsUI();
  displayCurrentWord();
  navigate('read');
  updateContextViewer(true);

  if (savedPos > 0 && !fromLibrary) {
    const pct = Math.round((savedPos / state.words.length) * 100);
    showToast('Kaldığınız yerden devam: %' + pct + ' (' + state.words.length + ' kelime)');
  } else {
    showToast(state.words.length + ' kelime yüklendi');
  }
}

/* ─────────────────────────────────────────────
   ORP (Optimal Recognition Point) CALCULATION
   ───────────────────────────────────────────── */
function getORP(word) {
  const clean = word.replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜâîûêôÂÎÛÊÔ0-9]/g, '');
  const len = clean.length;
  if (len <= 1) return 0;
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  if (len <= 8) return 2;
  return 3;
}

function renderWord(word) {
  const orpIndex = getORP(word);
  const before = word.substring(0, orpIndex);
  const orp    = word[orpIndex] || '';
  const after  = word.substring(orpIndex + 1);
  return '<span>' + escHtml(before) + '</span><span class="orp">' + escHtml(orp) + '</span><span>' + escHtml(after) + '</span>';
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ─────────────────────────────────────────────
   RSVP ENGINE
   ───────────────────────────────────────────── */
function displayCurrentWord() {
  if (!state.words.length) return;

  const chunk = state.settings.chunkSize;
  const startIdx = state.currentIndex;
  const endIdx = Math.min(startIdx + chunk, state.words.length);
  const wordsToShow = state.words.slice(startIdx, endIdx);

  if (!wordsToShow.length) {
    finishReading();
    return;
  }

  let isHeadingChunk = false;
  for (let i = startIdx; i < endIdx; i++) {
    if (state.headingIndices.has(i)) { isHeadingChunk = true; break; }
  }

  const html = wordsToShow.map(w => '<span class="rsvp-word-chunk">' + renderWord(w) + '</span>').join(' ');
  rsvpWord.innerHTML = html;
  rsvpWord.classList.toggle('heading', isHeadingChunk);
  rsvpWord.style.animation = 'none';
  rsvpWord.offsetHeight;
  rsvpWord.style.animation = '';

  updateProgressUI();
}

function getDelay() {
  const baseDelay = 60000 / state.settings.wpm;
  const chunk = state.settings.chunkSize;
  const idx = state.currentIndex;
  const endIdx = Math.min(idx + chunk, state.words.length);

  let extraPause = 0;
  for (let i = idx; i < endIdx; i++) {
    if (SENTENCE_END_RE.test(state.words[i])) {
      extraPause = baseDelay * (state.settings.pauseMultiplier / 100);
      break;
    } else if (PUNCTUATION_RE.test(state.words[i])) {
      extraPause = Math.max(extraPause, baseDelay * (state.settings.pauseMultiplier / 200));
    }
  }

  return (baseDelay * chunk) + extraPause;
}

function stepForward() {
  if (!state.playing) return;
  if (state.currentIndex >= state.words.length) {
    finishReading();
    return;
  }

  displayCurrentWord();
  const delay = getDelay();
  const wordsRead = Math.min(state.settings.chunkSize, state.words.length - state.currentIndex);
  state.stats.todayWords += wordsRead;
  state.currentIndex += wordsRead;

  if (state.currentIndex >= state.words.length) {
    setTimeout(finishReading, delay);
    return;
  }

  savePosition();
  state.timer = setTimeout(stepForward, delay);
}

function updateContextViewer(show) {
  const cv = $('#context-viewer');
  const inner = $('#context-viewer-inner');
  if (!show || !state.words.length) {
    cv.classList.remove('visible');
    return;
  }

  const idx = state.currentIndex;
  const chunk = state.settings.chunkSize || 1;

  // Tüm metni render et — sadece mevcut konum değiştiyse veya ilk açılışta yeniden oluştur
  if (!inner._lastWordCount || inner._lastWordCount !== state.words.length) {
    let html = '';
    for (let i = 0; i < state.words.length; i++) {
      const w = escHtml(state.words[i]);
      const isH = state.headingIndices.has(i);
      const cls = isH ? 'ctx-word ctx-heading' : 'ctx-word';
      html += '<span class="' + cls + '" data-idx="' + i + '">' + w + '</span> ';
    }
    inner.innerHTML = html;
    inner._lastWordCount = state.words.length;
  }

  // Önceki current'ı temizle
  inner.querySelectorAll('.ctx-current').forEach(el => el.classList.remove('ctx-current'));

  // Yeni current'ları işaretle
  for (let i = idx; i < Math.min(idx + chunk, state.words.length); i++) {
    const el = inner.querySelector('[data-idx="' + i + '"]');
    if (el) el.classList.add('ctx-current');
  }

  cv.classList.add('visible');

  // Aktif kelimeyi görünür alana kaydır
  // visible class eklendikten sonra layout hazır olana kadar bekle
  const cur = inner.querySelector('.ctx-current');
  if (cur) {
    requestAnimationFrame(() => {
      const cvRect = cv.getBoundingClientRect();
      const curRect = cur.getBoundingClientRect();
      const offset = curRect.top - cvRect.top + cv.scrollTop - cv.clientHeight / 2 + cur.offsetHeight / 2;
      cv.scrollTo({ top: offset, behavior: 'smooth' });
    });
  }
}

function startRSVP() {
  if (!state.words.length) return;
  resumeStreamAfterGesture();
  requestWakeLock();
  if (state.currentIndex >= state.words.length) {
    state.currentIndex = 0;
  }
  state.playing = true;
  updateContextViewer(false);
  $('#btn-play').innerHTML = '⏸';
  $('#btn-play').setAttribute('aria-label', 'Duraklat');
  stepForward();
}

function stopRSVP() {
  state.playing = false;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  $('#btn-play').innerHTML = '▶';
  $('#btn-play').setAttribute('aria-label', 'Başlat');
  savePosition();
  saveStats();
  releaseWakeLock();
  updateContextViewer(true);
}

function toggleRSVP() {
  if (state.playing) stopRSVP();
  else startRSVP();
}

function goBack(n) {
  const wasPlaying = state.playing;
  stopRSVP();
  state.currentIndex = Math.max(0, state.currentIndex - (n || 5) * state.settings.chunkSize);
  displayCurrentWord();
  if (wasPlaying) startRSVP();
  else updateContextViewer(true);
}

function goForward(n) {
  const wasPlaying = state.playing;
  stopRSVP();
  state.currentIndex = Math.min(state.words.length - 1, state.currentIndex + (n || 5) * state.settings.chunkSize);
  displayCurrentWord();
  if (wasPlaying) startRSVP();
  else updateContextViewer(true);
}

function jumpTo(pct) {
  const wasPlaying = state.playing;
  stopRSVP();
  state.currentIndex = Math.floor((pct / 100) * state.words.length);
  state.currentIndex = Math.max(0, Math.min(state.currentIndex, state.words.length - 1));
  displayCurrentWord();
  if (wasPlaying) startRSVP();
  else updateContextViewer(true);
}

function finishReading() {
  stopRSVP();
  rsvpWord.innerHTML = '<span class="rsvp-idle-msg">Okuma tamamlandı!</span>';
  progressFill.style.width = '100%';
  progressPct.textContent = '100%';
  progressWords.textContent = state.words.length + ' / ' + state.words.length;
  saveStats();
}

/* ─────────────────────────────────────────────
   UI UPDATES
   ───────────────────────────────────────────── */
function updateProgressUI() {
  if (!state.words.length) return;
  const pct = Math.round((state.currentIndex / state.words.length) * 100);
  progressFill.style.width = pct + '%';
  progressPct.textContent = pct + '%';
  progressWords.textContent = state.currentIndex + ' / ' + state.words.length;
  progressBar.setAttribute('aria-valuenow', pct);
}

function updateStatsUI() {
  statWpm.textContent = state.settings.wpm;
  const remaining = state.words.length - state.currentIndex;
  statRemaining.textContent = remaining > 0 ? formatTime(remaining / state.settings.wpm) : '—';
  statToday.textContent = state.stats.todayWords;
}

let statsInterval;
function startStatsUpdate() {
  stopStatsUpdate();
  statsInterval = setInterval(() => {
    updateStatsUI();
    saveStats();
  }, 3000);
}

function stopStatsUpdate() {
  if (statsInterval) clearInterval(statsInterval);
}

/* ─────────────────────────────────────────────
   PROGRESS BAR CLICK
   ───────────────────────────────────────────── */
progressBar.addEventListener('click', (e) => {
  const rect = progressBar.getBoundingClientRect();
  const pct = ((e.clientX - rect.left) / rect.width) * 100;
  jumpTo(Math.max(0, Math.min(100, pct)));
});

/* ─────────────────────────────────────────────
   WEB AUDIO ENGINE — PROCEDURAL SOUNDS
   ───────────────────────────────────────────── */
let audioCtx = null;
let masterGain = null;
let activeNodes = [];

function initAudio() {
  if (audioCtx) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      showToast('Tarayıcınız Web Audio desteklemiyor');
      return;
    }
    audioCtx = new AudioCtx();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = (state.audio.muted ? 0 : state.audio.volume / 100) * PROC_AUDIO_GAIN;
    masterGain.connect(audioCtx.destination);
  } catch(e) {
    console.error('AudioContext oluşturulamadı:', e);
    audioCtx = null;
    masterGain = null;
  }
}

function setAudioVolume(vol) {
  state.audio.volume = vol;
  if (masterGain && audioCtx) {
    masterGain.gain.setTargetAtTime(
      (state.audio.muted ? 0 : vol / 100) * PROC_AUDIO_GAIN,
      audioCtx.currentTime, 0.05
    );
  }
  if (bgmStreamEl && bgmStreamEl.src) {
    bgmStreamEl.volume = streamVolume();
  }
  saveAudioPref();
}

function toggleMute() {
  state.audio.muted = !state.audio.muted;
  const icon = state.audio.muted ? '🔇' : '🔊';
  $('#music-mute').textContent = icon;
  const inlineMuteEl = $('#music-mute-inline');
  if (inlineMuteEl) inlineMuteEl.textContent = icon;
  if (masterGain && audioCtx) {
    masterGain.gain.setTargetAtTime(
      state.audio.muted ? 0 : (state.audio.volume / 100) * PROC_AUDIO_GAIN,
      audioCtx.currentTime, 0.05
    );
  }
  if (bgmStreamEl && bgmStreamEl.src) {
    bgmStreamEl.volume = streamVolume();
  }
  saveAudioPref();
}

function stopAllAudio() {
  activeNodes.forEach(n => {
    try { n.stop(); } catch(e) {}
    try { n.disconnect(); } catch(e) {}
  });
  activeNodes = [];
  if (bgmStreamEl) {
    try {
      bgmStreamEl.pause();
      bgmStreamEl.removeAttribute('src');
      bgmStreamEl.load();
    } catch(e) {}
  }
}

function createNoiseBuffer(type, seconds) {
  const sampleRate = audioCtx.sampleRate;
  const length = sampleRate * seconds;
  const buffer = audioCtx.createBuffer(2, length, sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    if (type === 'white') {
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    } else if (type === 'pink') {
      let b0=0, b1=0, b2=0, b3=0, b4=0, b5=0, b6=0;
      for (let i = 0; i < length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else if (type === 'brown') {
      let last = 0;
      for (let i = 0; i < length; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + (0.02 * w)) / 1.02;
        data[i] = last * 3.5;
      }
    }
  }
  return buffer;
}

function playNoise(type, filterType, filterFreq, filterQ) {
  const src = audioCtx.createBufferSource();
  src.buffer = createNoiseBuffer(type, 8);
  src.loop = true;

  if (filterType) {
    const filter = audioCtx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq || 1000;
    if (filterQ) filter.Q.value = filterQ;
    src.connect(filter);
    filter.connect(masterGain);
  } else {
    src.connect(masterGain);
  }

  src.start();
  activeNodes.push(src);
  return src;
}

function playOscillator(freq, type, gain) {
  const osc = audioCtx.createOscillator();
  osc.type = type || 'sine';
  osc.frequency.value = freq;

  const g = audioCtx.createGain();
  g.gain.value = gain || 0.15;

  osc.connect(g);
  g.connect(masterGain);
  osc.start();
  activeNodes.push(osc);
  return { osc, gain: g };
}

function playLFONoise(noiseType, lfoFreq, lfoDepth, filterFreq) {
  const src = audioCtx.createBufferSource();
  src.buffer = createNoiseBuffer(noiseType, 8);
  src.loop = true;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterFreq || 800;

  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = lfoDepth || 0.3;

  const lfo = audioCtx.createOscillator();
  lfo.frequency.value = lfoFreq || 0.1;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);

  src.connect(filter);
  filter.connect(masterGain);
  src.start();
  lfo.start();
  activeNodes.push(src, lfo);
}

const soundGenerators = {
  rain() {
    playNoise('white', 'bandpass', 800, 0.8);
    playNoise('white', 'highpass', 4000, 0.3);
  },
  ocean() {
    playLFONoise('brown', 0.08, 400, 600);
    playLFONoise('white', 0.12, 200, 1200);
  },
  forest() {
    playNoise('pink', 'bandpass', 2000, 0.5);
    playNoise('white', 'highpass', 6000, 0.3);
    const chirp = audioCtx.createOscillator();
    chirp.type = 'sine';
    chirp.frequency.value = 3200;
    const cGain = audioCtx.createGain();
    cGain.gain.value = 0.02;
    const lfo = audioCtx.createOscillator();
    lfo.frequency.value = 2;
    const lfoG = audioCtx.createGain();
    lfoG.gain.value = 0.02;
    lfo.connect(lfoG);
    lfoG.connect(cGain.gain);
    chirp.connect(cGain);
    cGain.connect(masterGain);
    chirp.start(); lfo.start();
    activeNodes.push(chirp, lfo);
  },
  waterfall() {
    playNoise('white', 'lowpass', 3000, 0.3);
    playNoise('brown', 'lowpass', 1500, 0.5);
  },
  cafe() {
    playNoise('brown', 'lowpass', 600, 0.4);
    playNoise('pink', 'bandpass', 1500, 0.3);
  },
  lofi() {
    // Yumuşak vinyl crackle + alçak frekanslı ortam
    playNoise('brown', 'lowpass', 800, 0.6);
    const src = audioCtx.createBufferSource();
    src.buffer = createNoiseBuffer('white', 8);
    src.loop = true;
    const crackleFilter = audioCtx.createBiquadFilter();
    crackleFilter.type = 'bandpass';
    crackleFilter.frequency.value = 4000;
    crackleFilter.Q.value = 0.5;
    const crackleGain = audioCtx.createGain();
    crackleGain.gain.value = 0.018;
    src.connect(crackleFilter);
    crackleFilter.connect(crackleGain);
    crackleGain.connect(masterGain);
    src.start();
    activeNodes.push(src);
  },
  whitenoise() {
    playNoise('white', 'lowpass', 8000);
  },
  brownnoise() {
    playNoise('brown', null);
  },
  storm() {
    // Fırtına: güçlü rüzgar + yağmur + uzak gök gürültüsü
    playNoise('brown', 'lowpass', 500, 0.4);
    playNoise('white', 'bandpass', 1200, 0.6);
    playLFONoise('brown', 0.05, 600, 400);
    // Periyodik gök gürültüsü
    function thunder() {
      if (state.audio.currentSound !== 'storm') return;
      const delay = 8000 + Math.random() * 15000;
      setTimeout(() => {
        if (state.audio.currentSound !== 'storm') return;
        const src2 = audioCtx.createBufferSource();
        src2.buffer = createNoiseBuffer('brown', 3);
        const f = audioCtx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 300;
        const g = audioCtx.createGain();
        const t = audioCtx.currentTime;
        g.gain.setValueAtTime(0.5, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 3);
        src2.connect(f); f.connect(g); g.connect(masterGain);
        src2.start(t); src2.stop(t + 3);
        activeNodes.push(src2);
        thunder();
      }, delay);
    }
    thunder();
  },
  night() {
    // Gece sesleri: cırcır böcekleri + hafif rüzgar
    playNoise('pink', 'highpass', 5000, 0.2);
    playNoise('brown', 'lowpass', 300, 0.3);
    // Cırcır böceği efekti
    function chirp() {
      if (state.audio.currentSound !== 'night') return;
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 3800 + Math.random() * 400;
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.018, t + 0.01);
      g.gain.linearRampToValueAtTime(0, t + 0.08);
      osc.connect(g); g.connect(masterGain);
      osc.start(t); osc.stop(t + 0.1);
      activeNodes.push(osc);
      setTimeout(chirp, 60 + Math.random() * 120);
    }
    chirp();
  },
  fire() {
    // Kamp ateşi: odun çıtırtısı + yumuşak ısı hışırtısı
    playNoise('brown', 'lowpass', 600, 0.5);
    playLFONoise('brown', 0.3, 200, 500);
    function crackle() {
      if (state.audio.currentSound !== 'fire') return;
      const t = audioCtx.currentTime;
      const src2 = audioCtx.createBufferSource();
      src2.buffer = createNoiseBuffer('white', 0.15);
      const f = audioCtx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 800 + Math.random() * 1200;
      const g = audioCtx.createGain();
      const vol = 0.05 + Math.random() * 0.1;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      src2.connect(f); f.connect(g); g.connect(masterGain);
      src2.start(t); src2.stop(t + 0.2);
      activeNodes.push(src2);
      setTimeout(crackle, 200 + Math.random() * 800);
    }
    crackle();
  },
  bowl() {
    function strike() {
      if (state.audio.currentSound !== 'bowl') return;
      [256, 512, 768, 1024].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const g = audioCtx.createGain();
        const t = audioCtx.currentTime;
        const vol = 0.09 / (i + 1);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 8);
        osc.connect(g); g.connect(masterGain);
        osc.start(t); osc.stop(t + 8);
        activeNodes.push(osc);
      });
      setTimeout(strike, 9000);
    }
    strike();
  },
  hz528() {
    playOscillator(528, 'sine', 0.12);
    playOscillator(528 * 2, 'sine', 0.03);
  },
  binaural() {
    // 40 Hz gamma dalga — sol/sağ ayrı kanallarla gerçek binaural
    const leftOsc = audioCtx.createOscillator();
    leftOsc.type = 'sine';
    leftOsc.frequency.value = 200;
    const rightOsc = audioCtx.createOscillator();
    rightOsc.type = 'sine';
    rightOsc.frequency.value = 210; // 10 Hz theta fark
    const merger = audioCtx.createChannelMerger(2);
    const lg = audioCtx.createGain(); lg.gain.value = 0.10;
    const rg = audioCtx.createGain(); rg.gain.value = 0.10;
    leftOsc.connect(lg); lg.connect(merger, 0, 0);
    rightOsc.connect(rg); rg.connect(merger, 0, 1);
    merger.connect(masterGain);
    leftOsc.start(); rightOsc.start();
    activeNodes.push(leftOsc, rightOsc);
  },
  om() {
    playOscillator(136.1, 'sine', 0.10);
    playOscillator(136.1 * 2, 'sine', 0.04);
    playOscillator(136.1 * 3, 'sine', 0.02);
    const lfo = audioCtx.createOscillator();
    lfo.frequency.value = 0.15;
    const lfoG = audioCtx.createGain();
    lfoG.gain.value = 0.03;
    lfo.connect(lfoG);
    activeNodes.forEach(n => {
      if (n.frequency) lfoG.connect(n.frequency);
    });
    lfo.start();
    activeNodes.push(lfo);
  },
};

async function playSound(name) {
  if (isStreamSound(name)) {
    try {
      initAudio();
      if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();
    } catch(e) {}

    stopAllAudio();

    if (state.audio.currentSound === name) {
      state.audio.currentSound = null;
      syncMusicUISelection();
      saveAudioPref();
      return;
    }

    state.audio.currentSound = name;
    syncMusicUISelection();

    if (!bgmStreamEl) {
      showToast('Ses öğesi yüklenemedi');
      return;
    }

    bgmStreamEl.loop = true;
    bgmStreamEl.src = STREAM_URLS[name];
    bgmStreamEl.volume = streamVolume();

    bgmStreamEl.onerror = () => {
      showToast('Müzik yüklenemedi — internet bağlantınızı kontrol edin');
      state.audio.currentSound = null;
      syncMusicUISelection();
    };

    let bgmKickStarted = false;
    const kickBgm = () => {
      if (bgmKickStarted) return;
      bgmKickStarted = true;
      playBgmRobust();
    };
    bgmStreamEl.addEventListener('canplay', kickBgm, { once: true });
    bgmStreamEl.load();
    if (bgmStreamEl.readyState >= 2) kickBgm();

    saveAudioPref();
    return;
  }

  try {
    initAudio();
    if (audioCtx && audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
  } catch(e) {
    console.warn('AudioContext başlatılamadı:', e);
    showToast('Ses sistemi başlatılamadı — tarayıcı izni gerekebilir');
    return;
  }

  stopAllAudio();

  if (state.audio.currentSound === name) {
    state.audio.currentSound = null;
    syncMusicUISelection();
    saveAudioPref();
    return;
  }

  state.audio.currentSound = name;
  syncMusicUISelection();

  if (soundGenerators[name]) {
    try {
      soundGenerators[name]();
    } catch(e) {
      console.error('Ses oluşturma hatası:', e);
      showToast('Ses çalınamadı: ' + name);
    }
  }
  saveAudioPref();
}

function resumeStreamAfterGesture() {
  unlockWebAudioFromGesture();
  if (!bgmStreamEl || !isStreamSound(state.audio.currentSound) || state.audio.muted) return;
  if (!bgmStreamEl.src) return;
  bgmStreamEl.volume = streamVolume();
  playBgmRobust();
}

/* ─────────────────────────────────────────────
   DRAG & DROP
   ───────────────────────────────────────────── */
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

$('#btn-choose-file').addEventListener('click', () => fileInput.click());

/* ─────────────────────────────────────────────
   BUTTON EVENT LISTENERS
   ───────────────────────────────────────────── */
$('#btn-load-text').addEventListener('click', () => {
  const text = textInput.value.trim();
  if (!text) { showToast('Lütfen metin girin'); return; }
  state.fileName = 'Manuel metin';
  loadText(text);
});

/* ── PDF Text Editor Events ── */
$('#btn-auto-fix').addEventListener('click', autoFixText);
$('#btn-remove-hyphens').addEventListener('click', removeHyphens);
$('#btn-remove-pagenum').addEventListener('click', removePageNumbers);
$('#btn-remove-extra-spaces').addEventListener('click', removeExtraSpaces);
$('#btn-remove-headers').addEventListener('click', removeHeaders);
$('#btn-undo-edit').addEventListener('click', editorUndo);

$('#btn-edit-text').addEventListener('click', () => {
  if (!state.fullText) { showToast('Düzenlenecek metin yok'); return; }
  if (state.playing) stopRSVP();
  // If no pdfPages stored, treat as single page
  if (!state.pdfPages.length) {
    state.pdfPages = [];
  }
  openEditor(state.fullText, state.fileName || 'Metin');
});

$('#context-viewer').addEventListener('click', (e) => {
  const el = e.target.closest('[data-idx]');
  if (!el) return;
  const idx = parseInt(el.dataset.idx, 10);
  if (isNaN(idx)) return;
  if (state.playing) stopRSVP();
  state.currentIndex = idx;
  displayCurrentWord();
  updateProgressUI();
  updateContextViewer(true);
  savePosition();
});

$('#btn-find-replace').addEventListener('click', () => {
  const bar = $('#find-replace-bar');
  const visible = bar.style.display !== 'none';
  bar.style.display = visible ? 'none' : 'flex';
  if (!visible) $('#fr-find').focus();
});

$('#fr-find').addEventListener('input', frUpdateCount);
$('#fr-case').addEventListener('change', frUpdateCount);
$('#fr-word').addEventListener('change', frUpdateCount);

$('#fr-btn-replace-one').addEventListener('click', frReplaceOne);
$('#fr-btn-replace-all').addEventListener('click', frReplaceAll);
$('#fr-btn-delete-all').addEventListener('click', frDeleteAll);
$('#fr-btn-close').addEventListener('click', () => {
  $('#find-replace-bar').style.display = 'none';
});

// No-op: textarea is readonly for page preview mode
// $('#editor-textarea').addEventListener('input', updateEditorStats);

$('#btn-editor-read').addEventListener('click', () => {
  let text;
  if (state.pdfPages.length > 0) {
    // Concatenate from selected page onwards
    text = state.pdfPages.slice(state.selectedPageIndex).join('\n\n').trim();
    const preFixed = preCleanPdfPageText(text);
    text = preFixed.text;
  } else {
    text = $('#editor-textarea').value.trim();
  }
  if (!text) { showToast('Metin boş'); return; }
  $('#editor-overlay').classList.remove('active');
  loadText(text);
});

$('#btn-editor-cancel').addEventListener('click', () => {
  $('#editor-overlay').classList.remove('active');
});

$('#btn-close-editor').addEventListener('click', () => {
  $('#editor-overlay').classList.remove('active');
});

/* mousedown+click guard: overlay only closes when BOTH press & release happen on the backdrop */
let _editorMdOnBg = false;
$('#editor-overlay').addEventListener('mousedown', (e) => { _editorMdOnBg = (e.target === $('#editor-overlay')); });
$('#editor-overlay').addEventListener('click', (e) => {
  if (e.target === $('#editor-overlay') && _editorMdOnBg) {
    $('#editor-overlay').classList.remove('active');
  }
  _editorMdOnBg = false;
});

$('#btn-play').addEventListener('click', toggleRSVP);
$('#btn-back').addEventListener('click', () => goBack(5));
$('#btn-forward').addEventListener('click', () => goForward(5));
$('#btn-home').addEventListener('click', () => { navigate('home'); renderLibrary(); });

/* ── Bookmarks ── */
$('#btn-bookmark').addEventListener('click', addBookmark);

$('#btn-bookmark-list').addEventListener('click', () => {
  renderBookmarks();
  $('#bookmarks-overlay').classList.add('active');
});

$('#btn-close-bookmarks').addEventListener('click', () => {
  $('#bookmarks-overlay').classList.remove('active');
});

let _bmMdOnBg = false;
$('#bookmarks-overlay').addEventListener('mousedown', (e) => { _bmMdOnBg = (e.target === $('#bookmarks-overlay')); });
$('#bookmarks-overlay').addEventListener('click', (e) => {
  if (e.target === $('#bookmarks-overlay') && _bmMdOnBg) {
    $('#bookmarks-overlay').classList.remove('active');
  }
  _bmMdOnBg = false;
});

$('#btn-settings').addEventListener('click', () => {
  settingsOvl.classList.add('active');
  window.location.hash = '#settings';
});

$('#btn-close-settings').addEventListener('click', () => {
  settingsOvl.classList.remove('active');
  window.location.hash = '#read';
});

let _setMdOnBg = false;
settingsOvl.addEventListener('mousedown', (e) => { _setMdOnBg = (e.target === settingsOvl); });
settingsOvl.addEventListener('click', (e) => {
  if (e.target === settingsOvl && _setMdOnBg) {
    settingsOvl.classList.remove('active');
    window.location.hash = '#read';
  }
  _setMdOnBg = false;
});

$('#btn-fullscreen').addEventListener('click', () => {
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  }
});

/* Jump buttons */
$$('.jump-btns button').forEach(btn => {
  btn.addEventListener('click', () => jumpTo(parseInt(btn.dataset.jump)));
});

/* Speed slider */
speedSlider.addEventListener('input', () => {
  const v = parseInt(speedSlider.value);
  state.settings.wpm = v;
  speedVal.textContent = v;
  statWpm.textContent = v;
  saveSettings();
  updateStatsUI();
});

/* Font size slider */
fontsizeSlider.addEventListener('input', () => {
  applyFontSize(parseInt(fontsizeSlider.value));
});

/* Pause multiplier slider */
pauseSlider.addEventListener('input', () => {
  state.settings.pauseMultiplier = parseInt(pauseSlider.value);
  pauseVal.textContent = '%' + pauseSlider.value;
  saveSettings();
});

/* Theme buttons */
$$('[data-theme-pick]').forEach(btn => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.themePick));
});

/* Background presets */
$$('.bg-presets button').forEach(btn => {
  btn.addEventListener('click', () => applyBgColor(btn.dataset.bg));
});

bgCustom.addEventListener('input', () => applyBgColor(bgCustom.value));

/* Font buttons */
$$('[data-font]').forEach(btn => {
  btn.addEventListener('click', () => applyFont(btn.dataset.font));
});

/* Chunk buttons */
$$('[data-chunk]').forEach(btn => {
  btn.addEventListener('click', () => applyChunk(parseInt(btn.dataset.chunk)));
});

/* ─────────────────────────────────────────────
   MUSIC PANEL EVENTS
   ───────────────────────────────────────────── */
$('#music-toggle').addEventListener('click', () => {
  musicDrawer.classList.toggle('open');
});

/* Sadece masaüstü panelindeki seçenekler (inline seçenekler aşağıda ayrı bağlanıyor) */
$$('#music-drawer .music-opt').forEach(btn => {
  btn.addEventListener('click', () => playSound(btn.dataset.sound));
});

musicVolume.addEventListener('input', () => {
  const v = parseInt(musicVolume.value);
  volumeValEl.textContent = v;
  setAudioVolume(v);
});

$('#music-mute').addEventListener('click', toggleMute);

document.addEventListener('click', (e) => {
  const panel = $('#music-panel');
  if (!panel.contains(e.target) && musicDrawer.classList.contains('open')) {
    musicDrawer.classList.remove('open');
  }
});

/* ── Inline mobile music button & drawer ── */
const inlineDrawer = $('#music-drawer-inline');
const inlineBackdrop = $('#music-drawer-backdrop');
const inlineVolume = $('#music-volume-inline');
const inlineVolVal = $('#volume-val-inline');

function positionInlineMusicDrawer(mode, anchorEl) {
  if (!inlineDrawer) return;

  if (mode === 'read') {
    inlineDrawer.style.left = '50%';
    inlineDrawer.style.top = '50%';
    inlineDrawer.style.bottom = 'auto';
    inlineDrawer.style.transform = 'translate(-50%, -50%)';
    return;
  }

  if (!anchorEl) return;
  const btnRect = anchorEl.getBoundingClientRect();
  inlineDrawer.style.left = '50%';
  inlineDrawer.style.top = 'auto';
  inlineDrawer.style.bottom = (window.innerHeight - btnRect.top + 8) + 'px';
  inlineDrawer.style.transform = 'translateX(-50%)';
}

function openInlineMusicDrawer(mode, anchorEl) {
  if (!inlineDrawer || !inlineBackdrop) return;
  positionInlineMusicDrawer(mode, anchorEl);
  inlineDrawer.classList.add('open');
  inlineBackdrop.classList.add('open');
  inlineDrawer.querySelectorAll('.music-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.sound === state.audio.currentSound);
  });
  if (inlineVolume) inlineVolume.value = state.audio.volume;
  if (inlineVolVal) inlineVolVal.textContent = state.audio.volume;
  const im = $('#music-mute-inline');
  if (im) im.textContent = state.audio.muted ? '🔇' : '🔊';
}

if ($('#btn-music-home')) {
  $('#btn-music-home').addEventListener('click', () => {
    if (inlineDrawer.classList.contains('open')) closeInlineMusicDrawer();
    else openInlineMusicDrawer('home', $('#btn-music-home'));
  });
}

const btnMusicRead = $('#btn-music-read');
if (btnMusicRead) {
  btnMusicRead.addEventListener('click', () => {
    if (inlineDrawer.classList.contains('open')) closeInlineMusicDrawer();
    else openInlineMusicDrawer('read', btnMusicRead);
  });
}

if (inlineBackdrop) {
  inlineBackdrop.addEventListener('click', closeInlineMusicDrawer);
}

// Inline drawer sound buttons
if (inlineDrawer) {
  inlineDrawer.querySelectorAll('.music-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      playSound(btn.dataset.sound);
      // Sync active states in both drawers
      syncMusicUISelection();
    });
  });
}

// Inline volume
if (inlineVolume) {
  inlineVolume.addEventListener('input', () => {
    const v = parseInt(inlineVolume.value);
    if (inlineVolVal) inlineVolVal.textContent = v;
    musicVolume.value = v;
    volumeValEl.textContent = v;
    setAudioVolume(v);
  });
}

// Inline mute
if ($('#music-mute-inline')) {
  $('#music-mute-inline').addEventListener('click', () => {
    toggleMute();
    $('#music-mute-inline').textContent = state.audio.muted ? '🔇' : '🔊';
  });
}

/* ─────────────────────────────────────────────
   KEYBOARD SHORTCUTS
   ───────────────────────────────────────────── */
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  if (!readScreen.classList.contains('active')) return;

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      toggleRSVP();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      goBack(5);
      break;
    case 'ArrowRight':
      e.preventDefault();
      goForward(5);
      break;
    case 'ArrowUp':
      e.preventDefault();
      speedSlider.value = Math.min(1000, state.settings.wpm + 25);
      speedSlider.dispatchEvent(new Event('input'));
      break;
    case 'ArrowDown':
      e.preventDefault();
      speedSlider.value = Math.max(100, state.settings.wpm - 25);
      speedSlider.dispatchEvent(new Event('input'));
      break;
    case 'KeyF':
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        $('#btn-fullscreen').click();
      }
      break;
    case 'Escape':
      if (inlineDrawer && inlineDrawer.classList.contains('open')) {
        closeInlineMusicDrawer();
        break;
      }
      if (settingsOvl.classList.contains('active')) {
        settingsOvl.classList.remove('active');
        window.location.hash = '#read';
      }
      break;
  }
});

/* ─────────────────────────────────────────────
   TOUCH / SWIPE HANDLING
   ───────────────────────────────────────────── */
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;

const rsvpContainer = $('#rsvp-container');

rsvpContainer.addEventListener('touchstart', (e) => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  touchStartTime = Date.now();
}, { passive: true });

rsvpContainer.addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  const dt = Date.now() - touchStartTime;

  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    if (dx > 0) goBack(5);
    else goForward(5);
  } else if (dt < 300 && Math.abs(dx) < 20 && Math.abs(dy) < 20) {
    toggleRSVP();
  }
}, { passive: true });

/* ─────────────────────────────────────────────
   HASH CHANGE LISTENER
   ───────────────────────────────────────────── */
window.addEventListener('hashchange', () => {
  const hash = window.location.hash;
  if (hash === '#home') navigate('home');
  else if (hash === '#read' && state.words.length) navigate('read');
  else if (hash === '#settings') settingsOvl.classList.add('active');
});

/* ─────────────────────────────────────────────
   AUTO-DETECT SYSTEM THEME
   ───────────────────────────────────────────── */
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state.settings.theme === 'auto') applyTheme('auto');
});

/* ─────────────────────────────────────────────
   VISIBILITY CHANGE — SAVE ON TAB HIDE
   ───────────────────────────────────────────── */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    savePosition();
    saveStats();
    releaseWakeLock();
  } else {
    resumeStreamAfterGesture();
    if (state.playing) requestWakeLock();
  }
});

/* ─────────────────────────────────────────────
   BEFOREUNLOAD — SAVE ALL
   ───────────────────────────────────────────── */
window.addEventListener('beforeunload', () => {
  savePosition();
  saveStats();
  saveAudioPref();
  releaseWakeLock();
});

/* ─────────────────────────────────────────────
   INITIALIZATION
   ───────────────────────────────────────────── */
function syncMusicUISelection() {
  $$('.music-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.sound === state.audio.currentSound);
  });
}

function init() {
  loadSettings();
  loadStats();
  loadAudioPref();
  applyAllSettings();
  renderLibrary();
  handleHash();
  startStatsUpdate();

  document.addEventListener('touchstart', () => {
    unlockWebAudioFromGesture();
    resumeStreamAfterGesture();
  }, { passive: true, capture: true });
  document.addEventListener('pointerdown', () => {
    unlockWebAudioFromGesture();
    resumeStreamAfterGesture();
  }, { capture: true });

  if (state.audio.currentSound && !state.audio.muted) {
    syncMusicUISelection();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service Worker kayıt hatası:', err);
    });
  });
}

})();
