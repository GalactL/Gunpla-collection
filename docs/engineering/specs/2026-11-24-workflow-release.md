# Workflow de release et première release v1.0.0

Statut : acceptée. Date : 2026-11-24.

## Pourquoi
Donner le site à un ami passe aujourd'hui par `git clone` ou un `git archive` fait à la main. Il faut un zip propre, produit de façon reproductible, téléchargeable depuis la page Releases de GitHub, et une CI minimale.

## Résultat
Pousser un tag `vX.Y.Z` publie automatiquement une Release GitHub avec notes générées et un seul zip `gunpla-collection-vX.Y.Z.zip`, valable pour Windows et Linux (le lanceur télécharge Node au premier démarrage). La première release est `v1.0.0`.

## État actuel (vérifié)
- Pas de dossier `.github/` avant ce chantier (ajouté par lui : `release.yml` et `ci.yml`). Dépôt `GalactL/Gunplas`, PR fusionnées par commits de merge, aucun tag ni release.
- `package.json` : `gunpla-collection` 0.1.0, `engines.node >=24`, script `test` = `node --test "tests/**/*.test.js"`.
- `demarrer.bat` : CRLF, Windows-1252 (`.gitattributes` `text eol=crlf`) ; `demarrer.sh` : LF, mode 100755. `git archive` applique la conversion de fin de ligne de `.gitattributes`.

## Dans le périmètre
- `package.json` : version 0.1.0 vers 1.0.0, dans la même PR.
- `.github/workflows/release.yml`, déclenché au push de tags `v*.*.*` : Node 24, `npm ci`, `npm test` (doit passer avant toute publication), vérification que le tag égale `v` + version de `package.json` (échec sinon), puis création de la Release (titre « v1.0.0 ») avec notes auto-générées (`gh release create --generate-notes` ou équivalent épinglé) et UN asset `gunpla-collection-v1.0.0.zip` construit par `git archive --format=zip` depuis le tag.
- Contenu du zip (liste blanche) : `src/`, `public/`, `scripts/`, `demarrer.bat`, `demarrer.sh`, `package.json`, `package-lock.json`, `README.md`, `LICENSE`, `.gitattributes` (les textes `public/fonts/OFL-*.txt` voyagent dans `public/`). Exclus : `tests/`, `docs/`, `.gearbox/`, `.impeccable/`, `.claude/`, `PRODUCT.md`, `.github/`, `data/`, `node_modules/`, `.node/`.
- Le zip garde le bit exécutable de `demarrer.sh` (à vérifier dans les modes du zip) et les fins de ligne CRLF/LF.
- Sécurité : permissions minimales (`contents: write` sur le seul job de release), garde de concurrence, aucun secret hors `GITHUB_TOKEN`, actions tierces épinglées (`actions/checkout`, `actions/setup-node` par version complète ou SHA).
- `.github/workflows/ci.yml` léger : sur pull request et push sur `main`, `npm ci && npm test` sur `ubuntu-latest` ET `windows-latest` (les tests du lanceur incluant de vrais tests `.bat` ne tournent que sous Windows).
- README : courte section « Publier une version » (monter la version dans `package.json`, fusionner, `git tag v1.0.1 && git push origin v1.0.1`, le zip apparaît dans Releases ; ce que contient le zip ; envoi à un ami : télécharger le zip depuis Releases).
- Étape mainteneur, séparée et explicitement demandée après la fusion de la PR : créer et pousser le tag `v1.0.0`, puis vérifier la page de la release, la liste des fichiers de l'asset, les fins de ligne et le bit exécutable de `demarrer.sh`.

## Hors périmètre
- Signature, Docker, publication npm, montée de version automatique, Mac, Node embarqué dans le zip.

## Critères d'acceptation
- [ ] YAML des workflows valide (actionlint si disponible, sinon analyse YAML).
- [ ] Tag différent de la version : le job échoue (lecture, et petit test de la logique de vérification si elle est extraite en script).
- [ ] La liste du zip, obtenue en lançant localement la même commande `git archive`, correspond à la liste blanche et exclut la liste noire.
- [ ] `package.json` en 1.0.0.
- [ ] Section README « Publier une version » présente.
- [ ] Tests existants au vert.
- [ ] Après fusion : release `v1.0.0` publiée, asset unique `gunpla-collection-v1.0.0.zip`, fins de ligne et bit exécutable corrects (vérifiés sur la page Releases et sur le zip téléchargé).

## Contraintes
Aucun secret autre que `GITHUB_TOKEN`. Actions tierces épinglées. Workflows courts. Texte du README en français.

## Vérification
actionlint ou analyse YAML ; `git archive --format=zip` local puis liste du contenu et des modes ; `npm test` ; contrôle de la release après le push du tag `v1.0.0`.
