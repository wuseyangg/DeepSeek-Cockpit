<#
.SYNOPSIS
    DeepSeek Harness Cockpit 一键编译与打包脚本

.DESCRIPTION
    支持编译便携式可执行文件 (.exe)、NSIS 安装包以及解压即用目录。

.PARAMETER Target
    编译目标: portable (单文件便携exe, 默认), nsis (安装包), dir (解压目录), all (便携+安装包)

.PARAMETER SkipTest
    跳过自动化测试直接打包

.EXAMPLE
    .\build.ps1
    .\build.ps1 -Target portable
    .\build.ps1 -Target nsis
    .\build.ps1 -Target dir
    .\build.ps1 -Target all -SkipTest
#>

param(
    [ValidateSet("portable", "nsis", "dir", "all")]
    [string]$Target = "portable",
    [switch]$SkipTest = $false
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ProjectRoot = $PSScriptRoot
Set-Location $ProjectRoot

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " DeepSeek Harness Cockpit 一键编译脚本" -ForegroundColor Cyan
Write-Host " 目标: $Target" -ForegroundColor Gray
Write-Host "=========================================" -ForegroundColor Cyan

# 1. 依赖检测
if (-not (Test-Path "node_modules")) {
    Write-Host "[1/3] 检测到未安装依赖，正在运行 pnpm install..." -ForegroundColor Yellow
    pnpm install
} else {
    Write-Host "[1/3] 依赖环境检查完毕。" -ForegroundColor Green
}

# 2. 自动化测试
if (-not $SkipTest) {
    Write-Host "[2/3] 运行自动化测试套件 (node --test)..." -ForegroundColor Yellow
    node --test test/*.test.js
    if ($LASTEXITCODE -ne 0) {
        Write-Error "测试未通过，终止构建！如需强制跳过请传入 -SkipTest"
    }
    Write-Host "测试全部通过。" -ForegroundColor Green
} else {
    Write-Host "[2/3] 已跳过自动化测试。" -ForegroundColor DarkGray
}

# 3. 执行编译打包
Write-Host "[3/3] 开始执行 Electron 编译构建 ($Target)..." -ForegroundColor Yellow

switch ($Target) {
    "portable" {
        npx electron-builder --win portable
    }
    "nsis" {
        npx electron-builder --win nsis
    }
    "dir" {
        npx electron-builder --dir
    }
    "all" {
        npx electron-builder --win
    }
}

if ($LASTEXITCODE -ne 0) {
    Write-Error "构建失败！"
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host " 构建完成！输出目录: $ProjectRoot\dist" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Get-ChildItem -Path "$ProjectRoot\dist" -File -Filter "*.exe" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    $relPath = Resolve-Path -Path $_.FullName -Relative
    Write-Host " 产物: $relPath ($([math]::Round($_.Length / 1MB, 2)) MB)" -ForegroundColor Yellow
}
