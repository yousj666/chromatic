# MVDownloader（内置插件）

BetterNCM `yousj-plus` 增强分支的内置插件：**用网易云音乐自己的搜索找歌/MV，一键下载 MV 为 .mp4。**

## 功能

- **搜索**：网易云官方 Web 搜索接口 `https://music.163.com/api/search/get/web`
  - `type=1` 搜歌曲（歌曲带 MV 的会显示「下载 MV」）
  - `type=1004` 搜 MV
  - 这是网易云网页版/客户端搜索的同一套官方后端，不接第三方搜索源。
- **MV 取址**：网易云官方 MV 详情接口 `/api/mv/detail` 的 `data.brs`
  （240/480/720/1080 → 官方 CDN MP4 直链），按设置画质选最高可用一档；
  详情接口失败时回退官方 `/api/mv/url?id=..&r=..`。
  - 注：`/weapi/mv/url` 需要网易云 NE 加密签名，该签名由客户端自身请求层生成，
    插件 fetch 无法直接复刻，故用任务允许的 mv detail 路线；取到的仍是官方直链。
- **保存**：首选 BetterNCM 本地文件 API `betterncm.fs.writeFile(路径, blob)`
  （本体 `POST /api/fs/write_file`），保存到
  `<BetterNCM 数据目录>/<下载目录>/<文件名>.mp4`；
  该 API 不可用/拉流失败时回退 `<a download>` 浏览器下载，并给出提示。
- **当前播放**：面板里有「下载当前播放歌曲的 MV」按钮，
  经 `betterncm.ncm.getPlayingSong()` 拿当前歌曲 id，再查官方歌曲详情接口的 MV 字段。
- **入口**：客户端主页面右下角悬浮按钮「MV 下载」，点开即搜索面板。

## 设置（插件管理器 → MVDownloader → 设置）

| 设置 | 键 | 默认 | 说明 |
|---|---|---|---|
| 默认画质 | `quality` | `highest` | `highest` 或上限 `1080/720/480/240` |
| 下载目录 | `downloadDir` | `mv-downloads` | 相对 BetterNCM 数据目录，或绝对路径 |
| 文件名模板 | `filenameTemplate` | `{artist} - {name}` | 支持 `{name} {artist} {id} {quality}`，自动加 `.mp4` |

设置经框架的 `plugin.getConfig/setConfig` 存取（localStorage `config.betterncm.MVDownloader`）。

## 错误处理

- 搜索接口非 200 / 网络失败：结果区红字提示。
- 歌曲没有 MV：列表显示「无 MV」；当前播放无 MV 时弹提示。
- MV 无可用地址 / 已下架：弹提示说明。
- 本地保存失败：自动回退浏览器下载，并在提示中说明走了回退。

## 安装

- 打包文件：`builtin-plugins/MVDownloader.plugin`（由 `../pack.py` 生成），
  复制到 `<BetterNCM 数据目录>/plugins/` 后重启客户端即可；
  用 yousj-plus 版 BetterNCM Installer 一键安装时会自动预装。
- 开发调试：把本目录（含 manifest.json、main.js）复制到
  `<BetterNCM 数据目录>/plugins_dev/MVDownloader/`，框架会以 dev 插件加载并热重载。

## 文件

- `manifest.json`：manifest_version=1，`injects.Main[0].file = main.js`
- `main.js`：全部逻辑（搜索 / 取址 / 下载 / UI / 设置页）
- `preview.png`：manifest 引用的预览图占位（1×1 透明 PNG），可在真机阶段换成截图
