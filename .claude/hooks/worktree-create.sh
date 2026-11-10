#!/usr/bin/env sh
# Claude Code WorktreeCreate hook: does what the default does (a linked git
# worktree at .claude/worktrees/<name> on branch worktree-<name>, from the
# remote's default branch, like `worktree.baseRef: "fresh"`), then runs
# `vp install` in it.
#
# Why: `.vite-hooks/_` (the git hook dispatcher) and node_modules are both
# gitignored, so a bare worktree has no commit/push checks at all — git skips
# a missing hooks dir silently — and cannot run `vp check` or `vp test`.
#
# Contract (https://code.claude.com/docs/en/hooks#worktreecreate): JSON with
# `name` on stdin; the worktree path as the last line of stdout; anything else
# goes to stderr; non-zero exit fails creation. Configuring this hook replaces
# Claude Code's own `git worktree add`, so it fires for --worktree,
# EnterWorktree, background sessions and subagent worktrees alike.
set -eu

name=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).name??"")))')

case "$name" in
  "" | *..* | /* | *[!A-Za-z0-9._/-]*)
    echo "worktree-create: refusing worktree name '$name'" >&2
    exit 1
    ;;
esac

root=$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --show-toplevel)
path="$root/.claude/worktrees/$name"
branch="worktree-$name"

{
  # "fresh": the remote's default branch, falling back to local HEAD when
  # there is no remote or origin/HEAD — the same fallback Claude Code uses.
  git -C "$root" fetch --quiet origin 2>/dev/null || true
  base=$(git -C "$root" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || echo HEAD)

  git -C "$root" worktree add -b "$branch" "$path" "$base"

  # A worktree without dependencies fails creation rather than starting with
  # no hooks: an install that half-worked is worse than one that visibly failed.
  if ! (cd "$path" && vp install); then
    echo "worktree-create: vp install failed; removing $path" >&2
    git -C "$root" worktree remove --force "$path" || true
    git -C "$root" branch -D "$branch" || true
    exit 1
  fi
} >&2

echo "$path"
