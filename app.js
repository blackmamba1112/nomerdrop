/* ============================================================
   NOMERDROP — gacha российских номерных знаков
   Telegram Mini App: CloudStorage + localStorage fallback
============================================================ */

/* ================== CONFIG ================== */
// Сумма весов должна быть 100% (60 + 20 + 14.5 + 5 + 0.5 = 100)
const DEFAULT_CONFIG = {
  startCoins: 500,
  price: 50,          // цена выбивания
  bonus: 100,         // ежедневный бонус
  weights: { common: 60, rare: 20, legendary: 14.5, mythic: 5, exclusive: 0.5 },
  regions: [77, 97, 99, 177, 197, 199, 750, 790, 797, 116, 102, 16, 163, 66, 23, 61],
  exclusives: [
    { num: 'О000ОО 99', name: 'Господин Ноль', lore: 'Единственный в своём роде. Говорят, за этот номер отдали целое состояние и всю ego.', value: 2000 },
    { num: 'Е001ХА 77', name: 'Император', lore: 'Первый среди первых. Носится только на самых чёрных лимузинах.', value: 2000 },
    { num: 'А777АА 77', name: 'Тройная Семёрка', lore: 'Джекпот, пойманный на дороге. Владелец не паркуется там, где хочется.', value: 2000 },
    { num: 'Х666ХХ 97', name: 'Валик', lore: 'Номер, который боятся поворачивать задом наперёд.', value: 2000 },
    { num: 'М007ММ 99', name: 'Агент', lore: 'Секретный номер. Никто не знает, кто на нём ездит.', value: 2000 }
  ]
};

// Пароль по умолчанию 2005, смените хеш в config.
// Хранится только SHA-256 — админ-защита в HTML-приложении без бэкенда УСЛОВНАЯ:
// настройки лежат локально у игрока и видны в devtools.
const ADMIN_HASH = 'a20a2b7bb0842d5cf8a0c06c626421fd51ec103925c1819a51271f2779afa730';

const RARITY_INFO = {
  common:    { name: 'Обычный',      color: 'var(--r-common)',    value: 10 },
  rare:      { name: 'Редкий',       color: 'var(--r-rare)',      value: 50 },
  legendary: { name: 'Легендарный',  color: 'var(--r-legendary)', value: 150 },
  mythic:    { name: 'Мифический',   color: 'var(--r-mythic)',    value: 500 },
  exclusive: { name: 'Эксклюзивный', color: 'var(--r-exclusive)', value: 2000 }
};
const RARITY_ORDER = ['common', 'rare', 'legendary', 'mythic', 'exclusive'];

/* ================== TELEGRAM ================== */
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) {
  try { tg.ready(); tg.expand(); } catch (e) {}
  document.body.dataset.theme = tg.colorScheme || 'dark';
  if (tg.onEvent) tg.onEvent('themeChanged', () => { document.body.dataset.theme = tg.colorScheme || 'dark'; });
}
function haptic(kind) {
  if (tg && tg.HapticFeedback) {
    try { tg.HapticFeedback.impactOccurred(kind); } catch (e) {}
  }
}

/* ================== ХРАНИЛИЩЕ ================== */
// Основной вариант — CloudStorage (1024 элемента на пользователя), резерв — localStorage
function cloudGet(key) {
  return new Promise((resolve) => {
    if (tg && tg.CloudStorage) tg.CloudStorage.getItem(key, v => resolve(v));
    else resolve(null);
  });
}
function cloudSet(key, val) {
  return new Promise((resolve) => {
    if (tg && tg.CloudStorage) tg.CloudStorage.setItem(key, val, () => resolve());
    else resolve();
  });
}
let saveTimer = null;
function saveState() {
  const json = JSON.stringify({ ...state, config: cfg });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await cloudSet('nomerdrop_save', json);            // основной вариант
    try { localStorage.setItem('nomerdrop_save', json); } catch (e) {} // резерв
  }, 300);
}

