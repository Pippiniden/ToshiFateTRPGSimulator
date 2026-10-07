/* TRPG バランス自動テストツール — GUI */
(function () {
  'use strict';
  const E = window.TRPGEngine;
  const PRE = window.TRPGPresets;
  const LS_KEY = 'trpg-balance-tester/v1';
  const LS_SAVED = 'trpg-balance-tester/v1/saved';
  const LS_UI = 'trpg-balance-tester/v1/ui';

  const clone = (o) => JSON.parse(JSON.stringify(o));
  let seq = 0;
  const uid = (p) => p + '_' + Date.now().toString(36) + (++seq).toString(36);
  const $ = (s, r) => (r || document).querySelector(s);
  const pct = (v, d) => (v * 100).toFixed(d === undefined ? 1 : d) + '%';
  const fmt = (v, d) => (isFinite(v) ? (+v).toFixed(d === undefined ? 1 : d) : '-');
  const teamColor = (i) => `var(--t${(i % 4) + 1})`;

  // ------------------------------------------------------------------
  // 状態
  // ------------------------------------------------------------------
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 保存不可の環境 */ } }

  function loadData() {
    const s = lsGet(LS_KEY);
    if (s) { try { const o = JSON.parse(s); if (o && o.rules && Array.isArray(o.characters)) return o; } catch (e) { /* 破損データは無視 */ } }
    return clone(PRE);
  }
  let D = loadData();
  function removeObsolete() {
    // 削除された初期データ（サンプルの黒竜など）を保存データからも取り除く
    const names = new Set(PRE.removedNames || []);
    const gone = new Set(D.characters.filter((c) => names.has(c.name)).map((c) => c.id));
    let n = 0;
    if (gone.size) { D.characters = D.characters.filter((c) => !gone.has(c.id)); n += gone.size; }
    const before = D.scenarios.length;
    D.scenarios = D.scenarios.filter((sc) => !(PRE.removedScenarios || []).includes(sc.name));
    for (const sc of D.scenarios) for (const t of sc.teams) t.members = t.members.filter((m) => !gone.has(m.charId));
    n += before - D.scenarios.length;
    return n;
  }
  function mergePresets(overwrite) {
    // 新しい初期データを名前で追加。overwrite なら同名の初期キャラ・状態を最新版で上書き（IDは維持）
    const pre = clone(PRE);
    const idMap = {};
    let added = 0, updated = 0;
    for (const c of pre.characters) {
      const i = D.characters.findIndex((x) => x.name === c.name);
      if (i >= 0) {
        idMap[c.id] = D.characters[i].id;
        if (overwrite) { c.id = D.characters[i].id; D.characters[i] = c; updated++; }
      } else { D.characters.push(c); idMap[c.id] = c.id; added++; }
    }
    for (const st of pre.states) {
      const i = D.states.findIndex((x) => x.name === st.name);
      if (i < 0) { D.states.push(st); added++; } else if (overwrite) { st.id = D.states[i].id; D.states[i] = st; }
    }
    for (const sc of pre.scenarios) {
      const i = D.scenarios.findIndex((x) => x.name === sc.name);
      for (const t of sc.teams) for (const m of t.members) m.charId = idMap[m.charId] || m.charId;
      if (i < 0) { D.scenarios.push(sc); added++; } else if (overwrite) { sc.id = D.scenarios[i].id; D.scenarios[i] = sc; }
    }
    if (D.rules.masterLoss === undefined) D.rules.masterLoss = true;
    if (!D.rules.commandSpells) D.rules.commandSpells = { enabled: true, max: 3 };
    for (const c of D.characters) if (c.csCost === undefined) { const pc = pre.characters.find((x) => x.name === c.name); c.csCost = pc ? pc.csCost || 0 : 0; }
    // 英雄点ボーナス等を持たない古い定義は、自動計算だと値がずれるので手動のままにする
    for (const c of D.characters) if (!c.csCostMode) c.csCostMode = 'manual';
    if (!D.rules.heroBudget) D.rules.heroBudget = { base: 30, perCs: 5 };
    for (const sc of D.scenarios) if (sc.rounds && sc.rounds.mode === 'teams') sc.rounds.mode = 'pl';
    if ((D.version || 1) < 6) for (const sc of D.scenarios) for (const t of sc.teams) t.support = true;
    removeObsolete();
    D.version = pre.version;
    return { added, updated };
  }
  if ((D.version || 1) < 4) removeObsolete();

  const UI = Object.assign({
    tab: 'test', charId: null, stateId: null, scnId: null, open: {}, charFilter: '',
    sweep: { teamIdx: 1, memberIdx: 0, param: 'hpExtra', from: 0, to: 180, step: 20, trials: 1000, effectPath: '' },
    rr: { ids: null, trials: 200, maxEngagements: 10 },
  }, (() => { try { return JSON.parse(lsGet(LS_UI) || '{}'); } catch (e) { return {}; } })());
  UI.result = null; UI.running = false; UI.sweepResult = null; UI.rrResult = null; UI.importOpen = false; UI.confirm = null; UI.importDialog = null; UI.charExportOpen = false; UI.charSel = [];
  let saved = (() => { try { return JSON.parse(lsGet(LS_SAVED) || '[]'); } catch (e) { return []; } })();

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      lsSet(LS_KEY, JSON.stringify(D));
      lsSet(LS_UI, JSON.stringify({ tab: UI.tab, charId: UI.charId, stateId: UI.stateId, scnId: UI.scnId, sweep: UI.sweep, rr: UI.rr }));
    }, 250);
  }
  function saveSaved() { lsSet(LS_SAVED, JSON.stringify(saved)); }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ------------------------------------------------------------------
  // DOM ヘルパー
  // ------------------------------------------------------------------
  function h(tag, props) {
    const el = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach((x) => add(el, x)); return; }
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  function markExpr(el) {
    const err = E.checkExpr(el.value);
    el.classList.toggle('bad', !!err);
    el.title = err ? '式エラー: ' + err : '';
  }
  function txt(obj, key, o) {
    o = o || {};
    const el = h('input', { type: 'text', value: obj[key] === undefined || obj[key] === null ? '' : obj[key], class: o.cls || (o.expr ? 'expr' : null), placeholder: o.ph, 'aria-label': o.label, list: o.list, id: o.id });
    el.addEventListener('input', () => { obj[key] = el.value; if (o.expr) markExpr(el); save(); if (o.onInput) o.onInput(el.value); });
    if (o.onChange) el.addEventListener('change', () => o.onChange(el.value));
    if (o.expr) markExpr(el);
    return el;
  }
  function num(obj, key, o) {
    o = o || {};
    const v = obj[key];
    const el = h('input', { type: 'number', value: v === undefined || v === null ? '' : v, class: o.cls, min: o.min, max: o.max, step: o.step || 1, placeholder: o.ph, 'aria-label': o.label, id: o.id });
    el.addEventListener('input', () => {
      obj[key] = el.value === '' ? (o.allowEmpty ? '' : 0) : +el.value;
      save(); if (o.onInput) o.onInput();
    });
    if (o.onChange) el.addEventListener('change', o.onChange);
    return el;
  }
  function sel(obj, key, options, o) {
    o = o || {};
    const el = h('select', { 'aria-label': o.label, class: o.cls, id: o.id });
    for (const opt of options) {
      if (opt.group) {
        const g = h('optgroup', { label: opt.group });
        for (const [v, l] of opt.items) g.appendChild(h('option', { value: v }, l));
        el.appendChild(g);
      } else el.appendChild(h('option', { value: opt[0] }, opt[1]));
    }
    el.value = obj[key] === undefined || obj[key] === null ? (options[0] && options[0][0]) || '' : obj[key];
    el.addEventListener('change', () => { obj[key] = el.value; save(); if (o.onChange) o.onChange(el.value); });
    return el;
  }
  function chk(obj, key, label, o) {
    o = o || {};
    const c = h('input', { type: 'checkbox', checked: !!obj[key], id: o.id });
    c.addEventListener('change', () => { obj[key] = c.checked; save(); if (o.onChange) o.onChange(c.checked); });
    return h('label', { class: 'check', title: o.title }, c, label);
  }
  const field = (label, control, o) => h('label', { class: 'field', style: o && o.style, title: o && o.title }, h('span', null, label), control);
  const btn = (label, onclick, cls, o) => h('button', Object.assign({ type: 'button', class: 'btn ' + (cls || ''), onclick }, o || {}), label);

  function confirmBtn(label, keyId, onYes) {
    if (UI.confirm === keyId) {
      return h('span', { class: 'inline-confirm' }, '本当に？',
        btn('はい', () => { UI.confirm = null; onYes(); }, 'danger sm'),
        btn('やめる', () => { UI.confirm = null; render(); }, 'ghost sm'));
    }
    return btn(label, () => { UI.confirm = keyId; render(); }, 'danger sm');
  }

  function moveItem(arr, i, d) {
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }

  // ------------------------------------------------------------------
  // 実行（Web Worker プール、使えない環境ではメインスレッド）
  // ------------------------------------------------------------------
  const Runner = (() => {
    let pool = null; let workerOk = null; let jobSeq = 0; let cancelled = false;
    const handlers = new Map();
    const size = () => Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4));

    function makePool() {
      if (workerOk === false) return null;
      if (pool) return pool;
      try {
        pool = [];
        for (let i = 0; i < size(); i++) {
          const w = new Worker('js/worker.js');
          w.onmessage = (ev) => {
            const m = ev.data; const hd = handlers.get(m.id);
            if (!hd) return;
            if (m.type === 'progress') hd.onProg && hd.onProg(m.done);
            else if (m.type === 'result') { handlers.delete(m.id); hd.resolve(m.agg); }
            else if (m.type === 'error') { handlers.delete(m.id); hd.reject(new Error(m.message)); }
          };
          w.onerror = (ev) => {
            ev.preventDefault();
            workerOk = false;
            for (const [id, hd] of handlers) if (hd.worker === w) { handlers.delete(id); hd.reject(Object.assign(new Error('WORKER_FAIL'), { workerFail: true })); }
          };
          pool.push(w);
        }
        workerOk = true;
        return pool;
      } catch (e) { workerOk = false; pool = null; return null; }
    }

    function execWorker(w, job, onProg) {
      return new Promise((resolve, reject) => {
        const id = ++jobSeq;
        handlers.set(id, { resolve, reject, onProg, worker: w });
        w.postMessage({ cmd: 'run', id, data: job.data, opts: job.opts });
      });
    }

    function execLocal(job, onProg) {
      return new Promise((resolve, reject) => {
        let C;
        try { C = E.compileScenario(job.data); if (C.teams.length < 2) throw new Error('2つ以上の陣営にキャラクターを配置してください。'); } catch (e) { reject(e); return; }
        const total = job.opts.trials; const chunk = 150; let done = 0; const parts = [];
        const step = () => {
          if (cancelled) { reject(new Error('CANCELLED')); return; }
          try {
            const n = Math.min(chunk, total - done);
            parts.push(E.runTrials(C, Object.assign({}, job.opts, { trials: n, start: (job.opts.start || 0) + done, logTrials: Math.max(0, (job.opts.logTrials || 0) - done) })));
            done += n; onProg && onProg(done);
            if (done >= total) { const m = E.mergeAgg(parts); m.warnings = [...m.warnings]; resolve(m); } else setTimeout(step, 0);
          } catch (e) { reject(e); }
        };
        step();
      });
    }

    async function runJobs(jobs, onProgress) {
      cancelled = false;
      const totals = jobs.map((j) => j.opts.trials);
      const grand = totals.reduce((a, b) => a + b, 0);
      const doneBy = new Array(jobs.length).fill(0);
      const report = () => onProgress && onProgress(doneBy.reduce((a, b) => a + b, 0), grand);
      const p = makePool();
      const slots = p ? p.slice() : [null];
      const results = new Array(jobs.length);
      let next = 0;
      const runSlot = async (w) => {
        while (next < jobs.length) {
          if (cancelled) throw new Error('CANCELLED');
          const i = next++;
          const onProg = (d) => { doneBy[i] = d; report(); };
          results[i] = w ? await execWorker(w, jobs[i], onProg) : await execLocal(jobs[i], onProg);
          doneBy[i] = totals[i]; report();
        }
      };
      try {
        await Promise.all(slots.map(runSlot));
      } catch (e) {
        if (e.workerFail) { terminate(); workerOk = false; return runJobs(jobs, onProgress); }
        throw e;
      }
      return results;
    }

    function terminate() {
      if (pool) pool.forEach((w) => w.terminate());
      pool = null;
      for (const [id, hd] of handlers) { handlers.delete(id); hd.reject(new Error('CANCELLED')); }
    }
    function cancel() { cancelled = true; terminate(); }
    return { runJobs, cancel, size, mode: () => (workerOk === false ? 'メインスレッド' : `Web Worker ×${size()}`) };
  })();

  function scenarioData(sc, overrides) {
    const ids = new Set();
    for (const t of sc.teams) for (const m of t.members) ids.add(m.charId);
    const o = overrides || {};
    const pool = o.characters || D.characters;
    // 召喚される側のキャラクターも含める
    const queue = [...ids];
    while (queue.length) {
      const cid = queue.pop();
      const c = pool.find((x) => x.id === cid);
      if (!c) continue;
      for (const sk of c.skills || []) for (const b of sk.blocks || []) for (const e of b.effects || []) {
        if (e.type !== 'summon') continue;
        const t = pool.find((x) => x.name === e.char);
        if (t && !ids.has(t.id)) { ids.add(t.id); queue.push(t.id); }
      }
    }
    return {
      rules: o.rules || D.rules,
      characters: pool.filter((c) => ids.has(c.id)),
      states: D.states,
      scenario: sc,
    };
  }

  function splitJobs(data, trials, seed, logTrials) {
    const n = trials >= 800 ? Runner.size() : 1;
    const jobs = [];
    let start = 0;
    for (let i = 0; i < n; i++) {
      const t = Math.floor(trials / n) + (i < trials % n ? 1 : 0);
      if (t <= 0) continue;
      jobs.push({ data, opts: { trials: t, seed, start, logTrials: i === 0 ? logTrials : 0 } });
      start += t;
    }
    return jobs;
  }

  // ------------------------------------------------------------------
  // 共通：説明文
  // ------------------------------------------------------------------
  const KIND_LABEL = { class: 'クラス', skill: 'スキル', np: '宝具' };
  const PER_LABEL = { round: '1巡', engagement: '交戦フェイズ', battle: 'セッション' };
  function typeNames(types) { return (types || []).map((k) => { const t = D.rules.attackTypes.find((x) => x.key === k); return t ? t.name : k; }).join('・'); }
  function describeEffect(e) {
    const T = E.EFFECT_TYPES[e.type];
    if (!T) return e.type;
    switch (e.type) {
      case 'mod': return `補正値${/^-/.test(e.value) ? '' : '+'}${e.value}${e.upTo ? 'まで' : ''}`;
      case 'faces': return `面数${/^-/.test(e.value) ? '' : '+'}${e.value}`;
      case 'reroll': return `振り直し${e.value}回`;
      case 'heal': return `HP回復 ${e.value}`;
      case 'maxHp': return `最大HP+${e.value}`;
      case 'stat': return `${e.stat}${/^-/.test(e.value) ? '' : '+'}${e.value}`;
      case 'applyState': return `状態「${e.state}」付与`;
      case 'defStat': return `相手は${e.stat}で防御`;
      case 'damage': return `${e.value}ダメージ`;
      case 'flag': { const f = E.FLAGS.find((x) => x[0] === e.name); return f ? f[1] : 'フラグ ' + e.name; }
      case 'negateOpp': return `相手の${e.names || e.kinds}補正無効`;
      case 'negateIncoming': return `受ける攻撃の${e.names || e.kinds}補正無効`;
      case 'endure': return e.value && e.value !== '1' ? `HP${e.value}で復活` : 'HP1で耐える';
      case 'reshape': return 'ステータス振り直し';
      case 'redirect': return e.dest && String(e.dest).trim() ? `攻撃対象を${String(e.dest).split(/[,、]+/).map((x) => x.trim()).filter(Boolean).map((x) => (x === '自分' ? x : `「${x}」`)).join('か')}に変更` : '攻撃対象を自分に変更';
      case 'summon': return `「${e.char}」を${e.value && e.value !== '1' ? e.value + '体' : ''}召喚${e.life === 'engagement' ? '（交戦フェイズ終了まで）' : ''}`;
      default: return T.label;
    }
  }
  function describeBlock(b) {
    const tm = (b.timings || []).map((t) => (E.TIMING_LABEL[t] || t).replace(/（.*?）/, '')).join('・') || '（タイミング未設定）';
    const ty = b.types && b.types.length ? `［${typeNames(b.types)}］` : '';
    const cd = ((b.cond && b.cond.rows) || []).filter((r) => r.expr).length ? '［条件付き］' : '';
    return `${tm}${ty}${cd}：${(b.effects || []).map(describeEffect).join('、') || '効果なし'}`;
  }
  function describeSkill(s) {
    const parts = (s.blocks || []).map(describeBlock);
    const lim = [];
    if (s.uses && +s.uses.max > 0) lim.push(`${PER_LABEL[s.uses.per] || s.uses.per}に${s.uses.max}回`);
    if (s.resource && s.resource.key) lim.push(`${s.resource.key}を${s.resource.amount || 1}消費`);
    if (+s.csUse > 0) lim.push(`令呪${s.csUse}画`);
    return (parts.join(' / ') || '効果未設定') + (lim.length ? `（${lim.join('・')}）` : '');
  }

  // ------------------------------------------------------------------
  // ブロック編集（スキル・状態共通）
  // ------------------------------------------------------------------
  const COND_TEMPLATES = [
    ['self.hpPct <= 50', '自分のHPが50%以下'],
    ['target.hp > self.hp', '相手のHPが自分より多い'],
    ["has(target,'人属性')", '相手がタグを持つ'],
    ["has(actor,'竜種')", '判定する味方がタグを持つ'],
    ['hasInitiative()', '相手より先手'],
    ["teamFlag('陣地')", '自陣営にフラグがある'],
    ['round >= 3', '3巡目以降'],
    ['allyDown() > 0', '味方が脱落している'],
    ['event.damage > 0', 'ダメージが発生した'],
    ['self.res.np < 1', '宝具回数が0'],
  ];

  function blockEditor(block, onStructure) {
    block.cond = block.cond || { mode: 'all', rows: [] };
    block.effects = block.effects || [];
    block.timings = block.timings || [];
    block.types = block.types || [];
    const wrap = h('div', { class: 'stack', style: { gap: '8px' } });

    // タイミング
    const tchips = h('div', { class: 'chips' });
    for (const [k, label] of E.TIMINGS) {
      const on = block.timings.includes(k);
      tchips.appendChild(h('button', { type: 'button', class: 'chip', 'aria-pressed': on ? 'true' : 'false', onclick: () => {
        if (block.timings.includes(k)) block.timings = block.timings.filter((x) => x !== k); else block.timings.push(k);
        save(); onStructure();
      } }, label));
    }
    wrap.appendChild(h('div', { class: 'stack', style: { gap: '4px' } }, h('div', { class: 'block-label' }, 'タイミング（複数可）'), tchips));

    const rollish = block.timings.some((t) => ['attack', 'defend', 'allyAttack', 'allyDefend', 'allyAttacked', 'dealtDamage', 'tookDamage'].includes(t));
    if (rollish) {
      const ty = h('div', { class: 'chips' });
      for (const t of D.rules.attackTypes) {
        const on = block.types.includes(t.key);
        ty.appendChild(h('button', { type: 'button', class: 'chip', 'aria-pressed': on ? 'true' : 'false', onclick: () => {
          if (block.types.includes(t.key)) block.types = block.types.filter((x) => x !== t.key); else block.types.push(t.key);
          save(); onStructure();
        } }, t.name));
      }
      wrap.appendChild(h('div', { class: 'stack', style: { gap: '4px' } }, h('div', { class: 'block-label' }, '攻撃種別（未選択＝すべて）'), ty));
    }

    // 条件
    const condBox = h('div', { class: 'stack', style: { gap: '4px' } });
    const ch = h('div', { class: 'row' }, h('div', { class: 'block-label' }, '条件'),
      sel(block.cond, 'mode', [['all', 'すべて満たす（AND）'], ['any', 'いずれか満たす（OR）']], { cls: 'w-md' }));
    condBox.appendChild(ch);
    block.cond.rows.forEach((r, i) => {
      condBox.appendChild(h('div', { class: 'cond-row' },
        chk(r, 'not', 'NOT'),
        txt(r, 'expr', { expr: true, ph: '例: self.hpPct <= 50' }),
        btn('×', () => { block.cond.rows.splice(i, 1); save(); onStructure(); }, 'ghost icon sm', { title: '条件を削除', 'aria-label': '条件を削除' })));
    });
    const tpl = h('select', { class: 'w-md', 'aria-label': '条件を追加' }, h('option', { value: '' }, '＋ 条件を追加…'),
      h('option', { value: '__blank' }, '空の条件式'), COND_TEMPLATES.map(([v, l]) => h('option', { value: v }, l + '　' + v)));
    tpl.addEventListener('change', () => {
      if (!tpl.value) return;
      block.cond.rows.push({ expr: tpl.value === '__blank' ? '' : tpl.value, not: false });
      save(); onStructure();
    });
    condBox.appendChild(tpl);
    wrap.appendChild(condBox);

    // 効果
    const effBox = h('div', { class: 'stack', style: { gap: '6px' } }, h('div', { class: 'block-label' }, '効果（上から順に適用）'));
    block.effects.forEach((e, i) => effBox.appendChild(effectRow(block, e, i, onStructure)));
    const addSel = h('select', { class: 'w-md', 'aria-label': '効果を追加' }, h('option', { value: '' }, '＋ 効果を追加…'),
      Object.entries(E.EFFECT_TYPES).map(([k, v]) => h('option', { value: k }, v.label)));
    addSel.addEventListener('change', () => {
      if (!addSel.value) return;
      const e = { type: addSel.value };
      initEffect(e);
      block.effects.push(e);
      save(); onStructure();
    });
    effBox.appendChild(addSel);
    wrap.appendChild(effBox);
    return wrap;
  }

  function initEffect(e) {
    const T = E.EFFECT_TYPES[e.type];
    for (const p of T.params) {
      if (e[p] !== undefined) continue;
      if (p === 'value') e.value = e.type === 'reroll' || e.type === 'summon' || e.type === 'endure' ? '1' : e.type === 'statSteal' ? '3' : '5';
      else if (p === 'profiles') e.profiles = D.rules.stats.map((st) => st.key + ':A').join(', ');
      else if (p === 'upTo') e.upTo = false;
      else if (p === 'to') e.to = e.type === 'applyState' ? 'target' : 'self';
      else if (p === 'stat') e.stat = D.rules.stats[0] ? D.rules.stats[0].key : '';
      else if (p === 'state') e.state = D.states[0] ? D.states[0].name : '';
      else if (p === 'key') e.key = 'np';
      else if (p === 'name') e.name = 'surprise';
      else if (p === 'char') e.char = (D.characters.find((c) => c.cls === '乗騎') || D.characters[0] || {}).name || '';
      else if (p === 'pos') e.pos = 'front';
      else if (p === 'life') e.life = 'battle';
      else if (p === 'link') e.link = false;
      else if (p === 'collapse') e.collapse = false;
      else if (p === 'kinds') e.kinds = e.type === 'suppressSelf' ? 'skill' : '';
      else e[p] = '';
    }
  }

  function effectRow(block, e, i, onStructure) {
    const T = E.EFFECT_TYPES[e.type] || { params: [] };
    const typeSel = h('select', { 'aria-label': '効果の種類' }, Object.entries(E.EFFECT_TYPES).map(([k, v]) => h('option', { value: k }, v.label)));
    typeSel.value = e.type;
    typeSel.addEventListener('change', () => {
      const keep = { type: typeSel.value };
      for (const k of Object.keys(e)) delete e[k];
      Object.assign(e, keep); initEffect(e); save(); onStructure();
    });
    const row = h('div', { class: 'eff-row' }, typeSel);
    const statOpts = [['ALL', '全ステータス']].concat(D.rules.stats.map((s) => [s.key, `${s.name}（${s.key}）`]));
    for (const p of T.params) {
      let ctl = null; let label = '';
      switch (p) {
        case 'value': label = e.type === 'reroll' ? '回数' : e.type === 'statSteal' ? '同一相手への上限' : e.type === 'summon' ? '体数' : e.type === 'endure' ? '残るHP' : '値・式'; ctl = txt(e, 'value', { expr: true, ph: '5 / d(3,6) / target.END*2' }); break;
        case 'upTo': ctl = chk(e, 'upTo', 'まで（AIが最適値を選ぶ）', { title: '「Xまでの補正値」。補正値ペナルティを考慮して最も期待値が高い値を選びます。' }); break;
        case 'to': label = '対象'; ctl = sel(e, 'to', E.TARGETS); break;
        case 'stat':
          label = e.type === 'defStat' ? '防御に使う値' : '能力値';
          ctl = e.type === 'defStat'
            ? txt(e, 'stat', { ph: 'LUK / min:MAG,LUK', cls: 'expr', list: 'dl-stats' })
            : sel(e, 'stat', statOpts);
          break;
        case 'state': label = '状態'; ctl = sel(e, 'state', D.states.map((s) => [s.name, s.name])); break;
        case 'key': label = 'リソース'; ctl = txt(e, 'key', { ph: 'np', cls: 'expr' }); ctl.style.width = '80px'; break;
        case 'dest': label = '変更先'; ctl = txt(e, 'dest', { ph: '空欄＝自分 / 自分, 王の軍勢', label: '攻撃対象の変更先（カンマ区切り）' }); ctl.style.width = '200px'; break;
        case 'names': label = 'スキル名'; ctl = txt(e, 'names', { ph: '対魔力（カンマ区切り）' }); ctl.style.width = '140px'; break;
        case 'kinds': label = '種別'; ctl = txt(e, 'kinds', { ph: 'class,skill,np,state', cls: 'expr' }); ctl.style.width = '150px'; break;
        case 'floor': label = 'HP下限'; ctl = num(e, 'floor', { allowEmpty: true, cls: 'w-num', ph: 'なし' }); break;
        case 'if': label = '実行条件'; ctl = txt(e, 'if', { expr: true, ph: '任意（例: event.damage > 0）' }); break;
        case 'name': label = 'フラグ'; ctl = sel(e, 'name', E.FLAGS); break;
        case 'char': label = '召喚する'; ctl = sel(e, 'char', D.characters.map((c) => [c.name, c.name])); break;
        case 'pos': label = '配置'; ctl = sel(e, 'pos', [['front', '前衛'], ['back', '後衛']]); break;
        case 'life': label = '持続'; ctl = sel(e, 'life', [['battle', 'セッション終了まで'], ['engagement', '交戦フェイズ終了まで']]); break;
        case 'link': ctl = chk(e, 'link', '召喚者が倒れたら消滅'); break;
        case 'collapse': ctl = chk(e, 'collapse', '残りが召喚数の半分以下で全て消滅', { title: '王の軍勢の「総数が半分以下になっても陣地は消滅する」のような群体用' }); break;
        case 'profiles': label = '候補（| 区切り）'; ctl = txt(e, 'profiles', { cls: 'expr', ph: 'STR:EX, END:A, … | STR:A, END:EX, …' }); ctl.style.width = '420px'; ctl.style.maxWidth = '100%'; break;
        default: break;
      }
      if (ctl) row.appendChild(h('span', { class: 'p' }, label ? h('span', null, label) : null, ctl));
    }
    row.appendChild(h('span', { class: 'row tight' },
      btn('↑', () => { moveItem(block.effects, i, -1); save(); onStructure(); }, 'ghost icon sm', { title: '上へ', 'aria-label': '上へ' }),
      btn('↓', () => { moveItem(block.effects, i, 1); save(); onStructure(); }, 'ghost icon sm', { title: '下へ', 'aria-label': '下へ' }),
      btn('×', () => { block.effects.splice(i, 1); save(); onStructure(); }, 'ghost icon sm', { title: '効果を削除', 'aria-label': '効果を削除' })));
    return row;
  }

  function blocksEditor(owner, onStructure) {
    owner.blocks = owner.blocks || [];
    const box = h('div', { class: 'stack', style: { gap: '8px' } });
    owner.blocks.forEach((b, i) => {
      box.appendChild(h('div', { class: 'block' },
        h('div', { class: 'row' }, h('div', { class: 'block-label' }, `ブロック ${i + 1}`), h('span', { class: 'summary-line' }, describeBlock(b)), h('span', { class: 'spacer' }),
          btn('複製', () => { owner.blocks.splice(i + 1, 0, clone(b)); save(); onStructure(); }, 'ghost sm'),
          btn('削除', () => { owner.blocks.splice(i, 1); save(); onStructure(); }, 'ghost sm')),
        blockEditor(b, onStructure)));
    });
    box.appendChild(h('div', null, btn('＋ ブロックを追加', () => {
      owner.blocks.push({ timings: ['attack'], types: [], cond: { mode: 'all', rows: [] }, effects: [{ type: 'mod', value: '3', upTo: false }] });
      save(); onStructure();
    }, 'sm')));
    return box;
  }

  // ------------------------------------------------------------------
  // テスト実行タブ
  // ------------------------------------------------------------------
  function currentScenario() {
    if (!D.scenarios.length) D.scenarios.push(newScenario());
    let s = D.scenarios.find((x) => x.id === UI.scnId);
    if (!s) { s = D.scenarios[0]; UI.scnId = s.id; }
    return s;
  }
  function newScenario() {
    const c = D.characters;
    return {
      id: uid('sc'), name: '新しいテストケース',
      teams: [
        { name: '陣営A', flags: '', support: true, members: c[0] ? [{ charId: c[0].id, pos: 'front', key: false }] : [] },
        { name: '陣営B', flags: '', support: true, members: c[1] ? [{ charId: c[1].id, pos: 'front', key: false }] : [] },
      ],
      rounds: { mode: 'pl', value: 2 }, maxEngagements: 10, trials: 3000, seed: Math.floor(Math.random() * 1e6), logTrials: 3,
    };
  }
  function charOptions() {
    const groups = new Map();
    for (const c of D.characters) {
      const g = c.cls || 'その他';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push([c.id, c.name]);
    }
    return [...groups.entries()].map(([g, items]) => ({ group: g, items }));
  }

  let resultsEl = null; let runBarEl = null;
  function renderTest() {
    const sc = currentScenario();
    const left = h('section', { class: 'panel stack', 'aria-label': 'テストケース' });
    if ((D.version || 1) < (PRE.version || 1)) {
      left.appendChild(h('div', { class: 'notice' }, '初期データが更新されています（イスカンダルのカリスマで王の軍勢・神威の車輪へ攻撃対象を変更、陣地破壊、ジャンヌ宝具のデバフ無効、メルトのドレイン解除、援護AIが補正値ペナルティの谷を越えるように、召喚体は召喚者の脱落で消滅、王の軍勢の半数消滅、複数の味方による援護の重ね掛け、英雄点から初期令呪を自動計算、巡数＝参加PL数、ギルガメッシュ・エルキドゥ・ヘラクレス、ライダーの途中召喚など）。保存データの初期キャラクターは古い定義のままなので、最新版への更新をおすすめします。',
        h('div', { class: 'row', style: { marginTop: '6px' } },
          btn('最新版に更新（初期キャラを上書き）', () => { const r = mergePresets(true); save(); render(); toast(`${r.added}件を追加、${r.updated}件の初期キャラクターを最新版にしました`); }, 'sm primary'),
          btn('追加のみ（編集を残す）', () => { const r = mergePresets(false); save(); render(); toast(`${r.added}件を追加しました（既存のキャラクターはそのまま）`); }, 'sm'),
          btn('今はしない', () => { D.version = PRE.version; save(); render(); }, 'ghost sm'))));
    }
    left.appendChild(h('div', { class: 'section-head' }, h('h2', null, 'テストケース')));
    const pick = sel(UI, 'scnId', D.scenarios.map((s) => [s.id, s.name]), { onChange: () => { UI.result = null; render(); }, label: 'テストケースを選択' });
    left.appendChild(h('div', { class: 'row' }, h('div', { style: { flex: '1 1 160px', minWidth: 0 } }, pick),
      btn('新規', () => { const s = newScenario(); D.scenarios.push(s); UI.scnId = s.id; UI.result = null; save(); render(); }, 'sm'),
      btn('複製', () => { const s = clone(sc); s.id = uid('sc'); s.name += '（コピー）'; D.scenarios.push(s); UI.scnId = s.id; save(); render(); }, 'sm'),
      D.scenarios.length > 1 ? confirmBtn('削除', 'del-scn-' + sc.id, () => { D.scenarios = D.scenarios.filter((x) => x !== sc); UI.scnId = null; UI.result = null; save(); render(); }) : null));
    left.appendChild(h('div', { class: 'row' },
      btn('書き出し', () => exportItems(bundleScenario(sc), `テストケース_${safeName(sc.name)}.json`, 'file'), 'sm', { title: 'このテストケースを、使っているキャラクター・状態と一緒にJSONファイルに書き出します' }),
      btn('テキストでコピー', () => exportItems(bundleScenario(sc), '', 'text'), 'sm'),
      btn('読み込み…', () => { UI.importDialog = { mode: 'input' }; render(); }, 'sm')));
    left.appendChild(field('名前', txt(sc, 'name', { onChange: () => render() })));

    sc.teams.forEach((t, ti) => left.appendChild(teamCard(sc, t, ti)));
    if (sc.teams.length < 6) left.appendChild(h('div', null, btn('＋ 陣営を追加', () => { sc.teams.push({ name: '陣営' + String.fromCharCode(65 + sc.teams.length), flags: '', support: true, members: [] }); save(); render(); }, 'sm')));

    sc.rounds = sc.rounds || { mode: 'teams', value: 2 };
    const roundVal = num(sc.rounds, 'value', { min: 1, cls: 'w-num', label: '固定の巡数' });
    roundVal.disabled = sc.rounds.mode !== 'fixed';
    left.appendChild(h('hr', { class: 'divider' }));
    left.appendChild(h('h3', null, '試験条件'));
    left.appendChild(h('div', { class: 'grid' },
      field('交戦フェイズの巡数', h('div', { class: 'row tight' }, sel(sc.rounds, 'mode', [['pl', '参加PL数（ルール準拠）'], ['teams', '陣営数'], ['units', '参加キャラ数'], ['fixed', '固定']], { onChange: () => { roundVal.disabled = sc.rounds.mode !== 'fixed'; } }), roundVal)),
      field('最大ターン数', num(sc, 'maxEngagements', { min: 1, max: 100 }), { title: '1ターンに1回交戦フェイズがある前提。このターン数で決着しなければ引き分け' }),
      field('試行回数', num(sc, 'trials', { min: 1, max: 1000000, step: 100 })),
      field('乱数シード', txt(sc, 'seed', { cls: 'expr' }), { title: '同じシードなら同じ結果を再現できます' }),
      field('詳細ログを残す試行数', num(sc, 'logTrials', { min: 0, max: 50 }))));

    runBarEl = h('div', { class: 'run-bar' });
    left.appendChild(runBarEl);
    paintRunBar();

    resultsEl = h('section', { class: 'panel stack', 'aria-label': '結果', 'aria-live': 'polite' });
    paintResults();
    return h('div', { class: 'test-layout' }, left, resultsEl);
  }

  function teamCard(sc, t, ti) {
    const card = h('div', { class: 'team-card', style: { '--tc': teamColor(ti) } });
    card.appendChild(h('div', { class: 'row' },
      h('span', { class: 'team-dot', style: { background: teamColor(ti) } }),
      h('div', { style: { flex: '1 1 120px', minWidth: 0 } }, txt(t, 'name', { label: '陣営名' })),
      sc.teams.length > 2 ? btn('×', () => { sc.teams.splice(ti, 1); save(); render(); }, 'ghost icon sm', { title: '陣営を削除', 'aria-label': '陣営を削除' }) : null));
    card.appendChild(h('div', { class: 'row' },
      h('div', { style: { flex: '1 1 140px', minWidth: 0 } }, txt(t, 'flags', { ph: '陣営フラグ（例: 陣地, 同盟）', label: '陣営フラグ' })),
      (() => { t.support = t.support !== false; return chk(t, 'support', '援護を使う', { title: '味方の前衛が2人以上いる時、AIが有利と判断すれば援護を行います。1回の攻撃に複数の援護を重ねられ、補正値ペナルティを考慮して人数を決めます' }); })()));
    t.csMode = t.csMode || 'auto'; t.csAI = t.csAI || 'normal';
    card.appendChild(h('div', { class: 'row' },
      h('span', { class: 'small muted', title: '3画 − サーヴァントの令呪コストで開始。「積極的」は攻撃の振り直しにも使う' }, '令呪'),
      h('div', { style: { flex: '1 1 150px', minWidth: 0 } }, sel(t, 'csMode', [['auto', 'あり'], ['none', 'なし（ボス等）']], { label: '令呪の有無', onChange: () => render() })),
      t.csMode !== 'none' ? h('div', { style: { flex: '1 1 150px', minWidth: 0 } }, sel(t, 'csAI', [['normal', '通常（1画温存）'], ['aggressive', '積極的'], ['never', '使わない']], { label: '令呪の使い方' })) : null));
    t.members.forEach((m, mi) => {
      const ch = D.characters.find((c) => c.id === m.charId);
      const key = `${sc.id}:${ti}:${mi}`;
      const open = !!UI.open['m:' + key];
      card.appendChild(h('div', { class: 'member' },
        ch ? sel(m, 'charId', charOptions(), { label: 'キャラクター', onChange: () => render() }) : h('span', { class: 'small', style: { color: 'var(--danger)' } }, '削除されたキャラクター'),
        sel(m, 'pos', [['front', '前衛'], ['back', '後衛']], { label: '配置' }),
        chk(m, 'key', '要', { title: 'このキャラが倒れたら陣営の敗北（ボスなど）' }),
        h('button', { type: 'button', class: 'btn ghost icon sm', 'aria-expanded': open ? 'true' : 'false', title: 'マスター指定・開始時の消耗', 'aria-label': '詳細設定', onclick: () => { UI.open['m:' + key] = !open; render(); } }, open ? '▾' : '⚙'),
        btn('×', () => { t.members.splice(mi, 1); for (const x of t.members) { if (x.master === mi) x.master = ''; else if (+x.master > mi) x.master = +x.master - 1; } save(); render(); }, 'ghost icon sm', { title: 'メンバーを外す', 'aria-label': 'メンバーを外す' })));
      const sum = memberSummary(t, m, ch);
      if (sum && !open) card.appendChild(h('div', { class: 'member-note' }, sum));
      if (open && ch) card.appendChild(memberDetails(t, m, mi, ch));
    });
    const addSel = h('select', { 'aria-label': 'キャラクターを追加' }, h('option', { value: '' }, '＋ キャラクターを追加…'),
      charOptions().map((g) => h('optgroup', { label: g.group }, g.items.map(([v, l]) => h('option', { value: v }, l)))));
    addSel.addEventListener('change', () => { if (!addSel.value) return; t.members.push({ charId: addSel.value, pos: 'front', key: false }); save(); render(); });
    card.appendChild(addSel);
    return card;
  }

  function memberSummary(t, m, ch) {
    const parts = [];
    if (m.master !== undefined && m.master !== '' && m.master !== null && t.members[+m.master]) {
      const mc = D.characters.find((c) => c.id === t.members[+m.master].charId);
      if (mc) parts.push('マスター：' + mc.name);
    }
    const i = m.init;
    if (i) {
      if (i.hpMode === 'value' && i.hp !== '' && i.hp !== undefined) parts.push(`HP ${i.hp}`);
      if (i.hpMode === 'pct' && i.hp !== '' && i.hp !== undefined) parts.push(`HP ${i.hp}%`);
      if (i.hpMode === 'range') parts.push(`HP ${i.hpMin || 0}〜${i.hpMax === '' || i.hpMax === undefined ? 100 : i.hpMax}%（ランダム）`);
      for (const k in i.res || {}) if (i.res[k] !== '' && i.res[k] !== undefined && i.res[k] !== null) {
        const r = ch && (ch.resources || []).find((x) => x.key === k);
        parts.push(`${r ? r.name || k : k} ${i.res[k]}`);
      }
      if (i.cs !== undefined && i.cs !== '' && i.cs !== null) parts.push(`令呪 ${i.cs}画`);
      for (const st of i.states || []) parts.push(st);
      for (const u of i.used || []) parts.push(u + ' 使用済み');
    }
    return parts.length ? parts.join(' ・ ') : '';
  }

  function memberDetails(t, m, mi, ch) {
    m.init = m.init || { hpMode: 'full', hp: '', hpMin: 50, hpMax: 100, res: {}, states: [], used: [] };
    const I = m.init;
    I.res = I.res || {}; I.states = I.states || []; I.used = I.used || [];
    const box = h('div', { class: 'member-detail' });
    const masterOpts = [['', 'なし']].concat(t.members.map((x, i) => {
      const c = D.characters.find((cc) => cc.id === x.charId);
      return i === mi || !c ? null : [String(i), c.name];
    }).filter(Boolean));
    const mObj = { v: m.master === undefined || m.master === null ? '' : String(m.master) };
    box.append(h('div', { class: 'grid wide' },
      field('マスター（このキャラの契約者）', sel(mObj, 'v', masterOpts, { onChange: (v) => { m.master = v === '' ? '' : +v; save(); } }), { title: 'マスターが倒れると、サーヴァントはマスターのHP分のダメージを受け、交戦フェイズ終了時に消滅します（単独行動なら次の交戦まで）。' })));
    const hpVal = num(I, 'hp', { allowEmpty: true, cls: 'w-num', label: '開始HP' });
    const lo = num(I, 'hpMin', { cls: 'w-num', min: 0, max: 100, label: '最小%' });
    const hi = num(I, 'hpMax', { cls: 'w-num', min: 0, max: 100, label: '最大%' });
    const hpRow = h('div', { class: 'row tight' },
      sel(I, 'hpMode', [['full', '万全'], ['value', 'HPを指定'], ['pct', '最大HPの%'], ['range', 'ランダム（%の範囲）']], { onChange: () => render() }),
      I.hpMode === 'value' || I.hpMode === 'pct' ? hpVal : null,
      I.hpMode === 'pct' ? h('span', { class: 'small muted' }, '%') : null,
      I.hpMode === 'range' ? [lo, h('span', { class: 'small muted' }, '〜'), hi, h('span', { class: 'small muted' }, '%')] : null);
    box.append(field(`開始時のHP（最大 ${E.previewMaxHp(D.rules, ch)} 目安）`, hpRow));
    if ((ch.resources || []).length) {
      box.append(field('開始時のリソース（空欄＝最大）', h('div', { class: 'row' }, ch.resources.map((r) => h('span', { class: 'row tight' },
        h('span', { class: 'small muted' }, `${r.name || r.key}`), num(I.res, r.key, { allowEmpty: true, cls: 'w-num', min: 0, ph: String(r.max), label: r.name || r.key }))))));
    }
    const isMaster = (ch.tags || []).includes(D.rules.masterTag || 'マスター');
    const hasMaster = m.master !== undefined && m.master !== '' && m.master !== null;
    if (t.csMode !== 'none' && !(ch.tags || []).includes('乗騎')) {
      let txtCs = '';
      if (isMaster) {
        const svs = t.members.filter((x) => x.master !== undefined && x.master !== '' && x.master !== null && +x.master === mi).map((x) => D.characters.find((cc) => cc.id === x.charId)).filter(Boolean);
        const g = (ch.skills || []).reduce((a, sk) => a + (+sk.csGain || 0), 0);
        const cost = svs.reduce((a, sv) => a + E.csPlan(D.rules, sv, ch).cost, 0);
        txtCs = svs.length ? `初期令呪 ${Math.max(0, Math.min(3, 3 + g - cost))}画（${svs.map((sv) => `${sv.name} の令呪コスト ${E.csPlan(D.rules, sv, ch).cost}画`).join('、')}）` : `初期令呪 ${Math.min(3, 3 + g)}画（契約サーヴァントなし）`;
      } else if (hasMaster && t.members[+m.master]) {
        const mc = D.characters.find((cc) => cc.id === t.members[+m.master].charId);
        const pl = E.csPlan(D.rules, ch, mc);
        txtCs = `令呪コスト ${pl.cost}画（予算 ${pl.budget}点${pl.bonusMaster ? `、うちマスターのスキル ${pl.bonusMaster >= 0 ? '+' : ''}${pl.bonusMaster}点` : ''}）。令呪はマスターが保持`;
      } else if (!(ch.tags || []).includes('ボス')) {
        const pl = E.csPlan(D.rules, ch, null);
        txtCs = `令呪コスト ${pl.cost}画 → 初期令呪 ${pl.start}画（マスター未配置のため本人が保持）`;
      }
      if (txtCs) box.append(h('p', { class: 'small', style: { color: 'var(--muted)' } }, '令呪：' + txtCs));
    }
    if (!isMaster && !hasMaster && t.csMode !== 'none' && !(ch.tags || []).includes('乗騎') && !(ch.tags || []).includes('ボス')) {
      const st0 = E.csPlan(D.rules, ch, null).start;
      box.append(field(`開始時の令呪を上書き（空欄＝${st0}画）`, num(I, 'cs', { allowEmpty: true, cls: 'w-num', min: 0, max: 3, ph: String(st0) })));
    }
    const stChips = h('div', { class: 'chips' }, D.states.map((st) => {
      const on = I.states.includes(st.name);
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': on ? 'true' : 'false', onclick: () => { I.states = on ? I.states.filter((x) => x !== st.name) : I.states.concat([st.name]); save(); render(); } }, st.name);
    }));
    box.append(field('開始時に掛かっている状態', stChips));
    const lim = (ch.skills || []).filter((sk) => sk.uses && +sk.uses.max > 0 && sk.uses.per === 'battle');
    if (lim.length) {
      box.append(field('使用済みのスキル（1戦闘の回数制限を使い切った扱い）', h('div', { class: 'chips' }, lim.map((sk) => {
        const on = I.used.includes(sk.name);
        return h('button', { type: 'button', class: 'chip', 'aria-pressed': on ? 'true' : 'false', onclick: () => { I.used = on ? I.used.filter((x) => x !== sk.name) : I.used.concat([sk.name]); save(); render(); } }, sk.name);
      }))));
    }
    box.append(h('div', null, btn('万全に戻す', () => { m.init = null; save(); render(); }, 'ghost sm')));
    return box;
  }

  let progressState = { done: 0, total: 0 };
  function paintRunBar() {
    if (!runBarEl) return;
    runBarEl.innerHTML = '';
    if (UI.running) {
      const p = progressState.total ? progressState.done / progressState.total : 0;
      runBarEl.append(
        btn('中止', () => Runner.cancel(), 'danger'),
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(p * 100)) }, h('i', { style: { width: (p * 100).toFixed(1) + '%' } })),
        h('span', { class: 'small muted num' }, `${progressState.done.toLocaleString()} / ${progressState.total.toLocaleString()}`));
    } else {
      runBarEl.append(btn('シミュレーション実行', runCurrent, 'primary big'), h('span', { class: 'small faint' }, Runner.mode()));
    }
  }
  function setProgress(done, total) {
    progressState = { done, total };
    const bar = runBarEl && runBarEl.querySelector('.progress > i');
    if (bar) {
      bar.style.width = ((done / total) * 100).toFixed(1) + '%';
      const lab = runBarEl.querySelector('.num'); if (lab) lab.textContent = `${done.toLocaleString()} / ${total.toLocaleString()}`;
    }
    for (const id of ['#sweep-progress', '#rr-progress']) { const el = $(id); if (el) el.textContent = `${Math.round((done / total) * 100)}%（${done.toLocaleString()} / ${total.toLocaleString()} 試行）`; }
  }

  function validateScenario(sc) {
    const teams = sc.teams.filter((t) => t.members.some((m) => D.characters.some((c) => c.id === m.charId)));
    if (teams.length < 2) return '2つ以上の陣営にキャラクターを配置してください。';
    return null;
  }

  async function runCurrent() {
    const sc = currentScenario();
    const err = validateScenario(sc);
    if (err) { toast(err); return; }
    const trials = Math.max(1, Math.floor(+sc.trials || 1));
    UI.running = true; progressState = { done: 0, total: trials }; paintRunBar();
    const t0 = performance.now();
    try {
      const data = clone(scenarioData(sc));
      const aggs = await Runner.runJobs(splitJobs(data, trials, sc.seed, +sc.logTrials || 0), setProgress);
      const sum = E.summarize(E.mergeAgg(aggs));
      sum.elapsed = performance.now() - t0;
      sum.scenarioName = sc.name; sum.scenarioId = sc.id; sum.seed = sc.seed;
      UI.result = sum;
    } catch (e) {
      if (e.message !== 'CANCELLED') { UI.result = { error: e.message }; } else toast('中止しました');
    }
    UI.running = false;
    paintRunBar(); paintResults();
  }

  function paintResults() {
    if (!resultsEl) return;
    resultsEl.innerHTML = '';
    const r = UI.result;
    if (!r) {
      resultsEl.append(h('div', { class: 'section-head' }, h('h2', null, '結果')),
        h('div', { class: 'result-empty' },
          h('p', null, '左のテストケースで陣営とキャラクターを組み、「シミュレーション実行」を押してください。'),
          h('p', { class: 'small', style: { marginTop: '6px' } }, '勝率・戦闘の長さ・キャラ別の死亡率・ダメージ・スキル使用率と、代表試行の詳細ログが表示されます。')));
      return;
    }
    if (r.error) { resultsEl.append(h('h2', null, '結果'), h('div', { class: 'notice err' }, r.error)); return; }
    resultsEl.append(resultView(r, true));
  }

  function resultView(r, withSave) {
    const box = h('div', { class: 'stack' });
    box.append(h('div', { class: 'section-head' }, h('h2', null, '結果：' + r.scenarioName),
      h('p', { class: 'num' }, `${r.trials.toLocaleString()} 試行 ・ シード ${r.seed} ・ ${(r.elapsed / 1000).toFixed(2)} 秒`)));

    // 勝率バー
    const bar = h('div', { class: 'winbar', role: 'img', 'aria-label': '勝率の内訳' });
    r.teams.forEach((t, i) => { if (t.rate > 0) bar.append(h('div', { style: { width: pct(t.rate, 3), background: teamColor(i) }, title: `${t.name} ${pct(t.rate)}` }, t.rate > 0.08 ? pct(t.rate, 0) : '')); });
    if (r.drawRate > 0) bar.append(h('div', { style: { width: pct(r.drawRate, 3), background: 'var(--t-draw)' }, title: `引き分け ${pct(r.drawRate)}` }, r.drawRate > 0.08 ? pct(r.drawRate, 0) : ''));
    const legend = h('div', { class: 'win-legend' },
      r.teams.map((t, i) => h('div', { class: 'item' }, h('span', { class: 'team-dot', style: { background: teamColor(i) } }), h('span', null, t.name), h('span', { class: 'rate' }, pct(t.rate)), h('span', { class: 'small faint num' }, '±' + pct(t.ci)))),
      h('div', { class: 'item' }, h('span', { class: 'team-dot', style: { background: 'var(--t-draw)' } }), h('span', null, '引き分け'), h('span', { class: 'rate' }, pct(r.drawRate))));
    box.append(bar, legend);

    box.append(h('div', { class: 'kpis' },
      kpi(fmt(r.rounds.mean, 2), '平均 巡数（全ターン合計）'),
      kpi(fmt(r.rounds.median, 1), '巡数 中央値'),
      kpi(`${r.rounds.min}〜${r.rounds.max}`, '巡数 最短〜最長'),
      kpi(fmt(r.engagements.mean, 2), '平均 ターン数'),
      kpi(r.trials.toLocaleString(), '試行回数')));

    box.append(h('div', { class: 'stack', style: { gap: '4px' } }, h('h3', null, '決着までの巡数の分布'), histogram(r.rounds.hist, r.trials)));

    // キャラ別
    const rows = r.units.map((u) => h('tr', null,
      h('td', null, h('span', { class: 'row tight', style: { flexWrap: 'nowrap' } }, h('span', { class: 'team-dot', style: { background: teamColor(u.team) } }), u.name,
        u.summoned ? h('span', { class: 'pill skill', title: '1戦闘あたりの平均召喚数' }, `召喚 平均${fmt(u.countAvg, 1)}体`) : null)),
      h('td', { class: 'n', title: u.summoned ? '召喚された個体のうち倒された割合' : null }, pct(u.deathRate), h('span', { class: 'meter' }, h('i', { style: { width: pct(u.deathRate, 2) } }))),
      h('td', { class: 'n' }, fmt(u.dmgDealt)),
      h('td', { class: 'n' }, fmt(u.dmgTaken)),
      h('td', { class: 'n' }, fmt(u.dmgPerAttack, 2)),
      h('td', { class: 'n' }, fmt(u.attacks, 2)),
      h('td', { class: 'n' }, fmt(u.kills, 2)),
      h('td', { class: 'n' }, fmt(u.healed)),
      h('td', { class: 'n' }, `${fmt(u.hpEndAvg)} / ${fmt(u.maxHpAvg, 0)}`, h('span', { class: 'meter hp' }, h('i', { style: { width: pct(u.maxHpAvg ? u.hpEndAvg / u.maxHpAvg : 0, 2) } })))));
    box.append(h('div', { class: 'stack', style: { gap: '4px' } }, h('h3', null, 'キャラクター別（1戦闘あたり平均）'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, ['キャラクター', '死亡率', '与ダメージ', '被ダメージ', '1攻撃あたり', '攻撃回数', '撃破数', '回復量', '生存時の残HP'].map((x, i) => h('th', { class: i ? 'n' : null }, x)))),
        h('tbody', null, rows)))));

    // スキル
    const srows = [];
    r.units.forEach((u) => {
      const ch = D.characters.find((c) => c.name === u.name);
      const names = new Set(Object.keys(u.skillUse));
      if (u.summoned && !names.size) return;
      if (ch) for (const s of ch.skills || []) if (isTracked(s)) names.add(s.name);
      for (const n of names) {
        const s = ch && (ch.skills || []).find((x) => x.name === n);
        srows.push(h('tr', null,
          h('td', null, h('span', { class: 'row tight', style: { flexWrap: 'nowrap' } }, h('span', { class: 'team-dot', style: { background: teamColor(u.team) } }), u.name)),
          h('td', null, s ? h('span', { class: 'pill ' + (s.kind || 'skill') }, KIND_LABEL[s.kind] || 'スキル') : /^令呪：/.test(n) ? h('span', { class: 'pill cs' }, '令呪') : null, ' ', n.replace(/^令呪：/, '')),
          h('td', { class: 'n' }, fmt(u.skillUse[n] || 0, 2)),
          h('td', { class: 'small muted' }, s ? limitText(s) : /^令呪：/.test(n) ? '消費画数' : '')));
      }
    });
    if (srows.length) {
      box.append(h('div', { class: 'stack', style: { gap: '4px' } }, h('h3', null, 'スキル・宝具の使用回数（1戦闘あたり）'),
        h('p', { class: 'small muted' }, '回数制限・リソース消費のあるスキル、発動した状態付与・耐える系スキル、令呪の使用（画数）を集計しています。常時効く補正は含みません。'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, 'キャラクター'), h('th', null, 'スキル'), h('th', { class: 'n' }, '使用回数'), h('th', null, '制限'))),
          h('tbody', null, srows)))));
    }

    if (r.warnings && r.warnings.length) {
      box.append(h('div', { class: 'notice' }, h('b', null, '設定の警告'), h('ul', null, r.warnings.slice(0, 12).map((w) => h('li', null, w)))));
    }

    if (r.logs && r.logs.length) {
      const logBox = h('details', { class: 'log', open: true });
      const pre = h('pre', { class: 'logtext' });
      const pick = h('select', { class: 'w-sm', 'aria-label': '表示する試行' }, r.logs.map((_, i) => h('option', { value: i }, `試行 ${i + 1}`)));
      const paint = () => { pre.textContent = r.logs[+pick.value].join('\n'); };
      pick.addEventListener('change', paint);
      paint();
      logBox.append(h('summary', null, '代表試行の詳細ログ'), h('div', { class: 'row', style: { padding: '0 12px 8px' } }, pick), pre);
      box.append(logBox);
    }

    if (withSave) {
      const label = { v: r.scenarioName + '（' + new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) + '）' };
      box.append(h('div', { class: 'row' },
        h('div', { style: { flex: '1 1 200px', minWidth: 0 } }, txt(label, 'v', { label: '比較用の名前' })),
        btn('比較用に保存', () => {
          saved.push({ id: uid('rs'), label: label.v, scenarioName: r.scenarioName, trials: r.trials, teams: r.teams.map((t) => ({ name: t.name, rate: t.rate, ci: t.ci })), drawRate: r.drawRate, roundsMean: r.rounds.mean, units: r.units.map((u) => ({ name: u.name, team: u.team, deathRate: u.deathRate, dmgDealt: u.dmgDealt })) });
          saveSaved(); toast('保存しました（比較タブで並べて見られます）');
        })));
    }
    return box;
  }
  function isTracked(s) { return (s.uses && +s.uses.max > 0) || (s.resource && s.resource.key) || +s.csUse > 0; }
  function limitText(s) {
    const a = [];
    if (s.uses && +s.uses.max > 0) a.push(`${PER_LABEL[s.uses.per] || s.uses.per}に${s.uses.max}回`);
    if (s.resource && s.resource.key) a.push(`${s.resource.key} −${s.resource.amount || 1}`);
    return a.join('・');
  }
  const kpi = (v, l) => h('div', { class: 'kpi' }, h('b', null, v), h('span', null, l));

  // ------------------------------------------------------------------
  // グラフ（SVG）
  // ------------------------------------------------------------------
  const SVGNS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, text) {
    const el = document.createElementNS(SVGNS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }
  function histogram(hist, n) {
    const keys = Object.keys(hist).map(Number).sort((a, b) => a - b);
    const W = 640, H = 170, L = 40, R = 10, T = 10, B = 26;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': '巡数の分布' });
    if (!keys.length) return svg;
    const lo = keys[0], hi = keys[keys.length - 1];
    const span = hi - lo + 1;
    const maxP = niceMax(Math.max(...keys.map((k) => hist[k] / n)));
    const bw = (W - L - R) / span;
    for (let i = 0; i <= 4; i++) {
      const y = T + (H - T - B) * (1 - i / 4);
      svg.append(s('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'grid-line' }), s('text', { x: L - 6, y: y + 4, 'text-anchor': 'end' }, pct((maxP * i) / 4, 0)));
    }
    const every = Math.ceil(span / 16);
    for (let k = lo; k <= hi; k++) {
      const p = (hist[k] || 0) / n;
      const x = L + (k - lo) * bw;
      const bh = (H - T - B) * (p / maxP);
      const r = s('rect', { x: x + bw * 0.12, y: H - B - bh, width: Math.max(1, bw * 0.76), height: bh, fill: 'var(--accent)', rx: 2 });
      r.append(s('title', {}, `${k}巡：${pct(p)}`));
      svg.append(r);
      if ((k - lo) % every === 0) svg.append(s('text', { x: x + bw / 2, y: H - 8, 'text-anchor': 'middle' }, String(k)));
    }
    svg.append(s('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, class: 'axis' }));
    return svg;
  }
  function lineChart(xs, series, o) {
    const W = 680, H = 260, L = 46, R = 14, T = 12, B = 36;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': o.label || 'グラフ' });
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const X = (v) => L + (x1 === x0 ? (W - L - R) / 2 : ((v - x0) / (x1 - x0)) * (W - L - R));
    const Y = (v) => T + (H - T - B) * (1 - v);
    for (let i = 0; i <= 4; i++) {
      const v = i / 4;
      svg.append(s('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'grid-line' }), s('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end' }, pct(v, 0)));
    }
    svg.append(s('line', { x1: L, x2: W - R, y1: Y(0.5), y2: Y(0.5), stroke: 'var(--line-strong)', 'stroke-dasharray': '4 4' }));
    const every = Math.ceil(xs.length / 12);
    xs.forEach((v, i) => { if (i % every === 0 || i === xs.length - 1) svg.append(s('text', { x: X(v), y: H - 16, 'text-anchor': 'middle' }, String(v))); });
    svg.append(s('text', { x: (L + W - R) / 2, y: H - 2, 'text-anchor': 'middle' }, o.xLabel || ''));
    for (const se of series) {
      const d = xs.map((v, i) => `${i ? 'L' : 'M'}${X(v).toFixed(1)},${Y(se.values[i]).toFixed(1)}`).join(' ');
      svg.append(s('path', { d, fill: 'none', stroke: se.color, 'stroke-width': 2.4, 'stroke-linejoin': 'round' }));
      xs.forEach((v, i) => {
        const c = s('circle', { cx: X(v), cy: Y(se.values[i]), r: 3.6, fill: se.color, stroke: 'var(--surface)', 'stroke-width': 1.5 });
        c.append(s('title', {}, `${se.name}：${o.xLabel} ${v} → ${pct(se.values[i])}`));
        svg.append(c);
      });
    }
    return svg;
  }
  function barCompare(items) {
    // items: [{label, segs:[{v, color, name}]}]
    const box = h('div', { class: 'stack', style: { gap: '6px' } });
    for (const it of items) {
      const bar = h('div', { class: 'winbar', style: { height: '24px' } });
      for (const sg of it.segs) if (sg.v > 0) bar.append(h('div', { style: { width: pct(sg.v, 3), background: sg.color }, title: `${sg.name} ${pct(sg.v)}` }, sg.v > 0.1 ? pct(sg.v, 0) : ''));
      box.append(h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 220px) minmax(0,1fr)', gap: '10px', alignItems: 'center' } }, h('span', { class: 'small', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: it.label }, it.label), bar));
    }
    return box;
  }

  // ------------------------------------------------------------------
  // キャラクタータブ
  // ------------------------------------------------------------------
  function renderChars() {
    if (!D.characters.find((c) => c.id === UI.charId)) UI.charId = D.characters[0] ? D.characters[0].id : null;
    const listPanel = h('section', { class: 'panel stack', 'aria-label': 'キャラクター一覧' });
    listPanel.append(h('div', { class: 'section-head' }, h('h2', null, 'キャラクター'), h('span', { class: 'small muted num' }, D.characters.length + '件')));
    const filter = txt(UI, 'charFilter', { ph: '名前・クラス・タグで絞り込み', label: '絞り込み', onInput: () => paintList() });
    listPanel.append(filter);
    listPanel.append(h('div', { class: 'row' },
      btn('新規', () => { const c = newCharacter(); D.characters.push(c); UI.charId = c.id; save(); render(); }, 'sm'),
      btn('キャラシート取り込み', () => { UI.importOpen = !UI.importOpen; render(); }, 'sm')));
    listPanel.append(h('div', { class: 'row' },
      btn('書き出し…', () => { UI.charExportOpen = !UI.charExportOpen; if (UI.charExportOpen && !(UI.charSel || []).length && UI.charId) UI.charSel = [UI.charId]; render(); }, 'sm'),
      btn('読み込み…', () => { UI.importDialog = { mode: 'input' }; render(); }, 'sm')));
    const list = h('div', { class: 'list', role: 'list' });
    listPanel.append(list);
    function paintList() {
      list.innerHTML = '';
      const q = (UI.charFilter || '').trim();
      const groups = new Map();
      for (const c of D.characters) {
        if (q && !(c.name + ' ' + (c.cls || '') + ' ' + (c.tags || []).join(' ')).includes(q)) continue;
        const g = c.cls || 'その他';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(c);
      }
      for (const [g, cs] of groups) {
        list.append(h('div', { class: 'list-group' }, g));
        for (const c of cs) {
          list.append(h('button', { type: 'button', 'aria-current': c.id === UI.charId ? 'true' : 'false', onclick: () => { UI.charId = c.id; UI.confirm = null; save(); render(); } },
            h('span', { class: 'nm' }, c.name), h('span', { class: 'cls num' }, E.heroPoints(D.rules, c).total + '点')));
        }
      }
    }
    paintList();

    const right = h('div', { class: 'stack' });
    if (UI.charExportOpen) right.append(charExportPanel());
    if (UI.importOpen) right.append(importPanel());
    const c = D.characters.find((x) => x.id === UI.charId);
    if (c) right.append(charEditor(c));
    else right.append(h('div', { class: 'panel result-empty' }, 'キャラクターがありません。「新規」か「キャラシート取り込み」で追加してください。'));
    return h('div', { class: 'editor-layout' }, listPanel, right);
  }

  function newCharacter() {
    const stats = {};
    for (const st of D.rules.stats) stats[st.key] = 'C';
    return { id: uid('ch'), name: '新しいキャラクター', cls: 'セイバー', tags: [], stats, hpExtra: 0, actions: 1, resources: [{ key: 'np', name: '宝具', max: 1 }], skills: [], ai: { target: 'smart', tag: '' }, note: '' };
  }

  function charEditor(c) {
    const rerender = () => render();
    const panel = h('section', { class: 'panel stack', 'aria-label': 'キャラクター編集' });
    c.ai = c.ai || { target: 'smart', tag: '' };
    c.resources = c.resources || [];
    c.skills = c.skills || [];
    const hp = E.heroPoints(D.rules, c);
    const used = D.scenarios.filter((sc) => sc.teams.some((t) => t.members.some((m) => m.charId === c.id)));

    panel.append(h('div', { class: 'section-head' }, h('h2', null, c.name),
      h('div', { class: 'row' },
        btn('書き出し', () => exportItems(bundleCharacters([c.id]), `キャラ_${safeName(c.name)}.json`, 'file'), 'sm', { title: 'このキャラクターを、付与する状態や召喚先と一緒にJSONファイルに書き出します' }),
        btn('テキストでコピー', () => exportItems(bundleCharacters([c.id]), '', 'text'), 'sm', { title: 'チャットなどに貼り付けて共有できるテキストとしてコピー' }),
        btn('複製', () => { const n = clone(c); n.id = uid('ch'); n.name += '（コピー）'; n.skills.forEach((s) => { s.id = uid('sk'); }); D.characters.push(n); UI.charId = n.id; save(); render(); }, 'sm'),
        confirmBtn('削除', 'del-ch-' + c.id, () => {
          D.characters = D.characters.filter((x) => x !== c);
          for (const sc of D.scenarios) for (const t of sc.teams) t.members = t.members.filter((m) => m.charId !== c.id);
          UI.charId = null; save(); render();
        }))));
    if (used.length) panel.append(h('p', { class: 'small muted' }, '使用中のテストケース：' + used.map((x) => x.name).join('、')));

    const tagsObj = { v: (c.tags || []).join(', ') };
    panel.append(h('div', { class: 'grid wide' },
      field('名前', txt(c, 'name', { onChange: rerender })),
      field('クラス・分類', txt(c, 'cls', { onChange: rerender })),
      field('タグ（カンマ区切り）', txt(tagsObj, 'v', { ph: '竜種, 人属性, ボス', onInput: (v) => { c.tags = v.split(/[,、]+/).map((x) => x.trim()).filter(Boolean); save(); } })),
      field('HP補正（式で出た最大HPに加算）', num(c, 'hpExtra', { onChange: rerender })),
      field('1手番の行動回数', num(c, 'actions', { min: 1, max: 10, onChange: rerender }), { title: 'ボスなど、1回の手番で複数回攻撃するキャラクター用' }),

      field('攻撃対象の選び方（AI）', sel(c.ai, 'target', E.TARGET_POLICIES, { onChange: rerender })),
      c.ai.target === 'tag' ? field('優先するタグ', txt(c.ai, 'tag', { ph: 'ボス' })) : null));

    // ステータス
    const sg = h('div', { class: 'stat-grid' });
    for (const st of D.rules.stats) {
      c.stats[st.key] = c.stats[st.key] === undefined ? 'C' : c.stats[st.key];
      const info = E.rankInfo(D.rules, c.stats[st.key]);
      const val = h('span', { class: 'val' }, `値 ${info.value} ・ ${info.cost}点${info.ex ? ' ・ EX' : ''}${info.unknown ? ' ・ 不明' : ''}`);
      const inp = txt(c.stats, st.key, { list: 'dl-ranks', label: st.name + 'のランク', onInput: () => {
        const i2 = E.rankInfo(D.rules, c.stats[st.key]);
        val.textContent = `値 ${i2.value} ・ ${i2.cost}点${i2.ex ? ' ・ EX' : ''}${i2.unknown ? ' ・ 不明' : ''}`;
        paintSummary();
      } });
      sg.append(h('div', { class: 'stat-cell' }, h('label', null, `${st.name}（${st.key}）`), inp, val));
    }
    panel.append(h('div', { class: 'stack', style: { gap: '6px' } }, h('h3', null, 'ステータス（ランクまたは数値）'), sg));
    const strip = h('div', { class: 'summary-strip' });
    function paintSummary() {
      const hp2 = E.heroPoints(D.rules, c);
      const ex = D.rules.stats.filter((st) => E.rankInfo(D.rules, c.stats[st.key]).ex).length;
      strip.innerHTML = '';
      strip.append(
        h('div', null, h('span', { class: 'small muted' }, '最大HP（目安）'), h('b', null, E.previewMaxHp(D.rules, c))),
        h('div', null, h('span', { class: 'small muted' }, '英雄点'), h('b', null, hp2.total), h('span', { class: 'small muted num' }, `（ステ ${hp2.stat}・スキル ${hp2.skill}）`)),
        h('div', null, h('span', { class: 'small muted' }, 'EX振り直し'), h('b', null, ex), h('span', { class: 'small muted' }, '回／交戦フェイズ')));
    }
    paintSummary();
    panel.append(strip);
    panel.append(csSection(c));
    void hp;

    // リソース
    const rs = h('div', { class: 'stack', style: { gap: '6px' } }, h('h3', null, 'リソース（宝具回数・独自ゲージなど）'));
    c.resources.forEach((r, i) => rs.append(h('div', { class: 'row' },
      h('div', { class: 'w-sm' }, txt(r, 'key', { cls: 'expr', ph: 'キー', label: 'キー' })),
      h('div', { style: { flex: '1 1 120px', minWidth: 0 } }, txt(r, 'name', { ph: '表示名', label: '表示名' })),
      h('span', { class: 'small muted' }, '最大'), num(r, 'max', { cls: 'w-num', label: '最大値' }),
      btn('×', () => { c.resources.splice(i, 1); save(); rerender(); }, 'ghost icon sm', { title: 'リソースを削除', 'aria-label': 'リソースを削除' }))));
    rs.append(h('div', null, btn('＋ リソース', () => { c.resources.push({ key: 'res' + (c.resources.length + 1), name: '', max: 1 }); save(); rerender(); }, 'sm')));
    panel.append(rs);
    panel.append(field('メモ', (() => { const t = h('textarea', { rows: 2 }); t.value = c.note || ''; t.addEventListener('input', () => { c.note = t.value; save(); }); return t; })()));

    // スキル
    const sk = h('div', { class: 'stack', style: { gap: '8px' } }, h('div', { class: 'section-head' }, h('h3', null, 'スキル・宝具'),
      h('div', { class: 'row' },
        btn('すべて開く', () => { c.skills.forEach((s) => { UI.open[s.id] = true; }); rerender(); }, 'ghost sm'),
        btn('すべて閉じる', () => { c.skills.forEach((s) => { UI.open[s.id] = false; }); rerender(); }, 'ghost sm'))));
    c.skills.forEach((s, i) => sk.append(skillCard(c, s, i, rerender)));
    sk.append(h('div', { class: 'row' },
      btn('＋ スキル', () => { const s = { id: uid('sk'), name: '新しいスキル', rank: '', kind: 'skill', cost: 5, blocks: [], uses: null, resource: null, ai: { policy: 'asap', threshold: 50 }, note: '' }; c.skills.push(s); UI.open[s.id] = true; save(); rerender(); }, 'sm'),
      btn('＋ 宝具', () => { const s = { id: uid('sk'), name: '新しい宝具', rank: '', kind: 'np', cost: 0, blocks: [{ timings: ['attack'], types: [], cond: { mode: 'all', rows: [] }, effects: [{ type: 'mod', value: '10', upTo: true }] }], uses: null, resource: { key: 'np', amount: 1 }, ai: { policy: 'asap', threshold: 50 }, note: '' }; c.skills.push(s); UI.open[s.id] = true; save(); rerender(); }, 'sm')));
    panel.append(sk);
    return panel;
  }

  function csSection(c) {
    c.csCostMode = c.csCostMode || 'auto';
    const box = h('div', { class: 'stack', style: { gap: '6px' } });
    const isMaster = (c.tags || []).includes(D.rules.masterTag || 'マスター');
    if (isMaster) {
      const hb = (c.skills || []).reduce((a, sk) => a + (+sk.heroBonus || 0), 0);
      const g = (c.skills || []).reduce((a, sk) => a + (+sk.csGain || 0), 0);
      box.append(h('h3', null, '令呪（マスター）'),
        h('p', { class: 'small muted' }, `契約サーヴァントの英雄点の予算に ${hb >= 0 ? '+' : ''}${hb}点${g ? `、初期令呪 +${g}画（上限3）` : ''}。初期令呪 ＝ 3${g ? ' + ' + g : ''} − 契約サーヴァントの令呪コスト。`));
      return box;
    }
    const pl = E.csPlan(D.rules, c, null);
    const hb = D.rules.heroBudget || { base: 30, perCs: 5 };
    const lines = [
      `英雄点 ${pl.hero}点${c.sheetHero !== undefined ? `（シート記載 ${c.sheetHero}点）` : ''}`,
      `予算 ${pl.budget}点 ＝ 基本${hb.base}${pl.bonusServant ? ` ＋ スキル${pl.bonusServant}` : ''}`,
      `超過 ${pl.over}点 → ${pl.fromPoints}画（${hb.perCs}点ごとに1画）`,
      pl.loss ? `作成時に失う令呪 ${pl.loss}画` : null,
    ].filter(Boolean);
    const warn = [];
    if (c.sheetHero !== undefined && c.sheetHero !== pl.hero) warn.push(`ランクとスキルから計算した英雄点（${pl.hero}点）がシート記載（${c.sheetHero}点）と違います。ランクかスキルの点数を確認してください。`);
    if (c.sheetCs !== undefined && c.csCostMode === 'auto' && c.sheetCs !== pl.cost) warn.push(`計算した令呪コスト（${pl.cost}画）がシート記載（${c.sheetCs}画）と違います。スキルの「英雄点ボーナス」「作成時の令呪喪失」を確認するか、手動にしてください。`);
    box.append(h('div', { class: 'section-head' }, h('h3', null, '令呪コストと初期令呪'),
      sel(c, 'csCostMode', [['auto', '英雄点から自動計算'], ['manual', '手動で指定']], { cls: 'w-md', onChange: () => render() })));
    if (c.csCostMode === 'manual') {
      box.append(h('div', { class: 'row' }, field('令呪コスト（画）', num(c, 'csCost', { min: 0, max: 3, cls: 'w-num', onChange: () => render() }))));
    } else {
      box.append(h('div', { class: 'summary-strip' }, lines.map((l) => h('div', null, h('span', { class: 'small' }, l)))));
    }
    box.append(h('p', { class: 'small' }, h('b', null, `令呪コスト ${pl.cost}画 → 初期令呪 ${pl.start}画`), h('span', { class: 'muted' }, '（マスター未配置の場合。契約マスターに「英雄点を得る」スキルがあると予算が増え、令呪コストが下がります）')));
    if (warn.length) box.append(h('div', { class: 'notice' }, warn.map((w) => h('div', null, w))));
    return box;
  }

  function skillCard(c, s, i, rerender) {
    s.id = s.id || uid('sk');
    s.ai = s.ai || { policy: 'asap', threshold: 50 };
    const open = !!UI.open[s.id];
    const card = h('div', { class: 'skill-card' + (open ? '' : ' collapsed') });
    card.append(h('div', { class: 'skill-head' },
      h('button', { type: 'button', class: 'btn ghost icon sm', 'aria-expanded': open ? 'true' : 'false', 'aria-label': open ? '閉じる' : '開く', onclick: () => { UI.open[s.id] = !open; rerender(); } }, open ? '▾' : '▸'),
      h('span', { class: 'pill ' + (s.kind || 'skill') }, KIND_LABEL[s.kind] || 'スキル'),
      h('span', { class: 'nm' }, s.name, s.rank ? h('span', { class: 'muted small' }, '　' + s.rank) : null),
      h('span', { class: 'small muted num' }, s.kind === 'np' ? '' : (s.cost || 0) + '点'),
      h('span', { class: 'row tight' },
        btn('↑', () => { moveItem(c.skills, i, -1); save(); rerender(); }, 'ghost icon sm', { title: '上へ', 'aria-label': '上へ' }),
        btn('↓', () => { moveItem(c.skills, i, 1); save(); rerender(); }, 'ghost icon sm', { title: '下へ', 'aria-label': '下へ' }),
        btn('複製', () => { const n = clone(s); n.id = uid('sk'); n.name += '（2）'; c.skills.splice(i + 1, 0, n); save(); rerender(); }, 'ghost sm'),
        btn('削除', () => { c.skills.splice(i, 1); save(); rerender(); }, 'ghost sm'))));
    if (!open) {
      card.append(h('div', { class: 'summary-line', style: { padding: '0 10px 8px 46px' } }, describeSkill(s), s.note ? h('div', { class: 'faint' }, s.note) : null));
      return card;
    }
    const body = h('div', { class: 'skill-body' });
    s.uses = s.uses || { max: '', per: 'battle' };
    const resObj = s.resource || { key: '', amount: 1 };
    const resKeys = [['', 'なし']].concat((c.resources || []).map((r) => [r.key, `${r.name || r.key}（${r.key}）`]));
    body.append(h('div', { class: 'grid wide' },
      field('名前', txt(s, 'name', { onChange: rerender })),
      field('ランク', txt(s, 'rank', { ph: 'A+' })),
      field('種別', sel(s, 'kind', [['class', 'クラススキル'], ['skill', 'スキル'], ['np', '宝具']], { onChange: rerender })),
      field('英雄点コスト', num(s, 'cost', { onChange: rerender }))));
    body.append(h('div', { class: 'grid wide' },
      field('使用回数（空欄＝無制限）', h('div', { class: 'row tight' }, num(s.uses, 'max', { allowEmpty: true, min: 1, cls: 'w-num', ph: '∞', label: '最大回数' }), sel(s.uses, 'per', [['round', '1巡ごと'], ['engagement', '交戦フェイズごと'], ['battle', 'セッション中']], { label: 'リセット単位' }))),
      field('消費リソース', h('div', { class: 'row tight' }, sel(resObj, 'key', resKeys, { onChange: (v) => { s.resource = v ? { key: v, amount: +resObj.amount || 1 } : null; save(); rerender(); } }),
        s.resource ? num(s.resource, 'amount', { min: 1, cls: 'w-num', label: '消費量' }) : null)),
      field('令呪消費（発動に必要な画数）', num(s, 'csUse', { min: 0, max: 3, ph: '0' }), { title: 'エヌマ・エリシュのように令呪を消費して発動する宝具用。令呪が足りないと使えません' }),
      field('英雄点ボーナス（作成時に得る点）', num(s, 'heroBonus', { ph: '0', onChange: rerender }), { title: '対魔力（+5）、神性（+10）、マスターのDRONE（+5）など「英雄点を得る」スキル。令呪コストの予算に加算されます' }),
      field('作成時に失う令呪（画）', num(s, 'csLoss', { min: 0, max: 3, ph: '0', onChange: rerender }), { title: '狂化EX・Bの「令呪を1つ失う」、宝具の「キャラシート作成時、令呪1画消費」など' }),
      field('初期令呪の増加（画）', num(s, 'csGain', { min: 0, max: 3, ph: '0', onChange: rerender }), { title: 'STIGMATAの「初期令呪を1増やす（上限3）」など' }),
      field('AIの使い方（制限付きのみ）', h('div', { class: 'row tight' }, sel(s.ai, 'policy', E.AI_POLICIES, { onChange: rerender }),
        ['finisher', 'hpBelow'].includes(s.ai.policy) ? num(s.ai, 'threshold', { cls: 'w-num', min: 0, max: 100, label: 'しきい値（%）' }) : null))));
    body.append(field('メモ（元の効果文・近似の説明など）', (() => { const t = h('textarea', { rows: 2 }); t.value = s.note || ''; t.addEventListener('input', () => { s.note = t.value; save(); }); return t; })()));
    body.append(blocksEditor(s, rerender));
    card.append(body);
    return card;
  }

  // キャラシート取り込み
  function normalizeSheet(t) {
    return t.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ').replace(/\r/g, '');
  }
  /** スキル・宝具の説明文から、キャラシート作成時の効果（英雄点・令呪）を読み取る */
  function sheetCreationEffects(text) {
    const o = {};
    const gain = text.match(/英雄点\s*(\d+)\s*を得る/);
    if (gain) o.heroBonus = +gain[1];
    const lose = text.match(/英雄点を\s*(\d+)\s*点減らす/);
    if (lose) o.heroBonus = -(+lose[1]);
    if (/作成時[、,]?\s*令呪を\s*1\s*つ失う|作成時[、,]?\s*令呪\s*1\s*画(消費|失う)/.test(text)) o.csLoss = 1;
    const g = text.match(/初期令呪を\s*(\d)\s*増やす/);
    if (g) o.csGain = +g[1];
    return o;
  }

  function parseSheets(text) {
    const src = normalizeSheet(text);
    const chunks = src.split(/\n(?=【クラス】)/).map((x) => x.trim()).filter((x) => x.includes('【クラス】'));
    const out = [];
    for (const raw of chunks) {
      const chunk = raw.split(/\n-{3,}\s*\n?/)[0];
      const get = (re) => { const m = chunk.match(re); return m ? m[1].trim() : ''; };
      const c = newCharacter();
      c.cls = get(/【クラス】\s*([^\n]+)/);
      c.name = get(/【(?:真名|名前)】\s*([^\n]+)/) || '名称未設定';
      for (const st of D.rules.stats) {
        // 「Ａ+：６（７）」「？：８（１０）」など。ランクが読めなければ数値と点数から対応するランクを探す
        const m = chunk.match(new RegExp('【' + st.name + '】\\s*([^:：\\n]*?)\\s*[:：]\\s*(\\d+)\\s*(?:[（(]\\s*(\\d+)\\s*[)）])?'));
        if (!m) continue;
        const rk = m[1].trim().toUpperCase();
        const val = +m[2], cost = m[3] !== undefined ? +m[3] : val;
        if (/^(EX|[A-E][+\\-]*)$/.test(rk) && D.rules.ranks.some((r) => r.rank === rk)) c.stats[st.key] = rk;
        else {
          const hit = D.rules.ranks.find((r) => +r.value === val && +r.cost === cost && !/[+]/.test(r.rank)) || D.rules.ranks.find((r) => +r.value === val && +r.cost === cost);
          c.stats[st.key] = hit ? hit.rank : String(val);
        }
      }
      const hpM = chunk.match(/【HP】\s*(\d+)/);
      if (hpM) {
        const base = E.baseMaxHp(D.rules, Object.assign({}, c, { hpExtra: 0 }));
        c.hpExtra = +hpM[1] - base;
      }
      const csM = chunk.match(/【英雄点】[^\n]*令呪\s*(\d)\s*画消費/);
      const heroM = chunk.match(/【英雄点】\s*(\d+)/);
      c.csCostMode = 'auto';
      c.csCost = csM ? +csM[1] : 0;
      if (heroM) c.sheetHero = +heroM[1];
      if (/【英雄点】/.test(chunk)) c.sheetCs = csM ? +csM[1] : 0;
      const tags = get(/【その他】\s*([^\n]+)/);
      c.tags = tags ? tags.split(/[\s、,]+/).filter(Boolean) : [];
      // スキル
      const lines = chunk.split('\n');
      c.skills = [];
      for (let i = 0; i < lines.length; i++) {
        const sm = lines[i].match(/^【スキル(\d+)】\s*(.+)$/);
        if (sm) {
          const parts = sm[2].trim().split(/\s+/);
          let rank = '';
          if (parts.length > 1 && /^(EX|[A-E][+\-]*)$/i.test(parts[parts.length - 1])) rank = parts.pop();
          const nameS = parts.join(' ');
          let cost = 0; const desc = [];
          for (let j = i + 1; j < lines.length && !/^【/.test(lines[j]); j++) {
            const cm = lines[j].match(/^\s*(\d+)点\s*[:：]?\s*(.*)$/);
            if (cm) { cost = +cm[1]; desc.push(cm[2]); } else desc.push(lines[j].trim());
          }
          const text = desc.join(' ');
          const sk = { id: uid('sk'), name: nameS, rank, kind: sm[1] === '1' ? 'class' : 'skill', cost, blocks: [], uses: null, resource: null, ai: { policy: 'asap', threshold: 50 }, note: desc.filter(Boolean).join('\n') };
          Object.assign(sk, sheetCreationEffects(text));
          c.skills.push(sk);
        }
        const nm = lines[i].match(/^【宝具(\d*)】\s*『(.+?)』/);
        if (nm) {
          const desc = [];
          let rank = '';
          for (let j = i + 1; j < lines.length && !/^【(宝具|その他|スキル|クラス)/.test(lines[j]); j++) {
            const rk = lines[j].match(/^【ランク・種別】\s*([^:：\s]+)/);
            if (rk) rank = rk[1];
            desc.push(lines[j].replace(/^【効果】/, '').trim());
          }
          const key = nm[1] && nm[1] !== '1' ? 'np' + nm[1] : 'np';
          if (!c.resources.some((r) => r.key === key)) c.resources.push({ key, name: '宝具' + (nm[1] || ''), max: 1 });
          const text = desc.join(' ');
          const npSk = { id: uid('sk'), name: nm[2], rank, kind: 'np', cost: 0, blocks: [], uses: null, resource: { key, amount: 1 }, ai: { policy: 'asap', threshold: 50 }, note: desc.filter(Boolean).join('\n') };
          Object.assign(npSk, sheetCreationEffects(text));
          const lostHero = text.match(/英雄点を\s*(\d+)\s*点失う/);
          if (lostHero) npSk.cost = +lostHero[1];
          if (/令呪を\s*1\s*つ消費して発動/.test(text)) npSk.csUse = 1;
          c.skills.push(npSk);
        }
      }
      c.note = 'キャラシートから取り込み。スキル効果はメモを見ながらブロックを設定してください。HP補正にはスキルによる最大HP増加分も含めています（最大HP増加の効果を追加する場合はHP補正を減らしてください）。';
      out.push(c);
    }
    return out;
  }
  function importPanel() {
    const ta = h('textarea', { rows: 8, placeholder: '【クラス】セイバー\n【真名】…\n【筋力】A ：5\n…\n【スキル1】対魔力 A\n5点：…' });
    const preview = h('div', { class: 'small muted' });
    ta.addEventListener('input', () => {
      const r = parseSheets(ta.value);
      preview.textContent = r.length ? '検出：' + r.map((c) => `${c.name}（${c.cls}）`).join('、') : '';
    });
    return h('section', { class: 'panel stack', 'aria-label': 'キャラシート取り込み' },
      h('div', { class: 'section-head' }, h('h2', null, 'キャラシート取り込み'), h('p', null, '【クラス】【真名】【筋力】…形式のテキストを貼り付け。複数可（--- 区切り）。')),
      ta, preview,
      h('div', { class: 'row' }, btn('取り込む', () => {
        const r = parseSheets(ta.value);
        if (!r.length) { toast('【クラス】で始まるキャラシートが見つかりませんでした'); return; }
        D.characters.push(...r); UI.charId = r[0].id; UI.importOpen = false; save(); render();
        toast(`${r.length}件のキャラクターを追加しました。スキル効果を設定してください。`);
      }, 'primary'), btn('閉じる', () => { UI.importOpen = false; render(); }, 'ghost')));
  }

  // ------------------------------------------------------------------
  // 状態タブ
  // ------------------------------------------------------------------
  function renderStates() {
    if (!D.states.find((x) => x.id === UI.stateId)) UI.stateId = D.states[0] ? D.states[0].id : null;
    const listPanel = h('section', { class: 'panel stack', 'aria-label': '状態一覧' },
      h('div', { class: 'section-head' }, h('h2', null, '状態'), h('span', { class: 'small muted num' }, D.states.length + '件')),
      h('p', { class: 'small muted' }, 'バフ・デバフ・場の効果など。スキルの「状態を付与」から名前で参照します。'),
      h('div', null, btn('新規', () => { const s = { id: uid('st'), name: '新しい状態', debuff: false, duration: 'engagement', durationValue: 1, charges: 0, blocks: [], note: '' }; D.states.push(s); UI.stateId = s.id; save(); render(); }, 'sm')));
    const list = h('div', { class: 'list' });
    for (const s of D.states) list.append(h('button', { type: 'button', 'aria-current': s.id === UI.stateId ? 'true' : 'false', onclick: () => { UI.stateId = s.id; save(); render(); } },
      h('span', { class: 'nm' }, s.name), h('span', { class: 'pill ' + (s.debuff ? 'debuff' : 'buff') }, s.debuff ? 'デバフ' : 'バフ')));
    listPanel.append(list);
    const s = D.states.find((x) => x.id === UI.stateId);
    const right = h('section', { class: 'panel stack', 'aria-label': '状態の編集' });
    if (!s) right.append(h('div', { class: 'result-empty' }, '状態がありません。'));
    else {
      const rer = () => render();
      const oldName = s.name;
      right.append(h('div', { class: 'section-head' }, h('h2', null, s.name),
        h('div', { class: 'row' }, confirmBtn('削除', 'del-st-' + s.id, () => { D.states = D.states.filter((x) => x !== s); UI.stateId = null; save(); render(); }))));
      right.append(h('div', { class: 'grid wide' },
        field('名前', txt(s, 'name', { onChange: (v) => {
          // 参照している効果の名前も追従
          for (const c of D.characters) for (const sk of c.skills || []) for (const b of sk.blocks || []) for (const e of b.effects || []) if (e.type === 'applyState' && e.state === oldName) e.state = v;
          for (const st of D.states) for (const b of st.blocks || []) for (const e of b.effects || []) if (e.type === 'applyState' && e.state === oldName) e.state = v;
          save(); rer();
        } })),
        field('種類', chk(s, 'debuff', 'デバフとして扱う（デバフ無効・解除の対象）')),
        field('持続', h('div', { class: 'row tight' }, sel(s, 'duration', [['engagement', '交戦フェイズ終了まで'], ['battle', 'セッション終了まで'], ['rounds', '指定の巡数']], { onChange: rer }),
          s.duration === 'rounds' ? num(s, 'durationValue', { min: 1, cls: 'w-num', label: '巡数' }) : null)),
        field('回数（0＝無制限）', num(s, 'charges', { min: 0 }), { title: '判定に効いた回数でカウントし、0になると解除' })));
      right.append(field('メモ', (() => { const t = h('textarea', { rows: 2 }); t.value = s.note || ''; t.addEventListener('input', () => { s.note = t.value; save(); }); return t; })()));
      right.append(h('h3', null, '効果ブロック'));
      right.append(blocksEditor(s, rer));
      const users = [];
      for (const c of D.characters) for (const sk of c.skills || []) if ((sk.blocks || []).some((b) => (b.effects || []).some((e) => e.type === 'applyState' && e.state === s.name))) users.push(`${c.name}「${sk.name}」`);
      right.append(h('p', { class: 'small muted' }, users.length ? '付与するスキル：' + users.join('、') : 'この状態を付与するスキルはまだありません。'));
    }
    return h('div', { class: 'editor-layout' }, listPanel, right);
  }

  // ------------------------------------------------------------------
  // ルールタブ
  // ------------------------------------------------------------------
  function renderRules() {
    const R = D.rules;
    const rer = () => render();
    const statOpts = R.stats.map((s) => [s.key, `${s.name}（${s.key}）`]);
    const p = h('section', { class: 'panel stack', 'aria-label': 'ルール' });
    p.append(h('div', { class: 'section-head' }, h('h2', null, 'ルール設定'), h('p', null, '判定・ダイス・攻撃種別などの戦闘ルール。変更はすべてのテストケースに反映されます。')));
    p.append(h('div', { class: 'grid wide' }, field('ルールセット名', txt(R, 'name', { onChange: () => { $('#rules-name').textContent = R.name; } }))));

    // ステータス項目
    const st = h('div', { class: 'stack', style: { gap: '6px' } }, h('h3', null, 'ステータス項目'),
      h('p', { class: 'small muted' }, 'キーは式の中で self.STR のように使います。ダイス個数として参照されます。'));
    R.stats.forEach((s, i) => st.append(h('div', { class: 'row' },
      h('div', { class: 'w-sm' }, txt(s, 'key', { cls: 'expr', label: 'キー' })),
      h('div', { class: 'w-md' }, txt(s, 'name', { label: '表示名' })),
      btn('×', () => { R.stats.splice(i, 1); save(); rer(); }, 'ghost icon sm', { title: '削除', 'aria-label': 'ステータスを削除' }))));
    st.append(h('div', null, btn('＋ ステータス', () => { R.stats.push({ key: 'NEW' + R.stats.length, name: '新項目' }); save(); rer(); }, 'sm')));

    // ランク
    const rk = h('div', { class: 'stack', style: { gap: '6px' } }, h('h3', null, 'ランク表（表示ランク → 計算値・英雄点）'));
    const rkTable = h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'ランク'), h('th', { class: 'n' }, '計算値'), h('th', { class: 'n' }, '英雄点'), h('th', null, 'EX扱い'), h('th', null, ''))),
      h('tbody', null, R.ranks.map((r, i) => h('tr', null,
        h('td', null, txt(r, 'rank', { label: 'ランク' })), h('td', null, num(r, 'value', { cls: 'w-num' })), h('td', null, num(r, 'cost', { cls: 'w-num' })),
        h('td', null, chk(r, 'ex', '振り直し可')),
        h('td', null, btn('×', () => { R.ranks.splice(i, 1); save(); rer(); }, 'ghost icon sm', { 'aria-label': 'ランクを削除' }))))));
    rk.append(h('div', { class: 'table-wrap' }, rkTable), h('div', null, btn('＋ ランク', () => { R.ranks.push({ rank: '?', value: 1, cost: 1, ex: false }); save(); rer(); }, 'sm')));

    // 判定
    R.penalty = R.penalty || { enabled: true, threshold: 10, step: 10, negThreshold: 5 };
    const dice = h('div', { class: 'stack', style: { gap: '6px' } }, h('h3', null, 'ダイス・判定'),
      h('div', { class: 'grid' },
        field('標準のダイス面数', num(R.dice, 'faces', { min: 2, max: 100 })),
        field('面数の下限', num(R.dice, 'min', { min: 1 })),
        field('面数の上限', num(R.dice, 'max', { min: 2 })),
        field('ステータス下限', num(R, 'statMin')),
        field('ステータス上限', num(R, 'statMax')),
        field('先手判定の能力値', sel(R, 'initiativeStat', statOpts))),
      h('div', { class: 'grid wide' },
        field('最大HPの式', txt(R, 'hpFormula', { expr: true, ph: 'END*5' })),
        field('レベルドレインでHPが変わる能力値', sel(R, 'hpStat', [['', 'なし']].concat(statOpts))),
        field('その能力値1あたりのHP', num(R, 'hpPerStat'))),
      h('div', { class: 'row' }, chk(R.penalty, 'enabled', '補正値ペナルティを使う'), chk(R, 'exRerolls', 'EXランクの振り直し（交戦フェイズごとにEXの数だけ）')),
      h('div', { class: 'grid' },
        field('ペナルティ開始（補正値がこれを超えたら）', num(R.penalty, 'threshold')),
        field('面数−1 ごとの補正値', num(R.penalty, 'step', { min: 1 })),
        field('マイナス補正で面数+1（以上）', num(R.penalty, 'negThreshold'))),
      h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'マスター攻撃時の半減：'),
        h('div', { class: 'w-md' }, txt(R, 'masterTag', { ph: 'マスター', label: 'マスターのタグ' })), chk(R, 'masterHalf', 'タグ持ちが非タグ持ちに与えるダメージを半分にする')),
      (() => { R.heroBudget = R.heroBudget || { base: 30, perCs: 5 }; return h('div', { class: 'grid' },
        field('英雄点の基本予算', num(R.heroBudget, 'base')),
        field('令呪1画あたりの英雄点', num(R.heroBudget, 'perCs', { min: 1 }))); })(),
      h('p', { class: 'small muted' }, '令呪コスト ＝ ⌈(英雄点 − 予算)÷令呪1画あたり⌉ ＋ 作成時に失う令呪。予算 ＝ 基本予算 ＋ スキルで得る英雄点（サーヴァントと契約マスター）。'),
      h('div', { class: 'row' }, chk({ get v() { return !(R.commandSpells && R.commandSpells.enabled === false); }, set v(x) { R.commandSpells = Object.assign({ max: 3 }, R.commandSpells || {}, { enabled: x }); } }, 'v', '令呪を使う（各陣営の設定に従ってAIが使用）')),
      h('div', { class: 'row' }, chk({ get v() { return R.masterLoss !== false; }, set v(x) { R.masterLoss = x; } }, 'v', 'マスター脱落時、サーヴァントはマスターのHP（＋マスタースキルで増えたHP）分のダメージを受け、交戦終了時に消滅する（単独行動フラグがあれば次の交戦終了時）')));

    // 攻撃種別
    const at = h('div', { class: 'stack', style: { gap: '6px' } }, h('h3', null, '攻撃種別'),
      h('p', { class: 'small muted' }, '攻撃判定と防御判定に使う能力値。必要フラグがある種別は、そのフラグ（例：気配遮断の surprise）を持つキャラだけが選べます。'));
    const atTable = h('table', { class: 'data' }, h('thead', null, h('tr', null, ['キー', '名前', '攻撃の能力値', '防御の能力値', '必要フラグ', ''].map((x) => h('th', null, x)))),
      h('tbody', null, R.attackTypes.map((t, i) => h('tr', null,
        h('td', null, txt(t, 'key', { cls: 'expr' })), h('td', null, txt(t, 'name')),
        h('td', null, sel(t, 'atkStat', statOpts)), h('td', null, sel(t, 'defStat', statOpts)),
        h('td', null, sel(t, 'requiresFlag', [['', 'なし']].concat(E.FLAGS))),
        h('td', null, btn('×', () => { R.attackTypes.splice(i, 1); save(); rer(); }, 'ghost icon sm', { 'aria-label': '攻撃種別を削除' }))))));
    at.append(h('div', { class: 'table-wrap' }, atTable), h('div', null, btn('＋ 攻撃種別', () => { R.attackTypes.push({ key: 'type' + R.attackTypes.length, name: '新種別', atkStat: R.stats[0].key, defStat: R.stats[0].key, requiresFlag: '' }); save(); rer(); }, 'sm')));

    p.append(st, h('hr', { class: 'divider' }), rk, h('hr', { class: 'divider' }), dice, h('hr', { class: 'divider' }), at);

    const reset = h('section', { class: 'panel stack' }, h('h3', null, 'データの初期化'),
      h('p', { class: 'small muted' }, 'ルール・キャラクター・状態・テストケースを初期データに戻します。先に「書き出し」で保存しておくと安心です。'),
      h('div', null, confirmBtn('初期データに戻す', 'reset-all', () => { D = clone(PRE); UI.result = null; UI.charId = null; UI.stateId = null; UI.scnId = null; save(); render(); toast('初期データに戻しました'); })));
    return h('div', { class: 'stack' }, p, reset);
  }

  // ------------------------------------------------------------------
  // 比較・スイープ・総当たり
  // ------------------------------------------------------------------
  function renderLab() {
    return h('div', { class: 'lab-grid' }, comparePanel(), sweepPanel(), rrPanel());
  }

  function comparePanel() {
    const p = h('section', { class: 'panel stack', 'aria-label': '結果の比較' },
      h('div', { class: 'section-head' }, h('h2', null, 'A案・B案の比較'), h('p', null, 'テスト実行タブで「比較用に保存」した結果を並べます。')));
    if (!saved.length) { p.append(h('p', { class: 'muted' }, 'まだ保存された結果はありません。設定を変えながら実行して保存すると、ここで勝率を見比べられます。')); return p; }
    p.append(barCompare(saved.map((r) => ({ label: r.label, segs: r.teams.map((t, i) => ({ v: t.rate, color: teamColor(i), name: t.name })).concat([{ v: r.drawRate, color: 'var(--t-draw)', name: '引き分け' }]) }))));
    const maxTeams = Math.max(...saved.map((r) => r.teams.length));
    p.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, h('th', null, '名前'), h('th', null, 'テストケース'), h('th', { class: 'n' }, '試行'),
        Array.from({ length: maxTeams }, (_, i) => h('th', { class: 'n' }, `陣営${i + 1} 勝率`)), h('th', { class: 'n' }, '引き分け'), h('th', { class: 'n' }, '平均巡'), h('th', null, ''))),
      h('tbody', null, saved.map((r, ri) => h('tr', null,
        h('td', null, r.label), h('td', { class: 'small muted' }, r.scenarioName), h('td', { class: 'n' }, r.trials.toLocaleString()),
        Array.from({ length: maxTeams }, (_, i) => h('td', { class: 'n', title: r.teams[i] ? r.teams[i].name : '' }, r.teams[i] ? `${pct(r.teams[i].rate)} ±${pct(r.teams[i].ci)}` : '')),
        h('td', { class: 'n' }, pct(r.drawRate)), h('td', { class: 'n' }, fmt(r.roundsMean, 2)),
        h('td', null, btn('×', () => { saved.splice(ri, 1); saveSaved(); render(); }, 'ghost icon sm', { 'aria-label': '削除' }))))))));
    p.append(h('div', null, confirmBtn('すべて削除', 'clear-saved', () => { saved = []; saveSaved(); render(); })));
    return p;
  }

  function sweepPanel() {
    const sc = currentScenario();
    const S = UI.sweep;
    const p = h('section', { class: 'panel stack', 'aria-label': 'パラメータスイープ' },
      h('div', { class: 'section-head' }, h('h2', null, 'パラメータスイープ'),
        h('p', null, `現在のテストケース「${sc.name}」で、1つの値を範囲で変えながら勝率の変化を調べます。`)));
    const memberOpts = [];
    sc.teams.forEach((t, ti) => t.members.forEach((m, mi) => { const c = D.characters.find((x) => x.id === m.charId); if (c) memberOpts.push([`${ti}:${mi}`, `${t.name} / ${c.name}`]); }));
    const mObj = { v: `${S.teamIdx}:${S.memberIdx}` };
    if (!memberOpts.some((o) => o[0] === mObj.v) && memberOpts[0]) { mObj.v = memberOpts[0][0]; [S.teamIdx, S.memberIdx] = mObj.v.split(':').map(Number); }
    const member = sc.teams[S.teamIdx] && sc.teams[S.teamIdx].members[S.memberIdx];
    const ch = member && D.characters.find((x) => x.id === member.charId);
    const paramOpts = [['initHp', '開始時のHP（%）'], ['initCs', '開始時の令呪（画）'], ['hpExtra', 'HP補正'], ['actions', '行動回数']].concat(D.rules.stats.map((s) => ['stat:' + s.key, `${s.name}の値`]), [['effect', 'スキル効果の値'], ['faces', 'ルール：標準ダイス面数']]);
    const effOpts = [];
    if (ch) (ch.skills || []).forEach((s, si) => (s.blocks || []).forEach((b, bi) => (b.effects || []).forEach((e, ei) => {
      if (E.EFFECT_TYPES[e.type] && E.EFFECT_TYPES[e.type].params.includes('value')) effOpts.push([`${si}.${bi}.${ei}`, `${s.name} / ${describeEffect(e)}`]);
    })));
    if (S.param === 'effect' && !effOpts.some((o) => o[0] === S.effectPath)) S.effectPath = effOpts[0] ? effOpts[0][0] : '';
    p.append(h('div', { class: 'grid wide' },
      field('対象キャラクター', sel(mObj, 'v', memberOpts, { onChange: (v) => { [S.teamIdx, S.memberIdx] = v.split(':').map(Number); save(); render(); } })),
      field('変える値', sel(S, 'param', paramOpts, { onChange: () => render() })),
      S.param === 'effect' ? field('効果', effOpts.length ? sel(S, 'effectPath', effOpts) : h('span', { class: 'small muted' }, '値を持つ効果がありません')) : null));
    p.append(h('div', { class: 'grid' },
      field('開始', num(S, 'from')), field('終了', num(S, 'to')), field('刻み', num(S, 'step', { min: 1 })), field('1点あたりの試行回数', num(S, 'trials', { min: 10, step: 100 }))));
    p.append(h('p', { class: 'small muted' }, '開始HP%は選んだメンバーだけに適用（消耗の影響を見る用）。それ以外のキャラクターの値は、テストケース内の同じキャラクター全員に反映されます。ダイス面数はルール全体の値です。'));
    p.append(h('div', { class: 'run-bar' }, btn('スイープ実行', runSweep, 'primary', { disabled: UI.running ? true : null }), UI.running ? btn('中止', () => Runner.cancel(), 'danger') : null, h('span', { id: 'sweep-progress', class: 'small muted num' })));
    const out = h('div', { class: 'stack' });
    const r = UI.sweepResult;
    if (r && r.error) out.append(h('div', { class: 'notice err' }, r.error));
    else if (r) {
      out.append(h('h3', null, `${r.title}`));
      const series = r.teamNames.map((n, i) => ({ name: n, color: teamColor(i), values: r.points.map((pt) => pt.teams[i].rate) }));
      out.append(lineChart(r.xs, series, { xLabel: r.xLabel, label: 'スイープ結果' }));
      out.append(h('div', { class: 'legend' }, series.map((se) => h('span', null, h('span', { class: 'team-dot', style: { background: se.color } }), se.name + ' 勝率'))));
      out.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', { class: 'n' }, r.xLabel), r.teamNames.map((n) => h('th', { class: 'n' }, n + ' 勝率')), h('th', { class: 'n' }, '引き分け'), h('th', { class: 'n' }, '平均巡'))),
        h('tbody', null, r.points.map((pt, i) => h('tr', null, h('td', { class: 'n' }, r.xs[i]), pt.teams.map((t) => h('td', { class: 'n' }, pct(t.rate))), h('td', { class: 'n' }, pct(pt.drawRate)), h('td', { class: 'n' }, fmt(pt.rounds.mean, 2))))))));
    }
    p.append(out);
    return p;
  }

  async function runSweep() {
    const sc = currentScenario();
    const err = validateScenario(sc);
    if (err) { toast(err); return; }
    const S = UI.sweep;
    const member = sc.teams[S.teamIdx] && sc.teams[S.teamIdx].members[S.memberIdx];
    if (!member) { toast('対象キャラクターを選んでください'); return; }
    const from = +S.from, to = +S.to, step = Math.max(1e-9, Math.abs(+S.step || 1));
    const xs = [];
    for (let v = from; from <= to ? v <= to + 1e-9 : v >= to - 1e-9; v += from <= to ? step : -step) { xs.push(Math.round(v * 1000) / 1000); if (xs.length > 60) break; }
    if (!xs.length) { toast('範囲を確認してください'); return; }
    const chName = (D.characters.find((x) => x.id === member.charId) || {}).name;
    const jobs = xs.map((v) => {
      const chars = clone(D.characters); const rules = clone(D.rules);
      const c = chars.find((x) => x.id === member.charId);
      const scX = clone(sc);
      if (S.param === 'initHp') {
        const mm = scX.teams[S.teamIdx].members[S.memberIdx];
        mm.init = Object.assign({ res: {}, states: [], used: [] }, mm.init || {}, { hpMode: 'pct', hp: v });
      } else if (S.param === 'initCs') {
        const tm = scX.teams[S.teamIdx];
        const mm = tm.members[S.memberIdx];
        const mi = mm.master !== undefined && mm.master !== '' && mm.master !== null ? tm.members[+mm.master] : null;
        const holder = mi || mm;
        holder.init = Object.assign({ hpMode: 'full', res: {}, states: [], used: [] }, holder.init || {});
        if (mi) holder.init.res = Object.assign({}, holder.init.res, { cs: Math.round(v) }); else holder.init.cs = Math.round(v);
      } else if (S.param === 'hpExtra') c.hpExtra = v;
      else if (S.param === 'actions') c.actions = Math.max(1, Math.round(v));
      else if (S.param.startsWith('stat:')) c.stats[S.param.slice(5)] = String(v);
      else if (S.param === 'faces') rules.dice.faces = v;
      else if (S.param === 'effect') {
        const [si, bi, ei] = String(S.effectPath).split('.').map(Number);
        const e = c.skills[si] && c.skills[si].blocks[bi] && c.skills[si].blocks[bi].effects[ei];
        if (e) e.value = String(v);
      }
      return { data: clone(scenarioData(scX, { characters: chars, rules })), opts: { trials: Math.max(1, +S.trials || 100), seed: sc.seed, start: 0, logTrials: 0 } };
    });
    const label = { initHp: '開始HP%', initCs: '開始時の令呪', hpExtra: 'HP補正', actions: '行動回数', faces: 'ダイス面数', effect: '効果の値' }[S.param] || (S.param.startsWith('stat:') ? (D.rules.stats.find((x) => 'stat:' + x.key === S.param) || {}).name + 'の値' : S.param);
    UI.running = true; render();
    try {
      const aggs = await Runner.runJobs(jobs, setProgress);
      const points = aggs.map((a) => E.summarize(a));
      UI.sweepResult = { xs, points, teamNames: points[0].teams.map((t) => t.name), xLabel: label, title: `${S.param === 'faces' ? 'ルール' : chName} の ${label} を ${xs[0]}〜${xs[xs.length - 1]} で変化` };
    } catch (e) { if (e.message !== 'CANCELLED') UI.sweepResult = { error: e.message }; }
    UI.running = false; render();
  }

  function rrPanel() {
    const R = UI.rr;
    const pool = D.characters;
    if (!R.ids) R.ids = pool.filter((c) => !['乗騎', 'ボス', 'マスター', '召喚体'].includes(c.cls) && !(c.tags || []).includes('ボス')).map((c) => c.id);
    R.ids = R.ids.filter((id) => pool.some((c) => c.id === id));
    const p = h('section', { class: 'panel stack', 'aria-label': '総当たり' },
      h('div', { class: 'section-head' }, h('h2', null, '1対1 総当たり'),
        h('p', null, '選んだキャラクター同士を全組み合わせで戦わせ、相性表と平均勝率を作ります。英雄点と勝率のズレが調整の手がかりになります。')));
    const chips = h('div', { class: 'chips' });
    for (const c of pool) {
      const on = R.ids.includes(c.id);
      chips.append(h('button', { type: 'button', class: 'chip', 'aria-pressed': on ? 'true' : 'false', onclick: () => {
        R.ids = on ? R.ids.filter((x) => x !== c.id) : R.ids.concat([c.id]); save(); render();
      } }, c.name));
    }
    p.append(chips);
    p.append(h('div', { class: 'row' },
      btn('全選択', () => { R.ids = pool.map((c) => c.id); save(); render(); }, 'ghost sm'),
      btn('全解除', () => { R.ids = []; save(); render(); }, 'ghost sm'),
      h('span', { class: 'small muted' }, `${R.ids.length}体 → ${(R.ids.length * (R.ids.length - 1)) / 2}組`)));
    p.append(h('div', { class: 'grid' }, field('1組あたりの試行回数', num(R, 'trials', { min: 10, step: 50 })), field('最大ターン数', num(R, 'maxEngagements', { min: 1 }))));
    p.append(h('div', { class: 'run-bar' }, btn('総当たり実行', runRR, 'primary', { disabled: UI.running ? true : null }), UI.running ? btn('中止', () => Runner.cancel(), 'danger') : null, h('span', { id: 'rr-progress', class: 'small muted num' })));
    const r = UI.rrResult;
    if (r && r.error) p.append(h('div', { class: 'notice err' }, r.error));
    else if (r) {
      const order = r.names.map((n, i) => i).sort((a, b) => r.avg[b] - r.avg[a]);
      p.append(h('h3', null, '平均勝率ランキング'));
      p.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', { class: 'n' }, '順位'), h('th', null, 'キャラクター'), h('th', { class: 'n' }, '平均勝率'), h('th', { class: 'n' }, '英雄点'), h('th', null, ''))),
        h('tbody', null, order.map((i, k) => h('tr', null, h('td', { class: 'n' }, k + 1), h('td', null, r.names[i]), h('td', { class: 'n' }, pct(r.avg[i])),
          h('td', { class: 'n' }, r.hero[i]),
          h('td', null, h('span', { class: 'meter hp', style: { width: '120px' } }, h('i', { style: { width: pct(r.avg[i], 2) } })))))))));
      p.append(h('h3', null, '相性表（行のキャラから見た勝率）'));
      const cell = (v) => {
        if (v === null) return h('td', { class: 'cell', style: { background: 'var(--sunken)' } }, '—');
        const d = Math.abs(v - 0.5) * 2;
        const col = v >= 0.5 ? 'var(--t1)' : 'var(--t2)';
        return h('td', { class: 'cell', style: { background: `color-mix(in oklab, ${col} ${Math.round(d * 70)}%, var(--surface))` }, title: pct(v) }, Math.round(v * 100));
      };
      p.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data heat' },
        h('thead', null, h('tr', null, h('th', null, ''), order.map((j) => h('th', { class: 'rot' }, r.names[j])))),
        h('tbody', null, order.map((i) => h('tr', null, h('th', null, r.names[i]), order.map((j) => cell(i === j ? null : r.m[i][j]))))))));
      p.append(h('div', { class: 'legend' }, h('span', null, h('span', { class: 'team-dot', style: { background: 'var(--t1)' } }), '行が有利'), h('span', null, h('span', { class: 'team-dot', style: { background: 'var(--t2)' } }), '行が不利'), h('span', null, '数字＝勝率（%）。引き分けがあるため合計は100にならない場合があります。')));
    }
    return p;
  }

  async function runRR() {
    const R = UI.rr;
    const ids = R.ids.slice();
    if (ids.length < 2) { toast('2体以上選んでください'); return; }
    const jobs = []; const pairs = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const sc = { id: 'rr', name: 'rr', teams: [{ name: 'A', support: true, members: [{ charId: ids[i], pos: 'front' }] }, { name: 'B', support: true, members: [{ charId: ids[j], pos: 'front' }] }], rounds: { mode: 'pl', value: 2 }, maxEngagements: +R.maxEngagements || 10 };
      jobs.push({ data: clone(scenarioData(sc)), opts: { trials: Math.max(1, +R.trials || 100), seed: 1, start: 0, logTrials: 0 } });
      pairs.push([i, j]);
    }
    UI.running = true; render();
    try {
      const aggs = await Runner.runJobs(jobs, setProgress);
      const n = ids.length;
      const m = Array.from({ length: n }, () => new Array(n).fill(null));
      aggs.forEach((a, k) => {
        const [i, j] = pairs[k];
        m[i][j] = a.teams[0].wins / a.trials;
        m[j][i] = a.teams[1].wins / a.trials;
      });
      const avg = m.map((row, i) => { const v = row.filter((x, j) => j !== i && x !== null); return v.reduce((s, x) => s + x, 0) / Math.max(1, v.length); });
      const chars = ids.map((id) => D.characters.find((c) => c.id === id));
      UI.rrResult = { names: chars.map((c) => c.name), hero: chars.map((c) => E.heroPoints(D.rules, c).total), m, avg };
    } catch (e) { if (e.message !== 'CANCELLED') UI.rrResult = { error: e.message }; }
    UI.running = false; render();
  }

  // ------------------------------------------------------------------
  // 使い方
  // ------------------------------------------------------------------
  function renderHelp() {
    const code = (t) => h('code', null, t);
    return h('section', { class: 'panel help stack' },
      h('h2', null, '使い方'),
      h('p', null, 'キャラクター・スキル・戦闘ルールを部品として定義し、交戦フェイズを何千回も自動で戦わせて勝率などを集計するツールです。初期データとして、提示された聖杯戦争型TRPGのルールとキャラクターシート例が入っています。'),
      h('h3', null, '基本の流れ'),
      h('ol', null,
        h('li', null, '「テスト実行」でテストケースを選び、陣営にキャラクターを配置します（前衛・後衛、倒れたら負けになる「要」）。'),
        h('li', null, '試行回数とシードを決めて「シミュレーション実行」。勝率、巡数の分布、キャラ別の死亡率・ダメージ、スキルの使用回数、詳細ログが出ます。'),
        h('li', null, '数値を変えて再実行し、「比較用に保存」で案同士を並べます。'),
        h('li', null, '「比較・スイープ・総当たり」で、HPや補正値を範囲で動かした勝率曲線や、キャラ同士の相性表を作れます。')),
      h('h3', null, '用語と再現している範囲'),
      h('p', null, 'ターン＝移動・遭遇・交戦の全フェイズの一巡り、フェイズ＝移動・遭遇・交戦それぞれ、巡＝交戦フェイズ内の手番の一巡り。シミュレーターは各ターンの交戦フェイズだけを戦わせます。決着しなければ次のターンの交戦フェイズへ進み、その間の移動フェイズの効果（被虐の誉れの回復など）だけを処理します。'),
      h('ul', null,
        h('li', null, '先手判定：各陣営の前衛から代表1人（AIが期待値最大の者を選ぶ）が（敏捷＋補正）D6。出目順に陣営の行動順が決まります。'),
        h('li', null, '陣地：陣営フラグ「陣地」（陣地作成）、陣地扱いの状態（無限の剣製・パンドラボックス）、固有結界の召喚体（王の軍勢）は、相手の「陣地破壊」で消えます。'),
        h('li', null, '巡：既定は「参加PL数」ぶん（マスターと契約サーヴァントで1人、マスター未配置のサーヴァントも1人と数える）。「1巡の間」の効果は、付与された者の手番が1回終わるまで続きます。各巡で陣営ごとに前衛が1回ずつ行動。決着しなければ交戦フェイズを繰り返し、最大交戦回数で引き分け。'),
        h('li', null, '攻撃：物理（筋力）・魔術（魔力）・奇襲（幸運、要フラグ）。攻撃値−防御値がダメージ。後衛は攻撃されません。'),
        h('li', null, '攻撃対象の変更（カリスマなど）：変更先は「自分」か、名前を指定した味方（イスカンダルなら神威の車輪・王の軍勢）。AIは「失うものの重さ」で比べ、召喚体を盾にして本体を守ります。召喚体への攻撃を本体が庇うことはせず、王の軍勢は半数割れで陣地ごと崩れる1体は盾にしません。'),
        h('li', null, '援護：1回の攻撃に複数の味方が援護を重ねられます。AIは、援護を1体足すごとの攻撃の伸びがその味方の単独攻撃を上回る間だけ追加します（補正値+11以上の面数ペナルティで自然に止まる）。王の軍勢のような弱い召喚体が、強い味方の攻撃をまとめて底上げします。'),
        h('li', null, '補正値ペナルティ（+11以上で10ごとに面数−1、−5以上で面数+1）、面数の上下限、EXランクの振り直し、攻撃対象変更、HP1で耐える、マスターからサーヴァントへのダメージ半減。'),
        h('li', null, 'マスター：メンバーの ⚙ から「マスター」を指定すると契約関係になります。マスターのスキルは「自分のサーヴァント」を対象にでき（式 isServant(actor)、対象「自分のサーヴァント」）、マスターが倒れるとサーヴァントはマスターのHP分のダメージを受けて交戦終了時に消滅します。マスターの攻撃はサーヴァントへのダメージが半減（DRONE などのフラグで無効）。'),
        h('li', null, '召喚：効果「召喚」で乗騎や使い魔を戦闘中に呼び出せます（体数は式可、交戦フェイズ終了で消える／召喚者と運命を共にする、を選択）。結果表では召喚体をまとめて集計します。'),
        h('li', null, '消耗：メンバーの ⚙ から開始時のHP（値・割合・ランダム範囲）、宝具・令呪などの残り回数、掛かっている状態、使用済みのスキルを設定できます。スイープの「開始時のHP（%）」で消耗の影響を曲線で見られます。'),
        h('li', null, '対象外：移動・遭遇フェイズ、同盟・裏切り、遠距離攻撃フェイズ、魂喰い、再契約、前衛と後衛の入れ替え行動、移動・RP用の令呪。')),
      h('h3', null, '令呪'),
      h('p', null, '各PLは令呪3画から、契約サーヴァントの令呪コストを引いた画数で戦闘を始めます。令呪コストは英雄点から自動計算します：⌈(英雄点 − 予算)÷5⌉ ＋ 作成時に失う令呪（狂化など）。予算は基本30点に、対魔力（+5）・神性（+10）などサーヴァントのスキルと、DRONE・POWEREDなど契約マスターのスキルで得る英雄点を足したものです。同じサーヴァントでも、組むマスターによって初期令呪が変わります。マスターを配置していればマスターが、未配置ならサーヴァント本人が保持します（効果は自分のマスターとサーヴァントのみ、乗騎には使えません）。陣営ごとに「なし」にもできます（ボスなど）。AIは次のように使います。'),
      h('ul', null,
        h('li', null, '防御で致命傷を受ける時：ダイスを振り直して+3（生き残る見込みが30%以上なら）。'),
        h('li', null, '自陣営の手番開始時：HPが35%以下ならHP30回復。宝具を使い切っていれば2画で宝具回数1回復（通常は3画ある時のみ）。'),
        h('li', null, 'マスターが致命傷を受けそうな時：攻撃対象を自分のサーヴァントに変更（単体攻撃のみ、攻撃対象変更無効を無視）、またはマスターの判定に+5。'),
        h('li', null, '「積極的」設定では、攻撃の出目が悪く振り直せば相手を倒せそうな時にも使います。「通常」は緊急時以外に1画残します。'),
        h('li', null, '面数+1、任意の判定+5（サーヴァント）、前衛・後衛の入れ替えはAIでは使いません（振り直し+3の方が効率的なため）。')),
      h('h3', null, 'スキルの組み立て'),
      h('p', null, 'スキルは「ブロック」の集まりです。ブロックごとに、いつ（タイミング）・どの攻撃で（攻撃種別）・どんな時に（条件）・何をするか（効果）を決めます。回数制限・リソース消費・AIの使い方はスキル単位で、1回の判定で発動したら1回分消費します。'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', null, '例'), h('th', null, '設定'))),
        h('tbody', null,
          h('tr', null, h('td', null, '対魔力：魔術防御時、補正値5'), h('td', null, 'タイミング「自分の防御判定時」／攻撃種別「魔術」／効果「補正値 5」')),
          h('tr', null, h('td', null, '直感：最大HP+15、物理防御+3'), h('td', null, 'ブロック1「戦闘開始時」最大HP増減 15、ブロック2「防御」物理 補正値 3')),
          h('tr', null, h('td', null, '宝具：10までの補正値（1/1）'), h('td', null, '効果「補正値 10・まで」、消費リソース np×1')),
          h('tr', null, h('td', null, 'ゲイ・ボルグ：耐久×2まで、相手は幸運で防御'), h('td', null, '補正値 target.END*2（まで）＋「相手の防御能力値を変更」LUK')),
          h('tr', null, h('td', null, 'ダメージを与えたら呪い付与'), h('td', null, '効果「状態を付与」呪い／対象 相手／実行条件 event.damage > 0'))))),
      h('h3', null, '式で使えるもの'),
      h('ul', null,
        h('li', null, code('self'), ' スキルの持ち主、', code('target'), ' 判定やイベントの相手、', code('actor'), ' 判定を行う味方（味方支援系）。'),
        h('li', null, 'それぞれ ', code('.STR'), code('.END'), '…（現在の能力値）、', code('.hp'), code('.maxHp'), code('.hpPct'), code('.damageTaken'), code('.res.np'), ' が使えます。'),
        h('li', null, code('round'), '（その交戦フェイズの何巡目か）、', code('engagement'), '（何ターン目か）', '、', code('event.damage'), '（直前のダメージ）、', code('d(3,6)'), '（3D6を振る）、', code('has(target,\'竜種\')'), '、', code('teamFlag(\'陣地\')'), '、', code('hasInitiative()'), '、', code('allyDown()'), '、', code('floor()'), code('min()'), code('max()'), '。')),
      h('h3', null, 'AI'),
      h('p', null, '攻撃対象と攻撃種別は、期待ダメージ（正規近似）と撃破確率から選びます（キャラごとに「最もHPが低い相手」「指定タグ優先」なども選べます）。回数制限のあるスキルは「使えるときに使う」「効果が大きいときだけ」「HPがしきい値以下のとき」「使わない」から選べます。「まで」付きの補正値は、補正値ペナルティを考慮して期待値が最も高い値を自動で選びます。'),
      h('h3', null, 'データの保存と共有'),
      h('p', null, '編集内容はこのブラウザに自動保存されます。共有の方法は3つあります。'),
      h('ul', null,
        h('li', null, 'キャラクター：キャラクター画面の「書き出し」（1体）または「書き出し…」（複数を選択）。付与する状態や召喚する乗騎も一緒に入ります。'),
        h('li', null, 'テストケース：テスト実行画面の「書き出し」。使っているキャラクターと状態も一緒に入ります。'),
        h('li', null, '全データ：右上の「書き出し」。')),
      h('p', null, 'どれも「テキストでコピー」でチャットに貼り付けて渡せます。受け取った側は「読み込み…」でファイルを選ぶか、テキストを貼り付けます。今のデータに追加され、同じ名前のものがあれば「既存を使う」「別名で追加」「上書き」を選べます。'),
      h('h3', null, '統計の読み方'),
      h('p', null, '勝率の「±」は95%信頼区間の目安です。1,000試行で約±3%、10,000試行で約±1%。小さな差を比べるときは試行回数を増やしてください。同じシードなら同じ結果が再現されます（並列実行しても同じ）。'));
  }


  // ------------------------------------------------------------------
  // キャラクター・テストケース単位の書き出しと読み込み
  // ------------------------------------------------------------------
  const FORMAT = 'trpg-balance-tester';

  /** 指定キャラクターと、それが参照する状態・召喚先キャラクターを集める */
  function collectDeps(charIds) {
    const ids = new Set(charIds);
    const queue = [...ids];
    const stateNames = new Set();
    const scanBlocks = (blocks) => {
      for (const b of blocks || []) for (const e of b.effects || []) {
        if (e.type === 'applyState' && e.state) stateNames.add(e.state);
        const refs = e.type === 'summon' && e.char ? [e.char] : e.type === 'redirect' && e.dest ? String(e.dest).split(/[,、]+/).map((x) => x.trim()) : [];
        for (const n of refs) {
          const t = D.characters.find((x) => x.name === n);
          if (t && !ids.has(t.id)) { ids.add(t.id); queue.push(t.id); }
        }
      }
    };
    while (queue.length) {
      const id = queue.pop();
      const c = D.characters.find((x) => x.id === id);
      if (c) for (const sk of c.skills || []) scanBlocks(sk.blocks);
    }
    // 状態の中から付与される状態も
    let grew = true;
    while (grew) {
      grew = false;
      for (const st of D.states) if (stateNames.has(st.name)) {
        const before = stateNames.size; scanBlocks(st.blocks); if (stateNames.size !== before) grew = true;
      }
    }
    return {
      characters: D.characters.filter((c) => ids.has(c.id)).map(clone),
      states: D.states.filter((st) => stateNames.has(st.name)).map(clone),
    };
  }
  const header = (kind) => ({ format: FORMAT, kind, version: PRE.version || 1, exportedAt: new Date().toISOString(), rulesName: D.rules.name });
  function bundleCharacters(ids) { return Object.assign(header('characters'), collectDeps(ids), { scenarios: [] }); }
  function bundleScenario(sc) {
    const deps = collectDeps(sc.teams.flatMap((t) => t.members.map((m) => m.charId)));
    return Object.assign(header('scenario'), deps, { scenarios: [clone(sc)] });
  }
  const safeName = (n) => String(n).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
  function downloadJSON(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function copyText(text, okMsg) {
    const fallback = () => { UI.importDialog = { mode: 'showText', text }; render(); };
    try {
      navigator.clipboard.writeText(text).then(() => toast(okMsg || 'クリップボードにコピーしました'), fallback);
    } catch (e) { fallback(); }
  }
  function exportItems(bundle, filename, how) {
    if (how === 'text') copyText(JSON.stringify(bundle), 'クリップボードにコピーしました。チャットなどに貼り付けて共有できます');
    else { downloadJSON(bundle, filename); toast('書き出しました'); }
  }

  /** 読み込んだJSONを解釈する */
  function parseBundle(text) {
    let o;
    try { o = JSON.parse(String(text).trim()); } catch (e) { throw new Error('JSONとして読めませんでした。書き出したファイルか、コピーしたテキストをそのまま使ってください。'); }
    if (!o || typeof o !== 'object') throw new Error('内容が空です。');
    if (Array.isArray(o)) o = { characters: o };
    const kind = o.kind || (o.rules && Array.isArray(o.characters) ? 'all' : o.scenarios && o.scenarios.length ? 'scenario' : 'characters');
    const b = { kind, characters: o.characters || [], states: o.states || [], scenarios: o.scenarios || [], rules: o.rules || null, raw: o };
    if (!Array.isArray(b.characters) || !Array.isArray(b.states) || !Array.isArray(b.scenarios)) throw new Error('このツールの形式ではありません。');
    if (!b.characters.length && !b.scenarios.length && !b.states.length) throw new Error('キャラクター・状態・テストケースが含まれていません。');
    return b;
  }

  // ID を除いて内容が同じか
  const stripIds = (o) => JSON.stringify(o, (k, v) => (k === 'id' || k === 'charId' ? undefined : v));
  function makePlan(b) {
    const items = [];
    const add = (type, obj, existing) => {
      const same = existing && stripIds(existing) === stripIds(obj);
      items.push({ type, obj, existing, status: !existing ? 'new' : same ? 'same' : 'diff', action: !existing ? 'add' : same ? 'use' : 'rename' });
    };
    for (const st of b.states) add('state', st, D.states.find((x) => x.name === st.name));
    for (const c of b.characters) add('character', c, D.characters.find((x) => x.name === c.name));
    for (const sc of b.scenarios) {
      const ex = D.scenarios.find((x) => x.name === sc.name);
      const same = ex && stripIds(ex) === stripIds(sc);
      items.push({ type: 'scenario', obj: sc, existing: ex, status: !ex ? 'new' : same ? 'same' : 'diff', action: !ex ? 'add' : same ? 'skip' : 'rename' });
    }
    return { kind: b.kind, items, bundle: b };
  }
  function uniqueName(base, taken) {
    let n = base + '（読込）', i = 2;
    while (taken(n)) n = base + `（読込${i++}）`;
    return n;
  }
  function applyPlan(plan) {
    const stateName = {}, charName = {}, charId = {};
    let added = 0, replaced = 0, reused = 0, skipped = 0;
    const touched = [];
    for (const it of plan.items.filter((x) => x.type === 'state')) {
      const st = clone(it.obj);
      if (it.action === 'skip') { skipped++; continue; }
      if (it.action === 'use') { stateName[st.name] = st.name; reused++; continue; }
      if (it.action === 'overwrite') { st.id = it.existing.id; D.states[D.states.indexOf(it.existing)] = st; stateName[st.name] = st.name; replaced++; touched.push(st); continue; }
      const nn = it.action === 'rename' ? uniqueName(st.name, (n) => D.states.some((x) => x.name === n)) : st.name;
      stateName[st.name] = nn; st.name = nn; st.id = uid('st'); D.states.push(st); added++; touched.push(st);
    }
    const newChars = [];
    for (const it of plan.items.filter((x) => x.type === 'character')) {
      const c = clone(it.obj);
      const oldId = c.id, oldName = c.name;
      if (it.action === 'skip') { skipped++; continue; }
      if (it.action === 'use') { charId[oldId] = it.existing.id; charName[oldName] = it.existing.name; reused++; continue; }
      (c.skills || []).forEach((sk) => { sk.id = uid('sk'); });
      if (it.action === 'overwrite') { c.id = it.existing.id; D.characters[D.characters.indexOf(it.existing)] = c; replaced++; }
      else {
        if (it.action === 'rename') c.name = uniqueName(c.name, (n) => D.characters.some((x) => x.name === n) || newChars.some((x) => x.name === n));
        c.id = uid('ch'); D.characters.push(c); added++;
      }
      charId[oldId] = c.id; charName[oldName] = c.name; newChars.push(c); touched.push(c);
    }
    // 取り込んだもの同士の参照（状態名・召喚先）を付け替え
    const fix = (blocks) => { for (const b of blocks || []) for (const e of b.effects || []) {
      if (e.type === 'applyState' && stateName[e.state]) e.state = stateName[e.state];
      if (e.type === 'summon' && charName[e.char]) e.char = charName[e.char];
      if (e.type === 'redirect' && e.dest) e.dest = String(e.dest).split(/[,、]+/).map((x) => x.trim()).filter(Boolean).map((x) => charName[x] || x).join(', ');
    } };
    for (const o of touched) { if (o.skills) o.skills.forEach((sk) => fix(sk.blocks)); else fix(o.blocks); }
    let lastScn = null;
    for (const it of plan.items.filter((x) => x.type === 'scenario')) {
      if (it.action === 'skip') { skipped++; continue; }
      const sc = clone(it.obj);
      for (const t of sc.teams || []) for (const m of t.members || []) m.charId = charId[m.charId] || m.charId;
      if (it.action === 'overwrite') { sc.id = it.existing.id; D.scenarios[D.scenarios.indexOf(it.existing)] = sc; replaced++; }
      else {
        if (it.action === 'rename') sc.name = uniqueName(sc.name, (n) => D.scenarios.some((x) => x.name === n));
        sc.id = uid('sc'); D.scenarios.push(sc); added++;
      }
      lastScn = sc;
    }
    return { added, replaced, reused, skipped, lastScn, firstChar: newChars[0] || null };
  }

  function openImport(text) {
    try {
      const b = parseBundle(text);
      UI.importDialog = { mode: 'plan', plan: makePlan(b) };
    } catch (e) {
      UI.importDialog = { mode: 'input', error: e.message, text };
    }
    render();
  }
  function readFileThen(file, cb) {
    const rd = new FileReader();
    rd.onload = () => cb(String(rd.result));
    rd.readAsText(file);
  }

  const STATUS_LABEL = { new: ['新規', 'buff'], same: ['同じ内容が既にある', 'skill'], diff: ['同名で内容が違う', 'debuff'] };
  const TYPE_LABEL = { scenario: 'テストケース', character: 'キャラクター', state: '状態' };
  function actionOptions(it) {
    if (it.status === 'new') return [['add', '追加'], ['skip', '取り込まない']];
    if (it.type === 'scenario') return it.status === 'same' ? [['skip', '既存を使う'], ['rename', '別名で追加']] : [['rename', '別名で追加'], ['overwrite', '上書き'], ['skip', '取り込まない']];
    return [['use', '既存を使う'], ['rename', '別名で追加'], ['overwrite', '上書き']];
  }

  function importDialog() {
    const d = UI.importDialog;
    if (!d) return null;
    const close = () => { UI.importDialog = null; render(); };
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '読み込み' });
    const wrap = h('div', { class: 'modal-backdrop', onclick: (ev) => { if (ev.target === wrap) close(); } }, box);
    if (d.mode === 'showText') {
      const ta = h('textarea', { rows: 8, readonly: true }); ta.value = d.text;
      box.append(h('h2', null, 'テキストとして書き出し'), h('p', { class: 'small muted' }, 'クリップボードに直接コピーできなかったため、下のテキストをすべて選択してコピーしてください。'), ta,
        h('div', { class: 'row' }, btn('閉じる', close, 'primary')));
      setTimeout(() => { ta.focus(); ta.select(); }, 0);
      return wrap;
    }
    if (d.mode === 'input') {
      const ta = h('textarea', { rows: 8, placeholder: '書き出したJSONのテキストを貼り付け' }); ta.value = d.text || '';
      const file = h('input', { type: 'file', accept: '.json,application/json,text/plain', id: 'imp-file' });
      file.addEventListener('change', () => { const f = file.files && file.files[0]; if (f) readFileThen(f, openImport); });
      box.append(h('h2', null, '読み込み'),
        h('p', { class: 'small muted' }, 'キャラクター・テストケースを書き出したファイル、またはコピーしたテキストを読み込みます。今のデータに追加され、同じ名前があれば扱いを選べます。'),
        d.error ? h('div', { class: 'notice err' }, d.error) : null,
        field('ファイルから', file),
        field('テキストを貼り付け', ta),
        h('div', { class: 'row' }, btn('内容を確認', () => openImport(ta.value), 'primary'), btn('キャンセル', close, 'ghost')));
      return wrap;
    }
    // plan
    const plan = d.plan;
    const counts = { scenario: 0, character: 0, state: 0 };
    plan.items.forEach((it) => { counts[it.type]++; });
    box.append(h('h2', null, '読み込む内容の確認'),
      h('p', { class: 'small muted' }, Object.entries(counts).filter(([, n]) => n).map(([t, n]) => `${TYPE_LABEL[t]} ${n}件`).join('・') +
        (plan.bundle.raw && plan.bundle.raw.rulesName && plan.bundle.raw.rulesName !== D.rules.name ? `（書き出し元のルール：${plan.bundle.raw.rulesName}）` : '')));
    if (plan.kind === 'all') {
      box.append(h('div', { class: 'notice' }, 'これは全データの書き出しファイルです。今のデータに追加するか、すべて置き換えるかを選べます。',
        h('div', { class: 'row', style: { marginTop: '6px' } }, confirmBtn('すべて置き換える', 'replace-all', () => {
          const o = clone(plan.bundle.raw); delete o.format; delete o.kind; delete o.exportedAt; delete o.rulesName;
          o.states = o.states || []; o.scenarios = o.scenarios || [];
          D = o; UI.result = null; UI.charId = null; UI.stateId = null; UI.scnId = null; UI.importDialog = null; save(); render(); toast('すべてのデータを置き換えました');
        }))));
    }
    const setAll = (action) => { plan.items.forEach((it) => {
      if (it.status === 'new') return;
      const a = action === 'use' && it.type === 'scenario' ? 'skip' : action;
      if (actionOptions(it).some(([v]) => v === a)) it.action = a;
    }); render(); };
    if (plan.items.some((it) => it.status !== 'new')) {
      box.append(h('div', { class: 'row' }, h('span', { class: 'small muted' }, '同名のものをまとめて：'),
        btn('既存を使う', () => setAll('use'), 'ghost sm'), btn('別名で追加', () => setAll('rename'), 'ghost sm'), btn('上書き', () => setAll('overwrite'), 'ghost sm')));
    }
    const order = { scenario: 0, character: 1, state: 2 };
    const sorted = plan.items.slice().sort((x, y) => order[x.type] - order[y.type]);
    const row = (it) => {
      const [lab, cls] = STATUS_LABEL[it.status];
      return h('tr', null,
        h('td', { class: 'small muted' }, TYPE_LABEL[it.type]),
        h('td', null, it.obj.name),
        h('td', null, h('span', { class: 'pill ' + cls }, lab)),
        h('td', null, sel(it, 'action', actionOptions(it), { label: it.obj.name + 'の扱い' })));
    };
    const table = (items) => h('div', { class: 'table-wrap' }, h('table', { class: 'data import-table' },
      h('thead', null, h('tr', null, h('th', null, '種類'), h('th', null, '名前'), h('th', null, '状態'), h('th', null, '扱い'))),
      h('tbody', null, items.map(row))));
    const decide = sorted.filter((it) => it.status !== 'same');
    const same = sorted.filter((it) => it.status === 'same');
    const list = h('div', { class: 'stack', style: { gap: '8px', maxHeight: '50vh', overflowY: 'auto' } });
    if (decide.length) list.append(table(decide));
    if (same.length) {
      const det = h('details', { class: 'log' }, h('summary', null, `同じ内容が既にあるもの ${same.length}件（${same.every((x) => x.action === 'use' || x.action === 'skip') ? 'すべて既存を使う' : '個別に設定'}）`), h('div', { style: { padding: '0 8px 8px' } }, table(same)));
      if (!decide.length) det.open = true;
      list.append(det);
    }
    box.append(list);
    box.append(h('p', { class: 'small muted' }, '「既存を使う」はこのツールに既にあるものをそのまま使い、テストケースもそれを参照します。「別名で追加」は名前に（読込）を付けて別に追加します。'));
    box.append(h('div', { class: 'row' },
      btn('取り込む', () => {
        const r = applyPlan(plan);
        UI.importDialog = null;
        if (r.lastScn) { UI.scnId = r.lastScn.id; UI.result = null; if (UI.tab !== 'test') UI.tab = 'test'; }
        else if (r.firstChar) { UI.charId = r.firstChar.id; UI.tab = 'chars'; }
        save(); render();
        toast(`追加 ${r.added}件・上書き ${r.replaced}件・既存を使用 ${r.reused}件${r.skipped ? `・取り込まない ${r.skipped}件` : ''}`);
      }, 'primary'),
      btn('キャンセル', close, 'ghost')));
    return wrap;
  }

  /** 複数キャラクターを選んで書き出すパネル */
  function charExportPanel() {
    UI.charSel = (UI.charSel || []).filter((id) => D.characters.some((c) => c.id === id));
    const selSet = new Set(UI.charSel);
    const groups = new Map();
    for (const c of D.characters) { const g = c.cls || 'その他'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); }
    const box = h('section', { class: 'panel stack', 'aria-label': 'キャラクターの書き出し' },
      h('div', { class: 'section-head' }, h('h2', null, 'キャラクターの書き出し'), h('p', null, '選んだキャラクターを、付与する状態や召喚する乗騎と一緒に書き出します。')));
    const chips = h('div', { class: 'stack', style: { gap: '6px' } });
    for (const [g, cs] of groups) {
      chips.append(h('div', { class: 'row tight' }, h('span', { class: 'small muted', style: { minWidth: '72px' } }, g),
        h('div', { class: 'chips' }, cs.map((c) => h('button', { type: 'button', class: 'chip', 'aria-pressed': selSet.has(c.id) ? 'true' : 'false', onclick: () => {
          UI.charSel = selSet.has(c.id) ? UI.charSel.filter((x) => x !== c.id) : UI.charSel.concat([c.id]); render();
        } }, c.name)))));
    }
    const n = UI.charSel.length;
    const deps = n ? collectDeps(UI.charSel) : { characters: [], states: [] };
    const extra = deps.characters.length - n;
    box.append(chips,
      h('div', { class: 'row' },
        btn('全選択', () => { UI.charSel = D.characters.map((c) => c.id); render(); }, 'ghost sm'),
        btn('全解除', () => { UI.charSel = []; render(); }, 'ghost sm'),
        h('span', { class: 'small muted' }, n ? `${n}体を選択${extra > 0 ? `（召喚先 ${extra}体も含む）` : ''}・状態 ${deps.states.length}件` : 'キャラクターを選んでください')),
      h('div', { class: 'row' },
        btn('ファイルに書き出し', () => {
          if (!n) { toast('キャラクターを選んでください'); return; }
          const first = D.characters.find((c) => c.id === UI.charSel[0]);
          exportItems(bundleCharacters(UI.charSel), `キャラ_${safeName(n === 1 ? first.name : first.name + 'ほか' + n + '体')}.json`, 'file');
        }, 'primary', { disabled: n ? null : true }),
        btn('テキストでコピー', () => { if (n) exportItems(bundleCharacters(UI.charSel), '', 'text'); }, '', { disabled: n ? null : true }),
        btn('閉じる', () => { UI.charExportOpen = false; render(); }, 'ghost')));
    return box;
  }

  // ------------------------------------------------------------------
  // 共通：描画・入出力
  // ------------------------------------------------------------------
  function datalists() {
    let dl = $('#dl-ranks');
    if (!dl) { dl = h('datalist', { id: 'dl-ranks' }); document.body.append(dl); }
    dl.innerHTML = '';
    for (const r of D.rules.ranks) dl.append(h('option', { value: r.rank }));
    let ds = $('#dl-stats');
    if (!ds) { ds = h('datalist', { id: 'dl-stats' }); document.body.append(ds); }
    ds.innerHTML = '';
    for (const s of D.rules.stats) ds.append(h('option', { value: s.key }));
    ds.append(h('option', { value: 'min:MAG,LUK' }));
  }

  function render() {
    const y = window.scrollY;
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === UI.tab ? 'true' : 'false'));
    $('#rules-name').textContent = D.rules.name || '';
    datalists();
    const app = $('#app');
    resultsEl = null; runBarEl = null;
    const view = { test: renderTest, chars: renderChars, states: renderStates, rules: renderRules, lab: renderLab, help: renderHelp }[UI.tab] || renderTest;
    const node = view();
    app.replaceChildren(node);
    const dlg = importDialog();
    if (dlg) app.append(dlg);
    window.scrollTo(0, y);
  }

  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    if (UI.tab === b.dataset.tab) return;
    UI.tab = b.dataset.tab; UI.confirm = null; save(); render(); window.scrollTo(0, 0);
  }));

  $('#btn-export').addEventListener('click', () => {
    downloadJSON(Object.assign(header('all'), clone(D)), `trpg-balance-全データ-${new Date().toISOString().slice(0, 10)}.json`);
    toast('すべてのデータを書き出しました');
  });
  $('#file-import').addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    readFileThen(f, (text) => { ev.target.value = ''; openImport(text); });
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && UI.importDialog) { UI.importDialog = null; render(); } });

  if (/^#(test|chars|states|rules|lab|help)$/.test(location.hash)) UI.tab = location.hash.slice(1);
  render();
})();
