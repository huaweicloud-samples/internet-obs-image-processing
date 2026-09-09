# image-processing 函数

CDN 备源触发的 FunctionGraph 图片处理函数（Node.js 18.x）。

## 功能

- 解析 CDN 转发的请求路径：`/images/rio/1.jpg/format=webp,width=200`
- 从「原始图片桶」读取源图，使用 [Sharp](https://sharp.pixel.sh) 完成格式转换 / 缩放 / 质量压缩
- 将处理结果写回「处理后图片桶」的同一路径，供 CDN 后续直接命中 OBS 主源
- 返回 Base64 图片字节，携带 1 年缓存头

## 支持的处理参数

| 参数 | 取值 | 说明 |
|------|------|------|
| `format` | jpeg / png / webp / avif | 输出格式 |
| `width` | 正整数 | 输出宽度（等比缩放，不放大小图） |
| `height` | 正整数 | 输出高度 |
| `quality` | 1-100 | 压缩质量 |
| `original` | — | 透传原图（不处理） |

## 本地打包

> FunctionGraph 运行环境为 Linux。`sharp` 含平台原生二进制，
> 请在 Linux 环境打包，或在 Windows/macOS 上指定平台：

```bash
npm install --platform=linux --arch=x64

# 打包（zip 需包含 index.js、package.json、node_modules/）
zip -r image-processing.zip index.js package.json node_modules/

# 放到 infra 目录供 Terraform 部署
mv image-processing.zip ../../infra/
```

## 环境变量（由 infra/main.tf 注入）

| 变量 | 说明 |
|------|------|
| `originalImageBucketName` | 原始图片 OBS 桶名 |
| `transformedImageBucketName` | 处理后图片 OBS 桶名 |
| `transformedImageCacheTTL` | 响应缓存头（默认 1 年） |
| `maxImageSize` | 源图大小上限（字节，默认 4700000） |
| `OBS_ENDPOINT` | OBS 端点（可选） |

## 授权

函数绑定 IAM Agency（`infra/main.tf` 中的 `FGS-OBS-Access-*`），
运行时通过 `context` 获取临时凭证访问 OBS，无需在代码中硬编码 AK/SK。