/* ================== СОСТОЯНИЕ ================== */
let cfg = structuredClone(DEFAULT_CONFIG);
let state = {
  coins: cfg.startCoins,
  collection: [],        // [{num, rarity, count, ts}]
  lastBonus: 0,
  stats: { totalRolls: 0, spent: 0, earned: 0, byRarity: { common: 0, rare: 0, legendary: 0, mythic: 0, exclusive: 0 } }
};

async function loadState() {
  let raw = await cloudGet('nomerdrop_save');
  if (!raw) { try { raw = localStorage.getItem('nomerdrop_save'); } catch (e) {} }
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.state) { state = { ...state, ...parsed.state }; cfg = { ...structuredClone(DEFAULT_CONFIG), ...(parsed.config || {}) }; }
    } catch (e) {}
  }
}

/* ================== ГЕНЕРАЦИЯ НОМЕРОВ ================== */
// Допустимые буквы ГРЗ (ГОСТ Р 50577)
const LETTERS = ['А', 'В', 'Е', 'К', 'М', 'Н', 'О', 'Р', 'С', 'Т', 'У', 'Х'];
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rndLetter = () => rnd(LETTERS);
const rndDigits = () => String(Math.floor(Math.random() * 1000)).padStart(3, '0');
const rndRegion = () => rnd(cfg.regions);

// Редкие: тройные буквы (ААА) или зеркальные цифры (121, 424…)
const MIRROR_DIGITS = ['121', '424', '707', '919', '262', '353', '484', '848'];
// Легендарные: 777, 007 и трёхзначные палиндромы
const LEGEND_DIGITS = ['777', '007', '101', '111', '202', '303', '505', '606', '808', '909'];
// Мифические: нули, шестёрки, девятки + тройные буквы
const MYTHIC_DIGITS = ['000', '666', '999'];

function generateNumber(rarity) {
  if (rarity === 'exclusive') {
    const ex = rnd(cfg.exclusives);
    return { num: ex.num, name: ex.name, lore: ex.lore };
  }
  let d = rndDigits(), l1 = rndLetter(), l2 = rndLetter(), l3 = rndLetter();
  if (rarity === 'rare') {
    if (Math.random() < 0.5) l2 = l1 === l3 ? l1 : rndLetter(), l2 = l1; // серия букв ААА
    else d = rnd(MIRROR_DIGITS);
  }
  if (rarity === 'legendary') d = rnd(LEGEND_DIGITS);
  if (rarity === 'mythic') { d = rnd(MYTHIC_DIGITS); l2 = l1; l3 = l1; }
  return { num: `${l1}${d}${l2}${l3} ${rndRegion()}` };
}

/* ================== ВЗВЕШЕННЫЙ РАНДОМ ================== */
function pickRarity() {
  const w = cfg.weights; // сумма весов должна быть 100%
  let roll = Math.random() * 100, acc = 0;
  for (const r of RARITY_ORDER) { acc += w[r]; if (roll < acc) return r; }
  return 'common'; // страховка от ошибок округления
}

/* ================== РОЛЛ ================== */
function roll() {
  if (state.coins < cfg.price) { haptic('error'); return; }
  state.coins -= cfg.price;
  state.stats.spent += cfg.price;
  const rarity = pickRarity();
  const gen = generateNumber(rarity);
  state.stats.totalRolls++;
  state.stats.byRarity[rarity]++;

  const existing = state.collection.find(c => c.num === gen.num);
  let isDupe = false, payout = 0;
  if (existing) {
    isDupe = true;
    existing.count++;
    payout = Math.floor(RARITY_INFO[existing.rarity].value * 0.5);
    state.coins += payout;
    state.stats.earned += payout;
  } else {
    state.collection.push({ num: gen.num, rarity, count: 1, ts: Date.now(), name: gen.name, lore: gen.lore });
  }
  saveState();
  haptic(rarity === 'legendary' || rarity === 'mythic' || rarity === 'exclusive' ? 'heavy' : 'light');
  showRollAnimation(rarity, gen, isDupe, payout);
  renderAll();
}

