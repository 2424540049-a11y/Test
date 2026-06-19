# 期货行情云端版

这个文件夹是正式云端部署用版本。部署成功后，App 会运行在云服务器上，不再依赖你的电脑开机。

当前支持品类：沪铝、螺纹钢。

## 文件位置

```text
C:\Users\lele\Desktop\云端\沪铝期货云端版
```

## 推荐部署方式：Render

1. 打开 GitHub，新建一个仓库，例如 `shfe-aluminum-app`。
2. 把本文件夹里的所有文件上传到这个仓库。
3. 打开 Render，选择 `New` -> `Blueprint`。
4. 连接刚才的 GitHub 仓库。
5. Render 会自动读取 `render.yaml`，按 Node 服务部署。
6. 部署完成后会得到一个 HTTPS 地址，例如：

```text
https://shfe-aluminum-app.onrender.com
```

之后手机和其他电脑都打开这个 HTTPS 地址即可。你的电脑关机也不影响使用。

## 备用部署方式：Railway

1. 打开 Railway，选择 `New Project`。
2. 选择从 GitHub 仓库部署。
3. 选择这个项目仓库。
4. Railway 会读取 `railway.json` 并运行：

```text
npm start
```

部署完成后，使用 Railway 提供的 HTTPS 域名访问。

## Docker 部署

如果你使用支持 Docker 的云服务器，可以在本目录运行：

```powershell
docker build -t shfe-aluminum-app .
docker run -p 8787:8787 shfe-aluminum-app
```

正式服务器上建议把外部 HTTPS 域名反向代理到容器端口。

## 本地测试

在本目录运行：

```powershell
npm start
```

然后打开：

```text
http://localhost:8787
```

健康检查地址：

```text
http://localhost:8787/health
```

## 手机安装

部署到 Render 或 Railway 后，用手机浏览器打开云端 HTTPS 地址：

- iPhone：用 Safari 打开，点分享按钮，选择“添加到主屏幕”。
- 安卓：用 Chrome 或 Edge 打开，点菜单，选择“安装应用”或“添加到主屏幕”。

## 注意

- 免费云平台可能会休眠，第一次打开可能慢一些。
- 行情和 K 线来自新浪财经公开接口，可能延迟或短暂不可用。
- 真正交易决策请以交易所及券商终端为准。
