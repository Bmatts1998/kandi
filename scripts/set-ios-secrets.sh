#!/usr/bin/env bash
# Set GitHub Actions secrets for the Kandi TestFlight workflow.
# Never prints secret values. Does not start the workflow.
#
# Required environment variables:
#   KEY_ID     App Store Connect API key id (the AuthKey_XXXXXXXXXX filename suffix)
#   ISSUER_ID  App Store Connect issuer id (UUID)
#   TEAM_ID    Apple Developer team id (10 characters, Membership page)
#   P8_PATH    Path to the downloaded .p8 private key file
#
# Optional:
#   REPO       GitHub repo, default Bmatts1998/kandi
#
# Example:
#   KEY_ID=ABC123DEFG ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
#     TEAM_ID=ABCD123456 P8_PATH=$HOME/AuthKey_ABC123DEFG.p8 \
#     ./scripts/set-ios-secrets.sh
set -euo pipefail
set +x

REPO="${REPO:-Bmatts1998/kandi}"

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  sed -n '2,22p' "$0"
  exit 0
fi

: "${KEY_ID:?Set KEY_ID to the App Store Connect API Key ID}"
: "${ISSUER_ID:?Set ISSUER_ID to the App Store Connect Issuer ID}"
: "${TEAM_ID:?Set TEAM_ID to the 10-character Apple Developer Team ID}"
: "${P8_PATH:?Set P8_PATH to the AuthKey_*.p8 file}"

if [ ! -f "${P8_PATH}" ]; then
  echo "P8_PATH is not a file: ${P8_PATH}" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "The GitHub CLI (gh) is not installed or not on PATH." >&2
  exit 1
fi

# Validate the file looks like a key without printing it.
if ! python3 - "${P8_PATH}" <<'PY'
import sys
from pathlib import Path
text = Path(sys.argv[1]).read_text()
if "BEGIN" not in text:
    sys.stderr.write("P8_PATH does not look like a .p8 private key (missing BEGIN).\n")
    sys.exit(1)
PY
then
  exit 1
fi

gh secret set APP_STORE_CONNECT_KEY_ID --repo "${REPO}" --body "${KEY_ID}"
gh secret set APP_STORE_CONNECT_ISSUER_ID --repo "${REPO}" --body "${ISSUER_ID}"
gh secret set APPLE_TEAM_ID --repo "${REPO}" --body "${TEAM_ID}"
gh secret set APP_STORE_CONNECT_API_KEY --repo "${REPO}" < "${P8_PATH}"

echo "Set APP_STORE_CONNECT_KEY_ID, APP_STORE_CONNECT_ISSUER_ID, APP_STORE_CONNECT_API_KEY, and APPLE_TEAM_ID on ${REPO}."
echo "Secret values were not printed. The TestFlight workflow was not started."
echo "After this, run the \"Kandi iOS (TestFlight)\" workflow from the Actions tab, or: gh workflow run \"Kandi iOS (TestFlight)\" --repo ${REPO}"
