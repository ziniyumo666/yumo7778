// server.js
const express = require('express');
const bodyParser = require('body-parser');
// const multer = require('multer'); // multer 在此版本中未使用，可以移除或註解掉
const fs = require('fs');
const path = require('path');
// const jpeg = require('jpeg-js'); // jpeg-js 在此版本中未使用，可以移除或註解掉
const nodemailer = require('nodemailer');
const EdgeImpulseClassifier = require('./ei_model/run-impulse'); // 修改：導入類別
const { createCanvas, loadImage } = require('canvas');

const app = express();
const logs = []; // 用於儲存傾倒事件日誌

// 全局分類器實例 - 注意：在診斷版本中，我們會在路由內部創建臨時實例
// let classifier = null;
// (async () => {
//   try {
//     if (typeof EdgeImpulseClassifier !== 'function') {
//       console.error('❌ EdgeImpulseClassifier 不是一個建構函數。載入的模組：', EdgeImpulseClassifier);
//       throw new Error('載入 EdgeImpulseClassifier 失敗。請檢查 ei_model/run-impulse.js 是否正確導出。');
//     }
//     classifier = new EdgeImpulseClassifier();
//     await classifier.init(); // init() 是 EdgeImpulseClassifier 類別中的一個異步方法
//     console.log('✅ 全局模型初始化完成');
//   } catch (err) {
//     console.error('❌ 全局模型初始化失敗：', err);
//   }
// })();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'ray2017good@gmail.com', // 您的 Gmail 地址
    pass: 'piimtgblngmbojrv'    // 您的 Gmail 應用程式密碼
                                  // 建議使用環境變數來管理憑證
  }
});

app.use(bodyParser.json());
app.use(express.static('public')); // 提供 public 資料夾中的靜態檔案

// 處理圖片上傳和辨識
app.post('/upload-image', express.raw({ type: 'image/jpeg', limit: '5mb' }), async (req, res) => {
  const imagePath = path.join(__dirname, 'public', 'latest.jpg');
  const logPath = path.join(__dirname, 'public', 'log.txt'); // 圖片上傳時間日誌
  const inferenceLogPath = path.join(__dirname, 'public', 'inference-log.json'); // 推論結果日誌

  // 1. 保存上傳的圖片
  try {
    fs.writeFileSync(imagePath, req.body);
  } catch (writeErr) {
    console.error('❌ 保存圖片失敗:', writeErr);
    // 即使保存失敗，也嘗試記錄推論錯誤
    try {
        fs.writeFileSync(inferenceLogPath, JSON.stringify({
            label: '-',
            value: 0,
            error: 'Failed to save image: ' + writeErr.message,
            errorTime: new Date().toISOString()
        }));
    } catch (logErr) {
        console.error('❌ 寫入推論錯誤日誌也失敗:', logErr);
    }
    return res.status(500).send('Error saving image.');
  }


  const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const logLine = `📸 圖片上傳成功：${time}\n`;
  fs.appendFileSync(logPath, logLine);
  console.log(logLine.trim()); // 在伺服器控制台也打印日誌

  // --- 診斷性修改：每次都重新初始化分類器 ---
  let tempClassifier;
  try {
    console.log('🚧 [Diagnostic] Attempting to re-initialize classifier for this request...');
    if (typeof EdgeImpulseClassifier !== 'function') {
      const errMsg = 'EdgeImpulseClassifier is not a constructor.';
      console.error(`❌ ${errMsg} Loaded module:`, EdgeImpulseClassifier);
      throw new Error(errMsg);
    }
    tempClassifier = new EdgeImpulseClassifier();
    await tempClassifier.init();
    console.log('✅ [Diagnostic] Classifier re-initialized successfully for this request.');
  } catch (initErr) {
    console.error('❌ [Diagnostic] 模型為此請求重新初始化失敗：', initErr);
    try {
      fs.writeFileSync(inferenceLogPath, JSON.stringify({
        label: '-',
        value: 0,
        error: 'Classifier re-initialization failed: ' + initErr.message,
        errorTime: new Date().toISOString()
      }));
    } catch (logErr) {
        console.error('❌ 寫入分類器初始化錯誤日誌失敗:', logErr);
    }
    return res.status(500).send('圖片已上傳，但分類器初始化失敗。');
  }
  // --- 診斷性修改結束 ---

  try {
    // 使用臨時（或全局，如果非診斷模式）分類器實例
    if (!tempClassifier || typeof tempClassifier.classify !== 'function') {
      const errMsg = '模型尚未正確初始化，或 classifier.classify 不是一個函數。';
      console.error(`❌ ${errMsg}`);
      fs.writeFileSync(inferenceLogPath, JSON.stringify({
        label: '-',
        value: 0,
        error: 'Classifier not ready or classify is not a function',
        errorTime: new Date().toISOString()
      }));
      return res.status(500).send('圖片已上傳，但由於分類器問題處理失敗。');
    }

    // 2. 載入並預處理圖片
    const img = await loadImage(imagePath);
    
    const projectInfo = tempClassifier.getProjectInfo(); // 使用臨時分類器
    const MODEL_WIDTH = projectInfo.image_input_width || 96;
    const MODEL_HEIGHT = projectInfo.image_input_height || 96;

    const canvas = createCanvas(MODEL_WIDTH, MODEL_HEIGHT);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, MODEL_WIDTH, MODEL_HEIGHT);
    const imageData = ctx.getImageData(0, 0, MODEL_WIDTH, MODEL_HEIGHT);

    const input = [];
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      input.push(data[i] / 255);   // R
      input.push(data[i + 1] / 255); // G
      input.push(data[i + 2] / 255); // B
    }
    console.log(`[${new Date().toLocaleTimeString()}] 📏 預處理後的 input 陣列長度：`, input.length);
    console.log(`[${new Date().toLocaleTimeString()}] 🔎 預處理前幾個 input：`, input.slice(0, 10));

    // 3. 執行辨識
    const result = await tempClassifier.classify(input); // 使用臨時分類器
    console.log(`[${new Date().toLocaleTimeString()}] 📊 推論結果：`, JSON.stringify(result, null, 2));

    if (result && result.results && result.results.length > 0) {
      result.results.sort((a, b) => b.value - a.value); // 降序排序
    }

    const top = result.results?.[0] || { label: '-', value: 0 };

    // 4. 保存辨識結果
    fs.writeFileSync(inferenceLogPath, JSON.stringify({
      label: top.label,
      value: top.value,
      inferenceTime: new Date().toISOString() // 加入推論時間戳
    }));

  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString()}] ❌ 圖片處理或推論錯誤：`, err);
    fs.writeFileSync(inferenceLogPath, JSON.stringify({
      label: '-',
      value: 0,
      error: err.message,
      errorTime: new Date().toISOString() // 加入錯誤時間戳
    }));
    // 根據情況決定是否仍要發送 200 OK，或是一個錯誤狀態碼
    // 如果只是推論失敗，圖片本身可能已上傳，所以還是可以回 200
    // return res.status(500).send('Image processed with error.');
  }

  res.send('Image uploaded and processed.');
});

// 處理傾倒事件（來自PicoW或其他設備）
app.post('/upload', (req, res) => {
  const { event } = req.body;
  const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  logs.push({ event, time });
  if (logs.length > 20) logs.shift(); // 保持最多20條日誌

  console.log(`[${new Date().toLocaleTimeString()}] 📥 收到傾倒事件：`, event, time);

  const mailOptions = {
    from: 'ray2017good@gmail.com',
    to: ['siniyumo666@gmail.com', 'jirui950623@gmail.com'], // 收件人列表
    subject: `📡 傾倒事件通知 (${event})`, // 主旨中加入事件類型
    text: `偵測到事件：「${event}」\n發生時間：${time}`
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ 發信失敗（傾倒事件）：`, error);
    } else {
      console.log(`[${new Date().toLocaleTimeString()}] ✅ 傾倒事件發信成功：` + info.response);
    }
  });

  res.send('OK');
});

