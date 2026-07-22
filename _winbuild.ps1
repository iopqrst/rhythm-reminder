# _winbuild.ps1 —— 节奏 Rhythm 桌面端 Windows 本地构建辅助脚本
# 用途：本环境禁用 cmd.exe（Bash/PowerShell 调用 cmd 均被安全策略拦截），
#       无法用 vcvars64.bat。此脚本用 PowerShell 原生方式拼出 MSVC 工具链环境后跑 cargo build。
# 用法（在 PowerShell 中）：
#   .\_winbuild.ps1            # 等价 cargo build（debug）
#   .\_winbuild.ps1 -Release   # cargo build --release
#   .\_winbuild.ps1 -NoBundle  # npm run tauri build -- --no-bundle --debug（前端打包 + 原生编译，不出安装包；用于把新前端打进 exe）
#   .\_winbuild.ps1 -Bundle    # npm run tauri build（前端打包 + 原生编译 + 安装包；需 WiX/NSIS + WebView2）
param([switch]$Release, [switch]$NoBundle, [switch]$Bundle)

$ErrorActionPreference = 'Stop'

# 1) 用 vswhere 定位 VS 安装（不依赖 cmd）
$vswhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
$install = & $vswhere -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format value -property installationPath | Select-Object -First 1
if (-not $install) { Write-Error "未找到 Visual Studio VC.Tools  workload"; exit 1 }

# 2) 解析 VCTools 版本与 Windows SDK 版本
$vc = (Get-Content (Join-Path $install "VC\Auxiliary\Build\Microsoft.VCToolsVersion.default.txt") | Select-Object -First 1)
$sdkRoot = "C:\Program Files (x86)\Windows Kits\10"
$sdk = (Get-ChildItem (Join-Path $sdkRoot "Include") -Directory | Sort-Object Name -Descending | Select-Object -First 1).Name

# 3) 拼 PATH / INCLUDE / LIB
$cargoBin = "$env:USERPROFILE\.cargo\bin"
$vcBin    = "$install\VC\Tools\MSVC\$vc\bin\Hostx64\x64"
$sdkBin   = "$sdkRoot\bin\$sdk\x64"
$vcInc    = "$install\VC\Tools\MSVC\$vc\include"
$vcAtlInc = "$install\VC\Tools\MSVC\$vc\ATLMFC\include"
$sdkInc   = "$sdkRoot\Include\$sdk"
$vcLib    = "$install\VC\Tools\MSVC\$vc\lib\x64"
$vcAtlLib = "$install\VC\Tools\MSVC\$vc\ATLMFC\lib\x64"
$sdkLib   = "$sdkRoot\Lib\$sdk"

$env:PATH = "$cargoBin;$vcBin;$sdkBin;" + $env:PATH
$env:INCLUDE = "$vcInc;$vcAtlInc;$sdkInc\shared;$sdkInc\um;$sdkInc\ucrt;$sdkInc\winrt;$sdkInc\cppwinrt"
$env:LIB = "$vcLib;$vcAtlLib;$sdkLib\um\x64;$sdkLib\ucrt\x64;$sdkLib\winrt\x64;$sdkLib\cppwinrt\x64"
$env:LIBPATH = $env:LIB
$env:WindowsSdkDir = "$sdkRoot\"
$env:WindowsSDKVersion = "$sdk\"
$env:VCINSTALLDIR = "$install\VC\"
$env:VCTOOLSINSTALLDIR = "$install\VC\Tools\MSVC\$vc\"
$env:VSINSTALLDIR = "$install\"

Write-Host "[winbuild] VS=$install VC=$vc SDK=$sdk"

# 4) 进入工程目录并执行构建
Set-Location (Join-Path $PSScriptRoot "rhythm-desktop\src-tauri")
if ($Bundle) {
    Write-Host "[winbuild] running: npm run tauri build"
    npm run tauri build 2>&1
} elseif ($NoBundle) {
    Write-Host "[winbuild] running: npm run tauri build -- --no-bundle --debug"
    npm run tauri build -- --no-bundle --debug 2>&1
} else {
    $target = if ($Release) { "--release" } else { "" }
    Write-Host "[winbuild] running: cargo build $target"
    cargo build $target 2>&1
}
Write-Host "[winbuild] EXIT=$LASTEXITCODE"
