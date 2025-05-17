const EdgeImpulseClassifier = require('./ei_model/run-impulse'); // 確認路徑正確
const fs = require('fs');

// 替換為您日誌中實際不同的 input 數據 (前幾個元素示意，您需要完整的 27648 個元素)
// 為了簡化，這裡只用長度為 10 的示意數據，您需要使用完整長度
// 並確保 rawData1 和 rawData2 的內容有顯著差異
const rawData1_part = [
    0.38823529411764707, 0.49411764705882355, 0.4549019607843137, 0.396078431372549,
    0.5058823529411764, 0.4588235294117647, 0.396078431372549, 0.5058823529411764,
    0.4470588235294118, 0.3843137254901961
];
const rawData2_part = [
    0.27450980392156865, 0.3686274509803922, 0.3333333333333333, 0.2823529411764706,
    0.37254901960784315, 0.33725490196078434, 0.28627450980392155, 0.3764705882352941,
    0.3411764705882353, 0.28627450980392155
];

// 產生完整的 27648 個元素的數據 (這裡用重複的方式示意，真實測試請用您 log 中的數據)
function generateFullData(partialData, targetLength = 27648) {
    const fullData = [];
    for (let i = 0; i < targetLength; i++) {
        fullData.push(partialData[i % partialData.length] + (Math.random() - 0.5) * 0.01); // 加一點隨機性
    }
    return fullData;
}

const rawData1 = generateFullData(rawData1_part);
const rawData2 = generateFullData(rawData2_part);


async function runTest() {
    console.log('Initializing classifier...');
    const classifier = new EdgeImpulseClassifier();
    await classifier.init();
    console.log('Classifier initialized.');

    let project = classifier.getProjectInfo();
    console.log('Project info:', project.owner + ' / ' + project.name + ' (version ' + project.deploy_version + ')');
    // 根據您的 log，input_width 和 input_height 應該是 96x96x3 = 27648
    console.log(`Expected features: ${project.image_input_width * project.image_input_height * project.image_channels} (from project info)`);


    console.log('\nClassifying data 1...');
    const result1 = await classifier.classify(rawData1);
    console.log('Result 1:', JSON.stringify(result1, null, 2));

    console.log('\nClassifying data 2 (should be different)...');
    const result2 = await classifier.classify(rawData2);
    console.log('Result 2:', JSON.stringify(result2, null, 2));

    if (JSON.stringify(result1.results) === JSON.stringify(result2.results)) {
        console.error('\n🚨 ERROR: Results are identical for different inputs!');
    } else {
        console.log('\n✅ SUCCESS: Results are different for different inputs.');
    }
}

runTest().catch(err => {
    console.error('Test failed:', err);
});