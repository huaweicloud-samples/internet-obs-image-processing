# 架构说明

## 整体架构

```
用户浏览器
    │
    ▼
华为云 CDN (img.example.com)
    │
    ├─[缓存命中]─→ 返回处理后图片（直接响应）
    │
    └─[缓存未命中]─→ OBS Bucket (主源)
                            │
                            │ 404 / 503
                            ▼
                      FunctionGraph URL (备源)
                            │
                            ▼
                      图片处理函数 (Sharp)
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
        OBS transformed/            CDN 缓存结果
        (写入处理后图片)
```

## 核心组件

### 1. CDN（内容分发网络）

- **域名**：`img.example.com`（需配置 CNAME 指向华为云 CDN）
- **源站组**：OBS 为主源、函数 URL 为备源
- **缓存规则**：`/images/*` 路径缓存 1 年
- **备源触发**：OBS 返回 404 或 503 时自动切换到函数

### 2. OBS 桶

| 桶名 | 用途 | ACL |
|------|------|------|
| `img-orig-{name}-prod` | 原始图片存储 | Private |
| `img-transformed-{name}-prod` | 处理后图片（CDN 主源） | Public-Read |

### 3. FunctionGraph 函数

- **运行时**：Node.js 18.x
- **内存**：1536 MB
- **超时**：60 秒
- **触发方式**：HTTP 触发器（CDN 备源调用）
- **VPC**：函数通过专有网络访问 OBS

### 4. IAM Agency

- **名称**：`FGS-OBS-Access-{project}`
- **权限**：`OBS:GetObject`、`OBS:PutObject`
- **绑定**：函数通过 Agency 身份访问 OBS

---

## 数据流详解

### 首次请求（冷路径）

1. 用户请求 `https://img.example.com/images/rio/1.jpg/format=webp,width=200`
2. CDN 查找缓存 → **未命中**
3. CDN 向 OBS 主源发起请求 → OBS 中无此路径 → **返回 404**
4. CDN 跟随备源 → 调用 FunctionGraph URL
5. 函数从「原始图片桶」下载源图（`images/rio/1.jpg`）
6. Sharp 执行格式转换（jpg → webp）和缩放（width=200）
7. 函数将处理结果以同一路径写回「处理后图片桶」（`images/rio/1.jpg/format=webp,width=200`）
8. 函数返回处理后图片（携带 `Cache-Control: max-age=31536000`）
9. CDN 缓存该响应
10. 返回给用户

### 后续请求（热路径）

1. 用户请求相同 URL
2. CDN 查找缓存 → **命中**
3. 直接返回缓存图片（无需函数处理）

---