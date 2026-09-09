/**
 * internet-OBS 图片处理工作流 - FunctionGraph 函数
 *
 * 触发方式：CDN 备源回源（函数 URL，APIG 事件格式）
 * 请求路径：/images/rio/1.jpg/format=webp,width=200
 *           └── 原始图片 Key ──┘ └── 处理参数（最后一段）──┘
 *
 * 处理流程：
 *   1. 从「原始图片桶」读取源图
 *   2. 使用 Sharp 完成 格式转换 / 缩放 / 质量压缩
 *   3. 将结果写回「处理后图片桶」的同一路径（供 CDN 后续命中）
 *   4. 以 Base64 返回图片字节与缓存头
 *
 * 授权：函数绑定 IAM Agency（见 infra/main.tf），
 *       运行时通过 context 获取临时凭证访问 OBS。
 */

const ObsClient = require('esdk-obs-nodejs');
const sharp = require('sharp');

const ORIGINAL_BUCKET = process.env.originalImageBucketName;
const TRANSFORMED_BUCKET = process.env.transformedImageBucketName;
const CACHE_TTL = process.env.transformedImageCacheTTL || 'max-age=31622400';
const MAX_IMAGE_SIZE = parseInt(process.env.maxImageSize || '4700000', 10);

const MIME = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

const SUPPORTED_OUTPUT = ['jpeg', 'png', 'webp', 'avif'];

let obsClient = null;

/** 惰性初始化 OBS 客户端（优先使用 Agency 临时凭证） */
function getObsClient(context) {
  if (obsClient) return obsClient;

  let ak = process.env.HW_ACCESS_KEY;
  let sk = process.env.HW_SECRET_KEY;
  let token = undefined;

  // 函数绑定 IAM Agency 后，FunctionGraph 注入临时凭证
  if (context && typeof context.getAccessKey === 'function') {
    try {
      ak = context.getAccessKey() || ak;
      sk = context.getSecretKey() || sk;
      token = context.getSecurityKey();
    } catch (e) {
      console.log('context 凭证不可用，回退环境变量:', e.message);
    }
  }

  obsClient = new ObsClient({
    server: process.env.OBS_ENDPOINT || 'https://obs.cn-north-4.myhuaweicloud.com',
    access_key_id: ak,
    secret_access_key: sk,
    security_token: token,
    max_connections: 50,
    timeout: 30,
  });
  return obsClient;
}

/** 流转 Buffer */
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/** 构造 APIG 风格响应（body 为图片字节，Base64 返回） */
function imageResponse(statusCode, buffer, contentType, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': contentType || 'application/octet-stream',
      'Cache-Control': CACHE_TTL,
      'X-Image-Optimization': 'v1.0',
      ...extraHeaders,
    },
    body: buffer ? buffer.toString('base64') : '',
    isBase64Encoded: true,
  };
}

function errorResponse(statusCode, message) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ statusCode, message }),
    isBase64Encoded: false,
  };
}

/**
 * 解析请求路径 → { imageKey, edits }
 *   /images/rio/1.jpg/format=webp,width=200 → key=images/rio/1.jpg, edits={format,width}
 *   /images/rio/3.jpg/original              → key=images/rio/3.jpg, edits=null（透传原图）
 *   /images/rio/1.jpg                       → key=images/rio/1.jpg, edits=null
 */
function parseRequestPath(path) {
  const clean = decodeURIComponent((path || '/').split('?')[0]).replace(/^\/+/, '');
  if (!clean) return null;

  const segments = clean.split('/').filter(Boolean);
  const last = segments[segments.length - 1];

  // 无处理参数
  if (!last.includes('=')) {
    return { imageKey: segments.join('/'), edits: null };
  }

  // 解析最后一段处理参数
  const edits = {};
  for (const pair of last.split(',')) {
    const idx = pair.indexOf('=');
    if (idx <= 0) return null;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (!['format', 'width', 'height', 'quality'].includes(k)) return null;
    edits[k] = v;
  }

  // 校验参数值
  if (edits.format && !SUPPORTED_OUTPUT.includes(edits.format)) return null;
  for (const dim of ['width', 'height']) {
    if (edits[dim] && (!/^\d+$/.test(edits[dim]) || parseInt(edits[dim], 10) < 1)) return null;
  }
  if (edits.quality && (!/^\d+$/.test(edits.quality) || parseInt(edits.quality, 10) < 1 || parseInt(edits.quality, 10) > 100)) {
    return null;
  }

  const imageKey = segments.slice(0, -1).join('/');
  if (!imageKey) return null;
  return { imageKey, edits };
}

