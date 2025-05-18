// server.js
const express = require('express');
const bodyParser = require('body-parser');
// const multer = require('multer'); // Multer is not used for raw image upload in this setup
const fs = require('fs');
const path = require('path');
// const jpeg = require('jpeg-js'); // Not directly used for model inference here
const nodemailer = require('nodemailer');
const { createCanvas, loadImage } = require('canvas');
const tf = require('@tensorflow/tfjs-node'); // Added for TensorFlow.js

const app = express();
const logs = []; // For the /logs endpoint

// Nodemailer transporter setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'ray2017good@gmail.com', // 請替換成您的 Gmail 帳號
    pass: 'piimtgblngmbojrv'       // 請替換成您的 Gmail 應用程式密碼
  }
});

// Global variable for the loaded TensorFlow.js model
let model;
// Define model path and class names
// 【重要】確保您的模型文件 'model.json' 和對應的權重文件位於 'public/model/' 目錄下
const MODEL_PATH = `file://${path.join(__dirname, 'public', 'model', 'model.json')}`;
// 【重要】請根據您訓練模型時的類別順序和名稱修改此陣列
const CLASS_NAMES = ['1', '2', '3', '4', '5']; // 例如: ['OK', 'Peace', 'Fist', 'One', 'Palm']

// Function to load the TensorFlow.js model
async function loadModel() {
  try {
    console.log(`⏳ 正在從 ${MODEL_PATH} 載入 TensorFlow.js 模型...`);
    model = await tf.loadLayersModel(MODEL_PATH);
    console.log('✅ TensorFlow.js 模型載入成功！');

    // 可選: 模型預熱，以加快首次推論速度
    console.log('🔥 正在預熱模型...');
    const MODEL_WIDTH = 128; // 與模型訓練時的輸入寬度一致
    const MODEL_HEIGHT = 128; // 與模型訓練時的輸入高度一致
    const warmupTensor = tf.zeros([1, MODEL_HEIGHT, MODEL_WIDTH, 3]); // 批次大小為1
    const warmupResult = model.predict(warmupTensor);

    // 確保預熱結果的張量被處理和釋放
    if (warmupResult instanceof tf.Tensor) {
        await warmupResult.data(); // 等待數據同步
        warmupResult.dispose();    // 釋放張量
    } else if (Array.isArray(warmupResult)) { // 如果模型輸出是多個張量
        for (const t of warmupResult) {
            await t.data();
            t.dispose();
        }
    }
    warmupTensor.dispose(); // 釋放預熱輸入張量
    console.log('👍 模型預熱完成。');

  } catch (err) {
    console.error('❌ 載入 TensorFlow.js 模型失敗:', err);
    // 如果模型載入失敗，伺服器仍會運行，但推論會失敗。
  }
}

// 在伺服器啟動時載入模型
loadModel();

app.use(bodyParser.json({ limit: '5mb' })); // 增加 JSON body 的大小限制
app.use(express.static('public'));

