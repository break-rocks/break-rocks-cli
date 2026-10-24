# The installer of breakrocks for Windows (C-03), joined to each release of break-rocks-cli:
#
#   irm https://github.com/break-rocks/break-rocks-cli/releases/latest/download/install.ps1 | iex
#   irm https://break.rocks/cli/install.ps1 | iex        (once the static site serves it)
#
# It downloads the single executable of the release (Windows x64; it also runs on Windows on Arm)
# and its SHA-256, checks it, installs it in %LOCALAPPDATA%\breakrocks\bin, never as an
# administrator, and adds that folder to the PATH of the user (not of the machine).
#
# BREAKROCKS_VERSION        a release (0.8.0) instead of the latest one
# BREAKROCKS_INSTALL_DIR    another folder
# BREAKROCKS_DOWNLOAD_URL   the releases (default https://github.com/break-rocks/break-rocks-cli/releases)
# BREAKROCKS_NO_MODIFY_PATH 1: the PATH of the user is left as it is (the line to add is told)

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  # Windows PowerShell 5.1 may not offer TLS 1.2 by default; GitHub needs it.
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12
  $releases = if ($env:BREAKROCKS_DOWNLOAD_URL) { $env:BREAKROCKS_DOWNLOAD_URL.TrimEnd('/') } else { 'https://github.com/break-rocks/break-rocks-cli/releases' }
  $version = if ($env:BREAKROCKS_VERSION) { $env:BREAKROCKS_VERSION } else { 'latest' }
  $dir = if ($env:BREAKROCKS_INSTALL_DIR) { $env:BREAKROCKS_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'breakrocks\bin' }
  $asset = 'breakrocks-windows-x64.exe'
  $base = if ($version -eq 'latest') { "$releases/latest/download" } elseif ($version.StartsWith('v')) { "$releases/download/$version" } else { "$releases/download/v$version" }

  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('breakrocks-' + [System.Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    Write-Host "Downloading $asset ($version)"
    $file = Join-Path $tmp $asset
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $file
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset.sha256" -OutFile "$file.sha256"
    $expected = ((Get-Content -Raw "$file.sha256").Trim() -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 -Path $file).Hash.ToLowerInvariant()
    if (-not $expected -or $expected -ne $actual) {
      throw "breakrocks install: the SHA-256 of $asset is not the one of the release ($actual, expected $expected): nothing was installed"
    }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $target = Join-Path $dir 'breakrocks.exe'
    # A running executable cannot be overwritten, but it can be renamed.
    if (Test-Path $target) { Move-Item -Force -Path $target -Destination "$target.old" }
    Move-Item -Force -Path $file -Destination $target
    Remove-Item -Force -ErrorAction SilentlyContinue "$target.old"
    $installed = $version
    try { $answer = & $target --version 2>$null; if ($answer) { $installed = $answer } } catch { }
    Write-Host "Installed breakrocks $installed in $target"

    $userPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $inPath = ($userPath -split ';') -contains $dir
    if (-not $inPath) {
      if ($env:BREAKROCKS_NO_MODIFY_PATH -eq '1') {
        Write-Host "$dir is not in your PATH: add it to the PATH of your user (Settings > System > About > Advanced system settings > Environment Variables)."
      } else {
        $value = if ($userPath) { "$dir;$userPath" } else { $dir }
        [System.Environment]::SetEnvironmentVariable('Path', $value, 'User')
        $env:Path = "$dir;$env:Path"
        Write-Host "$dir was added to the PATH of your user: open a new terminal to use breakrocks."
      }
    }
    Write-Host ''
    Write-Host 'Completion of PowerShell: breakrocks completion --install'
    Write-Host 'Then: breakrocks login (a human), breakrocks help'
  } finally {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp
  }
}
