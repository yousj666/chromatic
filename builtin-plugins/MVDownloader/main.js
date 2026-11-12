/**
 * MVDownloader —— BetterNCM 内置插件（yousj-plus 增强分支）
 *
 * 功能：
 *   1. 搜索：只用网易云音乐自己的搜索。
 *      走 music.163.com 官方 Web 接口 `/api/search/get/web`
 *      （type=1 搜歌曲、type=1004 搜 MV），这就是网易云网页版/客户端
 *      搜索用的同一套官方后端，不接任何第三方搜索源。
 *   2. MV 下载：先用网易云官方 MV 详情接口 `/api/mv/detail`
 *      拿到 `data.brs`（240/480/720/1080 → 播放地址映射），
 *      按设置里选的画质挑最高可用的一档；详情接口拿不到时
 *      回退到官方 `/api/mv/url?id=..&r=..` 接口。
 *      说明：`/weapi/mv/url` 需要网易云的 NE 加密参数，该签名由
 *      客户端自身的请求层生成，插件侧的 fetch 无法直接复刻，
 *      所以这里用同属网易云官方的 mv detail 接口取址（任务允许的
 *      两条路线之一），地址本身是网易云官方 CDN 的 MP4 直链。
 *   3. 保存 .mp4 —— 走 BetterNCM 本地文件 API：
 *      `betterncm.fs.writeFile(path, blob)`（对应本体 HTTP API
 *      `POST /api/fs/write_file`，见 v2 源码 src/App.cpp 与
 *      js-framework 的 betterncm-api/fs.ts），相对路径会落到
 *      BetterNCM 数据目录（BETTERNCM_PROFILE 或 C:\betterncm）下。
 *      若该 API 不可用或跨域拉流失败，则回退为浏览器下载
 *      （<a download> 点击直链），并在提示里说明走了回退路线。
 *
 * 插件格式：BetterNCM v2 manifest_version=1，
 * injects.Main[0].file = main.js，本文件以
 * AsyncFunction("plugin", code) 方式被框架加载，
 * 因此顶层可直接使用框架传入的 `plugin` 对象，
 * 以及全局 `betterncm` API（js-framework 提供）。
 */

var MVDL_PREFIX = "[MVDownloader]";

/* ---------------- 配置（plugin.getConfig/setConfig，存 localStorage） ---------------- */

function mvdlGetConfig(key, defaultValue) {
    try {
        if (typeof plugin !== "undefined" && plugin && plugin.getConfig) {
            var v = plugin.getConfig(key, defaultValue);
            return v === undefined || v === null ? defaultValue : v;
        }
    } catch (e) { /* 框架未就绪时用默认值 */ }
    return defaultValue;
}

function mvdlSetConfig(key, value) {
    try {
        if (typeof plugin !== "undefined" && plugin && plugin.setConfig) {
            plugin.setConfig(key, value);
        }
    } catch (e) {
        console.error(MVDL_PREFIX, "保存设置失败", e);
    }
}

/** 默认画质：highest=最高可用，其余为上限（如 720 表示不超过 720p 的最高一档） */
function mvdlQuality() {
    return String(mvdlGetConfig("quality", "highest"));
}

/** 下载目录：相对 BetterNCM 数据目录的相对路径，或以 X:\ 开头的绝对路径 */
function mvdlDownloadDir() {
    return String(mvdlGetConfig("downloadDir", "mv-downloads"));
}

/** 文件名模板：支持 {name} {artist} {id} {quality} */
function mvdlFilenameTemplate() {
    return String(mvdlGetConfig("filenameTemplate", "{artist} - {name}"));
}

/* ---------------- 小工具 ---------------- */

function mvdlLog() {
    var args = [MVDL_PREFIX];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
}

function mvdlSanitizeFilename(name) {
    return String(name || "mv")
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120) || "mv";
}

function mvdlBuildFilename(meta, quality) {
    var tpl = mvdlFilenameTemplate();
    var out = tpl
        .replace(/\{name\}/g, meta.name || "")
        .replace(/\{artist\}/g, meta.artist || "")
        .replace(/\{id\}/g, String(meta.mvId || ""))
        .replace(/\{quality\}/g, String(quality || ""));
    return mvdlSanitizeFilename(out) + ".mp4";
}

