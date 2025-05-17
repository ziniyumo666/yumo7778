// ei_model/run-impulse.js
const Module = require('./edge-impulse-standalone');

let initialized = false;

function init() {
  return new Promise((resolve, reject) => {
    if (initialized) return resolve(classifier);

    Module.onRuntimeInitialized = () => {
      if (typeof Module.init === 'function') {
        Module.init();
      }
      initialized = true;

      const classify = (input) => {
        const typed = new Float32Array(input);
        const nBytes = typed.length * typed.BYTES_PER_ELEMENT;
        const ptr = Module._malloc(nBytes);
        const heap = new Uint8Array(Module.HEAPU8.buffer, ptr, nBytes);
        heap.set(new Uint8Array(typed.buffer));
        const result = Module.run_classifier(ptr, typed.length, false);
        Module._free(ptr);
        return result;
      };

      resolve({ classify });
    };
  });
}

module.exports = init;




