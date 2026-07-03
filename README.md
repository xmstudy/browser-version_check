# 版本变化监听器

轻量级 Chrome 浏览器插件：监听网页 DOM 元素中的版本号变化，并通过飞书 Webhook 推送通知。适用于 MQL5 EA 更新页、软件发布页等需要盯版本的场景。

**当前版本：1.1.0** · Manifest V3 · 纯 Vanilla JS，无构建依赖

---

## 功能特性

| 特性 | 说明 |
|------|------|
| 可视化选元素 | 在页面上点击即可选取版本号 DOM，自动生成 CSS 选择器 |
| 多标签页监听 | 同时监听多个 EA / 页面，每个目标独立备注名 |
| 实时 DOM 监听 | `MutationObserver` 零轮询，DOM 变化时即时检测 |
| 刷新后检测 | 页面加载 / 刷新后自动对比版本，适合「必须刷新才显示新版本」的站点 |
| 定时刷新 | 可选手动输入秒数，自动刷新所有监听中的标签页 |
| 飞书通知 | 支持卡片消息 + 可选 `@所有人` 手机强提醒 |
| 按需注入 | 不注册全局 content script，仅在启用监听时注入，占用低 |
| 私有部署 | 本地加载已解压扩展，无需上架 Chrome 商店 |

---

## 项目结构

```
version_check/
├── manifest.json              # 插件入口
├── config.local.js            # 本地 Webhook 配置（勿提交 Git）
├── config.local.example.js    # Webhook 配置模板
├── popup/                     # 配置弹窗 UI
├── content/content.js         # 元素选择 + 多目标 MutationObserver
├── background/service-worker.js  # 飞书通知 + 定时刷新 + 多 tab 调度
├── icons/                     # 插件图标
├── scripts/package.ps1        # 打包脚本
├── test/
│   ├── test-page.html         # 本地测试页
│   └── validate.js            # 结构校验脚本
└── chrome-extension/          # 打包输出目录（可直接加载）
```

---

## 环境要求

- **浏览器**：Chrome / Edge（Chromium 内核）
- **权限**：开发者模式（私有加载）
- **飞书**：群自定义机器人 Webhook URL
- **可选**：Node.js（本地 HTTP 测试、`npx serve`）

---

## 安装

### 方式一：加载开发目录

1. 打开 `chrome://extensions/`
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择项目根目录或 `chrome-extension/` 文件夹

### 方式二：打包后加载

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package.ps1 -IncludeWebhook
```

生成：

- `chrome-extension/` — 可直接加载的文件夹
- `version-check-v1.1.0.zip` — 备份 / 拷贝到其他电脑

> 带 `-IncludeWebhook` 会将 `config.local.js` 打入包内，**请勿外传 zip**。

### 配置飞书 Webhook

1. 复制模板：
   ```powershell
   copy config.local.example.js config.local.js
   ```
2. 编辑 `config.local.js`，填入 Webhook URL：
   ```javascript
   window.DEFAULT_FEISHU_WEBHOOK =
     'https://open.feishu.cn/open-apis/bot/v2/hook/你的token';
   ```

或在插件 popup 中手动填写 Webhook。

**飞书机器人配置要点：**

- 群设置 → 群机器人 → 添加 **自定义机器人**
- 建议开启 **自定义关键词**（如「版本」），关闭 **IP 白名单** 和 **签名校验**（当前插件未实现签名校验）
- 开启 **@所有人** 需在群管理中允许所有成员 @所有人

---

## 使用指南

### 1. 添加监听目标（支持多个 EA）

对每个需要监听的页面：

1. 在 Chrome 中打开目标页面（**每个 EA 单独一个标签页**）
2. 点击插件图标
3. （可选）填写 **备注名**，如 `Twister Pro EA`
4. 点击 **「添加当前页到监听列表」**
5. 在页面上 **点击版本号所在的 DOM 元素**
6. 重复以上步骤，添加其他 EA 页面

### 2. 配置版本提取

| 模式 | 适用场景 |
|------|----------|
| **全文对比** | 元素文本即为版本号 |
| **正则提取** | 从 `Version 2.1.0` 中提取 `2.1.0`，默认：`v?(\d+\.\d+\.\d+)` |

新添加的监听项使用当前 popup 中的提取规则。

### 3. 开始监听

1. 填写飞书 Webhook（若 `config.local.js` 已配置会自动填入）
2. （可选）勾选 **手机强提醒（@所有人）**
3. （可选）勾选 **定时刷新页面**，输入间隔 **秒数**（最小 30 秒，默认 900）
4. 点击 **「开始全部监听」**

### 4. 保持标签页打开

插件仅在 **标签页打开** 时工作。关闭某 EA 的标签页后，该目标暂停监听；重新打开并刷新页面后会自动恢复（若仍处于监听状态）。

---

## 本地测试

### 启动测试页

```powershell
cd E:\Project\version_check
npx --yes serve .
```

访问：`http://127.0.0.1:3000/test/test-page.html`