// (可選) 處理來自客戶端或其他服務的模型辨識結果通知 (如果有的話)
app.post('/predict-result', (req, res) => {
  const { result, confidence } = req.body;
  const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  console.log(`[${new Date().toLocaleTimeString()}] 🤖 收到模型預測（外部）：${result}, 信心值：${confidence}`);

  const mailOptions = {
    from: 'ray2017good@gmail.com',
    to: ['siniyumo666@gmail.com', 'jirui950623@gmail.com'],
    subject: `🤖 模型辨識結果通知 (外部)`,
    text: `辨識到手勢：「${result}」\n信心值：${confidence}\n時間：${time}`
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ 發信失敗（模型辨識 - 外部）：`, error);
    } else {
      console.log(`[${new Date().toLocaleTimeString()}] ✅ 模型辨識發信成功（外部）：` + info.response);
    }
  });

  res.send('Result received and email sent.');
});


// 提供最新的圖片上傳時間資訊
app.get('/latest-image-info', (req, res) => {
  const logPath = path.join(__dirname, 'public', 'log.txt');
  if (!fs.existsSync(logPath)) {
    return res.status(404).json({ error: '尚未上傳圖片' });
  }
  try {
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    const latest = lines.length > 0 ? lines[lines.length - 1] : '無上傳紀錄';
    res.json({ timestamp: latest });
  } catch (readErr) {
    console.error('❌ 讀取圖片上傳日誌失敗:', readErr);
    res.status(500).json({ error: '無法讀取日誌' });
  }
});

// 提供傾倒事件日誌
app.get('/logs', (req, res) => {
  res.json(logs);
});

// 提供最新的推論結果
app.get('/inference-log.json', (req, res) => {
  const inferenceLogPath = path.join(__dirname, 'public', 'inference-log.json');
  if (!fs.existsSync(inferenceLogPath)) {
    return res.status(404).json({ label: '-', value: 0, error: 'Inference log not found', errorTime: new Date().toISOString() });
  }
  try {
    const data = fs.readFileSync(inferenceLogPath, 'utf8');
    res.setHeader('Content-Type', 'application/json');
    // 強制無快取的標頭
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(data);
  } catch (readErr) {
    console.error('❌ 讀取推論日誌失敗:', readErr);
    res.status(500).json({ label: '-', value: 0, error: 'Failed to read inference log', errorTime: new Date().toISOString() });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server is running on port ${PORT}...`);
  // 應用啟動時，如果 inference-log.json 不存在，可以創建一個初始的
  const inferenceLogPath = path.join(__dirname, 'public', 'inference-log.json');
  if (!fs.existsSync(inferenceLogPath)) {
    try {
        fs.writeFileSync(inferenceLogPath, JSON.stringify({
            label: '-',
            value: 0,
            status: 'Server started, no inference yet.',
            inferenceTime: new Date().toISOString()
        }));
        console.log('ℹ️ Initial inference-log.json created.');
    } catch(initLogErr) {
        console.error('❌ 創建初始 inference-log.json 失敗:', initLogErr);
    }
  }
});
