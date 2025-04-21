const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const port = process.env.PORT || 3000;

let latestResult = '尚未接收';

app.use(bodyParser.json());
app.use(express.static('public')); // 提供 public 資料夾靜態檔案

app.post('/upload', (req, res) => {
    const result = req.body.result;
    if (result) {
        console.log("收到推論結果：", result);
        latestResult = result;
        res.send('接收成功');
    } else {
        res.status(400).send('資料格式錯誤');
    }
});

app.get('/latest', (req, res) => {
    res.json({ result: latestResult });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`伺服器啟動在 http://0.0.0.0:${port}`);
});