var mvdlToastTimer = null;
function mvdlToast(msg) {
    mvdlLog(msg);
    var el = document.getElementById("mvdl-toast");
    if (!el) {
        el = document.createElement("div");
        el.id = "mvdl-toast";
        el.style.cssText =
            "position:fixed;left:50%;bottom:96px;transform:translateX(-50%);" +
            "z-index:1000001;background:rgba(20,20,20,.92);color:#fff;" +
            "padding:10px 18px;border-radius:8px;font-size:13px;" +
            "max-width:70vw;text-align:center;pointer-events:none;";
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = "block";
    if (mvdlToastTimer) clearTimeout(mvdlToastTimer);
    mvdlToastTimer = setTimeout(function () { el.style.display = "none"; }, 3600);
}

/* ---------------- 网易云官方接口 ---------------- */

var MVDL_API_BASE = "https://music.163.com";

async function mvdlFetchJson(url) {
    var res = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: { "Accept": "application/json" },
    });
    if (!res.ok) throw new Error("网易云接口 HTTP " + res.status);
    return await res.json();
}

/**
 * 网易云自己的搜索（官方 Web 接口，和网页版搜索同一后端）。
 * type: 1=歌曲，1004=MV
 */
async function mvdlSearch(keyword, type, limit) {
    var q = new URLSearchParams({
        csrf_token: "",
        hlpretag: "",
        hlposttag: "",
        s: keyword,
        type: String(type),
        offset: "0",
        total: "true",
        limit: String(limit || 20),
    });
    var json = await mvdlFetchJson(MVDL_API_BASE + "/api/search/get/web?" + q.toString());
    if (!json || json.code !== 200) {
        throw new Error("搜索接口返回异常 code=" + (json && json.code));
    }
    return json.result || {};
}

/**
 * 解析网易云官方 MV 播放地址。
 * 主路线：/api/mv/detail → data.brs { "240": url, "480": url, ... }
 * 回退： /api/mv/url?id=..&r=<画质> → data.url
 * 返回 { url, quality }，quality 是实际拿到的画质数字（如 1080）。
 */
async function mvdlResolveMvUrl(mvId) {
    var wanted = mvdlQuality();
    var cap = wanted === "highest" ? Infinity : parseInt(wanted, 10);

    // 主路线：MV 详情接口
    try {
        var detail = await mvdlFetchJson(MVDL_API_BASE + "/api/mv/detail?id=" + encodeURIComponent(mvId));
        var data = detail && detail.data;
        var brs = data && data.brs;
        if (brs) {
            var levels = Object.keys(brs)
                .map(function (k) { return parseInt(k, 10); })
                .filter(function (n) { return !isNaN(n) && brs[String(n)]; })
                .sort(function (a, b) { return b - a; });
            if (levels.length) {
                var underCap = levels.filter(function (n) { return n <= cap; });
                var chosen = underCap.length ? underCap[0] : levels[levels.length - 1];
                return { url: brs[String(chosen)], quality: chosen };
            }
        }
    } catch (e) {
        mvdlLog("mv/detail 取址失败，尝试 mv/url 回退：", e);
    }

    // 回退路线：官方 mv/url 接口（r 为请求的分辨率上限）
    var r = cap === Infinity ? 1080 : cap;
    var urlJson = await mvdlFetchJson(
        MVDL_API_BASE + "/api/mv/url?id=" + encodeURIComponent(mvId) + "&r=" + r
    );
    var u = urlJson && urlJson.data && urlJson.data.url;
    if (!u) throw new Error("该 MV 没有可用的播放地址（可能下架或地区受限）");
    return { url: u, quality: (urlJson.data && urlJson.data.r) || r };
}

/* ---------------- 下载保存 ---------------- */

/**
 * 下载并保存为 .mp4。
 * 首选 BetterNCM 本地文件 API：betterncm.fs.writeFile(相对路径, blob)，
 * 文件落到 <BetterNCM 数据目录>/<downloadDir>/<文件名>。
 * 失败回退：<a download> 浏览器下载（走客户端自带下载/或系统默认处理）。
 */
