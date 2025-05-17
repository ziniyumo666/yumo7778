const Module = require('./edge-impulse-standalone');

module.exports = async function () {
  return new Promise((resolve, reject) => {
    Module.onRuntimeInitialized = () => {
      if (typeof Module.init === 'function') {
        Module.init();
      }

      resolve({
        classify: (input) => {
          if (!Array.isArray(input) || input.length === 0) {
            throw new Error('Invalid input array');
          }

          const typed = new Float32Array(input);
          const nBytes = typed.length * typed.BYTES_PER_ELEMENT;
          const ptr = Module._malloc(nBytes);
          const heap = new Uint8Array(Module.HEAPU8.buffer, ptr, nBytes);
          heap.set(new Uint8Array(typed.buffer));

          const result = Module.run_classifier(ptr, typed.length, false);
          Module._free(ptr);

          if (result.result !== 0) {
            throw new Error(`推論失敗（code=${result.result}）`);
          }

          const output = {
            results: [],
            anomaly: result.anomaly
          };

          for (let i = 0; i < result.size(); i++) {
            const res = result.get(i);
            output.results.push({ label: res.label, value: res.value });
            res.delete();
          }

          result.delete();
          return output;
        }
      });
    };

    // 若五秒後還沒初始化就視為失敗
    setTimeout(() => {
      reject(new Error('Edge Impulse 模型初始化逾時'));
    }, 5000);
  });
};



