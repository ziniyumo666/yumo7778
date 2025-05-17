// server.js
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const runImpulse = require('./ei_model/run-impulse');
const { createCanvas, loadImage } = require('canvas');

const app = express();
const logs = [];
let classifier = null;

(async () => {
  try {
    classifier = await runImpulse();
    console.log('✅ 模型初始化完成');
  } catch (err) {
    console.error('❌ 模型初始化失敗：', err);
  }
})();

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
  const logLine = `📸 圖片上傳成功：${time}\n`;
  fs.appendFileSync(logPath, logLine);
  console.log(logLine.trim());

  try {
    if (!classifier || typeof classifier.classify !== 'function') {
      throw new Error('模型尚未初始化或不支援影像推論');
    }

    const img = await loadImage(imagePath);
    const MODEL_WIDTH = 96;
    const MODEL_HEIGHT = 96;

    const canvas = createCanvas(MODEL_WIDTH, MODEL_HEIGHT);
    const ctx = canvas.getContext('2d');

    // ✅ 等比例縮放並置中裁切
    const ratio = Math.max(MODEL_WIDTH / img.width, MODEL_HEIGHT / img.height);
    const x = (MODEL_WIDTH - img.width * ratio) / 2;
    const y = (MODEL_HEIGHT - img.height * ratio) / 2;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, MODEL_WIDTH, MODEL_HEIGHT);
    ctx.drawImage(img, x, y, img.width * ratio, img.height * ratio);

    const imageData = ctx.getImageData(0, 0, MODEL_WIDTH, MODEL_HEIGHT);
    const input = [];
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      // 使用 RGB 模型
      input.push(data[i] / 255);
      input.push(data[i + 1] / 255);
      input.push(data[i + 2] / 255);
    }

    console.log('🔎 預處理前幾個 input：', input.slice(0, 10));

    const result = classifier.classify(input);
    console.log('📊 推論結果：', result);

    const top = result.results?.[0] || { label: '-', value: 0 };
    fs.writeFileSync(inferenceLogPath, JSON.stringify({ label: top.label, value: top.value }));
  } catch (err) {
    console.error('❌ 圖片處理錯誤：', err);
    fs.writeFileSync(inferenceLogPath, JSON.stringify({ label: '-', value: 0 }));
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
    if (error) console.error("❌ 發信失敗：", error);
    else console.log("✅ 發信成功：" + info.response);
  });

  res.send('OK');
});

app.get('/latest-image-info', (req, res) => {
  const logPath = path.join(__dirname, 'public', 'log.txt');
  if (!fs.existsSync(logPath)) return res.status(404).json({ error: '尚未上傳圖片' });
  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  const latest = lines[lines.length - 1];
  res.json({ timestamp: latest });
});

app.get('/logs', (req, res) => {
  res.json(logs);
});

app.get('/inference-log.json', (req, res) => {
  const inferenceLogPath = path.join(__dirname, 'public', 'inference-log.json');
  if (!fs.existsSync(inferenceLogPath)) return res.status(404).json({ label: '-', value: 0 });
  const data = fs.readFileSync(inferenceLogPath, 'utf8');
  res.setHeader('Content-Type', 'application/json');
  res.send(data);
});

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log('🚀 Server is running...');
});

