# spacehog 项目开发快照

> 归档文档 · 第 3 版 · 基线 commit `0dc94d7`（branch `main`，`origin/main...HEAD` = `0 0`）· 整理时间 2026-09-26
>
> 本文只记录概要、接口签名与逻辑约定，不粘贴源码。
> **第 3 版相对第 2 版的变更**：待办第 1、2、5、6、12 项已修复并验证；测试从 122 增至 130（10 → 11 个文件）；新增 `src/gui/cli-child.js`、`test/gui.test.js`；新增"上传 GitHub"任务及其阻塞根因；新增第 18 项待办（本机 GitHub 推送通道不可用）。

---

## 0. 快照基线

| 项目 | 值 |
|---|---|
| 项目名 | spacehog |
| 版本 | 0.2.0（`package.json` 与 `src/util.js` 两处一致） |
| 定位 | 零依赖命令行工具，审计磁盘上是什么在占地方：重复文件、大文件、垃圾文件、稀疏文件、空目录 |
| 分支 / HEAD | `main` / `0dc94d7`（test(ci): verify the published package installs and runs） |
| 与远端关系 | `origin/main...HEAD` = `0 0`，本地与远端同步（未提交内容全在工作区） |
| 本地 tag | 仅 `v0.2.0`；GitHub 上 `v0.2.0` 与 `v0.1.0` 两个 Release 已存在，`v0.2.0` 为 Latest |
| 测试 | **130 个用例全部通过**，分布在 **11** 个文件 |
| 验证环境 | Node 24.21.0 / npm 11.19.0 / Windows 10.0.26200 / PowerShell 5.1 |
| 仓库 | https://github.com/d20260825613-hub/spacehog |
| 许可 | MIT |
| 包体积 | tarball 43.3 KB，解包 130.0 KB，20 个文件 |

### 工作区状态（快照时刻，`git status --porcelain -uall`）

已跟踪但未提交的修改（13 个）：

`.github/workflows/ci.yml`、`.gitignore`、`CHANGELOG.md`、`README.md`、`bin/spacehog.js`、`package.json`、`scripts/README.md`、`scripts/smoke.js`、`scripts/verify-package.js`、`src/args.js`、`src/cli.js`、`test/cli.test.js`、`test/version.test.js`

未跟踪的新增内容（24 条）：

- 入口与脚本：`build.ps1`、`scripts/build-exe.js`、`scripts/upload-assets.js`、`scripts/verify-gui.js`、`src/cli-kit.js`
- 图形界面：`src/gui/main.js`、`src/gui/server.js`、`src/gui/page.js`、`src/gui/cli-child.js`
- 测试与锁文件：`test/gui.test.js`、`package-lock.json`
- SEA 构建输入与校验和（**有意保留进仓库**）：`tools/sea/{bundle-win,bundle-linux}.cjs`、`entry-{win,linux}.mjs`、`entry.mjs`、`sea-entry.cjs`、`sea-{config,win,linux}.json`、`spacehog.cjs`、`spacehog{,.exe,-cli}.sha256`、`SHA256SUMS.txt`
- 静态页：`installer/index.html`

结论：图形界面、SEA 二进制打包、以及本轮命令行加固与全部修复，整体仍未进入 git 历史。**本轮结束后工作区仍然干净地"未提交"**。

### 本机代理与网络（实测）

| 事实 | 值 |
|---|---|
| 代理 | `http://127.0.0.1:7897`（进程 `verge-mihomo`，pid 随启动变化），Clash Verge |
| 系统代理 | 已启用，`ProxyServer=127.0.0.1:7897`，`ProxyOverride` 含 `127.*` |
| `HTTPS_PROXY` | 由人工在会话中设置（**不是**系统级持久变量；子进程不继承则直连失败） |
| `gh.exe` | 经该代理**可正常访问** GitHub API（`gh api user` 返回 `d20260825613-hub`） |
| `github.com:443` 的 CONNECT + TLS | **可正常建立**（Tls13），`api.` / `codeload.` / `objects.githubusercontent.com` 同样正常 |
| `git.exe` 走该代理 | **失败**：`schannel: server closed abruptly (missing close_notify)`；换 `http.proxy=127.0.0.1:1001` 报连接重置；直连报无法连接 |
| 未验证完 | git 推送的兜底组合（`http.version=HTTP/1.1`、`http.sslBackend=openssl`）在本轮被中断，未取到结论 |

教训（本轮踩过）：会话环境里手工设过 `HTTPS_PROXY` 后，同一会话内后续命令会继承它，导致"直连也失败"的假象。判断网络问题必须在不带代理变量的干净进程里复测。

---

## 1. 项目结构与模块分工

```
spacehog/
├── bin/
│   └── spacehog.js            CLI 进程入口。装进程级 handler，然后交给 run()
├── src/
│   ├── index.js               库入口，对外 API 的唯一出口
│   ├── cli.js                 编排层：解析参数 → 调 audit → 选渲染器 → 定退出码
│   ├── args.js                手写参数解析器：SPEC 表、USAGE 文本、parseArgs、glob 过滤
│   ├── cli-kit.js             六个项目共享的命令行工具（逐字节复制的副本）
│   ├── audit.js               一次完整扫描的编排：walk → 各检测器 → 组装报告对象
│   ├── walker.js              广度优先目录遍历，迭代实现，单条错误不中断
│   ├── detectors.js           五类检测：重复、大文件、垃圾、稀疏、空目录
│   ├── hash.js                哈希、哈希缓存、有界并发池
│   ├── keep.js                “重复组保留哪一份” 的策略函数
│   ├── reporter.js            text / markdown / json 三种渲染 + 摘要判定
│   ├── util.js                纯函数工具集合，并持有 VERSION
│   └── gui/
│       ├── main.js            GUI 二进制入口，一个可执行文件两种模式
│       ├── server.js          本地 HTTP 服务与三个接口 + 派生子进程的策略
│       ├── page.js            单页前端（内联 HTML 字符串常量 PAGE）
│       └── cli-child.js       仅命令行的入口，GUI 在源码模式下派生它
├── test/                      130 个测试，11 个 *.test.js
│   ├── helpers/tmp.js         临时目录与目录树构造函数
│   ├── helpers/cli.js         以子进程方式跑 CLI 的辅助函数
│   └── fixtures.js            固定测试夹具
├── scripts/                   维护脚本，不随 npm 包发布
├── tools/sea/                 SEA 打包的中间产物与可执行文件
├── installer/index.html       安装引导页（静态，未接入任何流程）
├── build.ps1                  单项目 check / pack / link / publish 脚本
└── 文档：README.md、CHANGELOG.md、CONTRIBUTING.md、SECURITY.md、
         CODE_OF_CONDUCT.md、RELEASE-NOTES.md、scripts/README.md
```

