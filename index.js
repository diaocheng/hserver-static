'use strict';

// url模块
const url = require('url');
// 路径模块
const path = require('path');
// 文件系统模块
const fs = require('fs');
// 压缩模块
const zlib = require('zlib');
const mime = require('mime-types');

exports = module.exports = Hstatic;

function Hstatic(options) {
    // 防止参数不正确
    if (typeof options !== 'object') {
        options = {};
    }

    let config = {
        // 定义默认根目录,并标准化路径
        root: path.normalize(path.resolve(options.root || '.')),
        // 定义默认文件
        index: options.index || 'index.html',
        // 允许访问方式
        method: options.method || ['GET', 'HEAD'],
        // 字符编码
        charset: options.charset || 'utf-8',
        // 压缩
        zip: options.zip || false,
        // 缓存时间
        cache: options.cache || 0,
        // 自定义响应头信息
        header: options.header || {}
    };
    /**
     * 中间件主要处理函数
     */
    return function handle(next) {
        // 是否通过指定的方法访问的
        if (config.method.indexOf(this.method) === -1) {
            return this.status(405);
        }
        let pathname = decodeURI(this.request.pathname);
        if (pathname.slice(-1) === '/') {
            pathname = path.join(pathname, 'index.html');
        }
        pathname = path.join(config.root, pathname);
        // 获取文件信息
        fs.stat(pathname, (err, stats) => {
            if (err) {
                this.status = 404;
            } else {
                if (stats.isFile()) {
                    let type = mime.lookup(pathname);
                    let charset = mime.charsets.lookup(type);
                    charset = charset ? `; charset=${charset}` : '';
                    let ContentType = type + charset;
                    this.set('Content-Type', ContentType);
                    this.set('Content-Length', stats.size);

                    this.body = gzip.call(this, config.zip, pathname);

                    // // 设置缓存
                    // let cache = this.getCache(request, stats);
                    // header = util.merge(header, {
                    //     'ETag': cache.ETag,
                    //     'Date': cache.Date,
                    //     'Expires': cache.Expires,
                    //     'Cache-Control': cache.CacheControl,
                    //     'Last-Modified': cache.LastModified
                    // });
                    // if (!cache.modified) {
                    //     this.response(res, 304, header);
                    // }
                    // // 请求头是否包含range
                    // if (request.range) {
                    //     let range = this.getRange(request.range, stats.size);
                    //     if (range !== -1 && range !== -2) {
                    //         header = util.merge(header, {
                    //             'Accept-Ranges': range.AcceptRanges,
                    //             'Content-Range': range[0].ContentRange,
                    //             'Content-Length': range[0].ContentLength
                    //         });
                    //         this.stream(res, {
                    //             file: request.filename,
                    //             range: range[0]
                    //         });
                    //         this.response(res, 206, header);
                    //     } else {
                    //         this.response(res, 416, {
                    //             'Content-Range': request.header['Content-Range']
                    //         });
                    //     }
                    // } else {
                    //     // 设置gzip压缩
                    //     let gzip = this.getGzip(request.acceptEncoding);
                    //     if (gzip !== -1 && gzip !== -2) {
                    //         header = util.merge(header, {
                    //             'Content-Encoding': gzip,
                    //             'Transfer-Encoding': 'chunked',
                    //             'Content-Length': stats.size
                    //         });
                    //     }
                    //     this.response(res, 200, header);
                    //     this.stream(res, {
                    //         file: request.filename,
                    //         gzip: gzip
                    //     });
                    // }
                } else if (stats.isDirectory()) {
                    this.response(res, 301, {
                        'Location': url.parse(req.url).pathname + '/'
                    });
                } else {
                    this.response(res, 400);
                }
            }
            next();
        });
    }
}
function gzip(zip, pathname) {
    const acceptEncoding = this.request.acceptEncoding;
    if (!Array.isArray(zip) || !Array.isArray(acceptEncoding)) {
        return;
    }
    let encoding = getEncoding();
    let _stream = fs.createReadStream(pathname);
    switch (encoding) {
        case 'gzip':
            setChunkHeader.call(this, encoding);
            return _stream.pipe(zlib.createGzip());
            break;
        case 'deflate':
            setChunkHeader.call(this, encoding);
            return _stream.pipe(zlib.createDeflate());
            break;
        default:
            return _stream;
            break;
    }
    function getEncoding() {
        for (let i = 0, length = acceptEncoding.length; i < length; i++) {
            for (let j = 0; j < zip.length; j++) {
                if (zip[j] === acceptEncoding[i]) {
                    return acceptEncoding[i].toLocaleLowerCase();
                }
            }
        }
    }
    function setChunkHeader(_encoding) {
        this.set({
            'Content-Encoding': _encoding,
            'Transfer-Encoding': 'chunked'
        });
    }
}