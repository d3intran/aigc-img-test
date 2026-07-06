# 基于端云协同与多模态视觉大模型的 AIGC 图像显隐式标识评测系统

本项目是一套专为 **AIGC 生成合成内容** 开发的多维安全标识与合规性评测系统。系统遵循国家互联网信息办公室《生成式人工智能服务管理暂行办法》以及全国信息安全标准化技术委员会（TC260）《网络安全技术 人工智能生成合成内容标识方法》等指导性标准，对图像内容中的**显式标识（可见角标）**和**隐式标识（元数据、盲水印）**开展自动化、高置信度的评测。

---

## 🌐 在线体验与源码

*   **云端演示地址 (Pages)**：👉 [https://aigc-eval.pages.dev/](https://aigc-eval.pages.dev/)
*   **备用自定义域名**：👉 [https://aigc.d3in.app/](https://aigc.d3in.app/)
*   **GitHub 开源仓库**：👉 [https://github.com/d3intran/aigc-img-test](https://github.com/d3intran/aigc-img-test)

---

## ✨ 核心特性

1.  **端云协同架构 (Client-Cloud Collaboration)**：
    *   **端侧本地轻量级解析**：利用前端 HTML5 Canvas 像素级操作、`exif.js` 元数据读取、`Tesseract.js` 离线 OCR，以及实现**空间域 LCG 差分盲水印解码**，实现超高时效的本地初步审计。
    *   **云侧服务级深度审计**：依托 **Cloudflare Workers** 的 Serverless 架构构建高并发 API。包含底层的免解码二进制 PNG 文本块（tEXt）和 XML（XMP TC260）合规字段扫描器。
2.  **融入多模态视觉大模型**：
    *   云端接入边缘 GPU 节点的 **Llava 1.5** 视觉语言大模型（`llava-1.5-7b-hf`）。
    *   突破了传统硬字符 OCR 的限制，通过自然语言语义分析识破半透明、艺术化或倾斜的企业 AI 品牌标识（如通义千问、豆包、Gemini 的星芒图标等）。
3.  **零额度浪费的前端高性能缓存**：
    *   前端对 7 张内置系统样例图片（千问、豆包、Gemini、GPT 及 3 张仿真图片）执行了本地与云端评测结果双向缓存。
    *   点击内置样例可实现 **0.01 秒瞬间秒开**，完全不消耗云端 AI tokens 额度。仅在用户手动上传外部新图片时，才会实时发起 Workers 远程调用。

---

## 📁 项目目录结构

```text
E:\大三下\媒体安全
├── upload/                          # 大作业成果打包提交文件夹
│   ├── 端云协同系统.docx             # 最终排版完成的 Word 课程报告（含公式与截图）
│   ├── 端云协同架构.jpg              # 系统架构拓扑图（图1）
│   ├── 截图/                         # 4种商业平台样本评测结果的运行截图
│   │   ├── 千问检测结果.png
│   │   ├── 豆包检测结果.png
│   │   ├── Gemini检测结果.png
│   │   └── GPT检测结果.png
│   └── code/                        # 整理好的源代码提交包
│       ├── 前端显隐代码/             # index.html, evaluator.js, styles.css, watermark.js
│       └── 云端显隐代码/             # index.ts, wrangler.jsonc, package.json
│
├── aigc-worker/                     # Cloudflare Worker 运行与部署目录
│   ├── src/index.ts                 # 后端 Worker 主程序（元数据扫描与 Workers AI Llava 推理）
│   ├── public/                      # 前端静态网站目录
│   ├── wrangler.jsonc               # 部署配置文件
│   └── package.json                 # Node 项目依赖配置文件
│
├── ai-pics/                         # 4张真实商业 AIGC 测试源图样本
├── generate_samples.py              # 用于生成 3 张系统仿真测试样本的 Python 脚本
├── .gitignore                       # 过滤了依赖包与临时凭证的 Git 忽略规则
└── README.md                        # 本项目说明文档
```

---

## 🛠️ 本地运行与部署指南

### 1. 前端本地启动 (Python)
在根目录下直接启动静态服务器以运行本地静态解析部分：
```bash
python -m http.server 8080
```
在浏览器中打开 `http://localhost:8080` 即可访问。

### 2. 后端 Worker 启动 (Wrangler)
进入 `aigc-worker` 目录，安装依赖并在本地以 remote 模式运行以连通云端 AI：
```bash
cd aigc-worker
npm install
npx wrangler dev --port 8787 --remote
```
*本地网页端发送的评测请求在检测到 8080 端口时，会自动跨域转发到本地 `8787` Wrangler 调试端口中。*

### 3. 发布到 Cloudflare Pages
若要发布到公网，直接使用 wrangler pages 部署：
```bash
npx wrangler pages deploy ./public --project-name aigc-eval
```

---

## 📊 真实 AIGC 样本评测合规度汇总

依据本评测系统的检测结果：

| 生成平台 | 显式角标检测 | 隐式元数据检测 | 本地 LCG 像素水印 | 综合合规评估 |
| :--- | :--- | :--- | :--- | :--- |
| **通义千问** | 已检出 (文字 + Logo) | 已检出 (PNG tEXt 阿里字段) | 未检出 (0%) | **完全合规** (满足国内双重标识要求) |
| **火山豆包** | 已检出 (文字 + Logo) | 已检出 (符合国标 TC260 命名空间) | 未检出 (0%) | **完全合规** (满足国内双重标识要求) |
| **Google Gemini** | 部分检出 (星芒图标，OCR失败，Llava识别) | 未检测到 | 未检出 (0%) | **部分合规** (仅含可见图示，缺少规范元数据) |
| **OpenAI GPT** | 未检出 (原图无任何角标) | 未检测到 | 未检出 (0%) | **不合规** (未满足国内双重标识强制规范) |

*像素级 LCG 水印比对率在商业大模型中为 0% 属于正常现象，因为真实平台多采用闭源专利的频域隐写（如 DeepMind SynthID 或 C2PA 签名），证明了系统检测的真实性。*
