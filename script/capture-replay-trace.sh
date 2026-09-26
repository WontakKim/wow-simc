#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENGINE="$ROOT/.local/simc-build/simc"
PROFILE="$ROOT/simc/profiles/MID2/MID2_Shaman_Elemental.simc"
OUTPUT="$ROOT/.local/results/replay-capture"
FIXTURE="$ROOT/web/public/fixture/elemental-shaman-replay.json"
[[ -x "$ENGINE" ]] || { echo "Missing pinned SimC executable; run PATH=\$PWD/.local/venv/bin:\$PATH ./script/build-simc.sh" >&2; exit 1; }
[[ -f "$PROFILE" ]] || { echo "Missing official MID2 Elemental profile; initialize the simc submodule." >&2; exit 1; }
[[ "$(git -C "$ROOT" rev-parse HEAD:simc)" == "$(git -C "$ROOT/simc" rev-parse HEAD)" ]] || { echo "SimC checkout differs from the repository pin." >&2; exit 1; }
mkdir -p "$OUTPUT"
cd "$ROOT"
"$ENGINE" ptr=0 item_db_source=local iterations=1 threads=1 target_error=0 fixed_time=1 vary_combat_length=0 max_time=45 fight_style=Patchwerk desired_targets=1 seed=20260925 report_details=1 collect_action_sequence=1 log=1 log_spell_id=1 "output=$OUTPUT/combat.log" "json=$OUTPUT/report.json,version=2.0.0,full_states=1" "$PROFILE" > "$OUTPUT/run.log" 2>&1 || { cat "$OUTPUT/run.log" >&2; exit 1; }
python3 - "$OUTPUT" "$FIXTURE" "$PROFILE" "$(git -C "$ROOT/simc" rev-parse HEAD)" <<'PY'
import hashlib
import json
from pathlib import Path
import re
import sys

output, destination, profile = map(Path, sys.argv[1:4])
revision = sys.argv[4]
report = json.loads((output / 'report.json').read_text())
options = report['sim']['options']
if not revision.startswith(report['git_revision']) or options['seed'] != 20260925 or options['iterations'] != 1 or options['threads'] != 1:
    raise SystemExit('Capture identity mismatch (engine revision, seed, iterations or threads); rebuild the pinned SimC and retry.')
if options['fight_style'] != 'Patchwerk' or options['max_time'] != 45 or not options['fixed_time']:
    raise SystemExit('Capture options do not match the fixed 45-second Patchwerk run.')
players = report['sim']['players']
if len(players) != 1 or players[0]['name'] != 'MID2_Shaman_Elemental_Farseer':
    raise SystemExit('Unexpected player; expected the official MID2 Elemental Farseer profile.')
lines = (output / 'combat.log').read_text().splitlines()
pattern = re.compile(r"^\d+\.\d+ (?:Player '[^']+'|\S+) (?:schedules execute|performs Action|schedules travel|Action '[^']+' \(\d+\) (?:hits|ticks|misses)|(?:gains|loses|decrements|refreshes) Buff|arises\.|demises\.|summons \S+ for)")
combat_lines = [[ordinal, line] for ordinal, line in enumerate(lines)]
combat_lines = [entry for entry in combat_lines if pattern.match(entry[1])]
if not combat_lines or not any('schedules travel' in line for _, line in combat_lines) or not any('arises. Spawn Index=4' in line for _, line in combat_lines):
    raise SystemExit('Combat log incomplete; no travel or second ancestor spawn.')
player = players[0]
collected = player['collected_data']
report['sim']['players'] = [{key: player[key] for key in ('name', 'specialization', 'role')} | {'collected_data': {
    key: collected[key] for key in ('dps', 'fight_length', 'action_sequence_precombat', 'action_sequence')
}}]
report['sim'] = {'options': options, 'players': report['sim']['players']}
report['capture'] = {
    'profile': 'simc/profiles/MID2/MID2_Shaman_Elemental.simc',
    'profile_sha256': hashlib.sha256(profile.read_bytes()).hexdigest(),
    'engine_revision': revision,
    'seed': 20260925,
    'combat_log': combat_lines,
}
destination.write_text(json.dumps(report, separators=(',', ':'), ensure_ascii=False) + '\n')
print(f'Captured {len(combat_lines)} log events from one run; bundled {destination.stat().st_size} bytes in {destination}')
PY
