# _rebuild.ps1 —— 节奏 Rhythm 桌面端 Windows 重新构建（硬编码工具链路径，规避 vswhere 解析坑）
# 本环境禁用 cmd.exe，故用 PowerShell 原生拼 MSVC 环境后跑 tauri build --no-bundle --debug。
# 工具链路径已实测确认（VS2022 BuildTools / VC 14.44.35207 / Win SDK 10.0.26100.0）。
$ErrorActionPreference = 'Stop'

$cargoBin = "$env:USERPROFILE\.cargo\bin"
$install  = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools'
$vc       = '14.44.35207'
$sdk      = '10.0.26100.0'
$vcBin    = "$install\VC\Tools\MSVC\$vc\bin\Hostx64\x64"
$sdkBin   = "C:\Program Files (x86)\Windows Kits\10\bin\$sdk\x64"
$vcInc    = "$install\VC\Tools\MSVC\$vc\include"
$vcAtlInc = "$install\VC\Tools\MSVC\$vc\ATLMFC\include"
$sdkInc   = "C:\Program Files (x86)\Windows Kits\10\Include\$sdk"
$vcLib    = "$install\VC\Tools\MSVC\$vc\lib\x64"
$vcAtlLib = "$install\VC\Tools\MSVC\$vc\ATLMFC\lib\x64"
$sdkLib   = "C:\Program Files (x86)\Windows Kits\10\Lib\$sdk"

$env:PATH = "$cargoBin;$vcBin;$sdkBin;" + $env:PATH
$env:INCLUDE = "$vcInc;$vcAtlInc;$sdkInc\shared;$sdkInc\um;$sdkInc\ucrt;$sdkInc\winrt;$sdkInc\cppwinrt"
$env:LIB = "$vcLib;$vcAtlLib;$sdkLib\um\x64;$sdkLib\ucrt\x64;$sdkLib\winrt\x64;$sdkLib\cppwinrt\x64"
$env:LIBPATH = $env:LIB
$env:WindowsSdkDir = 'C:\Program Files (x86)\Windows Kits\10\'
$env:WindowsSDKVersion = "$sdk\"
$env:VCINSTALLDIR = "$install\VC\"
$env:VCTOOLSINSTALLDIR = "$install\VC\Tools\MSVC\$vc\"
$env:VSINSTALLDIR = "$install\"

Set-Location 'C:\Users\Administrator\WorkBuddy\2026-07-20-09-18-18\rhythm-desktop'
Write-Host '[rebuild] VS=$install VC=$vc SDK=$sdk'
Write-Host '[rebuild] running: npm run tauri build -- --no-bundle --debug'
npm run tauri build -- --no-bundle --debug 2>&1
Write-Host "[rebuild] EXIT=$LASTEXITCODE"