模块职责边界：

- `args.js` 只把 argv 变成 `{ values, paths }`，不认识文件系统，也不打印。
- `cli.js` 是唯一决定退出码的地方，也是唯一接触 `process` 流的地方。
- `audit.js` 不打印任何东西，只返回数据结构；进度通过 `onProgress` 回调外传。
- `walker.js` / `detectors.js` / `hash.js` / `keep.js` / `util.js` 都是纯逻辑或纯 IO，可单独测试。
- `reporter.js` 只读报告对象，不发起任何扫描。
- `gui/` 与 `bin/` 是两条并行入口，共用 `run()`，不复制扫描逻辑。

---

## 2. 对外 API

### 2.1 库入口

包入口是 `src/index.js`（`package.json` 的 `main` 与 `exports["."]` 都指向它），运行时零依赖，ESM。**实测导出 47 个名字**，按字母序：

```
DEFAULT_IGNORED_DIRS  DEFAULT_JUNK_EXTENSIONS  DEFAULT_JUNK_NAMES  HASH_ALGORITHMS
HashCache  KEEP_POLICIES  USAGE  VERSION
applyExclude  audit  buildExcludeFilter  clamp  commonRoot  createColors
defaultCachePath  ellipsize  explainKeep  findDuplicates  findEmptyDirs
findJunkFiles  findLargeFiles  findSparseFiles  formatAge  formatBytes
formatDuration  globToRegExp  hashFile  hashHead  isJunkFile  isKeepPolicy
isSparse  isoNow  mapPool  parseArgs  parseSize  rankKeep  renderJson
renderMarkdown  renderText  run  shouldUseColor  suggestKeep  sum  summarize
toPosix  walk
```

三点注意：

- `src/index.js` 用 `export * from './util.js'` 导出工具模块，因此 `util.js` 里新增的导出会自动成为公开 API。
- `OPTION_NAMES` 从 `src/args.js` 导出，但**没有**经过 `index.js`，属于"项目内公开、包外用不到"。
- `terminalWidth`、`OPTION_NAMES`、`createColors` 三者的可见性不同：`createColors` 经过 `index.js` 导出，是包外公开的；`terminalWidth` 虽然从 `reporter.js` 导出，但**没有**经过 `index.js`，包外拿不到。`gui/` 全部导出（`startGui`、`openInBrowser`、`resolveSpawnTarget`、`isRunning`、`PAGE`）也都不经过 `index.js`。

### 2.2 函数原型

#### 扫描

**`audit(options)` → `Promise<Report>`**

一次完整扫描。全部参数可选，`root` 是唯一实质必需的字段。

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `root` | string | — | 要扫描的目录，内部会 `path.resolve` |
| `minSize` | number | `0` | 小于该字节数的文件不进入各检测器 |
| `top` | number | `15` | 每个分区列出多少条 |
| `maxDepth` | number | `Infinity` | 0 表示只看根目录一层 |
| `includeHidden` | boolean | `true` | 是否包含点文件与点目录 |
| `ignoreDirs` | boolean | `true` | 是否剪掉 `DEFAULT_IGNORED_DIRS` 里的目录 |
| `followSymlinks` | boolean | `false` | 跟随符号链接目录（可能成环） |
| `maxEntries` | number | `Infinity` | 收集到这么多文件后停止，并置 `truncated` |
| `duplicates` | boolean | `true` | 是否跑重复检测 |
| `algorithm` | string | `'md5'` | `md5` \| `sha1` \| `sha256` |
| `concurrency` | number | `8` | 哈希阶段的并行读文件数 |
| `maxHashSize` | number | `Infinity` | 超过该大小的文件不做完整哈希 |
| `cachePath` | string \| null | `null` | 哈希缓存文件位置，`null` 表示不持久化 |
| `keepPolicy` | string | `'newest'` | 重复组建议保留哪一份 |
| `keepPrefer` | string \| null | `null` | 该目录名下的副本优先保留 |
| `onProgress` | function | `null` | 收到 `{ phase, stage, ... }` 事件 |
| `signal` | AbortSignal | `null` | 中止扫描；已收集的部分照常返回 |

进度事件的 `phase` 取值 `'scan'` / `'analyze'`，`stage` 取值 `'walking'` / `'large'` / `'duplicates'`。

**`walk(root, options)` → `Promise<WalkResult>`**

迭代式广度优先遍历，不会因为树太深而爆栈。单条权限错误、竞态删除不抛异常，收进 `errors` 继续走。

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `ignoreDirs` | string[] | `[]` | 按目录名剪枝（`audit` 会传 `DEFAULT_IGNORED_DIRS`） |
| `includeHidden` | boolean | `true` | |
| `maxDepth` | number | `Infinity` | |
| `maxEntries` | number | `Infinity` | |
| `followSymlinks` | boolean | `false` | |
| `onProgress` | function | — | 收到 `{ files, dirs, bytes }` |
| `signal` | AbortSignal | — | |

返回：

```js
{
  root,                     // resolve 后的绝对路径
  files: [{ path, display, size, mtimeMs, blocks, ino, dev, depth }],
  directories: [{ path, display, depth, fileCount, subdirCount }],
  errors: [{ path, code, message }],   // 最多保留 40 条
  stats: { fileCount, dirCount, totalBytes, skippedDirCount,
           symlinkCount, symlinkedDirCount, truncated }
}
```

`blocks` / `ino` / `dev` 在 Windows 上可能是 `null`。

**`DEFAULT_IGNORED_DIRS`**（实测 20 项）：
`node_modules .git .hg .svn .cache .next .nuxt .venv venv __pycache__ .mypy_cache .pytest_cache .tox .gradle .terraform target dist build .DS_Store`

#### 检测

**`findDuplicates(files, options)` → `Promise<{ groups, hardlinkGroups, hardlinkWastedBytes, stats }>`**

三遍由便宜到昂贵，把 IO 压到最低：先按精确字节数分桶，再只哈希头 64 KB，只有仍然碰撞的组才做全文哈希。

| 参数 | 默认 | 说明 |
|---|---|---|
| `algorithm` | `'md5'` | |
| `cache` | `null` | `HashCache` 实例 |
| `concurrency` | `8` | |
| `headBytes` | `65536` | 便宜那遍读多少字节 |
| `maxFileSize` | `Infinity` | 超过则不做完整哈希 |
| `root` | `''` | 用于算相对 `display` |
| `keepPolicy` | `'newest'` | |
| `keepPrefer` | `null` | |
| `onProgress` / `signal` | `null` | |

硬链接（一个 inode 多个名字）**不算重复**，字节只存了一份，单独放在 `hardlinkGroups` 里报。

