#!/usr/bin/env python3
"""把 builtin-plugins/<Name>/ 打包成 BetterNCM 的 .plugin 文件。

.plugin 本质是 zip，根目录放 manifest.json 和 manifest 里引用的脚本，
本体 PluginManager::extractPackedPlugins() 会把它解压到
<BetterNCM 数据目录>/plugins_runtime/<slug>/ 再加载。

用法: python3 pack.py [插件目录名，默认 MVDownloader]
产物: builtin-plugins/<Name>.plugin
"""
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def pack(name: str) -> Path:
    src = ROOT / name
    manifest = src / "manifest.json"
    if not manifest.exists():
        raise SystemExit(f"manifest.json not found in {src}")
    out = ROOT / f"{name}.plugin"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(src.iterdir()):
            if f.is_file() and f.name != "README.md":
                z.write(f, arcname=f.name)
    return out


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "MVDownloader"
    print(pack(target))
