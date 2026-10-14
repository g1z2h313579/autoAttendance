# 任务 1 打包后实际验证记录

> 2026-10-14，分支 `spike/desktop-packaging`（独立工作树 `../kaoqin-desktop`）。验证代码不合入主线；本文件的结论在验证结束后单独合入。
>
> 能用脚本完成的项目由 Claude 实测；需要在界面上观察的项目由维护者操作，Claude 负责构建、安装和读取日志。需要注销重新登录的两项和 Intel 未验证，见“未完成的验证”。

## 环境与版本

| 项目 | 值 |
| --- | --- |
| 机器 | Apple Silicon，macOS（Darwin 27.0.0），**未安装 Rosetta** |
| Node（开发） | nvm 0.40.8 安装的 24.21.0；工作树内由 `.nvmrc` 固定。新开 shell 默认仍为 Homebrew node@22（`nvm alias default system`） |
| npm | 11.19.0 |
| Electron | 44.7.2（内置 Node 24.21.0） |
| SQLite | 3.53.4（Electron 与 Node 24.21.0 相同） |
| @electron/packager / fuses / Playwright | 20.3.0 / 2.1.3 / 1.64.0 |
| 旧版服务 | `local.kaoqin.web`、`local.kaoqin.collector` 全程未停、未重启（PID 不变），3939 端口正常 |

在 Node 24 下，现有 142 项测试、类型检查和 lint 全部通过。

## 结论总览

### 打包、签名与构建配置

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 正式构建 arm64，临时签名 | 通过 | `codesign --verify --deep --strict` 通过；指定要求为 cdhash，代码有改动的重新构建都会变（逐字节相同的重新构建不变） |
| 正式构建 arm64，本机自建证书 | 通过 | 未信任的自建证书放在单独的钥匙串文件中即可签名并启动，不需要改系统信任设置；指定要求为“标识符 + 证书叶哈希”，重新构建后不变 |
| 通用包 | 通过 | 主程序、Framework、Swift 监听器均含 x86_64 和 arm64；严格校验通过；应用 507MB，zip 229MB |
| 两套构建配置 | 通过 | 测试构建可被 Playwright 启动并读取窗口；正式构建拒绝调试参数，Playwright 20 秒超时，无残留进程 |
| 运行时开关 | 通过 | 正式包：RunAsNode、NODE_OPTIONS、Node 调试参数均关闭；asar 完整性校验与只从 asar 加载开启 |
| 签名身份变化后覆盖安装 | 通过 | 临时签名重新构建、临时签名切换到自建证书，覆盖安装后均不需要重新允许后台，登录项不重复，通知不再询问权限 |

### 数据库

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| utilityProcess 中的 `node:sqlite` | 通过 | 可用，含在线备份 `backup()` |
| 两个工作进程并发 `BEGIN IMMEDIATE` 先读后写 | 通过 | 各 1000 轮 ×3 次：0 错误、0 丢失、0 重试，两边交替执行；备份完整性 ok |
| 延迟事务对照 | 复现 | 先读后写失败 6%～11%，错误码为 517（`SQLITE_BUSY_SNAPSHOT`）和 5（`SQLITE_BUSY`） |
| 嵌套事务 | 复现 | `cannot start a transaction within a transaction` |
| **新库并发打开** | **发现问题** | 见“需要修改的设计”第 1 条 |

### 后台与进程

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| launchd RunAtLoad | 通过 | bootstrap 后 agent、Helper、监听器均启动 |
| 强杀 agent | 通过 | Helper 与 Swift 监听器在 26ms 内全部退出；launchd 立即重启（运行超过节流间隔时不等待） |
| agent 以 0 退出 | 通过 | `KeepAlive.SuccessfulExit=false` 下 40 秒内未重启 |
| 先删启动项再 bootout | 通过 | `bootout` 3ms 返回，各进程 33ms 内退出，40 秒内未复活，任务已卸载 |
| 在系统设置中关闭、再打开后台项目 | 通过，需改设计 | 见下文“系统设置中的后台开关” |
| utilityProcess `kill()` 到 `exit` 事件 | 通过 | 约 4ms；收到事件时进程确已退出；监听器 500ms 内退出 |
| Swift 监听器在标准输入关闭时退出 | 通过 | 对照：现有监听器在父进程退出后成为孤儿（ppid=1）一直存活；改后随父进程退出 |
| userData 隔离 | 通过 | 在 ready 前设置 userData 后，Electron 未在默认目录写任何文件，`Library/Caches` 下也未建目录 |
| 路径含空格和中文 | 通过 | 安装路径 `~/Applications/考勤 验证/`、数据目录 `后台 数据` 均正常 |

### 界面与系统集成

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 打开路由 | 通过 | Finder、程序坞、Spotlight、`open -a`、菜单栏、通知六种方式，维护者确认始终只出现一个窗口；见下文 |
| 登录项中的显示 | 与预期不同 | 显示为可执行文件名 `kaoqin-spike` 和通用的 `exec` 图标，不显示应用图标；见“需要修改的设计”第 8 条 |
| 菜单栏项目 | 与预期不同 | 文字标题“考勤”被刘海挡住，维护者一开始没找到；见第 9 条 |
| 隔离标记与首次打开 | 通过 | 见下文“首次打开” |
| 写入受保护目录 | 未得出结论 | gui main 向“文稿”写入时没有弹出授权框，“文件与文件夹”中也没有出现该应用，原因未查明；签名变化后授权能否保留因此无法验证 |

