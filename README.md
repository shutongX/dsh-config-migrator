# dsh-config-migrator

Export selected DSH state as a zip, then restore it on a new machine section by section, with a conflict preview before anything is written.

把本机 DSH 的分区配置打包成一个 zip；在新机器上按需、可选择性地还原，并先分析冲突。

## 安装

任选一种：

**方式一：DSH 插件页**

插件 → 添加插件 → 粘贴：

```text
https://github.com/shutongX/dsh-config-migrator
```

**方式二：我的插件市场索引**

DSH → 插件 → 实验性插件 → 更多 → 开启「自定义插件市场」→ 发现 → 添加索引源：

```text
https://shutongX.github.io/dsh-plugins-index/index.json
```

**方式三：命令行**

```sh
dsh plugin --profile desktop add https://github.com/shutongX/dsh-config-migrator
```


> 如果你以前用开发目录装过旧的 `@dsh-external/<name>` 版本，先移除旧插件，再装这里的无 scope 包；否则同一功能会同时加载两份。

## 怎么用

打开 **设置 →「配置迁移」**，三个页签：导出 / 导入 / 快照。

1. **导出**：勾选要带走的区块 → 生成 zip。API key 自动脱敏；凭据区块默认不导出，勾选后需要设置一个加密密码。
2. **导入**：上传 zip → 先看清单和冲突分析 → 每个区块单独选择「用备份 / 保留本机 / 跳过」→ 确认后才写盘。导入前可以自动创建快照。
3. **快照**：导入、还原会留下快照，可以回滚。

导出的 zip 里带一个 `restore/` 安装器：新机器如果还没有这个插件，双击 `install.cmd`（Windows）或运行 `install.sh`（macOS/Linux）就能把插件装进 profile，然后重启 DSH 走界面导入。

## 能迁什么

| 区块 | 内容 |
|---|---|
| profile | profile 的 package.json、cordis.patch.yml、pnpm 配置 |
| plugins | 已装插件的安装 spec |
| marketplace | 自定义插件市场索引地址 |
| localPlugins | `link:` 依赖指向的本地插件目录 |
| models | patch 里 llm-* 的 provider / model / baseURL（apiKey 脱敏） |
| skills | 全局 / profile / 已装包里的 SKILL.md |
| mcp | MCP 服务定义 |
| agentPresets | Agent 预设 |
| settings | 其余 patch 条目（默认模型、权限、UI 偏好等） |
| instructions | `$DSH_HOME/AGENTS.md` 与工作区 AGENTS.md |
| workspaces | workspace.json 与已知工作区目录 |
| sessions | 会话日志（逐条可选） |
| storages | `$DSH_HOME/storages/*.json`（排除缓存类） |
| pluginData | 插件私有数据（白名单） |
| attachments | 附件 |
| credentials | 凭据（需密码，默认不导出） |

## 安全

- API key / token / 密码在导出时脱敏，不写入 zip。
- `dsh-pocket/token` 等明文密钥文件扫描阶段就跳过，不会被打包。
- 导入是白名单写入：只允许写在对应根目录内，并拒绝任何凭据、`.pem`、`.key` 的写入。
- 导入前先预览冲突，确认后才写；写盘前自动快照。

## 数据位置

- 插件数据：`$DSH_HOME/config-migrator/`（exports / uploads / snapshots）
- 不想要了：删掉这个目录即可。

## 兼容性

- 需要 DSH `>=0.2.1-rc.1`。
- 只用 Node 内置模块，零第三方依赖；没有网络请求。

## 开发

```sh
npm test          # 冒烟测试
```

设计契约（分区、格式、安全边界）在 [docs/SPEC.md](docs/SPEC.md)。

## License

MIT