// 處理原始圖像數據 (例如來自 ESP32-CAM 的 JPEG stream)
app.post('/upload-image', express.raw({ type: 'image/jpeg', limit: '10mb' }), async (req, res) => {
  const imagePath = path.join(__dirname, 'public', 'latest.jpg');
  const logPath = path.join(__dirname, 'public', 'log.txt');
  const inferenceLogPath = path.join(__dirname, 'public', 'inference-log.json');
  const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });

  try {
    fs.writeFileSync(imagePath, req.body);
    const logLine = `📸 圖片上傳成功：${time}\n`;
    fs.appendFileSync(logPath, logLine);
    console.log(logLine.trim());

    if (!model) {
      console.error('❌ 模型尚未載入或載入失敗。');
      fs.writeFileSync(inferenceLogPath, JSON.stringify({ label: '-', value: 0, error: 'Model not loaded' }));
      return res.status(500).send('Image uploaded, but model not available for inference.');
    }

    let imageTensor;
    try {
      const img = await loadImage(imagePath); // 使用 canvas.loadImage 載入保存的圖片
      const TARGET_WIDTH = 128; // 模型期望的輸入寬度
      const TARGET_HEIGHT = 128; // 模型期望的輸入高度

      const canvas = createCanvas(TARGET_WIDTH, TARGET_HEIGHT);
      const ctx = canvas.getContext('2d');

      // 計算保持長寬比縮放後的尺寸和繪製位置
      const originalWidth = img.width;
      const originalHeight = img.height;
      const aspectRatio = originalWidth / originalHeight;
      let newWidth, newHeight, offsetX, offsetY;

      if (aspectRatio > TARGET_WIDTH / TARGET_HEIGHT) { // 圖像比目標更寬
        newWidth = TARGET_WIDTH;
        newHeight = TARGET_WIDTH / aspectRatio;
        offsetX = 0;
        offsetY = (TARGET_HEIGHT - newHeight) / 2;
      } else { // 圖像比目標更高或長寬比相同
        newHeight = TARGET_HEIGHT;
        newWidth = TARGET_HEIGHT * aspectRatio;
        offsetY = 0;
        offsetX = (TARGET_WIDTH - newWidth) / 2;
      }
      
      ctx.fillStyle = 'black'; // 填充背景色
      ctx.fillRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
      ctx.drawImage(img, offsetX, offsetY, newWidth, newHeight); // 繪製縮放後的圖像
      
      const imageData = ctx.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT);

      // 將圖像數據轉換為 Float32Array 並標準化到 [-1, 1]
      const numPixels = TARGET_WIDTH * TARGET_HEIGHT;
      const values = new Float32Array(numPixels * 3);
      for (let i = 0; i < numPixels; i++) {
        values[i * 3]     = (imageData.data[i * 4] / 127.5) - 1;     // R
        values[i * 3 + 1] = (imageData.data[i * 4 + 1] / 127.5) - 1; // G
        values[i * 3 + 2] = (imageData.data[i * 4 + 2] / 127.5) - 1; // B
      }

      imageTensor = tf.tensor4d(values, [1, TARGET_HEIGHT, TARGET_WIDTH, 3]);
      console.log('🔎 圖像預處理完成，張量形狀:', imageTensor.shape);

      // 使用您的 TensorFlow.js 模型進行推論
      const predictions = model.predict(imageTensor);
      const probabilities = await predictions.data(); // 獲取機率數組

      let maxProb = 0;
      let maxIndex = -1;
      for (let i = 0; i < probabilities.length; i++) {
        if (probabilities[i] > maxProb) {
          maxProb = probabilities[i];
          maxIndex = i;
        }
      }

      const predictedLabel = (maxIndex !== -1 && maxIndex < CLASS_NAMES.length) ? CLASS_NAMES[maxIndex] : 'Unknown';
      const confidenceValue = maxProb;

      const predictionLog = `📊 推論結果：標籤: ${predictedLabel}, 信心度: ${confidenceValue.toFixed(4)}`;
      console.log(predictionLog);
      fs.appendFileSync(logPath, predictionLog + ` @ ${time}\n`); // 也記錄到 log.txt
      fs.writeFileSync(inferenceLogPath, JSON.stringify({ label: predictedLabel, value: confidenceValue, timestamp: time }));

      // 釋放張量以避免內存洩漏
      imageTensor.dispose();
      if (predictions instanceof tf.Tensor) { // 如果 predict 返回單個張量
        predictions.dispose();
      } else if (Array.isArray(predictions)) { // 如果 predict 返回張量數組
        predictions.forEach(t => t.dispose());
      }
      
      res.status(200).json({ label: predictedLabel, value: confidenceValue, timestamp: time });

    } catch (err) {
      console.error('❌ 圖像處理或TFJS推論錯誤：', err);
      fs.writeFileSync(inferenceLogPath, JSON.stringify({ label: '-', value: 0, error: err.message || 'Inference failed', timestamp: time }));
      if (imageTensor) imageTensor.dispose();
      res.status(500).json({ error: 'Error processing image with TFJS model.' });
    }
  } catch (writeError) {
    console.error('❌ 寫入圖像文件失敗:', writeError);
    res.status(500).json({ error: 'Failed to save uploaded image.' });
  }
});

// 用於接收傾倒事件並發送郵件
app.post('/upload', (req, res) => {
  const { event } = req.body;
  const currentTime = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  logs.push({ event, time: currentTime });
  if (logs.length > 20) logs.shift();

  console.log("📥 收到傾倒事件：", event, currentTime);

  const mailOptions = {
    from: 'ray2017good@gmail.com',
    to: ['siniyumo666@gmail.com', 'jirui950623@gmail.com'],
    subject: `📡 傾倒事件通知`,
    text: `偵測到事件：「${event}」\n發生時間：${currentTime}`
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("❌ 發信失敗（傾倒事件）：", error);
    } else {
      console.log("✅ 傾倒事件郵件發信成功：" + info.response);
    }
  });
  res.send('OK');
});

// 用於接收客戶端（例如 ESP32-CAM 本地推論後）的預測結果並發送郵件
app.post('/predict-result', (req, res) => {
  const { result, confidence } = req.body;
  const currentTime = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  console.log(`🤖 (Client-side) 收到模型預測：${result}, 信心值：${confidence} @ ${currentTime}`);

  const mailOptions = {
    from: 'ray2017good@gmail.com',
    to: ['siniyumo666@gmail.com', 'jirui950623@gmail.com'],
    subject: `🤳 ESP32-CAM 模型辨識結果`,
    text: `ESP32-CAM 辨識到手勢：「${result}」\n信心值：${confidence}\n時間：${currentTime}`
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("❌ 發信失敗（客戶端預測）：", error);
    } else {
      console.log("✅ 客戶端預測郵件發信成功：" + info.response);
    }
  });
  res.send('Result received and email sent.');
});

app.get('/latest-image-info', (req, res) => {
  const logPath = path.join(__dirname, 'public', 'log.txt');
  if (!fs.existsSync(logPath)) {
    return res.status(404).json({ error: '尚未上傳圖片' });
  }
  try {
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    const latest = lines.pop() || '無紀錄';
    res.json({ timestamp: latest });
  } catch (err) {
    console.error("❌ 讀取 log.txt 失敗:", err);
    res.status(500).json({ error: 'Could not read image log' });
  }
});

app.get('/logs', (req, res) => {
  res.json(logs);
});

app.get('/inference-log.json', (req, res) => {
  const inferenceLogPath = path.join(__dirname, 'public', 'inference-log.json');
  if (!fs.existsSync(inferenceLogPath)) {
    return res.status(404).json({ label: '-', value: 0, error: 'No inference log found' });
  }
  try {
    const data = fs.readFileSync(inferenceLogPath, 'utf8');
    res.setHeader('Content-Type', 'application/json');
    res.send(data);
  } catch (err) {
    console.error("❌ 讀取 inference-log.json 失敗:", err);
    res.status(500).json({ label: '-', value: 0, error: 'Could not read inference log' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
