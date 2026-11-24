# Catalogue limité à Gundam / Evangelion, prix et lien Canal BD

Statut : acceptée. Date : 2026-11-23. Amende `2026-11-22-gunpla-collection-site.md` (périmètre du catalogue, filtres) ; le spec initial importait toute la section Maquettes.

## Pourquoi
Le catalogue contient 661 kits dont beaucoup n'ont rien à voir avec Gundam (Captain Harlock, Initial D, Pokémon, 30MF/30MM…). L'utilisateur veut ne garder que Gundam et Evangelion, voir un prix pour chaque maquette, et pouvoir ouvrir la fiche Canal BD.

## Résultat
1. Le catalogue et la collection ne montrent que les kits des rayons Canal BD **Gunpla 1/144, Gunpla 1/100, Gunpla 1/60 1/48 et Evangelion** (environ 413 kits). Les autres sont masqués et plus importés.
2. Chaque kit affiche un prix relevé sur Canal BD, ou « Indisponible », avec la date du relevé.
3. Chaque kit a un lien « Voir sur Canal BD ».

## Décisions (utilisateur)
- Règle de périmètre : par rayon Canal BD (Gunpla 1/144, 1/100, 1/60-1/48, Evangelion), pas par franchise.
- Les kits hors périmètre sont **masqués et plus importés**, pas supprimés (réversible).
- Prix affiché : prix neuf de Canal BD ; à défaut, meilleur prix d'un vendeur partenaire, signalé « chez un vendeur » ; à défaut « Indisponible ». Date du relevé affichée.
- Design accepté avant création de l'issue.

## Périmètre
- **Masquage.** Colonne `kits.hidden` (0/1). Un kit est masqué si son rayon n'est pas dans l'ensemble ci-dessus. Un kit qui a au moins un exemplaire dans la collection n'est jamais masqué (hypothèse de sécurité). Migration idempotente (calcul à partir du libellé de rayon déjà stocké dans `kits.shelf`). Le catalogue (`/api/kits`, facettes), la collection, la récupération des photos et l'étape Serper ignorent les kits masqués. Un masqué n'est jamais supprimé ; ses photos et liens restent en base.
- **Import.** `importMaquettes` ne lit plus que les quatre rayons (par identifiant 13221, 13222, 13223, 13224, repli codé comme le repli Gunpla actuel) et marque `hidden` à chaque import ; les rayons exclus ne sont pas demandés.
- **Franchise.** Pour un kit visible : Evangelion si le titre ou le rayon l'est, sinon **Gundam** (les kits « Autre » des rayons Gunpla s'affichent sous Gundam). Le filtre franchise ne propose donc que Gundam et Evangelion. La série reste dérivée du titre (séries Gundam seulement). Migration idempotente.
- **Prix.** Colonnes `kits.price_cents` (entier), `kits.price_source` (`canalbd` | `vendeur` | NULL), `kits.price_state` (`priced` | `unavailable` | NULL = jamais relevé), `kits.price_checked_at`. Nouveau bouton **« Actualiser les prix »** (jamais automatique), tâche de fond comme les photos (`POST /api/prices/refresh`, `GET /api/prices/status`, un seul à la fois, 409 si déjà en cours). Une requête GET par kit visible, au moins 2 secondes d'écart, en-tête `HX-Request: true`, à l'adresse `/manga-dokaze/articles/view/<source_id>/offers/?availability=2&release_date=<release_date>` (date vide : paramètre omis ; à confirmer par le worker avec une fixture). Analyse du fragment : prix de l'offre principale (`meta[itemprop=price]` dans le bloc offre principale) => `canalbd` ; sinon le plus bas prix des cartes vendeur (`.offer-card__price`) => `vendeur` ; sinon, **seulement si** le texte exact « Indisponible dans cette librairie » est présent => `unavailable` ; **toute autre forme** de réponse est une erreur de forme : elle arrête la tâche après cette requête et ne mémorise rien. 403, 429 ou page de défi : arrêt immédiat. Erreur passagère (réseau, 5xx) : rien n'est mémorisé, on continue.
- **Prix affiché** : « 12,90 € » (Canal BD), « 11,50 € · chez un vendeur », ou « Indisponible », suivi de « relevé le jj/mm » ; rien pour un kit jamais relevé. Le « Prix payé » de la collection reste un champ distinct.
- **Lien.** « Voir sur Canal BD » sur chaque carte du catalogue et chaque ligne de collection, ouvert dans un nouvel onglet (`rel="noopener noreferrer"`), seulement si `source_url` est une adresse https de `canalbd.net` ; échappé à l'affichage. La collection doit exposer `source_url`.

## Hors périmètre
Suppression physique des kits ; corriger la classification des engins Gundam ; prix d'occasion ; suivi d'historique de prix ; alertes ; prix par vendeur détaillé ; relevé automatique ou planifié ; appel de l'endpoint POST de prix en lot.

## Contraintes
Débit poli (au moins 2 s), User-Agent `gunpla-personal-importer/1.0`, aucun cookie, aucun POST, jamais de section adulte ; jamais d'exception sur échec réseau ; une page de forme inattendue n'est jamais confondue avec « pas de prix » ; un lien n'est jamais rendu sans validation ; les données existantes (photos, liens, exemplaires) ne sont pas modifiées ; usage personnel.

## Scénarios d'acceptation
- [ ] Après migration, seuls les kits des quatre rayons sont visibles ; les autres existent toujours en base avec `hidden = 1` ; un kit masqué qui a un exemplaire de collection reste visible.
- [ ] Le filtre franchise ne propose que Gundam et Evangelion ; un ancien kit « Autre » d'un rayon Gunpla s'affiche sous Gundam.
- [ ] Un import (simulé) ne demande que les quatre rayons ; relancé, il ne crée pas de doublons et ne démasque pas un kit hors périmètre.
- [ ] La récupération des photos et l'étape Serper n'interrogent pas les kits masqués.
- [ ] Prix : fragment avec prix principal => `canalbd` ; fragment sans prix principal mais avec une carte vendeur => `vendeur` au plus bas prix ; fragment « Indisponible dans cette librairie » sans carte vendeur => `unavailable` ; autre forme (corps vide, `{}`, page d'erreur) => erreur de forme, tâche arrêtée, rien de mémorisé ; 403/429 => arrêt ; une erreur passagère ne mémorise rien et la tâche continue.
- [ ] Un prix relevé reste affiché après redémarrage, avec sa date ; un kit jamais relevé n'affiche pas de prix.
- [ ] Le « Prix payé » de la collection n'est pas modifié par le relevé.
- [ ] Le lien « Voir sur Canal BD » est présent sur carte et ligne de collection, ouvre un nouvel onglet, n'est jamais rendu pour une adresse non https ou hors canalbd.net.
- [ ] Les tests de #6, #8, #10, #12 et #14 passent inchangés (hors le comportement de masquage).

## Vérification attendue
Tests avec fixtures synthétiques (fragments d'offres prix / sans prix / vendeur) et réseau simulé ; test de migration sur une copie privée de la vraie base (661 kits attendus, nombre de visibles recompté, rien de supprimé) ; comparaison avant/après des listes visibles ; rendu serveur du prix et du lien. Le gain réel (part des kits avec un prix) et le comportement du site sur ~413 requêtes ne sont pas mesurés avant livraison. Le code navigateur (bouton, polling) n'a pas de test automatisé.
