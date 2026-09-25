#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 0 ]]; then
  printf 'Usage: %s\n' "$0" >&2
  exit 2
fi

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENGINE_SOURCE="$REPOSITORY_ROOT/simc"
EXECUTABLE="$REPOSITORY_ROOT/.local/simc-build/simc"

for tool in git python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Required tool missing: %s. Install Git and Python 3 before running the smoke test.\n' "$tool" >&2
    exit 1
  fi
done

if [[ ! -f "$ENGINE_SOURCE/.git" || ! -f "$ENGINE_SOURCE/CMakeLists.txt" ]]; then
  printf 'Initialize the engine from the repository root: git submodule update --init --recursive -- simc\n' >&2
  exit 1
fi
EXPECTED_REVISION="$(git -C "$REPOSITORY_ROOT" rev-parse HEAD:simc)"
SOURCE_REVISION="$(git -C "$ENGINE_SOURCE" rev-parse HEAD)"
if [[ "$SOURCE_REVISION" != "$EXPECTED_REVISION" ]]; then
  printf 'The simc checkout differs from the repository pin. Inspect it before running git submodule update --init --recursive -- simc.\n' >&2
  exit 1
fi
if [[ ! -x "$EXECUTABLE" ]]; then
  printf 'CLI not found. Run ./script/build-simc.sh from the repository root first.\n' >&2
  exit 1
fi

mkdir -p "$REPOSITORY_ROOT/.local/results"
RESULT_DIRECTORY="$(mktemp -d "$REPOSITORY_ROOT/.local/results/smoke-test.XXXXXX")"
printf 'Smoke-test output: %s\n' "$RESULT_DIRECTORY"
cd "$REPOSITORY_ROOT"
if "$EXECUTABLE" research/examples/smoke-test.simc \
  "html=$RESULT_DIRECTORY/report.html" \
  "json2=$RESULT_DIRECTORY/report.json" \
  > "$RESULT_DIRECTORY/run.log" 2>&1; then
  :
else
  exit_code=$?
  cat "$RESULT_DIRECTORY/run.log" >&2
  printf 'Simulation failed with exit status %s. See %s/run.log\n' "$exit_code" "$RESULT_DIRECTORY" >&2
  exit "$exit_code"
fi

python3 - "$RESULT_DIRECTORY" "$EXPECTED_REVISION" <<'PY'
import json
import math
from pathlib import Path
import sys

result_directory = Path(sys.argv[1])
expected_revision = sys.argv[2]
report_path = result_directory / "report.json"
html_path = result_directory / "report.html"


def fail(message):
    raise SystemExit(f"Smoke validation failed: {message}\nSee {result_directory / 'run.log'}")


try:
    report = json.loads(report_path.read_text())
except (OSError, ValueError) as error:
    fail(f"Cannot read JSON report: {error}")
if not isinstance(report, dict) or report.get("report_version") != "2.0.0":
    fail("Expected a version-2.0.0 JSON report.")
reported_revision = report.get("git_revision")
if (not isinstance(reported_revision, str) or len(reported_revision) < 7
        or not expected_revision.startswith(reported_revision)):
    fail("Engine revision does not match the source pin. Run ./script/build-simc.sh.")

try:
    environment = report["sim"]["options"]["dbc"]["version_used"]
    players = report["sim"]["players"]
except (KeyError, TypeError) as error:
    fail(f"Missing required simulation data: {error}")
if environment != "Live":
    fail("Expected Live game data, not PTR/beta.")
if not isinstance(players, list) or any(not isinstance(player, dict) for player in players):
    fail("Expected a list of player records.")
actor_name = "MID2_Mage_Frost_Spellslinger"
actors = [player for player in players if player.get("name") == actor_name]
if len(actors) != 1:
    fail(f"Expected exactly one actor named {actor_name}.")
try:
    mean_dps = actors[0]["collected_data"]["dps"]["mean"]
except (KeyError, TypeError) as error:
    fail(f"Missing actor DPS: {error}")
if (isinstance(mean_dps, bool) or not isinstance(mean_dps, (int, float))
        or not math.isfinite(mean_dps) or mean_dps <= 0):
    fail("Expected finite, positive mean DPS for the official smoke profile.")
if not html_path.is_file() or html_path.stat().st_size == 0:
    fail("The HTML report is missing or empty.")

logs = report.get("logs", [])
if not isinstance(logs, list):
    fail("Expected a list of diagnostic records.")
has_errors = False
for diagnostic in logs:
    if not isinstance(diagnostic, dict):
        fail("Invalid diagnostic record.")
    level, message = diagnostic.get("level"), diagnostic.get("message")
    if not isinstance(level, str) or not isinstance(message, str):
        fail("Invalid diagnostic level or message.")
    print(f"{level}: {message}", file=sys.stderr)
    if level.lower() in ("error", "fatal"):
        has_errors = True
if has_errors:
    fail("The engine reported error/fatal diagnostics despite a zero exit status.")

print(f"Smoke test passed: {actor_name}, mean DPS {mean_dps:.2f} (not a benchmark).")
print(f"JSON: {report_path}")
print(f"HTML: {html_path}")
PY
