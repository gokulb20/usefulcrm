#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

die() { echo "error: $*" >&2; exit 1; }

if ! command -v gh >/dev/null 2>&1; then
  die "gh CLI is required to sync repository secrets"
fi

if ! gh auth status >/dev/null 2>&1; then
  die "run 'gh auth login' before syncing GitHub secrets"
fi

if [[ -z "${POSTHOG_KEY:-}" ]]; then
  die "POSTHOG_KEY environment variable is required"
fi

gh secret set POSTHOG_KEY --body "$POSTHOG_KEY"
echo "synced POSTHOG_KEY"

if [[ -n "${NPM_TOKEN:-}" ]]; then
  gh secret set NPM_TOKEN --body "$NPM_TOKEN"
  echo "synced NPM_TOKEN"
else
  echo "skipped NPM_TOKEN (not set)"
fi

echo ""
echo "GitHub Actions secrets are ready for the release workflow."
echo "If you configure npm trusted publishing later, you can remove NPM_TOKEN."
