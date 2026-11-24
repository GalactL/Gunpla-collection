# Mémoire de la position du catalogue

Statut : acceptée. Date : 2026-11-24.

## Pourquoi
Depuis le catalogue, ouvrir un kit puis revenir fait perdre la position : le lien « ← Catalogue Maquettes » ramène à `/` sans filtres, et le bouton retour du navigateur ne ré-affiche que la première page du serveur. Après plusieurs « Charger plus », il faut tout refaire.

## Résultat
Revenir d'une fiche kit au catalogue (lien « ← Catalogue Maquettes » ou bouton retour) restitue les mêmes filtres, le même nombre de kits affichés et la même position de défilement.

## Comportement actuel (vérifié)
- Les cartes du catalogue pointent vers `/kit/:id` (`public/render.js`, ~156).
- La fiche est une page distincte rendue par le serveur ; son fil d'Ariane est `<a href="/">← Catalogue Maquettes</a>` (`public/render.js`, ~357) : filtres et position sont perdus.
- La liste est paginée côté client (« Charger plus », `[data-act=more]`, limite 50, `load(append)` dans `public/app.js`).
- Les filtres sont écrits dans l'URL par `history.replaceState` dans `load()` (`public/app.js`, ~198) : un retour navigateur ne rend que la première page du serveur. Le navigateur ne peut pas restaurer le défilement au-delà de la page 1.

## Dans le périmètre
- En quittant le catalogue vers une fiche, sauvegarder dans `sessionStorage`, clé = URL du catalogue (chemin + query) : le nombre de kits affichés et `window.scrollY`.
- Au retour, par le lien « ← Catalogue Maquettes » ou par le bouton retour (y compris bfcache / `pageshow`) : recharger ce nombre de kits (en une ou quelques requêtes, borné par un maximum raisonnable, ex. 500), puis défiler à la position sauvegardée. Les filtres reviennent par l'URL comme aujourd'hui.
- Le lien « ← Catalogue Maquettes » se comporte comme un retour arrière quand l'utilisateur vient du catalogue (entrée d'historique de même origine) ; sinon (lien direct, nouvel onglet) il va à `/` normalement.
- L'état sauvegardé est supprimé à tout changement manuel de filtre, tri ou recherche (une nouvelle liste démarre en haut). Un état périmé ou invalide est ignoré sans erreur.
- Logique extraite dans une petite fonction pure autant que possible, testable unitairement.

## Hors périmètre
- Mémoire entre sessions ou onglets du navigateur.
- Page « Ma collection » (ses lignes ne mènent pas aux fiches).
- Défilement infini.
- Changement serveur (aucun attendu).

## Critères d'acceptation
- [ ] (a) Défiler, charger plus, ouvrir un kit, cliquer le fil d'Ariane : mêmes filtres, même nombre de kits, même position.
- [ ] (b) Idem avec le bouton retour du navigateur.
- [ ] (c) Après un changement de filtre, la liste démarre en haut.
- [ ] (d) Ouvrir directement une fiche puis cliquer le lien : catalogue en haut, sans erreur.
- [ ] (e) Comportement réduit sans `sessionStorage` : pas de plantage.
- [ ] (f) Les 285+ tests existants passent ; la logique pure est couverte par des tests.
- [ ] Contrôle dans un Chromium headless à 375 et 1280 px.

## Contraintes
Aucune dépendance ajoutée. Pas de changement serveur. Texte de l'interface en français.

## Vérification
Tests `node:test` de la fonction pure (sauvegarde, validation, borne, état périmé), suite complète via `npm test`. Contrôle manuel des scénarios (a) à (e) dans un navigateur Chromium headless à 375 et 1280 px.
