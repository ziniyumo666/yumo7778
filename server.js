const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
const logs = [];

// ✅ 建立寄信 transporter（記得用雙引號）
const transporter = nodemailer.createTransport({
  host: "mail.sausagee.party",
  port: 587,
  secure: false,
  auth: {
    user: "wheelchair@sausagee.party",
    pass: "sausage12345"
  }
});

app.use(bodyParser.json());
app.use(express.static('public')); // 提供 index.html 和 latest.jpg

// ✅ 設定 multer 來接收圖片
const upload = multer({ storage: multer.memoryStorage() });

// ✅ 接收 ESP32-CAM 上傳的圖片
app.post('/upload-image', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No image uploaded.');
  }
  fs.writeFileSync('public/latest.jpg', req.file.buffer);
  console.log('✅ 已接收並儲存一張最新圖片');
  res.send('Image uploaded successfully.');
});

// ✅ 收到傾倒事件上傳，記錄並寄信
app.post('/upload', (req, res) => {
  const { event } = req.body;
  const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  logs.push({ event, time });
  console.log("📥 收到傾倒事件：", event, time);

  // 建立寄信內容
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

// ✅ 讀取傾倒事件紀錄
app.get('/logs', (req, res) => {
  res.json(logs);
});

// ✅ 啟動伺服器
app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log('🚀 Server is running...');
});