async function mvdlDownload(mvId, meta) {
    mvdlToast("正在解析 MV 地址：" + (meta.name || mvId));
    var resolved;
    try {
        resolved = await mvdlResolveMvUrl(mvId);
    } catch (e) {
        mvdlToast("解析 MV 地址失败：" + e.message);
        return;
    }

    var filename = mvdlBuildFilename(
        { name: meta.name, artist: meta.artist, mvId: mvId },
        resolved.quality
    );
    var dir = mvdlDownloadDir().replace(/[\\/]+$/, "");
    var savePath = dir + "/" + filename;

    // 首选：拉流 + betterncm.fs 落盘
    try {
        if (typeof betterncm === "undefined" || !betterncm.fs || !betterncm.fs.writeFile) {
            throw new Error("betterncm.fs 不可用");
        }
        mvdlToast("正在下载 MV（" + resolved.quality + "p）：" + filename);
        var res = await fetch(resolved.url);
        if (!res.ok) throw new Error("MV 拉流 HTTP " + res.status);
        var blob = await res.blob();
        if (!blob.size) throw new Error("MV 数据为空");
        if (betterncm.fs.mkdir) {
            try { await betterncm.fs.mkdir(dir); } catch (e) { /* 目录已存在等情况忽略 */ }
        }
        var ok = await betterncm.fs.writeFile(savePath, blob);
        if (ok === false) throw new Error("betterncm.fs.writeFile 返回失败");
        mvdlToast("下载完成：" + savePath);
        return;
    } catch (e) {
        mvdlLog("本地文件 API 保存失败，回退浏览器下载：", e);
    }

    // 回退：a[download] 直链下载
    try {
        var a = document.createElement("a");
        a.href = resolved.url;
        a.download = filename;
        a.target = "_blank";
        a.rel = "noreferrer";
        document.body.appendChild(a);
        a.click();
        a.remove();
        mvdlToast("本地保存失败，已改用浏览器下载：" + filename);
    } catch (e2) {
        mvdlToast("下载失败：" + e2.message);
    }
}

/* ---------------- 搜索 UI ---------------- */

function mvdlEl(tag, cssText, text) {
    var el = document.createElement(tag);
    if (cssText) el.style.cssText = cssText;
    if (text !== undefined) el.textContent = text;
    return el;
}

function mvdlRenderResults(container, items) {
    container.innerHTML = "";
    if (!items.length) {
        container.appendChild(mvdlEl("div", "padding:10px;color:#999;font-size:12px;", "没有找到带 MV 的结果，换个关键词试试。"));
        return;
    }
    items.forEach(function (item) {
        var row = mvdlEl("div",
            "display:flex;align-items:center;gap:8px;padding:7px 8px;border-bottom:1px solid rgba(127,127,127,.25);");
        var info = mvdlEl("div", "flex:1;min-width:0;");
        var title = mvdlEl("div",
            "font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;",
            item.name || "(无标题)");
        var sub = mvdlEl("div",
            "font-size:11px;color:#999;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;",
            (item.artist || "") + (item.extra ? " · " + item.extra : ""));
        info.appendChild(title);
        info.appendChild(sub);
        row.appendChild(info);
        if (item.mvId) {
            var btn = mvdlEl("button",
                "flex:none;cursor:pointer;border:0;border-radius:6px;padding:5px 10px;" +
                "background:#ec4141;color:#fff;font-size:12px;",
                "下载 MV");
            btn.addEventListener("click", function () {
                mvdlDownload(item.mvId, item);
            });
            row.appendChild(btn);
        } else {
            row.appendChild(mvdlEl("span", "flex:none;font-size:11px;color:#999;", "无 MV"));
        }
        container.appendChild(row);
    });
}

async function mvdlDoSearch(keyword, mode, container) {
    container.innerHTML = "";
    container.appendChild(mvdlEl("div", "padding:10px;color:#999;font-size:12px;", "搜索中…（网易云官方搜索）"));
    try {
        var items = [];
        if (mode === "mv") {
            var mvResult = await mvdlSearch(keyword, 1004, 20);
            (mvResult.mvs || []).forEach(function (mv) {
                items.push({
                    mvId: mv.id,
                    name: mv.name,
                    artist: mv.artistName || "",
                    extra: mv.playCount ? "播放 " + mv.playCount : "",
                });
            });
        } else {
            var songResult = await mvdlSearch(keyword, 1, 20);
            (songResult.songs || []).forEach(function (song) {
                var artists = (song.artists || []).map(function (a) { return a.name; }).join(" / ");
                var mvId = song.mvid || song.mv || song.mvId || 0;
                items.push({
                    mvId: mvId || 0,
                    name: song.name,
                    artist: artists,
                    extra: song.album ? song.album.name : "",
                });
            });
        }
        mvdlRenderResults(container, items);
    } catch (e) {
        container.innerHTML = "";
        container.appendChild(mvdlEl("div", "padding:10px;color:#ec4141;font-size:12px;",
            "搜索失败：" + e.message + "（请确认已联网/已登录网易云）"));
    }
}

