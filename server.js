// server.js
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const nodemailer = require('nodemailer');
const eiModule = require('./ei_model/edge-impulse-standalone');

const app = express();
const logs = [];
const imagePath = path.join(__dirname, 'public', 'latest.jpg');
const logPath = path.join(__dirname, 'public', 'log.txt');
const inferenceLogPath = path.join(__dirname, 'public', 'inference-log.json');

let classifierReady = false;
eiModule.onRuntimeInitialized = () => {
  if (typeof eiModule.init === 'function') eiModule.init();
  classifierReady = true;
  console.log('✅ Edge Impulse 模型已初始化');
};

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
  try {
    fs.writeFileSync(imagePath, req.body);
    const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    const logLine = `📸 圖片上傳成功：${time}\n`;
    fs.appendFileSync(logPath, logLine);
    console.log(logLine.trim());

    if (!classifierReady || typeof eiModule.run_classifier !== 'function') throw new Error('模型尚未初始化或不支援推論');

    // 解析圖片為 RGB float32
    const decoded = jpeg.decode(req.body, true);
    const { width, height, data } = decoded;

    const input = [];
    for (let i = 0; i < data.length; i += 4) {
      input.push(data[i] / 255);     // R
      input.push(data[i + 1] / 255); // G
      input.push(data[i + 2] / 255); // B
    }

    const result = eiModule.run_classifier(input, width, height, 3); // RGB = 3 channel
    const top = result.results?.sort((a, b) => b.value - a.value)[0] || { label: '-', value: 0 };

    fs.writeFileSync(inferenceLogPath, JSON.stringify(top));
    console.log('🤖 推論結果：', top);

    if (top.value > 0.5) {
      const mailOptions = {
        from: 'ray2017good@gmail.com',
        to: ['siniyumo666@gmail.com', 'jirui950623@gmail.com'],
        subject: `🤖 模型辨識結果通知`,
        text: `辨識到手勢：「${top.label}」\n信心值：${(top.value * 100).toFixed(2)}%\n時間：${time}`
      };

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) console.error('❌ 發信失敗：', error);
        else console.log('✅ 發信成功：', info.response);
      });
    }

    res.send('Image uploaded, logged, and classified.');
  } catch (e) {
    console.error('❌ 圖片處理錯誤：', e);
    res.status(500).send('處理圖片時出錯');
  }
});

app.post('/upload', (req, res) => {
  const { event } = req.body;
  const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  logs.push({ event, time });
  if (logs.length > 20) logs.shift();
  console.log('📥 收到傾倒事件：', event, time);

  const mailOptions = {
    from: 'ray2017good@gmail.com',
    to: ['siniyumo666@gmail.com', 'jirui950623@gmail.com'],
    subject: `📡 傾倒事件通知`,
    text: `偵測到事件：「${event}」\n發生時間：${time}`
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error('❌ 傾倒發信錯誤：', error);
    else console.log('✅ 傾倒發信成功：', info.response);
  });

  res.send('OK');
});

app.get('/logs', (req, res) => res.json(logs));
app.get('/latest-image-info', (req, res) => {
  if (!fs.existsSync(logPath)) return res.status(404).json({ error: '尚未上傳圖片' });
  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  res.json({ timestamp: lines[lines.length - 1] });
});
app.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('🚀 Server is running...'));

