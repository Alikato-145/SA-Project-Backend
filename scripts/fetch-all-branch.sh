#!/usr/bin/env bash

set -euo pipefail

for remote in $(git remote); do
  echo "Fetching $remote..."
  git fetch --prune "$remote"

  while IFS= read -r branch; do
    [ "$branch" = "HEAD" ] && continue

    if git show-ref --verify --quiet "refs/heads/$branch"; then
      continue
    fi

    echo "New local branch: $branch (tracking $remote/$branch)"
    git branch --track "$branch" "$remote/$branch"
  done < <(git for-each-ref --format='%(refname:strip=3)' "refs/remotes/$remote")
done

while read -r branch upstream; do
  [ -z "$upstream" ] && continue

  if ! git show-ref --verify --quiet "refs/remotes/$upstream"; then
    echo "Remote branch missing: $branch (was tracking $upstream)"
  fi
done < <(git for-each-ref --format='%(refname:short) %(upstream:short)' refs/heads)