/* ================== ОТРИСОВКА КАРТОЧКИ ================== */
function plateHTML(numStr, size) {
  // "О000ОО 99" → [О000ОО, 99]
  const [main, region = ''] = numStr.split(' ');
  return `<div class="plate ${size}"><span class="plate-line">${main}</span><span class="plate-region">${region}</span></div>`;
}
function cardHTML(item, size) {
  const info = RARITY_INFO[item.rarity];
  const particles = (item.rarity === 'mythic' || item.rarity === 'exclusive')
    ? Array.from({ length: 8 }, (_, i) =>
        `<span class="particle" style="left:${10 + i * 10}%;bottom:8px;background:${i % 2 ? 'var(--pink)' : 'var(--purple)'};--dx:${(Math.random() * 60 - 30) | 0}px;animation-delay:${i * 0.2}s"></span>`).join('')
    : '';
  return `<div class="card ${item.rarity}">
    ${item.count > 1 ? `<span class="badge-x2">x${item.count}</span>` : ''}
    ${particles}
    ${plateHTML(item.num, size)}
    <div class="rarity-name" style="color:${info.color}">${item.name || info.name}</div>
  </div>`;
}

/* ================== АНИМАЦИЯ ВЫПАДЕНИЯ ================== */
function showRollAnimation(rarity, gen, isDupe, payout) {
  const overlay = document.getElementById('rollOverlay');
  const box = document.getElementById('mysteryBox');
  const scene = document.getElementById('rollScene');
  const cardSlot = document.getElementById('rollCard');
  const meta = document.getElementById('rollMeta');
  const flash = document.getElementById('flash');
  const info = RARITY_INFO[rarity];

  overlay.hidden = false; scene.hidden = true; box.hidden = false;
  box.style.animation = 'none'; void box.offsetWidth; box.style.animation = 'boxShake .6s ease';

  setTimeout(() => {
    flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on');
    box.hidden = true; scene.hidden = false;
    const item = { num: gen.num, rarity, count: 1, name: gen.name, lore: gen.lore };
    cardSlot.innerHTML = `<div class="flip-scene">${cardHTML(item, 'big-plate')}</div>`;
    cardSlot.style.animation = 'none'; void cardSlot.offsetWidth; cardSlot.style.animation = 'cardFlip .9s ease';
    meta.innerHTML = `
      <div class="rarity-title" style="color:${info.color}">${info.name}${isDupe ? ' · дубль!' : ''}</div>
      ${gen.lore ? `<div class="lore">«${gen.lore}»</div>` : ''}
      <div class="value">${isDupe ? `Компенсация +${payout} ◉ (50% ценности)` : `+${info.value} ◉ в коллекцию`}</div>`;
    if (rarity === 'exclusive') { document.body.animate([{ filter: 'brightness(3)' }, { filter: 'brightness(1)' }], { duration: 400 }); }
  }, 650);
}

/* ================== ЭКРАНЫ ================== */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.screen === id));
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showScreen(t.dataset.screen)));

