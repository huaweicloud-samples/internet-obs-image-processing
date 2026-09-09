# internet-OBS 图片处理工作流

<!-- README 语言规则：目标用户为中国客户（华为云国内客户），使用中文 -->

<!-- CRITICAL · 章节1 标题与徽章 -->
[![许可证: MIT-0](https://img.shields.io/badge/License-MIT--0-blue.svg)](./LICENSE)
[![华为云](https://img.shields.io/badge/%E5%8D%8E%E4%B8%BA%E4%BA%91-%E6%9C%80%E4%BD%B3%E5%AE%9E%E8%B7%B5-orange.svg)](https://www.huaweicloud.com)
[![华为云图片优化](https://img.shields.io/badge/华为云-图片优化-blue)](https://www.huaweicloud.com)

---

## 2. 简介 / 概述

基于华为云 CDN + FunctionGraph + OBS 的图片实时优化工作流。原始图片上传至 OBS 桶，经 CDN 分发全球；未命中时触发函数实时压缩/格式转换（WebP/AVIF/缩略图），处理结果写回 OBS 并缓存至 CDN，兼顾性能与成本。

适用于电商图片站、内容平台、CDN 加速场景。

---

## 3. 目录

- [简介/概述](#2-简介--概述)
- [架构图](#4-架构图)
- [方案亮点](#5-方案亮点)
- [涉及云服务与费用](#6-涉及云服务与费用)
- [前置条件](#7-前置条件)
- [快速开始](#8-快速开始)
- [分步部署](#9-分步部署)
- [使用方法/验证](#10-使用方法验证)
- [清理资源](#11-清理资源)
- [详细说明](#12-详细说明)
- [依赖与致谢](#13-依赖与致谢)
- [FAQ](#14-faq)
- [许可证](#16-许可证)
- [联系方式](#17-联系方式)

---

## 4. 架构图

```
┌──────────────────────────────────────────────────────────────┐
│                        用户请求                                │
│              img.example.com/images/rio/1.jpg                 │
│                    /format=webp,width=200                    │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                     华为云 CDN                                │
│   主源: OBS Bucket (transformed images)                       │
│   备源: FunctionGraph URL (cache miss 时触发)                 │
└────────────┬───────────────────────────────┬─────────────────┘
             │ CDN 缓存未命中                  │ OBS 404/503
             ▼                               ▼
┌─────────────────────────┐    ┌──────────────────────────────────┐
│   OBS Bucket (存储)      │    │   FunctionGraph 图片处理函数       │
│  transformed/           │◀───│   Sharp 图片压缩/格式转换/缩放      │
│  original/              │    │   → 写入 OBS transformed bucket    │
└─────────────────────────┘    └──────────────────────────────────┘
```

> 请求流程：CDN 缓存命中 → 直接返回；未命中 → OBS 404 → CDN 备源触发函数 → 函数处理并写回 OBS → CDN 缓存结果。

---

## 5. 方案亮点

- **全托管 Serverless**：函数按调用计费，空闲时零费用
- **CDN 全球加速**：内容分发至全国 PoP，访问延迟低
- **实时图片处理**：支持 WebP/AVIF 转换、动态缩略图，按需生成
- **OBS 高持久**：标准存储 99.999999999% 持久性
- **OBS S3 兼容**：兼容 S3 API

---

## 6. 涉及云服务与费用

| 云服务 | 用途 | 计费模式 |
|--------|------|---------|
| CDN | 内容分发全球加速 | 按流量（下行 ≈ ¥0.26/GB） |
| OBS × 2 | 原始图 + 处理后图存储 | 按存储量（≈ ¥0.058/GB/月） |
| FunctionGraph | 实时图片处理 | 按调用次数 + 执行时长 |
| VPC | 函数访问 OBS 的专有网络 | 免费 |
| IAM Agency | 函数访问 OBS 授权 | 免费 |

---

## 7. 前置条件

- 华为云账号（已实名认证）
- AK/SK 凭证（IAM 用户，权限：`CDNFullAccess`、`OBSOperation`、`FGSFullAccess`、`VPFullAccess`）
- `terraform >= 1.5`
- Node.js 18.x + npm（用于打包函数代码）
- 区域：**cn-north-4**（华北-北京四）

---

## 8. 快速开始

```bash
# 克隆本仓库
git clone <repo-url>
cd internet-obs-image-processing/infra

# 初始化
terraform init

# 预览（请先配置 HW_ACCESS_KEY / HW_SECRET_KEY 环境变量）
export HW_ACCESS_KEY="<AK>"
export HW_SECRET_KEY="<SK>"
terraform plan

# 一键部署
terraform apply -auto-approve
```

---

## 9. 分步部署

**Step 1：准备函数代码包**

```bash
# 安装华为云 OBS SDK
# 参考 docs/function-adaptation.md

# 打包函数代码（详见 functions/image-processing/README.md）
cd ../functions/image-processing
npm install --platform=linux --arch=x64
zip -r image-processing.zip index.js package.json node_modules/

# 放回 infra 同级目录
mv image-processing.zip ../../infra/
```

**Step 2：配置凭证**

```bash
export HW_ACCESS_KEY="<AK>"
export HW_SECRET_KEY="<SK>"
```

**Step 3：初始化 Terraform**

```bash
cd infra
terraform init
# 预期：Terraform has been successfully initialized!
```

**Step 4：预览资源**

```bash
terraform plan
# 预期输出：Plan: 8 to add, 0 to change, 0 to destroy.
```

**Step 5：部署**

```bash
terraform apply -auto-approve
# 预期输出：Apply complete! Resources: 8 added.
```

**Step 6：上传原始图片**

```bash
# 通过 OBS 控制台或 obsutil 上传测试图片（路径需与访问 URL 一致）
obsutil cp -r ../image-sample/ obs://img-orig-img-opt-prod/images/
```

---

## 10. 使用方法 / 验证

部署完成后，通过 CDN URL 访问图片：

**Step 1：获取 CDN 域名**

```bash
terraform output cdn_domain
# 输出示例：img.example.com
```

**Step 2：访问图片**

```bash
# 原始图片（CDN 缓存未命中 → 函数处理）
curl "https://img.example.com/images/rio/1.jpg/format=webp,width=200"

# 预期：返回 WebP 格式、宽度 200px 的处理后图片

# 再次访问（CDN 缓存命中 → 直接从 OBS 返回）
curl "https://img.example.com/images/rio/1.jpg/format=webp,width=200"
```

**Step 3：验证图片处理**

```bash
# 检查响应头
curl -I "https://img.example.com/images/rio/1.jpg/format=webp,width=200"
# 预期：
#   Content-Type: image/webp
#   X-Image-Optimization: v1.0  ← 自定义响应头
#   Cache-Control: max-age=31622400  ← CDN 缓存 1 年
```

---

## 11. 清理资源

```bash
cd infra
terraform destroy -auto-approve
# 预期：Destroy complete! Resources: 8 destroyed.
```

> ⚠️ OBS 桶中如有重要图片，请提前备份后再执行销毁。CDN 域名注销后不可恢复。

---

## 12. 详细说明

### 图片处理参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `format` | 输出格式：`jpeg`、`webp`、`avif`、`png` | `format=webp` |
| `width` | 输出宽度（px） | `width=200` |
| `height` | 输出高度（px） | `height=300` |
| `quality` | 图片质量（1-100） | `quality=80` |

### 请求示例

```
/images/rio/1.jpg/format=webp,width=200
/images/rio/2.png/format=avif,width=400,quality=85
/images/rio/3.jpg/original
```

### OBS 桶说明

| 桶名 | 用途 | 访问权限 |
|------|------|---------|
| `img-orig-{project}-{env}` | 存储原始图片 | 私有（函数可读） |
| `img-transformed-{project}-{env}` | CDN 主源，存储处理后图片 | 公开读 |

---

## 13. 依赖与致谢

- 华为云 Terraform Provider：[Hashicorp Terraform Provider HuaweiCloud](https://registry.terraform.io/providers/huaweicloud/huaweicloud/latest)
- 图片处理库：[Sharp](https://sharp.pixel.sh)
- 华为云 OBS SDK：[esdk-obs-nodejs](https://support.huaweicloud.com/sdk/nodejs-SDK/obs_2842.html)

---

## 14. FAQ

**Q：CDN 缓存未命中时，函数处理速度如何？**  
A：冷启动约 500ms-2s，热启动 < 100ms。图片处理耗时取决于分辨率，一般 200-500ms。

**Q：OBS 存储费用高吗？**  
A：标准存储约 ¥0.058/GB/月。处理后图片建议设置生命周期规则（如 90 天清理）。

**Q：华为云 CDN 备源触发失败怎么办？**  
A：备源依赖 OBS 返回 404。若持续异常，可临时将 CDN 主源改为函数 URL，绕过 OBS 缓存层。

**Q：支持哪些图片格式？**  
A：输入：JPEG、PNG、GIF、WebP、AVIF、SVG；输出：JPEG、WebP、AVIF、PNG。

---

## 15. 贡献指南

欢迎提交 Issue 和 Pull Request！

---

## 16. 许可证

本项目基于 **MIT-0 License**。  
完整许可证声明请参阅 [LICENSE](./LICENSE)。

---

## 17. 联系方式

- **维护者**：
- **项目主页**：
- **问题反馈**：请提交 GitHub Issue

