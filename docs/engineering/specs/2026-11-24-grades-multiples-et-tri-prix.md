# Grades multiples et tri par prix dans le catalogue

Statut : acceptée. Date : 2026-11-24.

## Pourquoi
Dans la barre de filtres du catalogue, les plaques de grade sont exclusives : impossible de voir HG et RG ensemble. Le menu « Tri » ne propose que récents, titre A→Z et titre Z→A, alors que chaque kit porte un prix catalogue.

## Résultat
Dans la barre de filtres, on peut sélectionner plusieurs grades à la fois (ex. HG + RG). Le menu « Tri » gagne deux options : prix croissant et prix décroissant.

## Comportement actuel (vérifié)
- Plaques `.pbtn[data-facet=grade][aria-pressed]` exclusives (`public/render.js`, `public/app.js`).
- `GET /api/kits` (`src/catalogue/routes.js`) et l'URL web (`FILTERS` dans `src/web/routes.js`) acceptent un seul `grade`.
- Menu de tri : récents / titre A→Z / titre Z→A (`SORTS` dans `public/render.js` et `src/catalogue/routes.js`).
- `kits.price_cents` existe, NULL si le prix est inconnu.

## Dans le périmètre
- `grade` accepte plusieurs valeurs séparées par des virgules (`grade=HG,RG`), sur `/api/kits` et sur l'URL de la page web. `grade=HG` seul fonctionne comme avant.
- Sémantique : OU entre les grades choisis (le kit correspond à l'un d'eux), ET avec les autres filtres. Éléments inconnus ou vides : ignorés ou rejetés de façon cohérente avec la validation existante (au choix de l'implémentation). Requête SQL avec placeholders, aucune concaténation de valeurs.
- Un clic sur une plaque de grade la bascule indépendamment des autres. L'URL partageable reflète la sélection.
- Badge « Filtres (n) » : un point par grade sélectionné (HG + RG = 2), les autres filtres comptent comme aujourd'hui.
- Message de liste vide adapté à plusieurs grades (ex. « Aucun kit HG, RG … »). « Réinitialiser » efface tous les grades.
- Tri : `price_asc` (« prix croissant ») et `price_desc` (« prix décroissant »), libellés dans le menu comme les autres (« Tri : prix croissant »). Les kits sans prix (NULL) sont toujours en dernier, dans les deux sens. Égalités départagées par id pour une pagination stable. Tri invalide : 400 comme aujourd'hui. Tri par défaut inchangé (récents) et `sort=recent` reste absent de l'URL.

## Hors périmètre
- Sélection multiple pour l'échelle, la franchise ou la série (l'échelle reste à choix unique ; le point du backlog #5 sur l'échelle demeure).
- Tris de la page « Ma collection » (tri côté client propre).
- Masquer les kits sans prix.

## Critères d'acceptation
- [ ] `/api/kits?grade=HG,RG` ne retourne que des kits HG et RG, `total` correct.
- [ ] `/api/kits?grade=HG` inchangé.
- [ ] La page web `/?grade=HG,RG` montre les deux plaques pressées et un badge à 2.
- [ ] Basculer les plaques met l'URL à jour.
- [ ] `price_asc` et `price_desc` ordonnent correctement les kits avec prix, les kits sans prix en dernier dans les deux cas, pagination stable.
- [ ] Un tri invalide renvoie toujours 400.
- [ ] Les 281 tests existants passent toujours ; de nouveaux tests couvrent chaque point ci-dessus.
- [ ] Rendu de la barre de filtres à 320 / 375 / 640 / 1024 / 1280 px, thèmes clair et sombre : inchangé, hormis les deux plaques pressables ensemble et les nouvelles options de tri.

## Contraintes
Aucune dépendance ajoutée. Pas de changement de schéma. Requêtes paramétrées uniquement. Texte de l'interface en français.

## Vérification
Tests `node:test` : API dans `tests/catalogue/routes.test.js`, routes web dans `tests/web/`, rendu de la barre (plaques, badge, message vide, options de tri). Suite complète via `npm test`. Contrôle visuel aux cinq largeurs, clair et sombre.