**`findLargeFiles(files, limit = 15, root = '')` → `Array`**
按大小降序，返回 `describeFile()` 结果再加 `sparse` 布尔。大小相同时按 `display` 字典序，保证输出稳定。

**`isSparse(file, { minGap = 4 * 1024 * 1024, ratio = 0.5 } = {})` → `boolean`**
`blocks * 512` 与逻辑大小的差超过 `minGap`，且实际占用低于逻辑大小的 `ratio`，才算稀疏。`file.blocks` 不存在（Windows）时恒为 `false`。

**`findSparseFiles(files, limit = 10, root = '')` → `Array`**
附加 `allocatedBytes` 与 `savedBytes`。注意：在 Windows 上 `blocks` 恒为 `null`，所以这个分区**实际上总是空的**（实测夹具上 `sparse` 长度为 0）。

**`isJunkFile(file, { extensions = DEFAULT_JUNK_EXTENSIONS, names = DEFAULT_JUNK_NAMES } = {})` → `boolean`**
按小写 basename 判断：先查精确文件名表，再查后缀表。

**`findJunkFiles(files, limit = 15, options = {})` → `{ files, count, totalBytes }`**
`count` 与 `totalBytes` 是全部匹配项，`files` 只是前 `limit` 条。

**`findEmptyDirs(directories, { keep = new Set() } = {})` → `{ dirs, count }`**
"没有任何层级含文件"的目录。含不可读子目录的目录会被保留而不上报。`keep` 里的路径视为存活。

`DEFAULT_JUNK_EXTENSIONS`（22 项）包含 `.tmp .temp .bak .old .orig .rej .log .dmp .crdownload .part .partial .download .swp .swo .pyc .pyo .class .o .obj .tsbuildinfo .DS_Store .thumbs.db`；`DEFAULT_JUNK_NAMES` 为 `.ds_store thumbs.db desktop.ini npm-debug.log`。

#### 哈希与并发

**`isSupportedAlgorithm(name)` → `boolean`**（从 `hash.js` 导出，但不经过 `index.js`）

**`hashHead(filePath, algorithm = 'md5', length = DEFAULT_HEAD_BYTES)` → `Promise<{ hash, bytesRead, complete }>`**
默认读 64 KB。`complete` 表示文件比 `length` 短、头哈希即全文哈希。

**`hashFile(filePath, algorithm = 'md5')` → `Promise<string>`**
流式读取，内存恒定，1 MB 一个 chunk。

**`mapPool(items, limit, worker)` → `Promise<Array>`**
有界并发映射，**结果保持输入顺序**。任一 worker 抛错则整体 reject。实际并发数被夹到 `1..items.length`。

**`class HashCache`**

| 成员 | 签名 | 说明 |
|---|---|---|
| 构造 | `new HashCache(storePath, { enabled, entries, loaded })` | `enabled` 未显式给定时由 `storePath` 是否存在决定 |
| 静态 | `HashCache.load(storePath, { enabled })` → `Promise<HashCache>` | 文件缺失或损坏时静默从空开始 |
| 静态 | `HashCache.key(file, algorithm)` → `string` | `` `${algorithm}:${path}|${size}|${floor(mtimeMs)}` `` |
| 实例 | `get(file, algorithm)` → `string \| null` | 命中/未命中会累加 `hits` / `misses` |
| 实例 | `set(file, algorithm, hash)` → `void` | 置 `dirty` |
| 实例 | `save({ maxEntries = 200000 })` → `Promise<{ saved, entries }>` | 超上限先丢最早插入的；tmp + rename 原子写；失败返回 `saved: false` 而不抛 |

缓存文件格式：`{ version: 1, updatedAt, entries }`，只接受 `version === 1`。

**常量**：`HASH_ALGORITHMS = ['md5','sha1','sha256']`，`DEFAULT_HEAD_BYTES = 65536`。

#### 保留策略

**`KEEP_POLICIES`** = `['newest','oldest','shortest-path','first']`

**`isKeepPolicy(name)` → `boolean`**

**`rankKeep(files, policy = 'newest', options = {})` → `number`**
返回组内应保留元素的下标。策略返回"越小越优"的分数；`options.prefer` 命中父目录名时加 `-1e12` 的强偏移，因此优先目录压过策略本身。未知策略回落到 `newest`。

**`suggestKeep(files, policy = 'newest', options = {})` → `{ keep, redundant, policy, prefer }`**
空数组时返回 `keep: null`。`redundant` 是 `keep` 之外的全部元素。

**`explainKeep(policy, prefer = null)` → `string`**
人类可读的一行解释，`prefer` 以 `, preferring a folder named "X"` 追加。

#### 渲染

**`createColors(enabled)` → `paint(text, ...styles)`**
`enabled` 为假时返回一个 `Proxy`，任何属性访问和调用都退化成返回原字符串，调用方无需分支。为真时 `paint.red('x')` 与 `paint('x','red')` 两种写法都支持。调色板：`bold dim red green yellow blue magenta cyan gray`。

**`shouldUseColor({ flag, stream = process.stdout, env = process.env } = {})` → `boolean`**
优先级：`flag === true` → `flag === false` → `NO_COLOR` 非空 → `FORCE_COLOR` 非空且不为 `'0'` → `TERM === 'dumb'` → `stream.isTTY`。

**`terminalWidth(stream = process.stdout)` → `number`**
不可用或 ≤ 20 时返回 100，上限夹到 160。**不经 `index.js` 导出。**

**`summarize(report, now = Date.now())` → `Summary`**
产出 `{ total, reclaimable, wasted, junk, hardlinkSaved, sparseSaved, share, severity, headline }`。`reclaimable = wasted + junk`；`severity` 判定：可回收 ≥ 1 GB 或占比 ≥ 10% → `high`；≥ 100 MB → `medium`；> 0 → `low`；否则 `info`。

**`renderText(report, { color = false, width = 100, now = Date.now() } = {})` → `string`**
分隔线宽度固定 72 字符。

**`renderMarkdown(report, { now = Date.now() } = {})` → `string`**
表格形式，重复组用 `<details>` 折叠，前 25 组进表、前 10 组展开。管道符会被转义。

**`renderJson(report, { pretty = false } = {})` → `string`**
`pretty` 为假时无缩进。

#### 命令行

**`run(argv, io = {})` → `Promise<number>`**
返回进程退出码，不直接 `process.exit`。`io` 可注入 `{ stdout, stderr, env, now }`，测试靠它避免碰真实流。

**`parseArgs(argv)` → `{ ok: true, values, paths }` 或 `{ ok: false, message, hint }`**
支持形式：`--flag`、`--opt value`、`--opt=value`、`-o value`、`-o=value`、短标志捆绑加末尾取值选项（如 `-nv`）、以及 `--` 之后全部当路径。失败时 `hint` 是"该输入什么"，由 `cli.js` 交给 `formatError()` 渲染。

