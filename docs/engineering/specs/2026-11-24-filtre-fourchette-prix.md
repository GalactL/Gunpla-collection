# Filtre du catalogue par fourchette de prix

Statut : acceptée. Date : 2026-11-24.

## Pourquoi
Le catalogue affiche un prix par kit, mais on ne peut pas restreindre la liste à un budget. Besoin exprimé : « Rajoute une option pour choisir la range de prix à afficher dans les filtres ». Aucun filtre de prix n'existe aujourd'hui.

## Résultat
Le panneau de filtres du catalogue propose deux champs, « Prix min (€) » et « Prix max (€) ». La liste, le total et la pagination ne montrent que les kits dont le prix catalogue est dans la fourchette.

## Dans le périmètre
- Deux champs de saisie libre, virgule ou point acceptés (réutiliser `parsePrice` de `public/render.js`). Un seul champ rempli = borne ouverte. Bornes inclusives.
- Filtre sur `kits.price_cents` (prix catalogue), jamais sur le prix payé des exemplaires.
- Kits sans prix (`price_cents` NULL : non relevé ou indisponible) masqués dès qu'une borne est active. Sans borne, comportement inchangé.
- API : paramètres `price_min` et `price_max` sur `GET /api/kits`, en centimes entiers ≥ 0. Valeur invalide ou min > max : HTTP 400 « Paramètre « … » invalide » (style d'`intParam`, `src/catalogue/routes.js`).
- Routes web (`src/web/routes.js`) : mêmes paramètres relayés et ajoutés à la liste `FILTERS`, pour une URL partageable.
- Compatible avec les autres filtres, le tri et la pagination, `total` inclus.
- UI (`public/render.js`, `public/app.js`) : saisie invalide ou min > max = message d'erreur inline accessible (`aria-invalid` + `aria-describedby`, comme `#ed-price-err`), sans requête. Le filtre actif compte pour 1 dans le badge « Filtres (n) », est remis à zéro par « Réinitialiser » et apparaît dans le message de liste vide (ex. « entre 20 et 80 € »).

## Hors périmètre
Curseur double, tranches prédéfinies, filtre dans la vue Collection, facette de prix ou bornes min/max calculées, tri par prix côté catalogue, changement du relevé de prix.

## Critères d'acceptation
Jeu : kits à 25 €, 60 €, 120 € et un sans prix.
- [ ] `price_min=3000` retourne 60 € et 120 €.
- [ ] `price_max=6000` retourne 25 € et 60 € (60 inclus).
- [ ] `price_min=3000&price_max=10000` retourne 60 €.
- [ ] Le kit sans prix n'est jamais retourné quand une borne est active, et l'est sans borne.
- [ ] `price_min` > `price_max`, valeur négative, décimale ou non numérique : 400.
- [ ] Combiné avec `grade`, `total` et pagination restent cohérents.
- [ ] Le panneau rend les deux champs ; saisie invalide ou min > max : erreur inline accessible, aucune requête.
- [ ] Filtre actif : +1 dans « Filtres (n) », mentionné dans le message de liste vide ; « Réinitialiser » l'efface.
- [ ] Une URL web portant `price_min`/`price_max` applique le filtre.

## Contraintes
Aucune dépendance ajoutée. Réutiliser `parsePrice` et le style d'erreur existants. Pas de changement de schéma. Texte de l'interface en français.

## Vérification
Tests `node:test` : API dans `tests/catalogue/routes.test.js`, routes web dans `tests/web/`, rendu du panneau (champs, badge, message vide, erreur inline). Suite complète via `npm test`.
