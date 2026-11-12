# installer/betterncm3-yousj.json

yousj-plus 增强版安装器（yousj666/BetterNCM-Installer 的 yousj-plus 分支）
使用的版本表，与上游 `betterncm3.json` 同格式：

```json
{ "versions": { "<网易云版本 semver 要求>": { "version": "...", "url_x86": "...", "url_x64": "..." } },
  "test":     { "...": "..." } }
```

安装器勾选「增强版源(yousj-plus)」时从
`https://raw.githubusercontent.com/yousj666/chromatic/yousj-plus/installer/betterncm3-yousj.json`
拉取本文件。

当前表里的 DLL 地址指向上游 1.3.4 官方 Release（已核对链接存在）：
yousj-plus 未改动本体 C++ 代码，增强在插件层（见 `../builtin-plugins/`），
DLL 与上游 1.3.4 相同。以后本 Fork 自行构建/发布 DLL 时，只需把这里的
`url_x86` / `url_x64` 换成本 Fork Release 的地址，安装器无需改代码。