### 测试步骤

1. 加载插件 → 添加测试页到监听列表 → 选择 `#version` 元素
2. **测试通知** → 确认飞书收到消息
3. **开始全部监听** → 点击「模拟版本更新」→ 确认飞书收到版本变化提醒
4. 勾选定时刷新，设置 `60` 秒，验证页面自动刷新

### 结构校验

```powershell
node test/validate.js
```

---

## 工作原理

```
用户选择 DOM 元素 → 保存到 watches 列表
        ↓
开始全部监听 → 向每个匹配的标签页注入 content script
        ↓
┌─────────────────────────────────────────────┐
│  MutationObserver  │  页面加载/刷新对比      │
│  （DOM 实时变化）   │  （refresh 检测）       │
└─────────────────────────────────────────────┘
        ↓
版本变化 → background → 飞书 Webhook 卡片通知
        ↓
（可选）chrome.alarms 定时刷新所有监听 tab
```

---

## 打包与更新

```powershell
# 打包（含 Webhook，仅自用）
powershell -ExecutionPolicy Bypass -File scripts/package.ps1 -IncludeWebhook

# 打包（不含密钥，适合分享代码）
powershell -ExecutionPolicy Bypass -File scripts/package.ps1
```

**每次修改代码后：**

1. `chrome://extensions/` → 刷新插件
2. 刷新各监听页面（F5）
3. 重新点击 **开始全部监听**（若已停止）

---

## 常见问题

### `Extension context invalidated`

在扩展管理页刷新了插件，但网页未刷新。  
**处理**：F5 刷新目标页 → 重新 **开始全部监听**。

### 测试通知 OK，但版本变化不通知

- 确认已点击 **开始全部监听**
- 确认目标标签页仍打开
- 确认选择了正确的 DOM 元素
- 若版本需刷新才更新，请开启 **定时刷新**

### 手机收不到通知

- 勾选 **手机强提醒（@所有人）**
- 飞书群允许成员 @所有人
- 检查手机飞书 App 通知权限

### 连续点击测试只有第一次通知

已移除 60 秒冷却；每个 **不同版本** 都会通知，同一版本只通知一次。

### 飞书 Webhook 在浏览器直接打开报错

`{"code":19002,"msg":"params error, msg_type need"}` 为正常现象，Webhook 只接受 POST 请求。

---

## 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 保存监听列表、Webhook、版本记录 |
| `activeTab` | 在当前标签页注入选择器脚本 |
| `scripting` | 按需注入 content script |
| `alarms` | 定时刷新页面（可选） |

未申请 `<all_urls>`；飞书请求由 Service Worker 发出，不受页面 CORS 限制。

---

## 安全提示

- `config.local.js` 含 Webhook 密钥，已加入 `.gitignore`
- 勿将含 Webhook 的 zip 上传到公开仓库
- Webhook 泄露后请在飞书群中重置机器人地址

---

## 许可证

私有使用。按需修改与分发。

---

## 更新日志

### v1.1.0

- 支持多标签页 / 多 EA 同时监听
- 监听列表管理（添加、删除、备注名）
- 飞书通知显示目标名称

### v1.0.x

- 单页面 DOM 监听 + 飞书 Webhook
- 刷新后版本对比、定时刷新（秒级输入）
- `@所有人` 手机强提醒
- 插件重载检测与自动重新注入
