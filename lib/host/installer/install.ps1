# dsh-config-migrator 自带安装器（Windows / PowerShell 5.1+）
# 不依赖系统 Node.js：只做文件复制 + package.json 合并，全用 PowerShell 内置能力。
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$PluginName = 'dsh-config-migrator'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$PackageDir = Join-Path (Split-Path -Parent (Split-Path -Parent $Here)) 'tool\dsh-config-migrator'
if (-not (Test-Path $PackageDir)) { $PackageDir = Join-Path (Split-Path -Parent $Here) 'tool\dsh-config-migrator' }

function Fail($msg) { Write-Host ''; Write-Host ('[失败] ' + $msg) -ForegroundColor Red; Write-Host ''; exit 1 }
function Ok($msg) { Write-Host ('[完成] ' + $msg) -ForegroundColor Green }
function Info($msg) { Write-Host $msg }

Info '=== DSH 配置迁移 · 自带安装器 ==='
Info ''

# 1) 找 DSH_HOME
$DshHome = $env:DSH_HOME
if ([string]::IsNullOrWhiteSpace($DshHome)) { $DshHome = Join-Path $env:USERPROFILE '.dsh' }
if (-not (Test-Path $DshHome)) { Fail ('找不到 DSH 配置目录：' + $DshHome + '。请先启动一次 DSH，让它把目录建出来。') }
Info ('DSH 目录：' + $DshHome)

# 2) 找 profile
$ProfileDir = $env:DSH_PROFILE_DIR
if ([string]::IsNullOrWhiteSpace($ProfileDir)) {
  $ProfileName = $env:DSH_PROFILE
  $ProfilesRoot = Join-Path $DshHome 'profiles'
  if ([string]::IsNullOrWhiteSpace($ProfileName)) {
    $dirs = @()
    if (Test-Path $ProfilesRoot) { $dirs = @(Get-ChildItem $ProfilesRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike '.*' }) }
    if ($dirs.Count -eq 1) { $ProfileName = $dirs[0].Name }
    elseif ($dirs.Count -gt 1) { $ProfileName = 'desktop' }
    else { Fail ('找不到任何 profile 目录：' + $ProfilesRoot + '。请先启动一次 DSH。') }
  }
  $ProfileDir = Join-Path $ProfilesRoot $ProfileName
}
if (-not (Test-Path $ProfileDir)) { Fail ('profile 目录不存在：' + $ProfileDir + '。请先启动一次 DSH（选对这个 profile），再运行本脚本。') }
Info ('profile：' + $ProfileDir)

# 3) 定位插件源（zip 里的 tool/dsh-config-migrator）
$Candidates = @(
  (Join-Path (Split-Path -Parent $Here) 'tool\dsh-config-migrator'),
  (Join-Path (Split-Path -Parent (Split-Path -Parent $Here)) 'tool\dsh-config-migrator'),
  (Join-Path $Here 'tool\dsh-config-migrator'),
  $PackageDir
)
$Source = $null
foreach ($c in $Candidates) { if ($c -and (Test-Path (Join-Path $c 'package.json'))) { $Source = $c; break } }
if ($null -eq $Source) { Fail 'zip 里找不到 tool\dsh-config-migrator（包不完整？请重新导出）。' }
Info ('插件源：' + $Source)

# 4) 复制插件到 profile\node_modules
$NodeModules = Join-Path $ProfileDir 'node_modules'
$Target = Join-Path $NodeModules $PluginName
New-Item -ItemType Directory -Force -Path $NodeModules | Out-Null
if (Test-Path $Target) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup = $Target + '.bak-' + $stamp
  Info ('已有旧版本，备份到：' + (Split-Path -Leaf $backup))
  Move-Item -LiteralPath $Target -Destination $backup -Force
}
Copy-Item -LiteralPath $Source -Destination $Target -Recurse -Force
Ok ('插件已复制到：' + $Target)

# 5) 合并 package.json（先备份，UTF-8 无 BOM 写回）
$PkgPath = Join-Path $ProfileDir 'package.json'
if (-not (Test-Path $PkgPath)) { Fail ('找不到 ' + $PkgPath + '。这个 profile 不完整，请先启动一次 DSH。') }
$raw = [System.IO.File]::ReadAllText($PkgPath, [System.Text.Encoding]::UTF8)
try { $pkg = $raw | ConvertFrom-Json } catch { Fail ('package.json 不是合法 JSON，请手动检查：' + $PkgPath) }
$stamp2 = Get-Date -Format 'yyyyMMdd-HHmmss'
$PkgBackup = $PkgPath + '.bak-' + $stamp2
Copy-Item -LiteralPath $PkgPath -Destination $PkgBackup -Force

$spec = 'link:./node_modules/' + $PluginName
$depChanged = $false
if ($null -eq $pkg.dependencies) { $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) -Force }
$existing = $pkg.dependencies.PSObject.Properties[$PluginName]
if ($null -eq $existing) {
  $pkg.dependencies | Add-Member -NotePropertyName $PluginName -NotePropertyValue $spec -Force
  $depChanged = $true
} elseif ($existing.Value -ne $spec) {
  Info ('dependencies 里已有 ' + $PluginName + ' = ' + $existing.Value + '（保留原值）')
}

$bundleChanged = $false
if ($null -eq $pkg.dsh -or $null -eq $pkg.dsh.profile) { Fail 'package.json 里没有 dsh.profile 段，这个 profile 结构不对，请先启动一次 DSH。' }
$bundles = @($pkg.dsh.profile.bundles | Where-Object { $null -ne $_ })
if ($bundles -notcontains $PluginName) {
  $bundles = $bundles + $PluginName
  $pkg.dsh.profile.bundles = $bundles
  $bundleChanged = $true
}

if ($depChanged -or $bundleChanged) {
  $json = $pkg | ConvertTo-Json -Depth 100
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($PkgPath, $json, $utf8)
  Ok ('package.json 已更新（备份：' + (Split-Path -Leaf $PkgBackup) + '）')
} else {
  Copy-Item -LiteralPath $PkgPath -Destination $PkgPath -Force -ErrorAction SilentlyContinue
  Info 'package.json 里已经登记过，无需改动'
}

Info ''
Ok '安装完成。接下来：'
Info ''
Info '  1) 完全退出 DSH，然后重新启动'
Info '  2) 打开 设置 →「配置迁移」'
Info '  3) 点「导入」，选这个 zip，按提示确认冲突后开始导入'
Info '  4) 导完再重启一次 DSH，配置就位'
Info ''