const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const logs = [];  // 暫存資料用

app.use(bodyParser.json());
app.use(express.static('public'));  // 提供網頁

app.post('/upload', (req, res) => {
  const { event, time } = req.body;
  logs.push({ event, time });
  console.log("收到傾倒事件：", event, time);
  res.send('OK');
});

app.get('/logs', (req, res) => {
  res.json(logs);
});

app.listen(process.env.PORT || 3000, '0.0.0.0');