## 打开路由

agent 在运行时，打开请求的去向如下：

| 方式 | 系统交给谁 | 结果 |
| --- | --- | --- |
| Finder 双击、Spotlight、`open -a` | **agent**（触发 `activate`），即使 gui 已在运行 | agent 执行 `open -n -a … --args --role=gui`。gui 没在运行时新进程约 180ms 后 ready；gui 已在运行时，新进程拿不到单实例锁，16ms 内退出，并通过 `second-instance` 转给已有窗口 |
| 程序坞 | gui 自己（程序坞图标属于 gui 进程） | 已有窗口重新显示 |
| 菜单栏“打开考勤” | agent | 同第一行 |
| 点击 agent 发出的通知 | agent，**同时收到 `click` 和 `activate` 两个事件** | agent 连续发出两次打开请求，两个新进程抢单实例锁，只留下一个窗口；见“需要修改的设计”第 10 条 |

结论：规格中的方案成立。临时出现的 gui 进程在 `app.dock.show()` 之前就退出，按理不会出现程序坞图标；维护者确认没有出现第二个窗口，程序坞图标是否一闪而过未专门观察，留到正式包验收时再看。

## 系统设置中的后台开关

在“系统设置 → 通用 → 登录项与扩展 → 后台 App 活动”中：

- **关闭开关：**
  - 系统立即卸载任务，`launchctl print` 找不到该任务；agent 走正常退出流程，以 0 退出；
  - 启动项文件**仍然保留**；
  - `launchctl print-disabled` **没有任何变化**，用它检测不出关闭状态。
- **关闭状态下由应用自己执行 `launchctl bootstrap`：** 仍然成功，agent 重新运行，系统设置中的开关保持关闭。
- **重新打开开关：** 系统立即加载任务并启动 agent。

结论：

- “启动项文件存在但任务未加载”就是“被系统设置关闭”的判定依据。
- 应用不能在这种状态下自行重新加载，否则会绕过用户的选择，只能提示用户回系统设置打开。

## 首次打开（带隔离标记的通用包）

把 zip 放进“下载”并加上隔离属性，由维护者在 Finder 中双击解压，再双击应用。实际流程：

1. 弹出“未打开‘kaoqin-spike’”，提示 Apple 无法验证是否包含恶意软件，只有“完成”和“移到废纸篓”两个按钮。点“完成”。
2. 在“系统设置 → 隐私与安全 → 安全性”中出现“已阻止‘kaoqin-spike’以保护 Mac”，旁边有“仍要打开”。点击后需要用触控 ID 或管理员密码确认。
3. 再次打开，应用正常启动。隔离标记从 `0083` 变为 `00c3`。
4. **不移动直接运行时**，应用在 `/private/var/folders/…/AppTranslocation/<随机>/d/kaoqin-spike.app` 下运行，事件日志记录 `translocated: true`。
5. 在 Finder 中拖到“应用程序”后再打开，不再拦截，`translocated: false`，从 `/Applications/kaoqin-spike.app` 运行。

## 需要修改的设计

1. **打开数据库的顺序与重试（任务 3）。**
   - 现有 `openDb` 先执行 `journal_mode=WAL`，再设置 `busy_timeout`。两个进程同时打开新库时，`journal_mode=WAL` 会直接返回 `SQLITE_BUSY`，有时两边都失败。
   - 即使先设置等锁时间，切换到 WAL 也偶尔失败：切换需要排他锁，SQLite 为避免死锁不会调用等锁处理。
   - 改为：先设置 `busy_timeout`，再切换 WAL，并在应用层对 `SQLITE_BUSY` 退避重试（验证中最多重试 1 次）。
   - 首次设置时 gui 与 agent 几乎同时启动，正好命中这种情况。
2. **SIGTERM 由 Electron 接管（任务 4、6）。** agent 主进程里的 `process.on('SIGTERM')` 不会触发。Electron 自己把 SIGTERM 转成 `app.quit()`，因此收尾（通知工作进程停止、等待退出、写入 `running=false`）要放在 `before-quit` 中。验证中按这种方式以 0 退出，launchd 不会重启；系统设置关闭开关时也走这条路径。
3. **按路径查找进程必须设置 UTF-8 locale（任务 9）。**
   - 不设置时，`ps` 会把中文路径转义成 `M-hM^@…`，按应用路径匹配会全部落空。
   - launchd 和 Electron 启动的进程默认没有设置 locale，所以 `waitAppProcessesExit` 调用 `ps` 时要设置 `LC_ALL=en_US.UTF-8`。
