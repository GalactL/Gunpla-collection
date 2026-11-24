#!/usr/bin/env bash
# Lanceur Linux : choisit un Node >= 24 (celui du système, sinon une copie locale dans .node/),
# puis exécute scripts/lancer.mjs. Rien n'est installé dans le système (ni sudo, ni PATH permanent).

# VERSION DE NODE ÉPINGLÉE : c'est la seule ligne à modifier pour changer la version téléchargée
# (une version 24.x.y publiée sur https://nodejs.org/dist/ ; voir le README, « Changer la version de Node »).
NODE_VERSION="v24.19.0"

MIN_MAJOR=24 # même minimum que « engines.node » dans package.json ; scripts/lancer.mjs revérifie major.minor.patch
cd "$(dirname "$0")" || exit 1

echec() {
  printf '%s\n' "$1" "Vous pouvez installer Node.js vous-même : https://nodejs.org" >&2
  exit 1
}

# Réussit si « $1 --version » affiche vX.Y.Z avec X >= 24 (commande absente ou sortie invalide : échec).
node_ok() {
  local v
  v=$("$1" --version 2>/dev/null) || return 1
  [[ $v =~ ^v?([0-9]+)\.[0-9]+\.[0-9]+$ ]] && ((10#${BASH_REMATCH[1]} >= MIN_MAJOR))
}

# Télécharge $1 dans le fichier $2 (curl ou wget, HTTPS uniquement).
telecharger() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --proto '=https' --tlsv1.2 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --https-only --secure-protocol=TLSv1_2 -O "$2" "$1"
  else
    return 1
  fi
}

installer_node() {
  local arch nom base tmp rep attendu obtenu
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) echec "Architecture non gérée ($(uname -m)) : seules x64 et arm64 sont prises en charge." ;;
  esac
  printf 'Node.js 24 est nécessaire. Le télécharger dans le dossier du site (environ 30 Mo, aucun droit administrateur) ? [o/N] '
  read -r rep
  case "$rep" in
    o | O | oui | Oui | OUI) ;;
    *) echec "Téléchargement refusé : le site ne peut pas démarrer sans Node.js 24." ;;
  esac
  # L'URL ne vient que de la version épinglée et de la table d'architectures ci-dessus.
  nom="node-$NODE_VERSION-linux-$arch"
  base="https://nodejs.org/dist/$NODE_VERSION"
  tmp=$(mktemp -d) || echec "Impossible de créer un dossier temporaire."
  trap 'rm -rf "$tmp"' EXIT
  telecharger "$base/$nom.tar.xz" "$tmp/archive" && telecharger "$base/SHASUMS256.txt" "$tmp/sommes" ||
    echec "Le téléchargement a échoué (connexion internet ? curl ou wget manquant ?)."
  attendu=$(awk -v f="$nom.tar.xz" '$2 == f { print $1 }' "$tmp/sommes")
  obtenu=$(sha256sum "$tmp/archive" | awk '{ print $1 }')
  [[ -n $attendu && $attendu == "$obtenu" ]] ||
    echec "Somme de contrôle SHA-256 incorrecte : archive rejetée, rien n'a été extrait ni exécuté."
  rm -rf .node && mkdir .node && tar -xJf "$tmp/archive" -C .node --strip-components=1 || {
    rm -rf .node
    echec "Extraction impossible (le paquet xz-utils est peut-être manquant)."
  }
  node_ok ./.node/bin/node || {
    rm -rf .node
    echec "La copie téléchargée de Node.js ne fonctionne pas."
  }
  rm -rf "$tmp"
  trap - EXIT
}

if node_ok node; then
  NODE=node
else
  node_ok ./.node/bin/node || installer_node
  NODE=$PWD/.node/bin/node
  export PATH="$PWD/.node/bin:$PATH" # ce processus seulement : npm a besoin de trouver « node »
fi
exec "$NODE" scripts/lancer.mjs "$@"
