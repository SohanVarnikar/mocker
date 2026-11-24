#!/bin/sh
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js 18 or later is required: https://nodejs.org"; exit 1; }
echo "API Mocker - admin UI: http://localhost:4001   mock API: http://localhost:4000"
exec node mocker.js
