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
const logs = [];

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'ray2017good@gmail.com', // 請替換成您的 Gmail 帳號
    pass: 'piimtgblngmbojrv' // 請替換成您的 Gmail 應用程式密碼
  }
});

// Global variable for the loaded model
let model;
// Define model path and class names (Adjust CLASS_NAMES according to your model)
const MODEL_PATH = `file://${path.join(__dirname, 'public', 'model', 'model.json')}`;
const CLASS_NAMES = ['fall_down', 'dangerous_actions', 'look_around', 'shake_hands', 'sitting_still']; // MODIFY THIS ARRAY with your actual class names in order

// Function to load the TensorFlow.js model
async function loadModel() {
  try {
    model = await tf.loadLayersModel(MODEL_PATH);
    console.log('🤖 TensorFlow.js Model loaded successfully from', MODEL_PATH);
    // Optional: Warm up the model for faster first inference
    const warmupResult = model.predict(tf.zeros([1, 128, 128, 3]));
    if (warmupResult instanceof tf.Tensor) {
        await warmupResult.data(); // Ensure data is synced
        warmupResult.dispose();
    } else if (Array.isArray(warmupResult)) {
        for (const t of warmupResult) {
            await t.data();
            t.dispose();
        }
    }
    console.log('🤖 Model warmed up.');
  } catch (err) {
    console.error('❌ Failed to load TensorFlow.js model:', err);
    // If the model fails to load, the server will still run but inference will fail.
  }
}

// Load the model on server startup
loadModel();

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

  if (!model) {
    console.error('❌ Model not loaded yet or failed to load.');
    fs.writeFileSync(inferenceLogPath, JSON.stringify({ label: '-', value: 0, error: 'Model not loaded' }));
    return res.status(500).send('Image uploaded, but model not available for inference.');
  }

  let imageTensor;
  try {
    const img = await loadImage(imagePath); // Use canvas.loadImage
    const MODEL_WIDTH = 128; // Model expects 128x128
    const MODEL_HEIGHT = 128;

    const canvas = createCanvas(MODEL_WIDTH, MODEL_HEIGHT);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, MODEL_WIDTH, MODEL_HEIGHT);
    const imageData = ctx.getImageData(0, 0, MODEL_WIDTH, MODEL_HEIGHT);

    // Convert image data to Float32Array and then to tensor
    // Normalizing to [0, 1]
    const numPixels = MODEL_WIDTH * MODEL_HEIGHT;
    const values = new Float32Array(numPixels * 3);
    for (let i = 0; i < numPixels; i++) {
      values[i * 3] = imageData.data[i * 4] / 255;
      values[i * 3 + 1] = imageData.data[i * 4 + 1] / 255;
      values[i * 3 + 2] = imageData.data[i * 4 + 2] / 255;
    }

    imageTensor = tf.tensor4d(values, [1, MODEL_HEIGHT, MODEL_WIDTH, 3]);
    
    console.log('🔎 Image preprocessed, tensor shape:', imageTensor.shape);

    const predictions = model.predict(imageTensor);
    const probabilities = await predictions.data(); // This is a Float32Array or similar

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

    console.log(`📊 推論結果：Label: ${predictedLabel}, Confidence: ${confidenceValue.toFixed(4)}`);
    fs.writeFileSync(inferenceLogPath, JSON.stringify({ label: predictedLabel, value: confidenceValue }));

    // Dispose tensors
    imageTensor.dispose();
    if (predictions instanceof tf.Tensor) {
      predictions.dispose();
    } else if (Array.isArray(predictions)) {
      predictions.forEach(t => t.dispose());
    }
    res.send('Image uploaded and processed with TFJS model.');

  } catch (err) {
    console.error('❌ 圖片處理或TFJS推論錯誤：', err);
    fs.writeFileSync(inferenceLogPath, JSON.stringify({ label: '-', value: 0, error: err.message || 'Inference failed' }));
    if (imageTensor) imageTensor.dispose(); // Ensure tensor is disposed on error
    res.status(500).send('Error processing image with TFJS model.');
  }
});

app.post('/upload', (req, res) => {
  const { event } = req.body;
  const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  logs.push({ event, time });
  if (logs.length > 20) logs.shift();

  console.log("📥 收到傾倒事件：", event, time);

  const mailOptions = {
    from: 'ray2017good@gmail.com', // 請替換成您的 Gmail 帳號
    to: ['siniyumo666@gmail.com', 'jirui950623@gmail.com'], // 收件人郵箱
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

// This endpoint might not be needed if client directly triggers server-side inference via /upload-image
app.post('/predict-result', (req, res) => {
  const { result, confidence } = req.body; // This endpoint was for client-side model results
  const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  console.log(`🤖 (Client-side)收到模型預測：${result}, 信心值：${confidence} @ ${time}`);
  // Decide if you still need to email this or if server-side inference email is sufficient
  res.send('Result received.');
});

app.get('/latest-image-info', (req, res) => {
  const logPath = path.join(__dirname, 'public', 'log.txt');
  if (!fs.existsSync(logPath)) {
    return res.status(404).json({ error: '尚未上傳圖片' });
  }
  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  const latest = lines.pop() || '無紀錄'; // Get the last line
  res.json({ timestamp: latest });
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
    res.status(500).json({ label: '-', value: 0, error: 'Could not read inference log' });
  }
});

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log('🚀 Server is running on port ' + (process.env.PORT || 3000));
});
