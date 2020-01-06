'use strict'

// url模块
const url = require('url')
// 路径模块
const path = require('path')
// 文件系统模块
const fs = require('fs')
// 压缩模块
const zlib = require('zlib')
// 文件mime类型获取
const mime = require('mime-types')
// 默认缓存时间
const CACHETIME = 7200
// 服务器默认支持的gzip ENCODING格式
const ENCODING = ['deflate', 'gzip']
// 要采用Gzip压缩的文件类型
const ZIPFILE = ['.html', '.css', '.js', '.json', '.xml', '.svg', '.txt']

exports = module.exports = Hstatic

function Hstatic(options) {
  // 防止为传入参数产生错误
  if (typeof options !== 'object') {
    options = {}
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
  }
  config.router = config.router.replace(/\/+$/, '')
  /**
   * 中间件主要处理函数
   */
  return async function handle(context, next) {
    // 判断是否已响应
    if (context.headerSent && !context.writable) {
      return await next()
    }
    let pathname = decodeURI(context.pathname)
    // 判断是否为指定的开始路径
    if (pathname.indexOf(config.router) !== 0) {
      return await next()
    }
    const router = new RegExp(`^${config.router}`)
    // 替换掉前面的指定路径
    pathname = pathname.replace(router, '')
    // 是否通过指定的方法访问的
    if (config.method.indexOf(context.method) === -1) {
      context.status = 405
      return await next()
    }
    // 获取默认index文件
    if (pathname.slice(-1) === '/') {
      pathname = path.join(pathname, config.index)
    }
    pathname = path.join(config.root, pathname)
    await new Promise((resolve, reject) => {
      // 获取文件信息
      fs.stat(pathname, (err, stats) => {
        if (err) {
          context.status = 404
        } else {
          if (stats.isFile()) {
            let type = mime.lookup(pathname)
            let charset = mime.charsets.lookup(type)
            charset = charset ? `; charset=${charset}` : ''
            let ContentType = type + charset
            // 设置Content-Type
            context.type = ContentType.toLowerCase()

            // 判断是否有缓存，并设置缓存
            setCache(context, config, stats, pathname)
            // 判断是否需要发送最新文件到客户端
            if (context.cache) {
              context.status = 304
            } else {
              // 获取正文主体
              let body = getBody(context, config, stats, pathname)
              // 获取压缩后的响应正文
              context.body = setZip(context, config, body, pathname)
            }
            resolve(context)
          } else if (stats.isDirectory()) {
            // 301重定向
            context.status = 301
            context.set('Location', url.parse(context.req.url).pathname + '/')
            resolve(context)
          } else {
            // bad request 错误的请求
            context.status = 400
            reject(context)
          }
        }
      })
    })
    return await next()
  }
}
/**
 * 获取并设置文件缓存头信息
 * @param  {Object} config   静态服务器中间件配置
 * @param  {Object} stats    文件信息
 * @param  {String} pathname 文件路径
 */
function setCache(context, config, stats, pathname) {
  if (!config.cache) {
    return
  }
  if (config.cache === true) {
    config.cache = CACHETIME
  }
  if ('number' !== typeof config.cache) {
    return
  }
  context.lastModified = stats.mtime.toUTCString()
  let date = new Date()
  let expires = new Date()
  let cacheTime = config.cache * 1000
  // 设置缓存过期时间;
  expires.setTime(expires.getTime() + cacheTime)
  context.set({
    Date: date.toUTCString(),
    Expires: expires.toUTCString(),
    'Cache-Control': `max-age=${cacheTime}`
  })
  if (config.etag) {
    let size = stats.size.toString(16)
    let mtime = stats.mtime.getTime().toString(16)
    context.etag = `${size}-${mtime}`
  }
}

/**
 * 获取range信息
 * @param  {String} str  request header range
 * @param  {Number} size file size
 * @return {Object}
 */
