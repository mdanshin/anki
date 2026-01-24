/*
  Minimal AnkiWeb-like client (no server) inspired by the UI style of mdanshin/alias.
  Data is stored locally in the browser.
*/

const APP_VERSION = '2026-01-24';

const WORDS_CONFIG_URL = './words/decks.json';

/** @typedef {'again'|'hard'|'good'|'easy'} Rating */

const STORAGE_KEY = 'ankiweb_like.v1';

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function todayIsoDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function dayNumber(isoDate = todayIsoDate()) {
  // Days since epoch (UTC) to avoid timezone drift.
  const [y, m, d] = isoDate.split('-').map((x) => Number.parseInt(x, 10));
  const ms = Date.UTC(y, (m || 1) - 1, d || 1);
  return Math.floor(ms / 86400000);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeTags(s) {
  const raw = String(s || '').trim();
  if (!raw) return [];
  const tokens = raw.split(/\s+/g).map((t) => t.trim()).filter(Boolean);
  return Array.from(new Set(tokens));
}

function formatCount(n) {
  const v = Number(n) || 0;
  return String(Math.max(0, Math.trunc(v)));
}

const ui = {
  screens: {
    decks: document.getElementById('screenDecks'),
    deck: document.getElementById('screenDeck'),
    add: document.getElementById('screenAdd'),
    review: document.getElementById('screenReview'),
    browse: document.getElementById('screenBrowse'),
    stats: document.getElementById('screenStats'),
  },

  navDecks: document.getElementById('navDecks'),
  navBrowse: document.getElementById('navBrowse'),
  navStats: document.getElementById('navStats'),

  btnReloadWords: document.getElementById('btnReloadWords'),

  btnExport: document.getElementById('btnExport'),
  fileImport: document.getElementById('fileImport'),

  todayPill: document.getElementById('todayPill'),
  btnReviewNow: document.getElementById('btnReviewNow'),
  btnAddDeck: document.getElementById('btnAddDeck'),
  decksList: document.getElementById('decksList'),
  decksCount: document.getElementById('decksCount'),

  deckTitle: document.getElementById('deckTitle'),
  deckSubtitle: document.getElementById('deckSubtitle'),
  btnRenameDeck: document.getElementById('btnRenameDeck'),
  btnDeleteDeck: document.getElementById('btnDeleteDeck'),
  btnDeckReview: document.getElementById('btnDeckReview'),
  btnGoAdd: document.getElementById('btnGoAdd'),
  deckCardsList: document.getElementById('deckCardsList'),
  deckCardsCount: document.getElementById('deckCardsCount'),

  addTitle: document.getElementById('addTitle'),
  addSubtitle: document.getElementById('addSubtitle'),
  selectDeck: document.getElementById('selectDeck'),
  inputTags: document.getElementById('inputTags'),
  inputFront: document.getElementById('inputFront'),
  inputBack: document.getElementById('inputBack'),
  btnSaveNote: document.getElementById('btnSaveNote'),
  btnCancelEdit: document.getElementById('btnCancelEdit'),
  bulkInput: document.getElementById('bulkInput'),
  btnBulkAdd: document.getElementById('btnBulkAdd'),

  reviewContext: document.getElementById('reviewContext'),
  btnExitReview: document.getElementById('btnExitReview'),
  reviewFaceLabel: document.getElementById('reviewFaceLabel'),
  reviewText: document.getElementById('reviewText'),
  reviewActionsQuestion: document.getElementById('reviewActionsQuestion'),
  btnShowAnswer: document.getElementById('btnShowAnswer'),
  reviewActionsAnswer: document.getElementById('reviewActionsAnswer'),
  btnAgain: document.getElementById('btnAgain'),
  btnHard: document.getElementById('btnHard'),
  btnGood: document.getElementById('btnGood'),
  btnEasy: document.getElementById('btnEasy'),
  reviewDoneCard: document.getElementById('reviewDoneCard'),

  browseDeck: document.getElementById('browseDeck'),
  browseQuery: document.getElementById('browseQuery'),
  browseCount: document.getElementById('browseCount'),
  browseList: document.getElementById('browseList'),

  statsGrid: document.getElementById('statsGrid'),
  settingNewPerDay: document.getElementById('settingNewPerDay'),
  settingReviewsPerDay: document.getElementById('settingReviewsPerDay'),
  btnSaveSettings: document.getElementById('btnSaveSettings'),
  btnResetAll: document.getElementById('btnResetAll'),

  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modalTitle'),
  modalText: document.getElementById('modalText'),
  modalField: document.getElementById('modalField'),
  modalFieldLabel: document.getElementById('modalFieldLabel'),
  modalInput: document.getElementById('modalInput'),
};

function fnv1a32Hex(input) {
  const s = String(input || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // >>> 0 ensures uint32
  return (h >>> 0).toString(16).padStart(8, '0');
}

function stableId(prefix, key) {
  return `${prefix}_${fnv1a32Hex(key)}`;
}

function parseWordLines(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n');
  /** @type {{front:string, back:string, tags:string[]}[]} */
  const out = [];
  let skipped = 0;

  for (const line of lines) {
    const s = String(line || '').trim();
    if (!s) continue;
    if (s.startsWith('#')) continue;

    // Prefer tab, then semicolon, then comma.
    let delim = '';
    if (s.includes('\t')) delim = '\t';
    else if (s.includes(';')) delim = ';';
    else if (s.includes(',')) delim = ',';

    if (!delim) {
      skipped += 1;
      continue;
    }

    const parts = s.split(delim);
    const front = String(parts[0] || '').trim();
    const back = String(parts[1] || '').trim();
    const tagsRaw = String(parts[2] || '').trim();
    if (!front || !back) {
      skipped += 1;
      continue;
    }
    out.push({ front, back, tags: normalizeTags(tagsRaw) });
  }

  return { items: out, skipped };
}

async function tryFetchText(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  const res = await fetch(u, { cache: 'no-store' });
  if (!res.ok) return null;
  return await res.text();
}

function deckKeyFromDef(def) {
  const explicit = (def && typeof def === 'object' && 'id' in def) ? String(def.id || '').trim() : '';
  const name = (def && typeof def === 'object' && 'name' in def) ? String(def.name || '').trim() : '';
  return explicit || name;
}

async function syncFromWordFiles({ showAlerts = false } = {}) {
  let cfgText = null;
  try {
    cfgText = await tryFetchText(WORDS_CONFIG_URL);
  } catch (e) {
    if (showAlerts) window.alert(`Не получилось загрузить ${WORDS_CONFIG_URL}.\n\nПроверь что файл существует и сайт открыт через HTTP.`);
    return { ok: false, reason: 'no_config', error: e };
  }

  if (!cfgText) {
    if (showAlerts) window.alert(`Файл ${WORDS_CONFIG_URL} не найден. Создай его и положи рядом папку words/.`);
    return { ok: false, reason: 'no_config' };
  }

  /** @type {any} */
  let cfg;
  try {
    cfg = JSON.parse(cfgText);
  } catch (e) {
    if (showAlerts) window.alert(`Ошибка JSON в ${WORDS_CONFIG_URL}: ${String(e && e.message ? e.message : e)}`);
    return { ok: false, reason: 'bad_config', error: e };
  }

  if (!Array.isArray(cfg)) {
    if (showAlerts) window.alert(`${WORDS_CONFIG_URL} должен быть массивом.`);
    return { ok: false, reason: 'bad_config' };
  }

  let totalAdded = 0;
  let totalUpdated = 0;
  let totalRemoved = 0;
  let totalSkipped = 0;

  for (const def of cfg) {
    if (!def || typeof def !== 'object') continue;
    const name = String(def.name || '').trim();
    const file = String(def.file || '').trim();
    const tagsBase = normalizeTags(String(def.tags || ''));
    const key = deckKeyFromDef(def);
    if (!name || !file || !key) continue;

    const deckId = stableId('deck', `file:${key}`);
    let deck = getDeck(deckId);
    const nowIso = new Date().toISOString();
    if (!deck) {
      deck = { id: deckId, name, createdAt: nowIso, source: { type: 'file', file, key } };
      db.decks.push(deck);
      totalAdded += 1;
    } else {
      // Keep id stable, update name/source.
      deck.name = name;
      /** @type {any} */ (deck).source = { type: 'file', file, key };
    }

    let text = null;
    try {
      text = await tryFetchText(file);
    } catch {
      text = null;
    }
    if (!text) {
      if (showAlerts) window.alert(`Не получилось загрузить файл колоды: ${file}`);
      continue;
    }

    const parsed = parseWordLines(text);
    totalSkipped += parsed.skipped;

    const desiredNoteIds = new Set();
    for (const it of parsed.items) {
      const mergedTags = Array.from(new Set([...(tagsBase || []), ...(it.tags || [])]));
      const noteId = stableId('note', `${deckId}\n${it.front}\n${it.back}`);
      desiredNoteIds.add(noteId);

      const existing = getNote(noteId);
      if (!existing) {
        db.notes.push({
          id: noteId,
          deckId,
          front: it.front,
          back: it.back,
          tags: mergedTags,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        const cardId = stableId('card', noteId);
        db.cards.push({
          id: cardId,
          noteId,
          deckId,
          due: dayNumber(),
          interval: 0,
          ease: 2.5,
          reps: 0,
          lapses: 0,
          state: 'new',
          createdAt: nowIso,
          updatedAt: nowIso,
        });
        totalAdded += 1;
      } else {
        // Keep schedule but ensure fields reflect file.
        const before = `${existing.front}\n${existing.back}\n${(existing.tags || []).join(' ')}`;
        existing.deckId = deckId;
        existing.front = it.front;
        existing.back = it.back;
        existing.tags = mergedTags;
        existing.updatedAt = nowIso;

        const after = `${existing.front}\n${existing.back}\n${(existing.tags || []).join(' ')}`;
        if (before !== after) totalUpdated += 1;

        const card = getCardByNote(noteId);
        if (card) {
          card.deckId = deckId;
          card.updatedAt = nowIso;
        } else {
          // Repair missing card
          db.cards.push({
            id: stableId('card', noteId),
            noteId,
            deckId,
            due: dayNumber(),
            interval: 0,
            ease: 2.5,
            reps: 0,
            lapses: 0,
            state: 'new',
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          totalAdded += 1;
        }
      }
    }

    // Remove notes/cards in this managed deck that are not present in file.
    const noteIdsInDeck = db.notes.filter((n) => n.deckId === deckId).map((n) => n.id);
    const toRemove = noteIdsInDeck.filter((id) => !desiredNoteIds.has(id));
    if (toRemove.length > 0) {
      const rmSet = new Set(toRemove);
      db.notes = db.notes.filter((n) => !rmSet.has(n.id));
      db.cards = db.cards.filter((c) => !rmSet.has(c.noteId));
      totalRemoved += toRemove.length;
    }
  }

  saveDb();

  if (showAlerts) {
    window.alert(`Синхронизация слов из файлов завершена.\n\nДобавлено: ${totalAdded}\nОбновлено: ${totalUpdated}\nУдалено: ${totalRemoved}\nПропущено строк: ${totalSkipped}`);
  }

  return { ok: true, added: totalAdded, updated: totalUpdated, removed: totalRemoved, skipped: totalSkipped };
}

function parseBulkLines(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n');

  /** @type {{front:string, back:string}[]} */
  const pairs = [];
  let skipped = 0;

  for (const line of lines) {
    const s = String(line || '').trim();
    if (!s) continue;
    if (s.startsWith('#')) continue;

    // Prefer tab (Anki export), then semicolon.
    let delim = '';
    if (s.includes('\t')) delim = '\t';
    else if (s.includes(';')) delim = ';';

    if (!delim) {
      skipped += 1;
      continue;
    }

    const idx = s.indexOf(delim);
    const front = s.slice(0, idx).trim();
    const back = s.slice(idx + 1).trim();
    if (!front || !back) {
      skipped += 1;
      continue;
    }
    pairs.push({ front, back });
  }

  return { pairs, skipped };
}

/** @type {{
 *  version: number,
 *  decks: {id:string,name:string,createdAt:string}[],
 *  notes: {id:string,deckId:string,front:string,back:string,tags:string[],createdAt:string,updatedAt:string}[],
 *  cards: {id:string,noteId:string,deckId:string,due:number,interval:number,ease:number,reps:number,lapses:number,state:'new'|'review',createdAt:string,updatedAt:string}[],
 *  log: {id:string,cardId:string,ts:number,rating:Rating,prevDue:number,newDue:number,prevInterval:number,newInterval:number,prevEase:number,newEase:number}[],
 *  settings: {newPerDay:number,reviewsPerDay:number},
 *  daily: Record<string, {total:number, again:number, hard:number, good:number, easy:number}>
 * }} */
let db = emptyDb();

function emptyDb() {
  return {
    version: 1,
    decks: [],
    notes: [],
    cards: [],
    log: [],
    settings: {
      newPerDay: 20,
      reviewsPerDay: 200,
    },
    daily: {},
  };
}

function ensureSeedData() {
  if (db.decks.length > 0) return;
  const deckId = uid('deck');
  const now = new Date().toISOString();
  db.decks.push({ id: deckId, name: 'Default', createdAt: now });

  const noteId = uid('note');
  db.notes.push({
    id: noteId,
    deckId,
    front: 'Anki (web): что это?',
    back: 'Минимальный клон AnkiWeb без сервера (локальные данные).',
    tags: ['demo'],
    createdAt: now,
    updatedAt: now,
  });

  const cardId = uid('card');
  db.cards.push({
    id: cardId,
    noteId,
    deckId,
    due: dayNumber(),
    interval: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
    state: 'new',
    createdAt: now,
    updatedAt: now,
  });

  saveDb();
}

function loadDb() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    db = emptyDb();
    ensureSeedData();
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('bad');
    db = {
      ...emptyDb(),
      ...parsed,
      settings: { ...emptyDb().settings, ...(parsed.settings || {}) },
      decks: Array.isArray(parsed.decks) ? parsed.decks : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      cards: Array.isArray(parsed.cards) ? parsed.cards : [],
      log: Array.isArray(parsed.log) ? parsed.log : [],
      daily: (parsed.daily && typeof parsed.daily === 'object') ? parsed.daily : {},
    };
  } catch {
    db = emptyDb();
  }

  migrateDbIfNeeded();
  ensureSeedData();
  saveDb();
}

function migrateDbIfNeeded() {
  // Reserved for future versions.
  if (!db.version) db.version = 1;
}

function saveDb() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function getDeck(deckId) {
  return db.decks.find((d) => d.id === deckId) || null;
}

function getNote(noteId) {
  return db.notes.find((n) => n.id === noteId) || null;
}

function getCardByNote(noteId) {
  return db.cards.find((c) => c.noteId === noteId) || null;
}

function upsertDaily(rating) {
  const k = todayIsoDate();
  const cur = db.daily[k] || { total: 0, again: 0, hard: 0, good: 0, easy: 0 };
  cur.total += 1;
  cur[rating] = (cur[rating] || 0) + 1;
  db.daily[k] = cur;
}

function computeCounts(deckIdOrNull) {
  const today = dayNumber();
  const cards = deckIdOrNull ? db.cards.filter((c) => c.deckId === deckIdOrNull) : db.cards;
  let due = 0;
  let newCount = 0;
  for (const c of cards) {
    if (c.state === 'new') newCount += 1;
    if (c.due <= today) due += 1;
  }
  return { due, newCount, total: cards.length };
}

function todayLimitsRemaining() {
  const k = todayIsoDate();
  const studied = (db.daily[k] && db.daily[k].total) ? db.daily[k].total : 0;
  // Not a perfect match to Anki, but keeps sessions bounded.
  const max = (db.settings.newPerDay + db.settings.reviewsPerDay);
  return { studied, max: Math.max(0, max), remaining: Math.max(0, max - studied) };
}

function pickReviewQueue(deckIdOrNull) {
  const today = dayNumber();
  const limits = todayLimitsRemaining();
  if (limits.remaining <= 0) return { queue: [], reason: 'limit' };

  const cards = deckIdOrNull ? db.cards.filter((c) => c.deckId === deckIdOrNull) : db.cards;

  // Due first, then new.
  const due = cards
    .filter((c) => c.state === 'review' && c.due <= today)
    .sort((a, b) => a.due - b.due);

  const news = cards
    .filter((c) => c.state === 'new')
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
    .slice(0, Math.max(0, db.settings.newPerDay));

  const dueLimited = due.slice(0, Math.max(0, db.settings.reviewsPerDay));

  const combined = [...dueLimited, ...news].slice(0, limits.remaining);
  return { queue: combined.map((c) => c.id), reason: 'ok' };
}

function applySm2(card, rating) {
  const today = dayNumber();
  const prev = {
    due: card.due,
    interval: card.interval,
    ease: card.ease,
  };

  const reps = Number(card.reps) || 0;
  const lapses = Number(card.lapses) || 0;
  let ease = Number(card.ease) || 2.5;
  let interval = Number(card.interval) || 0;

  // SM-2-like updates.
  const qMap = { again: 1, hard: 3, good: 4, easy: 5 };
  const q = qMap[rating] || 4;

  ease = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  ease = Math.max(1.3, Math.min(2.8, ease));

  if (rating === 'again') {
    card.lapses = lapses + 1;
    interval = 1;
  } else if (reps <= 0) {
    interval = (rating === 'easy') ? 4 : 1;
  } else if (reps === 1) {
    interval = (rating === 'easy') ? 8 : 6;
    if (rating === 'hard') interval = 4;
  } else {
    if (rating === 'hard') interval = Math.max(1, Math.round(interval * 1.2));
    else if (rating === 'good') interval = Math.max(1, Math.round(interval * ease));
    else interval = Math.max(1, Math.round(interval * ease * 1.3));
  }

  card.reps = reps + 1;
  card.ease = ease;
  card.interval = interval;
  card.due = today + interval;
  card.state = 'review';
  card.updatedAt = new Date().toISOString();

  db.log.push({
    id: uid('log'),
    cardId: card.id,
    ts: Date.now(),
    rating,
    prevDue: prev.due,
    newDue: card.due,
    prevInterval: prev.interval,
    newInterval: card.interval,
    prevEase: prev.ease,
    newEase: card.ease,
  });

  upsertDaily(rating);
}

function setActiveNav(path) {
  const set = (el, on) => {
    if (!el) return;
    el.classList.toggle('is-active', !!on);
  };
  set(ui.navDecks, path.startsWith('#/decks') || path.startsWith('#/deck') || path.startsWith('#/add') || path.startsWith('#/review'));
  set(ui.navBrowse, path.startsWith('#/browse'));
  set(ui.navStats, path.startsWith('#/stats'));
}

function setScreen(name) {
  for (const el of Object.values(ui.screens)) {
    if (!el) continue;
    el.hidden = true;
  }
  ui.screens[name].hidden = false;
}

async function promptText({ title, text, label, initial = '' }) {
  if (!ui.modal || !ui.modal.showModal) {
    const v = window.prompt(`${title}\n\n${text}`, initial);
    if (v === null) return null;
    return String(v);
  }

  ui.modalTitle.textContent = title;
  ui.modalText.textContent = text;
  ui.modalField.hidden = false;
  ui.modalFieldLabel.textContent = label;
  ui.modalInput.value = initial;

  ui.modal.showModal();
  const ok = await new Promise((resolve) => {
    ui.modal.addEventListener('close', () => resolve(ui.modal.returnValue === 'ok'), { once: true });
  });
  if (!ok) return null;
  return String(ui.modalInput.value || '');
}

async function confirmDialog({ title, text }) {
  if (!ui.modal || !ui.modal.showModal) return window.confirm(`${title}\n\n${text}`);

  ui.modalTitle.textContent = title;
  ui.modalText.textContent = text;
  ui.modalField.hidden = true;

  ui.modal.showModal();
  const ok = await new Promise((resolve) => {
    ui.modal.addEventListener('close', () => resolve(ui.modal.returnValue === 'ok'), { once: true });
  });
  return !!ok;
}

function renderDecks() {
  const { due, newCount } = computeCounts(null);
  const lim = todayLimitsRemaining();
  ui.todayPill.textContent = `Due: ${formatCount(due)} · New: ${formatCount(newCount)} · Left: ${formatCount(lim.remaining)}`;

  ui.decksCount.textContent = `${db.decks.length} колод`;

  ui.decksList.innerHTML = '';

  const sorted = db.decks.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  for (const d of sorted) {
    const c = computeCounts(d.id);

    const row = document.createElement('div');
    row.className = 'listItem';

    const left = document.createElement('div');
    left.innerHTML = `<div class="listItem__title">${escapeHtml(d.name)}</div><div class="listItem__meta">Due: ${formatCount(c.due)} · New: ${formatCount(c.newCount)} · Всего: ${formatCount(c.total)}</div>`;

    const right = document.createElement('div');
    right.className = 'listItem__right';

    const open = document.createElement('a');
    open.className = 'btn btn--sm';
    open.href = `#/deck/${encodeURIComponent(d.id)}`;
    open.textContent = 'Открыть';

    right.appendChild(open);

    row.appendChild(left);
    row.appendChild(right);

    ui.decksList.appendChild(row);
  }
}

function renderDeck(deckId) {
  const deck = getDeck(deckId);
  if (!deck) {
    location.hash = '#/decks';
    return;
  }

  ui.deckTitle.textContent = deck.name;

  const counts = computeCounts(deckId);
  ui.deckSubtitle.textContent = `Due: ${formatCount(counts.due)} · New: ${formatCount(counts.newCount)} · Всего: ${formatCount(counts.total)}`;

  const notes = db.notes.filter((n) => n.deckId === deckId);
  ui.deckCardsCount.textContent = `${notes.length} карточек`;

  ui.deckCardsList.innerHTML = '';
  for (const note of notes.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))) {
    const card = getCardByNote(note.id);
    const badge = (() => {
      if (!card) return '<span class="badge">—</span>';
      const today = dayNumber();
      if (card.state === 'new') return '<span class="badge badge--new">new</span>';
      if (card.due <= today) return '<span class="badge badge--due">due</span>';
      return '<span class="badge badge--ok">ok</span>';
    })();

    const item = document.createElement('div');
    item.className = 'listItem';

    const left = document.createElement('div');
    left.innerHTML = `<div class="listItem__title">${escapeHtml(note.front).slice(0, 80) || '—'}</div><div class="listItem__meta">${escapeHtml((note.tags || []).join(' '))}</div>`;

    const right = document.createElement('div');
    right.className = 'listItem__right';

    const badgeWrap = document.createElement('div');
    badgeWrap.innerHTML = badge;

    const edit = document.createElement('button');
    edit.className = 'iconBtn';
    edit.type = 'button';
    edit.title = 'Редактировать';
    edit.textContent = '✎';
    edit.addEventListener('click', () => {
      location.hash = `#/add?note=${encodeURIComponent(note.id)}`;
    });

    const del = document.createElement('button');
    del.className = 'iconBtn';
    del.type = 'button';
    del.title = 'Удалить';
    del.textContent = '🗑';
    del.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Удалить карточку?', text: 'Действие необратимо.' });
      if (!ok) return;
      deleteNote(note.id);
      saveDb();
      renderDeck(deckId);
      renderDecks();
    });

    right.appendChild(badgeWrap);
    right.appendChild(edit);
    right.appendChild(del);

    item.appendChild(left);
    item.appendChild(right);

    ui.deckCardsList.appendChild(item);
  }
}

