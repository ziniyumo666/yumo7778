// server.js
const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { createCanvas, loadImage } = require('canvas');
const runImpulse = require('./ei_model/run-impulse');

const app = express();
const logs = [];

const MODEL_WIDTH = 96;
const MODEL_HEIGHT = 96;

let classifier = null;

// 初始化模型
(async () => {
  try {
    classifier = await runImpulse();
    console.log('✅ 模型初始化完成');
  } catch (err) {
    console.error('❌ 模型初始化失敗：', err);
  }
})();

// 寄信設定
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'ray2017good@gmail.com',
    pass: 'piimtgblngmbojrv'
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
  fs.appendFileSync(logPath, `📸 圖片上傳成功：${time}\n`);
  console.log(`📸 圖片上傳成功：${time}`);

  try {
    if (!classifier || typeof classifier.classify !== 'function') throw new Error('模型尚未初始化');

    const img = await loadImage(imagePath);
    const canvas = createCanvas(MODEL_WIDTH, MODEL_HEIGHT);
    const ctx = canvas.getContext('2d');

    // ⬇️ 等比例縮放與置中
    const ratio = Math.max(MODEL_WIDTH / img.width, MODEL_HEIGHT / img.height);
    const x = (MODEL_WIDTH - img.width * ratio) / 2;
    const y = (MODEL_HEIGHT - img.height * ratio) / 2;

    ctx.fillStyle = '#000'; // 填黑背景
    ctx.fillRect(0, 0, MODEL_WIDTH, MODEL_HEIGHT);
    ctx.drawImage(img, x, y, img.width * ratio, img.height * ratio);

    const { data } = ctx.getImageData(0, 0, MODEL_WIDTH, MODEL_HEIGHT);

    const input = [];
    for (let i = 0; i < data.length; i += 4) {
      input.push(data[i] / 255);     // R
      input.push(data[i + 1] / 255); // G
      input.push(data[i + 2] / 255); // B
    }

    console.log("🔎 預處理前幾個 input：", input.slice(0, 10));
    const result = classifier.classify(input);
    console.log("📊 推論結果：", result);

    const top = result.results?.reduce((a, b) => (a.value > b.value ? a : b), { label: '-', value: 0 }) || { label: '-', value: 0 };
    fs.writeFileSync(inferenceLogPath, JSON.stringify(top));
  } catch (err) {
    console.error("❌ 圖片處理錯誤：", err);
    fs.writeFileSync(path.join(__dirname, 'public', 'inference-log.json'), JSON.stringify({ label: '-', value: 0 }));
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
    subject: '📡 傾倒事件通知',
    text: `偵測到事件：「${event}」\n發生時間：${time}`
  };

  transporter.sendMail(mailOptions, (err, info) => {
    if (err) return console.error("❌ 發信失敗：", err);
    console.log("✅ 發信成功：" + info.response);
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
    subject: '🤖 模型辨識結果通知',
    text: `辨識到手勢：「${result}」\n信心值：${confidence}\n時間：${time}`
  };

  transporter.sendMail(mailOptions, (err, info) => {
    if (err) return console.error("❌ 發信失敗（模型辨識）：", err);
    console.log("✅ 模型辨識發信成功：" + info.response);
  });

  res.send('Result received and email sent.');
});

app.get('/logs', (req, res) => {
  res.json(logs);
});

app.get('/latest-image-info', (req, res) => {
  const logPath = path.join(__dirname, 'public', 'log.txt');
  if (!fs.existsSync(logPath)) return res.status(404).json({ error: '尚未上傳圖片' });
  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  res.json({ timestamp: lines[lines.length - 1] });
});

app.get('/inference-log.json', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'inference-log.json');
  if (!fs.existsSync(filePath)) return res.status(404).json({ label: '-', value: 0 });
  res.sendFile(filePath);
});

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log('🚀 Server is running...');
});