/** 当前播放歌曲的 MV（用 betterncm.ncm.getPlayingSong + 官方歌曲详情接口查 mv 字段） */
async function mvdlDownloadCurrentPlaying() {
    try {
        if (typeof betterncm === "undefined" || !betterncm.ncm || !betterncm.ncm.getPlayingSong) {
            mvdlToast("当前客户端拿不到正在播放信息（betterncm.ncm 不可用）");
            return;
        }
        var playing = betterncm.ncm.getPlayingSong();
        var songId = playing && playing.data && playing.data.id;
        if (!songId) {
            mvdlToast("现在没有正在播放的歌曲");
            return;
        }
        mvdlToast("正在查询当前歌曲的 MV…");
        var detail = await mvdlFetchJson(
            MVDL_API_BASE + "/api/song/detail/?id=" + encodeURIComponent(songId) +
            "&ids=" + encodeURIComponent("[" + songId + "]")
        );
        var song = detail && detail.songs && detail.songs[0];
        var mvId = song && (song.mvid || song.mv || song.mvId || 0);
        if (!song || !mvId) {
            mvdlToast("当前歌曲没有 MV");
            return;
        }
        var artist = (song.artists || []).map(function (a) { return a.name; }).join(" / ");
        await mvdlDownload(mvId, { name: song.name, artist: artist });
    } catch (e) {
        mvdlToast("获取当前播放 MV 失败：" + e.message);
    }
}

function mvdlInitUI() {
    if (document.getElementById("mvdl-root")) return;
    if (!document.body) return;

    var root = mvdlEl("div", "");
    root.id = "mvdl-root";

    var toggle = mvdlEl("button",
        "position:fixed;right:18px;bottom:110px;z-index:1000000;cursor:pointer;" +
        "border:0;border-radius:999px;padding:9px 16px;background:#ec4141;color:#fff;" +
        "font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.35);",
        "MV 下载");
    root.appendChild(toggle);

    var panel = mvdlEl("div",
        "position:fixed;right:18px;bottom:156px;z-index:1000000;width:360px;" +
        "max-height:60vh;display:none;flex-direction:column;background:#242424;color:#eee;" +
        "border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.5);overflow:hidden;");
    panel.id = "mvdl-panel";

    var header = mvdlEl("div",
        "display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#1d1d1d;");
    header.appendChild(mvdlEl("span", "font-size:13px;font-weight:600;", "MV 搜索下载（网易云官方搜索）"));
    var closeBtn = mvdlEl("button",
        "cursor:pointer;border:0;background:transparent;color:#bbb;font-size:15px;", "✕");
    closeBtn.addEventListener("click", function () { panel.style.display = "none"; });
    header.appendChild(closeBtn);
    panel.appendChild(header);

    var searchRow = mvdlEl("div", "display:flex;gap:6px;padding:10px 12px;");
    var input = document.createElement("input");
    input.type = "text";
    input.placeholder = "输入歌名 / 歌手，回车搜索";
    input.style.cssText = "flex:1;min-width:0;padding:7px 9px;border-radius:7px;border:1px solid #444;background:#161616;color:#eee;font-size:13px;";
    var mode = document.createElement("select");
    mode.style.cssText = "padding:7px 4px;border-radius:7px;border:1px solid #444;background:#161616;color:#eee;font-size:12px;";
    var optSong = document.createElement("option");
    optSong.value = "song"; optSong.textContent = "歌曲";
    var optMv = document.createElement("option");
    optMv.value = "mv"; optMv.textContent = "MV";
    mode.appendChild(optSong);
    mode.appendChild(optMv);
    var searchBtn = mvdlEl("button",
        "cursor:pointer;border:0;border-radius:7px;padding:7px 12px;background:#ec4141;color:#fff;font-size:12px;",
        "搜索");
    searchRow.appendChild(input);
    searchRow.appendChild(mode);
    searchRow.appendChild(searchBtn);
    panel.appendChild(searchRow);

    var currentBtn = mvdlEl("button",
        "margin:0 12px 8px;cursor:pointer;border:1px solid #444;border-radius:7px;" +
        "padding:7px 10px;background:#2e2e2e;color:#eee;font-size:12px;",
        "下载当前播放歌曲的 MV");
    panel.appendChild(currentBtn);

    var results = mvdlEl("div", "overflow-y:auto;padding:0 4px 8px;");
    results.appendChild(mvdlEl("div", "padding:10px;color:#999;font-size:12px;",
        "用网易云自己的搜索找歌，点「下载 MV」按最高可用画质保存为 .mp4。"));
    panel.appendChild(results);

    var runSearch = function () {
        var kw = input.value.trim();
        if (!kw) { mvdlToast("先输入搜索关键词"); return; }
        mvdlDoSearch(kw, mode.value, results);
    };
    searchBtn.addEventListener("click", runSearch);
    input.addEventListener("keydown", function (ev) { if (ev.key === "Enter") runSearch(); });
    currentBtn.addEventListener("click", function () { mvdlDownloadCurrentPlaying(); });
    toggle.addEventListener("click", function () {
        panel.style.display = panel.style.display === "none" ? "flex" : "none";
        if (panel.style.display === "flex") input.focus();
    });

    root.appendChild(panel);
    document.body.appendChild(root);
    mvdlLog("UI 已挂载（右下角「MV 下载」按钮）");
}

