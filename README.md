# hserver-static
a hserver static file server middleware

## example
    'use strict';
    const Hserver = require('hserver');
    const Hstatic = require('hserver-static');

    const port = 8081;
    const app = new Hserver();

    // logger
    app.use(function (next) {
        const start = new Date;
        this.res.once('finish', () => {
            const ms = new Date - start;
            console.log('%s %s %s - time:%s', this.status, this.method, this.url, ms);
        });
        next();
    });
    // static middleware
    app.use(Hstatic({
        // 定义访问路径前缀
        // default ''
        router: '/',
        // 定义根文件目录
        // default '.'
        root: 'F:\\Web\\LayoutDesigner',
        // 定义index文件
        // default 'index.html'
        index: 'index.html',
        // 允许访问method ['GET', 'POST', 'HEAD', 'DELETE', 'PUT']
        // default ['GET', 'HEAD']
        method: ['GET', 'HEAD'],
        // 是否启用文件gzip压缩 Array|true|false
        // ['deflate', 'gzip']
        // 为true时默认为['deflate', 'gzip']
        // 为false时，关闭gzip压缩
        // default false
        zip: true,
        // 缓存时间 time(s)|true|0
        // 为true时，默认缓存时间为7200s
        // 为0时不缓存
        // default 0
        cache: 7200,
        // etag true|false
        // default false
        etag: true
    }));
    app.listen(port);
    console.log(`Server is running at http://127.0.0.1:${port}/`);