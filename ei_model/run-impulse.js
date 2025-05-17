// ei_model/run-impulse.js

const Module = require('./edge-impulse-standalone');
const fs = require('fs');

let classifierWasmInitialized = false; // 更名以區分 WASM 初始化狀態

// 這個回呼函數表示 WASM 模組 (edge-impulse-standalone.js) 已經完成其異步初始化
Module.onRuntimeInitialized = function() {
    console.log('WASM Runtime Initialized.');
    classifierWasmInitialized = true;
};
// 有些 Emscripten 模組可能會立即設置 isRuntimeInitialized
if (Module.isRuntimeInitialized) {
    classifierWasmInitialized = true;
}


class EdgeImpulseClassifier {
    _initialized = false; // 用於追蹤此分類器實例是否已初始化

    constructor() {
        // 建構函數可以保持簡單
    }

    async init() {
        if (this._initialized) return Promise.resolve();

        return new Promise((resolve, reject) => {
            const checkWasmReady = () => {
                if (classifierWasmInitialized) {
                    // 確認 Edge Impulse WASM 模組提供的核心函數是否存在
                    if (typeof Module._malloc !== 'function' ||
                        typeof Module.HEAPU8 === 'undefined' ||
                        typeof Module.run_classifier !== 'function' || // 根據您的使用情況檢查關鍵函數
                        typeof Module.get_project !== 'function') {
                        console.error('❌ WASM 模組似乎未完全載入或缺少必要函數。');
                        return reject(new Error('WASM module not fully loaded or missing functions.'));
                    }
                    console.log('EdgeImpulseClassifier instance is ready.');
                    this._initialized = true;
                    resolve();
                } else {
                    // console.log('WASM runtime not ready yet, waiting...'); // 減少日誌輸出
                    setTimeout(checkWasmReady, 100); // 短時間後再次檢查
                }
            };
            checkWasmReady();
        });
    }

    getProjectInfo() {
        if (!this._initialized || !classifierWasmInitialized) {
            throw new Error('Classifier or WASM module is not initialized for getProjectInfo.');
        }
        if (typeof Module.get_project !== 'function' || typeof Module.emcc_classification_project_t === 'undefined') {
            throw new Error('Module.get_project or Module.emcc_classification_project_t is not available.');
        }
        return this._convertToOrdinaryJsObject(Module.get_project(), Module.emcc_classification_project_t.prototype);
    }

    classify(rawData, debug = false) {
        if (!this._initialized || !classifierWasmInitialized) {
            throw new Error('Classifier or WASM module is not initialized for classify.');
        }
        if (typeof Module.run_classifier !== 'function') {
            throw new Error('Module.run_classifier is not available.');
        }

        const obj = this._arrayToHeap(rawData);
        let ret;
        try {
            ret = Module.run_classifier(obj.buffer.byteOffset, rawData.length, debug);
        } finally {
            if (obj && obj.ptr) {
                Module._free(obj.ptr);
            }
        }

        if (ret.result !== 0) {
            throw new Error('Classification failed (err code: ' + ret.result + ')');
        }

        return this._fillResultStruct(ret);
    }

    _arrayToHeap(data) {
        if (!this._initialized || !classifierWasmInitialized) {
             throw new Error('Classifier or WASM module is not initialized for _arrayToHeap.');
        }
        if (typeof Module._malloc !== 'function' || typeof Module.HEAPU8 === 'undefined') {
            throw new Error('WASM memory functions (_malloc, HEAPU8) not available for _arrayToHeap.');
        }
        let typedArray = new Float32Array(data);
        let numBytes = typedArray.length * typedArray.BYTES_PER_ELEMENT;
        let ptr = Module._malloc(numBytes);
        if (ptr === 0) {
            throw new Error('Module._malloc failed to allocate memory in _arrayToHeap.');
        }
        let heapBytes = new Uint8Array(Module.HEAPU8.buffer, ptr, numBytes);
        heapBytes.set(new Uint8Array(typedArray.buffer));
        return { ptr: ptr, buffer: heapBytes };
    }

    _convertToOrdinaryJsObject(emboundObj, prototype) {
        if (!this._initialized || !classifierWasmInitialized) {
            throw new Error('Classifier or WASM module is not initialized for _convertToOrdinaryJsObject.');
        }
        let newObj = { };
        for (const key of Object.getOwnPropertyNames(prototype)) {
            const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
            if (descriptor && typeof descriptor.get === 'function') {
                newObj[key] = emboundObj[key];
            }
        }
        return newObj;
    }

