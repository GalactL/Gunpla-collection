# Publication vers Gunpla-collection (dépôt public)

Statut : acceptée. Date : 2026-11-25.

## Pourquoi
`GalactL/Gunplas` (privé) est le dépôt de travail. `GalactL/Gunpla-collection` (public) en est un instantané sans historique (2 commits : « chore: version initiale publique » `c96e9d8`, « chore: ne plus suivre .gearbox » `9055088`). Rien ne décrit comment le tenir à jour : sans procédure, une migration risque de publier un fichier privé, d'écraser ce que le public a volontairement changé, ou de laisser le public dériver. Cette spec fixe une procédure reproductible, qui sert de modèle pour toutes les prochaines synchronisations.

## Résultat
Après chaque lot de travaux fusionné dans `main` du privé, une PR « sync » vers `main` du public reporte uniquement ce qui est publiable, avec un contrôle de fuite avant tout push. Rien n'est jamais fusionné ni poussé directement sur `main` d'aucun des deux dépôts.

## Principes
- Source de vérité : `origin/main` du privé, fichiers SUIVIS par git uniquement (`git ls-tree` / `git archive`). Un fichier local non suivi (`.claude/`, `.impeccable/`, `PRODUCT.md`, `DESIGN*`, bilans, `data/`) n'est donc jamais candidat.
- Le public n'est PAS une copie exacte : il porte une « superposition » (voir plus bas) qui doit survivre aux synchronisations.
- En cas de doute sur un fichier : on l'EXCLUT et on le signale dans la PR.
- Le public est la vitrine : lisible par un non-technicien, sans donnée personnelle, sans contenu tiers réel.

