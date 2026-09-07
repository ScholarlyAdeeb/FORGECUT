#!/usr/bin/env bash
# Read-only dependency probe for the ship-loop skill.
# Reports what's installed vs missing. Makes NO changes — safe to run anytime.
set -u

USER_SKILLS="${HOME}/.claude/skills"
PROJ_SKILLS="./.claude/skills"
PLUGINS="${HOME}/.claude/plugins"

# Where is a skill installed, if anywhere? Echoes the location tag or returns 1.
locate_skill() {
  local n="$1"
  [ -f "${USER_SKILLS}/${n}/SKILL.md" ] && { echo "user (~/.claude/skills)"; return 0; }
  [ -f "${PROJ_SKILLS}/${n}/SKILL.md" ] && { echo "project (.claude/skills)"; return 0; }
  # plugin-provided skills live under a plugin's own skills/ dir
  if ls "${PLUGINS}"/*/skills/"${n}"/SKILL.md >/dev/null 2>&1; then echo "plugin"; return 0; fi
  return 1
}

echo "ship-loop dependency check"
echo "============================="

missing=0
for n in grill-with-docs structural-code-review frontend-visual-qa; do
  if loc="$(locate_skill "$n")"; then
    printf "  [OK]      %-26s %s\n" "$n" "$loc"
  else
    printf "  [MISSING] %-26s install via reference/setup.md\n" "$n"
    missing=$((missing + 1))
  fi
done

# Codex plugin: heuristic filesystem check. The reliable check is whether /codex:*
# commands are listed as available in the session — prefer that signal when known.
if ls -d "${PLUGINS}"/*codex* >/dev/null 2>&1 || ls -d "${PLUGINS}"/*/*codex* >/dev/null 2>&1; then
  printf "  [OK]      %-26s plugin\n" "codex-plugin-cc"
else
  printf "  [MISSING] %-26s you run /plugin install (see setup.md §5)\n" "codex-plugin-cc"
  missing=$((missing + 1))
fi

echo
echo "  native (built in, no install): /simplify  /verify"
echo
if [ "$missing" -eq 0 ]; then
  echo "All copyable/plugin deps present."
else
  echo "${missing} dependency(ies) missing — see reference/setup.md to install."
fi
