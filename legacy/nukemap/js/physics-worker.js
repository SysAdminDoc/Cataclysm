// WebWorker for offloading physics computations from the main thread
// Receives batches of {yield, burstType} and returns computed effects

importScripts('physics.js');

self.onmessage = function(e) {
  const {type, batch, id} = e.data;
  if (type === 'calcBatch') {
    const results = batch.map(item => ({
      idx: item.idx,
      effects: NM.calcEffects(item.yieldKt, item.burstType || 'airburst', item.heightM, item.fission)
    }));
    self.postMessage({type: 'batchResult', id, results});
  } else if (type === 'calcSingle') {
    const effects = NM.calcEffects(e.data.yieldKt, e.data.burstType || 'airburst', e.data.heightM, e.data.fission);
    self.postMessage({type: 'singleResult', id, effects});
  }
};
