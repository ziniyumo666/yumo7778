// Load the inferencing WebAssembly module
const Module = require('./edge-impulse-standalone');
const fs = require('fs'); // 確保 fs 被引入

// Classifier module
let classifierInitialized = false;
Module.onRuntimeInitialized = function() {
    classifierInitialized = true;
};

class EdgeImpulseClassifier {
    _initialized = false;

    init() {
        if (classifierInitialized === true && Module.isInitialized) { // 加上 Module.isInitialized 檢查
             // 如果 Module 已經通過 onRuntimeInitialized 回調並且內部也初始化了
            if (!this._initialized && typeof Module.init === 'function') {
                Module.init(); // 確保如果 Module 有自己的 init 也被調用
                this._initialized = true;
            }
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            Module.onRuntimeInitialized = () => {
                classifierInitialized = true; // 全局標記
                if (typeof Module.init === 'function') {
                    Module.init(); // Edge Impulse WASM 模塊的初始化函數
                }
                this._initialized = true; // 實例標記
                resolve();
            };
            // 如果 Module 已經提前初始化了但我們的回調錯過了 (不太可能，但作為防禦)
            if (Module.isInitialized && !classifierInitialized) {
                 Module.onRuntimeInitialized();
            }
        });
    }

    getProjectInfo() {
        if (!this._initialized || !classifierInitialized) throw new Error('Module is not initialized'); // 檢查實例和全局初始化
        return this._convertToOrdinaryJsObject(Module.get_project(), Module.emcc_classification_project_t.prototype);
    }

    classify(rawData, debug = false) {
        if (!this._initialized || !classifierInitialized) throw new Error('Module is not initialized');

        const obj = this._arrayToHeap(rawData);
        let ret = Module.run_classifier(obj.buffer.byteOffset, rawData.length, debug);
        Module._free(obj.ptr);

        if (ret.result !== 0) {
            throw new Error('Classification failed (err code: ' + ret.result + ')');
        }

        return this._fillResultStruct(ret);
    }

    classifyContinuous(rawData, enablePerfCal = true) {
        if (!this._initialized || !classifierInitialized) throw new Error('Module is not initialized');

        const obj = this._arrayToHeap(rawData);
        let ret = Module.run_classifier_continuous(obj.buffer.byteOffset, rawData.length, false, enablePerfCal);
        Module._free(obj.ptr);

        if (ret.result !== 0) {
            throw new Error('Classification failed (err code: ' + ret.result + ')');
        }

        return this._fillResultStruct(ret);
    }

    getProperties() {
        if (!this._initialized || !classifierInitialized) throw new Error('Module is not initialized');
        return this._convertToOrdinaryJsObject(Module.get_properties(), Module.emcc_classification_properties_t.prototype);
    }

    setThreshold(obj) {
        if (!this._initialized || !classifierInitialized) throw new Error('Module is not initialized'); // 添加初始化檢查
        const ret = Module.set_threshold(obj);
        if (!ret.success) {
            throw new Error(ret.error);
        }
    }

    _arrayToHeap(data) {
        let typedArray = new Float32Array(data);
        let numBytes = typedArray.length * typedArray.BYTES_PER_ELEMENT;
        let ptr = Module._malloc(numBytes);
        let heapBytes = new Uint8Array(Module.HEAPU8.buffer, ptr, numBytes);
        heapBytes.set(new Uint8Array(typedArray.buffer));
        return { ptr: ptr, buffer: heapBytes };
    }

    _convertToOrdinaryJsObject(emboundObj, prototype) {
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
        if (!this._initialized || !classifierInitialized) throw new Error('Module is not initialized'); // 添加初始化檢查
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
            c.delete();
        }

        if (props.has_object_tracking) {
            jsResult.object_tracking_results = [];
            for (let cx = 0; cx < ret.object_tracking_size(); cx++) {
                let c = ret.object_tracking_get(cx);
                jsResult.object_tracking_results.push({ object_id: c.object_id, label: c.label, value: c.value, x: c.x, y: c.y, width: c.width, height: c.height });
                c.delete();
            }
        }

        if (props.has_visual_anomaly_detection) {
            jsResult.visual_ad_max = ret.visual_ad_max;
            jsResult.visual_ad_mean = ret.visual_ad_mean;
            jsResult.visual_ad_grid_cells = [];
            for (let cx = 0; cx < ret.visual_ad_grid_cells_size(); cx++) {
                let c = ret.visual_ad_grid_cells_get(cx);
                jsResult.visual_ad_grid_cells.push({ label: c.label, value: c.value, x: c.x, y: c.y, width: c.width, height: c.height });
                c.delete();
            }
        }

        ret.delete();

        return jsResult;
    }
}

// 僅當此文件作為主腳本直接執行時，才運行以下命令列邏輯
if (require.main === module) {
    if (!process.argv[2]) {
        console.error('Requires one parameter (a comma-separated list of raw features, or a file pointing at raw features)');
        process.exit(1); // 在命令列模式下，如果參數不足則退出
    }

    let features = process.argv[2];
    if (fs.existsSync(features)) {
        features = fs.readFileSync(features, 'utf-8');
    }

    // Initialize the classifier, and invoke with the argument passed in
    let cliClassifier = new EdgeImpulseClassifier(); // 改個名字以避免與類名混淆
    cliClassifier.init().then(async () => {
        let project = cliClassifier.getProjectInfo();
        console.log('Running inference for', project.owner + ' / ' + project.name + ' (version ' + project.deploy_version + ')');

        let result = cliClassifier.classify(features.trim().split(',').map(n => Number(n)));

        console.log(result);
    }).catch(err => {
        console.error('Failed to initialize classifier for CLI:', err); // 添加更明確的錯誤訊息
        process.exit(1); // 在命令列模式下，初始化失敗則退出
    });
}

// 無論如何，都導出 EdgeImpulseClassifier 類，供其他模組 require 使用
module.exports = EdgeImpulseClassifier;
