/*
 * 初期データ：提示ルールブック（聖杯戦争型TRPG）の交戦部分とキャラクターシート例
 * 完全再現ではなく、バランス試験に必要な交戦処理の近似。近似箇所は各スキルの「メモ」に記載。
 */
(function (root) {
  'use strict';
  let seq = 0;
  const id = (p) => p + '_' + (++seq).toString(36);

  const P = 'physical', M = 'magic', S = 'surprise';
  const ALL = [P, M, S];

  // ---- 効果 ----
  const mod = (v, upTo) => ({ type: 'mod', value: String(v), upTo: !!upTo });
  const faces = (v) => ({ type: 'faces', value: String(v) });
  const fx = (type, extra) => Object.assign({ type }, extra || {});
  // ---- ブロック ----
  const blk = (timings, effects, opt) => ({
    timings: [].concat(timings), types: (opt && opt.types) || [],
    cond: { mode: (opt && opt.mode) || 'all', rows: ((opt && opt.cond) || []).map((e) => ({ expr: e, not: false })) },
    effects,
  });
  // ---- スキル ----
  const sk = (name, rank, kind, cost, blocks, opt) => ({
    id: id('sk'), name, rank: rank || '', kind, cost: cost || 0, blocks,
    uses: (opt && opt.uses) || null,
    resource: (opt && opt.res) || null,
    csUse: (opt && opt.csUse) || 0,
    heroBonus: (opt && opt.heroBonus) || 0,
    csLoss: (opt && opt.csLoss) || 0,
    csGain: (opt && opt.csGain) || 0,
    ai: (opt && opt.ai) || { policy: 'asap', threshold: 50 },
    note: (opt && opt.note) || '',
  });
  const once = (per, max) => ({ max: max || 1, per });
  const np = (key, amount) => ({ key: key || 'np', amount: amount || 1 });

  // よく使うスキル
  const taimaryoku = (rank) => sk('対魔力', rank, 'class', 5, [blk('defend', [mod(5)], { types: [M] })], { heroBonus: 5, note: 'キャラシート作成時、英雄点5を得る（令呪コストの予算に加算）。' });
  const charisma = (rank, kind) => sk('カリスマ', rank, kind || 'skill', 5, [blk('defend', [mod(5)], { types: [S] }), blk('allyAttacked', [fx('redirect')])]);
  const tandoku = (rank, name) => sk(name || '単独行動', rank, 'class', 5, [blk('initiative', [mod(5)])].concat(name ? [] : [blk('static', [fx('flag', { name: 'independent' })])]), { uses: once('battle'), note: '遠距離攻撃フェイズは交戦シミュレーション対象外。先手判定+5（セッション1回）と、マスター喪失後の延命を再現。' });
  const kehai = (rank) => sk('気配遮断', rank, 'class', 10, [blk('static', [fx('flag', { name: 'surprise' })]), blk('initiative', [mod(5)])]);
  const endure = (name, rank) => sk(name || '戦闘続行', rank, 'skill', 5, [blk('lethal', [fx('endure')])], { uses: once('battle') });
  const hpUp = (v) => blk('battleStart', [fx('maxHp', { value: String(v), to: 'self' })]);
  const jinchi = (rank) => sk('陣地作成', rank, 'class', 10, [
    blk('attack', [mod(5)], { types: [M], cond: ["teamFlag('陣地')"] }),
    blk('defend', [mod(5)], { types: ALL, cond: ["teamFlag('陣地')"] }),
  ], { note: '陣営フラグ「陣地」がある場合のみ有効（テストケースの陣営設定で付与）。遠距離ダメージ無効は対象外。' });
  const ryouikigai = () => sk('領域外の生命', 'EX', 'class', 5, [
    blk('static', [fx('flag', { name: 'surprise' })]),
    blk('attack', [fx('negateOpp', { names: '', kinds: 'class' })]),
  ], { uses: once('engagement'), note: '「クラス固有スキルの補正値1つを無効」を、交戦ごと1回・相手のクラススキル補正すべて無効として近似。' });

  const resNp = (n) => [{ key: 'np', name: '宝具', max: n === undefined ? 1 : n }];
  const ch = (name, cls, ranks, tags, skills, opt) => {
    const [STR, END, AGI, MAG, LUK] = ranks;
    return {
      id: id('ch'), name, cls, tags, stats: { STR, END, AGI, MAG, LUK },
      hpExtra: (opt && opt.hpExtra) || 0,
      actions: (opt && opt.actions) || 1,
      resources: (opt && opt.resources) || resNp(1),
      skills, ai: (opt && opt.ai) || { target: 'smart', tag: '' },
      note: (opt && opt.note) || '',
    };
  };

  // ------------------------------------------------------------------
  // ルール
  // ------------------------------------------------------------------
  const rules = {
    name: '聖杯戦争型TRPG（交戦フェイズ）',
    stats: [
      { key: 'STR', name: '筋力' }, { key: 'END', name: '耐久' }, { key: 'AGI', name: '敏捷' },
      { key: 'MAG', name: '魔力' }, { key: 'LUK', name: '幸運' },
    ],
    ranks: [
      { rank: 'E', value: 1, cost: 1 }, { rank: 'D', value: 2, cost: 2 }, { rank: 'C', value: 3, cost: 3 },
      { rank: 'B', value: 4, cost: 4 }, { rank: 'A', value: 5, cost: 5 },
      { rank: 'E+', value: 2, cost: 2 }, { rank: 'D+', value: 3, cost: 3 }, { rank: 'C+', value: 4, cost: 4 },
      { rank: 'B+', value: 5, cost: 5 }, { rank: 'A+', value: 6, cost: 7 }, { rank: 'A++', value: 7, cost: 8 },
      { rank: 'EX', value: 8, cost: 10, ex: true },
    ],
    statMin: 1, statMax: 10,
    hpFormula: 'END*5', hpStat: 'END', hpPerStat: 5,
    dice: { faces: 6, min: 2, max: 10 },
    penalty: { enabled: true, threshold: 10, step: 10, negThreshold: 5 },
    initiativeStat: 'AGI',
    attackTypes: [
      { key: P, name: '物理', atkStat: 'STR', defStat: 'STR', requiresFlag: '' },
      { key: M, name: '魔術', atkStat: 'MAG', defStat: 'MAG', requiresFlag: '' },
      { key: S, name: '奇襲', atkStat: 'LUK', defStat: 'LUK', requiresFlag: 'surprise' },
    ],
    masterTag: 'マスター', masterHalf: true, masterLoss: true,
    commandSpells: { enabled: true, max: 3 },
    heroBudget: { base: 30, perCs: 5 },
    exRerolls: true,
  };

  // ------------------------------------------------------------------
  // 状態
  // ------------------------------------------------------------------
  const st = (name, debuff, duration, charges, blocks, note, durationValue) => ({ id: id('st'), name, debuff, duration, durationValue: durationValue || 1, charges: charges || 0, blocks, note: note || '' });
  const states = [
    st('呪い', true, 'engagement', 0, [blk('static', ['STR', 'END', 'AGI', 'MAG', 'LUK'].map((k) => fx('stat', { stat: k, value: '-1' })))], '全ステータス1ランクダウン（下限1）。最大HP・現在HPは変化しない。'),
    st('正気喪失', true, 'engagement', 1, [blk(['initiative', 'attack', 'defend'], [mod(-3)])], '次の判定に-3。'),
    st('強化無効', true, 'engagement', 1, [blk(['initiative', 'attack', 'defend'], [fx('suppressSelf', { kinds: 'skill' })])], 'クラススキル・宝具以外のスキル補正を1回無効。'),
    st('次撃強化+5', false, 'engagement', 1, [blk('attack', [mod(5, true)], { types: [P, M] })], '次の物理・魔術攻撃に5までの補正値。'),
    Object.assign(st('無限の剣製', false, 'engagement', 0, [blk('attack', [mod(5, true)], { types: [P, M] })], '固有結界（陣地）内。交戦フェイズ終了まで物理・魔術攻撃に5までの補正値。陣地破壊で消滅。'), { territory: true }),
    st('行動不能', false, 'rounds', 0, [blk('static', [fx('flag', { name: 'cannotAct' })])], '次の1巡が終わるまで（自分の次の手番が終わるまで）行動できない。', 1),
    st('攻撃不能', true, 'rounds', 0, [blk('static', [fx('flag', { name: 'cannotAct' })])], '1巡の間、行動できない（ILLUSION）。', 1),
    st('ジェスター・サーカス', true, 'rounds', 2, [blk(['initiative', 'attack', 'defend'], [mod(-3)])], '1巡の間、2回まで全ての判定に-3。', 1),
    st('トールハンマー', false, 'rounds', 2, [blk(['attack', 'defend'], [mod(5, true)])], '1巡の間、2回まで先手判定以外の判定に5までの補正値。', 1),
    Object.assign(st('パンドラボックス', false, 'engagement', 0, [blk('defend', [mod(3)], { types: [P, M] })], '陣地内：物理・魔術防御+3（交戦フェイズ終了時、または陣地破壊で消滅）。'), { territory: true }),
    st('主の御業（デバフ無効）', false, 'engagement', 0, [blk('static', [fx('flag', { name: 'debuffImmune' })])], 'ジャンヌの宝具。この交戦フェイズ中、デバフを受けない。'),
    st('スクトゥム・アイアス', false, 'engagement', 1, [blk('defend', [mod(5, true)], { types: [P, M] })], 'かばった攻撃の防御に5までの補正値。'),
    st('魅了', true, 'rounds', 0, [blk('static', [fx('flag', { name: 'cannotAct' })])], '1巡の間、行動できない。', 1),
    st('防御低下', true, 'engagement', 0, [blk('defend', [mod(-2)])], '交戦フェイズ終了まで防御判定に-2。'),
    st('十二の試練（物理）', false, 'engagement', 0, [blk('defend', [mod(5, true)], { types: [P] })], '一度殺された物理攻撃への防御に5までの補正値（交戦終了まで）。'),
    st('十二の試練（魔術）', false, 'engagement', 0, [blk('defend', [mod(5, true)], { types: [M] })], '一度殺された魔術攻撃への防御に5までの補正値（交戦終了まで）。'),
    st('十二の試練（奇襲）', false, 'engagement', 0, [blk('defend', [mod(5, true)], { types: [S] })], '一度殺された奇襲攻撃への防御に5までの補正値（交戦終了まで）。'),
    st('民を護る楔', false, 'engagement', 1, [blk('defend', [mod(5, true)], { types: ALL })], 'かばった攻撃の防御に5までの補正値。'),
    st('人理焼却', true, 'engagement', 0, [blk(['attack', 'defend'], [mod(-2)])], '光帯の熱で霊基が揺らぐ。交戦フェイズ終了まで攻撃・防御に-2。'),
  ];

  // ------------------------------------------------------------------
  // キャラクター
  // ------------------------------------------------------------------
  const C = [];

  C.push(ch('アルトリア・ペンドラゴン', 'セイバー', ['A', 'A', 'B', 'A', 'A+'], ['秩序・善', '地属性', '竜種'], [
    taimaryoku('A'),
    sk('直感', 'A', 'skill', 4, [hpUp(15), blk('defend', [mod(3)], { types: [P] })]),
    charisma('B'),
    sk('約束された勝利の剣', 'A++', 'np', 0, [blk('attack', [mod(10, true), fx('territoryBreak')], { types: [P, M] })], { res: np(), note: '陣地破壊が発生する。' }),
  ]));

  C.push(ch('アルトリア〔オルタ〕', 'セイバー', ['A', 'A', 'D', 'A++', 'C'], ['秩序・悪', '人属性', '竜種'], [
    taimaryoku('B'),
    sk('魔力放出', 'A', 'skill', 3, [blk('attack', [mod(5)], { types: [M] })]),
    sk('直感', 'B', 'skill', 4, [hpUp(10), blk('attack', [mod(4)], { types: [M] })]),
    sk('約束された勝利の剣（モルガン）', 'A++', 'np', 0, [
      blk('attack', [fx('aoe'), mod(5, true), fx('territoryBreak')], { types: [M] }),
      blk('attack', [mod(3, true)], { types: [M], cond: ['target.hp > self.hp'] }),
    ], { res: np(), note: '陣地破壊が発生する。' }),
  ]));

  C.push(ch('エミヤ', 'アーチャー', ['D', 'B', 'B', 'B', 'E'], ['中立・中庸', '人属性'], [
    tandoku('D'),
    sk('投影魔術', 'A', 'skill', 5, [hpUp(15), blk('attack', [mod(4)], { types: [M] })]),
    sk('心眼(真)', 'B', 'skill', 5, [blk('defend', [mod(2)], { types: [P, M] }), blk('initiative', [mod(3)])]),
    sk('無限の剣製', 'E～A++', 'np', 0, [blk('turnStart', [fx('territoryBreak'), fx('applyState', { state: '無限の剣製', to: 'self' })], { cond: ["!hasState(self,'無限の剣製')"] })], { res: np(), note: '自分の手番開始時に固有結界（陣地）を展開。発動時に陣地破壊が発生。陣地内では自分の物理・魔術攻撃に5までの補正値。交戦フェイズ終了時、または相手の陣地破壊で消滅。' }),
  ]));

  C.push(ch('アタランテ', 'アーチャー', ['D', 'E', 'A', 'B', 'C'], ['中立・悪', '地属性'], [
    tandoku('A'),
    sk('アルカディア超え', 'B', 'skill', 5, [blk('initiative', [mod(3)]), blk('attack', [mod(4)], { types: [P] })]),
    sk('追い込みの美学', 'C', 'skill', 5, [blk('attack', [mod(5)], { types: [P, M], cond: ['hasInitiative()'] })]),
    sk('訴状の矢文', 'B', 'np', 0, [blk('attack', [fx('aoe'), mod(5, true), fx('applyState', { state: '次撃強化+5', to: 'self' })], { types: [P, M] })], { res: np() }),
  ]));

  C.push(ch('クー・フーリン', 'ランサー', ['B', 'A', 'A+', 'C', 'E'], ['秩序・中庸', '天属性', '神性'], [
    sk('仕切り直し', 'C', 'class', 5, [blk('initiative', [mod(5)])], { uses: once('round'), note: '逃走判定は対象外。' }),
    taimaryoku('C'),
    sk('矢避けの加護', 'B', 'skill', 5, [blk('defend', [mod(5)], { types: [S] })], { note: '遠距離攻撃無効は対象外。' }),
    sk('刺し穿つ死棘の槍', 'B', 'np', 0, [blk('attack', [mod('target.END*2', true), fx('defStat', { stat: 'LUK' })], { types: [P] })], { res: np() }),
  ]));

  C.push(ch('エリザベート＝バートリー', 'ランサー', ['C', 'D', 'E', 'A', 'B'], ['混沌・悪', '人属性', '竜種'], [
    sk('仕切り直し', '', 'class', 5, [blk('turnStart', [fx('heal', { value: 'd(self.END,6)', to: 'self' }), fx('clearDebuffs', { to: 'self' })])], { uses: once('engagement'), ai: { policy: 'hpBelow', threshold: 60 } }),
    endure('戦闘続行', 'B'),
    charisma('C'),
    sk('鮮血魔嬢', 'E-', 'np', 0, [blk('attack', [fx('aoe'), mod(5, true), fx('applyState', { state: '呪い', to: 'target', if: 'event.damage > 0' })], { types: [M] })], { res: np(), note: '味方の援護・令呪の使用不可は対象外。' }),
  ]));

  C.push(ch('メドゥーサ', 'ライダー', ['B', 'D', 'A', 'B', 'E'], ['混沌・善', '地属性'], [
    sk('騎乗', 'A+', 'class', 10, [blk('turnStart', [fx('summon', { char: 'ペガサス', value: '1', pos: 'front', life: 'battle', link: true })])], { uses: once('battle'), note: '「任意のタイミング」で召喚できるため、AIは自陣営の最初の手番開始時に召喚する（先手を取られても出した直後に攻撃できる）。1戦闘1回。' }),
    sk('怪力', 'B', 'skill', 5, [hpUp(15), blk('attack', [mod(4)], { types: [P] })]),
    sk('魔眼', 'A+', 'skill', 4, [blk('initiative', [mod(3)]), blk('defend', [mod(3)], { types: [P] })]),
    sk('騎英の手綱', 'A+', 'np', 0, [blk('allyAttack', [mod(10, true)], { types: [P], cond: ["has(actor,'ペガサス')"] })], { res: np(), note: '同じ陣営のペガサスの物理攻撃時に補正値を与える。' }),
  ]));

  C.push(ch('ペガサス', '乗騎', ['EX', 'E', 'A', 'C', 'E'], ['乗騎', '幻想種', 'ペガサス'], [], { resources: [] }));

  C.push(ch('イスカンダル', 'ライダー', ['B', 'A', 'E', 'C', 'A+'], ['中立・善', '人属性', '神性'], [
    sk('騎乗', 'A+', 'class', 10, [blk('turnStart', [fx('summon', { char: '神威の車輪', value: '1', pos: 'front', life: 'battle', link: true })])], { uses: once('battle'), note: '自陣営の最初の手番開始時に乗騎「神威の車輪」を召喚（1戦闘1回）。' }),
    sk('神性', 'C', 'skill', 5, [], { heroBonus: 10, note: 'キャラシート作成時、サーヴァントの英雄点10を得る（令呪コストの予算に加算）。' }),
    sk('カリスマ', 'A', 'skill', 5, [blk('allyAttacked', [fx('redirect', { dest: '自分, 神威の車輪, 王の軍勢' })])], { note: '相手の攻撃時、攻撃対象を自分か「神威の車輪」「王の軍勢」に変更できる（奇襲防御の補正値は無し）。AIは失うものの重さで判断し、王の軍勢は半数割れで崩れない範囲で盾にする。' }),
    sk('王の軍勢', 'EX', 'np', 0, [blk('turnStart', [fx('territoryBreak'), fx('summon', { char: '王の軍勢', value: 'd(3,6)', pos: 'front', life: 'engagement', link: true, collapse: true, territory: true })])], { res: np(), note: '自分の手番開始時に固有結界を展開し、乗騎「王の軍勢」を3D6体召喚。発動時に陣地破壊が発生。陣地（と軍勢）は交戦フェイズ終了時、軍勢の総数が半分以下になった時、イスカンダルが倒れた時、相手の陣地破壊で消滅。' }),
  ]));
  C.push(ch('神威の車輪', '乗騎', ['EX', 'A', 'C', 'E', 'E'], ['乗騎'], [], { resources: [] }));
  C.push(ch('王の軍勢', '乗騎', ['E', 'E', 'E', 'E', 'E'], ['乗騎'], [], { resources: [] }));

  C.push(ch('メディア', 'キャスター', ['E', 'D', 'C', 'A+', 'B'], ['中立・悪', '地属性'], [
    jinchi('A'),
    sk('高速神言', 'A', 'skill', 5, [blk('attack', [mod(5), fx('negateOpp', { names: '対魔力', kinds: '' })], { types: [M] })]),
    sk('キルケーの教え', 'A', 'skill', 3, [], { note: '逃走判定のみのため効果なし。' }),
    sk('破戒すべき全ての符', 'C', 'np', 0, [], { res: np(), note: '令呪の奪取は交戦シミュレーション対象外。' }),
    sk('神官魔術式・灰の花嫁', 'A', 'np', 0, [blk('attack', [fx('aoe'), mod(5, true)], { types: [M] })], { res: np('np2'), csLoss: 1, note: 'キャラシート作成時、令呪1画消費する。' }),
  ], { resources: [{ key: 'np', name: '宝具1', max: 1 }, { key: 'np2', name: '宝具2', max: 1 }] }));

  C.push(ch('玉藻の前', 'キャスター', ['E', 'E', 'B', 'A+', 'D'], ['中立・悪', '天属性', '神性'], [
    jinchi('C'),
    sk('ダキニ天法', '', 'skill', 5, [blk('attack', [mod(5), fx('negateOpp', { names: '対魔力', kinds: '' })], { types: [M] })]),
    sk('変化', 'A', 'skill', 5, [blk(['initiative', 'attack', 'defend'], [mod(3)])], { uses: once('engagement', 2) }),
    sk('水天日光天照八野鎮石', 'D', 'np', 0, [blk('action', [fx('heal', { value: 'd(5,6)', to: 'allies' }), fx('resource', { key: 'np', value: '1', to: 'alliesOther' })])], { res: np(), ai: { policy: 'hpBelow', threshold: 50 } }),
  ]));

  C.push(ch('佐々木小次郎', 'アサシン', ['C', 'E', 'A+', 'E', 'A'], ['中立・悪', '人属性'], [
    kehai('D'),
    sk('心眼(偽)', 'A', 'skill', 3, [blk('initiative', [mod(3)]), blk('defend', [mod(2)], { types: [P] })]),
    sk('宗和の心得', 'B', 'skill', 5, [blk('attack', [mod(3), fx('negateOpp', { names: '', kinds: 'skill,class' })], { types: [S] })]),
    sk('燕返し', '-', 'np', 0, [blk('attack', [mod(10, true), fx('reroll', { value: '3' })], { types: [S] })], { res: np() }),
  ]));

  C.push(ch('呪腕のハサン', 'アサシン', ['B', 'C', 'A', 'C', 'E'], ['秩序・悪', '人属性'], [
    kehai('A+'),
    sk('自己改造', 'C', 'skill', 4, [blk('attack', [mod(3)], { types: [P, S] })]),
    sk('投擲(短刀)', 'B', 'skill', 5, [], { note: '遠距離攻撃フェイズ専用のため効果なし。' }),
    sk('妄想心音', 'C', 'np', 0, [blk('attack', [mod(10, true), fx('defStat', { stat: 'min:MAG,LUK' })], { types: [P, S] })], { res: np() }),
  ]));

  C.push(ch('スパルタクス', 'バーサーカー', ['A', 'EX', 'D', 'E', 'D'], ['中立・中庸', '人属性'], [
    sk('狂化', 'EX', 'class', 10, [blk('attack', [mod(5)], { types: [P, M] }), blk('defend', [mod(5)], { types: [P, M] })], { csLoss: 1, note: 'キャラシート作成時、令呪を1つ失う。' }),
    sk('被虐の誉れ', 'B', 'skill', 5, [hpUp(15), blk('movePhase', [fx('heal', { value: 'd(self.END,6)', to: 'self' })])]),
    endure('不屈の意志', 'A'),
    sk('疵獣の咆吼', 'A', 'np', 0, [blk('attack', [fx('aoe'), mod('floor(self.damageTaken/5)'), fx('heal', { value: 'd(self.END,6)', to: 'self' })], { types: [P] })], { res: np(), ai: { policy: 'finisher', threshold: 60 } }),
  ]));

  C.push(ch('呂布奉先', 'バーサーカー', ['A+', 'A+', 'B+', 'C+', 'C+'], ['混沌・悪', '男性', '人属性'], [
    sk('狂化', 'A', 'class', 10, [blk('attack', [mod(5)], { types: [P] }), blk('defend', [mod(3)], { types: [P, M] })]),
    sk('乱世の梟雄', 'A', 'skill', 3, [hpUp(10), blk('defend', [mod(3)], { types: [S] })]),
    sk('勇猛', 'B', 'skill', 5, [blk('attack', [faces(1), fx('noNegFaces')], { types: [P] })]),
    sk('軍神五兵（1）対人', 'A', 'np', 0, [blk('attack', [mod(10, true)], { types: [P] })], { res: np() }),
    sk('軍神五兵（2）対軍', 'A', 'np', 0, [blk('attack', [fx('aoe'), mod(5, true)], { types: [P] })], { res: np(), ai: { policy: 'never', threshold: 50 }, note: '3つの効果は宝具回数を共有。AIは上から順に使用判定する。' }),
    sk('軍神五兵（3）対城', 'A', 'np', 0, [blk('attack', [mod(5, true), fx('negateOpp', { names: '', kinds: 'skill' }), fx('territoryBreak')], { types: [P] })], { res: np(), ai: { policy: 'never', threshold: 50 } }),
  ]));

  C.push(ch('ジャンヌ・ダルク', 'ルーラー', ['B', 'B', 'A', 'A', 'C'], ['秩序・善', '星属性', '聖人'], [
    sk('神明裁決', 'A', 'class', 5, [], { note: '令呪効果は対象外。' }),
    taimaryoku('EX'),
    sk('啓示', 'A', 'skill', 4, [hpUp(15), blk('initiative', [mod(3)])]),
    sk('我が神はここにありて', 'A', 'np', 0, [blk('allyDefend', [mod(5, true), fx('heal', { value: 'd(5,6)', to: 'alliesFront' }), fx('clearDebuffs', { to: 'allies' }), fx('applyState', { state: '主の御業（デバフ無効）', to: 'allies' }), fx('applyState', { state: '行動不能', to: 'self' })], { types: ALL })], { res: np(), ai: { policy: 'finisher', threshold: 40 }, note: '味方の防御に5までの補正値、ダメージ後に味方前衛を5D6回復、この交戦フェイズ中は味方陣営へのデバフを無効（掛かっているデバフも解除）。自分は次の1巡行動不能（これは無効化されない）。防御側の被害が大きい時に使用。' }),
  ]));

  C.push(ch('天草四郎時貞', 'ルーラー', ['B', 'C', 'B', 'A', 'B'], ['秩序・善', '人属性'], [
    sk('真名看破', 'B', 'class', 10, [], { note: '交戦シミュレーション対象外。' }),
    taimaryoku('A'),
    sk('洗礼詠唱', 'B+', 'skill', 5, [blk('attack', [mod(5)], { types: [P, M], mode: 'any', cond: ["has(target,'魔性')", "has(target,'亡霊')"] })]),
    sk('左腕・天恵基盤＆右腕・悪逆捕食', 'D', 'np', 0, [], { res: np(), note: '未対応（効果のコピー）。' }),
    sk('双腕・零次集束', 'A+', 'np', 0, [blk('attack', [fx('aoe')], { types: [P, M] })], { res: np('np2'), csLoss: 1, note: 'キャラシート作成時、令呪1画失う。' }),
  ], { resources: [{ key: 'np', name: '宝具1', max: 1 }, { key: 'np2', name: '宝具2', max: 1 }] }));

  C.push(ch('アンリマユ', 'アヴェンジャー', ['E', 'A', 'A', 'D', 'D'], ['混沌・悪', '地属性'], [
    sk('復讐者', 'A', 'class', 5, [], { note: '宝具の使用回数無制限（宝具に回数を設定しないことで再現）。' }),
    sk('四夜の終末', 'EX', 'skill', 5, [hpUp(15), blk('movePhase', [fx('heal', { value: 'd(5,6)', to: 'self' })])]),
    sk('死滅願望', 'A', 'skill', 5, [blk(['initiative', 'attack', 'defend'], [mod('round')]), blk('roundEnd', [fx('kill')], { cond: ['round >= 4'] })]),
    sk('偽り写し記す万象', 'E', 'np', 0, [blk('tookDamage', [fx('damage', { value: 'event.damage', to: 'target', floor: '1' })], { cond: ['self.hp >= 1'] })]),
  ], { resources: [] }));

  C.push(ch('ジャンヌ・ダルク〔オルタ〕', 'アヴェンジャー', ['A', 'C', 'A', 'A+', 'E'], ['混沌・悪', '人属性'], [
    sk('忘却補正', 'A', 'class', 5, [blk('static', [fx('stat', { stat: 'ALL', value: '2' })], { cond: ["!teamFlag('同盟')"] })], { note: '陣営フラグ「同盟」がない場合、全ステータス+2。' }),
    sk('自己改造', 'EX', 'skill', 3, [hpUp(15), blk('defend', [mod(2)], { types: [P] })]),
    sk('竜の魔女', 'EX', 'skill', 5, [blk('allyAttack', [mod("2 + (has(actor,'竜種') ? 3 : 0)")], { types: [P, M] })], { uses: once('round') }),
    sk('吼え立てよ、我が憤怒', 'A+', 'np', 0, [blk('allyAttacked', [fx('redirect'), fx('applyState', { state: '強化無効', to: 'target', if: 'event.damage > 0' }), fx('applyState', { state: '次撃強化+5', to: 'self', if: 'event.damage > 0' })])], { res: np(), note: '味方脱落時の面数+1は未対応。' }),
  ]));

  C.push(ch('マシュ・キリエライト', 'シールダー', ['C', 'A', 'D', 'B', 'C'], ['秩序・善', '人属性', 'デミ・サーヴァント'], [
    sk('自陣防御', 'C', 'class', 5, [hpUp(15), blk('allyAttacked', [fx('redirect')])], { uses: once('round') }),
    sk('憑依継承／魔力防御', 'A', 'skill', 3, [hpUp(10), blk('defend', [mod(3)], { types: [P] })]),
    endure('戦闘続行', 'C'),
    sk('いまは遙か理想の城', 'B+++', 'np', 0, [blk('allyDefend', [mod(5, true), fx('applyState', { state: '次撃強化+5', to: 'alliesOther' })], { types: ALL })], { res: np(), ai: { policy: 'finisher', threshold: 40 } }),
  ]));

  C.push(ch('メルトリリス', 'アルターエゴ', ['E', 'C', 'A+', 'A', 'B'], ['秩序・善', '地属性', '神性', '魔性'], [
    sk('メルトウイルス', 'EX', 'class', 5, [blk('dealtDamage', [fx('statSteal', { value: '3' })])]),
    tandoku('B', '騎乗'),
    sk('女神の神核', 'B', 'skill', 5, [blk('static', [fx('flag', { name: 'debuffImmune' })])]),
    sk('弁財天五弦琵琶', 'EX', 'np', 0, [blk('attack', [fx('aoe'), mod(5, true)], { types: [M] })], { res: np(), note: '効果のコピーは未対応。' }),
  ]));

  C.push(ch('パッションリップ', 'アルターエゴ', ['A+', 'A', 'C', 'B', 'E'], ['秩序・中庸', '複合神性'], [
    sk('トラッシュ＆クラッシュ', 'EX', 'class', 5, [blk('attack', [fx('reroll', { value: '1' })], { types: [P] })], { note: '近似：物理攻撃で1回振り直して高い方を採用。' }),
    charisma('A'),
    sk('気配遮断（爪と胸でバレバレ）', 'A+', 'skill', 5, [blk('initiative', [mod(5)])], { uses: once('engagement') }),
    sk('死がふたりを分断つまで', 'C', 'np', 0, [blk('attack', [mod(10, true), fx('noRedirect')], { types: [P] })], { res: np() }),
  ]));
  C[C.length - 1].skills[1].name = '被虐体質';

  C.push(ch('アビゲイル・ウィリアムズ', 'フォーリナー', ['B', 'A', 'C', 'B+', 'C'], ['混沌・悪', '地属性', '神性'], [
    ryouikigai(),
    sk('信仰の祈り', 'C', 'skill', 5, [blk('engagementEnd', [fx('resource', { key: 'np', value: '1', to: 'self' })], { cond: ['self.res.np < 1'] })], { uses: once('battle') }),
    sk('魔女裁判', 'A+', 'skill', 5, [blk('attack', [mod(5), fx('negateOpp', { names: '対魔力', kinds: '' })], { types: [M] })]),
    sk('光殻湛えし虚樹', 'EX', 'np', 0, [blk('attack', [mod(10, true), fx('applyState', { state: '正気喪失', to: 'target', if: 'event.damage > 0' })], { types: [M] })], { res: np() }),
  ]));

  C.push(ch('葛飾北斎', 'フォーリナー', ['D', 'D', 'B', 'B', 'A'], ['混沌・中庸', '人属性', '神性'], [
    ryouikigai(),
    sk('父娘の絆', 'A', 'skill', 5, [blk('attack', [faces(1), fx('noNegFaces')], { types: [S] })]),
    sk('雅号・異星蛸', 'B', 'skill', 3, [hpUp(10), blk('initiative', [mod(3)])]),
    sk('富嶽三十六景', 'A', 'np', 0, [
      blk('attack', [fx('aoe'), mod(5, true)], { types: [S] }),
      blk('attack', [mod(3, true)], { types: [S], cond: ["has(target,'人属性')"] }),
    ], { res: np() }),
  ]));

  C.push(ch('ギルガメッシュ', 'アーチャー', ['B', 'B', 'B', 'A', 'A'], ['混沌・善', '天属性', '神性'], [
    tandoku('A+'),
    sk('バビロンの蔵', 'EX', 'skill', 3, [hpUp(15), blk('attack', [mod(2)], { types: [P] })]),
    sk('神性', 'B', 'skill', 5, [], { heroBonus: 10, note: 'キャラシート作成時、サーヴァントの英雄点10を得る（令呪コストの予算に加算）。' }),
    sk('王の財宝', 'E～A++', 'np', 5, [blk(['attack', 'defend'], [mod(5, true)])], { res: np(), ai: { policy: 'finisher', threshold: 60 }, note: '任意の判定に5までの補正値（英雄点5点）。宝具2と同じ判定には使えない。AIは決定打・致命傷の防御で使う。' }),
    sk('天地乖離す開闢の剣', 'EX', 'np', 0, [blk('attack', [fx('aoe'), mod(10, true), fx('territoryBreak')], { types: [P] })], { res: np('np2'), csUse: 1, note: 'エヌマ・エリシュ。令呪を1画消費して発動。陣地破壊が発生。相手の前衛全てに物理攻撃、10までの補正値。' }),
  ], { resources: [{ key: 'np', name: '宝具1', max: 1 }, { key: 'np2', name: '宝具2', max: 1 }] }));

  C.push(ch('エルキドゥ', 'ランサー', ['A', 'EX', 'A', 'A', 'A'], ['中立・中庸', '天属性'], [
    sk('完全なる形', 'A', 'class', 5, [blk('turnStart', [fx('heal', { value: 'd(self.END,6)', to: 'self' }), fx('clearDebuffs', { to: 'self' })])], { uses: once('engagement'), ai: { policy: 'hpBelow', threshold: 60 } }),
    taimaryoku('A'),
    sk('変容', 'A', 'skill', 5, [blk('engagementStart', [fx('reshape', { profiles: 'STR:A, END:EX, AGI:A, MAG:A, LUK:A | STR:EX, END:A, AGI:A, MAG:A, LUK:A | STR:A, END:A, AGI:A, MAG:EX, LUK:A | STR:A, END:A, AGI:EX, MAG:A, LUK:A | STR:A+, END:A+, AGI:B, MAG:A+, LUK:B' })])], { note: '交戦開始時にステータスの英雄点（30点）を振り直す。候補の配分から、相手に対して最も有利なものをAIが選ぶ。耐久を変えると最大HPも変わり、EXの数だけ振り直しを得る。交戦終了で元に戻る。' }),
    sk('人よ、神を繋ぎとめよう（攻撃）', 'A++', 'np', 0, [blk('attack', [mod(10, true)], { types: [P] })], { res: np(), note: 'エヌマ・エリシュ。物理攻撃時に10までの補正値。' }),
    sk('人よ、神を繋ぎとめよう（防御）', 'A++', 'np', 0, [blk('allyAttacked', [fx('redirect'), fx('applyState', { state: '民を護る楔', to: 'self' })])], { res: np(), ai: { policy: 'never', threshold: 50 }, note: '防御時、攻撃対象を自分のみに変更し5までの補正値。攻撃用と宝具回数を共有するため、既定ではAIは攻撃用を使う（こちらを使わせたい場合はAI設定を変更）。' }),
  ], { note: 'ステータスは「？」表記のため、数値（5/8/5/5/5）に合わせてA/EX/A/A/Aで登録。' }));

  C.push(ch('ヘラクレス', 'バーサーカー', ['A+', 'A', 'A', 'A', 'D'], ['混沌・狂', '天属性', '神性'], [
    sk('狂化', 'B', 'class', 10, [blk('attack', [mod(5)], { types: [P, M] }), blk('defend', [mod(5)], { types: [P, M] })], { csLoss: 1, note: 'キャラシート作成時、令呪を1つ失う。' }),
    sk('神性', 'A', 'skill', 5, [], { heroBonus: 10, note: 'キャラシート作成時、サーヴァントの英雄点10を得る（令呪コストの予算に加算）。' }),
    sk('勇猛', 'A', 'skill', 1, [hpUp(15)]),
    sk('十二の試練', 'B', 'np', 0, [blk('lethal', [
      fx('endure', { value: 'd(5,6)' }),
      fx('applyState', { state: '十二の試練（物理）', to: 'self', if: "event.attackType == 'physical'" }),
      fx('applyState', { state: '十二の試練（魔術）', to: 'self', if: "event.attackType == 'magic'" }),
      fx('applyState', { state: '十二の試練（奇襲）', to: 'self', if: "event.attackType == 'surprise'" }),
    ])], { res: np(), note: 'ゴッド・ハンド。HPが0になった時、5D6回復して復活。その交戦中、倒された攻撃と同じ種類への防御に5までの補正値。' }),
  ]));

  // ------------------------------------------------------------------
  // マスター（ドローン）
  // ------------------------------------------------------------------
  const ou = () => np('ougi');
  const mRes = () => [{ key: 'cs', name: '令呪', max: 3 }, { key: 'ougi', name: '奥義', max: 1 }];
  const ma = (name, ranks, tags, skills, note) => {
    const c = ch(name, 'マスター', ranks, ['マスター'].concat(tags), skills, { resources: mRes(), note: note || '' });
    return c;
  };
  const sv = ['isServant(actor)'];
  const mDrone = () => sk('STYLE〔DRONE〕', '', 'skill', 0, [blk('static', [fx('flag', { name: 'fullDamage' })])], { heroBonus: 5, note: '英雄点5を得る（契約サーヴァントの予算に加算）。サーヴァントに対して通常のダメージを与える（半減しない）。' });
  const mAssassin = () => sk('SKILL〔ASSASSIN〕', '', 'skill', 0, [blk('static', [fx('flag', { name: 'surprise' })])], { note: '交戦フェイズ中に奇襲攻撃を行える。' });
  const mPowered = () => sk('STYLE〔POWERED〕', '', 'skill', 0, [], { heroBonus: 5, note: '英雄点5を得る。ステータス上限がEXになる（ルールの上限内のため計算上の効果なし）。' });
  const mFellow = () => sk('STYLE〔FELLOW〕', '', 'skill', 0, [blk('battleStart', [fx('maxHp', { value: '15', to: 'servants' })])], { note: '自分のサーヴァントの最大HP+15（マスター脱落時はこの分も失う）。' });
  const mSend = () => sk('SKILL〔SEND〕', '', 'skill', 0, [blk('allyInitiative', [mod(3)], { cond: sv })], { note: '自分のサーヴァントの先手判定に+3。' });
  const mExtra = () => sk('STYLE〔EXTRA〕', '', 'skill', 0, [], { heroBonus: 5, note: '英雄点5を得る。エクストラクラス召喚可。' });
  const mIllusion = () => sk('SKILL〔ILLUSION〕', '', 'skill', 0, [blk('engagementStart', [fx('applyState', { state: '攻撃不能', to: 'enemiesFront', if: "has(target,'マスター') || has(target,'乗騎')" })])], { note: '交戦開始時、サーヴァント以外の相手前衛に1巡攻撃不能。' });
  const mSwap = (n) => sk(n, '', 'skill', 0, [], { note: '前衛と後衛の入れ替え（行動）。AIでは未使用。' });

  C.push(ma('TYPE〔TULU〕', ['E', 'A', 'E', 'E', 'A+'], ['無性'], [
    mDrone(), mAssassin(),
    sk('▄▅▇▄▅▃▄▅▆（発音不能）', '', 'np', 0, [blk('attack', [fx('aoe'), mod(5, true)], { types: [S] })], { res: ou() }),
  ]));
  C.push(ma('TYPE〔SHADOW〕', ['E', 'C', 'A', 'E', 'A'], ['女性'], [
    mAssassin(), mDrone(),
    sk('サイレントキル', '', 'np', 0, [blk('attack', [mod(10, true)], { types: [S] })], { res: ou() }),
  ]));
  C.push(ma('TYPE〔RAIKO〕', ['E', 'D', 'B', 'A+', 'E'], ['女性'], [
    sk('SKILL〔RAIGEKI〕', '', 'skill', 0, [blk('attack', [mod(5)], { types: [M] })]),
    mDrone(),
    sk('カモノオオミカミナリ', '', 'np', 0, [blk('attack', [fx('aoe'), mod(5, true)], { types: [M] })], { res: ou() }),
  ]));
  C.push(ma('TYPE〔THUNDER〕', ['A+', 'A+', 'E', 'C', 'D'], ['男性'], [
    mPowered(), mDrone(),
    sk('トールハンマー', '', 'np', 0, [blk('turnStart', [fx('applyState', { state: 'トールハンマー', to: 'self' })])], { res: ou() }),
  ]));
  C.push(ma('TYPE〔CROWN〕', ['D', 'D', 'D', 'D', 'D'], ['男性'], [
    mIllusion(), mSwap('SKILL〔FAKE〕'),
    sk('ジェスター・サーカス', '', 'np', 0, [blk('engagementStart', [fx('applyState', { state: 'ジェスター・サーカス', to: 'enemyTopHp' })])], { res: ou(), note: '交戦開始時、HPが最も高い相手前衛1体に使用。' }),
  ]));
  C.push(ma('TYPE〔SHAMAN〕', ['E', 'C', 'E', 'B', 'E'], ['男性'], [
    mIllusion(),
    sk('SKILL〔DOT〕', '', 'skill', 0, [blk('action', [fx('damage', { value: '5', to: 'enemyLowest' })])], { note: '前衛時、攻撃の代わりに相手前衛1体へ5ダメージ（AIは毎手番使用）。' }),
    sk('リギ・マガツノリト', '', 'np', 0, [blk('action', [fx('territoryBreak')], { cond: ['self.front', 'enemyTerritory()'] })], { res: ou(), note: '前衛にいる時、行動の代わりに陣地破壊。AIは相手に陣地がある時だけ使う。' }),
  ]));
  C.push(ma('TYPE〔REGALIA〕', ['C', 'D', 'E', 'C', 'E'], ['女性'], [
    sk('SKILL〔CIRCLE〕', '', 'skill', 0, [blk('allyAttack', [mod(3)], { types: [P, M], cond: sv.concat(["teamFlag('陣地')"]) })], { note: '陣地内（陣営フラグ「陣地」）で自分のサーヴァントの物理・魔術攻撃+3。' }),
    mFellow(),
    sk('パンドラボックス', '', 'np', 0, [blk('engagementStart', [fx('applyState', { state: 'パンドラボックス', to: 'servants' })])], { res: ou() }),
  ]));
  C.push(ma('TYPE〔PRIEST〕', ['D', 'D', 'D', 'D', 'D'], ['男性'], [
    sk('SKILL〔HEALING〕', '', 'skill', 0, [blk('movePhase', [fx('heal', { value: 'd(self.END,6)', to: 'servants' })])], { note: '交戦の合間（移動フェイズ相当）に自分のサーヴァントを耐久値D6回復。' }),
    mFellow(),
    sk('アスムプティオ', '', 'np', 0, [blk('movePhase', [fx('heal', { value: 'd(10,6)', to: 'servants' }), fx('clearDebuffs', { to: 'servants' })])], { res: ou(), ai: { policy: 'hpBelow', threshold: 50 } }),
  ]));
  C.push(ma('TYPE〔FORMULA〕', ['E', 'D', 'EX', 'E', 'E'], ['女性'], [
    mFellow(), mPowered(),
    sk('ハイ・トラッキング', '', 'np', 0, [blk('initiative', [mod(10, true)])], { res: ou(), note: '自分が先手判定を行う時のみ（前衛配置時）。' }),
  ]));
  C.push(ma('TYPE〔SHADE〕', ['D', 'EX', 'E', 'E', 'E'], ['女性'], [
    mPowered(),
    sk('SKILL〔DEFENSE〕', '', 'skill', 0, [blk('defend', [mod(3)], { types: [P, M], cond: ["!has(target,'マスター')"] })]),
    sk('スクトゥム・アイアス', '', 'np', 0, [blk('allyAttacked', [fx('redirect'), fx('applyState', { state: 'スクトゥム・アイアス', to: 'self' })], { types: [P, M] })], { res: ou(), note: '前衛にいる時、味方への物理・魔術攻撃を引き受け、その防御に5までの補正値。' }),
  ]));
  C.push(ma('TYPE〔ROLY-POLY〕', ['D', 'D', 'D', 'D', 'D'], ['無性'], [
    mSwap('SKILL〔BABY〕'),
    sk('SKILL〔GUARD〕', '', 'skill', 0, [blk(['allyAttack', 'allyDefend'], [fx('noNegFaces')], { cond: sv })], { uses: once('engagement'), note: '交戦ごと1回、自分のサーヴァントのダイスのマイナス補正を無効。' }),
    sk('クローラー・グローリー', '', 'np', 0, [blk('engagementStart', [fx('summon', { char: '子機', value: '1', pos: 'front', life: 'engagement', link: true })])], { res: ou() }),
  ]));
  C.push(ch('子機', '乗騎', ['E', 'E', 'E', 'E', 'E'], ['乗騎', '無性'], [], { resources: [] }));
  C.push(ma('TYPE〔MONOLITH〕', ['D', 'B', 'E', 'D', 'E'], ['無性'], [
    sk('SKILL〔SMOKE〕', '', 'skill', 0, [], { heroBonus: -5, note: 'マスターの英雄点を5点減らす。遠距離攻撃フェイズのダメージ0は対象外。' }),
    sk('STYLE〔DETEKT〕', '', 'skill', 0, [], { heroBonus: 5, note: '英雄点5を得る。真名看破（対象外）。' }),
    sk('プリフェクチャー・サンクチュアリ', '', 'np', 0, [blk('static', [fx('flag', { name: 'territoryGuard' })], { cond: ['self.front'] })], { res: ou(), note: '前衛にいる間、自陣営への陣地破壊を無効にする。' }),
  ]));
  C.push(ma('TYPE〔OMNIVORE〕', ['EX', 'D', 'E', 'E', 'E'], ['無性'], [
    mPowered(),
    sk('STYLE〔STABLE-P〕', '', 'skill', 0, [blk('attack', [fx('noRedirect')], { types: [P] })]),
    sk('ディスポーシャル・イーター', '', 'np', 0, [
      blk('attack', [mod(5, true)], { types: [P] }),
      blk('attack', [mod('target.END', true)], { types: [P], cond: ["has(target,'マスター')"] }),
    ], { res: ou() }),
  ]));
  C.push(ma('TYPE〔HAWTHON〕', ['D', 'D', 'D', 'D', 'A+'], ['男性'], [
    mAssassin(),
    sk('STYLE〔STABLE-S〕', '', 'skill', 0, [blk('attack', [fx('noRedirect')], { types: [S] })]),
    sk('STYLE〔STAKE〕', '', 'skill', 0, [blk('attack', [mod(5)], { types: [S], mode: 'any', cond: ["has(target,'吸血鬼')", "has(target,'死徒')"] })], { heroBonus: 5, note: '英雄点5を得る。' }),
  ]));
  C.push(ma('TYPE〔PROSTITUNE〕', ['A+', 'D', 'B', 'E', 'E'], ['女性'], [
    mDrone(),
    sk('STYLE〔CHARM〕', '', 'skill', 0, [
      blk('attack', [mod(5)], { types: [P], cond: ["has(target,'男性')"] }),
      blk('defend', [mod(3)], { types: [P], cond: ["has(target,'男性')"] }),
    ]),
    sk('フォーリング・キャノピー', '', 'np', 0, [
      blk('attack', [mod(5, true)], { types: [P] }),
      blk('attack', [mod('target.END', true)], { types: [P], cond: ["has(target,'男性')"] }),
    ], { res: ou() }),
  ]));
  C.push(ma('TYPE〔DEVIL〕', ['EX', 'D', 'E', 'E', 'E'], ['女性'], [
    mSend(), mPowered(),
    sk('アグリメント・ビット', '', 'np', 0, [blk('support', [mod(5, true)], { types: [P] })], { res: ou(), note: '物理攻撃を援護する時、追加で5までの補正値（陣営の「援護を使う」をオンに）。' }),
  ]));
  C.push(ma('TYPE〔TEENS〕', ['D', 'D', 'D', 'D', 'D'], ['女性'], [
    sk('SKILL〔MAGIC〕', '', 'skill', 0, [blk('allyAttack', [mod(3)], { types: [M], cond: sv })]),
    mFellow(),
    sk('リ・アドレスンス', '', 'np', 0, [blk('allyAttack', [mod(5, true)], { types: [M], cond: sv })], { res: ou() }),
  ]));
  C.push(ma('TYPE〔SCRAP〕', ['D', 'D', 'D', 'D', 'D'], ['無性'], [
    sk('SKILL〔BLAST〕', '', 'skill', 0, [blk('allyAttack', [mod(3)], { types: [P], cond: sv })]),
    mSend(),
    sk('トランス・ミサイル', '', 'np', 0, [blk('allyAttack', [mod(5, true)], { types: [P], cond: sv })], { res: ou() }),
  ]));
  C.push(ma('TYPE〔KOTOMINE〕', ['A', 'C', 'C', 'D', 'D'], ['男性'], [
    sk('SKILL〔SEARCH〕', '', 'skill', 0, [], { heroBonus: 5, note: '英雄点5を得る。移動フェイズの索敵（対象外）。' }),
    sk('SKILL〔ELUSIVE〕', '', 'skill', 0, [], { note: '遭遇への乱入（対象外）。' }),
    sk('絶招・震脚', '', 'np', 0, [blk('allyInitiative', [mod(5, true)], { cond: sv })], { res: ou() }),
  ]));
  C.push(ma('TYPE〔TESTAMENT〕', ['C', 'C', 'C', 'C', 'C'], ['中性'], [
    mExtra(),
    sk('STYLE〔STIGMATA〕', '', 'skill', 0, [], { csGain: 1, note: 'スキル枠-1、初期令呪+1（上限3）。' }),
  ]));
  C.push(ma('TYPE〔MONONOFU〕', ['A+', 'B', 'A+', 'E', 'E'], ['男性'], [
    mExtra(), mDrone(),
    sk('ヘンイバットウ', '', 'np', 0, [blk('attack', [mod(5, true), fx('reroll', { value: '2' })], { types: [P] })], { res: ou() }),
  ]));
  C.push(ma('TYPE〔IBUKI〕', ['A', 'C', 'E', 'A', 'E'], ['女性'], [
    mSend(), mExtra(),
    sk('ナルカミノハラエ', '', 'np', 0, [blk('action', [fx('damage', { value: '5', to: 'enemiesFront' })])], { res: ou(), note: '前衛時、攻撃の代わりに相手前衛全員へ5ダメージ。' }),
  ]));

  // ------------------------------------------------------------------
  // ボス：ビースト（FGO の設定を元にした本ルール用の試作シート）
  // ------------------------------------------------------------------
  C.push(ch('魔神柱', '召喚体', ['B', 'A', 'E', 'B', 'E'], ['魔神柱', '魔性'], [
    sk('魔神の眼光', '', 'skill', 0, [blk('attack', [mod(3)], { types: [M] })]),
  ], { resources: [], ai: { target: 'lowestHp', tag: '' }, note: '人王ゲーティアが召喚する七十二柱の魔神の一柱。召喚者が倒れると消滅。' }));

  C.push(ch('魔神王ゲーティア', 'ビーストⅠ', ['A', 'A', 'D', 'A+', 'B'], ['ボス', 'ビースト', '魔性'], [
    sk('獣の権能', 'EX', 'class', 0, [blk('attack', [mod(5)], { types: [P, M], cond: ["has(target,'人属性')"] })], { note: '対人類特攻。人属性の相手への物理・魔術攻撃+5。' }),
    sk('単独顕現', 'A', 'class', 0, [blk('static', [fx('flag', { name: 'independent' })])], { note: 'マスター不要。即死・時間操作への耐性は対象外。' }),
    sk('ネガ・サモン', 'EX', 'class', 0, [blk('static', [fx('negateIncoming', { names: '', kinds: 'np' })], { cond: ['engagement == 1', "!has(target,'デミ・サーヴァント')"] })], { note: '召喚された英霊の宝具を打ち消す。FGOの「開幕3ターン宝具無効」を、最初の交戦フェイズ中は受ける攻撃の宝具補正を無効として再現。デミ・サーヴァント（マシュ）には効かない。' }),
    sk('ソロモンの指輪', 'EX', 'skill', 0, [
      blk('attack', [fx('negateOpp', { names: '対魔力,陣地作成', kinds: '' })], { types: [M] }),
      blk('defend', [mod(5)], { types: [M] }),
    ], { note: '人類の魔術を支配下に置く。魔術攻撃時に相手の対魔力・陣地作成を無効、魔術防御+5。' }),
    sk('召喚', 'EX', 'skill', 0, [blk('engagementStart', [fx('summon', { char: '魔神柱', value: "2 - allyCount('魔神柱')", pos: 'front', life: 'battle', link: true })])], { note: '交戦フェイズ開始ごとに、魔神柱が2柱になるまで召喚。ゲーティアが倒れると全て消滅。' }),
    sk('千里眼', 'EX', 'skill', 0, [blk('initiative', [mod(5)])], { note: '過去と未来を見通す。先手判定+5。' }),
    sk('誕生の時きたれり、其は全てを修めるもの', 'A+++', 'np', 0, [
      blk('attack', [fx('aoe'), mod(10, true), fx('applyState', { state: '人理焼却', to: 'target', if: 'event.damage > 0' })], { types: [M] }),
    ], { res: np(), note: 'アルス・アルマデル・サロモニス。光帯による全体魔術攻撃。ダメージを与えた相手に「人理焼却」（攻防-2）。' }),
  ], { hpExtra: 200, actions: 3, ai: { target: 'smart', tag: '' }, note: 'FGO第1部終章の魔神王ゲーティアを元にした試作ボス。1手番3回行動＋魔神柱。PC4騎（アルトリア・マシュ・エミヤ・メディア、令呪・援護あり）で勝率約45%になるようHP補正+200（HP225）に調整。パラメータは型月設定（筋A・耐A・敏D・魔A+・幸B）。HP補正で難易度を調整。' }));

  C.push(ch('殺生院キアラ（ビーストⅢ／R）', 'ビーストⅢ／R', ['C', 'EX', 'B', 'EX', 'A'], ['ボス', 'ビースト', '魔性', '女性'], [
    sk('獣の権能', 'A', 'class', 0, [blk('attack', [mod(5)], { types: [P, M], cond: ["has(target,'人属性')"] })], { note: '対人類特攻。' }),
    sk('単独顕現', 'B', 'class', 0, [blk('static', [fx('flag', { name: 'independent' })])]),
    sk('ロゴスイーター', 'EX', 'class', 0, [blk('defend', [mod(3)], { types: ALL, cond: ["has(target,'人属性')"] })], { note: '知性体を例外なく溶かす。人属性からの攻撃への防御+3。' }),
    sk('ネガ・セイヴァー', 'A', 'class', 0, [blk('attack', [mod(5), fx('negateOpp', { names: '', kinds: 'class,skill' })], { types: [P, M], mode: 'any', cond: ["target.cls == 'ルーラー'", "target.cls == 'セイヴァー'"] })], { note: '救世主を否定する。ルーラー・セイヴァーへの攻撃+5、相手のスキル補正を無効。' }),
    sk('万色悠滞', 'EX', 'skill', 0, [blk('engagementStart', [fx('applyState', { state: '魅了', to: 'enemiesFront', if: 'target.MAG <= 5 && rand() < 0.5' })])], { note: '五感すべてを誘惑する。交戦開始時、魔力5以下の相手前衛それぞれに50%で魅了（1巡行動不能）。' }),
    sk('カルマ・ファージ', 'EX', 'skill', 0, [blk('dealtDamage', [fx('heal', { value: 'floor(event.damage/2)', to: 'self' })])], { note: '業を喰らう。与えたダメージの半分だけHP回復。' }),
    sk('五停心観', 'A+', 'skill', 0, [blk('engagementStart', [fx('clearBuffs', { to: 'enemiesFront' }), fx('applyState', { state: '防御低下', to: 'enemiesFront' })])], { note: '交戦開始時、相手前衛のバフ解除と防御-2。' }),
    sk('快楽天・胎蔵曼荼羅', 'EX', 'np', 0, [
      blk('attack', [fx('aoe'), mod(10, true), fx('negateOpp', { names: '', kinds: 'class,skill,state' }), fx('heal', { value: 'd(5,6)', to: 'self' })], { types: [M] }),
    ], { res: np(), note: 'アミダアミデュラ・ヘブンズホール。防御力無視の全体魔術攻撃（相手の防御補正は宝具のみ有効）。使用後HPを5D6回復。' }),
  ], { hpExtra: 140, actions: 3, ai: { target: 'smart', tag: '' }, note: 'FGO・CCCコラボのビーストⅢ／Rを元にした試作ボス。1手番3回行動。PC4騎（アルトリア・ジャンヌ・クー・フーリン・玉藻、令呪・援護あり）で勝率約45%になるようHP補正+140（HP180）に調整。パラメータは型月設定（筋C・耐EX・敏B・魔EX・幸A）。EXが2つあるため交戦ごとに2回振り直せる。' }));

  // キャラシート記載の英雄点と令呪消費（自動計算の検算用）
  const SHEET = {
    'アルトリア・ペンドラゴン': [40, 1], 'アルトリア〔オルタ〕': [35, 0], 'エミヤ': [30, 0], 'アタランテ': [30, 0], 'クー・フーリン': [35, 0],
    'エリザベート＝バートリー': [30, 0], 'メドゥーサ': [35, 1], 'イスカンダル': [40, 0], 'メディア': [35, 2], '玉藻の前': [35, 1],
    '佐々木小次郎': [35, 1], '呪腕のハサン': [35, 1], 'スパルタクス': [40, 3], '呂布奉先': [45, 3], 'ジャンヌ・ダルク': [35, 0],
    '天草四郎時貞': [40, 2], 'アンリマユ': [30, 0], 'ジャンヌ・ダルク〔オルタ〕': [35, 1], 'マシュ・キリエライト': [30, 0], 'メルトリリス': [35, 1],
    'パッションリップ': [35, 1], 'アビゲイル・ウィリアムズ': [35, 1], '葛飾北斎': [30, 0], 'ギルガメッシュ': [40, 0], 'エルキドゥ': [45, 2], 'ヘラクレス': [40, 1],
  };
  for (const c of C) {
    c.csCostMode = 'auto';
    c.csCost = SHEET[c.name] ? SHEET[c.name][1] : 0;
    if (SHEET[c.name]) { c.sheetHero = SHEET[c.name][0]; c.sheetCs = SHEET[c.name][1]; }
  }

  const byName = (n) => C.find((c) => c.name === n).id;
  const mem = (n, pos, extra) => Object.assign({ charId: byName(n), pos: pos || 'front', key: false }, extra || {});

  const scenarios = [
    {
      id: id('sc'), name: 'アルトリア vs アルトリア〔オルタ〕（1対1）',
      teams: [
        { name: 'セイバー陣営', flags: '', support: true, members: [mem('アルトリア・ペンドラゴン')] },
        { name: 'オルタ陣営', flags: '', support: true, members: [mem('アルトリア〔オルタ〕')] },
      ],
      rounds: { mode: 'pl', value: 2 }, maxEngagements: 10, trials: 5000, seed: 20261007, logTrials: 3,
    },
    {
      id: id('sc'), name: '消耗戦：HP半分・宝具使用済みのセイバー vs 万全のオルタ',
      teams: [
        { name: 'セイバー陣営', flags: '', support: true, members: [mem('アルトリア・ペンドラゴン', 'front', { init: { hpMode: 'pct', hp: 50, res: { np: 0 }, states: [], used: [] } })] },
        { name: 'オルタ陣営', flags: '', support: true, members: [mem('アルトリア〔オルタ〕')] },
      ],
      rounds: { mode: 'pl', value: 2 }, maxEngagements: 10, trials: 5000, seed: 20261007, logTrials: 2,
    },
    {
      id: id('sc'), name: 'マスター付き：エミヤ＆TEENS vs クー・フーリン＆SCRAP',
      teams: [
        { name: 'アーチャー陣営', flags: '', support: true, members: [mem('エミヤ', 'front', { master: 1 }), mem('TYPE〔TEENS〕', 'back')] },
        { name: 'ランサー陣営', flags: '', support: true, members: [mem('クー・フーリン', 'front', { master: 1 }), mem('TYPE〔SCRAP〕', 'back')] },
      ],
      rounds: { mode: 'pl', value: 2 }, maxEngagements: 10, trials: 5000, seed: 3, logTrials: 2,
    },
    {
      id: id('sc'), name: 'PC4騎 vs ビーストⅠ（ゲーティア）',
      teams: [
        { name: 'PC陣営', flags: '', support: true, members: [
          mem('アルトリア・ペンドラゴン'), mem('マシュ・キリエライト'), mem('エミヤ'), mem('メディア'),
        ] },
        { name: 'ビーストⅠ', flags: '', support: true, csMode: 'none', members: [mem('魔神王ゲーティア', 'front', { key: true })] },
      ],
      rounds: { mode: 'fixed', value: 4 }, maxEngagements: 6, trials: 2000, seed: 1, logTrials: 2,
    },
    {
      id: id('sc'), name: 'PC4騎 vs ビーストⅢ／R（キアラ）',
      teams: [
        { name: 'PC陣営', flags: '', support: true, members: [
          mem('アルトリア・ペンドラゴン'), mem('ジャンヌ・ダルク'), mem('クー・フーリン'), mem('玉藻の前'),
        ] },
        { name: 'ビーストⅢ／R', flags: '', support: true, csMode: 'none', members: [mem('殺生院キアラ（ビーストⅢ／R）', 'front', { key: true })] },
      ],
      rounds: { mode: 'fixed', value: 4 }, maxEngagements: 6, trials: 2000, seed: 1, logTrials: 2,
    },
    {
      id: id('sc'), name: 'ギルガメッシュ vs エルキドゥ',
      teams: [
        { name: '英雄王陣営', flags: '', support: true, members: [mem('ギルガメッシュ')] },
        { name: '天の鎖陣営', flags: '', support: true, members: [mem('エルキドゥ')] },
      ],
      rounds: { mode: 'pl', value: 2 }, maxEngagements: 10, trials: 3000, seed: 2026, logTrials: 3,
    },
    {
      id: id('sc'), name: 'マスターで変わる初期令呪：エルキドゥ＆MONONOFU vs ギルガメッシュ＆TEENS',
      teams: [
        { name: '天の鎖陣営', flags: '', support: true, members: [mem('エルキドゥ', 'front', { master: 1 }), mem('TYPE〔MONONOFU〕', 'back')] },
        { name: '英雄王陣営', flags: '', support: true, members: [mem('ギルガメッシュ', 'front', { master: 1 }), mem('TYPE〔TEENS〕', 'back')] },
      ],
      rounds: { mode: 'pl', value: 2 }, maxEngagements: 10, trials: 3000, seed: 2026, logTrials: 2,
    },
    {
      id: id('sc'), name: '陣地あり：メディア（陣地作成） vs アルトリア（陣地破壊）',
      teams: [
        { name: 'キャスター陣営', flags: '陣地', support: true, members: [mem('メディア')] },
        { name: 'セイバー陣営', flags: '', support: true, members: [mem('アルトリア・ペンドラゴン')] },
      ],
      rounds: { mode: 'pl', value: 2 }, maxEngagements: 10, trials: 3000, seed: 5, logTrials: 2,
    },
    {
      id: id('sc'), name: 'ヘラクレス vs スパルタクス',
      teams: [
        { name: 'ヘラクレス陣営', flags: '', support: true, members: [mem('ヘラクレス')] },
        { name: 'スパルタクス陣営', flags: '', support: true, members: [mem('スパルタクス')] },
      ],
      rounds: { mode: 'pl', value: 2 }, maxEngagements: 10, trials: 3000, seed: 12, logTrials: 3,
    },
    {
      id: id('sc'), name: 'メドゥーサ（ペガサス召喚） vs 呂布',
      teams: [
        { name: 'ライダー陣営', flags: '', support: true, members: [mem('メドゥーサ')] },
        { name: 'バーサーカー陣営', flags: '', support: true, members: [mem('呂布奉先')] },
      ],
      rounds: { mode: 'pl', value: 2 }, maxEngagements: 10, trials: 5000, seed: 7, logTrials: 2,
    },
    {
      id: id('sc'), name: 'イスカンダル（王の軍勢） vs スパルタクス',
      teams: [
        { name: '征服王陣営', flags: '', support: true, members: [mem('イスカンダル')] },
        { name: 'スパルタクス陣営', flags: '', support: true, members: [mem('スパルタクス')] },
      ],
      rounds: { mode: 'pl', value: 2 }, maxEngagements: 10, trials: 1000, seed: 11, logTrials: 2,
    },
  ];

  const presets = { rules, states, characters: C, scenarios, version: 10, removedNames: ['【サンプル】災厄の黒竜'], removedScenarios: ['PC4騎 vs サンプルボス', 'ライダー＋ペガサス vs バーサーカー'] };
  if (typeof module !== 'undefined' && module.exports) module.exports = presets;
  else root.TRPGPresets = presets;
})(typeof self !== 'undefined' ? self : this);