function renderDeckSelect(selectEl, activeDeckIdOrAll) {
  selectEl.innerHTML = '';

  if (activeDeckIdOrAll === '__all__') {
    const opt = document.createElement('option');
    opt.value = '__all__';
    opt.textContent = 'Все колоды';
    selectEl.appendChild(opt);
  }

  const sorted = db.decks.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  for (const d of sorted) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    selectEl.appendChild(opt);
  }

  if (activeDeckIdOrAll) selectEl.value = activeDeckIdOrAll;
}

function renderAddScreen({ deckId, noteId }) {
  const editing = !!noteId;
  ui.addTitle.textContent = editing ? 'Редактирование' : 'Новая карточка';

  renderDeckSelect(ui.selectDeck, deckId || (db.decks[0] ? db.decks[0].id : ''));

  if (editing) {
    const note = getNote(noteId);
    if (!note) {
      location.hash = '#/decks';
      return;
    }
    ui.addSubtitle.textContent = 'Изменения сохранятся сразу.';
    ui.selectDeck.value = note.deckId;
    ui.inputTags.value = (note.tags || []).join(' ');
    ui.inputFront.value = note.front || '';
    ui.inputBack.value = note.back || '';
    ui.btnSaveNote.dataset.noteId = noteId;
  } else {
    ui.addSubtitle.textContent = 'Одна заметка = одна карточка (Basic).';
    ui.inputTags.value = '';
    ui.inputFront.value = '';
    ui.inputBack.value = '';
    ui.btnSaveNote.dataset.noteId = '';
  }
}

