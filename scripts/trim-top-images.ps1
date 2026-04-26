Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$targets = @(
  'images/group1-main-fast-std.jpg',
  'images/group1-thumb-2-std.png',
  'images/group1-thumb-3-std.png',
  'images/group1-thumb-4-std.png',
  'images/group2-main-fast-std.jpg',
  'images/group2-fruit-std.png',
  'images/group3-main-fast-std.jpg',
  'images/black-gold-fruit-std.png',
  'images/black-thorn-fruit-std.png'
)

$targetW = 1200
$targetH = 900

function Get-BgColor($bmp) {
  $midX = [Math]::Max(0, [int]($bmp.Width / 2))
  $midY = [Math]::Max(0, [int]($bmp.Height / 2))
  $maxX = $bmp.Width - 1
  $maxY = $bmp.Height - 1

  $pts = @(
    @(0, 0),
    @($midX, 0),
    @($maxX, 0),
    @(0, $midY),
    @($maxX, $midY),
    @(0, $maxY),
    @($midX, $maxY),
    @($maxX, $maxY)
  )

  $rs = @()
  $gs = @()
  $bs = @()

  foreach ($pt in $pts) {
    $c = $bmp.GetPixel($pt[0], $pt[1])
    $rs += [int]$c.R
    $gs += [int]$c.G
    $bs += [int]$c.B
  }

  return [System.Drawing.Color]::FromArgb(
    [int](($rs | Measure-Object -Average).Average),
    [int](($gs | Measure-Object -Average).Average),
    [int](($bs | Measure-Object -Average).Average)
  )
}

function Get-ColorDiff($c, $bg) {
  return [Math]::Abs($c.R - $bg.R) + [Math]::Abs($c.G - $bg.G) + [Math]::Abs($c.B - $bg.B)
}

foreach ($path in $targets) {
  $full = Join-Path (Get-Location) $path
  $bmp = [System.Drawing.Bitmap]::FromFile($full)

  try {
    $bg = Get-BgColor $bmp
    $threshold = 55

    $left = 0
    $right = $bmp.Width - 1
    $top = 0
    $bottom = $bmp.Height - 1

    $found = $false
    for ($x = 0; $x -lt $bmp.Width -and -not $found; $x++) {
      for ($y = 0; $y -lt $bmp.Height; $y++) {
        if ((Get-ColorDiff ($bmp.GetPixel($x, $y)) $bg) -gt $threshold) {
          $left = $x
          $found = $true
          break
        }
      }
    }

    $found = $false
    for ($x = $bmp.Width - 1; $x -ge 0 -and -not $found; $x--) {
      for ($y = 0; $y -lt $bmp.Height; $y++) {
        if ((Get-ColorDiff ($bmp.GetPixel($x, $y)) $bg) -gt $threshold) {
          $right = $x
          $found = $true
          break
        }
      }
    }

    $found = $false
    for ($y = 0; $y -lt $bmp.Height -and -not $found; $y++) {
      for ($x = 0; $x -lt $bmp.Width; $x++) {
        if ((Get-ColorDiff ($bmp.GetPixel($x, $y)) $bg) -gt $threshold) {
          $top = $y
          $found = $true
          break
        }
      }
    }

    $found = $false
    for ($y = $bmp.Height - 1; $y -ge 0 -and -not $found; $y--) {
      for ($x = 0; $x -lt $bmp.Width; $x++) {
        if ((Get-ColorDiff ($bmp.GetPixel($x, $y)) $bg) -gt $threshold) {
          $bottom = $y
          $found = $true
          break
        }
      }
    }

    $cropW = [Math]::Max(1, $right - $left + 1)
    $cropH = [Math]::Max(1, $bottom - $top + 1)
    $srcRect = New-Object System.Drawing.Rectangle($left, $top, $cropW, $cropH)

    $cropped = New-Object System.Drawing.Bitmap($cropW, $cropH)
    $g1 = [System.Drawing.Graphics]::FromImage($cropped)
    $g1.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g1.DrawImage(
      $bmp,
      (New-Object System.Drawing.Rectangle(0, 0, $cropW, $cropH)),
      $srcRect,
      [System.Drawing.GraphicsUnit]::Pixel
    )
    $g1.Dispose()

    $srcRatio = $cropW / $cropH
    $targetRatio = $targetW / $targetH
    if ($srcRatio -gt $targetRatio) {
      $drawH = $targetH
      $drawW = [int][Math]::Ceiling($targetH * $srcRatio)
    } else {
      $drawW = $targetW
      $drawH = [int][Math]::Ceiling($targetW / $srcRatio)
    }

    $dest = New-Object System.Drawing.Bitmap($targetW, $targetH)
    $g2 = [System.Drawing.Graphics]::FromImage($dest)
    $g2.Clear([System.Drawing.Color]::White)
    $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $offsetX = [int](($targetW - $drawW) / 2)
    $offsetY = [int](($targetH - $drawH) / 2)
    $g2.DrawImage($cropped, (New-Object System.Drawing.Rectangle($offsetX, $offsetY, $drawW, $drawH)))
    $g2.Dispose()
    $cropped.Dispose()

    $dir = [System.IO.Path]::GetDirectoryName($full)
    $base = [System.IO.Path]::GetFileNameWithoutExtension($full)
    $ext = [System.IO.Path]::GetExtension($full)
    $out = Join-Path $dir ($base + '-trim' + $ext)

    if ($ext -ieq '.jpg' -or $ext -ieq '.jpeg') {
      $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
      $enc = New-Object System.Drawing.Imaging.EncoderParameters(1)
      $enc.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 88L)
      $dest.Save($out, $codec, $enc)
      $enc.Dispose()
    } else {
      $dest.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    }

    $dest.Dispose()
    Write-Output $out
  } finally {
    $bmp.Dispose()
  }
}
