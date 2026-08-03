#!/bin/sh

set -e

DATE=$(date +"%Y-%m-%d-%s")
TEXT="${*:-update}"

git add .
npm i
git commit -m "[$DATE] $TEXT"
git push