function deleteNote(noteId) {
  const note = getNote(noteId);
  if (!note) return;
  db.notes = db.notes.filter((n) => n.id !== noteId);
  db.cards = db.cards.filter((c) => c.noteId !== noteId);
}

function upsertNote({ noteId, deckId, front, back, tags }) {
  const now = new Date().toISOString();

  if (noteId) {
    const note = getNote(noteId);
    if (!note) return null;
    const prevDeckId = note.deckId;

    note.deckId = deckId;
    note.front = front;
    note.back = back;
    note.tags = tags;
    note.updatedAt = now;

    const card = getCardByNote(noteId);
    if (card) {
      card.deckId = deckId;
      card.updatedAt = now;
      // When moving deck, keep schedule.
    }

    // If deck changed, update related state.
    if (prevDeckId !== deckId) {
      // no-op
    }

    return noteId;
  }

  const newNoteId = uid('note');
  db.notes.push({ id: newNoteId, deckId, front, back, tags, createdAt: now, updatedAt: now });

  const newCardId = uid('card');
  db.cards.push({
    id: newCardId,
    noteId: newNoteId,
    deckId,
    due: dayNumber(),
    interval: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
    state: 'new',
    createdAt: now,
    updatedAt: now,
  });

  return newNoteId;
}

function renderBrowse() {
  const deckId = ui.browseDeck.value;
  const q = String(ui.browseQuery.value || '').trim().toLowerCase();

  const deckFilter = (deckId === '__all__') ? null : deckId;
  let notes = deckFilter ? db.notes.filter((n) => n.deckId === deckFilter) : db.notes.slice();

  if (q) {
    notes = notes.filter((n) => {
      const hay = `${n.front || ''}\n${n.back || ''}\n${(n.tags || []).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }

  ui.browseCount.textContent = `${notes.length} записей`;

  ui.browseList.innerHTML = '';
  for (const note of notes.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))) {
    const deck = getDeck(note.deckId);
    const item = document.createElement('div');
    item.className = 'listItem';

    const left = document.createElement('div');
    left.innerHTML = `<div class="listItem__title">${escapeHtml(note.front).slice(0, 80) || '—'}</div><div class="listItem__meta">${escapeHtml(deck ? deck.name : '—')} · ${escapeHtml((note.tags || []).join(' '))}</div>`;

    const right = document.createElement('div');
    right.className = 'listItem__right';

    const edit = document.createElement('button');
    edit.className = 'iconBtn';
    edit.type = 'button';
    edit.title = 'Редактировать';
    edit.textContent = '✎';
    edit.addEventListener('click', () => {
      location.hash = `#/add?note=${encodeURIComponent(note.id)}`;
    });

    right.appendChild(edit);
    item.appendChild(left);
    item.appendChild(right);

    ui.browseList.appendChild(item);
  }
}

