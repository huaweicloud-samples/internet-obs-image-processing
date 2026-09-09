# ===================================================================
# internet-OBS 图片处理工作流 - Terraform 配置
# 架构：CDN + FunctionGraph + OBS
#
# 部署顺序：
#   1. 打包函数代码：cd ../functions/image-processing && npm install --platform=linux --arch=x64
#      && zip -r ../../infra/image-processing.zip index.js package.json node_modules/
#   2. terraform init && terraform apply
#   3. apply 完成后，从 FunctionGraph 控制台「触发器」页获取 APIG 触发器 URL，
#      将其域名部分填入 function_url_host 变量，再次 apply 配置 CDN 备源
# ===================================================================

terraform {
  required_version = ">= 1.5"
  required_providers {
    huaweicloud = {
      source  = "huaweicloud/huaweicloud"
      version = ">= 1.53.0"
    }
  }
}

provider "huaweicloud" {
  region = "cn-north-4"
  # 凭证通过环境变量注入（禁止写入文件）：
  # export HW_ACCESS_KEY="<AK>"
  # export HW_SECRET_KEY="<SK>"
}

# ===================================================================
# 1. IAM Agency（函数访问 OBS 的授权载体）
# ===================================================================
# 委托方为云服务 FunctionGraph，授予 OBS 操作权限。
# 函数运行时通过 context 获取临时凭证，无需在代码中硬编码 AK/SK。
resource "huaweicloud_iam_agency" "fgs_obs_access" {
  name                   = "FGS-OBS-Access-${var.project_name}"
  description            = "FunctionGraph 访问 OBS 授权（图片处理工作流）"
  delegated_service_name = "functiongraph"
  domain_roles           = ["OBS OperateAccess"]
}

# ===================================================================
# 2. OBS 桶（原始图片 + 处理后图片）
# ===================================================================
resource "huaweicloud_obs_bucket" "original_images" {
  bucket = "img-orig-${var.project_name}-${var.env_prefix}"
  acl    = "private"

  # 服务端加密（SSE-OBS，AES256）
  sse_algorithm = "AES256"

  # 上传暂存区 30 天清理（不影响 images/ 下的正式图片）
  lifecycle_rule {
    name    = "cleanup-old-uploads"
    prefix  = "uploads/"
    enabled = true

    expiration {
      days = 30
    }
  }
}

resource "huaweicloud_obs_bucket" "transformed_images" {
  bucket = "img-transformed-${var.project_name}-${var.env_prefix}"
  acl    = "public-read" # CDN 主源，需公开读

  cors_rule {
    allowed_origins = ["*"]
    allowed_methods = ["GET"]
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}

# ===================================================================
# 3. FunctionGraph 函数（图片处理）
# ===================================================================
resource "huaweicloud_fgs_function" "image_processing" {
  name        = "img-processing-${var.project_name}"
  app         = "default"
  runtime     = "Node.js18.15"
  handler     = "index.handler"
  memory_size = 1536
  timeout     = 60

  # 代码包：需先打包为 infra/image-processing.zip（见文件头部署顺序）
  code_type = "zip"
  func_code = filebase64("${path.module}/image-processing.zip")

  # IAM Agency 授权（函数以该身份访问 OBS）
  agency = huaweicloud_iam_agency.fgs_obs_access.name

  # 环境变量
  user_data = jsonencode({
    originalImageBucketName    = huaweicloud_obs_bucket.original_images.bucket
    transformedImageBucketName = huaweicloud_obs_bucket.transformed_images.bucket
    transformedImageCacheTTL   = "max-age=31622400"
    maxImageSize               = "4700000"
    OBS_ENDPOINT               = "https://obs.cn-north-4.myhuaweicloud.com"
  })

  # 日志（LTS）
  enable_lts_log = true
}

# APIG 触发器：为函数生成 HTTPS 访问入口（CDN 备源）
# apply 后从控制台「触发器」页获取 URL，填入 function_url_host 再配置 CDN 备源
resource "huaweicloud_fgs_function_trigger" "apig" {
  function_urn = huaweicloud_fgs_function.image_processing.urn
  type         = "APIG"

  event_data = jsonencode({
    auth     = "NONE" # 公开访问，鉴权由 CDN 层控制
    protocol = "HTTPS"
  })
}

# ===================================================================
# 4. CDN（华为云内容分发网络）
# ===================================================================
# 主源：处理后图片 OBS 桶（命中则直接返回）
# 备源：函数 APIG 触发器地址（主源 404 时回源触发实时处理）
#
# 注意：中国大陆加速域名需已完成 ICP 备案
resource "huaweicloud_cdn_domain" "image_delivery" {
  name         = var.cdn_domain
  type         = "download" # 下载加速（静态图片内容）
  service_area = "mainland_china"

  # 主源：处理后图片 OBS 桶
  sources {
    origin      = "${huaweicloud_obs_bucket.transformed_images.bucket}.obs.cn-north-4.myhuaweicloud.com"
    origin_type = "domain"
    active      = 1
    http_port   = 80
    https_port  = 443
  }

  # 备源：函数 APIG 触发器域名（可选，二次 apply 时生效）
  dynamic "sources" {
    for_each = var.function_url_host != "" ? [var.function_url_host] : []
    content {
      origin      = sources.value
      origin_type = "domain"
      active      = 0
      http_port   = 80
      https_port  = 443
    }
  }

  # 缓存规则：图片路径长期缓存（1 年）
  cache_settings {
    rules {
      rule_type = "directory"
      content   = "/images/"
      ttl       = 31536000
      ttl_type  = "second"
      priority  = 1
    }
    rules {
      rule_type = "all"
      content   = "/"
      ttl       = 86400
      ttl_type  = "second"
      priority  = 100
    }
  }
}

# ===================================================================
# 5. 输出
# ===================================================================
output "cdn_domain" {
  description = "CDN 加速域名"
  value       = huaweicloud_cdn_domain.image_delivery.name
}

output "cdn_cname" {
  description = "CDN CNAME（域名解析需指向该地址）"
  value       = huaweicloud_cdn_domain.image_delivery.cname
}

output "function_urn" {
  description = "图片处理函数 URN"
  value       = huaweicloud_fgs_function.image_processing.urn
}

output "original_obs_bucket" {
  description = "原始图片 OBS 桶名"
  value       = huaweicloud_obs_bucket.original_images.bucket
}

output "transformed_obs_bucket" {
  description = "处理后图片 OBS 桶名（CDN 主源）"
  value       = huaweicloud_obs_bucket.transformed_images.bucket
}

# ===================================================================
# 变量定义
# ===================================================================
variable "project_name" {
  type        = string
  default     = "img-opt"
  description = "项目名称前缀"
}

variable "env_prefix" {
  type        = string
  default     = "prod"
  description = "环境前缀（prod/dev/staging）"
}

variable "cdn_domain" {
  type        = string
  default     = "img.example.com"
  description = "CDN 加速域名（需替换为已备案的真实域名）"
}

variable "function_url_host" {
  type        = string
  default     = ""
  description = "函数 APIG 触发器域名（部署函数后从控制台获取，用于配置 CDN 备源）"
}