4. **bootout 不等待进程退出（任务 9）。** 这印证了安装脚本必须轮询等待进程退出。验证程序 33ms 就退完了，但正式版退出前还要等监听器、关闭数据库，超时时间建议取 10 秒以上。
5. **避免长时间连续占用写锁（任务 3、4）。**
   - 一方连续执行写事务、中间不停顿时，另一方的等锁处理可能一直抢不到锁。
   - pmset 补齐和维护任务要拆成多个短事务，每个事务的耗时要远小于 `busy_timeout`（5 秒）。
6. **npm 11 默认不执行依赖的安装脚本（任务 2、9）。**
   - Node 24 自带 npm 11.19，默认跳过依赖的 install/postinstall 脚本，需要在 `package.json` 的 `allowScripts` 中放行。
   - Electron 44 已不再使用 postinstall，首次使用时才下载，或者用 `install-electron` 预先下载，所以不需要放行。
   - 本分支只放行了 esbuild（其安装脚本仅做校验）。
   - 一键安装脚本在打包前应先执行一次 Electron 下载，避免把下载失败混在打包错误里。
7. **签名方式（任务 9）。**
   - 在后台、登录项和通知三方面，两种签名没有观察到差别，包括签名身份变化后的覆盖安装。
   - 程序员安装默认使用临时签名，不需要钥匙串，步骤最少；自建证书作为可选项保留，供以后遇到授权问题时使用。
   - 受保护目录的授权没有得出结论，放到正式包的安装验收中再看。
8. **登录项中的显示（规格、任务 9）。**
   - 没有 Team ID 时，`AssociatedBundleIdentifiers` 不起作用，登录项只显示可执行文件名和通用 `exec` 图标。没有开发者账号无法改变这一点。
   - 主程序的可执行文件名就是用户在登录项里看到的名字，正式版的可执行文件名应能让用户认出来（如 `kaoqin`）。
   - 安装说明里要配图说明登录项里会是什么样子，避免用户误以为是不明程序而关掉。
9. **菜单栏项目（任务 6）。**
   - 文字标题容易被刘海挡住，改用窄的模板图标，必要时只在状态异常时附加短文字。
   - 安装说明里提示：菜单栏图标较多时，可能被刘海挡住；新版 macOS 的“系统设置 → 菜单栏”里也可以控制是否显示。
10. **合并重复的打开请求（任务 6）。** 点击通知时 agent 会同时收到 `click` 和 `activate`。agent 的“打开界面”应在短时间内（如 1 秒）只执行一次，避免多起一个进程。
11. **后台状态的判定（规格 §4、任务 6）。**
    - 原规格写“启动项文件是否存在是‘已启用’的唯一依据”，需要细化：
      - 启动项文件存在且任务已加载：已启用；
      - 启动项文件存在但任务未加载：**在系统设置中被关闭**，界面提示用户去系统设置重新打开，**不自动重新加载**；
      - 启动项文件不存在：未启用或已由用户停止。
    - `launchctl print-disabled` 不能用来判断。
12. **首次打开与转移路径（任务 8、9）。**
    - 首次设置检测到运行路径包含 `/AppTranslocation/` 时，不注册后台，提示把应用拖到“应用程序”后重新打开。移动后不会再次拦截。
    - 给非程序员的安装说明要配图写清上面“首次打开”的第 1～3 步，这是没有开发者账号时绕不开的步骤。

## 未完成的验证

| 项目 | 原因 | 后续 |
| --- | --- | --- |
| 登录时程序坞不闪现 | 维护者当时不便注销 | 任务 11 正式包验收时，注销重新登录观察 |
| 停止后台后重新登录不启动 | 同上 | 验证结束时已删除启动项文件；下次正常登录时确认没有出现测试后台 |
| 受保护目录的授权与签名身份 | 未弹出授权框，原因未查明 | 任务 7 导出功能完成后，在正式包上重测导出到“文稿”“桌面” |
| Intel | 本机没有 Rosetta | 在 Intel 机器上，或安装 Rosetta 后，运行通用包 |

## 验证脚本

以下脚本和验证程序只在分支 `spike/desktop-packaging` 中，不合入 `main`。在该分支的工作树中先执行 `nvm use`。

| 命令 | 作用 |
| --- | --- |
| `node scripts/desktop/spike-package.mjs --config=release\|test --arch=arm64\|universal [--sign=<证书>] [--keychain=<路径>] [--zip]` | 构建、打包、设置开关、由内向外签名并校验；每次构建写入不同的构建号 |
| `bash scripts/desktop/spike-stress.sh <immediate\|deferred> <new\|old> [N]` | 两个角色并发压力测试 |
| `node scripts/desktop/spike-playwright.mjs <.app 路径>` | Playwright 启动测试 |
| `node scripts/desktop/spike-launchd.mjs install\|status\|events\|kill9\|term\|upgrade\|remove\|uninstall` | 测试启动项 `local.kaoqin.agent.qa` 的安装、事件查看、强杀、正常退出、覆盖安装与移除 |

验证结束时已清理：

- 测试启动项；
- `~/Applications/考勤 验证/`、`/Applications/kaoqin-spike.app`；
- “下载”中的 zip；
- `~/Library/Application Support/kaoqin-spike/`；
- 临时钥匙串与自建证书。

工作树 `dist/desktop-spike/` 下的构建产物保留，不受版本管理。
