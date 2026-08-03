#!/bin/sh

set -e

DATE=$(date +"%Y-%m-%d-%s")
TEXT="${*:-update}"

npm i
git add .
git commit -m "[$DATE] $TEXT"
git push