/** 用源图扩展名推断 Content-Type */
function guessContentType(key, format) {
  if (format && MIME[format]) return MIME[format];
  const ext = (key.split('.').pop() || '').toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

/** Sharp 处理管线 */
async function transformImage(buffer, edits) {
  let pipeline = sharp(buffer, { failOn: 'none' }).rotate(); // 按 EXIF 自动摆正

  if (edits && (edits.width || edits.height)) {
    pipeline = pipeline.resize({
      width: edits.width ? parseInt(edits.width, 10) : undefined,
      height: edits.height ? parseInt(edits.height, 10) : undefined,
      fit: 'inside',          // 不变形，等比缩放
      withoutEnlargement: true,
    });
  }

  if (edits && edits.format) {
    const opts = edits.quality ? { quality: parseInt(edits.quality, 10) } : {};
    pipeline = pipeline.toFormat(edits.format, opts);
  }

  return pipeline.toBuffer({ resolveWithObject: true });
}

exports.handler = async (event, context) => {
  const started = Date.now();

  // 兼容 APIG 事件 / 直接调用两种入口
  const path = event.path || event.rawPath || '/';
  const method = event.httpMethod || event.requestContext?.http?.method || 'GET';

  if (method !== 'GET' && method !== 'HEAD') {
    return errorResponse(405, `method ${method} not allowed`);
  }

  const parsed = parseRequestPath(path);
  if (!parsed) {
    return errorResponse(400, `invalid request path: ${path}`);
  }
  const { imageKey, edits } = parsed;

  const client = getObsClient(context);

  try {
    // 1. 读取原始图片
    const getResp = await client.getObject({
      Bucket: ORIGINAL_BUCKET,
      Key: imageKey,
    });

    if (getResp.CommonMsg.Status >= 300) {
      const status = getResp.CommonMsg.Status;
      if (status === 404) return errorResponse(404, `image not found: ${imageKey}`);
      return errorResponse(502, `failed to fetch original image, OBS status ${status}`);
    }

    const original = await streamToBuffer(getResp.InterfaceResult.Content);
    if (original.length > MAX_IMAGE_SIZE) {
      return errorResponse(413, `image too large: ${original.length} bytes (limit ${MAX_IMAGE_SIZE})`);
    }

    // 2. Sharp 处理（edits 为 null 表示透传原图）
    const { data, info } = edits
      ? await transformImage(original, edits)
      : { data: original, info: null };

    // 3. 写回处理后桶（Key = 请求路径，供 CDN 后续直接命中 OBS）
    const transformedKey = path.replace(/^\/+/, '');
    const contentType = info
      ? (MIME[info.format] || guessContentType(imageKey, edits?.format))
      : guessContentType(imageKey, null);

    const putResp = await client.putObject({
      Bucket: TRANSFORMED_BUCKET,
      Key: transformedKey,
      Body: data,
      ContentType: contentType,
      CacheControl: CACHE_TTL,
    });
    if (putResp.CommonMsg.Status >= 300) {
      console.log('写回 OBS 失败，仍返回图片内容, status:', putResp.CommonMsg.Status);
    }

    console.log(
      `processed ${imageKey}${edits ? ' [' + JSON.stringify(edits) + ']' : ''}` +
      ` ${original.length}B -> ${data.length}B in ${Date.now() - started}ms`
    );

    // 4. 返回图片
    return imageResponse(200, data, contentType);
  } catch (err) {
    console.error('image processing failed:', err);
    return errorResponse(500, `image processing failed: ${err.message}`);
  }
};