function getRange(str, size) {
  let index = str ? str.indexOf('=') : -1
  if (index === -1) {
    return -2
  }
  // 把range转换为数组
  let arr = str.slice(index + 1).split(',')
  let ranges = []
  // 记录range的类型
  ranges.AcceptRanges = str.slice(0, index)
  // 获取文件长度
  for (let i = 0; i < arr.length; i++) {
    let range = arr[i].split('-')
    let start = parseInt(range[0], 10)
    let end = parseInt(range[1], 10)
    // start为数字时
    if (isNaN(start)) {
      start = size - end
      end = size - 1
      // end为数字时
    } else if (isNaN(end)) {
      end = size - 1
    }
    // 结束不得大于文件大小
    if (end > size - 1) {
      end = size - 1
    }
    // start与end都为数字,且0<=start<=end
    if (!isNaN(start) && !isNaN(end) && start >= 0 && start <= end) {
      ranges.push({
        ContentRange:
          ranges.AcceptRanges + ' ' + start + '-' + end + '/' + size,
        ContentLength: end - start + 1,
        start: start,
        end: end
      })
    }
  }
  // 没有获取到有效的range值
  if (ranges.length < 1) {
    return -1
  }
  return ranges
}

/**
 * 获取响应正文body
 * @param  {Object} config   静态服务器中间件配置
 * @param  {Object} stats    文件信息
 * @param  {String} pathname 文件路径
 * @return {Stream}          响应正文
 */
function getBody(context, config, stats, pathname) {
  let _stream
  // 判断是否range请求
  const hasRange = context.get('Range')
  if (hasRange) {
    let range = getRange(hasRange, stats.size)
    if (range !== -1 && range !== -2) {
      // 设置响应头
      context.set({
        'Accept-Ranges': range.AcceptRanges,
        'Content-Range': range[0].ContentRange
      })
      // 设置正文长度
      context.length = range[0].ContentLength
      context.status = 206
      _stream = fs.createReadStream(pathname, {
        start: range[0].start,
        end: range[0].end
      })
    } else {
      // 所请求的范围无法满足 (Requested Range not satisfiable)
      context.status = 416
      return
    }
  } else {
    context.length = stats.size
    _stream = fs.createReadStream(pathname)
  }
  return _stream
}
/**
 * 检查是否压缩响应正文内容
 * 并压缩响应正文
 * @param  {Object} config   静态服务器中间件配置
 * @param  {Stream} _stream  响应正文
 * @param  {String} pathname 文件路径
 * @return {Stream}          响应正文
 */
function setZip(context, config, _stream, pathname) {
  const ext = path.extname(pathname).toLowerCase()
  if (ZIPFILE.indexOf(ext) === -1) {
    return _stream
  }
  const acceptEncoding = context.acceptEncoding
  // 如果acceptEncoding不为数组，就返回值
  if (!Array.isArray(acceptEncoding)) {
    return _stream
  }
  let zip = config.zip
  // 获取客户端支持的encoding
  let encoding = getEncoding(zip, acceptEncoding)
  // 设置压缩格式，并返回压缩后的响应正文
  switch (encoding) {
    case 'br':
      context.set({
        'Content-Encoding': 'br',
        'Transfer-Encoding': 'chunked'
      })
      return _stream.pipe(zlib.createBrotliCompress())
      break
    case 'gzip':
      context.set({
        'Content-Encoding': 'gzip',
        'Transfer-Encoding': 'chunked'
      })
      return _stream.pipe(zlib.createGzip())
      break
    case 'deflate':
      context.set({
        'Content-Encoding': 'deflate',
        'Transfer-Encoding': 'chunked'
      })
      return _stream.pipe(zlib.createDeflate())
      break
    default:
      return _stream
      break
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
      return false
    }
    if (_zip == true) {
      _zip = ENCODING
    }
    if ('string' === typeof _zip) {
      _zip = [_zip]
    }
    if (!Array.isArray(_zip)) {
      return false
    }
    for (let i = 0, length = _acceptEncoding.length; i < length; i++) {
      for (let j = 0; j < _zip.length; j++) {
        if (_zip[j] === _acceptEncoding[i]) {
          return _acceptEncoding[i].toLocaleLowerCase()
        }
      }
    }
  }
}
