# Feature tabs (Chat / Live / Files / Diffs)
#
# Pane detail defaults to Chat (agent transcript + composer). Live is the classic
# terminal mirror. Files and Diffs are workspace-scoped reads via the bridge
# (`/api/pane/:id/fs/*`, `/api/pane/:id/git/*`) — never absolute client paths.
#
# Dev (this fork):
#   nix develop
#   herdr plugin link "$(pwd)"
#   herdr plugin action invoke start --plugin herdr.collie
#
# Upstream sync:
#   git fetch upstream && git merge upstream/main
