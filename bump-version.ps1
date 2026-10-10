param(
    [string]$Version,
    [int]$Build
)

$root = $PSScriptRoot
$versionPath = Join-Path $root 'VERSION'
$buildPath = Join-Path $root 'BUILD_NUMBER'
$pbxPath = Join-Path $root 'ios/CFI.xcodeproj/project.pbxproj'
$htmlPath = Join-Path $root 'web/index.html'
$utf8 = New-Object System.Text.UTF8Encoding($false)

if ($Version) {
    if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid -Version: $Version" }
    if ($Build -lt 1) { throw "-Build must be a positive integer when -Version is set" }
    $newVersion = $Version
    $newBuild = $Build
} else {
    $parts = (Get-Content $versionPath -Raw).Trim().Split('.')
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]$parts[2]
    $newBuild = [int](Get-Content $buildPath -Raw).Trim()
    if ($newBuild -lt 9) {
        $newBuild++
    } else {
        $newBuild = 1
        $patch++
        if ($patch -gt 9) {
            $minor++
            $patch = 0
        }
    }
    $newVersion = "$major.$minor.$patch"
}

[System.IO.File]::WriteAllText($versionPath, "$newVersion`n", $utf8)
[System.IO.File]::WriteAllText($buildPath, "$newBuild`n", $utf8)

$pbx = [System.IO.File]::ReadAllText($pbxPath, $utf8)
$pbx = [regex]::Replace($pbx, '(MARKETING_VERSION = )[0-9.]+(;)', "`${1}$newVersion`${2}")
$pbx = [regex]::Replace($pbx, '(CURRENT_PROJECT_VERSION = )[0-9]+(;)', "`${1}$newBuild`${2}")
[System.IO.File]::WriteAllText($pbxPath, $pbx, $utf8)

$mid = [string][char]0x00B7
$html = [System.IO.File]::ReadAllText($htmlPath, $utf8)
$pattern = 'v\d+\.\d+\.\d+[^<]*?Build \d+'
if (-not [regex]::IsMatch($html, $pattern)) { throw "Version string not found in web/index.html" }
$html = [regex]::Replace($html, $pattern, "v$newVersion $mid Build $newBuild")
[System.IO.File]::WriteAllText($htmlPath, $html, $utf8)

Write-Output "v$newVersion build$newBuild"
