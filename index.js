'use strict';

// url模块
const url = require('url');
// 路径模块
const path = require('path');
// 文件系统模块
const fs = require('fs');
// 压缩模块
const zlib = require('zlib');
// 文件mime类型获取
const mime = require('mime-types');
// 默认缓存时间
const CACHETIME = 7200;
// 服务器默认支持的gzip ENCODING格式
const ENCODING = ['deflate', 'gzip'];
// 要采用Gzip压缩的文件类型
const ZIPFILE = ['.html', '.css', '.js', '.json', '.xml', '.svg', '.txt'];

exports = module.exports = Hstatic;

function Hstatic(options) {
    // 防止为传入参数产生错误
    if (typeof options !== 'object') {
        options = {};
    }
    // 获取配置
    let config = {
        router: options.router || '',
        // 定义默认根目录,并标准化路径
        root: path.normalize(path.resolve(options.root || '.')),
        // 定义默认文件
        index: options.index || 'index.html',
        // 允许访问方式
        method: options.method || ['GET', 'HEAD'],
        // 压缩
        zip: options.zip || false,
        // 缓存时间
        cache: options.cache || 0,
        // etag支持
        etag: options.etag || false
    };
    config.router = config.router.replace(/\/+$/, '');
    /**
     * 中间件主要处理函数
     */
    return function handle(next) {
        let pathname = decodeURI(this.pathname);
        // 判断是否为指定的开始路径
        if (pathname.indexOf(config.router) !== 0) {
            return next();
        }
        const router = new RegExp(`^${config.router}`);
        // 替换掉前面的指定路径
        pathname = pathname.replace(router, '');
        // 是否通过指定的方法访问的
        if (config.method.indexOf(this.method) === -1) {
            this.status = 405;
            return next();
        }
        // 获取默认index文件
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
                    // 设置Content-Type
                    this.type = ContentType.toLowerCase();

                    // 判断是否有缓存，并设置缓存
                    setCache.call(this, config, stats, pathname);
                    // 判断是否需要发送最新文件到客户端
                    if (this.cache) {
                        this.status = 304;
                    } else {
                        // 获取正文主体
                        let body = getBody.call(this, config, stats, pathname);
                        // 获取压缩后的响应正文
                        this.body = setZip.call(this, config, body, pathname);
                    }
                } else if (stats.isDirectory()) {
                    // 301重定向
                    this.status = 301;
                    this.set('Location', url.parse(this.req.url).pathname + '/');
                } else {
                    // bad request 错误的请求
                    this.status = 400;
                }
            }
            next();
        });
    }
}
/**
 * 获取并设置文件缓存头信息
 * @param  {Object} config   静态服务器中间件配置
 * @param  {Object} stats    文件信息
 * @param  {String} pathname 文件路径
 */
function setCache(config, stats, pathname) {
    if (!config.cache) {
        return;
    }
    if (config.cache === true) {
        config.cache = CACHETIME;
    }
    if ('number' !== typeof config.cache) {
        return;
    }
    this.lastModified = stats.mtime.toUTCString();
    let date = new Date();
    let expires = new Date();
    let cacheTime = config.cache * 1000;
    // 设置缓存过期时间;
    expires.setTime(expires.getTime() + cacheTime);
    this.set({
        'Date': date.toUTCString(),
        'Expires': expires.toUTCString(),
        'Cache-Control': `max-age=${cacheTime}`
    });
    if (config.etag) {
        let size = stats.size.toString(16);
        let mtime = stats.mtime.getTime().toString(16);
        this.etag = `${size}-${mtime}`;
    }
}
/**
 * 获取响应正文body
 * @param  {Object} config   静态服务器中间件配置
 * @param  {Object} stats    文件信息
 * @param  {String} pathname 文件路径
 * @return {Stream}          响应正文
 */
