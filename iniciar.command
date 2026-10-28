#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Instale o Node.js 22 ou mais novo em https://nodejs.org e rode de novo."; read -r; exit 1; }
read -rp "Digite o seu e-mail (ele recebe o acesso total): " ADMIN_EMAILS
export ADMIN_EMAILS PORT=3000
echo "AGENDA X abrindo em http://localhost:3000 (Ctrl+C para desligar)"
(sleep 2; (open http://localhost:3000 || xdg-open http://localhost:3000) >/dev/null 2>&1) &
node --disable-warning=ExperimentalWarning server.js