**`applyExclude(report, isExcluded, patterns = [])` → `Report`**
在遍历**之后**过滤，所以目录剪枝的统计仍然算进总数。会从每个分区移除命中项，并**重算派生值**：`duplicateGroups` 里少于 2 个成员的组整个丢弃、`wastedBytes` / `copies` 重算、`emptyDirCount` 重算、`junk.count` 重算。keep 建议也重算 —— 否则会指向一个已经不在报告里的路径。`patterns` 写入 `options.exclude`。

**`buildExcludeFilter(patterns)` → `(posixPath) => boolean`**

**`globToRegExp(pattern)` → `RegExp`**
支持 `*`（不跨 `/`）、`**`、`?`、`{a,b}`；无 `/` 的模式按 basename 匹配任意深度；Windows 上加 `i`。

**`defaultCachePath(env = process.env, platform = process.platform)` → `string`**
Windows 用 `%LOCALAPPDATA%` / `%APPDATA%`，其它用 `$XDG_CACHE_HOME` 或 `~/.cache`，均为 `<base>/spacehog/hashes.json`。

**`OPTION_NAMES`** = `Object.keys(SPEC)`，**当前 25 项**（第 3 版新增 `debug`）。从 SPEC 派生而不是另抄一份，防止两处漂移。

#### 工具（`src/util.js`）

| 签名 | 说明 |
|---|---|
| `VERSION` | `'0.2.0'`，字符串常量 |
| `formatBytes(bytes, { space = true } = {})` | 1024 进制，3 位有效数字，整数不留小数。`0` → `"0 B"`，非法值也返回 `"0 B"` |
| `parseSize(input)` | `"10"` / `"10b"` / `"1.5mb"` / `"2 GB"` → 字节。裸数字按字节。不可解析返回 `null` |
| `toPosix(p)` | 反斜杠换正斜杠 |
| `commonRoot(paths)` | 最长公共前导目录，无则 `''` |
| `sum(values)` | 数值求和 |
| `clamp(n, min, max)` | |
| `ellipsize(text, max)` | 中间截断，用 `…`；`max < 4` 时原样返回 |
| `formatDuration(ms)` | `< 1s` 用 ms，`< 60s` 用 s，再往上 `Xm YYs` |
| `isoNow(date = new Date())` | ISO 字符串，去掉毫秒（跨平台稳定，便于测试） |
| `formatAge(mtimeMs, now = Date.now())` | `"3d ago"` / `"5mo ago"`，非法输入 `"unknown"` |

#### cli-kit（共享副本，不经 `index.js`）

`editDistance(a, b)`、`nearestName(input, candidates)`、`class UsageError extends Error`、`unknownOptionError(option, candidates)`、`formatError(error, { tool })`、`isBrokenPipe(error)`、`installCliHandlers({ tool, onInterrupt, usage, debug })`、`isInteractive(stream)`、`writeSafely(stream, text)`。

#### GUI

**`startGui({ open = null, execPath = null } = {})` → `Promise<{ url, server }>`**
只绑 `127.0.0.1`，端口由系统分配。`open` 传入时用它打开页面，否则打印 URL。`execPath` 是**可注入的接缝**：给了就当成"自己就是可执行文件"（打包形态），不给则按本进程的启动方式推导（见第 3 节"派生子进程"）。

**`resolveSpawnTarget({ execPath = null, argv = process.argv, execPathFallback = process.execPath } = {})` → `{ command, args(args) }`**
调用方拿到"怎么起一个 CLI 模式的自己"。两种形态：
- 打包（SEA）：`{ command: execPath, args: (a) => ['--cli', ...a] }`
- 源码：`{ command: node, args: (a) => ['<abs>/src/gui/cli-child.js', ...a] }`（**没有** `--cli`，那个标志只是打包形态用来切换模式）

**`isRunning(child)` → `boolean`**
`exitCode === null && signalCode === null`。两者都要看：被信号杀掉的子进程 `exitCode` 仍是 `null`。

**`openInBrowser(url)` → `Promise<boolean>`**
Windows 用 `cmd /c start`，macOS 用 `open`，其余用 `xdg-open`。不经过 shell 字符串。失败返回 `false`。

**`PAGE`**（`page.js`）：整页前端，一个内联 HTML 字符串常量。它调 `api/version`、`api/browse`、`api/run` 三个接口，`api/version` 里只用 `v.version` 与 `v.exe`。

### 2.3 数据结构

**Report**（`audit()` 返回值，也是三个渲染器的输入）。实测键集：

```
tool, generatedAt, root, options, summary, duplicates, duplicateGroups,
hardlinkGroups, hardlinkSavedBytes, cacheCandidates, largeFiles, junk,
sparse, emptyDirs, emptyDirCount, errors
```

各子结构实测键集：

| 字段 | 键 |
|---|---|
| `options` | `minSize, top, maxDepth, includeHidden, ignoreDirs, followSymlinks, duplicates, algorithm, keepPolicy, keepPrefer, maxHashSize`（`--exclude` 由 `applyExclude` 追加） |
| `summary` | `files, directories, totalBytes, humanTotal, ignoredDirectories, symlinksSkipped, errorCount, truncated, durationMs` |
| `duplicates` | `headHashes, fullHashes, inodes, bytesHashed, duplicateFiles, duplicateGroups, wastedBytes, algorithm` |
| `duplicateGroups[]` | `hash, algorithm, size, copies, wastedBytes, files, keep, redundant, keepPolicy, keepPrefer` |
| `cacheCandidates` | `enabled, hits, misses, saved, entries` |
| `junk` | `files, count, totalBytes` |
| `largeFiles[]` / 组内 `files[]` | `path, display, size, mtimeMs, mtime, sparse` |
| `emptyDirs[]` | `path, display, depth` |

遍历产生的**原始**文件条目形状（`walk` 的 `files`）比上面多三个字段：
`{ path（绝对）, display（相对 root，POSIX 分隔符）, size, mtimeMs, blocks, ino, dev, depth }`

`options.maxDepth` 与 `options.maxHashSize` 在报告里会被写成 `null` 而不是 `Infinity`，因为 `Infinity` 不是合法 JSON。

### 2.4 CLI 接口

```
spacehog [path...] [options]
```

**25 个选项**（`args.js` 的 `SPEC`），默认值实测：

