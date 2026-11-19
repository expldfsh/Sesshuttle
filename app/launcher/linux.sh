#!/bin/sh
directory=$(dirname -- "$(readlink -f -- "$0")") || exit 1
export ELECTRON_RUN_AS_NODE=1
exec "$directory/sesshuttle-runtime" "$directory/resources/sesshuttle-start.cjs" "$@"
