# Barre de navigation : « Mise à jour » à gauche des boutons

Statut : acceptée. Date : 2026-11-24.

## Pourquoi
Dans l'en-tête, la phrase d'état (« Mise à jour en cours… », « Importé le … · n kits », « Catalogue jamais importé ») est affichée après les boutons Catalogue, Photos et Prix. Décision : elle se lit avant eux, à leur gauche, dans le même bloc.

## Résultat
Dans le bloc de synchronisation de l'en-tête, la phrase d'état précède les trois boutons : état, puis Catalogue | Photos | Prix. Textes, identifiants et comportement sont inchangés.

## Comportement actuel (vérifié)
- `shell()` dans `src/web/routes.js`, `header.tb` : `<nav class="tabs">` (Catalogue Maquettes, Ma collection), puis `<div class="sync">` contenant `<div class="sbar" role="group" aria-label="Actualiser">` avec `#act-import` « Catalogue », `#act-photos` « Photos », `#act-prices` « Prix », puis `<p id="sync-status" role="status">`.
- CSS dans `public/app.css` : grille `.tb`, `.sync`, `.sbar`, `.sb`, règles mobiles à 320, 375 et 640 px.

## Dans le périmètre
- Déplacer `#sync-status` avant `.sbar` dans `.sync` (ordre du DOM : état, puis boutons), même id, même `role="status"`, même texte.
- Adapter le CSS de `.sync` / `.sbar` pour l'ordre et l'alignement ; la phrase peut passer à la ligne ou être tronquée proprement sur écran étroit.
- Ordre de lecture logique pour les lecteurs d'écran (l'ordre visuel suit l'ordre du DOM, pas de `order` CSS qui les dissocie).
- Test sur l'ordre du balisage du shell.

## Hors périmètre
- Renommer les boutons, nouveau libellé, changement du comportement de mise à jour.
- Modification des onglets (`nav.tabs`).

## Critères d'acceptation
- [ ] Ordre du DOM : `#sync-status` avant les boutons ; identifiants inchangés ; le JS qui met la phrase à jour fonctionne toujours.
- [ ] Rendu vérifié à 320, 375, 640, 1024 et 1280 px, en clair et en sombre : pas de défilement horizontal, pas de texte coupé de façon illisible.
- [ ] Boutons toujours des cibles tactiles d'au moins 40 px de haut.
- [ ] Les onglets sont inchangés.
- [ ] Un test couvre l'ordre du balisage ; les tests existants passent.

## Contraintes
Aucune dépendance ajoutée. Texte de l'interface en français. Pas de changement serveur hors le gabarit du shell.

## Vérification
`npm test` ; contrôle dans un Chromium headless aux cinq largeurs, thème clair et sombre, pendant et hors mise à jour.