| 选项 | 短名 | 类型 | 默认 | 备注 |
|---|---|---|---|---|
| `--help` | `-h` | boolean | | |
| `--version` | `-v` | boolean | | |
| `--json` | | boolean | | |
| `--markdown` | | boolean | | |
| `--pretty` | | boolean | | |
| `--duplicates` / `--no-duplicates` | | boolean | `true` | 可否定 |
| `--progress` / `--no-progress` | | boolean | `undefined` | 可否定，未指定时看 stderr 是否 TTY |
| `--color` / `--no-color` | | boolean | `undefined` | 可否定 |
| `--hidden` / `--no-hidden` | | boolean | `true` | 可否定 |
| `--ignore-dirs` / `--no-ignore-dirs` | | boolean | `true` | 可否定 |
| `--follow-symlinks` | | boolean | `false` | 可否定 |
| `--no-cache` | | boolean | `false` | |
| `--debug` | | boolean | `false` | 打印栈帧 |
| `--top` | `-n` | number | `15` | 最小 0 |
| `--min-size` | `-s` | size | `0` | 如 `10mb` |
| `--max-size` | `-m` | size | `null` | 超过不做完整哈希 |
| `--max-depth` | | number | `null` | 最小 0 |
| `--max-entries` | | number | `null` | 最小 1 |
| `--concurrency` | `-c` | number | `8` | 最小 1 |
| `--hash` | `-a` | string | `md5` | 枚举 md5/sha1/sha256 |
| `--keep` | `-k` | string | `newest` | 枚举 newest/oldest/shortest-path/first |
| `--keep-prefer` | | string | `null` | |
| `--fail-on-dupes` | | size | `null` | 达到阈值时以 **3** 退出 |
| `--exclude` | | string | `[]` | 可重复，glob |
| `--cache` | | string | `null` | |

`--progress` / `--color` / `--hidden` / `--ignore-dirs` 的默认值是 `undefined` 而非布尔，用来区分"用户没说"和"用户明确要求"。

