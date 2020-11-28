#!/usr/bin/env bash

pushd "$(dirname $0)/../"
yarn ts-node --script-mode index.ts "$@"
popd
