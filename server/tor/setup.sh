#!/usr/bin/env bash
# Copyright (c) 2025 Jema Technology.
# Distributed under the license specified in the root directory of this project.
#
# Nephtys — prépare le VPS pour le mode « Router via Tor » (bouton unique côté
# app, aucun réglage utilisateur) :
#   • installe Tor et ouvre un proxy SOCKS5 local (127.0.0.1:9050) ;
#   • (optionnel) expose aussi le relais en service .onion, pour les utilisateurs
#     qui passent par Tor Browser.
#
# La façon recommandée est la *passerelle Tor* (server/tor/gateway.mjs) : le
# navigateur parle en clair à cette passerelle, qui relaie ensuite vers le relais
# distant À TRAVERS Tor. Voir l'aide affichée en fin de script.
#
# Prérequis : VPS Debian/Ubuntu, accès root, relais SMP déjà à l'écoute en local
#             (par défaut ws://127.0.0.1:8765 — voir server/smp-broker/index.mjs).
#
# Usage :
#   sudo SMP_PORT=8765 bash server/tor/setup.sh

set -euo pipefail

SMP_PORT="${SMP_PORT:-8765}"
HS_DIR="${HS_DIR:-/var/lib/tor/nephtys_hs}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Ce script doit être exécuté en root (sudo)." >&2
  exit 1
fi

echo "[tor] installation de Tor…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y tor

if ! grep -qF "HiddenServiceDir ${HS_DIR}" /etc/tor/torrc 2>/dev/null; then
  echo "[tor] activation du SOCKS5 + service caché dans /etc/tor/torrc…"
  {
    echo ""
    echo "# --- Nephtys Tor ---"
    echo "SocksPort 127.0.0.1:9050"
    echo "HiddenServiceDir ${HS_DIR}"
    echo "HiddenServicePort 80 127.0.0.1:${SMP_PORT}"
    echo "# --- /Nephtys ---"
  } >>/etc/tor/torrc
else
  echo "[tor] configuration déjà présente."
fi

echo "[tor] redémarrage du démon Tor…"
systemctl restart tor

for _ in $(seq 1 15); do
  [ -f "${HS_DIR}/hostname" ] && break
  sleep 1
done

echo ""
echo "=================================================================="
echo " 1) Passerelle Tor (recommandé, un clic côté app)"
echo "    cd server/tor && npm install"
echo "    TOR_UPSTREAM=wss://<relais-distant>/ node gateway.mjs"
echo "    puis expose /tor en wss:// derrière ton reverse proxy TLS."
echo "    L'app utilisera automatiquement  wss://<hôte-relais>/tor"
echo "    (ou définis VITE_TOR_GATEWAY_URL pour forcer l'URL)."
if [ -f "${HS_DIR}/hostname" ]; then
  echo ""
  echo " 2) Service .onion (Tor Browser uniquement)"
  echo "    $(cat "${HS_DIR}/hostname")"
fi
echo "=================================================================="
