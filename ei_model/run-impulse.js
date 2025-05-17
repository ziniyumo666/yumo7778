// ei_model/run-impulse.js
const Module = require('./edge-impulse-standalone');

module.exports = async function () {
  await Module.ready;
  Module.init();

  return {
    classify: (float32RGBInput) => {
      const typed = new Float32Array(float32RGBInput);
      const nBytes = typed.length * typed.BYTES_PER_ELEMENT;
      const ptr = Module._malloc(nBytes);
      const heap = new Uint8Array(Module.HEAPU8.buffer, ptr, nBytes);
      heap.set(new Uint8Array(typed.buffer));
      const result = Module.run_classifier(ptr, typed.length, false);
      Module._free(ptr);
      return result;
    }
  };
};



