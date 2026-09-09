# 函数代码说明

## 概述

本项目使用华为云 FunctionGraph + OBS 实现图片处理工作流。图片处理逻辑使用 Sharp 库，存储使用 OBS。

---

## 环境变量

| 变量名 | 说明 |
|--------|------|
| `originalImageBucketName` | 原始图片 OBS 桶名 |
| `transformedImageBucketName` | 处理后图片 OBS 桶名 |
| `transformedImageCacheTTL` | CDN 缓存时间 |
| `maxImageSize` | 最大图片尺寸（字节） |
| `OBS_ENDPOINT` | OBS 端点（可选，默认 `https://obs.cn-north-4.myhuaweicloud.com`） |

---

## 安装依赖

```bash
cd functions/image-processing
npm install esdk-obs-nodejs sharp
```

---

## 代码结构

完整实现见 [`functions/image-processing/index.js`](../functions/image-processing/index.js)，核心逻辑：

```javascript
const ObsClient = require('esdk-obs-nodejs');
const sharp = require('sharp');

// 初始化 OBS 客户端（优先使用 IAM Agency 注入的临时凭证）
function getObsClient(context) {
  return new ObsClient({
    server: process.env.OBS_ENDPOINT || 'https://obs.cn-north-4.myhuaweicloud.com',
    access_key_id: context.getAccessKey() || process.env.HW_ACCESS_KEY,
    secret_access_key: context.getSecretKey() || process.env.HW_SECRET_KEY,
    security_token: context.getSecurityKey(),
  });
}

// 获取原始图片（响应为流，需收集为 Buffer）
async function getOriginalImage(client, bucket, key) {
  const resp = await client.getObject({ Bucket: bucket, Key: key });
  if (resp.CommonMsg.Status >= 300) throw new Error(`OBS status ${resp.CommonMsg.Status}`);
  return streamToBuffer(resp.InterfaceResult.Content);
}

// Sharp 处理管线：EXIF 摆正 → 等比缩放 → 格式转换/质量压缩
async function transformImage(buffer, edits) {
  let pipeline = sharp(buffer, { failOn: 'none' }).rotate();
  if (edits.width || edits.height) {
    pipeline = pipeline.resize({
      width: edits.width, height: edits.height,
      fit: 'inside', withoutEnlargement: true,
    });
  }
  if (edits.format) pipeline = pipeline.toFormat(edits.format, { quality: edits.quality });
  return pipeline.toBuffer({ resolveWithObject: true });
}

// 写入处理后图片（Key = 请求路径，供 CDN 后续直接命中 OBS 主源）
async function putTransformedImage(client, bucket, key, buffer, contentType) {
  const resp = await client.putObject({
    Bucket: bucket, Key: key, Body: buffer,
    ContentType: contentType,
    CacheControl: process.env.transformedImageCacheTTL,
  });
  if (resp.CommonMsg.Status >= 300) throw new Error(`OBS status ${resp.CommonMsg.Status}`);
}
```

### 请求路径约定

CDN 备源将完整路径转发给函数，最后一段为处理参数：

```
/images/rio/1.jpg/format=webp,width=200
└──── 原始图片 Key ────┘└──── 处理参数 ────┘

/images/rio/3.jpg/original   → 透传原图（不处理）
```

---

## 打包命令

```bash
cd functions/image-processing
npm install --platform=linux --arch=x64   # sharp 含原生二进制，需按 Linux 平台安装
zip -r image-processing.zip index.js package.json node_modules/
mv image-processing.zip ../../infra/
```

---

## 注意事项

- 函数运行时建议通过 IAM Agency 授权，SDK 会自动从函数执行环境中获取凭证
- 图片处理超时默认 60 秒，大图片可能需要增加超时时间或内存
