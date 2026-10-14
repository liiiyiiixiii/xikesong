#!/bin/zsh
set -e
cd "$(dirname "$0")"
if [ -s "$HOME/.nvm/nvm.sh" ]; then source "$HOME/.nvm/nvm.sh"; nvm use 24; fi
node -e 'if(Number(process.versions.node.split(".")[0])!==24)throw Error("需要 Node.js 24")'
if [ ! -d node_modules ]; then npm ci; fi
exec npm run demo