function renderStats() {
  const all = computeCounts(null);
  const lim = todayLimitsRemaining();
  const today = todayIsoDate();
  const todayLine = db.daily[today] || { total: 0, again: 0, hard: 0, good: 0, easy: 0 };

  const tiles = [
    { k: 'Due (все колоды)', v: all.due },
    { k: 'New (все колоды)', v: all.newCount },
    { k: 'Изучено сегодня', v: todayLine.total },
    { k: 'Лимит на сегодня', v: lim.max },
    { k: 'Again / Hard', v: `${todayLine.again} / ${todayLine.hard}` },
    { k: 'Good / Easy', v: `${todayLine.good} / ${todayLine.easy}` },
  ];

  ui.statsGrid.innerHTML = '';
  for (const t of tiles) {
    const el = document.createElement('div');
    el.className = 'statTile';
    el.innerHTML = `<div class="statTile__k">${escapeHtml(t.k)}</div><div class="statTile__v">${escapeHtml(String(t.v))}</div>`;
    ui.statsGrid.appendChild(el);
  }

  ui.settingNewPerDay.value = String(db.settings.newPerDay);
  ui.settingReviewsPerDay.value = String(db.settings.reviewsPerDay);
}

// Review session state
let reviewSession = /** @type {{ deckId: string|null, queue: string[], activeCardId: string|null, face: 'front'|'back' } | null} */ (null);

