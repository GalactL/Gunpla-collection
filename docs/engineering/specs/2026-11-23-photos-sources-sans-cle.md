# Photos : sources sans clé (Gundam Planet), mise à jour automatique et bouton de recherche

Statut : acceptée. Date : 2026-11-23. Remplace l'étape Serper de `2026-11-23-photos-par-lien-et-requete-assouplie.md` ; prolonge `2026-11-23-photos-correspondance-souple.md` et `2026-11-23-photos-boite-et-franchises.md`.

## Pourquoi
HLJ ne trouve que ~30 % des kits tentés (job `done` : 122 trouvées, 92 « no search result », 135 « no candidate matches », 59 « grade missing/unsupported », 5 ambiguës). Serper (clé API) est abandonné : l'ami de l'utilisateur doit pouvoir héberger sa propre copie sans saisir de clé. Les couvertures Canal BD (`cover_url`) sont toutes des placeholders : inutilisables. Sondage de sources (12 kits réels) :
- Hobby Search et AmiAmi : 403 Cloudflare, non contourné (exclus) ; Gundam Express injoignable ; bandai-hobby.net inutilisable (recherche sans JS = 404, titres japonais).
- **Gundam Planet : 7/12 sans blocage** ; USA Gundam Store : 4-5/12 (grade moins fiable). Les deux sont des boutiques Shopify à JSON simple, 12 requêtes à 0 ms d'écart et 3 en parallèle sans 429 (échantillon court : un test en volume manque).

## Résultat
1. Suppression de l'étape Serper ; sources de photos dans l'ordre : HLJ (existant), Gundam Planet, puis USA Gundam Store en repli.
2. Mise à jour automatique (catalogue, prix, photos) à l'ouverture si la dernière date de plus de 7 jours.
3. Kits retirés de la source catalogue masqués, jamais supprimés.
4. Kits restants sans photo : cadre « Introuvable » avec bouton « Chercher une photo ».
5. Section README « Installer chez un ami » : copie hébergée par l'ami, base vide, `npm start`, sans clé ni compte.

## Décisions (utilisateur)
- **Serper retiré** : code, variable `SERPER_API_KEY`, mentions README, plafond de 300 requêtes. La table `image_links` et les liens déjà enregistrés restent affichés (aucune perte) ; migration idempotente.
- **Ordre des sources** : HLJ (photo stockée), Gundam Planet, USA Gundam Store en repli ; première correspondance sûre retenue. Mêmes règles qu'aujourd'hui : grade obligatoire, mots du nom obligatoires, https et hôtes autorisés (`cdn.shopify.com`, `hlj.com`), égalité ambiguë = refus, résultats moins sûrs marqués « à vérifier ».
- **Vitesse** : 2 à 3 requêtes en parallèle, 300 ms entre deux requêtes d'un même site, nouvel essai sur 429, disjoncteur après erreurs répétées ; sites interrogés indépendamment. Les kits déjà traités ne sont pas retentés, sauf si une source mieux classée existe.
- **Mise à jour automatique** : à l'ouverture, si la dernière mise à jour date de plus de 7 jours (hypothèse), enchaîner import du catalogue, prix, puis photos, en tâche de fond ; indicateur « mise à jour en cours » ; site utilisable pendant ce temps ; jamais deux jobs en parallèle ; un échec réseau ne bloque rien ; boutons « Actualiser » conservés.
- **Kits retirés** de la source catalogue : masqués, jamais supprimés (la photo est conservée) ; visibles s'ils sont dans la collection ; démasqués s'ils reviennent.
- **Kits sans photo** : cadre « Introuvable » cliquable avec bouton « Chercher une photo » (libellé en hypothèse) qui ouvre la recherche d'images du kit dans un nouvel onglet, sans API ; l'upload existant reste.
- **Partage** : l'ami héberge sa copie ; base vide, `npm start` suffit, aucune clé, aucun compte, aucun fichier public.
- **Couverture attendue** : estimation prudente 60-70 % (HLJ + Gundam Planet) ; aucun 100 % promis.
- Hypothèse d'ingénierie, à trancher à la planification : photo Shopify stockée localement comme HLJ, ou gardée en lien ; préférer le stockage local si cela reste simple.

