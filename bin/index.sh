#!/usr/bin/env bash

pushd "$(dirname $0)/../typescript/"
yarn run ts-node --script-mode index.ts "$@"
popd
