#!/usr/bin/env bash
#
# Sets the issue type on a GitHub issue via GraphQL.
# Usage: ./scripts/edit-issue-type.sh Bug
#        ./scripts/edit-issue-type.sh Feature
#        ./scripts/edit-issue-type.sh Task
#
# The issue number is read from the workflow event payload.

set -euo pipefail

TYPE_NAME="${1:-}"
if [[ -z "$TYPE_NAME" ]]; then
  echo "Error: issue type name required (Bug, Feature, Task)" >&2
  exit 1
fi

ISSUE_NUMBER=$(jq -r '.issue.number // empty' "${GITHUB_EVENT_PATH:?GITHUB_EVENT_PATH not set}")
if ! [[ "$ISSUE_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "Error: no issue number in event payload" >&2
  exit 1
fi

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"
OWNER="${REPO%%/*}"
REPO_NAME="${REPO##*/}"

# Look up the issue type ID
TYPE_ID=$(gh api graphql -f query="
  { repository(owner: \"$OWNER\", name: \"$REPO_NAME\") {
      issueTypes(first: 20) { nodes { id name } }
  } }
" --jq ".data.repository.issueTypes.nodes[] | select(.name == \"$TYPE_NAME\") | .id")

if [[ -z "$TYPE_ID" ]]; then
  echo "Error: issue type '$TYPE_NAME' not found in repository" >&2
  exit 1
fi

# Look up the issue node ID
ISSUE_ID=$(gh api graphql -f query="
  { repository(owner: \"$OWNER\", name: \"$REPO_NAME\") {
      issue(number: $ISSUE_NUMBER) { id }
  } }
" --jq '.data.repository.issue.id')

if [[ -z "$ISSUE_ID" ]]; then
  echo "Error: issue #$ISSUE_NUMBER not found" >&2
  exit 1
fi

# Set the issue type
gh api graphql -f query="
  mutation {
    updateIssue(input: { id: \"$ISSUE_ID\", issueTypeId: \"$TYPE_ID\" }) {
      issue { number title }
    }
  }
" --silent

echo "Set issue #$ISSUE_NUMBER type to $TYPE_NAME"
