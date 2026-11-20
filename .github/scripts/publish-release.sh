#!/usr/bin/env bash
set -euo pipefail

tag="v${VERSION:?Missing package version}"
marker="<!-- Sesshuttle release build: ${GITHUB_SHA:?Missing commit} -->"
manifest="SHA256SUMS-$VERSION.txt"
notes="../docs/releases/$VERSION.md"
test -s "$notes" || { echo "Missing release notes: docs/releases/$VERSION.md" >&2; exit 1; }
installers=(
  "sesshuttle-$VERSION-linux-amd64.deb"
  "sesshuttle-$VERSION-linux-x64.tar.gz"
  "sesshuttle-$VERSION-mac-arm64.dmg"
  "sesshuttle-$VERSION-win-x64.zip"
)
sha256sum -b "${installers[@]}" > "$manifest"
cat checksums-win.txt checksums-mac.txt checksums-linux.txt |
  tr -d '\r' | LC_ALL=C sort -k2 | diff -u "$manifest" -

# A list request also returns drafts owned by the workflow token.
releases=$(gh api --paginate "repos/${GH_REPO:?Missing repository}/releases?per_page=100" |
  jq -sc --arg tag "$tag" '[.[][] | select(.tag_name == $tag)]')
if jq -e 'any(.[]; .draft == false)' <<< "$releases" > /dev/null; then
  echo "$tag is already published. Skipping this release."
  exit 0
fi
if ! jq -e --arg marker "$marker" 'length <= 1 and all(.[]; (.body // "") | contains($marker))' <<< "$releases" > /dev/null; then
  echo "A different draft already uses $tag. Check the draft before publishing." >&2
  exit 1
fi

# Reserve the tag at the commit that produced these installers, including on retries.
if commit=$(git rev-parse --verify --quiet "refs/tags/$tag^{commit}"); then
  if [[ "$commit" != "$GITHUB_SHA" ]]; then
    echo "$tag points to $commit. These installers were built from $GITHUB_SHA." >&2
    exit 1
  fi
else
  gh api --method POST "repos/$GH_REPO/git/refs" -f "ref=refs/tags/$tag" -f "sha=$GITHUB_SHA" > /dev/null
fi

if [[ "$releases" == '[]' ]]; then
  prerelease=false
  if [[ "$VERSION" == 0.* || "${VERSION%%+*}" == *-* ]]; then prerelease=true; fi
  gh release create "$tag" --draft --verify-tag --target "$GITHUB_SHA" \
    --title "Sesshuttle $tag" --generate-notes --notes "$marker"$'\n\n'"$(cat "$notes")" \
    --prerelease="$prerelease"
fi
gh release upload "$tag" "${installers[@]}" "$manifest" --clobber
uploaded=$(gh release view "$tag" --json assets \
  --jq '.assets[] | select(.state == "uploaded") | (.digest | ltrimstr("sha256:")) + " *" + .name')
{ cat "$manifest"; sha256sum -b "$manifest"; } |
  LC_ALL=C sort | diff -u - <(LC_ALL=C sort <<< "$uploaded")
gh release edit "$tag" --draft=false
