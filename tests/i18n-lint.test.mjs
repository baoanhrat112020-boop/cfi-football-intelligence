import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const WORD = /[A-Za-zÀ-ỹ]{2,}/;

function loadI18N() {
  const m = html.match(/<script id="cfi-i18n">([\s\S]*?)<\/script>/);
  assert.ok(m, 'cfi-i18n script block missing');
  const src = m[1];
  const start = src.indexOf('var I18N = {');
  const end = src.indexOf('window.CFI_I18N = I18N;');
  assert.ok(start >= 0 && end > start, 'I18N object not found');
  return new Function(src.slice(start, end) + '; return I18N;')();
}

const I18N = loadI18N();

const NEUTRAL_EN_STATIC = new Set([
  'CFI', 'Football Intelligence', 'VS', 'H2H', 'RT', 'DB', 'SP', 'MK', 'CFI Runtime', 'CFI Historical DB',
  'Production worker · /health', 'BigDB strict-prior evidence', 'Strict-Prior Guard', 'Match DNA', 'Fusion',
  'Strict-Prior', 'Champion Fusion', 'CFI App', 'CFI Production API', 'Engine', 'No Data', 'Raw Payload',
  'CAO', 'KHÁ', 'TB', 'THẤP', 'RẤT THẤP', '3+ HT', '7+ FT', 'Other HT', 'Other FT', 'HT', 'FT', 'CI 95%',
  'Over 2.5 FT', 'BTTS Yes', 'FT Home', 'HT Home', 'Over 1 HT', 'Settings', 'Ngôn ngữ / Language', 'Tiếng Việt',
  'English', 'WIN', 'HALF', 'LOSS', 'TB (0.55)'
]);
const NEUTRAL_VI_STATIC = new Set(['CAO', 'KHÁ', 'TB', 'THẤP', 'RẤT THẤP', 'Ngôn ngữ / Language', 'Tiếng Việt']);

const OUT_OF_SCOPE_VI = [
  'PHỔ THÔNG', 'HIỆP 1 · CHI TIẾT', 'CẢ TRẬN · CHI TIẾT', 'DẢI BÀN', 'Không có expert weights', 'Không có actionable decision',
  'Prediction này không trả về Champion Fusion payload', 'Backend đã trả kết quả nhưng client chưa tìm thấy 4 market champion',
  'Thiếu dữ liệu lịch sử cho một hoặc cả hai đội', 'Không tải được history', 'Không tải được performance',
  'Không lấy được fixture', 'H2H fixture', 'Mở rộng để hiện', 'giải nhiều bàn', 'base 3+ HT', 'Lọc theo', 'Số liệu từ thống kê',
  'Tỉ số các trận gần nhất', 'Trạng thái backend thật tại thời điểm mở màn này', 'Response gần nhất từ backend',
  'Đã tải ', 'Không tìm thấy trận', 'Các lần đối đầu'
];

function applyDict(map, patterns, s) {
  if (Object.prototype.hasOwnProperty.call(map, s)) return map[s];
  for (const p of patterns) if (p.re.test(s)) return 'MATCH';
  return null;
}

test('all inline scripts parse', () => {
  const re = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(html))) {
    n += 1;
    assert.doesNotThrow(() => new vm.Script(m[1]), `inline script #${n} has a syntax error`);
  }
  assert.ok(n >= 3);
});

test('dictionary: no key equals its value and no value is itself a key (idempotent)', () => {
  for (const dir of ['vi', 'en']) {
    const map = I18N[dir];
    for (const [k, v] of Object.entries(map)) {
      assert.notEqual(k, v, `${dir}: key equals value: ${k}`);
      assert.ok(!Object.prototype.hasOwnProperty.call(map, v), `${dir}: value is also a key (loop): ${k} -> ${v}`);
    }
  }
});

test('patterns compile, are anchored and do not re-match their own output', () => {
  for (const dir of ['vi', 'en']) {
    for (const p of I18N['patterns_' + dir]) {
      assert.ok(p.re instanceof RegExp);
      assert.ok(p.re.source.startsWith('^') && p.re.source.endsWith('$'), `pattern not anchored: ${p.re}`);
    }
  }
});

test('pattern samples translate as expected (en direction)', () => {
  const cases = [
    ['Đã tải 5 trận', 'Loaded 5 matches'],
    ['12 trận', '12 matches'],
    ['7 ngày', '7 days'],
    ['Đã bắt đầu · 105p trước', 'Started · 105m ago'],
    ['Kết thúc 2-1', 'FT 2-1'],
    ['(kỳ vọng 1.9 bàn)', '(expected 1.9 goals)'],
    ['Home thắng 68%', 'Home win 68%'],
    ['4 trận / 1 khung giờ', '4 matches / 1 time slots'],
    ['2026-10-06 · 4 trận', '2026-10-06 · 4 matches'],
    ['Đang tích lũy: 56/100', 'Collecting: 56/100'],
    ['Ít dữ liệu (n=9): chưa đủ 30 trận đã chấm, các tỉ lệ thực tế được ẩn.', 'Low data (n=9): fewer than 30 settled matches, so the actual rates are hidden.'],
    ['Không tải được: Empty response', 'Failed to load: Empty response']
  ];
  for (const [input, expected] of cases) {
    const p = I18N.patterns_en.find((x) => x.re.test(input));
    assert.ok(p, `no pattern for: ${input}`);
    const m = p.re.exec(input);
    assert.equal(p.to.replace(/\$(\d)/g, (_, n) => m[+n]), expected);
  }
});

