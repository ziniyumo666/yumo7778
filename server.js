// server.js
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const jpeg = require('jpeg-js');
const Module = require('./ei_model/edge-impulse-standalone.js');

const app = express();
const logs = [];

// ✅ 建立寄信 transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'ray2017good@gmail.com',
    pass: 'piimtgblngmbojrv'
  }
});

app.use(bodyParser.json());
app.use(express.static('public'));

// ✅ 初始化 Edge Impulse 模型
let eiInitialized = false;
Module.onRuntimeInitialized = function () {
  Module.init();
  eiInitialized = true;
  console.log('✅ Edge Impulse 模型已初始化');
};

// ✅ 接收 ESP32-CAM 上傳影像並即時辨識
app.post('/upload-image', express.raw({ type: 'image/jpeg', limit: '5mb' }), (req, res) => {
  const imagePath = path.join(__dirname, 'public', 'latest.jpg');
  const logPath = path.join(__dirname, 'public', 'log.txt');
  fs.writeFileSync(imagePath, req.body);

  const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const logLine = `📸 圖片上傳成功：${time}\n`;
  fs.appendFileSync(logPath, logLine);

  console.log(logLine.trim());

  // ✅ 推論圖片
  if (eiInitialized) {
    const jpegData = jpeg.decode(req.body, { useTArray: true });
    const width = jpegData.width;
    const height = jpegData.height;
    const buffer = jpegData.data;

    const imgRgb = new Uint8Array(width * height * 3);
    let j = 0;
    for (let i = 0; i < buffer.length; i += 4) {
      imgRgb[j++] = buffer[i];     // R
      imgRgb[j++] = buffer[i + 1]; // G
      imgRgb[j++] = buffer[i + 2]; // B
    }

    const ptr = Module._malloc(imgRgb.length);
    Module.HEAPU8.set(imgRgb, ptr);
    const resultPtr = Module.run_classifier_image(ptr, width, height);
    const resultJsonPtr = Module.get_classifier_result_json();
    const u8arr = new Uint8Array(Module.HEAPU8.buffer, resultJsonPtr, 1024);
    let jsonStr = '';
    for (let i = 0; i < u8arr.length && u8arr[i] !== 0; i++) {
      jsonStr += String.fromCharCode(u8arr[i]);
    }
    Module._free(ptr);
    const result = JSON.parse(jsonStr);

    const top = result.classification.sort((a, b) => b.value - a.value)[0];
    console.log("🔍 推論結果：", top);

    if (top && top.value > 0.5) {
      const mailOptions = {
        from: 'ray2017good@gmail.com',
        to: ['siniyumo666@gmail.com', 'jirui950623@gmail.com'],
        subject: `🤖 Edge Impulse 模型辨識通知`,
        text: `辨識結果：「${top.label}」\n信心值：${(top.value * 100).toFixed(2)}%\n時間：${time}`
      };

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) console.error("❌ 發信失敗：", error);
        else console.log("✅ 已寄信通知：", info.response);
      });
    }
  }

  res.send('Image uploaded and inference executed.');
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

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log('🚀 Server is running...');
});