function renderHome() {
  document.getElementById('coinBalance').textContent = state.coins;
  document.getElementById('btnRoll').textContent = `ВЫБИТЬ НОМЕР — ${cfg.price} ◉`;
  document.getElementById('btnRoll').disabled = state.coins < cfg.price;
  const uniq = state.collection.length;
  document.getElementById('quickStats').innerHTML =
    `<div><b>${uniq}</b>уникальных</div><div><b>${state.stats.totalRolls}</b>выбито</div><div><b>${totalCollectionValue()}</b>◉ стоимость</div>`;
}
function totalCollectionValue() {
  return state.collection.reduce((s, c) => s + RARITY_INFO[c.rarity].value * c.count, 0);
}
function renderCollection() {
  const filter = document.querySelector('.chip.active').dataset.r;
  const items = filter === 'all' ? state.collection : state.collection.filter(c => c.rarity === filter);
  document.getElementById('collGrid').innerHTML = items.length
    ? items.slice().sort((a, b) => RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity)).map(c => cardHTML(c, 'md-plate')).join('')
    : '<div class="empty-msg">Пока пусто. Сходи выбить первый номер!</div>';
  const uniq = state.collection.length;
  document.getElementById('collStats').textContent =
    `Собрано ${uniq} из ${state.stats.totalRolls} выпадений · общая стоимость ${totalCollectionValue()} ◉`;
}
document.getElementById('collFilter').addEventListener('click', (e) => {
  if (!e.target.classList.contains('chip')) return;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  e.target.classList.add('active');
  renderCollection();
});

function renderTop() {
  const dist = state.stats.byRarity;
  document.getElementById('topContent').innerHTML =
    RARITY_ORDER.map(r => `<div class="stat-row"><span style="color:${RARITY_INFO[r].color}">${RARITY_INFO[r].name}</span><b>${dist[r]}</b></div>`).join('') +
    `<div class="stat-row"><span>Всего выбито</span><b>${state.stats.totalRolls}</b></div>
     <div class="stat-row"><span>Потрачено</span><b>${state.stats.spent} ◉</b></div>
     <div class="stat-row"><span>Получено с дублей</span><b>${state.stats.earned} ◉</b></div>`;
}

function renderOdds() {
  const examples = RARITY_ORDER.map(r => {
    const ex = r === 'exclusive' ? cfg.exclusives[0].num : generateNumber(r).num;
    return `<tr><td style="color:${RARITY_INFO[r].color}">${RARITY_INFO[r].name}</td>
      <td>${cfg.weights[r]}%</td><td><div class="odds-plate">${plateHTML(ex, 'sm-plate')}</div></td>
      <td>${RARITY_INFO[r].value} ◉</td></tr>`;
  }).join('');
  document.getElementById('oddsTable').innerHTML =
    `<tr><th>Редкость</th><th>Шанс</th><th>Пример</th><th>Ценность</th></tr>${examples}`;
}

function renderAll() { renderHome(); renderCollection(); renderTop(); renderOdds(); }

