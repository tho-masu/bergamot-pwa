// Nagi — Bergamot (Firefox Translations と同一エンジン) をローカルで動かす翻訳 PWA
//
// エンジン: vendor/translator.js       (@browsermt/bergamot-translator)
// モデル:   models/registry.json + models/<pair>/*   (mozilla/firefox-translations-models)
// どちらも setup.sh が配置します。テキストは一切ネットワークに出ません。

const REGISTRY_URL = new URL('./models/registry.json', location.href).href;
const WORKER_URL   = new URL('./vendor/worker/translator-worker.js', location.href).href;

const $ = (id) => document.getElementById(id);
const el = {
  from: $('from'), to: $('to'), swap: $('swap'), badge: $('badge'),
  src: $('src'), out: $('out'), count: $('count'), latency: $('latency'),
  clear: $('clear'), copy: $('copy'), paste: $('paste'),
  status: $('status'), dot: $('dot'), meter: $('meter'), fill: $('fill'),
};

const NAMES = new Intl.DisplayNames(['ja'], { type: 'language' });
const label = (code) => { try { return NAMES.of(code) || code; } catch { return code; } };

let translator = null;
let pairs = [];          // registry の {from, to} 一覧
let seq = 0;             // 直近リクエストだけを描画するための通し番号

/* ---------- 状態表示 ---------- */

function setState(state, message, percent) {
  const text = { wait: '準備中', dl: '取得中', ready: '待機中', err: 'エラー' }[state] ?? state;
  el.badge.textContent = text;
  el.badge.className = `badge badge--${state}`;
  el.dot.dataset.state = state;
  if (message) el.status.textContent = message;

  if (typeof percent === 'number') {
    el.meter.hidden = false;
    el.fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  } else {
    el.meter.hidden = true;
  }
}

function showOutput(text) {
  el.out.textContent = text;
  el.out.dataset.empty = text ? 'false' : 'true';
  el.out.dataset.hint = '訳文がここに出ます';
}

/* ---------- 起動 ---------- */

async function boot() {
  showOutput('');
  setState('wait', 'エンジンを読み込んでいます。');

  let mod;
  try {
    mod = await import('./vendor/translator.js');
  } catch (e) {
    console.error(e);
    setState('err', 'vendor/translator.js が見つかりません。setup.sh を実行してください。');
    return;
  }

  // 版によってクラス名が異なるため、使えるものを選ぶ
  const Translator = mod.LatencyOptimisedTranslator || mod.BatchTranslator || mod.default;
  if (!Translator) {
    setState('err', 'translator.js に想定した翻訳クラスがありません。README の「API が変わっていたら」を参照してください。');
    return;
  }

  try {
    const res = await fetch(REGISTRY_URL, { cache: 'force-cache' });
    if (!res.ok) throw new Error(res.status);
    const registry = await res.json();
    pairs = Object.keys(registry).map((k) => ({ from: k.slice(0, 2), to: k.slice(2, 4), key: k }));
  } catch (e) {
    console.error(e);
    setState('err', 'models/registry.json を読めません。setup.sh でモデルを取得してください。');
    return;
  }

  translator = new Translator({
    registryUrl: REGISTRY_URL,
    workerUrl: WORKER_URL,
    cacheSize: 20000,
    downloadTimeout: 0,
  });

  fillLanguages();
  restorePair();
  setState('ready', `${pairs.length} 組の言語ペアを利用できます。`);
  el.src.focus();
}

function fillLanguages() {
  const sources = [...new Set(pairs.map((p) => p.from))].sort();
  const targets = [...new Set(pairs.map((p) => p.to))].sort();
  const fill = (select, codes) => {
    select.innerHTML = '';
    for (const code of codes) {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = `${label(code)}  ${code}`;
      select.append(opt);
    }
  };
  fill(el.from, sources);
  fill(el.to, targets);
}

function restorePair() {
  const saved = JSON.parse(localStorage.getItem('nagi.pair') || 'null');
  const has = (sel, v) => [...sel.options].some((o) => o.value === v);
  if (saved && has(el.from, saved.from) && has(el.to, saved.to)) {
    el.from.value = saved.from;
    el.to.value = saved.to;
  } else {
    if (has(el.from, 'en')) el.from.value = 'en';
    if (has(el.to, 'ja')) el.to.value = 'ja';
  }
}

function savePair() {
  localStorage.setItem('nagi.pair', JSON.stringify({ from: el.from.value, to: el.to.value }));
}

/* ---------- 翻訳 ---------- */

async function translate() {
  const text = el.src.value.trim();
  const from = el.from.value;
  const to = el.to.value;

  el.count.textContent = `${el.src.value.length} 文字`;

  if (!translator) return;
  if (!text) { showOutput(''); el.latency.textContent = ''; return; }
  if (from === to) { showOutput(text); el.latency.textContent = ''; return; }

  const mine = ++seq;
  el.out.setAttribute('aria-busy', 'true');
  setState('dl', `${label(from)} → ${label(to)} を翻訳しています。`);

  const started = performance.now();
  try {
    const response = await translator.translate({ from, to, text, html: false });
    if (mine !== seq) return;                 // 追い越されたら捨てる
    const result = response?.target?.text ?? response?.text ?? String(response);
    showOutput(result);
    const ms = Math.round(performance.now() - started);
    el.latency.textContent = `${ms} ms · 端末内`;
    setState('ready', `${label(from)} → ${label(to)}`);
  } catch (e) {
    if (mine !== seq) return;
    console.error(e);
    showOutput('');
    el.latency.textContent = '';
    setState('err', `${label(from)} → ${label(to)} のモデルがありません。別の組み合わせを選ぶか、setup.sh で追加してください。`);
  } finally {
    if (mine === seq) el.out.setAttribute('aria-busy', 'false');
  }
}

/* ---------- 入力 ---------- */

let timer = null;
const debounced = () => {
  el.count.textContent = `${el.src.value.length} 文字`;
  clearTimeout(timer);
  timer = setTimeout(translate, 350);
};

el.src.addEventListener('input', debounced);
el.from.addEventListener('change', () => { savePair(); translate(); });
el.to.addEventListener('change', () => { savePair(); translate(); });

el.swap.addEventListener('click', () => {
  const a = el.from.value, b = el.to.value;
  const has = (sel, v) => [...sel.options].some((o) => o.value === v);
  if (!has(el.from, b) || !has(el.to, a)) {
    setState('err', 'この向きのモデルがありません。');
    return;
  }
  el.from.value = b;
  el.to.value = a;
  const translated = el.out.textContent;
  if (translated) el.src.value = translated;
  savePair();
  translate();
});

el.clear.addEventListener('click', () => {
  el.src.value = '';
  showOutput('');
  el.latency.textContent = '';
  el.count.textContent = '0 文字';
  el.src.focus();
});

el.copy.addEventListener('click', async () => {
  const text = el.out.textContent;
  if (!text) return;
  await navigator.clipboard.writeText(text);
  el.copy.textContent = 'コピーしました';
  setTimeout(() => { el.copy.textContent = '訳文をコピー'; }, 1400);
});

// ⌘Enter で即翻訳、⌘⇧C で訳文をコピー
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); translate(); }
  if (e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); el.copy.click(); }
});

el.paste.addEventListener('click', async () => {
  if (!navigator.clipboard?.readText) return;
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (text) { el.src.value = text; debounced(); el.src.focus(); }
  } catch { /* 権限がなければ何もしない */ }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(console.error);
}

boot();
