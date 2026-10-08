/*
 * TRPG バランス自動テストツール — シミュレーションエンジン
 * ブラウザ（メインスレッド / Web Worker）と Node の両方で動作する純粋なロジック。
 * DOM には依存しない。
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------
  // 定数（GUI からも参照）
  // ------------------------------------------------------------------
  const TIMINGS = [
    ['static', '常時（ステータス・フラグ）'],
    ['battleStart', 'セッション開始時（キャラシート作成時）'],
    ['movePhase', '次のターンの移動フェイズ'],
    ['engagementStart', '交戦フェイズ開始時'],
    ['initiative', '先手判定時（自分）'],
    ['allyInitiative', '味方（自分以外）の先手判定時'],
    ['turnStart', '自分の手番開始時'],
    ['action', '行動として使用（攻撃の代わり）'],
    ['attack', '自分の攻撃判定時'],
    ['defend', '自分の防御判定時'],
    ['allyAttack', '味方（自分以外）の攻撃判定時'],
    ['allyDefend', '味方（自分含む）の防御判定時'],
    ['allyAttacked', '味方が攻撃対象にされた時'],
    ['support', '自分が援護する時'],
    ['dealtDamage', 'ダメージを与えた後'],
    ['tookDamage', 'ダメージを受けた後'],
    ['lethal', 'HPが0になる時'],
    ['roundEnd', '巡の終了時'],
    ['engagementEnd', '交戦フェイズ終了時'],
  ];
  const TIMING_LABEL = Object.fromEntries(TIMINGS);

  // phase: roll = 判定中に効く / other = 即時または判定後に実行
  const EFFECT_TYPES = {
    mod: { label: '補正値（ダイス個数）', params: ['value', 'upTo'], phase: 'roll' },
    faces: { label: 'ダイス面数の増減', params: ['value'], phase: 'roll' },
    noNegFaces: { label: 'ダイスのマイナス補正を受けない', params: [], phase: 'roll' },
    reroll: { label: '振り直し（最大値を採用）', params: ['value'], phase: 'roll' },
    aoe: { label: '敵の前衛全員を攻撃', params: [], phase: 'roll' },
    defStat: { label: '相手の防御能力値を変更', params: ['stat'], phase: 'roll' },
    negateOpp: { label: '相手のスキル補正を無効', params: ['names', 'kinds'], phase: 'roll' },
    suppressSelf: { label: '自分のスキル補正を無効（強化無効）', params: ['kinds'], phase: 'roll' },
    noRedirect: { label: '相手の攻撃対象変更を無効', params: [], phase: 'roll' },
    redirect: { label: '攻撃対象を変更（自分・指定した味方）', params: ['dest'], phase: 'redirect' },
    endure: { label: 'HPが0になる時に耐える・復活', params: ['value'], phase: 'lethal' },
    reshape: { label: 'ステータス振り直し（変容）', params: ['profiles'], phase: 'other' },
    heal: { label: 'HP回復', params: ['value', 'to', 'if'], phase: 'other' },
    damage: { label: 'ダメージを与える', params: ['value', 'to', 'floor', 'if'], phase: 'other' },
    maxHp: { label: '最大HP増減', params: ['value', 'to'], phase: 'other' },
    stat: { label: 'ステータス増減', params: ['stat', 'value', 'to', 'if'], phase: 'other' },
    applyState: { label: '状態を付与', params: ['state', 'to', 'if'], phase: 'other' },
    clearDebuffs: { label: 'デバフ解除', params: ['to', 'if'], phase: 'other' },
    resource: { label: 'リソース増減', params: ['key', 'value', 'to', 'if'], phase: 'other' },
    statSteal: { label: 'レベルドレイン（能力値を奪う）', params: ['value', 'if'], phase: 'other' },
    clearBuffs: { label: 'バフ（有利な状態）解除', params: ['to', 'if'], phase: 'other' },
    summon: { label: '召喚（乗騎・使い魔など）', params: ['char', 'value', 'pos', 'life', 'link', 'collapse', 'territory', 'if'], phase: 'other' },
    territoryBreak: { label: '陣地破壊', params: ['if'], phase: 'other' },
    flag: { label: 'フラグ（常時）', params: ['name'], phase: 'static' },
    negateIncoming: { label: '受ける攻撃のスキル補正を無効（常時）', params: ['names', 'kinds'], phase: 'static' },
    kill: { label: '自分が消滅する', params: ['if'], phase: 'other' },
  };
  const ROLL_PHASE = new Set(Object.keys(EFFECT_TYPES).filter((k) => EFFECT_TYPES[k].phase === 'roll'));

  const TARGETS = [
    ['self', '自分'],
    ['target', '相手（判定・イベントの相手）'],
    ['actor', '判定を行う味方'],
    ['allies', '味方全員（自分含む）'],
    ['alliesOther', '味方全員（自分除く）'],
    ['alliesFront', '味方前衛全員'],
    ['lowestAlly', 'HP割合が最も低い味方'],
    ['servants', '自分のサーヴァント（マスター用）'],
    ['master', '自分のマスター'],
    ['enemiesFront', '敵前衛全員'],
    ['enemyLowest', '敵前衛で残りHPが最も低い1体'],
    ['enemyTopHp', '敵前衛で残りHPが最も高い1体'],
    ['enemyRandom', '敵前衛からランダムに1体'],
  ];

  const FLAGS = [
    ['surprise', '奇襲攻撃が可能（気配遮断など）'],
    ['debuffImmune', 'デバフを受けない'],
    ['cannotAct', '行動できない'],
    ['fullDamage', 'マスターでもサーヴァントに通常ダメージ'],
    ['independent', '単独行動（マスター喪失後も次のターンの交戦フェイズ終了まで残る）'],
    ['territoryGuard', '陣地破壊を無効（前衛にいる時）'],
  ];

  const AI_POLICIES = [
    ['asap', '使えるときに使う'],
    ['finisher', '効果が大きいときだけ（しきい値%）'],
    ['hpBelow', '対象のHPがしきい値%以下のとき'],
    ['never', '使わない'],
  ];

  const TARGET_POLICIES = [
    ['smart', '期待ダメージ最大（撃破優先）'],
    ['lowestHp', '残りHPが最も低い相手'],
    ['highestHp', '残りHPが最も高い相手'],
    ['random', 'ランダム'],
    ['tag', '指定タグを優先'],
  ];

  // ------------------------------------------------------------------
  // 乱数
  // ------------------------------------------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedFor(seed, i) {
    let h = 2166136261 >>> 0;
    const s = String(seed) + ':' + i;
    for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // ------------------------------------------------------------------
  // 式
  // ------------------------------------------------------------------
  const fnCache = new Map();
  function compileExpr(src) {
    const key = String(src);
    if (fnCache.has(key)) return fnCache.get(key);
    let fn = null;
    try { fn = new Function('S', 'with (S) { return (' + key + '\n); }'); } catch (e) { fn = null; }
    fnCache.set(key, fn);
    return fn;
  }
  function checkExpr(src) {
    if (src === undefined || src === null || String(src).trim() === '') return null;
    try { new Function('S', 'with (S) { return (' + src + '\n); }'); return null; } catch (e) { return e.message; }
  }
  const NUM_RE = /^-?\d+(\.\d+)?$/;

  // ------------------------------------------------------------------
  // 数学
  // ------------------------------------------------------------------
  function erf(x) {
    const s = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
  const phi = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  function expPositive(mu, sd) {
    if (sd < 1e-9) return Math.max(0, mu);
    const z = mu / sd;
    return mu * Phi(z) + sd * phi(z);
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ------------------------------------------------------------------
  // ルール補助
  // ------------------------------------------------------------------
  function rankInfo(rules, rank) {
    const r = String(rank == null ? '' : rank).trim();
    const hit = (rules.ranks || []).find((x) => x.rank === r);
    if (hit) return { value: +hit.value, cost: +hit.cost, ex: !!hit.ex };
    if (NUM_RE.test(r)) return { value: +r, cost: +r, ex: false };
    return { value: 1, cost: 1, ex: false, unknown: true };
  }

  function heroPoints(rules, ch) {
    let stat = 0;
    for (const s of rules.stats) stat += rankInfo(rules, (ch.stats || {})[s.key]).cost;
    let skill = 0, np = 0;
    for (const sk of ch.skills || []) { if (sk.kind === 'np') np += +sk.cost || 0; else skill += +sk.cost || 0; }
    return { stat, skill, np, total: stat + skill + np };
  }

  /**
   * 初期令呪の計算。
   * 令呪コスト ＝ ⌈(英雄点 − 予算)÷5⌉ ＋ 作成時に失う令呪、予算 ＝ 基本30 ＋ スキルで得る英雄点（サーヴァント＋契約マスター）
   * 初期令呪 ＝ 3 ＋ 初期令呪増加 − 令呪コスト（0〜3）
   */
  function csPlan(rules, ch, masterCh) {
    const hb = rules.heroBudget || { base: 30, perCs: 5 };
    const hp = heroPoints(rules, ch);
    const sum = (c, f) => (c ? (c.skills || []).reduce((a, sk) => a + (+sk[f] || 0), 0) : 0);
    const bonusServant = sum(ch, 'heroBonus');
    const bonusMaster = sum(masterCh, 'heroBonus');
    const budget = (+hb.base || 30) + bonusServant + bonusMaster;
    const over = Math.max(0, hp.total - budget);
    const fromPoints = Math.ceil(over / (+hb.perCs || 5));
    const loss = sum(ch, 'csLoss');
    const gain = sum(masterCh, 'csGain') + sum(ch, 'csGain');
    const manual = ch.csCostMode === 'manual';
    const cost = manual ? Math.max(0, +ch.csCost || 0) : fromPoints + loss;
    const max = (rules.commandSpells && +rules.commandSpells.max) || 3;
    return { hero: hp.total, budget, bonusServant, bonusMaster, over, fromPoints, loss, gain, cost, manual, start: clamp(max + gain - cost, 0, max) };
  }

  function baseMaxHp(rules, ch) {
    const vars = {};
    for (const s of rules.stats) vars[s.key] = rankInfo(rules, (ch.stats || {})[s.key]).value;
    let v = 0;
    const fn = compileExpr(rules.hpFormula || '0');
    try { v = fn ? +fn(vars) : 0; } catch (e) { v = 0; }
    if (!isFinite(v)) v = 0;
    return Math.max(1, Math.round(v + (+ch.hpExtra || 0)));
  }

  function previewMaxHp(rules, ch) {
    let hp = baseMaxHp(rules, ch);
    for (const sk of ch.skills || []) for (const b of sk.blocks || []) {
      if (!(b.timings || []).includes('battleStart')) continue;
      for (const e of b.effects || []) if (e.type === 'maxHp' && (!e.to || e.to === 'self') && NUM_RE.test(String(e.value).trim())) hp += +e.value;
    }
    return hp;
  }

  // ------------------------------------------------------------------
  // コンパイル（シナリオ → 実行用データ）
  // ------------------------------------------------------------------
  function compileScenario(data) {
    const rules = data.rules;
    const charMap = new Map((data.characters || []).map((c) => [c.id, c]));
    const stateDefs = new Map((data.states || []).map((s) => [s.name, s]));
    const scn = data.scenario;
    const warnings = [];
    const teams = (scn.teams || []).map((t, ti) => ({
      name: t.name || ('陣営' + (ti + 1)),
      flags: String(t.flags || '').split(/[,、\s]+/).filter(Boolean),
      support: t.support !== false, // 画面と同じく、未指定なら援護あり
      csMode: t.csMode || 'auto',
      csAI: t.csAI || 'normal',
      members: (t.members || []).map((m, mi) => {
        const ch = charMap.get(m.charId);
        if (!ch) { warnings.push('見つからないキャラクター: ' + m.charId); return null; }
        const master = m.master === '' || m.master === null || m.master === undefined || +m.master === mi ? null : +m.master;
        return { ch, pos: m.pos === 'back' ? 'back' : 'front', key: !!m.key, master, init: m.init || null, srcIndex: mi };
      }).filter(Boolean),
    })).filter((t) => t.members.length > 0);
    // 式のチェック
    const exprs = [];
    const scanBlocks = (owner, blocks) => {
      for (const b of blocks || []) {
        for (const r of (b.cond && b.cond.rows) || []) exprs.push([owner, r.expr]);
        for (const e of b.effects || []) { if (e.value !== undefined) exprs.push([owner, e.value]); if (e.if) exprs.push([owner, e.if]); }
      }
    };
    for (const t of teams) for (const m of t.members) for (const sk of m.ch.skills || []) scanBlocks(m.ch.name + '/' + sk.name, sk.blocks);
    for (const s of stateDefs.values()) scanBlocks('状態 ' + s.name, s.blocks);
    for (const [owner, ex] of exprs) { const err = checkExpr(ex); if (err) warnings.push(`式エラー（${owner}）: ${ex} → ${err}`); }
    // マスター指定は元の並び順の番号 → 有効メンバー内の番号に変換
    for (const t of teams) for (const m of t.members) {
      if (m.master === null) continue;
      const k = t.members.findIndex((x) => x.srcIndex === m.master);
      m.master = k >= 0 ? k : null;
    }
    const charByName = new Map();
    for (const c of data.characters || []) { if (!charByName.has(c.name)) charByName.set(c.name, c); charByName.set(c.id, c); }
    return {
      rules, stateDefs, teams, warnings, charByName,
      rounds: scn.rounds || { mode: 'teams', value: 2 },
      maxEngagements: Math.max(1, +scn.maxEngagements || 1),
      // 総当たりなどで要因を外して比べる用（英雄点・令呪コストの計算には影響しない）
      exclude: { summon: !!(scn.exclude && scn.exclude.summon), np: !!(scn.exclude && scn.exclude.np) },
    };
  }

  // ------------------------------------------------------------------
  // 戦闘ランタイム
  // ------------------------------------------------------------------
  function makeScope(B) {
    const S = {
      self: null, actor: null, target: null, event: { damage: 0 },
      d: (n, f) => {
        n = Math.max(0, Math.floor(+n || 0)); f = Math.max(1, Math.floor(+f || 6));
        let s = 0; for (let i = 0; i < n; i++) s += 1 + Math.floor(B.rng() * f); return s;
      },
      has: (u, tag) => !!(u && u._u && u._u.tags.has(tag)),
      teamFlag: (f) => !!(S.self && B.teams[S.self._u.team].flags.has(f)),
      hasInitiative: (u) => {
        const t = u || S.target;
        if (!S.self || !t) return false;
        return B.orderRank[S.self._u.team] < B.orderRank[t._u.team];
      },
      allyDown: () => (S.self ? B.teams[S.self._u.team].units.filter((x) => !x.alive && !x.vanished).length : 0),
      hasState: (u, name) => !!(u && u._u.insts.some((i) => i.isState && i.def.name === name)),
      enemyTerritory: () => !!(S.self && B.teams.some((t) => t.idx !== S.self._u.team && !t.out && hasTerritory(B, t))),
      isServant: (u) => !!(u && S.self && u._u.masterId === S.self._u.id),
      isMaster: (u) => !!(u && S.self && S.self._u.masterId === u._u.id),
      allyCount: (tag) => (S.self ? B.teams[S.self._u.team].units.filter((x) => x.alive && (!tag || x.tags.has(tag))).length : 0),
      enemyCount: (tag) => (S.self ? B.teams.filter((t) => t.idx !== S.self._u.team && !t.out).reduce((a, t) => a + t.units.filter((x) => x.alive && (!tag || x.tags.has(tag))).length, 0) : 0),
      min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil, abs: Math.abs,
      rand: () => B.rng(),
    };
    Object.defineProperty(S, 'round', { get: () => B.round });
    Object.defineProperty(S, 'totalRound', { get: () => B.totalRound });
    Object.defineProperty(S, 'engagement', { get: () => B.engagement });
    return S;
  }

  function evalExpr(B, src, fallback, scopeArgs) {
    if (src === undefined || src === null) return fallback;
    if (typeof src === 'number') return src;
    const s = String(src).trim();
    if (s === '') return fallback;
    if (NUM_RE.test(s)) return +s;
    const fn = compileExpr(s);
    if (!fn) { B.warn.add('式エラー: ' + s); return fallback; }
    const S = B.scope;
    const saved = scopeArgs ? [S.self, S.actor, S.target, S.event] : null;
    if (scopeArgs) {
      S.self = scopeArgs.self ? scopeArgs.self.v : null;
      S.actor = scopeArgs.actor ? scopeArgs.actor.v : null;
      S.target = scopeArgs.target ? scopeArgs.target.v : null;
      S.event = scopeArgs.event || { damage: 0 };
    }
    let v;
    try { v = fn(S); } catch (e) { B.warn.add('式エラー: ' + s + '（' + e.message + '）'); v = fallback; }
    if (saved) { S.self = saved[0]; S.actor = saved[1]; S.target = saved[2]; S.event = saved[3]; }
    if (typeof v === 'boolean') return v;
    if (v === undefined || v === null || (typeof v === 'number' && isNaN(v))) return fallback;
    return v;
  }

  function condOk(B, block, sc) {
    const rows = (block.cond && block.cond.rows) || [];
    const active = rows.filter((r) => r && String(r.expr || '').trim() !== '');
    if (!active.length) return true;
    const any = block.cond.mode === 'any';
    for (const r of active) {
      let ok = !!evalExpr(B, r.expr, false, sc);
      if (r.not) ok = !ok;
      if (any && ok) return true;
      if (!any && !ok) return false;
    }
    return !any;
  }

  function makeUnitView(B, u) {
    const v = { _u: u };
    for (const st of B.rules.stats) Object.defineProperty(v, st.key, { get: () => getStat(B, u, st.key), enumerable: true });
    Object.defineProperty(v, 'hp', { get: () => u.hp });
    Object.defineProperty(v, 'maxHp', { get: () => u.maxHp });
    Object.defineProperty(v, 'hpPct', { get: () => (u.maxHp > 0 ? (u.hp / u.maxHp) * 100 : 0) });
    Object.defineProperty(v, 'damageTaken', { get: () => u.dmgTaken });
    Object.defineProperty(v, 'damageDealt', { get: () => u.dmgDealt });
    Object.defineProperty(v, 'alive', { get: () => u.alive });
    Object.defineProperty(v, 'front', { get: () => u.pos === 'front' });
    Object.defineProperty(v, 'res', { get: () => u.res });
    Object.defineProperty(v, 'name', { get: () => u.name });
    Object.defineProperty(v, 'cls', { get: () => u.cls });
    Object.defineProperty(v, 'summoned', { get: () => !!u.summoned });
    return v;
  }

  function staticBlocks(u) {
    const out = [];
    for (const inst of u.insts) for (const b of inst.def.blocks || []) if ((b.timings || []).includes('static')) out.push([inst, b]);
    return out;
  }

  function getStat(B, u, key) {
    let v = (u.base[key] || 0) + (u.statDelta[key] || 0) + (u.statDelta.ALL || 0);
    if (!u._computing) {
      u._computing = true;
      for (const [inst, b] of staticBlocks(u)) {
        let applies = null;
        for (const e of b.effects || []) {
          if (e.type !== 'stat' || (e.stat !== key && e.stat !== 'ALL')) continue;
          if (applies === null) applies = condOk(B, b, { self: inst.owner, actor: u, target: null });
          if (!applies) break;
          v += +evalExpr(B, e.value, 0, { self: inst.owner, actor: u }) || 0;
        }
      }
      u._computing = false;
    }
    return clamp(Math.round(v), B.rules.statMin ?? 1, B.rules.statMax ?? 10);
  }

  function hasFlag(B, u, name) {
    for (const [inst, b] of staticBlocks(u)) {
      for (const e of b.effects || []) {
        if (e.type === 'flag' && e.name === name && condOk(B, b, { self: inst.owner, actor: u })) return true;
      }
    }
    return false;
  }

  function newInst(def, owner, isState) {
    return {
      def, owner, isState,
      used: { round: 0, engagement: 0, battle: 0 },
      charges: isState && +def.charges > 0 ? +def.charges : null,
      turnsLeft: isState && def.duration === 'rounds' ? Math.max(1, +def.durationValue || 1) : null,
    };
  }

  function isLimited(inst) {
    const d = inst.def;
    if (inst.isState) return false;
    return !!((d.uses && +d.uses.max > 0) || (d.resource && d.resource.key) || +d.csUse > 0);
  }

  function canUse(inst) {
    const d = inst.def;
    if (!inst.owner.alive && !inst.allowDead) return false;
    if (d.uses && +d.uses.max > 0 && inst.used[d.uses.per || 'battle'] >= +d.uses.max) return false;
    if (d.resource && d.resource.key) {
      const have = inst.owner.res[d.resource.key] || 0;
      if (have < (+d.resource.amount || 1)) return false;
    }
    if (inst.charges !== null && inst.charges <= 0) return false;
    if (+d.csUse > 0) {
      const B = inst.owner._B;
      const h = B && csHolder(B, inst.owner);
      if (!h || csCount(h) < +d.csUse) return false;
      if (B.teams[inst.owner.team].csAI === 'never') return false;
    }
    return true;
  }

  function consume(B, inst) {
    const d = inst.def;
    inst.used.round++; inst.used.engagement++; inst.used.battle++;
    if (d.resource && d.resource.key) inst.owner.res[d.resource.key] -= (+d.resource.amount || 1);
    if (+d.csUse > 0) { const h = csHolder(B, inst.owner); if (h) csSpend(B, h, +d.csUse, d.name + 'の発動', inst.owner); }
    if (inst.charges !== null) {
      inst.charges--;
      if (inst.charges <= 0) removeInst(inst.owner, inst);
    }
    if (!inst.isState) {
      const su = inst.owner.skillUse;
      su[d.name] = (su[d.name] || 0) + 1;
    }
  }

  function removeInst(u, inst) {
    const i = u.insts.indexOf(inst);
    if (i >= 0) u.insts.splice(i, 1);
  }

  function aliveTeams(B) {
    return B.teams.filter((t) => !t.out && t.units.some((u) => u.alive));
  }
  function enemiesFront(B, u) {
    const out = [];
    for (const t of B.teams) {
      if (t.idx === u.team || t.out) continue;
      for (const x of t.units) if (x.alive && x.pos === 'front') out.push(x);
    }
    return out;
  }
  function allies(B, u) { return B.teams[u.team].units.filter((x) => x.alive); }

  function ensureFront(B, team) {
    if (team.out) return;
    const alive = team.units.filter((x) => x.alive);
    if (alive.length && !alive.some((x) => x.pos === 'front')) {
      alive.sort((a, b) => b.hp - a.hp);
      alive[0].pos = 'front';
      log(B, `　${alive[0].name} が前衛に出た`);
    }
  }

  function log(B, msg) { if (B.log) B.log.push(msg); }

  // ------------------------------------------------------------------
  // AI：限定スキルを使うか
  // ------------------------------------------------------------------
  function aiWants(B, inst, info) {
    if (!isLimited(inst)) return true;
    const ai = inst.def.ai || { policy: 'asap' };
    const thr = ai.threshold === undefined || ai.threshold === '' ? 50 : +ai.threshold;
    switch (ai.policy) {
      case 'never': return false;
      case 'hpBelow': {
        const s = (info && info.subject) || inst.owner;
        return s.maxHp > 0 && (s.hp / s.maxHp) * 100 <= thr;
      }
      case 'finisher': return info && info.finisher ? info.finisher(inst, thr) : true;
      default: return true;
    }
  }

  // ------------------------------------------------------------------
  // 判定（準備 → ロール）
  // ------------------------------------------------------------------
  function sumModsOfBlocks(B, owner, roller, opp, blocks) {
    let s = 0;
    for (const b of blocks) for (const e of b.effects || []) if (e.type === 'mod') s += Math.max(0, +evalExpr(B, e.value, 0, { self: owner, actor: roller, target: opp }) || 0);
    return s;
  }

  function matchBlocks(B, inst, timing, ctx, roller) {
    const out = [];
    for (const b of inst.def.blocks || []) {
      if (!(b.timings || []).includes(timing)) continue;
      if (ctx.type && b.types && b.types.length && !b.types.includes(ctx.type)) continue;
      if (!condOk(B, b, { self: inst.owner, actor: roller, target: ctx.opp, event: ctx.event })) continue;
      out.push(b);
    }
    return out;
  }

  /**
   * timing: 'initiative' | 'attack' | 'defend'
   * ctx: { type, opp, dry, negate, extra, atkValue }
   */
  function prepareRoll(B, roller, timing, ctx) {
    const P = {
      roller, timing, type: ctx.type || null, opp: ctx.opp || null,
      fixed: ctx.extra || 0, minus: 0, upTo: [], facePos: 0, faceNeg: 0, noNeg: false, reroll: 0,
      aoe: false, defStat: null, negate: { names: new Set(), kinds: new Set() }, noRedirect: false,
      post: [], applied: [],
    };
    const cands = [];
    for (const inst of roller.insts) {
      const bl = matchBlocks(B, inst, timing, ctx, roller);
      if (bl.length) cands.push({ inst, owner: roller, blocks: bl });
    }
    const allyTiming = timing === 'attack' ? 'allyAttack' : timing === 'defend' ? 'allyDefend' : timing === 'initiative' ? 'allyInitiative' : null;
    if (allyTiming) {
      for (const a of allies(B, roller)) {
        if ((allyTiming === 'allyAttack' || allyTiming === 'allyInitiative') && a === roller) continue;
        for (const inst of a.insts) {
          const bl = matchBlocks(B, inst, allyTiming, ctx, roller);
          if (bl.length) cands.push({ inst, owner: a, blocks: bl });
        }
      }
    }
    // 無制限のものを先に。限定スキルは効果の大きい順（宝具は1回の判定につき1つだけ）
    const weight = (c) => sumModsOfBlocks(B, c.owner, roller, ctx.opp, c.blocks) + (c.blocks.some((b) => (b.effects || []).some((e) => e.type === 'aoe')) ? 3 : 0);
    for (const c of cands) c.w = isLimited(c.inst) ? weight(c) : 0;
    cands.sort((x, y) => (isLimited(x.inst) ? 1 : 0) - (isLimited(y.inst) ? 1 : 0) || y.w - x.w);

    const chosen = [];
    // 同じ攻撃の別の防御者で既に発動した「味方全員の防御」系（我が神はここにありて等）は、消費せずに効果だけ適用
    if (ctx.shared) for (const sh of ctx.shared) {
      const bl = matchBlocks(B, sh.inst, 'allyDefend', ctx, roller);
      if (bl.length && sh.owner.alive) chosen.push({ inst: sh.inst, owner: sh.owner, blocks: bl, sharedReuse: true });
    }
    for (const c of cands) {
      if (ctx.shared && ctx.shared.some((sh) => sh.inst === c.inst)) continue;
      if (!canUse(c.inst)) continue;
      if (c.inst.def.kind === 'np' && !c.inst.isState && chosen.some((x) => x.owner === c.owner && x.inst.def.kind === 'np' && !x.inst.isState)) continue;
      if (isLimited(c.inst)) {
        if (ctx.dry) {
          const pol = (c.inst.def.ai && c.inst.def.ai.policy) || 'asap';
          if (pol !== 'asap') continue;
          // リソースを共有する宝具が複数ある場合は1つだけ
          const rk = c.inst.def.resource && c.inst.def.resource.key;
          if (rk && chosen.some((x) => x.inst.owner === c.inst.owner && x.inst.def.resource && x.inst.def.resource.key === rk)) continue;
        } else {
          const info = buildAiInfo(B, P, roller, timing, ctx, c, chosen);
          if (!aiWants(B, c.inst, info)) continue;
        }
      }
      chosen.push(c);
      if (!ctx.dry && (isLimited(c.inst) || c.inst.charges !== null)) consume(B, c.inst);
      if (!ctx.dry && ctx.shared && isLimited(c.inst) && c.blocks.some((b) => (b.timings || []).includes('allyDefend'))) { ctx.shared.push({ inst: c.inst, owner: c.owner }); c.sharedFirst = true; }
    }

    // 強化無効などの自己抑制
    const suppress = new Set();
    for (const c of chosen) for (const b of c.blocks) for (const e of b.effects || []) {
      if (e.type === 'suppressSelf') String(e.kinds || 'skill').split(/[,、\s]+/).filter(Boolean).forEach((k) => suppress.add(k));
    }

    for (const c of chosen) {
      const d = c.inst.def;
      const kind = c.inst.isState ? 'state' : d.kind || 'skill';
      const negated = ctx.negate && (ctx.negate.names.has(d.name) || ctx.negate.kinds.has(kind) || ctx.negate.kinds.has('*'));
      const suppressed = suppress.has(kind) || suppress.has('*');
      let contributed = false;
      for (const b of c.blocks) for (const e of b.effects || []) {
        if (!ROLL_PHASE.has(e.type)) {
          if (e.type === 'territoryBreak') { if (!ctx.dry) P.territoryBreak = c.owner; continue; }
          if (c.sharedReuse) continue;
          if (EFFECT_TYPES[e.type] && EFFECT_TYPES[e.type].phase === 'other') P.post.push({ inst: c.inst, owner: c.owner, eff: e, deferred: !!c.sharedFirst });
          continue;
        }
        const sc = { self: c.owner, actor: roller, target: ctx.opp };
        switch (e.type) {
          case 'mod': {
            const v = +evalExpr(B, e.value, 0, sc) || 0;
            if (v > 0 && (negated || suppressed)) break;
            if (v >= 0) { if (e.upTo) P.upTo.push(v); else P.fixed += v; } else P.minus += -v;
            contributed = true;
            break;
          }
          case 'faces': {
            const v = +evalExpr(B, e.value, 0, sc) || 0;
            if (v > 0 && (negated || suppressed)) break;
            if (v >= 0) P.facePos += v; else P.faceNeg += v;
            contributed = true;
            break;
          }
          case 'noNegFaces': P.noNeg = true; break;
          case 'reroll': P.reroll = Math.max(P.reroll, Math.floor(+evalExpr(B, e.value, 1, sc) || 0)); contributed = true; break;
          case 'aoe': P.aoe = true; break;
          case 'defStat': P.defStat = e.stat; break;
          case 'negateOpp':
            String(e.names || '').split(/[,、]+/).map((x) => x.trim()).filter(Boolean).forEach((n) => P.negate.names.add(n));
            String(e.kinds || '').split(/[,、\s]+/).filter(Boolean).forEach((k) => P.negate.kinds.add(k));
            break;
          case 'noRedirect': P.noRedirect = true; break;
          default: break;
        }
      }
      if (!ctx.dry) P.applied.push(d.name + (negated ? '（無効化）' : suppressed ? '（強化無効）' : ''));
    }
    return P;
  }

  function buildAiInfo(B, P, roller, timing, ctx, cand, chosen) {
    const info = { subject: roller };
    if (timing === 'attack') {
      info.subject = cand.owner;
      info.finisher = (inst, thr) => {
        if (!ctx.opp) return true;
        const extra = sumModsOfBlocks(B, cand.owner, roller, ctx.opp, cand.blocks);
        const base = P.fixed;
        let soFar = 0;
        for (const c of chosen) soFar += sumModsOfBlocks(B, c.owner, roller, ctx.opp, c.blocks);
        const est = quickDamage(B, roller, ctx.type, ctx.opp, base + soFar + extra);
        return est.E >= ctx.opp.hp * (thr / 100) || (roller.maxHp > 0 && roller.hp / roller.maxHp <= 0.3);
      };
    } else if (timing === 'defend') {
      info.subject = roller;
      info.finisher = (inst, thr) => {
        const statKey = ctx.statKey;
        const D = prepareRoll(B, roller, 'defend', { type: ctx.type, opp: ctx.opp, dry: true, negate: ctx.negate });
        const est = rollEstimate(B, roller, D, statKey);
        return (ctx.atkValue || 0) - est.mean >= roller.hp * (thr / 100);
      };
    }
    return info;
  }

  function statValueFor(B, u, statSpec) {
    const s = String(statSpec || '');
    if (s.startsWith('min:') || s.startsWith('max:')) {
      const keys = s.slice(4).split(/[,、]+/).map((x) => x.trim()).filter(Boolean);
      const vals = keys.map((k) => getStat(B, u, k));
      return s.startsWith('min:') ? Math.min(...vals) : Math.max(...vals);
    }
    return getStat(B, u, s);
  }

  function facesFor(B, plus, minus, facePos, faceNeg, noNeg) {
    const R = B.rules;
    let f = (+R.dice.faces || 6) + facePos + (noNeg ? 0 : faceNeg);
    const pen = R.penalty || {};
    if (pen.enabled !== false) {
      const thr = pen.threshold === undefined ? 10 : +pen.threshold;
      const step = +pen.step || 10;
      const negThr = pen.negThreshold === undefined ? 5 : +pen.negThreshold;
      if (plus > thr) f -= Math.floor(plus / step);
      else if (minus >= negThr) f += 1;
    }
    return clamp(f, +R.dice.min || 2, +R.dice.max || 10);
  }

  function chooseRoll(B, P, statVal) {
    const sumUp = Math.floor(P.upTo.reduce((a, b) => a + b, 0));
    let best = null;
    for (let k = 0; k <= sumUp; k++) {
      const plus = P.fixed + k;
      const count = Math.max(0, Math.floor(statVal + plus - P.minus));
      const faces = facesFor(B, plus, P.minus, P.facePos, P.faceNeg, P.noNeg);
      const mean = (count * (faces + 1)) / 2;
      if (!best || mean > best.mean + 1e-9) best = { k, plus, count, faces, mean };
    }
    best.var = (best.count * (best.faces * best.faces - 1)) / 12;
    return best;
  }

  function rollEstimate(B, u, P, statKey) {
    const best = chooseRoll(B, P, statValueFor(B, u, statKey));
    if (P.reroll > 0) {
      // 最大値採用の近似：平均を +0.6σ×log2(試行回数+1)、分散を縮小
      const sd = Math.sqrt(best.var);
      const n = P.reroll + 1;
      return { mean: best.mean + sd * 0.85 * Math.log2(n), var: best.var * 0.6 };
    }
    return { mean: best.mean, var: best.var };
  }

  function rollDice(B, count, faces) {
    let s = 0;
    for (let i = 0; i < count; i++) s += 1 + Math.floor(B.rng() * faces);
    return s;
  }

  function executeRoll(B, _u, P, statKey) {
    const u = P.roller;
    const statVal = statValueFor(B, u, statKey);
    const best = chooseRoll(B, P, statVal);
    let value = rollDice(B, best.count, best.faces);
    for (let r = 0; r < P.reroll; r++) value = Math.max(value, rollDice(B, best.count, best.faces));
    let exUsed = false;
    if (u.exLeft > 0 && B.rules.exRerolls !== false) {
      const sd = Math.sqrt(best.var);
      if (value < best.mean - 0.5 * sd) {
        u.exLeft--; exUsed = true;
        value = rollDice(B, best.count, best.faces);
      }
    }
    return { value, count: best.count, faces: best.faces, plus: best.plus, minus: P.minus, stat: statVal, exUsed, P };
  }

  function rollText(r) {
    return `${r.value}（${r.count}D${r.faces}${r.csNote ? '・' + r.csNote : ''}${r.exUsed ? '・EX振り直し' : ''}${r.csReroll ? '・令呪で振り直し' : ''}）`;
  }

  // ------------------------------------------------------------------
  // 令呪
  // ------------------------------------------------------------------
  function csOn(B) { return !(B.rules.commandSpells && B.rules.commandSpells.enabled === false); }
  function findUnit(B, id) { for (const t of B.teams) for (const u of t.units) if (u.id === id) return u; return null; }
  function isMasterUnit(B, u) { return u.tags.has(B.rules.masterTag || 'マスター'); }
  function isServantUnit(B, u) { return !u.summoned && !isMasterUnit(B, u) && !u.tags.has('乗騎'); }
  function csEligible(B, u) { return isServantUnit(B, u) && !u.tags.has('ボス'); }
  /** サーヴァント用の令呪の持ち主（マスター、またはマスター未配置なら仮想の手持ち） */
  function csHolder(B, u) {
    if (!csOn(B) || B.teams[u.team].csOff || !u.alive || !isServantUnit(B, u)) return null;
    if (u.masterId) { const m = findUnit(B, u.masterId); return m && m.alive ? { unit: m, res: true } : null; }
    return u.csVirtual ? { unit: u, res: false } : null;
  }
  function masterHolder(B, m) {
    if (!csOn(B) || B.teams[m.team].csOff || !m.alive || !isMasterUnit(B, m)) return null;
    return { unit: m, res: true };
  }
  const csCount = (h) => (h.res ? h.unit.res.cs || 0 : h.unit.csPool || 0);
  function csAllow(B, beneficiary, h, need, emergency) {
    if (!h) return false;
    const pol = B.teams[beneficiary.team].csAI || 'normal';
    if (pol === 'never') return false;
    const n = csCount(h);
    if (n < need) return false;
    if (pol === 'normal' && !emergency && n - need < 1) return false; // 通常は緊急用に1画残す
    return true;
  }
  function csSpend(B, h, need, label, beneficiary) {
    if (h.res) h.unit.res.cs -= need; else h.unit.csPool -= need;
    const key = '令呪：' + label;
    beneficiary.skillUse[key] = (beneficiary.skillUse[key] || 0) + need;
    log(B, `　令呪（${label}）→ ${beneficiary.name}【残り${csCount(h)}画】`);
  }
  function rerollPlus3(B, r) {
    const P = r.P;
    const plus = r.plus + 3;
    const count = Math.max(0, Math.floor(r.stat + plus - P.minus));
    const faces = facesFor(B, plus, P.minus, P.facePos, P.faceNeg, P.noNeg);
    return { count, faces, mean: (count * (faces + 1)) / 2, sd: Math.sqrt((count * (faces * faces - 1)) / 12) };
  }
  function doCsReroll(B, r) {
    const x = rerollPlus3(B, r);
    r.value = rollDice(B, x.count, x.faces); r.count = x.count; r.faces = x.faces; r.plus += 3; r.csReroll = true;
  }
  /** 正規近似で「値 >= need」となる確率 */
  function pAtLeast(mu, v, need) {
    const sd = Math.sqrt(Math.max(0, v));
    return sd > 0 ? 1 - Phi((need - 0.5 - mu) / sd) : (mu >= need ? 1 : 0);
  }
  /** 令呪の判定前の上乗せ（5までの補正値／ダイス面数+1）を入れた場合の判定の分布 */
  function csPreDist(B, u, P, statKey, kind) {
    const Q = Object.assign({}, P, {
      upTo: P.upTo.concat(kind === 'plus5' ? [5] : kind === 'plus3' ? [3] : []),
      facePos: (P.facePos || 0) + (kind === 'face1' ? 1 : 0),
    });
    return rollEstimate(B, u, Q, statKey);
  }
  function applyCsPre(P, kind) {
    if (kind === 'plus5') P.upTo.push(5); else if (kind === 'face1') P.facePos = (P.facePos || 0) + 1;
  }
  const CS_PRE_LABEL = { plus5: '判定に5までの補正値', face1: 'ダイス面数+1' };
  /** 判定前に使う令呪の候補のうち、成功率が最も高いもの */
  function bestCsPre(B, u, P, statKey, prob) {
    let best = null;
    for (const kind of ['plus5', 'face1']) {
      const d = csPreDist(B, u, P, statKey, kind);
      const p = prob(d);
      if (!best || p > best.p) best = { kind, p };
    }
    return best;
  }
  function csThresholds(B, team) {
    return B.teams[team].csAI === 'aggressive' ? { gain: 0.1, min: 0.25 } : { gain: 0.2, min: 0.4 };
  }
  /** 倒せばその陣営のサーヴァントが全滅するか（最後の1画を使ってよい場面） */
  function lastEnemyServant(B, t) {
    return !B.teams[t.team].units.some((x) => x !== t && x.alive && isServantUnit(B, x));
  }

  /** 自陣営の手番開始時：回復・宝具回数の回復 */
  function csTurnStart(B, team) {
    if (!csOn(B) || team.csOff) return;
    for (const u of team.units) {
      const h = csHolder(B, u);
      if (!h) continue;
      if (!enemiesFront(B, u).length) continue;
      // 自分の次の手番までに受けうるダメージ（敵の前衛全員が自分を狙った場合、行動回数も考慮）で倒れうるなら回復する
      let risk = 0;
      for (const e of enemiesFront(B, u)) {
        let best = 0;
        for (const ty of availableTypes(B, e)) { const q = quickDamage(B, e, ty.key, u); best = Math.max(best, Math.max(0, q.mu) + q.sd); }
        risk += best * Math.max(1, e.actions || 1);
      }
      const missing = u.maxHp - u.hp;
      const danger = u.hp <= risk;
      if (danger && missing >= 15 && csAllow(B, u, h, 1, u.hp <= risk * 0.6)) {
        csSpend(B, h, 1, 'HP30回復', u);
        const before = u.hp; u.hp = Math.min(u.maxHp, u.hp + 30); u.healed += u.hp - before;
        continue;
      }
      const spent = Object.keys(u.resMax).filter((k) => /^np/.test(k) && u.resMax[k] > 0 && (u.res[k] || 0) < u.resMax[k]);
      if (spent.length && csAllow(B, u, h, 2, false) && (B.teams[u.team].csAI === 'aggressive' || csCount(h) >= 3)) {
        csSpend(B, h, 2, '宝具回数1回復', u);
        u.res[spent[0]] = (u.res[spent[0]] || 0) + 1;
      }
    }
  }
  /** マスターが狙われた時、自分のサーヴァントへ攻撃対象を変更 */
  function csRedirect(B, attacker, typeKey, target) {
    if (!isMasterUnit(B, target)) return target;
    const sv = B.teams[target.team].units.find((x) => x.alive && x.masterId === target.id && isServantUnit(B, x));
    if (!sv) return target;
    const h = csHolder(B, sv);
    if (!h) return target;
    const qm = quickDamage(B, attacker, typeKey, target);
    if (qm.killP < 0.3 && qm.E < target.hp * 0.5) return target;
    const qs = quickDamage(B, attacker, typeKey, sv);
    if (sv.hp - qs.E <= 0 && qs.killP > 0.6) return target;
    if (!csAllow(B, sv, h, 1, true)) return target;
    csSpend(B, h, 1, '攻撃対象をサーヴァントに変更', sv);
    return sv;
  }

  // ------------------------------------------------------------------
  // 期待ダメージ（AI 用）
  // ------------------------------------------------------------------
  function attackTypeDef(B, key) { return B.rules.attackTypes.find((t) => t.key === key); }

  function quickDamage(B, attacker, typeKey, target, extraFixed, addFixed) {
    const T = attackTypeDef(B, typeKey);
    const A = prepareRoll(B, attacker, 'attack', { type: typeKey, opp: target, dry: true, negate: incomingNegation(B, target, attacker) });
    if (extraFixed !== undefined) A.fixed = extraFixed;
    if (addFixed) A.fixed += addFixed;
    const ae = rollEstimate(B, attacker, A, T.atkStat);
    const D = prepareRoll(B, target, 'defend', { type: typeKey, opp: attacker, dry: true, negate: A.negate });
    const de = rollEstimate(B, target, D, A.defStat || T.defStat);
    let mu = ae.mean - de.mean;
    let sd = Math.sqrt(ae.var + de.var);
    let E = expPositive(mu, sd);
    if (isMasterHalf(B, attacker, target)) { E /= 2; mu /= 2; sd /= 2; }
    const killP = sd > 0 ? 1 - Phi((target.hp - mu) / sd) : (mu >= target.hp ? 1 : 0);
    return { E, mu, sd, killP, aoe: A.aoe };
  }

  function isMasterHalf(B, attacker, target) {
    const tag = B.rules.masterTag;
    if (!tag || B.rules.masterHalf === false) return false;
    return attacker.tags.has(tag) && !target.tags.has(tag) && !hasFlag(B, attacker, 'fullDamage');
  }

  function availableTypes(B, u) {
    return B.rules.attackTypes.filter((t) => !t.requiresFlag || hasFlag(B, u, t.requiresFlag));
  }

  function chooseAttack(B, u, extra, onlyType) {
    const foes = enemiesFront(B, u);
    if (!foes.length) return null;
    const types = availableTypes(B, u).filter((t) => !onlyType || t.key === onlyType);
    if (!types.length) return null;
    const pol = u.ai.target || 'smart';
    let pool = foes;
    if (pol === 'lowestHp') { const m = Math.min(...foes.map((f) => f.hp)); pool = foes.filter((f) => f.hp === m); }
    else if (pol === 'highestHp') { const m = Math.max(...foes.map((f) => f.hp)); pool = foes.filter((f) => f.hp === m); }
    else if (pol === 'random') pool = [foes[Math.floor(B.rng() * foes.length)]];
    else if (pol === 'tag' && u.ai.tag) { const p = foes.filter((f) => f.tags.has(u.ai.tag)); if (p.length) pool = p; }
    let best = null;
    for (const t of pool) {
      for (const ty of types) {
        let est;
        if (extra) {
          const A = prepareRoll(B, u, 'attack', { type: ty.key, opp: t, dry: true });
          est = quickDamage(B, u, ty.key, t, A.fixed + extra);
        } else est = quickDamage(B, u, ty.key, t);
        let score = Math.min(est.E, t.hp) + est.killP * 8;
        if (est.aoe && foes.length > 1) {
          for (const o of foes) if (o !== t) { const q2 = quickDamage(B, u, ty.key, o); score += Math.min(q2.E, o.hp) + q2.killP * 8; }
        }
        if (!best || score > best.score + 1e-9) best = { type: ty.key, target: t, score, E: est.E };
      }
    }
    return best;
  }

  // ------------------------------------------------------------------
  // イベント・効果
  // ------------------------------------------------------------------
  function resolveTo(B, owner, to, ctx) {
    switch (to || 'self') {
      case 'self': return [owner];
      case 'target': return ctx.target && ctx.target.alive ? [ctx.target] : [];
      case 'actor': return ctx.actor && ctx.actor.alive ? [ctx.actor] : [];
      case 'allies': return allies(B, owner);
      case 'alliesOther': return allies(B, owner).filter((x) => x !== owner);
      case 'alliesFront': return allies(B, owner).filter((x) => x.pos === 'front');
      case 'lowestAlly': {
        const a = allies(B, owner);
        if (!a.length) return [];
        a.sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp);
        return [a[0]];
      }
      case 'servants': return allies(B, owner).filter((x) => x.masterId === owner.id);
      case 'master': return allies(B, owner).filter((x) => x.id === owner.masterId);
      case 'enemiesFront': return enemiesFront(B, owner);
      case 'enemyLowest': case 'enemyTopHp': case 'enemyRandom': {
        const f = enemiesFront(B, owner);
        if (!f.length) return [];
        if (to === 'enemyRandom') return [f[Math.floor(B.rng() * f.length)]];
        f.sort((x, y) => (to === 'enemyLowest' ? x.hp - y.hp : y.hp - x.hp));
        return [f[0]];
      }
      default: return [owner];
    }
  }
  const MULTI_TO = new Set(['allies', 'alliesOther', 'alliesFront', 'servants', 'enemiesFront', 'enemyLowest', 'enemyTopHp', 'enemyRandom', 'lowestAlly', 'master']);

  function applyState(B, owner, u, name) {
    const def = B.stateDefs.get(name);
    if (!u.alive) return;
    if (!def) { B.warn.add('未定義の状態: ' + name); return; }
    if (def.debuff && hasFlag(B, u, 'debuffImmune')) { log(B, `　${u.name} は ${name} を無効化`); return; }
    const ex = u.insts.find((i) => i.isState && i.def.name === name);
    if (ex) removeInst(u, ex);
    const inst = newInst(def, u, true);
    inst.source = owner;
    inst.appliedSerial = B.turnSerial || 0;
    u.insts.push(inst);
    log(B, `　${u.name} に状態「${name}」`);
  }

  function runEffect(B, owner, eff, ctx) {
    const perTarget = MULTI_TO.has(eff.to);
    const hasIf = eff.if && String(eff.if).trim();
    if (hasIf && !perTarget && !evalExpr(B, eff.if, false, { self: owner, actor: ctx.actor, target: ctx.target, event: ctx.event })) return;
    if (eff.type === 'summon') { summonUnits(B, owner, eff, ctx); return; }
    const targets = eff.type === 'statSteal' ? (ctx.target ? [ctx.target] : []) : resolveTo(B, owner, eff.to, ctx);
    for (const u of targets) {
      if (!u) continue;
      // 複数対象の効果では、各対象を target として式を評価する
      const sc2 = { self: owner, actor: ctx.actor, target: perTarget ? u : ctx.target, event: ctx.event };
      if (hasIf && perTarget && !evalExpr(B, eff.if, false, sc2)) continue;
      switch (eff.type) {
        case 'heal': {
          if (!u.alive) break;
          const v = Math.max(0, Math.round(+evalExpr(B, eff.value, 0, sc2) || 0));
          const before = u.hp;
          u.hp = Math.min(u.maxHp, u.hp + v);
          u.healed += u.hp - before;
          log(B, `　${u.name} のHPが ${u.hp - before} 回復（${u.hp}/${u.maxHp}）`);
          break;
        }
        case 'damage': {
          const v = Math.max(0, Math.round(+evalExpr(B, eff.value, 0, sc2) || 0));
          const floor = eff.floor === undefined || eff.floor === '' ? null : +eff.floor;
          const dealt = dealDamage(B, owner, u, v, { floor, noTrigger: true });
          if (dealt > 0) log(B, `　${owner.name} の効果で ${u.name} に ${dealt} ダメージ（${u.hp}/${u.maxHp}）`);
          break;
        }
        case 'maxHp': {
          const v = Math.round(+evalExpr(B, eff.value, 0, sc2) || 0);
          u.maxHp = Math.max(1, u.maxHp + v);
          u.hp = clamp(u.hp + Math.max(0, v), 0, u.maxHp);
          if (u.masterId && u.masterId === owner.id) u.masterHpBonus += v;
          break;
        }
        case 'stat': {
          const v = Math.round(+evalExpr(B, eff.value, 0, sc2) || 0);
          const k = eff.stat || 'ALL';
          u.statDelta[k] = (u.statDelta[k] || 0) + v;
          break;
        }
        case 'applyState': applyState(B, owner, u, eff.state); break;
        case 'territoryBreak': {
          if (u === owner) territoryBreak(B, owner);
          break;
        }
        case 'reshape': {
          if (u !== owner || !u.alive) break;
          reshapeUnit(B, u, eff.profiles);
          break;
        }
        case 'clearBuffs': {
          const gone = u.insts.filter((i) => i.isState && !i.def.debuff).map((i) => i.def.name);
          u.insts = u.insts.filter((i) => !(i.isState && !i.def.debuff));
          if (gone.length) log(B, `　${u.name} のバフ解除（${gone.join('・')}）`);
          break;
        }
        case 'clearDebuffs': {
          const gone = u.insts.filter((i) => i.isState && i.def.debuff).map((i) => i.def.name);
          u.insts = u.insts.filter((i) => !(i.isState && i.def.debuff));
          if (gone.length) log(B, `　${u.name} のデバフ解除（${gone.join('・')}）`);
          break;
        }
        case 'resource': {
          const k = eff.key || 'np';
          const v = Math.round(+evalExpr(B, eff.value, 0, sc2) || 0);
          const mx = u.resMax[k] === undefined ? Infinity : u.resMax[k];
          u.res[k] = clamp((u.res[k] || 0) + v, 0, mx);
          break;
        }
        case 'statSteal': {
          if (!u.alive) break;
          const limit = Math.max(1, Math.round(+evalExpr(B, eff.value, 3, sc2) || 3));
          const key = owner.id + '>' + u.id;
          B.steals[key] = B.steals[key] || 0;
          if (B.steals[key] >= limit) break;
          if (hasFlag(B, u, 'debuffImmune')) break;
          B.steals[key]++;
          let bestK = null, bestV = -1;
          for (const st of B.rules.stats) { const v = getStat(B, u, st.key); if (v > bestV) { bestV = v; bestK = st.key; } }
          u.statDelta[bestK] = (u.statDelta[bestK] || 0) - 1;
          owner.statDelta[bestK] = (owner.statDelta[bestK] || 0) + 1;
          if (B.rules.hpStat && bestK === B.rules.hpStat) {
            const per = +B.rules.hpPerStat || 5;
            u.maxHp = Math.max(1, u.maxHp - per); u.hp = Math.min(u.hp, u.maxHp);
            owner.maxHp += per; owner.hp += per;
          }
          (B.stealLog = B.stealLog || []).push({ thief: owner, victim: u, key: bestK, hp: !!(B.rules.hpStat && bestK === B.rules.hpStat) });
          log(B, `　${owner.name} が ${u.name} の ${statName(B, bestK)} を奪った`);
          break;
        }
        case 'kill': {
          if (u.alive) { u.hp = 0; killUnit(B, u, null, '消滅'); }
          break;
        }
        default: break;
      }
    }
  }

  /** 変容：候補プロファイルの中から、現在の相手に対して最も有利なステータス配分を選ぶ（交戦終了で戻る） */
  function reshapeUnit(B, u, profilesText) {
    const keys = B.rules.stats.map((s) => s.key);
    const profiles = String(profilesText || '').split(/[|\n]+/).map((line) => {
      const vals = {};
      for (const part of line.split(/[,、\s]+/)) {
        const m = part.match(/^([A-Za-z]+)\s*[:：=]\s*(.+)$/);
        if (m && keys.includes(m[1])) vals[m[1]] = m[2].trim();
      }
      return Object.keys(vals).length ? vals : null;
    }).filter(Boolean);
    if (!profiles.length) return;
    if (!u.reshapeBase) u.reshapeBase = { base: Object.assign({}, u.base), maxHp: u.maxHp, exMax: u.exMax };
    const orig = u.reshapeBase;
    const hpKey = B.rules.hpStat;
    const per = +B.rules.hpPerStat || 5;
    const apply = (pr) => {
      let ex = 0;
      for (const k of keys) {
        const ri = rankInfo(B.rules, pr[k] !== undefined ? pr[k] : null);
        u.base[k] = pr[k] !== undefined ? ri.value : orig.base[k];
        if (pr[k] !== undefined ? ri.ex : false) ex++;
      }
      const dHp = hpKey ? (u.base[hpKey] - orig.base[hpKey]) * per : 0;
      return { ex, maxHp: Math.max(1, orig.maxHp + dHp) };
    };
    const foes = enemiesFront(B, u);
    let best = null;
    const savedHp = u.hp, savedMax = u.maxHp;
    for (const pr of profiles) {
      const r = apply(pr);
      u.maxHp = r.maxHp; u.hp = Math.max(1, Math.min(r.maxHp, savedHp + (r.maxHp - savedMax)));
      let off = 0, def = 0;
      for (const f of foes) {
        let o = 0; for (const ty of availableTypes(B, u)) o = Math.max(o, quickDamage(B, u, ty.key, f).E);
        let d = 0; for (const ty of availableTypes(B, f)) d = Math.max(d, quickDamage(B, f, ty.key, u).E);
        off = Math.max(off, o); def += d;
      }
      const score = off - def * 0.8 + (u.hp - savedHp) * 0.5 + r.ex * 2;
      if (!best || score > best.score) best = { pr, score, r };
    }
    const r = apply(best.pr);
    const dMax = r.maxHp - savedMax;
    u.maxHp = r.maxHp; u.hp = Math.max(1, Math.min(u.maxHp, savedHp + dMax));
    u.exMax = r.ex; u.exLeft = r.ex;
    log(B, `　${u.name} が変容：${keys.map((k) => `${statName(B, k)}${best.pr[k] !== undefined ? best.pr[k] : '-'}`).join(' ')}（最大HP ${u.maxHp}）`);
  }
  function revertReshape(B) {
    for (const t of B.teams) for (const u of t.units) {
      if (!u.reshapeBase) continue;
      const o = u.reshapeBase;
      const dMax = o.maxHp - u.maxHp;
      u.base = Object.assign({}, o.base); u.exMax = o.exMax;
      u.maxHp = o.maxHp; if (u.alive) u.hp = Math.max(1, Math.min(u.maxHp, u.hp + Math.min(0, dMax)));
      u.reshapeBase = null;
    }
  }

  function statName(B, k) { const s = B.rules.stats.find((x) => x.key === k); return s ? s.name : k; }

  /** AI 判断の主体：回復などの対象が味方なら、その中で最も消耗している者 */
  function subjectFor(B, u, blocks) {
    let pool = null;
    for (const b of blocks) for (const e of b.effects || []) {
      if (!['heal', 'clearDebuffs', 'maxHp', 'resource'].includes(e.type)) continue;
      if (e.to && e.to !== 'self' && e.to !== 'target' && !e.to.startsWith('enemy')) {
        const r = resolveTo(B, u, e.to, {});
        if (r.length) pool = (pool || []).concat(r);
      }
    }
    if (!pool) return u;
    pool.sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp);
    return pool[0];
  }

  /** 非判定タイミングのトリガー。戻り値: 発動した inst の配列 */
  function fire(B, u, timing, ctx, opts) {
    const fired = [];
    if (!u.alive && timing !== 'lethal') return fired;
    for (const inst of u.insts.slice()) {
      if (!u.insts.includes(inst)) continue;
      const bl = matchBlocks(B, inst, timing, { opp: ctx.target, event: ctx.event, type: ctx.type }, u);
      if (!bl.length) continue;
      if (!canUse(inst)) continue;
      const hasEffects = bl.some((b) => (b.effects || []).some((e) => EFFECT_TYPES[e.type] && EFFECT_TYPES[e.type].phase === 'other'));
      if (!hasEffects) continue;
      if (isLimited(inst) && !aiWants(B, inst, opts && opts.aiInfo ? opts.aiInfo(inst, bl) : { subject: subjectFor(B, u, bl) })) continue;
      const freeTiming = timing === 'battleStart';
      if (!freeTiming && (isLimited(inst) || inst.charges !== null)) consume(B, inst);
      if (timing !== 'battleStart') log(B, `　${u.name}「${inst.def.name}」発動`);
      for (const b of bl) for (const e of b.effects || []) {
        if (EFFECT_TYPES[e.type] && EFFECT_TYPES[e.type].phase === 'other') runEffect(B, u, e, { actor: u, target: ctx.target, event: ctx.event });
      }
      fired.push(inst);
    }
    return fired;
  }

  /** HPが0になる時の介入。戻り値: 残すHP（0なら介入なし） */
  function tryEndure(B, u, src, opts) {
    const ev = { damage: (opts && opts.damage) || 0, attackType: (opts && opts.attackType) || '' };
    for (const inst of u.insts.slice()) {
      for (const b of inst.def.blocks || []) {
        if (!(b.timings || []).includes('lethal')) continue;
        const en = (b.effects || []).find((e) => e.type === 'endure');
        if (!en) continue;
        inst.allowDead = true;
        const ok = canUse(inst) && condOk(B, b, { self: u, actor: u, target: src, event: ev });
        inst.allowDead = false;
        if (!ok) continue;
        consume(B, inst);
        const hpAfter = clamp(Math.round(+evalExpr(B, en.value === undefined || en.value === '' ? 1 : en.value, 1, { self: u, actor: u, target: src, event: ev }) || 1), 1, u.maxHp);
        log(B, `　${u.name}「${inst.def.name}」でHP${hpAfter}で${hpAfter > 1 ? '復活' : '耐えた'}`);
        u.hp = hpAfter;
        for (const e of b.effects || []) if (EFFECT_TYPES[e.type] && EFFECT_TYPES[e.type].phase === 'other') runEffect(B, u, e, { actor: u, target: src, event: ev });
        return hpAfter;
      }
    }
    return 0;
  }

  function killUnit(B, u, src, why) {
    u.alive = false; u.hp = 0; u.died = true;
    if (src) src.kills++;
    log(B, `　✖ ${u.name} 脱落${why ? '（' + why + '）' : ''}`);
    const team = B.teams[u.team];
    if (u.group) checkCollapse(B, u);
    // レベルドレインなど、脱落した者が付与した状態異常は解除（奪った能力値は相手に戻る）
    if (B.stealLog && B.stealLog.some((x) => x.thief === u)) {
      for (const x of B.stealLog.filter((y) => y.thief === u)) {
        x.victim.statDelta[x.key] = (x.victim.statDelta[x.key] || 0) + 1;
        if (x.hp) x.victim.maxHp += +B.rules.hpPerStat || 5;
      }
      B.stealLog = B.stealLog.filter((y) => y.thief !== u);
      log(B, `　${u.name} の脱落により、付与していた状態異常（レベルドレイン）が解除`);
    }
    for (const t of B.teams) for (const x of t.units) {
      const before = x.insts.length;
      x.insts = x.insts.filter((i) => !(i.isState && i.def.debuff && i.def.removeOnSourceDeath && i.source === u));
      if (x.insts.length !== before) log(B, `　${x.name} の状態異常が解除（付与者の脱落）`);
    }
    if (u.key) { team.out = true; log(B, `　陣営「${team.name}」の要が倒れた`); }
    // 親が倒れたら子も消滅
    for (const x of team.units) if (x.alive && x.parentId && x.parentId === u.id) vanish(B, x, '召喚者の脱落');
    // マスターの脱落：サーヴァントは魔力供給を失う
    const servants = team.units.filter((x) => x.alive && x.masterId === u.id && !x.summoned);
    if (servants.length && B.rules.masterLoss !== false) {
      for (const sv of servants) {
        const loss = u.maxHp + sv.masterHpBonus;
        log(B, `　マスター喪失：${sv.name} は魔力供給を失い ${loss} ダメージ`);
        dealDamage(B, null, sv, loss, {});
        if (sv.alive) {
          sv.fadeAt = B.engagement + (hasFlag(B, sv, 'independent') ? 1 : 0);
          log(B, `　${sv.name} は${sv.fadeAt > B.engagement ? '次のターン' : 'このターン'}の終了時（交戦フェイズ終了時）に消滅する`);
        }
      }
    }
    ensureFront(B, team);
  }

  /** 群体の召喚（王の軍勢など）：生き残りが召喚数の半分以下になったら全て消滅 */
  function checkCollapse(B, u) {
    const g = u.group;
    if (!g || g.done || !g.collapse) return;
    const alive = B.teams[u.team].units.filter((x) => x.alive && x.group === g);
    if (alive.length * 2 > g.total) return;
    g.done = true;
    if (alive.length) log(B, `　${g.name}が召喚数${g.total}の半分以下（残り${alive.length}）になり、陣地ごと消滅`);
    for (const x of alive) { x.alive = false; x.hp = 0; x.vanished = true; }
    ensureFront(B, B.teams[u.team]);
  }

  /** 陣地破壊：相手陣営の陣地（陣営フラグ「陣地」、陣地扱いの状態、固有結界の召喚体）を消す */
  function hasTerritory(B, team) {
    if ([...team.flags].some((f) => f.startsWith('陣地'))) return true;
    for (const u of team.units) {
      if (!u.alive) continue;
      if (u.insts.some((i) => i.isState && i.def.territory)) return true;
      if (u.group && u.group.territory && !u.group.done) return true;
    }
    return false;
  }
  function territoryBreak(B, owner) {
    let any = false;
    for (const t of B.teams) {
      if (t.idx === owner.team || t.out || !hasTerritory(B, t)) continue;
      const guard = t.units.find((u) => u.alive && u.pos === 'front' && hasFlag(B, u, 'territoryGuard'));
      if (guard) { log(B, `　陣地破壊は ${guard.name} によって無効化された`); continue; }
      any = true;
      for (const f of [...t.flags]) if (f.startsWith('陣地')) t.flags.delete(f);
      for (const u of t.units) {
        u.insts = u.insts.filter((i) => !(i.isState && i.def.territory));
        if (u.alive && u.group && u.group.territory && !u.group.done) { u.alive = false; u.hp = 0; u.vanished = true; }
      }
      for (const u of t.units) if (u.group && u.group.territory) u.group.done = true;
      log(B, `　陣地破壊：陣営「${t.name}」の陣地が消滅`);
      ensureFront(B, t);
    }
    return any;
  }

  function vanish(B, x, why) {
    if (!x.alive) return;
    x.alive = false; x.hp = 0;
    if (x.summoned) x.vanished = true; else x.died = true;
    log(B, `　${x.name} 消滅（${why}）`);
    for (const y of B.teams[x.team].units) if (y.alive && y.parentId === x.id) vanish(B, y, '召喚者の消滅');
    ensureFront(B, B.teams[x.team]);
  }

  function dealDamage(B, src, t, dmg, opts) {
    if (dmg <= 0 || !t.alive) return 0;
    let newHp = t.hp - dmg;
    if (opts && opts.floor !== null && opts.floor !== undefined) newHp = Math.max(newHp, Math.min(opts.floor, t.hp));
    if (opts && opts.minHp1) newHp = Math.max(newHp, 1);
    const actual = t.hp - newHp;
    if (actual <= 0) return 0;
    t.hp = newHp;
    if (src) src.dmgDealt += actual;
    t.dmgTaken += actual;
    if (t.hp <= 0) {
      const kept = tryEndure(B, t, src, { damage: actual, attackType: opts && opts.attackType });
      if (kept > 0) t.hp = kept;
      else killUnit(B, t, src, null);
    }
    return actual;
  }

  // ------------------------------------------------------------------
  // 攻撃
  // ------------------------------------------------------------------
  /** 攻撃対象の変更先：dest が空なら自分、「自分」または味方キャラクター名（カンマ区切り） */
  function redirectDests(B, holder, effs) {
    const team = B.teams[holder.team];
    const out = new Set();
    for (const e of effs) {
      const names = String(e.dest || '').split(/[,、]+/).map((x) => x.trim()).filter(Boolean);
      if (!names.length) { out.add(holder); continue; }
      for (const n of names) {
        if (n === '自分' || n === 'self') { out.add(holder); continue; }
        for (const x of team.units) if (x.alive && x.pos === 'front' && x.name === n && (!x.summoned || !x.parentId || x.parentId === holder.id)) out.add(x);
      }
    }
    return [...out].filter((x) => x.alive && x.pos === 'front');
  }

  /** そのユニットを失った時の重さ（AIの攻撃対象変更の判断用） */
  function unitWorth(B, u) {
    if (!u.summoned) return 100;
    const g = u.group;
    if (g && !g.done) {
      const alive = B.teams[u.team].units.filter((x) => x.alive && x.group === g).length;
      const groupWorth = 60;
      if (g.collapse && (alive - 1) * 2 <= g.total) return groupWorth; // この1体で群れごと崩れる
      return groupWorth / Math.max(1, g.total);
    }
    return 40;
  }

  function redirectCost(B, u, q) {
    const pd = q.killP;
    return unitWorth(B, u) * (pd + (1 - pd) * 0.5 * Math.min(1, q.E / Math.max(1, u.hp)));
  }

  function handleRedirect(B, attacker, target, typeKey, extra) {
    const team = B.teams[target.team];
    const qOf = new Map();
    const qd = (u) => { if (!qOf.has(u)) { const q = quickDamage(B, attacker, typeKey, u, undefined, extra); qOf.set(u, q); } return qOf.get(u); };
    const baseQ = qd(target);
    const baseScore = target.hp - baseQ.E;
    const baseCost = redirectCost(B, target, baseQ);
    let best = null;
    for (const c of team.units) {
      if (!c.alive || c.pos !== 'front') continue;
      for (const inst of c.insts) {
        const bl = matchBlocks(B, inst, 'allyAttacked', { opp: attacker, type: typeKey }, c);
        const effs = [];
        for (const b of bl) for (const e of b.effects || []) if (e.type === 'redirect') effs.push(e);
        if (!effs.length) continue;
        if (!canUse(inst)) continue;
        for (const d of redirectDests(B, c, effs)) {
          if (d === target) continue;
          const q = qd(d);
          const cost = redirectCost(B, d, q);
          // 召喚体が絡む場合は「失うものの重さ」で比べる（軍勢を盾にする／召喚体を庇って本体が倒れない）
          const ok = d.summoned || target.summoned
            ? cost < baseCost - 1
            : d.hp - q.E > baseScore + 3;
          if (!ok) continue;
          const score = -cost;
          if (!best || score > best.score) best = { unit: c, dest: d, inst, blocks: bl, score };
        }
      }
    }
    if (!best) return { target, post: null };
    if (isLimited(best.inst) && !aiWants(B, best.inst, { subject: target })) return { target, post: null };
    if (isLimited(best.inst) || best.inst.charges !== null) consume(B, best.inst);
    log(B, best.dest === best.unit
      ? `　${best.unit.name}「${best.inst.def.name}」で攻撃対象を自分に変更`
      : `　${best.unit.name}「${best.inst.def.name}」で攻撃対象を${best.dest.name}に変更`);
    const post = [];
    for (const b of best.blocks) for (const e of b.effects || []) {
      if (!(EFFECT_TYPES[e.type] && EFFECT_TYPES[e.type].phase === 'other')) continue;
      // 実行条件のない効果（防御用の状態付与など）は即時、条件付きは攻撃処理の後
      if (e.if && String(e.if).trim()) post.push({ owner: best.unit, eff: e });
      else runEffect(B, best.unit, e, { actor: best.unit, target: attacker, event: { damage: 0 } });
    }
    return { target: best.dest, post };
  }

  function incomingNegation(B, target, attacker) {
    let neg = null;
    for (const [inst, b] of staticBlocks(target)) {
      for (const e of b.effects || []) {
        if (e.type !== 'negateIncoming') continue;
        if (!condOk(B, b, { self: inst.owner, actor: target, target: attacker })) continue;
        neg = neg || { names: new Set(), kinds: new Set() };
        String(e.names || '').split(/[,、]+/).map((x) => x.trim()).filter(Boolean).forEach((n) => neg.names.add(n));
        String(e.kinds || '').split(/[,、\s]+/).filter(Boolean).forEach((k) => neg.kinds.add(k));
      }
    }
    return neg;
  }

  function summarizeSupport(list) {
    const m = new Map();
    for (const x of list) { const k = x.unit.name; const e = m.get(k) || { n: 0, v: 0 }; e.n++; e.v += x.value; m.set(k, e); }
    return [...m.entries()].map(([k, e]) => (e.n > 1 ? `${k}×${e.n} +${e.v}` : `${k} +${e.v}`)).join('、');
  }

  function supportBonus(B, s, typeKey, opp, dry) {
    const T = attackTypeDef(B, typeKey);
    const P = prepareRoll(B, s, 'support', { type: typeKey, opp, dry });
    const extra = P.fixed + P.upTo.reduce((a, b) => a + b, 0);
    return { value: getStat(B, s, T.atkStat) + extra, applied: P.applied };
  }

  function performAttack(B, attacker, typeKey, target, support) {
    const T = attackTypeDef(B, typeKey);
    // 攻撃対象の変更（カリスマ・令呪など）を先に確定し、攻撃側のスキル・条件は変更後の相手に対して評価する
    const pre = prepareRoll(B, attacker, 'attack', { type: typeKey, opp: target, extra: support ? support.value : 0, dry: true, negate: incomingNegation(B, target, attacker) });
    let redirectPost = null;
    let finalTarget = target;
    if (!pre.aoe) {
      if (!pre.noRedirect) { const r = handleRedirect(B, attacker, target, typeKey, support ? support.value : 0); finalTarget = r.target; redirectPost = r.post; }
      finalTarget = csRedirect(B, attacker, typeKey, finalTarget);
    }
    const A = prepareRoll(B, attacker, 'attack', { type: typeKey, opp: finalTarget, extra: support ? support.value : 0, negate: incomingNegation(B, finalTarget, attacker) });
    const targets = A.aoe ? enemiesFront(B, attacker) : [finalTarget];
    if (A.territoryBreak) territoryBreak(B, A.territoryBreak);
    // 令呪：撃破を狙う攻撃（判定前の「5までの補正値」「面数+1」、判定後の「振り直し+3」）
    let csAtk = null;
    const t0 = !A.aoe ? targets[0] : null;
    // 戦闘続行などで耐えられる相手でも、致死量を通せば耐える手段を使わせられるので同じ基準で使う
    const hAtk = t0 && !t0.summoned && !t0.tags.has('乗騎') ? csHolder(B, attacker) : null;
    if (hAtk) {
      const D0 = prepareRoll(B, t0, 'defend', { type: typeKey, opp: attacker, dry: true, negate: A.negate });
      const de = rollEstimate(B, t0, D0, A.defStat || T.defStat);
      const needDmg = t0.hp * (isMasterHalf(B, attacker, t0) ? 2 : 1);
      const pKill = (d) => pAtLeast(d.mean - de.mean, d.var + de.var, needDmg);
      const th = csThresholds(B, attacker.team);
      const p0 = pKill(rollEstimate(B, attacker, A, T.atkStat));
      const pR = pKill(csPreDist(B, attacker, A, T.atkStat, 'plus3'));
      const pPlan = p0 + (1 - p0) * (pR >= th.min ? pR : 0); // 外れたら振り直す前提
      const pre = bestCsPre(B, attacker, A, T.atkStat, pKill);
      csAtk = { de, needDmg, th, p0 };
      if (pre && pre.p > pPlan && pre.p - p0 >= th.gain && pre.p >= th.min
        && csAllow(B, attacker, hAtk, 1, pre.p >= 0.6 && lastEnemyServant(B, t0))) {
        csSpend(B, hAtk, 1, CS_PRE_LABEL[pre.kind] + '（攻撃）', attacker);
        applyCsPre(A, pre.kind);
        csAtk.used = pre.kind;
      }
    }
    const atk = executeRoll(B, attacker, A, T.atkStat);
    if (csAtk && csAtk.used) atk.csNote = csAtk.used === 'plus5' ? '令呪+5' : '令呪で面数+1';
    if (csAtk && !csAtk.used && hAtk && csHolder(B, attacker)) {
      const { de, needDmg, th } = csAtk;
      const pNow = pAtLeast(atk.value - de.mean, de.var, needDmg);
      const x = rerollPlus3(B, atk);
      const pR = pAtLeast(x.mean - de.mean, x.sd * x.sd + de.var, needDmg);
      if (pR - pNow >= th.gain && pR >= th.min && csAllow(B, attacker, csHolder(B, attacker), 1, pR >= 0.6 && lastEnemyServant(B, t0))) {
        csSpend(B, csHolder(B, attacker), 1, '振り直し+3（攻撃）', attacker);
        doCsReroll(B, atk);
      }
    }
    attacker.attacks++;
    const tag = A.applied.length ? ' ［' + A.applied.join('・') + '］' : '';
    const supList = support ? (support.list || [{ unit: support.unit, value: support.value, applied: support.applied }]) : [];
    const sup = supList.length ? (supList.length === 1
      ? `（${supList[0].unit.name} の援護 +${supList[0].value}${supList[0].applied && supList[0].applied.length ? '［' + supList[0].applied.join('・') + '］' : ''}）`
      : `（援護${supList.length}体 計+${support.value}：${summarizeSupport(supList)}）`) : '';
    log(B, `${attacker.name} → ${A.aoe ? '敵前衛全員' : targets[0].name}：${T.name}攻撃 ${rollText(atk)}${sup}${tag}`);
    let total = 0;
    const shared = [];
    const deferred = [];
    for (const t of targets) {
      if (!t.alive) continue;
      const defStat = A.defStat || T.defStat;
      const D = prepareRoll(B, t, 'defend', { type: typeKey, opp: attacker, negate: A.negate, atkValue: atk.value, statKey: defStat, shared });
      const half = isMasterHalf(B, attacker, t);
      // 令呪（マスター用）：自分の判定に5までの補正値
      const mh = masterHolder(B, t);
      if (mh) {
        const de = rollEstimate(B, t, D, defStat);
        const eDmg = Math.max(0, atk.value - de.mean) / (half ? 2 : 1);
        if (eDmg >= t.hp && csAllow(B, t, mh, 1, true)) { csSpend(B, mh, 1, 'マスターの判定+5', t); D.upTo.push(5); }
      }
      // 令呪（サーヴァント用）：このままでは致命傷になりやすく、判定前の上乗せの方が「外れたら振り直す」より生き残りやすい時
      let csDefNote = null;
      const hd = csHolder(B, t);
      if (hd) {
        const need = atk.value - t.hp * (half ? 2 : 1) + 1;
        const pSurv = (d) => pAtLeast(d.mean, d.var, need);
        const p0 = pSurv(rollEstimate(B, t, D, defStat));
        if (p0 < 0.9) {
          const pR = pSurv(csPreDist(B, t, D, defStat, 'plus3'));
          const pPlan = p0 + (1 - p0) * (pR >= 0.3 ? pR : 0);
          const pre = bestCsPre(B, t, D, defStat, pSurv);
          if (pre && pre.p > pPlan + 0.02 && pre.p >= 0.3 && csAllow(B, t, hd, 1, true)) {
            csSpend(B, hd, 1, CS_PRE_LABEL[pre.kind] + '（防御）', t);
            applyCsPre(D, pre.kind);
            csDefNote = pre.kind === 'plus5' ? '令呪+5' : '令呪で面数+1';
          }
        }
      }
      const def = executeRoll(B, t, D, defStat);
      if (csDefNote) def.csNote = csDefNote;
      // 令呪（サーヴァント用）：致命傷なら防御を振り直して+3
      const lethal = (v) => Math.floor(Math.max(0, atk.value - v) / (half ? 2 : 1)) >= t.hp;
      if (lethal(def.value)) {
        const h = csHolder(B, t);
        if (h) {
          const x = rerollPlus3(B, def);
          const need = atk.value - t.hp * (half ? 2 : 1) + 1;
          const pSurvive = x.sd > 0 ? 1 - Phi((need - 0.5 - x.mean) / x.sd) : (x.mean >= need ? 1 : 0);
          if (pSurvive >= 0.3 && csAllow(B, t, h, 1, true)) { csSpend(B, h, 1, '振り直し+3（防御）', t); doCsReroll(B, def); }
        }
      }
      let dmg = Math.max(0, atk.value - def.value);
      if (half) dmg = Math.floor(dmg / 2);
      const dtag = D.applied.length ? ' ［' + D.applied.join('・') + '］' : '';
      log(B, `　${t.name} 防御 ${rollText(def)}${dtag} → ${dmg} ダメージ（HP ${Math.max(0, t.hp - dmg)}/${t.maxHp}）`);
      const dealt = dealDamage(B, attacker, t, dmg, { attackType: typeKey });
      total += dealt;
      const ev = { damage: dealt, attackType: typeKey };
      // 防御側の判定後効果
      for (const p of D.post) { if (p.deferred) deferred.push({ p, actor: t }); else runEffect(B, p.owner, p.eff, { actor: t, target: attacker, event: ev }); }
      // 攻撃対象変更スキルの後続効果
      if (redirectPost && t === targets[0]) for (const p of redirectPost) runEffect(B, p.owner, p.eff, { actor: t, target: attacker, event: ev });
      // 攻撃側の判定後効果（相手単位）
      for (const p of A.post) if (p.eff.to === 'target') runEffect(B, p.owner, p.eff, { actor: attacker, target: t, event: ev });
      if (dealt > 0) {
        fire(B, t, 'tookDamage', { target: attacker, event: ev });
        fire(B, attacker, 'dealtDamage', { target: t, event: ev });
      }
    }
    const evAll = { damage: total, attackType: typeKey };
    // 味方全員の防御を支える宝具の「ダメージ計算後」の効果（回復・デバフ無効など）は、全員のダメージ計算が終わってから
    for (const d of deferred) runEffect(B, d.p.owner, d.p.eff, { actor: d.actor, target: attacker, event: evAll });
    for (const p of A.post) if (p.eff.to !== 'target') runEffect(B, p.owner, p.eff, { actor: attacker, target: targets[0], event: evAll });
    for (const sp of supList) sp.unit.supports++;
    return total;
  }

  // ------------------------------------------------------------------
  // 手番
  // ------------------------------------------------------------------
  function tryAction(B, u) {
    for (const inst of u.insts) {
      const bl = matchBlocks(B, inst, 'action', {}, u);
      if (!bl.length || !canUse(inst)) continue;
      if (!aiWants(B, inst, { subject: subjectFor(B, u, bl) })) continue;
      if (isLimited(inst) || inst.charges !== null) consume(B, inst);
      log(B, `${u.name}「${inst.def.name}」を使用（行動）`);
      for (const b of bl) for (const e of b.effects || []) if (EFFECT_TYPES[e.type] && EFFECT_TYPES[e.type].phase === 'other') runEffect(B, u, e, { actor: u, target: null, event: {} });
      return true;
    }
    return false;
  }

  function canAct(B, u) { return u.alive && u.pos === 'front' && !hasFlag(B, u, 'cannotAct'); }

  /** 「N巡」持続の状態：付与された者の手番がN回終わった時に解除（付与された手番そのものは数えない） */
  function tickTurnStates(B, team) {
    for (const u of team.units) {
      u.insts = u.insts.filter((i) => {
        if (!i.isState || i.def.duration !== 'rounds') return true;
        if (i.appliedSerial === B.turnSerial) return true;
        i.turnsLeft--;
        if (i.turnsLeft <= 0) { log(B, `　${u.name} の「${i.def.name}」が切れた`); return false; }
        return true;
      });
    }
  }

  function teamTurn(B, team) {
    if (team.out) return;
    B.turnSerial = (B.turnSerial || 0) + 1;
    try { teamTurnBody(B, team); } finally { tickTurnStates(B, team); }
  }

  function teamTurnBody(B, team) {
    for (const u of team.units) {
      if (!u.alive) continue;
      fire(B, u, 'turnStart', { target: null });
    }
    csTurnStart(B, team);
    for (const u of team.units) u.actionsLeft = Math.max(1, Math.floor(+u.actions || 1));
    let pending = team.units.filter((u) => canAct(B, u));
    for (const u of team.units) if (u.alive && hasFlag(B, u, 'cannotAct') && u.pos === 'front') log(B, `${u.name} は行動できない`);
    // 行動系スキル
    pending = pending.filter((u) => { if (tryAction(B, u)) u.actionsLeft--; return u.actionsLeft > 0; });
    let guard = 0;
    while (pending.length && guard++ < 50) {
      pending = pending.filter((u) => canAct(B, u));
      if (!pending.length) break;
      if (!aliveTeams(B).some((t) => t.idx !== team.idx)) break;
      if (team.out) break;
      const solos = pending.map((u) => ({ u, c: chooseAttack(B, u) }));
      let bestSolo = null;
      for (const s of solos) if (s.c && (!bestSolo || s.c.score > bestSolo.c.score)) bestSolo = s;
      if (!bestSolo) break;
      let bestPlan = null;
      if (team.support !== false && pending.length >= 2) bestPlan = planSupport(B, pending, solos);
      if (bestPlan) {
        const sups = bestPlan.supporters.map((sp) => {
          const sb = supportBonus(B, sp, bestPlan.type, bestPlan.c.target, false);
          sp.actionsLeft--;
          return { unit: sp, value: sb.value, applied: sb.applied };
        });
        performAttack(B, bestPlan.a, bestPlan.c.type, bestPlan.c.target, { list: sups, value: sups.reduce((x, y) => x + y.value, 0) });
        bestPlan.a.actionsLeft--;
      } else {
        performAttack(B, bestSolo.u, bestSolo.c.type, bestSolo.c.target, null);
        bestSolo.u.actionsLeft--;
      }
      pending = pending.filter((u) => u.actionsLeft > 0);
    }
  }

  /**
   * 援護の計画：攻撃役1体に、複数の味方が援護を重ねる。
   * 援護役は「援護したときの攻撃の伸び」が「その援護役が単独で攻撃した場合」を上回る間だけ1体ずつ追加する
   * （補正値+11以上の面数ペナルティで伸びが鈍れば自然に止まる）。
   */
  function planSupport(B, pending, solos) {
    const soloScore = new Map(solos.map((x) => [x.u, x.c ? x.c.score : 0]));
    const attackers = solos.filter((x) => x.c).sort((a, b) => b.c.score - a.c.score).slice(0, 4).map((x) => x.u);
    // 援護値が大きい攻撃役候補も加える（単独では弱いが補正で化ける者）
    for (const u of pending) if (!attackers.includes(u) && attackers.length < 6) {
      const T = availableTypes(B, u)[0];
      if (T && getStat(B, u, T.atkStat) >= 6) attackers.push(u);
    }
    let best = null;
    for (const a of attackers) {
      for (const ty of availableTypes(B, a)) {
        const base = chooseAttack(B, a, 0, ty.key);
        if (!base) continue;
        const others = pending.filter((x) => x !== a).map((x) => ({ u: x, v: supportBonus(B, x, ty.key, base.target, true).value }))
          .filter((x) => x.v > 0).sort((x, y) => (y.v - soloScore.get(y.u) * 0.3) - (x.v - soloScore.get(x.u) * 0.3));
        // 先頭から k 体を援護に回す案をすべて比べる（+11〜+13 のように一度期待値が下がる帯を越えられるように）
        let bestK = 0, bestVal = base.score - soloScore.get(a), bestC = base;
        let extra = 0, spent = 0;
        const limit = Math.min(others.length, 20);
        for (let k = 1; k <= limit; k++) {
          extra += others[k - 1].v; spent += soloScore.get(others[k - 1].u);
          const c = chooseAttack(B, a, extra, ty.key);
          if (!c) break;
          const val = c.score - (soloScore.get(a) + spent);
          if (val > bestVal + 0.3) { bestVal = val; bestK = k; bestC = c; }
        }
        if (!bestK) continue;
        const chosen = others.slice(0, bestK).map((o) => o.u);
        const cur = bestC;
        const value = bestVal;
        if (value > 0.5 && (!best || value > best.value)) best = { a, type: ty.key, supporters: chosen, c: cur, value };
      }
    }
    return best;
  }

  function initiative(B) {
    const teams = aliveTeams(B);
    const results = [];
    const statKey = B.rules.initiativeStat;
    for (const t of teams) {
      const fronts = t.units.filter((u) => u.alive && u.pos === 'front');
      if (!fronts.length) { results.push({ t, value: -1 }); continue; }
      let rep = fronts[0], bestE = -1;
      for (const u of fronts) {
        const P = prepareRoll(B, u, 'initiative', { dry: true });
        const e = rollEstimate(B, u, P, statKey).mean;
        if (e > bestE) { bestE = e; rep = u; }
      }
      const P = prepareRoll(B, rep, 'initiative', {});
      const r = executeRoll(B, rep, P, statKey);
      for (const p of P.post) runEffect(B, p.owner, p.eff, { actor: rep, target: null, event: {} });
      results.push({ t, value: r.value, rep, r, tie: B.rng(), applied: P.applied });
    }
    results.sort((a, b) => b.value - a.value || b.tie - a.tie);
    B.order = results.map((x) => x.t.idx);
    B.orderRank = {};
    B.order.forEach((ti, i) => { B.orderRank[ti] = i; });
    for (const t of B.teams) if (B.orderRank[t.idx] === undefined) B.orderRank[t.idx] = 99;
    log(B, '先手判定：' + results.map((x) => `${x.t.name}（${x.rep ? x.rep.name : '-'}）${x.r ? rollText(x.r) : '-'}${x.applied && x.applied.length ? '［' + x.applied.join('・') + '］' : ''}`).join(' / '));
  }

  function resetUses(B, per) {
    for (const t of B.teams) for (const u of t.units) for (const inst of u.insts) inst.used[per] = 0;
  }

  function expireStates(B, kind) {
    for (const t of B.teams) for (const u of t.units) {
      u.insts = u.insts.filter((i) => {
        if (!i.isState) return true;
        if (kind === 'engagement' && ['engagement', 'rounds'].includes(i.def.duration || 'engagement')) return false;
        return true;
      });
    }
  }

  function roundsFor(B) {
    const m = B.C.rounds.mode;
    if (m === 'fixed') return Math.max(1, +B.C.rounds.value || 1);
    if (m === 'units') return B.teams.reduce((a, t) => a + (t.out ? 0 : t.units.filter((u) => u.alive).length), 0);
    if (m === 'pl' || !m) {
      // 参加PL数：マスターとその契約サーヴァントで1人、マスター未配置のサーヴァントは1人（召喚体は数えない）
      const keys = new Set();
      for (const t of aliveTeams(B)) for (const u of t.units) if (u.alive && !u.summoned) keys.add(u.masterId || u.id);
      return Math.max(1, keys.size);
    }
    return aliveTeams(B).length;
  }

  function runEngagement(B) {
    B.engagement++;
    B.round = 0;
    resetUses(B, 'engagement');
    for (const t of B.teams) for (const u of t.units) u.exLeft = u.exMax;
    if (B.hooks && B.hooks.beforeEngagement) B.hooks.beforeEngagement(B);
    log(B, B.engagement === 1 ? `―― ターン1：交戦フェイズ ――` : `―― ターン${B.engagement}：移動フェイズ → 遭遇フェイズ → 交戦フェイズ ――`);
    if (B.engagement > 1) for (const t of B.teams) for (const u of t.units) fire(B, u, 'movePhase', { target: null });
    for (const t of B.teams) ensureFront(B, t);
    for (const t of B.teams) for (const u of t.units) fire(B, u, 'engagementStart', { target: null });
    initiative(B);
    const R = roundsFor(B);
    for (let r = 1; r <= R; r++) {
      B.round = r; B.totalRound++;
      resetUses(B, 'round');
      log(B, `[巡 ${r}]`);
      for (const ti of B.order) {
        const team = B.teams[ti];
        if (team.out || !team.units.some((u) => u.alive)) continue;
        teamTurn(B, team);
        if (aliveTeams(B).length <= 1) break;
      }
      for (const t of B.teams) for (const u of t.units) fire(B, u, 'roundEnd', { target: null });
      if (aliveTeams(B).length <= 1) break;
    }
    for (const t of B.teams) for (const u of t.units) fire(B, u, 'engagementEnd', { target: null });
    expireStates(B, 'engagement');
    revertReshape(B);
    const vanished = new Map();
    const savedLog = B.log; B.log = null; // 同名の召喚体の消滅はまとめて記録
    for (const t of B.teams) for (const u of t.units.slice()) {
      if (!u.alive) continue;
      if (u.summoned && u.life === 'engagement') { if (u.group) u.group.done = true; vanish(B, u, '交戦フェイズ終了'); vanished.set(u.name, (vanished.get(u.name) || 0) + 1); }
      else if (u.fadeAt !== null && u.fadeAt <= B.engagement) { B.log = savedLog; vanish(B, u, 'マスター不在'); B.log = null; }
    }
    B.log = savedLog;
    for (const [n, k] of vanished) log(B, `　${n}${k > 1 ? '×' + k : ''} 消滅（交戦フェイズ終了）`);
    if (B.hooks && B.hooks.afterEngagement) B.hooks.afterEngagement(B);
  }

  function createUnit(B, ch, team, pos, opts) {
    opts = opts || {};
    const u = {
      id: 'u' + (B.uidSeq++), name: ch.name, cls: ch.cls || '', team, pos: pos === 'back' ? 'back' : 'front', key: !!opts.key,
      tags: new Set([...(ch.tags || [])].map((x) => String(x).trim()).filter(Boolean)),
      base: {}, statDelta: {}, exMax: 0, exLeft: 0,
      maxHp: baseMaxHp(B.rules, ch), hp: 0, alive: true, died: false, vanished: false,
      res: {}, resMax: {}, insts: [], ai: ch.ai || { target: 'smart' }, actions: Math.max(1, Math.floor(+ch.actions || 1)), actionsLeft: 0,
      dmgDealt: 0, dmgTaken: 0, healed: 0, kills: 0, attacks: 0, supports: 0, skillUse: {},
      masterId: null, masterHpBonus: 0, fadeAt: null,
      summoned: !!opts.summoned, parentId: opts.parentId || null, life: opts.life || 'battle', summonKey: opts.summonKey || null,
    };
    for (const st of B.rules.stats) {
      const ri = rankInfo(B.rules, (ch.stats || {})[st.key]);
      u.base[st.key] = ri.value;
      if (ri.ex) u.exMax++;
    }
    u.exLeft = u.exMax;
    u.hp = u.maxHp;
    for (const r of ch.resources || []) { u.res[r.key] = +r.max; u.resMax[r.key] = +r.max; }
    const ex = (B.C && B.C.exclude) || {};
    for (let sk of ch.skills || []) {
      if (ex.np && sk.kind === 'np') continue;
      if (ex.summon && (sk.blocks || []).some((b) => (b.effects || []).some((e) => e.type === 'summon'))) {
        // 召喚を含むブロックごと外す（王の軍勢の陣地破壊なども召喚と一体なので一緒に外す）
        const blocks = sk.blocks.filter((b) => !(b.effects || []).some((e) => e.type === 'summon'));
        if (!blocks.length) continue;
        sk = Object.assign({}, sk, { blocks });
      }
      u.insts.push(newInst(sk, u, false));
    }
    u.v = makeUnitView(B, u);
    Object.defineProperty(u, '_B', { value: B, enumerable: false });
    return u;
  }

  function summonUnits(B, owner, eff, ctx) {
    const ch = B.C.charByName.get(eff.char);
    if (!ch) { B.warn.add('召喚対象のキャラクターが見つかりません: ' + eff.char); return; }
    let n = Math.round(+evalExpr(B, eff.value === undefined || eff.value === '' ? 1 : eff.value, 1, { self: owner, actor: ctx.actor, target: ctx.target, event: ctx.event }) || 0);
    const team = B.teams[owner.team];
    const cap = B.rules.maxUnitsPerTeam || 40;
    n = Math.max(0, Math.min(n, cap - team.units.filter((x) => x.alive).length));
    if (n <= 0) return;
    const group = eff.collapse || eff.territory ? { name: ch.name, total: n, ids: [], done: false, collapse: !!eff.collapse, territory: !!eff.territory } : null;
    if (group) (B.summonGroups = B.summonGroups || []).push(group);
    for (let i = 0; i < n; i++) {
      const u = createUnit(B, ch, owner.team, eff.pos || 'front', {
        summoned: true, parentId: eff.link ? owner.id : null, life: eff.life || 'battle', summonKey: owner.team + '|' + ch.name,
      });
      if (group) { group.ids.push(u.id); u.group = group; }
      team.units.push(u);
      fire(B, u, 'battleStart', { target: null });
      u.hp = u.maxHp;
      B.summonCount[u.summonKey] = (B.summonCount[u.summonKey] || 0) + 1;
    }
    log(B, `　${owner.name} が「${ch.name}」を${n > 1 ? n + '体' : ''}召喚`);
  }

  function applyInit(B, u, init) {
    if (!init) return;
    const mode = init.hpMode || 'full';
    if (mode === 'value' && init.hp !== '' && init.hp !== undefined) u.hp = clamp(Math.round(+init.hp), 1, u.maxHp);
    else if (mode === 'pct' && init.hp !== '' && init.hp !== undefined) u.hp = clamp(Math.round((u.maxHp * +init.hp) / 100), 1, u.maxHp);
    else if (mode === 'range') {
      const lo = +init.hpMin || 0, hi = init.hpMax === '' || init.hpMax === undefined ? 100 : +init.hpMax;
      const p = lo + (hi - lo) * B.rng();
      u.hp = clamp(Math.round((u.maxHp * p) / 100), 1, u.maxHp);
    }
    for (const k in init.res || {}) {
      const v = init.res[k];
      if (v === '' || v === null || v === undefined) continue;
      u.res[k] = clamp(Math.round(+v), 0, u.resMax[k] === undefined ? 99 : Math.max(u.resMax[k], +v));
    }
    for (const name of init.states || []) applyState(B, u, u, name);
    for (const skName of init.used || []) {
      const inst = u.insts.find((i) => !i.isState && i.def.name === skName);
      if (inst && inst.def.uses && +inst.def.uses.max > 0) inst.used.battle = +inst.def.uses.max;
    }
  }

  function buildBattle(C, rng, logOn) {
    const B = {
      C, rules: C.rules, rng, stateDefs: C.stateDefs, log: logOn ? [] : null, warn: new Set(),
      round: 0, totalRound: 0, engagement: 0, order: [], orderRank: {}, steals: {}, teams: [], uidSeq: 0, summonCount: {},
    };
    B.scope = makeScope(B);
    C.teams.forEach((t, ti) => {
      const team = { idx: ti, name: t.name, flags: new Set(t.flags), support: t.support, out: false, units: [], csOff: t.csMode === 'none', csAI: t.csAI || 'normal' };
      for (const m of t.members) { const u = createUnit(B, m.ch, ti, m.pos, { key: m.key }); u.init = m.init || null; u.ch = m.ch; team.units.push(u); }
      t.members.forEach((m, mi) => { if (m.master !== null && team.units[m.master]) team.units[mi].masterId = team.units[m.master].id; });
      team.baseCount = team.units.length;
      B.teams.push(team);
    });
    for (const t of B.teams) for (const u of t.units.slice()) fire(B, u, 'battleStart', { target: null });
    for (const t of B.teams) for (const u of t.units) u.hp = u.maxHp;
    // 令呪の初期画数：英雄点から計算した令呪コストを引く（マスターの「英雄点を得る」スキルは契約サーヴァントの予算に加算）
    const csMax = (B.rules.commandSpells && +B.rules.commandSpells.max) || 3;
    for (const t of B.teams) {
      if (t.csOff || !csOn(B)) continue;
      for (const u of t.units) {
        if (isMasterUnit(B, u)) {
          const svs = t.units.filter((x) => x.masterId === u.id && x.ch);
          let start = csMax + (u.ch ? (u.ch.skills || []).reduce((a, sk) => a + (+sk.csGain || 0), 0) : 0);
          for (const sv of svs) start -= csPlan(B.rules, sv.ch, u.ch).cost;
          u.res.cs = clamp(start, 0, csMax); u.resMax.cs = csMax;
        } else if (csEligible(B, u) && !u.masterId) {
          u.csVirtual = true; u.csPool = u.ch ? csPlan(B.rules, u.ch, null).start : csMax;
          if (u.init && u.init.cs !== undefined && u.init.cs !== '' && u.init.cs !== null) u.csPool = Math.max(0, Math.round(+u.init.cs));
        }
      }
    }
    // 消耗（開始時の状態）
    C.teams.forEach((t, ti) => t.members.forEach((m, mi) => applyInit(B, B.teams[ti].units[mi], m.init)));
    return B;
  }

  function runBattle(C, rng, logOn, hooks) {
    const B = buildBattle(C, rng, logOn);
    B.hooks = hooks || null;
    if (logOn) {
      for (const t of B.teams) log(B, `【${t.name}】` + t.units.map((u) => `${u.name}（HP${u.maxHp}・${u.pos === 'front' ? '前衛' : '後衛'}）`).join('、'));
    }
    while (aliveTeams(B).length > 1 && B.engagement < C.maxEngagements) runEngagement(B);
    const alive = aliveTeams(B);
    B.winner = alive.length === 1 ? alive[0].idx : -1;
    log(B, B.winner >= 0 ? `勝者：${B.teams[B.winner].name}` : (alive.length === 0 ? '相打ち（引き分け）' : 'ターン数の上限に到達（引き分け）'));
    return B;
  }

  // ------------------------------------------------------------------
  // 試行と集計
  // ------------------------------------------------------------------
  function runTrials(C, opts) {
    const trials = Math.max(1, Math.floor(+opts.trials || 1));
    const seed = opts.seed === undefined || opts.seed === '' ? 1 : opts.seed;
    const logTrials = Math.max(0, +opts.logTrials || 0);
    const start = opts.start || 0;
    const agg = {
      trials: 0, draws: 0,
      teams: C.teams.map((t) => ({ name: t.name, wins: 0 })),
      rounds: [], engagements: [],
      units: [], summons: {}, logs: [], warnings: new Set(C.warnings),
    };
    C.teams.forEach((t, ti) => t.members.forEach((m) => agg.units.push({
      name: m.ch.name, team: ti, deaths: 0, dmgDealt: 0, dmgTaken: 0, healed: 0, kills: 0, attacks: 0, supports: 0,
      hpEndSum: 0, hpEndAlive: 0, maxHpSum: 0, skillUse: {},
    })));
    const progressEvery = Math.max(1, Math.floor(trials / 50));
    for (let i = 0; i < trials; i++) {
      const rng = mulberry32(seedFor(seed, start + i));
      const B = runBattle(C, rng, i < logTrials);
      agg.trials++;
      if (B.winner >= 0) agg.teams[B.winner].wins++; else agg.draws++;
      agg.rounds.push(B.totalRound);
      agg.engagements.push(B.engagement);
      let k = 0;
      for (const t of B.teams) for (const u of t.units) {
        let a;
        if (u.summoned) {
          a = agg.summons[u.summonKey];
          if (!a) a = agg.summons[u.summonKey] = { name: u.name, team: u.team, summoned: true, count: 0, deaths: 0, dmgDealt: 0, dmgTaken: 0, healed: 0, kills: 0, attacks: 0, supports: 0, hpEndSum: 0, hpEndAlive: 0, maxHpSum: 0, skillUse: {} };
          a.count++;
        } else a = agg.units[k++];
        if (u.died) a.deaths++;
        a.dmgDealt += u.dmgDealt; a.dmgTaken += u.dmgTaken; a.healed += u.healed; a.kills += u.kills; a.attacks += u.attacks; a.supports += u.supports;
        a.maxHpSum += u.maxHp;
        if (u.alive) { a.hpEndSum += u.hp; a.hpEndAlive++; }
        for (const n in u.skillUse) a.skillUse[n] = (a.skillUse[n] || 0) + u.skillUse[n];
      }
      if (B.log) agg.logs.push(B.log);
      for (const w of B.warn) agg.warnings.add(w);
      if (opts.onProgress && (i + 1) % progressEvery === 0) opts.onProgress(i + 1, trials);
    }
    return agg;
  }

  function mergeAgg(list) {
    const out = JSON.parse(JSON.stringify({ ...list[0], warnings: [] }));
    out.warnings = new Set(list[0].warnings);
    out.rounds = list[0].rounds.slice(); out.engagements = list[0].engagements.slice();
    for (let i = 1; i < list.length; i++) {
      const a = list[i];
      out.trials += a.trials; out.draws += a.draws;
      for (const key in a.summons) {
        const sm = a.summons[key];
        if (!out.summons[key]) { out.summons[key] = JSON.parse(JSON.stringify(sm)); continue; }
        const o = out.summons[key];
        for (const f of ['count', 'deaths', 'dmgDealt', 'dmgTaken', 'healed', 'kills', 'attacks', 'supports', 'hpEndSum', 'hpEndAlive', 'maxHpSum']) o[f] += sm[f];
        for (const n in sm.skillUse) o.skillUse[n] = (o.skillUse[n] || 0) + sm.skillUse[n];
      }
      a.teams.forEach((t, k) => { out.teams[k].wins += t.wins; });
      for (const r of a.rounds) out.rounds.push(r);
      for (const r of a.engagements) out.engagements.push(r);
      a.units.forEach((u, k) => {
        const o = out.units[k];
        for (const f of ['deaths', 'dmgDealt', 'dmgTaken', 'healed', 'kills', 'attacks', 'supports', 'hpEndSum', 'hpEndAlive', 'maxHpSum']) o[f] += u[f];
        for (const n in u.skillUse) o.skillUse[n] = (o.skillUse[n] || 0) + u.skillUse[n];
      });
      out.logs = out.logs.concat(a.logs);
      for (const w of a.warnings) out.warnings.add(w);
    }
    return out;
  }

  function summarize(agg) {
    const n = agg.trials;
    const sorted = agg.rounds.slice().sort((a, b) => a - b);
    const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : 0;
    const hist = {};
    for (const r of agg.rounds) hist[r] = (hist[r] || 0) + 1;
    const z = 1.96;
    return {
      trials: n,
      draws: agg.draws,
      drawRate: agg.draws / n,
      teams: agg.teams.map((t) => {
        const p = t.wins / n;
        return { name: t.name, wins: t.wins, rate: p, ci: z * Math.sqrt((p * (1 - p)) / n) };
      }),
      rounds: { mean: mean(agg.rounds), median, min: sorted[0] || 0, max: sorted[sorted.length - 1] || 0, hist },
      engagements: { mean: mean(agg.engagements) },
      units: agg.units.concat(Object.values(agg.summons || {})).map((u) => ({
        name: u.name, team: u.team, summoned: !!u.summoned, countAvg: u.summoned ? u.count / n : 1,
        deathRate: u.summoned ? (u.count ? u.deaths / u.count : 0) : u.deaths / n,
        dmgDealt: u.dmgDealt / n, dmgTaken: u.dmgTaken / n, healed: u.healed / n, kills: u.kills / n,
        attacks: u.attacks / n, supports: u.supports / n,
        dmgPerAttack: u.attacks ? u.dmgDealt / u.attacks : 0,
        hpEndAvg: u.hpEndAlive ? u.hpEndSum / u.hpEndAlive : 0,
        maxHpAvg: u.summoned ? (u.count ? u.maxHpSum / u.count : 0) : u.maxHpSum / n,
        skillUse: Object.fromEntries(Object.entries(u.skillUse).map(([k, v]) => [k, v / n])),
      })),
      logs: agg.logs,
      warnings: [...agg.warnings],
    };
  }

  function simulate(data, opts) {
    const C = compileScenario(data);
    if (C.teams.length < 2) throw new Error('2つ以上の陣営にキャラクターを配置してください。');
    return summarize(runTrials(C, opts || {}));
  }

  const api = {
    TIMINGS, TIMING_LABEL, EFFECT_TYPES, TARGETS, FLAGS, AI_POLICIES, TARGET_POLICIES,
    rankInfo, heroPoints, csPlan, baseMaxHp, previewMaxHp, checkExpr,
    compileScenario, runTrials, mergeAgg, summarize, simulate, runBattle, mulberry32, seedFor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TRPGEngine = api;
})(typeof self !== 'undefined' ? self : this);
