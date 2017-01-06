'use strict';
const Hserver = require('hserver');
const mime = require('mime-types');
const Hstatic = require('../index');

const port = 8080;
const app = new Hserver();

app.use(Hstatic({
    // 定义根目录
    root: 'F:\\Demo\\二维码',
    // 定义默认文件
    index: 'index.html',
    // 允许访问method
    // method: ['GET', 'POST', 'HEAD', 'DELETE', 'PUT'],
    method: ['GET', 'HEAD'],
    // 文件字符编码
    charset: 'utf-8',
    // 是否启用文件gzip压缩
    zip: ['deflate', 'gzip', 'sdch', 'br'],
    // 缓存时间(s)
    cache: 1000,
    // 自定义响应头信息
    header: {
        'Access-Control-Allow-Origin': '*'
    }
}));
app.listen(port);
console.log(`Server is running at http://127.0.0.1:${port}/`);