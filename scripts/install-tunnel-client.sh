#!/usr/bin/env bash
# Installs the stock openai/tunnel-client release for this machine.
#
# Verifies the archive against the release's SHA256SUMS.txt and, when the
# GitHub CLI is available, the release workflow's signed provenance. Installs
# to $T3MCP_DATA_DIR (default ~/.local/share/t3mcp) and points
# bin/tunnel-client at the verified version.
#
# Usage: scripts/install-tunnel-client.sh [vX.Y.Z]   (default: latest release)
set -euo pipefail

repo="openai/tunnel-client"
data_dir="${T3MCP_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/t3mcp}"

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin)
    echo "On macOS, install with Homebrew instead: brew install openai/tools/tunnel-client" >&2
    exit 1
    ;;
  *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=amd64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

release="${1:-}"
if [[ -z "$release" ]]; then
  release="$(curl -fsSL "https://api.github.com/repos/${repo}/releases/latest" |
    sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)"
fi
[[ "$release" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Bad release tag: '$release'" >&2; exit 1; }

stem="tunnel-client-${release}-${os}-${arch}"
base="https://github.com/${repo}/releases/download/${release}"
install_dir="${data_dir}/tunnel-client/${release}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"

echo "Downloading ${stem}.zip (${release})"
curl -fsSLO "${base}/${stem}.zip"
curl -fsSLO "${base}/SHA256SUMS.txt"

grep -E " \*?${stem}\.zip\$" SHA256SUMS.txt > expected.txt || {
  echo "SHA256SUMS.txt has no entry for ${stem}.zip" >&2
  exit 1
}
sha256sum -c expected.txt

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  bundle="tunnel-client-${release}-provenance.sigstore.json"
  if curl -fsSLO "${base}/${bundle}"; then
    echo "Verifying signed release provenance"
    gh attestation verify SHA256SUMS.txt \
      --bundle "$bundle" \
      --repo "$repo" \
      --signer-workflow "${repo}/.github/workflows/release.yml" \
      --source-ref "refs/tags/${release}" \
      --predicate-type https://slsa.dev/provenance/v1 \
      --deny-self-hosted-runners >/dev/null
    echo "Provenance verified for SHA256SUMS.txt"
  else
    echo "No provenance bundle published for ${release}; checksum verification only." >&2
  fi
else
  echo "GitHub CLI unavailable; checksum verification only." >&2
fi

mkdir -p extract
unzip -q "${stem}.zip" -d extract
binary="$(find extract -type f -name tunnel-client -perm -u+x | head -n1)"
[[ -n "$binary" ]] || binary="$(find extract -type f -name tunnel-client | head -n1)"
[[ -n "$binary" ]] || { echo "Archive contains no tunnel-client binary" >&2; exit 1; }

rm -rf "$install_dir"
mkdir -p "$install_dir" "${data_dir}/bin"
cp -R "$(dirname "$binary")/." "$install_dir/"
chmod +x "$install_dir/tunnel-client"
ln -sfn "$install_dir/tunnel-client" "${data_dir}/bin/tunnel-client"

"${data_dir}/bin/tunnel-client" --version
echo "Installed: ${data_dir}/bin/tunnel-client -> ${install_dir}/tunnel-client"