## Règles
- Gundam Planet : `https://www.gundamplanet.com/search/suggest.json?q=<GRADE nom nettoyé>&resources[type]=product&resources[limit]=10` ; image = `resources.results.products[i].image` (hôte `cdn.shopify.com`). USA Gundam Store : même schéma Shopify.
- Nettoyage de la requête : retirer le numéro initial (« 201 »), les groupes entre parenthèses (« (13) ») et « & ». Pour EG, écrire « Entry Grade » (« EG Strike » ne donne rien de pertinent, « Entry Grade Strike » oui).
- Filtre de grade : les familles HGUC, HGCE, HGAW, HGBF, HGIBO valent HG. Exclure les titres correspondant à `/decal|robot spirits|metal build|option/i`.
- Réutiliser `kitWords` et `gradeOf` de `src/photos/provider.js` pour comparer grade et mots. Le premier résultat n'est pas toujours le bon ; un kit absent du catalogue renvoie des produits proches mais faux (Ingressa Milita donne Nightingale) : le filtre de mots obligatoire est indispensable.
- L'image retournée est le premier visuel produit (souvent un packshot) ; on ne peut pas vérifier automatiquement que c'est une boîte.
- Une photo locale (upload ou HLJ) passe toujours avant un lien ; un lien existant ne remplace jamais une photo locale.

## Hors périmètre
Génération d'images ; Serper, Brave et autres API à clé ; contournement de Cloudflare ou de captcha ; scraping de moteurs d'images ; accès distant ; comptes ; synchronisation de collections ; couvertures Canal BD.

## Contraintes
Usage personnel ; débit poli ; jamais d'exception sur échec de source ; photo uploadée jamais écrasée ; « Photo vérifiée » jamais écrasée ; `kits.title` inchangé ; droits d'usage des photos non évalués (risque accepté par l'utilisateur) ; aucune clé ni secret nulle part.

## Scénarios d'acceptation
- [ ] Un kit refusé par HLJ est trouvé via Gundam Planet (source simulée) et sa photo est enregistrée.
- [ ] Un résultat au mauvais grade est refusé.
- [ ] Un kit voisin faux (ex. Ingressa Milita) est refusé par le filtre de mots.
- [ ] USA Gundam Store sert de repli quand HLJ et Gundam Planet échouent.
- [ ] Sur 429 : nouvel essai, puis disjoncteur après erreurs répétées, sans exception.
- [ ] Plus aucune référence à `SERPER_API_KEY` ; les liens existants de `image_links` restent affichés.
- [ ] Une photo uploadée et une « Photo vérifiée » ne sont jamais écrasées.
- [ ] Mise à jour automatique à l'ouverture si plus de 7 jours : une seule à la fois, indicateur visible, échec réseau toléré.
- [ ] Un kit retiré de la source est masqué sauf s'il est dans la collection, et démasqué à son retour.
- [ ] Un kit sans photo affiche le bouton « Chercher une photo » (nouvel onglet, sans API) et l'upload reste possible.
- [ ] Migration idempotente, photos existantes et `kits.title` intacts.
- [ ] Les tests existants de #6, #8, #10, #12 et #16 passent inchangés.

## Vérification attendue
Tests avec sources simulées, en partant de vraies lignes `kits` issues de `cleanTitle` (leçon de #6) ; comparaison sans réseau, sur les 661 titres réels, des requêtes générées ; test de migration sur une copie de la base. Le gain réel n'est pas mesuré avant livraison : il se lit sur `job done` après une récupération sur le PC de l'utilisateur ; le comportement navigateur (bouton, indicateur) n'a pas de test automatisé.
