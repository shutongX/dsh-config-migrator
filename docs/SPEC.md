# dsh-config-migrator · 设计契约（唯一事实来源）

目标：把本机 DSH 的全部可迁移状态打包成一个 zip；在新机器上按需、可选择性地还原，并先分析冲突。

## 1. 包结构（手工编写，无构建步骤）

    dev-plugins/dsh-config-migrator/
      package.json            # type=module，exports: "." "./client" "./locale/*.json" "./icon"
      cordis.patch.yml        # - insert: [{id: dsh-config-migrator, name: ...}]
      icon.svg
      locale/zh.json  locale/en.json   # {meta:{title,description}}
      lib/index.js            # host 入口：export apply / inject / Config
      lib/host/*.js           # host 实现（ESM，只用 node: 内置模块，零第三方依赖）
      lib/client.js           # 浏览器 UI（单文件，window.__ModuleLoader__.load 包裹）

硬约束：
- host 侧禁止 import 任何非 node 内置包（不许 fflate/jszip/yaml/cordis）。YAML 只做本项目需要的最小解析与生成。
- client 侧单文件；require('react') 是唯一外部依赖。
- 没有任何构建产物：lib/ 就是源码，改完直接重装或热重载。

## 2. 分区模型（section）

每个 section 提供 scan(ctx) 返回 item 列表，pack(item) 返回条目内容，apply(item, choice) 负责导入。

| id | 标题 | 覆盖内容 |
|---|---|---|
| profile | 环境骨架 | profiles/<p>/package.json、cordis.patch.yml、pnpm-workspace.yaml、pnpm-lock.yaml |
| plugins | 已装插件 | package.json 里每个依赖的安装 spec（npm 版本 / tgz URL / link: 本地目录） |
| marketplace | 插件市场 | cordis.patch.yml 里 plugin-market.indexes 等自定义市场地址 |
| localPlugins | 自写插件 | link: 依赖指向的本地目录（源码 tree，单插件默认上限 5MB） |
| models | 模型供应商 | patch 中 llm-* 条目的 providers/models/baseURL（apiKey 一律脱敏） |
| skills | 技能 | 各 SKILL.md 目录（$DSH_HOME/skills、profile 内 skills、已装包 skills/） |
| mcp | MCP 服务 | patch 中 mcp 相关条目与 mcp server 定义 |
| agentPresets | Agent 预设 | agent-preset-registry 配置与自定义预设目录 |
| settings | 系统默认配置 | 除上面已归属条目外的全部 patch 条目（默认模型、权限预设、UI 偏好、agent-loop 等） |
| instructions | 全局规则 | $DSH_HOME/AGENTS.md 与工作区 AGENTS.md |
| workspaces | 工作区 | storages/workspace.json、已知工作区目录列表 |
| sessions | 会话 | $DSH_HOME/sessions/**/session.*.jsonl*（逐会话可选，标题来自 projcache） |
| storages | 其它存储 | $DSH_HOME/storages/*.json（schedule.json 等），排除缓存类 |
| pluginData | 插件私有数据 | $DSH_HOME/<plugin>/** 白名单（config-migrator 自身除外） |
| attachments | 附件 | $DSH_HOME/attachments/** |
| credentials | 凭据 | $DSH_HOME/.credentials.yaml（默认不选；选了必须设密码，scrypt + AES-256-GCM） |

item = { id, section, label, detail, relPath, bytes, sha256, kind, meta, truncated? }；kind ∈ file | tree | config | remap。
`truncated: true` 表示该条目因单条大小/数量上限被截断（UI 标红并显示「备份不完整」）。

## 3. zip 内布局

    manifest.json
    home/<相对 $DSH_HOME 的路径>
    restore/install.mjs|install.cmd|install.sh|README.txt   # 自带安装器（新电脑不必先装插件）
    tool/dsh-config-migrator/**                               # 插件本体（排除 node_modules/docs/mock/temp/*.zip/test 脚本）

manifest.json：

    {
      "format": "dsh-config-migrator/v1",
      "createdAt": "ISO",  "dshVersion": "x.y.z",
      "profile": "desktop", "profileDir": "...", "sourceHome": "C:/Users/x/.dsh",
      "secretsIncluded": false, "encrypted": false,
      "sections": [ { "id": "sessions", "title": "会话", "items": [ {"id":"...","relPath":"...","bytes":1,"sha256":"..."} ] } ],
      "env": { "node": "v22", "platform": "win32", "homePaths": ["C:/Users/x"] }
    }

## 4. Host 与 UI 的 HTTP 契约

前缀路由 /dsh-config-migrator（webserver prefix route）。浏览器端用相对路径 fetch。

| 方法 路径 | 入参 | 出参 |
|---|---|---|
| GET /api/overview | – | { dshHome, profile, profileDir, dshVersion, platform, snapshots } |
| GET /api/catalog | – | { sections: [ { id, title, desc, totalBytes, items: [...] } ] } |
| POST /api/export | { sections:{id:bool}, items:{sectionId:[itemId]|null}, includeSecrets, password } | { file, size, downloadUrl, warnings } |
| GET /download/<name> | – | zip 字节流 |
| POST /api/import/inspect | raw zip body | { archive, manifest, sections:[{id,title,items:[{itemId,status,localBytes,incomingBytes,diff}]}], pathWarnings } |
| POST /api/import/apply | { archive, choices:{sectionId:{itemId:'use-backup'|'keep-local'|'skip'}}, remap:[{from,to}] } | { applied, skipped, failed, snapshot, restartRequired } |

apply 的确认策略：HTTP 不要求 confirm 字段——该路由只在已鉴权的 Web 会话里可调（cookie + Origin/Host 栅栏），点「开始导入」本身就是用户确认；但 apply 必须永远先写快照、失败整体回滚。agent 工具侧的 action=apply 必须显式 confirm:true。
| POST /api/import/rollback | { snapshot } | { restored } |
| GET /api/snapshots | – | [ { id, at, bytes, files } ] |

item status ∈ new | same | conflict | missing | unknown。unknown = 本机读取失败（被占用/无权限），必须由用户显式选择动作，不允许默认覆盖。错误统一 4xx/5xx + { error:{code,message} }。
上传的 zip 落到 $DSH_HOME/config-migrator/tmp/uploads/<sha256>.zip，inspect 返回 archive token（= sha256），apply 用它。

## 5. 安全与不变量

1. 默认 secretsIncluded=false。导出时只脱敏**值**字段：apiKey / token / secret / password / authorization 等，命中改为 __REDACTED__；**apiKeyEnv 不脱敏**（它是环境变量名，不是密钥，脱敏会让新机器上的供应商配置失效）。warnings 里列出「需在新机器重填的键」。
2. 只有显式勾选 credentials 且提供密码，才把 .credentials.yaml 以密文条目写进 zip（sealed/credentials.bin），绝不写明文。
3. 导入写入白名单：只允许写 $DSH_HOME 下的 profiles/<当前profile>/、sessions/、storages/、attachments/、AGENTS.md、已知插件数据目录。所有路径先 resolve 再校验前缀，拒绝 ..、盘符跳转、symlink 逃逸。
4. apply 前自动快照将被覆盖的文件到 $DSH_HOME/config-migrator/snapshots/<ts>/；任一项失败自动回滚并返回 failed 明细。
5. 不试图热改运行中的插件装配；package.json / bundles 写入后提示重启生效。
6. 路径重映射：manifest.sourceHome 与本机不同时，inspect 给出 remap 建议（sessions 里的 cwd、workspace.json 目录、link: 插件目录）。
7. 明文密钥文件在**扫描阶段**排除：不进 zip、也不出现在 catalog（用户无法勾选）。精确黑名单 `dsh-pocket/token`、`dsh-pocket/token-lan`；pluginData / storages 范围内 basename 命中 `/^(token|tokens|token-.*|.*\.secret|credentials?\.(json|ya?ml)|.*\.key|.*\.pem)$/i` 的一并排除。这些文件由新机器重新生成，不跟随迁移；确实要带走请手动复制。导出 warnings 必须给出「未导出：…（明文密钥文件…）」说明，并追加一条全局提示：「会话与附件内容原样导出，未做脱敏」。
8. 脱敏只作用于配置类文本（.json/.jsonc/.jsonl/.yml/.yaml/.toml/.ini/.conf/.env）：键名用宽松匹配 `/(^|[-_.])(api[-_]?key|apikey|token|secret|password|authorization)([-_.]|$)/i`，另加 `.env` 的 KEY=VALUE 行规则与值前缀兜底（sk-/ghp_/xoxb-/AKIA/xai-/AIza）。**会话与附件刻意不脱敏**：会话是 zstd 压缩的 jsonl、附件是二进制，改写会破坏内容；导出时用 warnings 明示，这是经过取舍的决定，不是遗漏。
9. manifest 隐私：`sourceHome` / `profileDir` / `env.homePaths` 打码为 `C:/Users/<user>/…`，分享 zip 不泄露真实用户名与目录结构。代价是自动 remap 只能按打码后的前缀比对，精确重映射由 apply 的 `remap:[{from,to}]` 手动提供。
10. 导入的 zip 是**不可信输入**：读取侧对条目名复用 `normalizeEntryName`（`..`、绝对路径、盘符 → 400）；每个 item 按 manifest 的 sha256 校验内容，不符直接拒绝整包；解压总量上限 512MB、条目数上限 100000；导出超过 4GiB 明确报错并提示分批。
11. apply 写前快照、首个失败立即停止并整体回滚；apply/rollback 进程内互斥，第二个请求返回 409；本机读取失败记为 unknown，默认动作必须是用户显式选择。
12. 磁盘清理：导出保留最近 10 个 zip、快照保留最近 5 个、上传包保留最近 2 份（inspect 后自动修剪）。

## 6. UI 要件（settings.section 槽位）

- 入口：设置 → 「配置迁移」。
- 三个标签页：导出 / 导入 / 快照。
- 导出页：分区卡片列表，每张卡可整体开关、可展开到条目级多选；底部实时显示「已选 N 项 / 预计 X MB」；主按钮「生成 zip」，完成后给下载链接。
- 导入页：选择或拖入 zip → manifest 概要 + 冲突表（新增/相同/冲突/缺失，冲突项可选「保留本机 / 用备份」）→ 「开始导入」→ 结果页（成功/跳过/失败 + 重启提示 + 一键回滚）。
- 快照页：快照列表 + 恢复。
- 全中文文案（英文 locale 同步）；只用 --dsw-alias-* 主题变量，不自造颜色；卡片、开关、行高、圆角对齐宿主设置页。
- 网络失败要有可见错误条，不允许静默。

## 7. 代理工具（同一个操作两个调用面）

工具名 config_migrator，action: overview | catalog | export | inspect | apply | rollback | snapshots。
参数对齐 HTTP 契约；export 返回产物绝对路径与大小；apply 需要 archive 与 confirm:true。

## 8. 验收

- 导出：勾选全部分区（不含 credentials）得到 zip；manifest 与条目一致；zip 内不含用户 API key 真值。
- 导入：同一台机器 inspect 自身导出的 zip，所有条目应为 same 或列出明确冲突；apply 后文件与 zip 一致。
- 会话逐条选择：只导 1 个会话时 zip 内只有该会话目录。
- 回滚：apply 后 rollback，被覆盖文件恢复为导入前内容。