#!/bin/sh
# The installer of breakrocks for macOS and Linux (C-03), joined to each release of break-rocks-cli:
#
#   curl -fsSL https://github.com/break-rocks/break-rocks-cli/releases/latest/download/install.sh | sh
#   curl -fsSL https://break.rocks/cli/install.sh | sh        (once the static site serves it)
#
# It finds the system and the processor, downloads the single executable of the release and its
# SHA-256, checks it, and installs it in ~/.local/bin, never with sudo; then it says how to add that
# folder to the PATH and how to install the completion of the shell. It changes no file of the shell.
#
# BREAKROCKS_VERSION     a release (0.8.0) instead of the latest one
# BREAKROCKS_INSTALL_DIR another folder than ~/.local/bin
# BREAKROCKS_DOWNLOAD_URL the releases (default https://github.com/break-rocks/break-rocks-cli/releases)
set -eu

releases="${BREAKROCKS_DOWNLOAD_URL:-https://github.com/break-rocks/break-rocks-cli/releases}"
version="${BREAKROCKS_VERSION:-latest}"
dir="${BREAKROCKS_INSTALL_DIR:-$HOME/.local/bin}"

say() { printf '%s\n' "$*" >&2; }
fail() { say "breakrocks install: $*"; exit 1; }

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "this installer is for macOS and Linux (on Windows: irm https://github.com/break-rocks/break-rocks-cli/releases/latest/download/install.ps1 | iex); elsewhere: npm i -g breakrocks" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "no executable for the processor $(uname -m): npm i -g breakrocks (Node 24)" ;;
esac
# A shell under Rosetta says x86_64 on an Apple processor: the native executable then.
if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ]; then arch=arm64; fi
asset="breakrocks-$os-$arch"

case "$version" in
  latest) base="$releases/latest/download" ;;
  v*) base="$releases/download/$version" ;;
  *) base="$releases/download/v$version" ;;
esac

download() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 2 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then wget -q -O "$2" "$1"
  else fail "curl or wget is needed to download"
  fi
}
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then openssl dgst -sha256 "$1" | awk '{print $NF}'
  else fail "sha256sum, shasum or openssl is needed to check the download"
  fi
}

tmp="$(mktemp -d 2>/dev/null || mktemp -d -t breakrocks)"
trap 'rm -rf "$tmp"' EXIT
trap 'exit 130' INT TERM

say "Downloading $asset ($version)"
download "$base/$asset" "$tmp/$asset" || fail "cannot download $base/$asset"
download "$base/$asset.sha256" "$tmp/$asset.sha256" || fail "cannot download $base/$asset.sha256"
expected="$(awk '{print $1; exit}' "$tmp/$asset.sha256" | tr 'A-F' 'a-f')"
actual="$(sha256 "$tmp/$asset")"
if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
  fail "the SHA-256 of $asset is not the one of the release ($actual, expected $expected): nothing was installed"
fi

mkdir -p "$dir" || fail "cannot create $dir"
chmod 755 "$tmp/$asset"
mv -f "$tmp/$asset" "$dir/breakrocks" || fail "cannot write $dir/breakrocks"
installed="$("$dir/breakrocks" --version </dev/null 2>/dev/null || true)"
say "Installed breakrocks ${installed:-$version} in $dir/breakrocks"

case ":${PATH:-}:" in
  *":$dir:"*) ;;
  *)
    say ""
    say "$dir is not in your PATH. Add it, in ~/.zshrc, ~/.bashrc or ~/.profile:"
    say "  export PATH=\"$dir:\$PATH\""
    say "fish: fish_add_path $dir"
    ;;
esac
say ""
say "Completion of the shell: breakrocks completion --install"
say "Then: breakrocks login (a human), breakrocks help"