/* ---------------- 插件入口 ---------------- */

plugin.onLoad(function () {
    var tryInit = function () {
        if (document.body) mvdlInitUI();
        else setTimeout(tryInit, 500);
    };
    tryInit();
});

/**
 * 设置页（BetterNCM 插件管理器 → 本插件 → 设置）：
 * 默认画质、下载目录、文件名模板。存 plugin.setConfig，
 * 与上面 mvdlGetConfig 读取的键一致。
 */
plugin.onConfig(function (toolbox) {
    var wrap = document.createElement("div");

    var mkRow = function (labelText) {
        var row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:8px;margin:6px 0;";
        var label = document.createElement("span");
        label.textContent = labelText;
        label.style.cssText = "font-size:13px;min-width:88px;";
        row.appendChild(label);
        wrap.appendChild(row);
        return row;
    };

    // 默认画质
    var qualityRow = mkRow("默认画质");
    var qualitySel = document.createElement("select");
    [["highest", "最高可用"], ["1080", "最高 1080p"], ["720", "最高 720p"], ["480", "最高 480p"], ["240", "最高 240p"]]
        .forEach(function (pair) {
            var o = document.createElement("option");
            o.value = pair[0]; o.textContent = pair[1];
            qualitySel.appendChild(o);
        });
    qualitySel.value = mvdlQuality();
    qualitySel.addEventListener("change", function () { mvdlSetConfig("quality", qualitySel.value); });
    qualityRow.appendChild(qualitySel);

    // 下载目录
    var dirRow = mkRow("下载目录");
    var dirInput = (toolbox && toolbox.makeInput)
        ? toolbox.makeInput(mvdlDownloadDir())
        : document.createElement("input");
    dirInput.value = mvdlDownloadDir();
    dirInput.title = "相对路径基于 BetterNCM 数据目录；也可填绝对路径";
    dirInput.addEventListener("change", function () {
        mvdlSetConfig("downloadDir", dirInput.value.trim() || "mv-downloads");
    });
    dirRow.appendChild(dirInput);
    var dirHint = document.createElement("span");
    dirHint.textContent = "（相对 BetterNCM 数据目录）";
    dirHint.style.cssText = "font-size:11px;color:#999;";
    dirRow.appendChild(dirHint);

    // 文件名模板
    var tplRow = mkRow("文件名模板");
    var tplInput = (toolbox && toolbox.makeInput)
        ? toolbox.makeInput(mvdlFilenameTemplate())
        : document.createElement("input");
    tplInput.value = mvdlFilenameTemplate();
    tplInput.title = "支持 {name} {artist} {id} {quality}，后缀自动加 .mp4";
    tplInput.addEventListener("change", function () {
        mvdlSetConfig("filenameTemplate", tplInput.value.trim() || "{artist} - {name}");
    });
    tplRow.appendChild(tplInput);

    return wrap;
});