function startReview(deckIdOrNull) {
  const picked = pickReviewQueue(deckIdOrNull);
  reviewSession = {
    deckId: deckIdOrNull,
    queue: picked.queue,
    activeCardId: null,
    face: 'front',
  };

  setScreen('review');
  renderReviewNext();
}

function getCard(cardId) {
  return db.cards.find((c) => c.id === cardId) || null;
}

function renderReviewNext() {
  if (!reviewSession) return;

  ui.reviewDoneCard.hidden = true;
  ui.reviewActionsAnswer.hidden = true;
  ui.reviewActionsQuestion.hidden = false;

  const limits = todayLimitsRemaining();

  if (reviewSession.queue.length === 0 || limits.remaining <= 0) {
    ui.reviewDoneCard.hidden = false;
    ui.reviewFaceLabel.textContent = '—';
    ui.reviewText.textContent = '—';
    ui.reviewActionsQuestion.hidden = true;
    ui.reviewActionsAnswer.hidden = true;
    const contextDeck = reviewSession.deckId ? getDeck(reviewSession.deckId) : null;
    ui.reviewContext.textContent = `${contextDeck ? contextDeck.name : 'Все колоды'} · Left: ${formatCount(limits.remaining)}`;
    return;
  }

  const nextId = reviewSession.queue[0];
  reviewSession.activeCardId = nextId;
  reviewSession.face = 'front';

  const card = getCard(nextId);
  const note = card ? getNote(card.noteId) : null;
  const deck = card ? getDeck(card.deckId) : null;

  ui.reviewContext.textContent = `${deck ? deck.name : '—'} · ${formatCount(reviewSession.queue.length)} left · Today left: ${formatCount(limits.remaining)}`;

  ui.reviewFaceLabel.textContent = 'Вопрос';
  ui.reviewText.textContent = note ? (note.front || '—') : '—';
}

