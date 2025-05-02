const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const logs = [];

// ✅ 建立寄信 transporter
const transporter = nodemailer.createTransport({
  host: "mail.sausagee.party",
  port: 587,
  secure: false,
  auth: {
    user: "wheelchair@sausagee.party",
    pass: "sausage12345"
  }
});

// ✅ 基本中介軟體與靜態路徑
app.use(bodyParser.json());
app.use(express.static('public'));

// ✅ 接收 ESP32-CAM 上傳的影像資料
app.post('/upload-image', express.raw({ type: 'image/jpeg', limit: '5mb' }), (req, res) => {
  const imagePath = path.join(__dirname, 'public', 'latest.jpg');
  const logPath = path.join(__dirname, 'public', 'log.txt');

  // 寫入圖片
  fs.writeFileSync(imagePath, req.body);

  // 加上時間戳記
  const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const logLine = `📸 圖片上傳成功：${time}\n`;
  fs.appendFileSync(logPath, logLine);

  console.log(logLine.trim());
  res.send('Image uploaded and time logged.');
});

// ✅ 接收傾倒事件並記錄、寄信
app.post('/upload', (req, res) => {
  const { event } = req.body;
  const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  logs.push({ event, time });

  // ✅ 最多只保留 20 筆資料
  if (logs.length > 20) logs.shift();

  console.log("📥 收到傾倒事件：", event, time);

  const mailOptions = {
    from: 'wheelchair@sausagee.party',
    to: ['siniyumo666@gmail.com', 'ray2017good@gmail.com'],
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

// ✅ 接收模型預測結果並寄信
app.post('/predict-result', (req, res) => {
  const { result, confidence } = req.body;
  const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  console.log(`🤖 收到模型預測：${result}, 信心值：${confidence}`);

  const mailOptions = {
    from: 'wheelchair@sausagee.party',
    to: ['siniyumo666@gmail.com', 'ray2017good@gmail.com'],
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

// ✅ 提供傾倒紀錄資料給前端
app.get('/logs', (req, res) => {
  res.json(logs);
});

// ✅ 啟動伺服器
app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log('🚀 Server is running...');
});


