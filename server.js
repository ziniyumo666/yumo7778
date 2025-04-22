const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer'); // ✅ 加入這行

const app = express();
const logs = [];

nodemailer.createTransport({
  host: "mail.sausagee.party",
  port: 587,
  secure: false, // upgrade later with STARTTLS
  auth: {
    user: wheelchair@sausagee.party
    pass: sausage12345
  },
});

app.use(bodyParser.json());
app.use(express.static('public'));

app.post('/upload', (req, res) => {
  const { event } = req.body;
  const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  logs.push({ event, time });
  console.log("📥 收到傾倒事件：", event, time);

  // ✅ 建立寄信內容
  const mailOptions = {
    from: 'wheelchair@sausagee.party',
    to: ['siniyumo666@gmail.com', 'ray2017good@gmail.com']

    subject: `📡 傾倒事件通知`,
    text: `偵測到事件：「${event}」\n發生時間：${time}`
  };

  // ✅ 寄出 Email
  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("❌ 發信失敗：", error);
    } else {
      console.log("✅ 發信成功：" + info.response);
    }
  });

  res.send('OK');
});

app.get('/logs', (req, res) => {
  res.json(logs);
});

app.listen(process.env.PORT || 3000, '0.0.0.0');