## État de départ (déduit le 2026-11-25)
Le public correspond au privé au commit `5e28507` (merge de la PR #44), plus la superposition. Preuve : `git diff --ignore-space-at-eol 5e28507 <public main>` ne montre que les fichiers de la superposition, la suppression de `.gearbox/`, et `.gitignore`. La première synchro (privé `2d56ffa`, PR #46 « wiki Gundam en dernier recours ») reporte donc seulement le delta `5e28507..2d56ffa` : `src/photos/fetch.js`, `src/photos/routes.js`, `src/photos/gundamwiki.js` (nouveau), `tests/photos/photos.test.js`, `tests/photos/gundamwiki.test.js` (nouveau) et la spec `2026-11-25-wiki-gundam-dernier-recours.md` (nouvelle).

Pour les synchros suivantes, la base est le sha court du DERNIER commit du public dont le message contient « (privé xxxxxxx) » (`git log --grep='(privé ' -1`), à défaut `5e28507`.

## Ce qui n'est jamais publié (exclusions)
- `.gearbox/`, `.claude/`, `.impeccable/`, `PRODUCT.md`, `DESIGN*`, tout fichier de configuration d'outil ou de contexte d'agent.
- `docs/engineering/photos-bilan-des-essais.md` (bilan interne, ignoré aussi par le `.gitignore` public) et tout autre bilan, journal ou note de travail.
- `data/`, `node_modules/`, `.node/`, `runs/`, `diagnostics/`, bases SQLite, photos stockées.
- Les fixtures `tests/fixtures/canalbd/*` du privé : ce sont des extraits de pages réelles d'un site tiers (par exemple des liens de section adulte dans `home-menu.html`). Le public a ses propres fixtures SYNTHÉTIQUES, du même nom : on ne les remplace jamais par celles du privé, et `product-page.html` n'existe pas côté public.
- Tout secret, clé, jeton, chemin personnel (`C:\Users\...`), e-mail personnel.
- Tout élément douteux : exclu, signalé dans le corps de la PR.

## Superposition publique (ne jamais écraser)
Fichiers que le public maintient lui-même ou qui portent des lignes propres au public. Un fichier de cette liste n'est JAMAIS copié en entier : on applique à la main le delta privé et on garde les lignes publiques.

| Fichier | Particularité publique |
|---|---|
| `.gitignore` | lignes en plus : `.claude/`, `.impeccable/`, `PRODUCT.md`, `docs/engineering/photos-bilan-des-essais.md`, `.gearbox/` |
| `LICENSE`, `public/fonts/OFL-*.txt` | existent seulement côté public |
| `package.json` | champ `"license": "MIT"` |
| `README.md` | avertissement `HOST`, mention `LICENSE` dans le zip, section « Licence » |
| `.github/workflows/release.yml`, `tests/release/release.test.js` | `LICENSE` dans la liste blanche du zip |
| `src/routes/index.js`, `src/server.js` | `isLoopbackHost` / `hostWarning` (avertissement console), absents du privé |
| `tests/routes/host.test.js` | test de `hostWarning`, absent du privé |
| `tests/fixtures/canalbd/*` | fixtures synthétiques (voir exclusions) |
| `tests/catalogue/{import,parse,prices,title}.test.js` | adaptés aux fixtures synthétiques |
| `docs/engineering/specs/2026-11-22-…`, `2026-11-23-catalogue-…`, `2026-11-24-workflow-release.md`, `2026-11-25-wiki-gundam-dernier-recours.md` | formulations retouchées (plus de mention de pages réelles, du chemin du bilan interne, etc.) |

Tout nouveau retouchage propre au public s'ajoute à ce tableau dans la même PR que la synchro. Si un fichier de la superposition change côté privé, on reporte le delta à la main ; si le retouchage public devient inutile (le privé a adopté la même chose), on le retire du tableau.

## Fins de ligne
Le public contient des fichiers texte en CRLF (instantané pris sur un poste Windows) ; seuls `demarrer.sh` et les workflows `.github/workflows/*.yml` sont en LF, `demarrer.bat` en CRLF (`.gitattributes`). La synchro conserve les fins de ligne du fichier public existant et écrit les NOUVEAUX fichiers en CRLF, avec `core.autocrlf=false` dans le clone. Une différence qui n'est que de fin de ligne n'est jamais un changement à publier (comparer avec `--ignore-space-at-eol`). Uniformiser les fins de ligne du public est un chantier séparé.

## Méthode
Dans un clone neuf, jamais dans le dossier de travail du privé.
1. Privé à jour : `git fetch origin` dans Gunplas ; noter `PRIVE=$(git rev-parse --short origin/main)` ; vérifier que `origin/main` est vert (`npm test` sur ce commit).
2. Clone neuf du public HORS dépôt : `git clone https://github.com/GalactL/Gunpla-collection.git <dossier temporaire>/Gunpla-collection` ; `git config core.autocrlf false` ; `git switch -c sync/AAAA-MM-JJ`.
3. Base : voir « État de départ ». Delta : `git diff --no-renames --name-status BASE origin/main` dans Gunplas.
4. Pour chaque ligne du delta :
   - chemin exclu : ignoré, et noté dans la PR ;
   - chemin de la superposition : delta reporté à la main ;
   - `A` ou `M` : copier le fichier tel qu'il est dans `origin/main` (`git show origin/main:<chemin>`), en gardant la fin de ligne du fichier public (CRLF pour un nouveau fichier texte) ;
   - `D` : supprimer le fichier côté public ;
   - `R` : suppression de l'ancien chemin + ajout du nouveau.
5. Contrôle de cohérence : `git archive origin/main` extrait dans un dossier à part, puis comparaison avec le clone public en ignorant les fins de ligne ; la différence restante doit être EXACTEMENT les exclusions + la superposition (liste ci-dessus). Tout autre écart est une erreur de synchro.
6. Contrôle de fuite sur le diff à publier (`git diff --cached` et la liste des fichiers ajoutés), avant tout push : e-mails (`@[a-z0-9.-]+\.[a-z]{2,}` hors adresses `noreply`), chemins personnels (`C:\\Users`, `/Users/`, `/home/`), jetons et clés (`token`, `secret`, `api[_-]?key`, `password`, `bearer`, `ghp_`, `github_pat`, `sk-`), noms de dossiers privés (`.claude`, `.impeccable`, `.gearbox`, `PRODUCT.md`, `DESIGN`, `photos-bilan`), nom ou identifiant personnel. Chaque résultat est examiné à la main (cette spec cite elle-même ces motifs : ses occurrences sont attendues). Une fuite probable arrête la procédure : rien n'est poussé, on le signale.
7. Vérifications : `npm ci` puis `npm test` dans le clone public (tout vert) ; relire `README.md` si le comportement visible a changé (sources de photos, variables d'environnement, lanceur) et le mettre à jour dans la même PR ; `git status` propre hors changements voulus.
8. Un seul commit : `sync: <résumé> (privé <sha court>)`, par exemple `sync: wiki Gundam en source de dernier recours (privé 2d56ffa)`. Si la synchro regroupe plusieurs chantiers, le résumé les cite. Terminer par la ligne `Co-Authored-By` habituelle.
9. Pousser la branche `sync/AAAA-MM-JJ` (jamais `main`) et ouvrir une PR vers `main` du public. Corps de la PR, en français, lisible par un non-technicien : ce qui change pour l'utilisateur, ce qui n'a pas été publié (exclusions rencontrées), le sha privé de référence, le résultat de `npm test`. La CI du public (`ci.yml`, Linux et Windows) doit être verte avant fusion par le mainteneur.

## Cas de conflit
- Le fichier public a divergé (superposition ou correction faite directement dans le public) : le delta privé s'applique par-dessus, à la main ; la ligne publique gagne si elle est dans le tableau. Sinon, on garde la version privée et on signale l'écrasement dans la PR.
- Un correctif fait seulement dans le public doit être reporté dans le privé (PR dans Gunplas) avant la prochaine synchro, sinon il sera écrasé : on le détecte à l'étape 5 (écart hors liste).
- Le delta touche un fichier exclu ou un fichier de fixtures réelles : on n'y touche pas, on vérifie que les tests publics restent verts avec les fixtures synthétiques, et on adapte les fixtures synthétiques et les tests publics si le comportement testé a changé (ajout au tableau de superposition).
- Doute sur la publication d'un fichier : exclu, signalé.

## Hors périmètre
Publication d'un historique complet, automatisation (script ou workflow de synchro), uniformisation des fins de ligne du public, création de tags ou de Releases (voir la spec du workflow de release), synchronisation du public vers le privé.

## Critères d'acceptation
- [ ] La base de la synchro est déduite du dernier « (privé xxxxxxx) » du public, ou `5e28507` la première fois.
- [ ] Aucun fichier de la liste d'exclusions n'est ajouté ou modifié côté public.
- [ ] Chaque fichier de la superposition garde ses particularités publiques.
- [ ] L'écart restant entre `origin/main` du privé et le public (fins de ligne ignorées) se limite aux exclusions et à la superposition.
- [ ] Le contrôle de fuite (étape 6) est fait, avec son résultat consigné dans le rapport de la PR.
- [ ] `npm test` passe dans le clone public ; la CI de la PR est verte.
- [ ] Un seul commit `sync: <résumé> (privé <sha court>)` sur la branche `sync/AAAA-MM-JJ`, PR vers `main` du public, corps en français.
- [ ] Aucun push direct sur `main`, aucune fusion faite par la procédure.

## Contraintes
Usage personnel et dépôt public : une fuite d'information privée est pire qu'une publication manquante. La procédure s'exécute depuis un clone neuf, hors du dossier de travail du privé. Aucun secret : le push utilise l'authentification Git déjà configurée de l'utilisateur.

## Vérification
Première application le 2026-11-25 : synchro `5e28507..2d56ffa` (PR #46) vers `sync/2026-11-25`. Ce qui n'a pas été vérifié : le rendu de la PR publique sur GitHub et la CI du public avant fusion.
