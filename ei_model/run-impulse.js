// ei_model/run-impulse.js
const Module = require('./edge-impulse-standalone');

let classifierInstance = null;

function init() {
  return new Promise((resolve, reject) => {
    if (classifierInstance) return resolve(classifierInstance);

    Module.onRuntimeInitialized = () => {
      try {
        if (typeof Module.init === 'function') {
          Module.init();
        }

        const classify = (input) => {
          const typed = new Float32Array(input);
          const nBytes = typed.length * typed.BYTES_PER_ELEMENT;
          const ptr = Module._malloc(nBytes);
          const heap = new Uint8Array(Module.HEAPU8.buffer, ptr, nBytes);
          heap.set(new Uint8Array(typed.buffer));

          const resultStruct = Module.run_classifier(ptr, typed.length, false);
          Module._free(ptr);

          // 將結果轉為 JavaScript 格式
          const results = [];
          const size = resultStruct.size();
          for (let i = 0; i < size; i++) {
            const r = resultStruct.get(i);
            results.push({ label: r.label, value: r.value });
            r.delete();  // 清除內部記憶體
          }

          const anomaly = resultStruct.anomaly;
          resultStruct.delete(); // 清除整個結果物件

          return { results, anomaly };
        };

        classifierInstance = { classify };
        resolve(classifierInstance);
      } catch (err) {
        reject(err);
      }
    };
  });
}

module.exports = init;





