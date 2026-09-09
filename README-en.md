# internet-OBS Image Processing Workflow

[中文](./README.md) | English

---

## 1. Overview

Real-time image optimization workflow based on Huawei Cloud CDN + FunctionGraph + OBS. Original images are uploaded to OBS buckets and distributed globally via CDN; when cache misses, FunctionGraph triggers real-time compression/format conversion (WebP/AVIF/thumbnails), writes results back to OBS and caches them in CDN, balancing performance and cost.

Suitable for e-commerce image sites, content platforms, and CDN acceleration scenarios.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        User Request                          │
│              img.example.com/images/rio/1.jpg               │
│                    /format=webp,width=200                   │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                     Huawei Cloud CDN                        │
│   Primary: OBS Bucket (transformed images)                 │
│   Backup: FunctionGraph URL (triggered on cache miss)    │
└────────────┬───────────────────────────────┬─────────────────┘
             │ CDN Cache Miss              │ OBS 404/503
             ▼                               ▼
┌─────────────────────────┐    ┌──────────────────────────────────┐
│   OBS Bucket (Storage) │    │   FunctionGraph Image Process  │
│  transformed/           │◀───│   Sharp compression/format      │
│  original/             │    │   → Write to OBS bucket         │
└─────────────────────────┘    └──────────────────────────────────┘
```

---

## 3. Key Features

- **Serverless**: Pay per invocation, zero cost when idle
- **Global CDN Acceleration**: Content distributed to nationwide POPs with low latency
- **Real-time Image Processing**: WebP/AVIF conversion, dynamic thumbnails, on-demand
- **High Durability**: OBS 99.999999999% durability
- **S3 Compatible**: Compatible with S3 API

---

## 4. Cloud Services & Pricing

| Service | Usage | Pricing |
|---------|-------|---------|
| CDN | Global content delivery | ~¥0.26/GB |
| OBS × 2 | Original + processed image storage | ~¥0.058/GB/month |
| FunctionGraph | Real-time image processing | Per invocation + duration |
| VPC | Private network for OBS access | Free |
| IAM Agency | OBS access authorization | Free |

---

## 5. Prerequisites

- Huawei Cloud account (real-name authenticated)
- AK/SK credentials (IAM user with CDNFullAccess, OBSOperation, FGSFullAccess, VPFullAccess)
- `terraform >= 1.5`
- Node.js 18.x + npm (for function packaging)
- Region: **cn-north-4**

---

## 6. Quick Start

```bash
# Clone repository
git clone <repo-url>
cd internet-obs-image-processing/infra

# Initialize
terraform init

# Preview (configure HW_ACCESS_KEY / HW_SECRET_KEY first)
export HW_ACCESS_KEY="<AK>"
export HW_SECRET_KEY="<SK>"
terraform plan

# Deploy
terraform apply -auto-approve
```

---

## 7. Step-by-Step Deployment

**Step 1: Prepare Function Package**

```bash
# Package function code (see functions/image-processing/README.md)
cd ../functions/image-processing
npm install --platform=linux --arch=x64
zip -r image-processing.zip index.js package.json node_modules/
mv image-processing.zip ../../infra/
```

**Step 2: Configure Credentials**

```bash
export HW_ACCESS_KEY="<AK>"
export HW_SECRET_KEY="<SK>"
```

**Step 3: Initialize Terraform**

```bash
cd infra
terraform init
```

**Step 4: Preview Resources**

```bash
terraform plan
```

**Step 5: Deploy**

```bash
terraform apply -auto-approve
```

**Step 6: Upload Original Images**

```bash
# Upload test images via OBS console or obsutil
obsutil cp -r ../image-sample/ obs://img-orig-img-opt-prod/images/
```

---

## 8. Usage & Verification

After deployment, access images via CDN URL:

**Step 1: Get CDN Domain**

```bash
terraform output cdn_domain
```

**Step 2: Access Images**

```bash
# Original image (cache miss → function processes)
curl "https://img.example.com/images/rio/1.jpg/format=webp,width=200"

# Second access (cache hit → return from OBS)
curl "https://img.example.com/images/rio/1.jpg/format=webp,width=200"
```

**Step 3: Verify Image Processing**

```bash
curl -I "https://img.example.com/images/rio/1.jpg/format=webp,width=200"
# Expected:
#   Content-Type: image/webp
#   X-Image-Optimization: v1.0
#   Cache-Control: max-age=31622400
```

---

## 9. Cleanup

```bash
cd infra
terraform destroy -auto-approve
```

> ⚠️ Important: Backup important images in OBS buckets before destroying. CDN domain cannot be recovered after cancellation.

---

## 10. Image Processing Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `format` | Output format: jpeg, webp, avif, png | `format=webp` |
| `width` | Output width (px) | `width=200` |
| `height` | Output height (px) | `height=300` |
| `quality` | Image quality (1-100) | `quality=80` |

### Request Examples

```
/images/rio/1.jpg/format=webp,width=200
/images/rio/2.png/format=avif,width=400,quality=85
/images/rio/3.jpg/original
```

---

## 11. OBS Bucket Details

| Bucket | Purpose | Access |
|--------|---------|--------|
| `img-orig-{project}-{env}` | Original images | Private (function readable) |
| `img-transformed-{project}-{env}` | CDN primary, processed images | Public read |

---

## 12. Dependencies

- Huawei Cloud Terraform Provider: [Hashicorp Terraform Provider HuaweiCloud](https://registry.terraform.io/providers/huaweicloud/huaweicloud/latest)
- Image Processing: [Sharp](https://sharp.pixel.sh)
- Huawei Cloud OBS SDK: [esdk-obs-nodejs](https://support.huaweicloud.com/sdk/nodejs-SDK/obs_2842.html)

---

## 13. FAQ

**Q: How fast is image processing when CDN cache misses?**
A: Cold start ~500ms-2s, warm start <100ms. Processing time depends on resolution, typically 200-500ms.

**Q: Is OBS storage expensive?**
A: Standard storage ~¥0.058/GB/month. It is recommended to set lifecycle rules (e.g., 90 days) for processed images.

**Q: What if CDN backup source trigger fails?**
A: Backup source depends on OBS returning 404. If persistent exceptions occur, temporarily change CDN primary source to function URL to bypass OBS cache layer.

**Q: What image formats are supported?**
A: Input: JPEG, PNG, GIF, WebP, AVIF, SVG; Output: JPEG, WebP, AVIF, PNG.

---

## 14. Contributing

Issues and Pull Requests are welcome!

---

## 15. License

This project is licensed under **MIT-0 License**. See [LICENSE](./LICENSE) for details.

---

## 16. Contact

- **Maintainer**:
- **Homepage**:
- **Issues**: Please submit via GitHub Issue
