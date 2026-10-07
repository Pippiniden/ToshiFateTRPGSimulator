/* シミュレーション用 Web Worker */
importScripts('engine.js');

self.onmessage = function (e) {
  const msg = e.data;
  if (msg.cmd !== 'run') return;
  try {
    const C = TRPGEngine.compileScenario(msg.data);
    if (C.teams.length < 2) throw new Error('2つ以上の陣営にキャラクターを配置してください。');
    const agg = TRPGEngine.runTrials(C, Object.assign({}, msg.opts, {
      onProgress: (done) => self.postMessage({ type: 'progress', id: msg.id, done }),
    }));
    agg.warnings = [...agg.warnings];
    self.postMessage({ type: 'result', id: msg.id, agg });
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: err && err.message ? err.message : String(err) });
  }
};
