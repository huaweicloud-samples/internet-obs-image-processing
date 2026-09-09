# 部署指南

## 前提条件检查清单

- [ ] 华为云账号已完成实名认证
- [ ] 已创建 IAM 用户并获取 AK/SK
- [ ] IAM 用户具备以下权限：
  - `CDNFullAccess`（CDN 管理）
  - `OBSOperation`（OBS 桶管理）
  - `FGSFullAccess`（函数计算管理）
  - `VPFullAccess`（VPC 管理）
  - `IMSFullAccess`（镜像管理）
  - `LTSFullAccess`（日志服务，如需查看日志）
- [ ] `terraform >= 1.5` 已安装
- [ ] Node.js 18.x + npm 已安装

---

## 部署步骤

### Step 1：配置凭证

```bash
export HW_ACCESS_KEY="<您的华为云 AK>"
export HW_SECRET_KEY="<您的华为云 SK>"
```

> ⚠️ 凭证仅通过环境变量注入 Terraform Provider，禁止写入任何文件。

### Step 2：准备函数代码包

```bash
# 进入函数目录
cd ../functions/image-processing

# 安装华为云 OBS SDK
npm install esdk-obs-nodejs

# 适配函数代码
# 参考 docs/function-adaptation.md

# 打包
npm install --platform=linux --arch=x64
zip -r image-processing.zip index.js package.json node_modules/

# 移至 infra 目录
mv image-processing.zip ../infra/
```

### Step 3：修改域名变量

编辑 `infra/terraform.tfvars`（创建该文件）：

```hcl
project_name   = "img-opt"
env_prefix     = "prod"
domain_suffix  = "your-domain.com"  # 替换为您的域名
```

### Step 4：初始化 Terraform

```bash
cd ../infra
terraform init
# 预期输出：Terraform has been successfully initialized!
```

### Step 5：预览部署

```bash
terraform plan
# 预期输出：Plan: 8 to add, 0 to change, 0 to destroy.
```

### Step 6：执行部署

```bash
terraform apply -auto-approve
# 预期输出：Apply complete! Resources: 8 added.
```

### Step 7：配置 DNS CNAME

部署输出中的 `cdn_domain` 即 CDN 加速域名，需在您的 DNS 服务商添加 CNAME 记录：

```
img  IN CNAME  <cdn_domain 输出值>
```

### Step 8：上传测试图片

```bash
# 安装 obsutil（华为云 OBS 客户端）
# 下载地址：https://support.huaweicloud.com/sdk/nodejs-SDK/obs_2842.html

# 配置凭证
obsutil config -i=<AK> -k=<SK> -e=https://obs.cn-north-4.myhuaweicloud.com

# 上传测试图片（路径需与访问 URL 一致）
obsutil cp -r ../image-sample/ obs://img-orig-img-opt-prod/images/
```

### Step 9：验证

```bash
# 测试图片访问
curl -I "https://img.your-domain.com/images/rio/1.jpg/format=webp,width=200"

# 预期响应头：
#   HTTP/2 200
#   content-type: image/webp
#   cache-control: max-age=31622400
```

---

## 资源清理

```bash
terraform destroy -auto-approve
```

> ⚠️ 清理后所有图片数据将无法恢复，请提前确认。

---

## 故障排除

### Terraform init 失败（Provider 下载超时）

参考 [Provider 离线镜像配置](../skill/docs/00-methodology.md#provider-离线镜像配置)。

### 函数调用返回 403

检查 IAM Agency 是否正确绑定到函数，以及 Agency 的权限策略是否包含 `OBS:GetObject` 和 `OBS:PutObject`。

### CDN 备源未触发

确认 OBS 桶中不存在请求路径的图片（应返回 404）。若 OBS 返回其他错误码，备源不会触发。

### 图片处理超时

检查函数超时配置（默认 60s）。大图片处理可能需要增加超时时间或内存。

---

## 相关文档

- [架构说明](./architecture.md)
- [函数适配指南](./function-adaptation.md)
- [华为云 CDN 文档](https://support.huaweicloud.com/cdn/)
- [华为云 OBS 文档](https://support.huaweicloud.com/obs/)
- [华为云 FunctionGraph 文档](https://support.huaweicloud.com/functiongraph/)
