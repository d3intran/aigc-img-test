# Cloudflare Pages & Workers 部署指南

本项目采用云边协同架构：
*   **后端 API**：部署在 **Cloudflare Workers** 上，用于运行高精度的盲水印安全提取和 Llava 视觉大模型。
*   **前端网页**：部署在 **Cloudflare Pages** 上，用于提供简洁的交互界面和本地信道攻击模拟沙箱。
*(注：项目配置文件中已设置 `assets` 托管，您也可以直接将整个项目打包通过一个 Worker 路由同时提供前后端服务)*。

---

## 一、 如何直接部署前端到 Cloudflare Pages？

Cloudflare 提供了多种 API 和工具用于将 `./public` 目录部署到 Pages：

### 方法 1：使用 Wrangler CLI 接口（最简单、可编程）
Wrangler 命令行工具内置了 Pages 部署 API，可以直接在控制台中运行以下命令：

```bash
# 1. 登录你的 Cloudflare 账号（第一次使用需要）
npx wrangler login

# 2. 一键部署静态文件夹
npx wrangler pages deploy ./public --project-name aigc-eval
```
*   **API 机制**：Wrangler 底层会将整个 `./public` 目录打包，计算哈希值，并通过 Cloudflare Pages HTTP REST API 批量上传部署。部署完成后，CLI 会直接输出一个公网访问域名（如 `https://aigc-eval.pages.dev`）。

### 方法 2：使用 GitHub 自动构建 API (Git 联动)
这是生产环境中最推荐的做法，完全自动化：
1. 将代码推送至你的 GitHub/GitLab 仓库。
2. 登录 Cloudflare Dashboard ➡️ **Workers & Pages** ➡️ **Create** ➡️ **Pages** ➡️ **Connect to Git**。
3. 选择你的项目仓库，构建设置中选择 `None` (静态 HTML)，并将 **Build output directory** 设为 `public`。
4. 点击保存。此后每次 `git push`，Cloudflare 都会自动拉取代码并部署。

### 方法 3：使用 Cloudflare 官方 REST API (程序化对接)
如果你想通过代码（如 Node.js 脚本、Python 自动化）直接部署，可以调用 Cloudflare client v4 API：

*   **创建 Pages 项目 API**：
    ```http
    POST https://api.cloudflare.com/client/v4/accounts/{account_id}/pages/projects
    Headers:
      Authorization: Bearer <CLOUDFLARE_API_TOKEN>
      Content-Type: application/json
    Body:
      {
        "name": "aigc-eval",
        "production_branch": "main"
      }
    ```
*   **直接上传文件包并部署 API**：
    官方提供了 `wrangler` 底层调用的上传端点，由于需要批量分块上传文件并计算哈希，在自定义脚本中直接调用较为复杂。推荐直接在 CI/CD 脚本中集成 `npx wrangler pages deploy ./public`。

---

## 二、 如何部署后端到 Cloudflare Workers？

由于我们的前端代码中使用了相对路径 `/evaluate`，当你把前后端合并部署时，部署 Worker 会自动同时激活前后端。

运行以下命令即可一键部署 Worker：

```bash
# 在 E:\大三下\媒体安全\aigc-worker 目录下运行：
npx wrangler deploy
```

部署成功后，系统会输出 Worker 的公网 URL（例如 `https://aigc-worker.<your-subdomain>.workers.dev`）。你可以直接在浏览器里访问该 URL 体验完整系统。
