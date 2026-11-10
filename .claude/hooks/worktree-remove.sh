#!/usr/bin/env sh
# Claude Code WorktreeRemove hook, the pair to worktree-create.sh.
#
# Claude Code never deletes the branch of a worktree a WorktreeCreate hook
# made, so this does — but only with `git branch -d`, which refuses a branch
# that is not merged. Unmerged work stays on its branch; nothing is lost.
#
# Contract (https://code.claude.com/docs/en/hooks#worktreeremove): JSON with
# `worktree_path` on stdin; exit 0 means removed.
set -eu

path=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).worktree_path??"")))')
[ -n "$path" ] || exit 0

root=$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --show-toplevel)
branch=$(git -C "$path" branch --show-current 2>/dev/null || true)

git -C "$root" worktree remove --force "$path" >&2 || true

case "$branch" in
  worktree-*) git -C "$root" branch -d "$branch" >&2 || echo "worktree-remove: kept unmerged branch $branch" >&2 ;;
esac
