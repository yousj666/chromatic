# BetterNCM yousj-plus 增强分支说明

## 这个分支是什么

- 仓库：`yousj666/chromatic`（上游 `std-microblock/chromatic` 的 Fork；
  该仓库原名 BetterNCM，上游已把主线改名为 chromatic 新项目）
- 分支：`yousj-plus`，**从上游存档分支 `v2` 切出**（切出点 `1b7eb7f`），
  不是从 `master` 切的——`master` 是作者重写的新项目 chromatic
  （通用 Chromium/V8 修改器），真正的 BetterNCM（网易云 PC 客户端
  插件框架）代码在 `v2` 分支，最后一版 Release 为 1.3.4，本分支基于它增强。
- 本分支不改 `master` 的任何内容。

## 工作笔记：v2 插件机制（读源码得出的结论）

来源：`src/PluginManager.{h,cpp}`、`src/App.cpp`、`src/dllmain.cpp`，
以及子模块 `src/js-framework`（BetterNCM/js-framework）的
`src/loader.ts`、`src/plugin.ts`、`src/betterncm-api/*`。

- **数据目录**：环境变量 `BETTERNCM_PROFILE`，否则 `C:\betterncm`。
  - 打包插件：`<数据目录>/plugins/*.plugin`
  - 解压后运行时：`<数据目录>/plugins_runtime/<slug>/`
  - 开发插件：`<数据目录>/plugins_dev/<目录>/manifest.json`（文件夹形式，支持热重载）
  - 禁用名单：`<数据目录>/disable_list.txt`（按 slug）
- **`.plugin` 格式**：就是 zip，根目录必须有 `manifest.json`；
  `PluginManager::extractPackedPlugins()` 校验 manifest 后解压到
  `plugins_runtime/<slug>/`。`manifest_version` 必须为 1，其余版本直接报错。
- **manifest 字段**（`PluginManifest::from_json`）：
  `manifest_version, name, slug（缺省由 name 生成）, version, author,
  description, betterncm_version, preview, startup_script（默认 startup_script.js）,
  injects, hijacks, native_plugin, ncm3-compatible, ncm-version-req（默认 >2.10.2）`。
  其中 `injects` 形如 `{ "Main": [{ "file": "main.js" }] }`，由 JS 框架在
  主页面 `/pub/app.html` 加载；真实插件示例（RefinedNowPlaying、InfinityLink）
  均用 injects 形式，本分支新插件也用这一形式。
- **插件 JS 上下文**：框架以 `AsyncFunction("plugin", code)` 执行 inject 文件，
  传入 `plugin` 对象（`NCMInjectPlugin`），提供：
  - `plugin.onLoad(fn)` / `plugin.onAllPluginsLoaded(fn)` / `plugin.onConfig(fn)`
  - `plugin.getConfig(key, def)` / `plugin.setConfig(key, val)`
    （存 localStorage `config.betterncm.<slug>`）
  - `onConfig` 的回调参数是 configToolBox（含 makeBtn/makeInput/makeCheckbox），返回设置页 DOM。
- **全局 `betterncm` API**（js-framework 注入，经本体 `http://localhost:<port>/api` + API Key 调用）：
  - `betterncm.fs.*`：readDir / readFileText / readFile / writeFile / writeFileText /
    mkdir / exists / remove / unzip / mountDir / mountFile
    （服务端实现见 `src/App.cpp` 的 `/api/fs/*`；相对路径基于数据目录，
    `write_file` 不自动建父目录，需先 `mkdir`）
  - `betterncm.app.*`：getDataPath / getNCMPath / readConfig / writeConfig /
    reloadPlugins / exec / openFileDialog 等
  - `betterncm.ncm.*`：getPlayingSong()（找客户端内部 getPlaying）、openUrl 等
  - `betterncm.utils.*`：waitForElement / waitForFunction / delay / dom
- **本体唯一的“内置”插件**是 PluginMarket：`dllmain.cpp` 在数据目录不存在
  `plugins/PluginMarket.plugin` 时从资源里解出。所以本分支的新插件定位为
  **随仓库分发的内置插件**：源码放 `builtin-plugins/`，打包好的
  `.plugin` 一并提交，安装器一键安装时预装（见 Installer 的 yousj-plus 分支）。

## 本分支内置了什么

### MVDownloader 插件（`builtin-plugins/MVDownloader/`）

- 搜索：网易云音乐自己的官方搜索接口 `/api/search/get/web`
  （type=1 歌曲 / type=1004 MV），不接第三方源。
- MV 下载：官方 `/api/mv/detail` 的 `data.brs` 取最高可用画质直链
  （失败回退 `/api/mv/url`），经 `betterncm.fs.writeFile` 保存为 `.mp4`
  （失败回退浏览器 `<a download>` 下载）。详见插件目录里的 README。
- 打包产物：`builtin-plugins/MVDownloader.plugin`
  （`python3 builtin-plugins/pack.py` 可重新生成）。

## 怎么装

1. 本体：用 BetterNCM Installer（推荐 yousj-plus 增强版，见
   `yousj666/BetterNCM-Installer` 的 `yousj-plus` 分支）一键安装；
   或按上游 README 手动把构建出的 `BetterNCMII.dll` 改名 `msimg32.dll`
   放进网易云安装目录。本体是 Windows C++ DLL，需要在 Windows 上用
   Visual Studio + vcpkg 构建（本分支未改本体构建流程）。
2. 插件：把 `builtin-plugins/MVDownloader.plugin` 复制到
   `<BetterNCM 数据目录>/plugins/`（默认 `C:\betterncm\plugins\`），
   重启网易云客户端。用增强版安装器一键安装时会自动预装这一步。

## 怎么用

1. 打开网易云 PC 客户端，主页面右下角会出现红色悬浮按钮「MV 下载」。
2. 点开面板：输入关键词 → 选「歌曲」或「MV」→ 搜索 →
   结果行点「下载 MV」；或直接点「下载当前播放歌曲的 MV」。
3. 文件默认保存到 `<BetterNCM 数据目录>/mv-downloads/`，
   画质、目录、文件名模板可在 插件管理器 → MVDownloader → 设置 里改。

## 待真机验证（Windows 网易云客户端，尚未验证）

- 插件在真实客户端（2.10.x / 3.x）里的加载、悬浮按钮位置与面板样式。
- 客户端页面上下文里 fetch music.163.com 的 cookie/跨域行为；
  若官方 `/api/*` 接口在某版本被拦，需改为经客户端内部请求层调用。
- `betterncm.fs.writeFile` 保存大体积 MV（fetch 全量读入内存）的稳定性。
- MV 详情接口 `data.brs` 字段在当前网易云后端的实际返回（接口可能调整）。
