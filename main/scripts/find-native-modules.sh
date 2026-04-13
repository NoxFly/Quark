#!/usr/bin/env bash

for d in ./node_modules/*/; do
  ls "$d"/*.gyp >/dev/null 2>&1 && echo "$d"
done