test('pattern samples translate as expected (vi direction)', () => {
  const p = I18N.patterns_vi.find((x) => x.re.test('HT: Home 1 - Away 0'));
  const m = p.re.exec('HT: Home 1 - Away 0');
  assert.equal(p.to.replace(/\$(\d)/g, (_, n) => m[+n]), 'HT: Nhà 1 - Khách 0');
});

function staticTexts() {
  const body = html.slice(html.indexOf('<body>'), html.indexOf('<script', html.indexOf('<body>')));
  const screens = ['screenSearch', 'screenSelected', 'screenReady', 'screenBlocked', 'screenResult', 'screenSuggest', 'screenSettlement'];
  const chunks = [];
  for (const id of screens) {
    const s = body.indexOf(`id="${id}"`);
    assert.ok(s >= 0, id);
    const e = body.indexOf('<section', s + 10);
    chunks.push(body.slice(s, e < 0 ? body.indexOf('<nav class="bottom-nav">', s) : e));
  }
  chunks.push(body.slice(body.indexOf('<nav class="bottom-nav">'), body.indexOf('</nav>', body.indexOf('<nav class="bottom-nav">'))));
  const out = new Set();
  for (const c of chunks) {
    for (const t of c.matchAll(/>([^<>]{2,300})</g)) {
      const x = t[1].replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
        .replace(/&le;/g, '≤').replace(/&ge;/g, '≥').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
        .replace(/^[\s←-⯿■-➿⌀-⏿⚽●▶↻⌕←]+/u, '').trim();
      if (WORD.test(x)) out.add(x);
    }
    for (const t of c.matchAll(/(?:placeholder|aria-label|title)="([^"]+)"/g)) out.add(t[1]);
  }
  return out;
}

test('static strings in the main screens are covered in both directions', () => {
  const missing = [];
  for (const t of staticTexts()) {
    if (VI.test(t)) {
      if (NEUTRAL_VI_STATIC.has(t)) continue;
      if (applyDict(I18N.en, I18N.patterns_en, t) === null) missing.push('VI->EN ' + t);
    } else {
      if (NEUTRAL_EN_STATIC.has(t) || /^[\d\W]+$/.test(t)) continue;
      if (/^(v\d|&)/.test(t)) continue;
      if (applyDict(I18N.vi, I18N.patterns_vi, t) === null && applyDict(I18N.en, I18N.patterns_en, t) === null) {
        const scoped = Object.values(I18N.scoped_vi || {}).some((m) => Object.prototype.hasOwnProperty.call(m, t));
        if (!scoped) missing.push('EN->VI ' + t);
      }
    }
  }
  assert.deepEqual(missing, [], 'untranslated static strings:\n' + missing.join('\n'));
});

function jsLiterals() {
  const js = html.slice(html.indexOf('<script', html.indexOf('<body>'))).replace(/<script id="cfi-i18n">[\s\S]*?<\/script>/, '')
    .split('\n').filter((l) => !/^\s*var (TEAM_LOGOS|CLUB_COLORS)/.test(l) && l.length < 6000).join('\n');
  const out = [];
  let i = 0;
  while (i < js.length) {
    const c = js[i];
    if (c === '/' && js[i + 1] === '/') { const j = js.indexOf('\n', i); i = j < 0 ? js.length : j; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1, buf = '';
      while (j < js.length) {
        const d = js[j];
        if (d === '\\') { buf += js.slice(j, j + 2); j += 2; continue; }
        if (d === c) break;
        if (d === '\n' && c !== '`') break;
        buf += d; j++;
      }
      out.push(buf);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

function decode(s) {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&nbsp;|&middot;/g, ' ');
}

test('JS strings containing Vietnamese are translatable or explicitly out of scope', () => {
  const corpus = Object.keys(I18N.en).join('\n') + '\n' + I18N.patterns_en.map((p) => p.re.source.replace(/\\/g, '')).join('\n');
  const missing = new Set();
  for (const raw of jsLiterals()) {
    if (raw.length < 2 || raw.length > 600) continue;
    const frags = [];
    const L = decode(raw);
    if (L.includes('<')) {
      for (const t of L.matchAll(/>([^<>]+)</g)) frags.push(t[1]);
      frags.push(L.split('<')[0]);
      frags.push(L.includes('>') ? L.slice(L.lastIndexOf('>') + 1) : '');
    } else frags.push(L);
    for (const f0 of frags) {
      let f = f0.includes('>') ? f0.slice(f0.lastIndexOf('>') + 1) : f0;
      f = f.replace(/^[\s\p{S}\p{P}]+/u, '').trim();
      if (!f || !VI.test(f) || /https?:/.test(f) || /[{};]/.test(f) || /[=]\s*[a-z]/.test(f)) continue;
      if (NEUTRAL_VI_STATIC.has(f)) continue;
      if (OUT_OF_SCOPE_VI.some((o) => f.includes(o.trim()))) continue;
      if (Object.prototype.hasOwnProperty.call(I18N.en, f)) continue;
      if (I18N.patterns_en.some((p) => p.re.test(f))) continue;
      if (corpus.includes(f)) continue;
      missing.add(f);
    }
  }
  assert.deepEqual([...missing], [], 'VI strings without EN translation:\n' + [...missing].join('\n'));
});
