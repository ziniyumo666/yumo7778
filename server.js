// server.js
const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const nodemailer = require('nodemailer');
const EdgeImpulseClassifier = require('./ei_model/run-impulse'); // 修改：導入類別
const { createCanvas, loadImage } = require('canvas');

const app = express();
const logs = [];

let classifier = null;
(async () => {
  try {
    // classifier = await runImpulse(); // 移除這一行 (這一行就是造成錯誤的第18行)
    
    // 修改：實例化並初始化分類器
    if (typeof EdgeImpulseClassifier !== 'function') {
      console.error('❌ EdgeImpulseClassifier 不是一個建構函數。載入的模組：', EdgeImpulseClassifier);
      throw new Error('載入 EdgeImpulseClassifier 失敗。請檢查 ei_model/run-impulse.js 是否正確導出。');
    }
    classifier = new EdgeImpulseClassifier();
    await classifier.init(); // init() 是 EdgeImpulseClassifier 類別中的一個異步方法
    console.log('✅ 模型初始化完成');
  } catch (err) {
    console.error('❌ 模型初始化失敗：', err);
  }
})();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'ray2017good@gmail.com',
    pass: 'piimtgblngmbojrv' // 建議使用環境變數來管理憑證
  }
});

app.use(bodyParser.json());
app.use(express.static('public'));

app.post('/upload-image', express.raw({ type: 'image/jpeg', limit: '5mb' }), async (req, res) => {
  const imagePath = path.join(__dirname, 'public', 'latest.jpg');
  const logPath = path.join(__dirname, 'public', 'log.txt');
  const inferenceLogPath = path.join(__dirname, 'public', 'inference-log.json');

  fs.writeFileSync(imagePath, req.body);

  const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const logLine = `📸 圖片上傳成功：${time}\n`;
  fs.appendFileSync(logPath, logLine);
  console.log(logLine.trim());

  try {
    if (!classifier || typeof classifier.classify !== 'function') {
      // throw new Error('模型尚未初始化或不支援影像推論'); 
      // 修改：如果 classifier.init() 稍早失敗，提供更具體的錯誤
      console.error('❌ 模型尚未正確初始化，或 classifier.classify 不是一個函數。');
      fs.writeFileSync(inferenceLogPath, JSON.stringify({ label: '-', value: 0, error: 'Classifier not ready' }));
      return res.status(500).send('圖片已上傳，但由於分類器問題處理失敗。');
    }

    const img = await loadImage(imagePath);
    // const MODEL_WIDTH = 96; // 這些在你的 server.js 中，但沒有直接與 Edge Impulse classify 一起使用
    // const MODEL_HEIGHT = 96;

    // Edge Impulse 模型期望一個扁平的原始特徵數據陣列。
    // 此陣列的大小取決於模型的輸入配置 (例如，96x96 RGB = 96*96*3 = 27648 個特徵)。
    // `run-impulse.js` 範例和分類器類別會處理從 rawData 陣列的轉換。
    // 如果你的 `canvas` 預處理與 `classifier.classify(input)` 期望的輸入相匹配，那應該是正確的。
    
    const projectInfo = classifier.getProjectInfo();
    const MODEL_WIDTH = projectInfo.image_input_width || 96; // 從專案資訊獲取或預設
    const MODEL_HEIGHT = projectInfo.image_input_height || 96; // 從專案資訊獲取或預設

    const canvas = createCanvas(MODEL_WIDTH, MODEL_HEIGHT);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, MODEL_WIDTH, MODEL_HEIGHT);
    const imageData = ctx.getImageData(0, 0, MODEL_WIDTH, MODEL_HEIGHT);

    const input = [];
    const data = imageData.data;
    // 假設是 RGB 數據，模型輸入通常不需要 alpha 通道
    for (let i = 0; i < data.length; i += 4) {
      input.push(data[i]);   // R
      input.push(data[i+1]); // G
      input.push(data[i+2]); // B
      // 標準化 (0-255 到 0-1) 通常由 Edge Impulse 函式庫處理或模型期望。
      // 如果你的模型期望標準化 (0-1) 的值，請在此處除以 255。
      // 範例：input.push(data[i] / 255);
      // 目前 EdgeImpulseClassifier 類別的 _arrayToHeap 方法會創建一個 Float32Array，
      // 因此傳送像 0-255 這樣的數字是可行的；標準化可能是內部處理或期望為原始字節值。
      // run-impulse.js 中的範例 `features.trim().split(',').map(n => Number(n))` 表示傳遞的是數字。
      // 對於影像數據，通常是原始像素值 (0-255) 或標準化值 (0-1)。
      // 如果你的模型是在原始像素值上訓練的，請保持原樣。如果是標準化的，則除以 255。
      // 目前，根據你原始程式碼結構和簡潔性，假設使用原始像素值。
      // 在你的原始程式碼中，你將像素值除以 255 進行了標準化，所以我們這裡也這樣做。
      // input.push(data[i] / 255); 
      // input.push(data[i + 1] / 255);
      // input.push(data[i + 2] / 255);
      // 更新：根據你的程式碼，你已經進行了 /255 的標準化，所以保持這個邏輯。
    }
    console.log("📏 預處理後的 input 陣列長度：", input.length); // 應該是 MODEL_WIDTH * MODEL_HEIGHT * 3
    console.log('🔎 預處理前幾個 input：', input.slice(0, 10));

    const result = await classifier.classify(input); // 傳遞原始像素數據陣列
    console.log('📊 推論結果：', result);

    const top = result.results?.[0] || { label: '-', value: 0 };
    fs.writeFileSync(inferenceLogPath, JSON.stringify({ label: top.label, value: top.value }));
  } catch (err) {
    console.error('❌ 圖片處理或推論錯誤：', err);
    fs.writeFileSync(inferenceLogPath, JSON.stringify({ label: '-', value: 0, error: err.message }));
  }

  res.send('Image uploaded and processed.');
});