/* ================== ЕЖЕДНЕВНЫЙ БОНУС ================== */
const DAY = 24 * 60 * 60 * 1000;
function bonusReady() { return Date.now() - state.lastBonus >= DAY; }
function renderBonus() {
  const btn = document.getElementById('btnBonus'), timer = document.getElementById('bonusTimer');
  if (bonusReady()) { btn.disabled = false; timer.textContent = 'готово!'; return; }
  btn.disabled = true;
  const left = DAY - (Date.now() - state.lastBonus);
  const h = Math.floor(left / 3600000), m = Math.floor(left % 3600000 / 60000), s = Math.floor(left % 60000 / 1000);
  timer.textContent = `через ${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
setInterval(renderBonus, 1000);
document.getElementById('btnBonus').addEventListener('click', () => {
  if (!bonusReady()) return;
  state.coins += cfg.bonus; state.lastBonus = Date.now();
  haptic('medium'); saveState(); renderAll();
});

/* ================== АДМИНКА ================== */
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
let tapCount = 0, tapTimer = null;
document.getElementById('headerLogo').addEventListener('click', () => {
  clearTimeout(tapTimer); tapCount++;
  tapTimer = setTimeout(() => tapCount = 0, 2000);
  if (tapCount >= 5) { tapCount = 0; openAdmin(); }
});
function openAdmin() {
  document.getElementById('adminOverlay').hidden = false;
  document.getElementById('adminLogin').hidden = false;
  document.getElementById('adminPanel').hidden = true;
  document.getElementById('adminErr').textContent = '';
  document.getElementById('adminPass').value = '';
}
document.getElementById('adminEnter').addEventListener('click', async () => {
  const hash = await sha256(document.getElementById('adminPass').value.trim());
  if (hash === ADMIN_HASH) {
    document.getElementById('adminLogin').hidden = true;
    renderAdminPanel();
  } else {
    document.getElementById('adminErr').textContent = 'Неверный пароль';
    haptic('error');
  }
});
function renderAdminPanel() {
  document.getElementById('adminPanel').hidden = false;
  const total = state.stats.totalRolls;
  document.getElementById('adminStats').innerHTML =
    `Всего выбито: <b>${total}</b> · ${RARITY_ORDER.map(r =>
      `${RARITY_INFO[r].name}: ${state.stats.byRarity[r]} (${total ? (state.stats.byRarity[r] / total * 100).toFixed(1) : 0}%)`).join(' · ')}`;
  document.getElementById('adminWeights').innerHTML = RARITY_ORDER.map(r =>
    `<label>${RARITY_INFO[r].name}: <input type="number" step="0.5" class="adm-w" data-r="${r}" value="${cfg.weights[r]}"></label>`).join('');
  document.getElementById('admPrice').value = cfg.price;
  document.getElementById('admBonus').value = cfg.bonus;
  document.querySelectorAll('.adm-w').forEach(i => i.addEventListener('input', checkWeightSum));
  checkWeightSum();
}
function checkWeightSum() {
  const sum = [...document.querySelectorAll('.adm-w')].reduce((s, i) => s + (+i.value || 0), 0);
  const el = document.getElementById('weightSum');
  el.textContent = `Сумма шансов: ${sum}% ${sum === 100 ? '✓' : '— должна быть ровно 100%'}`;
  el.className = 'sum-check ' + (sum === 100 ? 'ok' : 'bad');
}
document.getElementById('admSaveCfg').addEventListener('click', () => {
  const w = {}; RARITY_ORDER.forEach(r => { w[r] = +document.querySelector(`.adm-w[data-r="${r}"]`).value || 0; });
  if (Object.values(w).reduce((a, b) => a + b, 0) !== 100) { haptic('error'); return; }
  cfg.weights = w;
  cfg.price = Math.max(1, +document.getElementById('admPrice').value || cfg.price);
  cfg.bonus = Math.max(0, +document.getElementById('admBonus').value || cfg.bonus);
  saveState(); renderAll(); haptic('medium');
});
document.getElementById('exAdd').addEventListener('click', () => {
  const num = document.getElementById('exNum').value.trim().toUpperCase();
  const name = document.getElementById('exName').value.trim();
  const lore = document.getElementById('exLore').value.trim();
  const value = +document.getElementById('exVal').value || 2000;
  if (!/\d/.test(num)) return;
  cfg.exclusives.push({ num, name, lore, value });
  saveState();
  document.getElementById('exNum').value = document.getElementById('exName').value = document.getElementById('exLore').value = '';
  haptic('medium');
});
document.getElementById('brandkitBtn').addEventListener('click', () => {
  renderBanner2Cards();
  document.getElementById('brandOverlay').hidden = false;
});
function renderBanner2Cards() {
  document.getElementById('banner2Cards').innerHTML =
    RARITY_ORDER.slice(0, 5).map(r => cardHTML({ num: generateNumber(r).num, rarity: r, count: 1 }, 'sm-plate')).join('');
}
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', (e) => {
  const target = e.target.dataset.close === 'brandOverlay' ? 'brandOverlay' : 'adminOverlay';
  document.getElementById(target).hidden = true;
}));
document.getElementById('rollClose').addEventListener('click', () => { document.getElementById('rollOverlay').hidden = true; });

/* ================== СТАРТ ================== */
document.getElementById('btnRoll').addEventListener('click', roll);
(async () => {
  await loadState();
  renderAll(); renderBonus();
})();