function showAnswer() {
  if (!reviewSession || !reviewSession.activeCardId) return;
  const card = getCard(reviewSession.activeCardId);
  const note = card ? getNote(card.noteId) : null;

  reviewSession.face = 'back';
  ui.reviewFaceLabel.textContent = 'Ответ';
  ui.reviewText.textContent = note ? (note.back || '—') : '—';

  ui.reviewActionsQuestion.hidden = true;
  ui.reviewActionsAnswer.hidden = false;
}

function answer(rating) {
  if (!reviewSession || !reviewSession.activeCardId) return;
  const card = getCard(reviewSession.activeCardId);
  if (!card) return;

  applySm2(card, rating);

  // Pop card and continue
  reviewSession.queue.shift();
  reviewSession.activeCardId = null;
  saveDb();

  renderDecks();
  if (reviewSession.deckId) renderDeck(reviewSession.deckId);
  renderStats();

  renderReviewNext();
}

function parseRoute() {
  const hash = String(location.hash || '#/decks');
  const [path, queryString] = hash.split('?', 2);
  const qs = new URLSearchParams(queryString || '');

  const mDeck = path.match(/^#\/deck\/([^/]+)$/);
  if (mDeck) return { name: 'deck', deckId: decodeURIComponent(mDeck[1]), qs };

  if (path.startsWith('#/add')) {
    const deckId = qs.get('deck') ? String(qs.get('deck')) : null;
    const noteId = qs.get('note') ? String(qs.get('note')) : null;
    return { name: 'add', deckId, noteId, qs };
  }

  if (path.startsWith('#/review')) {
    const deckId = qs.get('deck') ? String(qs.get('deck')) : null;
    return { name: 'review', deckId, qs };
  }

  if (path.startsWith('#/browse')) return { name: 'browse', qs };
  if (path.startsWith('#/stats')) return { name: 'stats', qs };
  return { name: 'decks', qs };
}

function router() {
  const route = parseRoute();
  setActiveNav(String(location.hash || ''));

  if (route.name === 'decks') {
    reviewSession = null;
    setScreen('decks');
    renderDecks();
    return;
  }

  if (route.name === 'deck') {
    reviewSession = null;
    setScreen('deck');
    renderDeck(route.deckId);
    // Wire deck buttons to current deck
    ui.btnGoAdd.onclick = () => (location.hash = `#/add?deck=${encodeURIComponent(route.deckId)}`);
    ui.btnDeckReview.onclick = () => (location.hash = `#/review?deck=${encodeURIComponent(route.deckId)}`);
    ui.btnRenameDeck.onclick = async () => {
      const deck = getDeck(route.deckId);
      if (!deck) return;
      const v = await promptText({
        title: 'Переименовать колоду',
        text: 'Введите новое имя.',
        label: 'Имя',
        initial: deck.name,
      });
      if (v === null) return;
      const name = String(v || '').trim();
      if (!name) return;
      deck.name = name;
      saveDb();
      renderDeck(route.deckId);
      renderDecks();
    };
    ui.btnDeleteDeck.onclick = async () => {
      const deck = getDeck(route.deckId);
      if (!deck) return;
      const ok = await confirmDialog({ title: 'Удалить колоду?', text: 'Все карточки внутри будут удалены.' });
      if (!ok) return;
      // Delete all notes/cards in deck
      const noteIds = new Set(db.notes.filter((n) => n.deckId === route.deckId).map((n) => n.id));
      db.notes = db.notes.filter((n) => n.deckId !== route.deckId);
      db.cards = db.cards.filter((c) => !noteIds.has(c.noteId));
      db.decks = db.decks.filter((d) => d.id !== route.deckId);
      saveDb();
      location.hash = '#/decks';
    };
    return;
  }

  if (route.name === 'add') {
    reviewSession = null;
    setScreen('add');
    renderAddScreen({ deckId: route.deckId, noteId: route.noteId });
    ui.btnCancelEdit.href = route.deckId ? `#/deck/${encodeURIComponent(route.deckId)}` : '#/decks';
    return;
  }

  if (route.name === 'review') {
    setScreen('review');
    startReview(route.deckId);
    return;
  }

  if (route.name === 'browse') {
    reviewSession = null;
    setScreen('browse');
    renderDeckSelect(ui.browseDeck, '__all__');
    renderBrowse();
    return;
  }

  if (route.name === 'stats') {
    reviewSession = null;
    setScreen('stats');
    renderStats();
    return;
  }
}

function setupHandlers() {
  ui.btnAddDeck.addEventListener('click', async () => {
    const name = await promptText({
      title: 'Новая колода',
      text: 'Введите имя колоды.',
      label: 'Имя',
      initial: 'New deck',
    });
    if (name === null) return;
    const clean = String(name || '').trim();
    if (!clean) return;
    db.decks.push({ id: uid('deck'), name: clean, createdAt: new Date().toISOString() });
    saveDb();
    renderDecks();
  });

  if (ui.btnReloadWords) {
    ui.btnReloadWords.addEventListener('click', async () => {
      await syncFromWordFiles({ showAlerts: true });
      renderDecks();
      renderStats();
      // Re-render current screen if needed
      const route = parseRoute();
      if (route.name === 'deck') renderDeck(route.deckId);
      if (route.name === 'browse') renderBrowse();
    });
  }

  ui.btnReviewNow.addEventListener('click', () => {
    location.hash = '#/review';
  });

  ui.btnSaveNote.addEventListener('click', () => {
    const deckId = String(ui.selectDeck.value || '').trim();
    const front = String(ui.inputFront.value || '').trim();
    const back = String(ui.inputBack.value || '').trim();
    const tags = normalizeTags(ui.inputTags.value);
    const noteId = String(ui.btnSaveNote.dataset.noteId || '').trim() || null;

    if (!deckId) return;
    if (!front || !back) {
      window.alert('Нужно заполнить Front и Back.');
      return;
    }

    const savedId = upsertNote({ noteId, deckId, front, back, tags });
    if (!savedId) return;

    saveDb();
    renderDecks();

    location.hash = `#/deck/${encodeURIComponent(deckId)}`;
  });

  if (ui.btnBulkAdd && ui.bulkInput) {
    ui.btnBulkAdd.addEventListener('click', () => {
      const deckId = String(ui.selectDeck.value || '').trim();
      const tags = normalizeTags(ui.inputTags.value);
      const bulk = String(ui.bulkInput.value || '');

      if (!deckId) return;
      if (!bulk.trim()) {
        window.alert('Вставь список строк (front\\tback или front;back).');
        return;
      }

      const { pairs, skipped } = parseBulkLines(bulk);
      if (pairs.length === 0) {
        window.alert(`Не нашёл ни одной валидной строки. Пример: house\\tдом (tab) или house;дом. Пропущено строк: ${skipped}.`);
        return;
      }

      let added = 0;
      for (const p of pairs) {
        const id = upsertNote({ noteId: null, deckId, front: p.front, back: p.back, tags });
        if (id) added += 1;
      }

      saveDb();
      renderDecks();
      window.alert(`Добавлено: ${added}. Пропущено строк: ${skipped}.`);
      ui.bulkInput.value = '';
      location.hash = `#/deck/${encodeURIComponent(deckId)}`;
    });
  }

  ui.btnExitReview.addEventListener('click', () => {
    location.hash = '#/decks';
  });

  ui.btnShowAnswer.addEventListener('click', () => showAnswer());
  ui.btnAgain.addEventListener('click', () => answer('again'));
  ui.btnHard.addEventListener('click', () => answer('hard'));
  ui.btnGood.addEventListener('click', () => answer('good'));
  ui.btnEasy.addEventListener('click', () => answer('easy'));

  ui.browseDeck.addEventListener('change', () => renderBrowse());
  ui.browseQuery.addEventListener('input', () => renderBrowse());

  ui.btnSaveSettings.addEventListener('click', () => {
    const n = clamp(Number.parseInt(String(ui.settingNewPerDay.value), 10) || 0, 0, 999);
    const r = clamp(Number.parseInt(String(ui.settingReviewsPerDay.value), 10) || 0, 0, 9999);
    db.settings.newPerDay = n;
    db.settings.reviewsPerDay = r;
    saveDb();
    renderStats();
    renderDecks();
    window.alert('Сохранено.');
  });

  ui.btnResetAll.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Сбросить всё?', text: 'Будут удалены все колоды/карточки и статистика.' });
    if (!ok) return;
    db = emptyDb();
    ensureSeedData();
    saveDb();
    location.hash = '#/decks';
  });

  ui.btnExport.addEventListener('click', () => {
    const payload = JSON.stringify({ appVersion: APP_VERSION, exportedAt: new Date().toISOString(), data: db }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `anki-export-${todayIsoDate()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  ui.fileImport.addEventListener('change', async () => {
    const file = ui.fileImport.files && ui.fileImport.files[0];
    ui.fileImport.value = '';
    if (!file) return;

    let text = '';
    try {
      text = await file.text();
    } catch {
      window.alert('Не получилось прочитать файл.');
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      window.alert('Это не JSON.');
      return;
    }

    const incoming = parsed && parsed.data ? parsed.data : parsed;
    if (!incoming || typeof incoming !== 'object') {
      window.alert('Неверный формат экспорта.');
      return;
    }

    const ok = await confirmDialog({ title: 'Импорт', text: 'Импорт заменит текущие данные (overwrite). Продолжить?' });
    if (!ok) return;

    db = { ...emptyDb(), ...incoming };
    migrateDbIfNeeded();
    ensureSeedData();
    saveDb();

    location.hash = '#/decks';
  });
}

function initBackground() {
  const canvas = document.getElementById('bg');
  if (!canvas) return;

  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!ctx) return;

  const prefersReducedMotion = (() => {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  })();

  const lights = [];
  let W = 0;
  let H = 0;
  let DPR = 1;

  function resize() {
    DPR = clamp(window.devicePixelRatio || 1, 1, 2);
    W = Math.max(320, window.innerWidth || 320);
    H = Math.max(240, window.innerHeight || 240);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    lights.length = 0;
    if (prefersReducedMotion) return;

    const area = W * H;
    const count = area > 2_000_000 ? 60 : 80;

    for (let i = 0; i < count; i++) {
      const pick = Math.random();
      const palette = (pick < 0.4) ? [96, 165, 250] : (pick < 0.7) ? [34, 197, 94] : [124, 58, 237];
      lights.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 60 + Math.random() * 220,
        vx: (Math.random() * 2 - 1) * (3 + Math.random() * 6),
        vy: (Math.random() * 2 - 1) * (2 + Math.random() * 5),
        a: 0.04 + Math.random() * 0.12,
        c: palette,
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Subtle dark wash so bokeh reads on top of CSS background.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(6, 9, 22, 0.38)';
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = 'screen';
    for (const L of lights) {
      const g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
      g.addColorStop(0, `rgba(${L.c[0]},${L.c[1]},${L.c[2]},${L.a})`);
      g.addColorStop(1, `rgba(${L.c[0]},${L.c[1]},${L.c[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(L.x, L.y, L.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  let last = performance.now();
  function tick(now) {
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;

    if (!prefersReducedMotion) {
      for (const L of lights) {
        L.x += L.vx * dt * 0.2;
        L.y += L.vy * dt * 0.2;
        if (L.x < -L.r) L.x = W + L.r;
        if (L.x > W + L.r) L.x = -L.r;
        if (L.y < -L.r) L.y = H + L.r;
        if (L.y > H + L.r) L.y = -L.r;
      }
    }

    draw();
    requestAnimationFrame(tick);
  }

  window.addEventListener('resize', () => resize());
  resize();
  requestAnimationFrame(tick);
}

async function boot() {
  console.info(`Anki (web) version: ${APP_VERSION}`);
  loadDb();

  // Best-effort: if words/decks.json exists, use it as a source of truth.
  try {
    await syncFromWordFiles({ showAlerts: false });
  } catch {
    // ignore
  }

  initBackground();
  setupHandlers();

  window.addEventListener('hashchange', router);

  // Default route
  if (!location.hash) location.hash = '#/decks';
  router();
}

void boot();
