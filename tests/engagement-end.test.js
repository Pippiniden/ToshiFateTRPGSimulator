/*
 * 交戦フェイズ終了処理の自動テスト（node tests/engagement-end.test.js）
 * 全テストケースと、サーヴァント同士の全1対1で戦闘を回し、交戦フェイズの境目ごとに次を確かめる。
 *  - 「交戦フェイズ終了まで」「N巡」の状態が残っていない
 *  - 「交戦フェイズ終了まで」の召喚体（王の軍勢・子機）が残っていない
 *  - 変容（ステータス振り直し）が元に戻っている
 *  - マスター喪失で消えるはずのサーヴァントが残っていない
 *  - 次の交戦フェイズ開始時に「交戦フェイズごと」の回数とEX振り直しが戻っている
 *  - ログ上、交戦フェイズ限りの状態（無限の剣製など）が、その交戦フェイズで付与される前や別の交戦フェイズで効いていない
 */
const path = require('path');
const E = require(path.join(__dirname, '../js/engine.js'));
const P = require(path.join(__dirname, '../js/presets.js'));

const engagementStates = new Set(P.states.filter((s) => ['engagement', 'rounds', undefined].includes(s.duration)).map((s) => s.name));
const failures = [];
let battles = 0, boundaries = 0;
const fail = (ctx, msg) => { if (failures.length < 40) failures.push(`${ctx}: ${msg}`); };

function hooks(ctx) {
  const orig = new Map();
  return {
    beforeEngagement(B) {
      for (const t of B.teams) for (const u of t.units) {
        if (!orig.has(u.id)) orig.set(u.id, Object.assign({}, u.base));
        if (B.engagement > 1) {
          for (const i of u.insts) if (i.used.engagement !== 0) fail(ctx, `${u.name}「${i.def.name}」の交戦フェイズごとの回数が戻っていない`);
          if (u.exLeft !== u.exMax) fail(ctx, `${u.name} のEX振り直しが戻っていない`);
        }
      }
    },
    afterEngagement(B) {
      boundaries++;
      for (const t of B.teams) for (const u of t.units) {
        for (const i of u.insts) if (i.isState && ['engagement', 'rounds'].includes(i.def.duration || 'engagement')) fail(ctx, `交戦フェイズ${B.engagement}終了後も ${u.name} に状態「${i.def.name}」が残っている`);
        if (u.alive && u.summoned && u.life === 'engagement') fail(ctx, `交戦フェイズ${B.engagement}終了後も召喚体 ${u.name} が残っている`);
        if (u.reshapeBase) fail(ctx, `${u.name} の変容が戻っていない`);
        const o = orig.get(u.id);
        if (o) for (const k in o) if (o[k] !== u.base[k]) fail(ctx, `${u.name} の${k}が元に戻っていない（${o[k]}→${u.base[k]}）`);
        if (u.alive && u.fadeAt !== null && u.fadeAt <= B.engagement) fail(ctx, `${u.name} はマスター喪失で消滅するはずが残っている`);
      }
    },
  };
}

function checkLog(ctx, log) {
  // 交戦フェイズ限りの状態が、その交戦フェイズで付与される前に効いていないか
  let applied = new Set();
  for (const line of log) {
    if (/^―― /.test(line)) { applied = new Set(); continue; }
    const a = line.match(/^\s*(.+?) に状態「(.+?)」/);
    if (a) { applied.add(a[1] + '|' + a[2]); continue; }
    const m = line.match(/^(?:\s*)(\S.*?) (?:→ .*?：.*?攻撃|防御) .*［(.+)］/);
    if (!m) continue;
    const who = m[1].trim();
    for (const tag of m[2].split('・')) {
      const name = tag.replace(/（.*）$/, '');
      if (engagementStates.has(name) && !applied.has(who + '|' + name)) fail(ctx, `「${name}」が付与されていない交戦フェイズで ${who} に効いている：${line.trim()}`);
    }
  }
}

function run(ctx, scenario, trials, seed) {
  const C = E.compileScenario({ rules: P.rules, characters: P.characters, states: P.states, scenario });
  for (let i = 0; i < trials; i++) {
    const B = E.runBattle(C, E.mulberry32(E.seedFor(seed, i)), true, hooks(ctx));
    checkLog(ctx, B.log);
    battles++;
  }
}

for (const sc of P.scenarios) run(sc.name, sc, 150, 7);
const servants = P.characters.filter((c) => !['乗騎', 'マスター', '召喚体'].includes(c.cls) && !(c.tags || []).includes('ボス'));
for (const a of servants) for (const b of servants) {
  if (a === b) continue;
  run(`${a.name} vs ${b.name}`, { teams: [{ name: 'A', members: [{ charId: a.id, pos: 'front' }] }, { name: 'B', members: [{ charId: b.id, pos: 'front' }] }], rounds: { mode: 'pl' }, maxEngagements: 10 }, 8, 3);
}

// メルトリリスが脱落したら、レベルドレインで下がった能力値は戻る
{
  const melt = P.characters.find((c) => c.name === 'メルトリリス');
  for (const b of servants) {
    if (b === melt) continue;
    const C = E.compileScenario({ rules: P.rules, characters: P.characters, states: P.states, scenario: { teams: [{ name: 'A', members: [{ charId: melt.id, pos: 'front' }] }, { name: 'B', members: [{ charId: b.id, pos: 'front' }] }], rounds: { mode: 'pl' }, maxEngagements: 10 } });
    for (let i = 0; i < 20; i++) {
      const B = E.runBattle(C, E.mulberry32(E.seedFor(9, i)), false);
      const m = B.teams[0].units[0];
      const v = B.teams[1].units[0];
      if (!m.alive && Object.values(v.statDelta).some((x) => x < 0)) fail(`メルトリリス vs ${b.name}`, 'メルトリリス脱落後もレベルドレインが残っている');
      battles++;
    }
  }
}
// 陣地破壊：アルトリアの宝具でメディアの陣地が消える
{
  const sc = P.scenarios.find((x) => x.name.startsWith('陣地あり'));
  const C = E.compileScenario({ rules: P.rules, characters: P.characters, states: P.states, scenario: sc });
  let broke = 0;
  for (let i = 0; i < 200; i++) {
    const B = E.runBattle(C, E.mulberry32(E.seedFor(5, i)), true);
    const used = B.log.some((l) => l.includes('約束された勝利の剣'));
    if (used && B.teams[0].flags.has('陣地')) fail('陣地破壊', '宝具を使ったのにメディア側の陣地が残っている');
    if (used) broke++;
    battles++;
  }
  if (!broke) fail('陣地破壊', '宝具が一度も使われていない（テストが機能していない）');
}

console.log(`戦闘 ${battles} 回、交戦フェイズの境目 ${boundaries} 回を検査`);
if (failures.length) { console.log('NG:\n  ' + failures.join('\n  ')); process.exit(1); }
console.log('OK：交戦フェイズ終了処理に問題なし');