### 2.5 GUI HTTP 接口

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/` 或 `/index.html` | — | 单页 HTML（`text/html; charset=utf-8`） |
| GET | `/api/version` | — | `{ version, exe, cwd }`；`exe` 是"准备用来跑扫描的程序"的 basename（打包态是 `spacehog.exe`，源码态是 `node.exe`） |
| POST | `/api/browse` | — | `{ path }` 或 `{ error }`；非 Windows 直接返回提示文本 |
| POST | `/api/run` | `{ args: string[] }` | NDJSON 流：若干 `{ chunk }`，最后一行 `{ exit }` |
| — | 其它 | — | 404 `{ error: 'not found' }` |

`/api/run` 的约束：body 上限 64 KB，超过直接 `req.destroy()`；`args` 必须是字符串数组，否则 400；子进程用参数数组派生，不拼 shell 字符串（因此带引号或空格的目录名不会变成命令注入）；**客户端断开时杀子进程**——判据是 `res` 的 `close` 且响应未 `writableEnded` 且子进程仍在跑。响应统一带 `cache-control: no-store`。

### 2.6 退出码（第 3 版已拆分）

| 码 | 含义 |
|---|---|
| 0 | 报告已产出（即使发现了重复） |
| 1 | 扫描开始后失败（IO 等） |
| 2 | 参数非法，**或**路径不存在（命令根本不可能跑起来） |
| 3 | `--fail-on-dupes` 阈值被命中（扫描本身是成功的） |

**2 与 3 的区分是有意的**：2 表示"你要求的东西不可能"，3 表示"一次成功的扫描得出的结论"。调用方据此能分辨"打错字"和"真有发现"，而不是对着一个永远不可能成功的命令重试。同族项目 speck 用同样方式占用了 3。

`README.md` 的退出码表在第 2 版里把 1 和 2 写反了（声称 1 是参数错误），第 3 版已订正。

---

## 3. 编码约定

### 依赖与平台

- **运行时零依赖**，这是硬约束。`test/version.test.js` 与 `scripts/release-check.js` 都会检查它没有被动过。（`node_modules/commander` 只是 `postject` 的传递依赖，不影响这条约定。）
- `devDependencies` 只有 `esbuild ^0.25.0` 与 `postject ^1.0.0-alpha.6`，仅用于 SEA 打包，不参与运行。
- `engines.node >= 18.17`。因此不能用 `Array.prototype.findLast`、`Object.groupBy`，ESM 入口外不能用顶层 await。`Array.prototype.at`、`server.closeAllConnections` 可以用，但后者要带 `?.`。
- `"type": "module"`，全部 ESM。Node 18 不能 import JSON，所以版本号在 `src/util.js` 里以字符串常量重复一份。

### 版本号

`package.json` 与 `src/util.js` 各存一份，`test/version.test.js` 和 `release-check.js` 负责阻止两者漂移。这是有意为之的重复，不是疏漏。

### 路径

- 报告内的 `display` 与 Markdown 输出一律走 `toPosix()`，输出格式不随操作系统变化。
- `display` 相对扫描根：根目录下的文件就是 `name`，更深的是 `sub/dir/name`。根路径末尾的分隔符不能漏进前缀。
- 遍历结果广度优先且同级按名字排序，所以输出顺序确定。

### 哈希

- 默认 `md5` 是**变更检测**，不是安全原语。README 与代码注释都明确要求不要用于安全用途。
- 缓存键含 `mtimeMs`，所以"内容被改但大小和 mtime 都不变"的极端情况理论上可能读到旧哈希。
- 缓存写入是 tmp + rename 的原子操作；损坏的缓存静默丢弃重建，不报错。
- 缓存条目上限 20 万，超出时按插入顺序丢最早的。

### 进度与输出通道

- 报告写 **stdout**，进度行与所有诊断写 **stderr**。所以 `spacehog . --json > report.json` 不会被进度污染。
- 进度行用 `\u001B[2K\r` 原地刷新，结束时清一次。
- 颜色判定集中在 `shouldUseColor()`，不在各处散落 `isTTY` 判断。

### 中断

- 第一次 SIGINT：写一行提示，`AbortController.abort()`，然后照常产出**部分报告**，退出码仍是 0。
- 第二次 SIGINT（已经 abort 过）：直接 `process.exit(130)`。
- `run()` 结束时会 `removeListener`，避免在测试里泄漏监听器。

### 进程级 handler

- `installCliHandlers({ tool, usage, debug, onInterrupt })` 覆盖四件事：EPIPE（`| head` 不再吐 node 栈）、SIGINT/SIGTERM、`uncaughtException`、`unhandledRejection`。
- 它通过一个以 `process.stdout` 为键的 `WeakMap` 实现**幂等**，所以 bin 入口和 `src/cli.js` 的 direct-run 块可以都装一次，第二次是空操作。
- 装的位置必须在 **bin 入口**，因为工具装到 PATH 后跑的是 `bin/spacehog.js`，它 `import` 而不是直接执行 `src/cli.js`，direct-run 块不会触发。spacehog 在六个同族项目里是唯一一个一开始就装对的。
- 直接运行判定用 `pathToFileURL(process.argv[1]).href` 而不是手拼 `file://` 字符串，后者在 Windows 盘符、空格、`#`、`%` 上都会出错。

### 错误与退出码

- 参数类错误统一走 `UsageError`，用 `formatError()` 输出：一行消息加一行可选 hint，默认不打栈帧。`--debug` 时才打。
- hint 要给"该输入什么"，不是复述"错在哪"。例如未知选项会给 `did you mean --top?`。
- 退出码语义：**2 = 你要求的东西不可能**，**3 = 门禁阈值命中**，**1 = 操作失败了**。
- 路径不存在被归为 **2**（用户点了一个不存在的东西），只有在遍历开始之后才用 1。

### 派生子进程（GUI）

GUI 需要"再跑一个 CLI 模式的自己"。两种形态必须给出不同的 argv：

- **打包（SEA）**：程序就是自己的可执行文件，`execPath` 加 `--cli` 即可。入口 wrapper（`tools/sea/entry-win.mjs`，由 `build-exe.js` 生成）在 GUI 代码之前就接管 argv 分发，所以 `spacehog.exe --cli .` 与纯 CLI 构建行为一致。
- **源码**：`node --cli .` 不成立——node 会认为 `--cli` 是自己的选项并以 `bad option` 退出（实测退出码 9）。命令必须是 node，第一个**参数**是脚本路径。

源码模式下的脚本**必须是 `src/gui/cli-child.js`，不能是 `src/gui/main.js`**。用 `process.argv[1]` 推导"启动 GUI 的那个脚本"看起来更通用，但它等于"谁启动我就重启谁"：在 `node --test test/gui.test.js` 下会把测试文件当扫描子进程重启（本轮实测为递归挂死）。`cli-child.js` 永远只表示"一次扫描"。

### 测试

- `node:test` + `node:assert/strict`，无第三方测试框架。
- **测试文件必须显式列出**。`node --test test/`（裸目录）在 Node 24 会以 `Cannot find module` 失败；用 glob 又在 Node 18/20 上不成立。`scripts/run-tests.js` 就是为这个而存在，它硬编码顶层 `test/*.test.js` 列表 —— 这是唯一在 18/20/22/24 上含义一致的形式。
- `scripts/test-files.js` 是备用路径：在禁止子进程管道的沙箱里，`node --test` 会 `spawn EPERM`，这个脚本改为每个文件起一个独立的普通 node 进程。
- 临时文件统一走 `test/helpers/tmp.js`，CLI 端到端统一走 `test/helpers/cli.js`（子进程方式）。
- 并发相关的断言不能用 `setTimeout` 推出峰值并发数，那样在负载高的机器上会偶发失败；用显式 gate 断言确定的槽位数。
- GUI 测试**故意不用 `fetch`**：它会读 `HTTP_PROXY`，在有代理的机器上会把回环请求发给代理。用 `node:http` + `request({ headers: { connection: 'close' } })`，并在 `after` 里 `closeAllConnections()` 再 `close()`。
- **能证明 bug 修好了的测试必须能复现原 bug**。本轮两次用"反向注入"验证：把 `res.on('close')` 换回 `req.on('close')` 后，失败信息正好是快照记录的签名 `{"exit":1}` 加零个 chunk；把 `SHA256SUMS.txt` 里一个字符改掉后，校验测试报 `stale`。

### 打包与发布

- `scripts/build-exe.js` 用 Node 官方 SEA：esbuild 打成**单个 CommonJS** 文件（SEA 不能 require 同级文件），postject 注入到 Node 运行时的副本。不使用 pkg 或其它第三方打包器。
- 构建产物与输入（都在 `tools/sea/`）：`entry-<target>.mjs`、`bundle-<target>.cjs`、`sea-<target>.json`、`spacehog-<target>.blob` 是**生成物**；二进制本身与 blob 已被 gitignore，入口/bundle/json/校验和保留进仓库。
- Windows 产物 `spacehog.exe` 是**双模式**：无参数启动图形界面，带 `--cli` 或任何路径 / `--help` / `--version` 时走命令行。GUI 派生子进程固定带 `--cli`，两种模式不争 argv。
- Linux 产物 `spacehog-cli` **只有命令行，没有图形界面**，这是既定范围。
- macOS 有意不构建：SEA 产物未签名，Gatekeeper 会把它变成"应用已损坏"对话框，比让用户用 `npx` 更糟。
- `build.ps1` 提供 `check` / `pack` / `link` / `publish` / `all` 五个任务，默认 `check`。它**只写项目自己的 `dist/`**，且必须显式传 `-Publish` 才真正发包。PowerShell 5.1 兼容，不需要管理员权限。
- `--fail-on-dupes` 供 CI 当门禁用，命中时退出 **3**。
- 校验和约定：每个二进制旁边有 `<name>.sha256`（由 `build-exe.js` 写），另有一份合并的 `SHA256SUMS.txt`（由 `upload-assets.js` 重新生成并顺带核对 sidecar）。第 3 版新增测试守住三者的三方一致性。
- 上传入口是 `scripts/upload-assets.js`。默认**真的上传**（会调 `gh release upload`），必须显式加 `--dry-run` 才只打印；它发布 `spacehog.exe` 与 `spacehog-cli` 两个资产到 `v<package.json version>`，以 `--clobber` 覆盖同名资产，并顺带重新生成 `SHA256SUMS.txt` 与核对 sidecar。

### 安全

- 从不删除、从不移动用户文件。所有输出都是建议。
- GUI 只绑 `127.0.0.1`；子进程用参数数组派生，不拼 shell。
- `SECURITY.md` 记录了威胁模型。哈希非加密用途这一点在文档里写明。
- 凭据纪律：有效 token 只在 Windows 凭据管理器（gh keyring），不落明文文件、不进仓库、不进对话。仓库根的 `.github-token` 已在 `.gitignore` 里（当前不存在）。

---

## 4. 当前开发进度

### 已发布

- **v0.1.0**：CLI 骨架、三遍重复检测、硬链接识别、持久哈希缓存、大文件/垃圾/稀疏/空目录五个分区、`--json` 与 `--markdown`、`--fail-on-dupes`、程序化 API。
- **v0.2.0**（本地 tag 与 GitHub Release 均存在，Latest）：`--keep` 系列保留策略（`src/keep.js`，纯函数）、报告里标记 `← keep`、JSON 增加 `duplicateGroups[].keep` / `.redundant` 与 `options.keepPolicy` / `keepPrefer`；新增 `release-check.js` 与 `release.js` 作为唯一发布路径；删除三个手写 REST 发布脚本；新增 issue 表单、PR 模板、`SECURITY.md`、行为准则、Dependabot、`.gitattributes`（强制 LF）。

### 测试现状（第 3 版实测 130 / 130 通过，11 个文件）

| 文件 | 用例数 | 第 3 版变化 |
|---|---|---|
| `args.test.js` | 12 | — |
| `audit.test.js` | 10 | — |
| `cli.test.js` | 22 | +2（阈值退出 3、2 与 3 的区分） |
| `detectors.test.js` | 16 | — |
| `gui.test.js` | **6** | 新增 |
| `hash.test.js` | 14 | — |
| `keep.test.js` | 13 | — |
| `reporter.test.js` | 11 | — |
| `util.test.js` | 10 | — |
| `version.test.js` | **7** | +1（校验和清单一致性） |
| `walker.test.js` | 10 | — |
| 合计 | **130** | +8 |

其他门禁：

| 命令 | 第 3 版结果 |
|---|---|
| `node scripts/run-tests.js` | 130 / 130 |
| `node scripts/smoke.js` | 16 项全绿（第 3 版前有一项**必然失败**，见下） |
| `npm run verify:package` | 12 项全绿（真实 tarball 装到临时 prefix 后跑装上 CLI） |
| `node scripts/release-check.js` | 仅剩"工作树不干净"，符合预期 |

### 本轮已完成（相对第 2 版的新增）

**命令行健壮性（第 2 版已做，第 3 版仅补退出码 3）**

- `src/cli-kit.js` 落地，与另外五个同族项目**逐字节相同**（10165 字节，sha256 前缀 `92f9354fed3e`），且带幂等 guard。
- 参数解析错误全部改为带 hint 的 `UsageError`：未知选项走 `nearestName` 给 "did you mean"，缺值、非法枚举、非法尺寸各有具体提示。
- `bin/spacehog.js` 正确安装 `installCliHandlers`，`--debug` 为惰性求值。

**图形界面**

- `src/gui/` 四个文件：本地 HTTP 服务、单页前端、双模式入口、**源码模式的 CLI 子进程入口**。
- 文件夹选择器通过 PowerShell 的 `System.Windows.Forms.FolderBrowserDialog` 实现，避免引入任何 UI 依赖。
- `installer/index.html` 是一个静态安装引导页，仍未接入任何流程。

**SEA 二进制打包**

`tools/sea/` 下的产物（本轮实测大小）：

| 文件 | 大小 | 目标 | git 状态 |
|---|---|---|---|
| `spacehog.exe` | 93,778,432 B | Windows，GUI + CLI 双模式 | 已忽略 |
| `spacehog-cli` | 96,406,656 B | Linux，仅命令行 | 已忽略 |
| `spacehog` | 96,406,656 B | **较早的构建产物**（被取代） | 已忽略 |
| `spacehog{,-win,-linux}.blob` | 58–72 KB | SEA blob 中间产物 | 已忽略 |

校验和：三个二进制各有 `.sha256`；合并的 `SHA256SUMS.txt` 现在只列**实际要发布**的两个（`spacehog.exe`、`spacehog-cli`），且与实测哈希一致。

---

## 5. 待办清单

### 高优先级

1. ~~**GUI 的 `/api/run` 接口是坏的**~~ —— **已修复并验证**。根因确如第 2 版所记：`server.js` 用 `req.on('close')` 监听"客户端断开"，而 Node 在请求体被消费完就触发 `req` 的 `'close'`，于是 `child.kill()` 在子进程写出第一个字节之前就执行。改为监听 `res.on('close')`，并加 `!res.writableEnded && isRunning(child)` 双重判据；`relay` 也加了 `writableEnded` 守卫，避免向已死的响应写数据。新增 `test/gui.test.js` 覆盖该回归，反向注入确认它抓得住（失败信息正是 `{"exit":1}` 加零 chunk）。

2. ~~**开发模式下 `/api/run` 的结构性问题**~~ —— **已修复并验证**。新增 `src/gui/cli-child.js` 作为源码模式的 CLI 入口，`resolveSpawnTarget()` 按"本进程是否由脚本启动"决定形态。注意第 2 版设想的"`execPath` 表达成 node + 打包后的 cjs"会引入对 `tools/sea/` 的依赖，故选了更轻的专用入口。踩坑记录见第 3 节"派生子进程"。

3. **二进制还没有发布。**
   `spacehog.exe` 与 `spacehog-cli` 都还没上传到 `v0.2.0` Release。`scripts/upload-assets.js` 已修好并可用（`--dry-run` 输出正确的两个资产与两个哈希）；正式上传需要显式不带 `--dry-run`。上传前建议先在 Windows 上跑一次 `node scripts/verify-gui.js`。

4. **`.github/workflows/ci.yml` 有未提交改动，且当前凭据推不上去。**
   改动内容是新增一个 `package` job（三 OS 矩阵跑 `npm run verify:package`）。手上的 token 缺 `workflow` scope，任何包含 `.github/workflows/` 修改的 push 都会被拒。解法：`gh auth refresh -h github.com -s workflow`（会走一次浏览器/设备码确认）。

5. ~~**`tools/sea/` 下约 287 MB 二进制没有被 gitignore**~~ —— **已修复**。`.gitignore` 新增 `tools/sea/*` 加五条 `!` 例外（`*.cjs`、`*.mjs`、`*.json`、`*.sha256`、`SHA256SUMS.txt`），并逐个用 `git check-ignore` 验证了 20 个文件的预期归类：3 个二进制 + 3 个 blob 被忽略，其余 14 个构建输入与校验和保留。

### 中优先级

6. ~~**退出码 2 语义过载**~~ —— **已修复**。`--fail-on-dupes` 阈值命中改用 **3**，照 speck 的先例保留 0/1/2 既有含义。`src/cli.js`、`src/args.js` 的 USAGE、`README.md` 退出码表、`scripts/smoke.js`、`scripts/verify-package.js`、`scripts/README.md` 已全部同步，并有专门用例断言 `2 !== 3`。**这是破坏性变更**，CI 里按退出码 2 判定的脚本需要改成 3。

7. ~~**CHANGELOG 没有记录本轮变更**~~ —— **已补**。`[Unreleased]` 现分 Added / Changed / Fixed 三段，覆盖：退出码 3（含破坏性说明）、GUI、SEA 打包、`/api/run` 两个修复、smoke 脚本的陈旧断言、`tools/sea/` 忽略规则、`SHA256SUMS.txt` 漂移、文档退出码订正。0.2.0 条目的 "118 tests" 已订正为发布时的实际值 122。

8. **`docs/` 下的示例与教程缺失。**
   六个同族项目都有同样的问题：README 讲清了功能，但没有"从零走一遍"的教程，也没有可复制的示例输出。

9. **`build.ps1` 只在一个项目上验证过语法，没有实际跑通。**
   `pack` / `link` / `publish` 三条路径都还没有端到端验证。

10. **`installer/index.html` 没有接入任何流程。**
    目前是一个孤立的静态页，既没有被二进制引用，也没有部署目标。

11. **`cli-kit.js` 靠人工复制同步。**
    目前六个副本一致，但没有任何机制阻止它们再次漂移。可以加一个校验脚本（对比各项目副本与 `_shared` 的哈希）挂到测试或 CI 里。

12. ~~**`SHA256SUMS.txt` 与 `.sha256` 文件不一致**~~ —— **已修复，且比原记录更严重**。原文件不仅漏了 `spacehog-cli`，它给 `spacehog.exe` 记的哈希（`78237fe4…`）与任何一次构建都不匹配（实际 `b6d21adb…`），三个产物里两个是错的。根因是 `upload-assets.js` 的资产清单发布的是被取代的旧 Linux 产物 `spacehog` 而不是当前构建的 `spacehog-cli`。已修正资产清单、加了 sidecar 核对、用实测哈希重算了合并清单，并新增 `test/version.test.js` 用例守住三方一致（反向注入验证过）。

### 第 3 版新增

13. **代码与二进制尚未提交，也未推送。**
    13 个已跟踪修改 + 24 条未跟踪内容仍在工作区；`origin/main` 与本地同点。建议的提交切分（每个提交都应保持测试全绿）：
    1. 命令行加固（`src/cli-kit.js`、`src/args.js` 的 hint、`bin/spacehog.js`、`test/cli.test.js`）
    2. 退出码拆分（`src/cli.js`、`src/args.js` 的 USAGE、`test/cli.test.js`、`scripts/smoke.js`、`scripts/verify-package.js`、`README.md`、`CHANGELOG.md`）
    3. GUI（`src/gui/**`、`test/gui.test.js`、`README.md`、`CHANGELOG.md`）
    4. 构建/发布工具（`tools/sea/**`、`scripts/{build-exe,upload-assets,verify-gui}.js`、`.gitignore`、`build.ps1`、`installer/index.html`、`package-lock.json`、`.github/workflows/ci.yml`）

14. **本机 git 到 GitHub 的 HTTPS 通道不可用（本轮实测，未解决）。**
    见第 0 节网络表。`gh.exe` 能访问 GitHub API，`github.com:443` 的 CONNECT + TLS 也在干净进程里验证成功，但 `git.exe` 走同一代理失败：`schannel: server closed abruptly (missing close_notify)`。**结论：在那之前，用 `gh api` 完成 GitHub 侧操作是可行兜底（例如用 Git Data API 建提交、或用 `gh release upload` 传资产），但不能用 `git push`。** 未验证完的兜底组合：`http.version=HTTP/1.1`、`http.sslBackend=openssl`、以及端口 `1001`。

15. **`smoke.js` 里"路径不存在退出 1"是陈旧断言** —— **已修**（改为 2），并补了一条"坏选项退出 2"。这说明该脚本自退出码拆分那轮起就不可能通过，值得在 CI 里真正跑一次它。

16. **`spacehog`（无后缀）二进制是被取代的产物。**
    它与 `spacehog-cli` 字节数相同、哈希不同，来源是 `build-exe.js` 早期分支或更早的手工构建。已在 `upload-assets.js` 里排除，但**仍在磁盘上**。建议删除或改名归档，避免下次误发。

17. **`tools/sea/` 里的陈旧构建输入。**
    `entry.mjs`（458 B）、`spacehog.cjs`（58029 B）、`sea-config.json`（168 B）、`sea-entry.cjs`（408 B）、`spacehog.sha256`（75 B）都不是当前 `build-exe.js` 的产物命名（当前是 `entry-<target>.mjs` / `bundle-<target>.cjs` / `sea-<target>.json`），属于更早的手工流程残留。它们现在**会被保留进仓库**（`bundle-*.cjs` 等 `!` 例外放行）。建议确认后清理，否则仓库里会同时存在两代构建输入。

### 已决定不做

18. **macOS 二进制**：SEA 产物未签名会被 Gatekeeper 拦，属于有意放弃，不是待办。
19. **CI 流水线扩展与附属功能**：按既定范围本次不做。

### 调试预算状态

二进制打包这条线在第 2 版时已用完了约定的 3 轮调试配额。第 3 版的实际处置是：**第 1、2 项的根因既然已经明确到一行改动，就不再算作"继续调试"，而是当作已批准的修复直接落地并配回归测试**；SEA 构建线本身（重新构建二进制）仍未重启。第 14 项（git 推送通道）是新开的调试线，目前只做了探针与排除，未做修改。

---

## 附：本快照的信息来源

- 直接读取：`package.json`、`src/index.js`、`src/args.js`、`src/cli.js`、`src/audit.js`（导出签名）、`src/walker.js`（导出签名）、`src/detectors.js`（导出签名）、`src/hash.js`（导出签名）、`src/keep.js`（导出签名）、`src/reporter.js`（导出签名）、`src/util.js`（导出签名）、`src/cli-kit.js`（导出签名）、`src/gui/server.js`（全文）、`src/gui/main.js`（全文）、`src/gui/cli-child.js`（全文）、`scripts/run-tests.js`、`scripts/smoke.js`（部分）、`scripts/verify-package.js`（部分）、`scripts/upload-assets.js`（全文）、`scripts/build-exe.js`（部分）、`scripts/README.md`（部分）、`test/gui.test.js`、`test/version.test.js`、`test/helpers/tmp.js`、`README.md`（部分）、`CHANGELOG.md`（全文）、`.gitignore`、`.github/workflows/ci.yml`（diff）。
- 实际执行：`node scripts/run-tests.js`（130/130）、`node scripts/smoke.js`（16 项全绿）、`npm run verify:package`（12 项全绿）、`node scripts/release-check.js`、`node --test test/gui.test.js`（含把 `res.on('close')` 反向改回 `req.on('close')` 的对照运行）、`node --test test/version.test.js`（含篡改 `SHA256SUMS.txt` 的对照运行）、`node scripts/upload-assets.js --dry-run`、`git status/log/tag/check-ignore/rev-list`、`gh auth status` / `gh api user` / `gh release list`、`Get-FileHash` 三方比对、TCP/CONNECT/TLS 探针（含 `gitlab.com` 对照）、`Get-NetTCPConnection` 端口枚举、`node --check`（全部改动文件）。
- 临时探针脚本 `probe-snapshot.mjs` 用于导出实测的选项默认值、Report 键集与导出名单，**已删除**。
- 未核实：`README.md` 与 `CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md` 的全文；`src/audit.js`、`detectors.js`、`hash.js`、`keep.js`、`reporter.js` 的函数体内实现细节（本版只核对导出签名与行为约定）；`src/gui/page.js` 的前端逻辑；`build.ps1` 全文；`tools/sea/*.cjs` 打包产物内部；`installer/index.html`。
