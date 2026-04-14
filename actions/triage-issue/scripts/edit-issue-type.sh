#!/usr/bin/env bash
#
# Sets the issue type on a GitHub issue via GraphQL.
# Usage: ISSUE_NUMBER=123 ./scripts/edit-issue-type.sh Bug
#
# Requires ISSUE_NUMBER and GITHUB_REPOSITORY env vars.

set -euo pipefail

TYPE_NAME="${1:-}"
if [[ -z "$TYPE_NAME" ]]; then
  echo "Error: issue type name required (Bug, Feature, Task)" >&2
  exit 1
fi

if ! [[ "${ISSUE_NUMBER:-}" =~ ^[0-9]+$ ]]; then
  echo "Error: ISSUE_NUMBER env var must be a positive integer" >&2
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
