# Lanceur Windows et Linux

Statut : acceptée. Date : 2026-11-24.

## Pourquoi
Pour donner le site à un ami, il faut aujourd'hui installer Node, ouvrir un terminal, taper `npm install` puis `npm start`, et ouvrir le navigateur à la main. Un double-clic serait plus simple.

## Résultat
Deux lanceurs fins (`demarrer.bat`, `demarrer.sh`) et UN script Node partagé `scripts/lancer.mjs` qui porte la logique. Si Node ≥ 24 manque, le lanceur l'installe localement et sans droits administrateur dans `.node/`, puis démarre le serveur et ouvre le navigateur.

## Comportement actuel (vérifié)
- `package.json` : `engines` node>=24, unique dépendance `cheerio`.
- Démarrage : `npm install` puis `npm start` (`src/server.js`), écoute sur `127.0.0.1:3000` (variables `PORT` / `HOST`).
- Données dans `data/` (`DATA_DIR`).
- Le README a déjà une section « Installer chez un ami ».

## Dans le périmètre
- `demarrer.bat` (Windows) et `demarrer.sh` (Linux, bit exécutable commité via git, `#!/usr/bin/env bash`) : lanceurs fins, nom `demarrer` conservé. Ils choisissent un Node (le Node système s'il est ≥ 24, sinon `.node/`), l'installent si besoin (voir ci-dessous), puis exécutent `scripts/lancer.mjs`.
- `scripts/lancer.mjs` (logique commune) : vérifie Node ≥ 24 ; lance `npm install` seulement si `node_modules` est absent ; détecte un serveur déjà présent sur `PORT` et n'en démarre pas un second ; démarre le serveur ; ouvre le navigateur (`start` / `xdg-open`) une fois que le serveur répond ; respecte `PORT` ; Ctrl+C arrête le serveur.
- Helpers purs extraits dans `lancer.mjs` et testés avec `node:test` : comparaison de versions (`compareVersions` / `satisfiesMinimum`), construction port/URL, choix de la commande d'ouverture.
- Règle de version : le lanceur contrôle la version de Node INSTALLÉE et exige au moins 24.0.0, en comparant major.minor.patch en entier (pas seulement le major) : `v24.0.0` ou `24.1.3` passent, `v23.11.0` ou `v22.x` échouent. Le contrôle vaut pour le `node` système ET pour la copie déjà téléchargée dans `.node/` (une copie ancienne ou corrompue est retéléchargée après confirmation). La version est lue via `node --version`, en tolérant le `v` initial. Ce minimum est le même que `engines.node` (`>=24`) de `package.json`. Les lanceurs font un contrôle minimal (`node` présent et >= 24.0.0) ; `scripts/lancer.mjs` revérifie avec `compareVersions` / `satisfiesMinimum`, purs et testés.
- Node absent ou < 24 : le lanceur demande confirmation en français (« Node.js 24 est nécessaire. Le télécharger dans le dossier du site (environ 30 Mo, aucun droit administrateur) ? [o/N] »). Si oui : télécharge l'archive officielle depuis nodejs.org/dist (Windows : zip x64 via PowerShell `Invoke-WebRequest` + `Expand-Archive` ; Linux : tar.xz x64 ou arm64 selon `uname -m`, via curl/wget + tar), VÉRIFIE son SHA-256 contre le `SHASUMS256.txt` officiel de la même version et s'arrête si ça diffère, extrait dans `.node/` (ignoré par git) et lance `lancer.mjs` avec ce Node, réutilisé aux démarrages suivants.
- Version épinglée : une constante Node 24.x à un seul endroit dans chaque lanceur, avec un commentaire expliquant comment la changer.
- Refus, échec réseau, architecture non gérée ou somme de contrôle fausse : message clair en français, lien manuel nodejs.org, code de sortie non nul.
- Rien n'est installé dans le système : pas de sudo, pas de modification du PATH ni du registre.
- `.gitignore` : ajouter `.node/`.
- README, section « Installer chez un ami » : double-clic sur `demarrer.bat` (Windows) ou `./demarrer.sh` (Linux) ; Node est téléchargé automatiquement s'il manque ; NE PAS envoyer `data/`, `node_modules/` ni `.node/` ; envoyer par `git clone` ou par un zip fait avec `git archive`.

## Hors périmètre
- Mac, `.exe` ou installeur, installation système (winget, apt, nvm), mise à jour automatique de Node ou de l'application, Windows arm64.
- Nouvelle dépendance.
- Remplace l'ancien hors-périmètre « aucun appel réseau hors `npm install` » : les seuls nouveaux appels réseau sont le téléchargement depuis nodejs.org/dist et son `SHASUMS256.txt`, après consentement.

## Critères d'acceptation
- [ ] Lanceurs vérifiés par lecture, plus un essai à blanc du contrôle de Node.
- [ ] `demarrer.sh` passe `bash -n` et shellcheck si disponible.
- [ ] Helpers purs de `lancer.mjs` testés (`node:test`).
- [ ] Tests de version : 24.0.0 accepté, 24.0.1 accepté, 23.99.99 refusé, chaînes préfixées par `v` gérées, chaînes invalides refusées sans plantage.
- [ ] Node ancien ou absent (système ou `.node/`) : le message de consentement s'affiche.
- [ ] Somme de contrôle fausse simulée : arrêt, rien d'extrait, sortie non nulle.
- [ ] Refus du consentement : sortie non nulle, sans téléchargement.
- [ ] Un serveur déjà présent sur le port n'est pas doublé ; le navigateur s'ouvre quand même.
- [ ] `.gitignore` contient `.node/`.
- [ ] README mis à jour (lanceurs, Node automatique, avertissement `data/` / `node_modules/` / `.node/`).
- [ ] Tests existants au vert.

## Contraintes
Aucune dépendance ajoutée. Pas d'installeur ni de `.exe`. Seuls appels réseau : `npm install` et, après consentement, nodejs.org/dist. Rien d'installé dans le système. Messages en français.

## Vérification
`bash -n demarrer.sh`, shellcheck si présent, lecture et essai à blanc des lanceurs, essai avec Node simulé absent ou trop ancien, test du hash faux, `node --test` sur les helpers, `npm test`.
