# 生成应用图标资源：resources/icon.ico（多尺寸）与 resources/tray.png（32x32 托盘图）
# 以 resources/DeepSeek Harness.ico 为模板，保留其鲸鱼剪影与 alpha 通道，
# 只把 RGB 换成从左到右的粉紫横向渐变。改动配色后重跑本脚本即可。
# 必须用 Windows PowerShell 5.1（powershell.exe）运行，pwsh 7 默认不带 System.Drawing.Common。

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ResourceDir = Join-Path $ProjectRoot "resources"
$TemplatePath = Join-Path $ResourceDir "DeepSeek Harness.ico"
$IcoPath = Join-Path $ResourceDir "icon.ico"
$PngPath = Join-Path $ResourceDir "tray.png"

if (-not (Test-Path $TemplatePath)) {
    throw "找不到模板图标: $TemplatePath"
}

# 模板自带 8/10/14/16/22/24/32/40/48/64/96/128/256 十三档，这里只取 Windows 常用的七档
$Sizes = @(16, 24, 32, 48, 64, 128, 256)

# 渐变端点：左粉右紫
$FromColor = [System.Drawing.Color]::FromArgb(255, 255, 110, 196)   # #FF6EC4
$ToColor = [System.Drawing.Color]::FromArgb(255, 142, 45, 226)      # #8E2DE2

$TemplateBytes = [System.IO.File]::ReadAllBytes($TemplatePath)

# 按尺寸取出模板的原生帧。256 那档在 ICO 里是 PNG 压缩的，
# System.Drawing.Icon 读不了会静默降级到 128，所以 PNG 帧必须直接解码。
function Get-TemplateFrame([int]$Size) {
    $count = [BitConverter]::ToUInt16($TemplateBytes, 4)
    $source = $null

    for ($i = 0; $i -lt $count; $i++) {
        $entry = 6 + $i * 16
        $width = if ($TemplateBytes[$entry] -eq 0) { 256 } else { [int]$TemplateBytes[$entry] }
        if ($width -ne $Size) { continue }

        $length = [int][BitConverter]::ToUInt32($TemplateBytes, $entry + 8)
        $offset = [int][BitConverter]::ToUInt32($TemplateBytes, $entry + 12)

        if ($TemplateBytes[$offset] -eq 0x89 -and $TemplateBytes[$offset + 1] -eq 0x50) {
            $ms = New-Object System.IO.MemoryStream -ArgumentList $TemplateBytes, $offset, $length
            $source = [System.Drawing.Image]::FromStream($ms)
        }
        break
    }

    if ($null -eq $source) {
        $icon = New-Object System.Drawing.Icon -ArgumentList $TemplatePath, $Size, $Size
        $source = $icon.ToBitmap()
        $icon.Dispose()
    }

    # 统一落到 32bppArgb 画布，后续按字节改色
    $fmt = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    $canvas = New-Object System.Drawing.Bitmap -ArgumentList $Size, $Size, $fmt
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($source, 0, 0, $Size, $Size)
    $g.Dispose()
    $source.Dispose()

    return $canvas
}

# 保留 alpha，只重写 RGB：渐变按不透明像素的横向包围盒铺开，
# 这样每档尺寸都能用满粉到紫的完整色域，不受四周留白影响
function Set-GradientFill([System.Drawing.Bitmap]$Bitmap) {
    $w = $Bitmap.Width
    $h = $Bitmap.Height
    $rect = New-Object System.Drawing.Rectangle -ArgumentList 0, 0, $w, $h
    $mode = [System.Drawing.Imaging.ImageLockMode]::ReadWrite
    $fmt = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    $data = $Bitmap.LockBits($rect, $mode, $fmt)

    $total = $data.Stride * $h
    $buf = New-Object byte[] $total
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $buf, 0, $total)

    $minX = $w
    $maxX = -1
    for ($y = 0; $y -lt $h; $y++) {
        $row = $y * $data.Stride
        for ($x = 0; $x -lt $w; $x++) {
            if ($buf[$row + $x * 4 + 3] -ne 0) {
                if ($x -lt $minX) { $minX = $x }
                if ($x -gt $maxX) { $maxX = $x }
            }
        }
    }
    if ($maxX -lt 0) { $minX = 0; $maxX = $w - 1 }
    $span = [Math]::Max(1, $maxX - $minX)

    # 每列颜色一致，先把整行的查表算好，避免逐像素重复插值
    $lutB = New-Object byte[] $w
    $lutG = New-Object byte[] $w
    $lutR = New-Object byte[] $w
    for ($x = 0; $x -lt $w; $x++) {
        $t = [Math]::Min(1.0, [Math]::Max(0.0, ($x - $minX) / $span))
        $lutR[$x] = [byte][Math]::Round($FromColor.R + ($ToColor.R - $FromColor.R) * $t)
        $lutG[$x] = [byte][Math]::Round($FromColor.G + ($ToColor.G - $FromColor.G) * $t)
        $lutB[$x] = [byte][Math]::Round($FromColor.B + ($ToColor.B - $FromColor.B) * $t)
    }

    for ($y = 0; $y -lt $h; $y++) {
        $row = $y * $data.Stride
        for ($x = 0; $x -lt $w; $x++) {
            $i = $row + $x * 4
            if ($buf[$i + 3] -eq 0) { continue }
            $buf[$i] = $lutB[$x]
            $buf[$i + 1] = $lutG[$x]
            $buf[$i + 2] = $lutR[$x]
        }
    }

    [System.Runtime.InteropServices.Marshal]::Copy($buf, 0, $data.Scan0, $total)
    $Bitmap.UnlockBits($data)
}

# 逐尺寸取模板帧、上色、编码为 PNG；32x32 那份同时单独落盘给托盘用
$blobs = @()
foreach ($size in $Sizes) {
    $bmp = Get-TemplateFrame $size
    Set-GradientFill $bmp

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $blobs += , ($ms.ToArray())
    if ($size -eq 32) {
        $bmp.Save($PngPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    $ms.Dispose()
    $bmp.Dispose()
}

# 手写 ICO 容器：ICONDIR(6 字节) + ICONDIRENTRY(16 字节 x N) + 各尺寸 PNG 数据
$stream = [System.IO.File]::Create($IcoPath)
$writer = New-Object System.IO.BinaryWriter -ArgumentList $stream
$writer.Write([uint16]0)                # reserved
$writer.Write([uint16]1)                # type: 1 = icon
$writer.Write([uint16]$Sizes.Count)

$offset = 6 + 16 * $Sizes.Count
for ($i = 0; $i -lt $Sizes.Count; $i++) {
    $size = $Sizes[$i]
    $dim = if ($size -ge 256) { 0 } else { $size }   # 256 在 ICO 里记作 0
    $writer.Write([byte]$dim)           # width
    $writer.Write([byte]$dim)           # height
    $writer.Write([byte]0)              # 调色板色数，真彩色为 0
    $writer.Write([byte]0)              # reserved
    $writer.Write([uint16]1)            # color planes
    $writer.Write([uint16]32)           # bits per pixel
    $writer.Write([uint32]$blobs[$i].Length)
    $writer.Write([uint32]$offset)
    $offset += $blobs[$i].Length
}
foreach ($blob in $blobs) {
    $writer.Write($blob)
}
$writer.Flush()
$writer.Dispose()
$stream.Dispose()

Write-Output ("icon.ico  {0} sizes, {1} bytes -> {2}" -f $Sizes.Count, (Get-Item $IcoPath).Length, $IcoPath)
Write-Output ("tray.png  32x32, {0} bytes -> {1}" -f (Get-Item $PngPath).Length, $PngPath)
