#!/bin/bash
# Prints the map screenshots into the CI log in short base64 lines, so they can be read back without the artifact store.
for f in app-shots/app-map*.png; do [ -f "$f" ] && base64 -w 60000 "$f" | sed "s|^|SHOT $f |"; done
true