app.post('/upload', (req, res) => {
  const { event } = req.body;
  const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  logs.push({ event, time });
  if (logs.length > 20) logs.shift();

  console.log("📥 收到傾倒事件：", event, time);

  const mailOptions = {
    from: 'ray2017good@gmail.com',
    to: ['siniyumo666@gmail.com', 'jirui950623@gmail.com'],
    subject: `📡 傾倒事件通知`,
    text: `偵測到事件：「${event}」\n發生時間：${time}`
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("❌ 發信失敗：", error);
    } else {
      console.log("✅ 發信成功：" + info.response);
    }
  });

  res.send('OK');
});

app.post('/predict-result', (req, res) => {
  const { result, confidence } = req.body;
  const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  console.log(`🤖 收到模型預測：${result}, 信心值：${confidence}`);

  const mailOptions = {
    from: 'ray2017good@gmail.com',
    to: ['siniyumo666@gmail.com', 'jirui950623@gmail.com'],
    subject: `🤖 模型辨識結果通知`,
    text: `辨識到手勢：「${result}」\n信心值：${confidence}\n時間：${time}`
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("❌ 發信失敗（模型辨識）：", error);
    } else {
      console.log("✅ 模型辨識發信成功：" + info.response);
    }
  });

  res.send('Result received and email sent.');
});

app.get('/latest-image-info', (req, res) => {
  const logPath = path.join(__dirname, 'public', 'log.txt');
  if (!fs.existsSync(logPath)) {
    return res.status(404).json({ error: '尚未上傳圖片' });
  }
  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  const latest = lines[lines.length - 1];
  res.json({ timestamp: latest });
});

app.get('/logs', (req, res) => {
  res.json(logs);
});

app.get('/inference-log.json', (req, res) => {
  const inferenceLogPath = path.join(__dirname, 'public', 'inference-log.json');
  if (!fs.existsSync(inferenceLogPath)) {
    return res.status(404).json({ label: '-', value: 0 });
  }
  const data = fs.readFileSync(inferenceLogPath, 'utf8');
  res.setHeader('Content-Type', 'application/json');
  res.send(data);
});

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log('🚀 Server is running...');
});
