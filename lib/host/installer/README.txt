dsh-config-migrator · 自带安装器

这个 zip 里带了三样东西：
  home/    你的 DSH 配置与会话（真实数据）
  tool/    插件本体（dsh-config-migrator）
  restore/ 安装器（就是本目录）

--------------------------------
Windows（推荐）
--------------------------------
1) 先把 DSH 装好并启动一次，让它把配置目录建出来，然后完全退出。
2) 解压整个 zip 到一个普通目录（路径别有奇怪字符）。
3) 双击 restore\install.cmd
   不需要装 Node.js：脚本用系统自带的 PowerShell 完成安装。
4) 重启 DSH -> 设置 ->「配置迁移」-> 导入 -> 选这个 zip。

--------------------------------
macOS / Linux
--------------------------------
  sh restore/install.sh
  这条需要系统里有 node（用的是 install.mjs）。没有 node 就手动把
  tool/dsh-config-migrator 复制到 ~/.dsh/profiles/<名字>/node_modules/ 下，
  再把包名加进该目录 package.json 的 dependencies 与 dsh.profile.bundles。

--------------------------------
脚本做三件事
--------------------------------
1) 把 tool/dsh-config-migrator 复制到 <profile>/node_modules/dsh-config-migrator
2) 在该 profile 的 package.json 里登记 dependencies 和 dsh.profile.bundles
3) 打印下一步提示

它不会动你的配置数据 —— 配置仍然要在界面里导入，由你逐项确认冲突。

出问题怎么办：
  · 找不到 DSH 目录 -> 先启动一次 DSH 再运行
  · 找不到 profile -> 确认启动的是哪个 profile，可设环境变量 DSH_PROFILE
  · package.json 被改坏 -> 同目录有 package.json.bak-<时间>，改名回去