#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# SphereHealth HIS — 3-way sync script
#
# Keeps the SAME code in three folders so we never lose work again:
#
#   1. WORKTREE  D:\Spherehealth\.claude\worktrees\reverent-shockley\
#                (where Claude edits and commits to git)
#
#   2. LIVE      D:\Spherehealth\
#                (where `npm run dev` actually runs — ports 5000 / 5173)
#
#   3. MIRROR    D:\SphereHealth HIS 1.0\
#                (the standalone plain-folder safety mirror)
#
# Workflow:
#   - Always EDIT in the worktree
#   - Commit + push to git from the worktree
#   - Then run this script (or it runs after every commit hook)
#   - All 3 folders end up byte-identical (except node_modules + .git)
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

WORKTREE='D:\Spherehealth\.claude\worktrees\reverent-shockley'
LIVE='D:\Spherehealth'
MIRROR='D:\SphereHealth HIS 1.0'

# Robocopy excludes: node_modules (huge), .git (separate), .vite (cache),
# dist (build output), logs (live state).
ROBO_FLAGS='//MIR //XD node_modules .git .vite dist //XF *.log //NFL //NDL //NJH //NJS //NC //NS //NP'

echo "════════════════════════════════════════════════════════════════"
echo "  SphereHealth HIS — 3-way sync"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "════════════════════════════════════════════════════════════════"

# Step 1 — mirror WORKTREE → LIVE (Frontend + Backend)
echo
echo "▶ [1/2] Worktree → Live  (D:\\Spherehealth\\)"
robocopy "${WORKTREE}\\Frontend" "${LIVE}\\Frontend" ${ROBO_FLAGS} || true
robocopy "${WORKTREE}\\Backend"  "${LIVE}\\Backend"  ${ROBO_FLAGS} || true

# Step 2 — mirror WORKTREE → MIRROR
echo
echo "▶ [2/2] Worktree → Mirror  (D:\\SphereHealth HIS 1.0\\)"
robocopy "${WORKTREE}\\Frontend" "${MIRROR}\\Frontend" ${ROBO_FLAGS} || true
robocopy "${WORKTREE}\\Backend"  "${MIRROR}\\Backend"  ${ROBO_FLAGS} || true

echo
echo "════════════════════════════════════════════════════════════════"
echo "  ✓ All 3 folders in sync."
echo "════════════════════════════════════════════════════════════════"
echo
echo "Next: if backend code changed, restart it:"
echo "  taskkill //F //PID <backend-pid>  &&  cd ${LIVE}\\Backend && node index.js &"
echo
echo "Frontend Vite HMR picks up automatically — just refresh the browser."
