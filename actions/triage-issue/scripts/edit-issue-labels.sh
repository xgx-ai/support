#!/usr/bin/env bash
#
# Edits labels on a GitHub issue.
# Usage: ISSUE_NUMBER=123 ./scripts/edit-issue-labels.sh --add-label bug --add-label p1 --remove-label untriaged
#
# Requires ISSUE_NUMBER env var.

set -euo pipefail

if ! [[ "${ISSUE_NUMBER:-}" =~ ^[0-9]+$ ]]; then
  echo "Error: ISSUE_NUMBER env var must be a positive integer" >&2
  exit 1
fi
ISSUE="$ISSUE_NUMBER"

ADD_LABELS=()
REMOVE_LABELS=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --add-label)
      ADD_LABELS+=("$2")
      shift 2
      ;;
    --remove-label)
      REMOVE_LABELS+=("$2")
      shift 2
      ;;
    *)
      echo "Error: unknown argument (only --add-label and --remove-label are accepted)" >&2
      exit 1
      ;;
  esac
done

if [[ ${#ADD_LABELS[@]} -eq 0 && ${#REMOVE_LABELS[@]} -eq 0 ]]; then
  exit 1
fi

VALID_LABELS=$(gh label list --limit 500 --json name --jq '.[].name')

FILTERED_ADD=()
for label in "${ADD_LABELS[@]}"; do
  if echo "$VALID_LABELS" | grep -qxF "$label"; then
    FILTERED_ADD+=("$label")
  fi
done

FILTERED_REMOVE=()
for label in "${REMOVE_LABELS[@]}"; do
  if echo "$VALID_LABELS" | grep -qxF "$label"; then
    FILTERED_REMOVE+=("$label")
  fi
done

if [[ ${#FILTERED_ADD[@]} -eq 0 && ${#FILTERED_REMOVE[@]} -eq 0 ]]; then
  exit 0
fi

GH_ARGS=("issue" "edit" "$ISSUE")

for label in "${FILTERED_ADD[@]}"; do
  GH_ARGS+=("--add-label" "$label")
done

for label in "${FILTERED_REMOVE[@]}"; do
  GH_ARGS+=("--remove-label" "$label")
done

gh "${GH_ARGS[@]}"

if [[ ${#FILTERED_ADD[@]} -gt 0 ]]; then
  echo "Added: ${FILTERED_ADD[*]}"
fi
if [[ ${#FILTERED_REMOVE[@]} -gt 0 ]]; then
  echo "Removed: ${FILTERED_REMOVE[*]}"
fi
