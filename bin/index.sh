#!/usr/bin/env zsh

pushd "$0:a:h/../"
yarn ts-node --script-mode index.ts "$@"
popd