     _fillResultStruct(ret) {
        if (!this._initialized || !classifierWasmInitialized) {
            throw new Error('Classifier or WASM module is not initialized for _fillResultStruct.');
        }
        if (typeof Module.get_properties !== 'function') {
            throw new Error('Module.get_properties not available for _fillResultStruct.');
        }
        let props = Module.get_properties();

        let jsResult = {
            anomaly: ret.anomaly,
            results: []
        };

        for (let cx = 0; cx < ret.size(); cx++) {
            let c = ret.get(cx);
            if (props.model_type === 'object_detection' || props.model_type === 'constrained_object_detection') {
                jsResult.results.push({ label: c.label, value: c.value, x: c.x, y: c.y, width: c.width, height: c.height });
            }
            else {
                jsResult.results.push({ label: c.label, value: c.value });
            }
            if (typeof c.delete === 'function') c.delete(); // 確保存在 delete 方法
        }

        if (props.has_object_tracking) {
            jsResult.object_tracking_results = [];
            for (let cx = 0; cx < ret.object_tracking_size(); cx++) {
                let c = ret.object_tracking_get(cx);
                jsResult.object_tracking_results.push({ object_id: c.object_id, label: c.label, value: c.value, x: c.x, y: c.y, width: c.width, height: c.height });
                if (typeof c.delete === 'function') c.delete();
            }
        }

        if (props.has_visual_anomaly_detection) {
            jsResult.visual_ad_max = ret.visual_ad_max;
            jsResult.visual_ad_mean = ret.visual_ad_mean;
            jsResult.visual_ad_grid_cells = [];
            for (let cx = 0; cx < ret.visual_ad_grid_cells_size(); cx++) {
                let c = ret.visual_ad_grid_cells_get(cx);
                jsResult.visual_ad_grid_cells.push({ label: c.label, value: c.value, x: c.x, y: c.y, width: c.width, height: c.height });
                if (typeof c.delete === 'function') c.delete();
            }
        }

        if (typeof ret.delete === 'function') ret.delete();
        return jsResult;
    }

    getProperties() {
        if (!this._initialized || !classifierWasmInitialized) {
            throw new Error('Classifier or WASM module is not initialized for getProperties.');
        }
        if (typeof Module.get_properties !== 'function' || typeof Module.emcc_classification_properties_t === 'undefined') {
            throw new Error('Module.get_properties or Module.emcc_classification_properties_t not available.');
        }
        return this._convertToOrdinaryJsObject(Module.get_properties(), Module.emcc_classification_properties_t.prototype);
    }

    setThreshold(obj) {
        if (!this._initialized || !classifierWasmInitialized) {
            throw new Error('Classifier or WASM module is not initialized for setThreshold.');
        }
        if (typeof Module.set_threshold !== 'function') {
            throw new Error('Module.set_threshold not available.');
        }
        const ret = Module.set_threshold(obj);
        if (!ret.success) {
            throw new Error(ret.error);
        }
    }
    // 您可能還有 classifyContinuous 方法，這裡省略以保持簡潔，但修改邏輯類似
}

// --- CLI portion ---
// 只有當這個腳本被直接執行時，以下程式碼才會運行
if (require.main === module) {
    if (!process.argv[2]) {
        console.error('Usage: node run-impulse.js <features_string_or_file_path>');
        process.exit(1);
    }

    let features_arg_cli = process.argv[2];
    if (fs.existsSync(features_arg_cli)) {
        features_arg_cli = fs.readFileSync(features_arg_cli, 'utf-8');
    }

    let cli_classifier_instance = new EdgeImpulseClassifier();
    cli_classifier_instance.init().then(async () => {
        let project = cli_classifier_instance.getProjectInfo();
        console.log('CLI: Running inference for', project.owner + ' / ' + project.name + ' (version ' + project.deploy_version + ')');
        try {
            const features_arr_cli = features_arg_cli.trim().split(',').map(n_str => {
                const num = Number(n_str);
                if (isNaN(num)) {
                    throw new Error(`Invalid feature value: "${n_str}". Features must be numbers.`);
                }
                return num;
            });
            let result = cli_classifier_instance.classify(features_arr_cli);
            console.log('CLI Result:', JSON.stringify(result, null, 2));
        } catch (e) {
            console.error('CLI Error during classification:', e.message);
            process.exit(1);
        }
    }).catch(err => {
        console.error('CLI: Failed to initialize classifier', err);
        process.exit(1);
    });
}

// --- Export for use as a module ---
module.exports = EdgeImpulseClassifier; // 確保這是檔案的最後一行主要邏輯 (除了註解)
