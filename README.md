# Ma collection Gunpla

Site perso, local, sans compte : catalogue de maquettes et suivi de ma collection (souhaité, possédé, monté).

## Démarrer

Le plus simple : double-cliquer sur `demarrer.bat` (Windows) ou lancer `./demarrer.sh` (Linux). Le lanceur installe les dépendances la première fois, démarre le site et ouvre le navigateur (voir « Installer chez un ami » pour Node).

À la main, avec Node.js 24 ou plus récent :

```
npm install   # une seule fois, après le clonage
npm start
```

Puis ouvrir l'adresse affichée (par défaut http://localhost:3000). Le serveur n'écoute que sur 127.0.0.1 (local uniquement, l'API n'a pas d'authentification) ; le port se change avec la variable `PORT`, l'interface avec `HOST` (l'en-tête `Host` doit être `localhost`, `127.0.0.1`, `[::1]` ou la valeur de `HOST`, et les écritures cross-origin sont refusées). Les boutons « Actualiser » lancent une mise à jour à la demande ; une mise à jour automatique a aussi lieu à l'ouverture (voir plus bas).

> **Attention :** le site n'a pas de mot de passe. Régler `HOST` sur autre chose que `127.0.0.1`, `localhost` ou `::1` (par exemple `0.0.0.0`) l'ouvre à tout votre réseau : n'importe qui peut alors lire et modifier votre collection. Le serveur l'écrit dans la console au démarrage.
## Où sont mes données

Tout vit dans le dossier `data/` à la racine du projet (ou dans `DATA_DIR` s'il est défini) :

- `gunpla.db` : la base SQLite (catalogue, exemplaires, notes, prix) ;
- les photos stockées localement.

Les données persistent entre les redémarrages. Le dossier est ignoré par git.

## Déplacer mes données

1. Arrêter le site.
2. Copier tout le dossier `data/` vers le nouvel emplacement (les fichiers `gunpla.db-wal` et `gunpla.db-shm`, s'ils existent, font partie de la base : copier le dossier en entier).
3. Lancer avec `DATA_DIR` pointant vers ce dossier, par exemple `DATA_DIR=/chemin/vers/data npm start` (PowerShell : `$env:DATA_DIR="D:\gunpla\data"; npm start`).

## Mise à jour automatique

À l'ouverture du serveur, si la dernière mise à jour du catalogue date de plus de 7 jours (ou n'a jamais eu lieu), le site enchaîne en tâche de fond : import du catalogue, relevé des prix, puis photos. Un bandeau « Mise à jour en cours » s'affiche et le site reste utilisable. Un échec réseau est noté dans le journal (une ligne par étape) et ne bloque rien ; jamais deux mises à jour en même temps. Les boutons « Actualiser » forcent une mise à jour à tout moment.

- Photos : HLJ, puis Gundam Planet, puis USA Gundam Store, puis A-Z Toy Hobby, puis Las Cale Model en repli, interrogés en parallèle (chaque kit garde cet ordre de priorité). Aucune clé ni compte. Un kit refusé par une source (pas de fiche correspondante) n'y est pas redemandé pendant 7 jours tant que les règles de correspondance, son nom et son grade ne changent pas ; `POST /api/photos/refresh?force=1` ignore cette mémoire.
- Un kit qui disparaît de la source est masqué (jamais supprimé, sa photo reste), sauf s'il est dans la collection ; il réapparaît s'il revient. Un import vide ou en erreur ne masque rien.
- Un kit sans photo affiche « Introuvable » et un bouton « Chercher une photo » (recherche d'images dans un nouvel onglet) ; l'ajout de sa propre photo reste possible.

## Installer chez un ami

1. Envoyer le zip de la dernière release (voir « Publier une version » plus bas : page Releases du dépôt GitHub, fichier `gunpla-collection-vX.Y.Z.zip`), ou le projet par `git clone`, ou par un zip fait avec `git archive` :
   `git archive --format=zip -o gunpla.zip HEAD`. Ne JAMAIS envoyer `data/` (ta base et tes photos), `node_modules/` ni `.node/` : `git clone` et `git archive` ne les contiennent pas, un simple « clic droit, compresser » du dossier, si.
2. Chez l'ami : sous Windows, placer le dossier du site près de la racine d'un disque (par exemple `C:\gunpla`) : l'archive de Node contient des chemins très longs et l'extraction peut dépasser la limite de longueur de chemin de Windows. Puis double-cliquer sur `demarrer.bat` (Windows) ou lancer `./demarrer.sh` (Linux ; `chmod +x demarrer.sh` si le bit exécutable a été perdu). Le site s'ouvre dans le navigateur ; Ctrl+C dans la fenêtre l'arrête. Si le site tourne déjà sur le port (3000 par défaut, variable `PORT`), le lanceur n'en démarre pas un second et ouvre simplement le navigateur.
3. Node.js est téléchargé automatiquement s'il manque (ou s'il est plus ancien que 24.0.0) : le lanceur demande d'abord confirmation, télécharge l'archive officielle depuis https://nodejs.org/dist (environ 30 Mo), vérifie sa somme SHA-256 contre le `SHASUMS256.txt` de la même version (somme fausse : arrêt, rien n'est extrait), puis l'extrait dans le dossier `.node/` du site. Aucun droit administrateur, rien n'est installé dans le système. Windows 64 bits (x64) et Linux x64 ou arm64 sont gérés ; ailleurs, installer Node.js à la main depuis https://nodejs.org.
4. La base est vide au départ ; aucune clé, aucun compte. La première mise à jour (catalogue, prix, photos) se lance toute seule à l'ouverture et prend un moment ; les boutons « Actualiser » permettent de la relancer à la main.

### Changer la version de Node téléchargée

La version est épinglée à un seul endroit par lanceur : la variable `NODE_VERSION` en haut de `demarrer.bat` et de `demarrer.sh` (par exemple `v24.19.0`). Pour la changer : choisir une version 24.x.y publiée sur https://nodejs.org/dist/, modifier les DEUX lignes, supprimer le dossier `.node/` pour forcer un nouveau téléchargement. `demarrer.bat` est enregistré en Windows-1252 (pas en UTF-8) : l'éditer avec un éditeur qui conserve cet encodage.

## Publier une version

1. Monter `version` dans `package.json` (et `package-lock.json`, par exemple avec `npm version 1.0.1 --no-git-tag-version`), puis fusionner dans `main`.
2. Depuis `main` à jour : `git tag v1.0.1 && git push origin v1.0.1`. Le tag doit être exactement `v` + la version de `package.json`, sinon le workflow s'arrête sans rien publier.
3. Le workflow `.github/workflows/release.yml` lance les tests, puis crée la Release GitHub (notes générées) avec un seul fichier : `gunpla-collection-v1.0.1.zip`, visible dans l'onglet Releases du dépôt. Une release déjà publiée n'est pas modifiée : pour corriger, publier la version suivante.

Un tag avec un tiret (par exemple `v1.1.0-rc.1`, avec la même version dans `package.json`) est publié comme préversion.

En cas d'échec (tag différent de la version, ou Release créée sans son zip) : supprimer le tag et, s'il existe, la Release (`git push --delete origin v1.0.1`, `git tag -d v1.0.1`, `gh release delete v1.0.1 --yes`), corriger, puis recréer le tag.

Le zip contient un dossier `gunpla-collection/` avec `src/`, `public/`, `scripts/`, `demarrer.bat`, `demarrer.sh`, `package.json`, `package-lock.json`, `README.md`, `LICENSE` et `.gitattributes` (les textes de licence des polices, `public/fonts/OFL-*.txt`, sont dans `public/`). Il ne contient ni tests, ni docs, ni `data/`, ni `node_modules/`, ni `.node/` : il est valable pour Windows et Linux, Node est téléchargé au premier démarrage.

Pour l'envoyer à un ami : lui donner le zip de la page Releases, qu'il décompresse (près de la racine d'un disque sous Windows) puis suit « Installer chez un ami ».

## Problèmes connus

- Contraste forcé de Windows : la note d'un exemplaire dans le registre de la collection s'affiche en bleu (constaté sur une capture, cause non étudiée). Sans conséquence sur l'usage.

## Tests

```
npm test
```

## Licence

- Le code est sous licence MIT (voir `LICENSE`).
- Les polices IBM Plex Sans et Saira Semi Condensed, dans `public/fonts`, sont sous licence SIL Open Font License 1.1 (textes dans `public/fonts/OFL-*.txt`).
- Les photos et les données du catalogue appartiennent à leurs propriétaires : elles sont récupérées localement, pour un usage personnel, et ne sont pas redistribuées avec ce dépôt.
- Gundam, Bandai et les autres noms de marques appartiennent à leurs propriétaires ; ce projet n'est ni affilié ni approuvé par eux.
