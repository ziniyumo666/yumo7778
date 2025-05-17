
// edge-impulse-browser.js

let Module = null;
let instance = null;
let memory = null;

async function loadWasmModel(wasmUrl) {
    const response = await fetch(wasmUrl);
    const buffer = await response.arrayBuffer();

    const module = await WebAssembly.instantiate(buffer, {
        env: {
            emscripten_notify_memory_growth: function () {},
            memory: new WebAssembly.Memory({initial: 256, maximum: 512}),
        }
    });

    instance = module.instance;
    memory = instance.exports.memory;
    Module = instance.exports;

    if (Module.init) Module.init();

    console.log("✅ WASM 模型初始化完成");
}

// 圖像資料進行推論
async function run(imageData) {
    if (!Module || !Module.run_classifier_image) {
        throw new Error("❌ 模型尚未載入或不支援 run_classifier_image");
    }

    const width = imageData.width;
    const height = imageData.height;
    const channels = 3; // RGB

    const bufferSize = width * height * channels;
    const ptr = Module._malloc(bufferSize);
    const heap = new Uint8Array(memory.buffer, ptr, bufferSize);

    let offset = 0;
    for (let i = 0; i < imageData.data.length; i += 4) {
        heap[offset++] = imageData.data[i];     // R
        heap[offset++] = imageData.data[i + 1]; // G
        heap[offset++] = imageData.data[i + 2]; // B
    }

    const resultPtr = Module.run_classifier_image(ptr, width, height);
    const resultJsonPtr = Module.get_classifier_result_json();
    const decoder = new TextDecoder();
    let str = "";
    let u8arr = new Uint8Array(memory.buffer, resultJsonPtr, 4096);
    for (let i = 0; i < u8arr.length && u8arr[i] !== 0; i++) {
        str += String.fromCharCode(u8arr[i]);
    }

    Module._free(ptr);
    return JSON.parse(str);
}

// 掛到 window 讓 HTML 可用
window.loadWasmModel = loadWasmModel;
window.run = run;