function getBody(config, stats, pathname) {
    let status = this.status || 200;
    if (status < 200 || status >= 300) {
        return;
    }
    let _stream;
    // 判断是否range请求
    if (this.get('Range')) {
        let range = getRange(this.get('Range'), stats.size);
        if (range !== -1 && range !== -2) {
            // 设置响应头
            this.set({
                'Accept-Ranges': range.AcceptRanges,
                'Content-Range': range[0].ContentRange
            });
            // 设置正文长度
            this.length = range[0].ContentLength;
            this.status = 206;
            _stream = fs.createReadStream(pathname, {
                start: range[0].start,
                end: range[0].end
            });
        } else {
            // 所请求的范围无法满足 (Requested Range not satisfiable)
            this.status = 416;
            return;
        }
    } else {
        this.length = stats.size;
        _stream = fs.createReadStream(pathname);
    }
    return _stream;
    /**
     * 获取range信息
     * @param  {String} str  request header range
     * @param  {Number} size file size
     * @return {Object}
     */
    function getRange(str, size) {
        var index = str ? str.indexOf('=') : -1
        if (index === -1) {
            return -2;
        }
        // 把range转换为数组
        var arr = str.slice(index + 1).split(',');
        var ranges = [];
        // 记录range的类型
        ranges.AcceptRanges = str.slice(0, index);
        // 获取文件长度
        for (var i = 0; i < arr.length; i++) {
            var range = arr[i].split('-');
            var start = parseInt(range[0], 10);
            var end = parseInt(range[1], 10);
            // start为数字时
            if (isNaN(start)) {
                start = size - end;
                end = size - 1;
                // end为数字时
            } else if (isNaN(end)) {
                end = size - 1;
            }
            // 结束不得大于文件大小
            if (end > size - 1) {
                end = size - 1;
            }
            // start与end都为数字,且0<=start<=end
            if (!isNaN(start) && !isNaN(end) && start >= 0 && start <= end) {
                ranges.push({
                    ContentRange: ranges.AcceptRanges + ' ' + start + '-' + end + '/' + size,
                    ContentLength: end - start + 1,
                    start: start,
                    end: end
                });
            }
        }
        // 没有获取到有效的range值
        if (ranges.length < 1) {
            return -1
        }
        return ranges;
    }
}
/**
 * 检查是否压缩响应正文内容
 * 并压缩响应正文
 * @param  {Object} config   静态服务器中间件配置
 * @param  {Stream} _stream  响应正文
 * @param  {String} pathname 文件路径
 * @return {Stream}          响应正文
 */
function setZip(config, _stream, pathname) {
    const ext = path.extname(pathname).toLowerCase();
    if (ZIPFILE.indexOf(ext) === -1) {
        return _stream;
    }
    const acceptEncoding = this.acceptEncoding;
    // 如果acceptEncoding不为数组，就返回值
    if (!Array.isArray(acceptEncoding)) {
        return _stream;
    }
    let zip = config.zip;
    // 获取客户端支持的encoding
    let encoding = getEncoding(zip, acceptEncoding);
    // 设置压缩格式，并返回压缩后的响应正文
    switch (encoding) {
        case 'gzip':
            this.set({
                'Content-Encoding': 'gzip',
                'Transfer-Encoding': 'chunked'
            });
            return _stream.pipe(zlib.createGzip());
            break;
        case 'deflate':
            this.set({
                'Content-Encoding': 'deflate',
                'Transfer-Encoding': 'chunked'
            });
            return _stream.pipe(zlib.createDeflate());
            break;
        default:
            return _stream;
            break;
    }
    /**
     * 获取客户端和服务器支持的压缩格式
     * 并选择一种压缩格式
     * @param  {Mixed} _zip             config zip配置
     * @param  {Array} _acceptEncoding  客户端支持的压缩格式
     * @return {String}
     */
    function getEncoding(_zip, _acceptEncoding) {
        if (!_zip) {
            return false;
        }
        if (_zip == true) {
            _zip = ENCODING;
        }
        if ('string' === typeof _zip) {
            _zip = [_zip];
        }
        if (!Array.isArray(_zip)) {
            return false;
        }
        for (let i = 0, length = _acceptEncoding.length; i < length; i++) {
            for (let j = 0; j < _zip.length; j++) {
                if (_zip[j] === _acceptEncoding[i]) {
                    return _acceptEncoding[i].toLocaleLowerCase();
                }
            }
        }
    }
}