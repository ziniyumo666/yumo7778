// run-impulse.js
const Module = require('./edge-impulse-standalone');

module.exports = async function () {
  return new Promise((resolve) => {
    Module.onRuntimeInitialized = () => {
      Module.init();
      resolve({
        classify: (rawData, debug = false) => {
          const typedArray = new Float32Array(rawData);
          const numBytes = typedArray.length * typedArray.BYTES_PER_ELEMENT;
          const ptr = Module._malloc(numBytes);
          const heapBytes = new Uint8Array(Module.HEAPU8.buffer, ptr, numBytes);
          heapBytes.set(new Uint8Array(typedArray.buffer));

          const result = Module.run_classifier(ptr, typedArray.length, debug);
          Module._free(ptr);

          if (result.result !== 0) {
            throw new Error('推論失敗 (錯誤碼: ' + result.result + ')');
          }

          const props = Module.get_properties();
          const output = { results: [] };

          for (let i = 0; i < result.size(); i++) {
            const r = result.get(i);
            output.results.push({ label: r.label, value: r.value });
            r.delete();
          }

          result.delete();
          return output;
        }
      });
    };
  });
};
