# Photos de boîte automatiques et distinction Gundam / autres franchises

Statut : acceptée. Date : 2026-11-23. Amende `2026-11-22-gunpla-collection-site.md` (photos, filtres).

## Pourquoi
1. Les photos automatiques actuelles viennent du wiki Gundam (artwork de mobile suit, jamais la boîte) et, au dernier test, le téléchargement d'image échouait (403 du CDN) : en pratique la plupart des kits restent « Introuvable ».
2. Le filtre « série » mélange des séries Gundam (UC, SEED, Wing…) et d'autres licences (One Piece, Pokémon, Macross…) : impossible de voir ce qui est Gundam ou non.

## Résultat
- Pour chaque kit, « Récupérer les photos » cherche à partir du nom nettoyé une **photo de la boîte ou du kit Bandai** sur Internet et la stocke localement. Le wiki Gundam devient le dernier repli.
- Chaque kit a une **franchise** (Gundam, One Piece, Pokémon, Dragon Ball, Macross, Evangelion, Autre) affichée en badge. Le catalogue se filtre par franchise ; le filtre série ne propose que les séries de la franchise choisie.

## Périmètre
- Nouvelle source d'images orientée maquettes, placée avant le wiki dans la chaîne de providers (`src/photos/provider.js`). Le choix concret de la source (site Bandai, fiches revendeurs…) est tranché au plan par mesure réelle, avec un rapport de taux de réussite (sur un échantillon de kits) dans `tests/photos/HITRATE.md`.
- Correction du téléchargement bloqué (403) pour la ou les sources retenues, sans contourner une protection anti-hotlink : si une source refuse les clients non navigateur, on prend une autre source.
- Franchise dérivée du titre brut/nettoyé (`src/catalogue/title.js`), stockée ou calculée pour tous les kits déjà importés, filtre et badge dans le catalogue et la collection.

## Hors périmètre
Recherche d'images web généraliste (moteur d'images) ; contournement de protections ; changement de la collection (statuts, champs) ; re-design visuel.

## Décisions produit
- Image visée : boîte ou kit Bandai. Un artwork de wiki n'est qu'un repli.
- Une photo que j'ai uploadée n'est jamais écrasée. Une photo auto existante peut être remplacée par une meilleure source lors d'une nouvelle récupération ; un kit sans résultat garde « Introuvable ».
- Assumé (à confirmer) : franchise = Gundam si le titre contient « Gundam » ou une série Gundam reconnue ; franchise externe si un mot-clé connu (One Piece, Pokémon…) ; sinon « Autre ». Le badge n'est jamais vide.
- Assumé (à confirmer) : les séries existantes (UC, SEED, Wing, 00, Zeta…) sont rattachées à Gundam ; One Piece, Pokémon, Dragon Ball, Digimon, Macross, Evangelion deviennent des franchises, plus des « séries ».

## Contraintes/invariants
- Usage personnel uniquement ; débit poli (limitation de requêtes) ; jamais de lecture distante à l'affichage.
- Échec de source ou téléchargement : jamais d'exception, repli sur la source suivante puis « Introuvable ».
- Un faux positif coûte plus qu'une absence : un hit n'est accepté que si le titre de page/produit correspond au nom (contrôle strict existant conservé).
- Les données et photos existantes restent valides après migration.

## Scénarios d'acceptation
- [ ] Après « Récupérer les photos », une part mesurée de l'échantillon de kits a une photo de boîte/kit (taux consigné dans `tests/photos/HITRATE.md`, mesuré depuis une vraie machine).
- [ ] Source de boîte en échec ou 403 : le kit prend le wiki, puis « Introuvable », sans erreur.
- [ ] Une photo uploadée par moi reste après une nouvelle récupération.
- [ ] Un kit One Piece / Pokémon montre le badge de sa franchise, pas « Gundam ».
- [ ] Filtre franchise = Gundam : aucun kit non-Gundam n'apparaît ; le filtre série ne liste que des séries Gundam.
- [ ] Un kit sans mot-clé reconnu apparaît sous « Autre », jamais sans franchise.
- [ ] Les kits déjà en base reçoivent leur franchise sans réimport obligatoire.

## Vérification attendue
Tests unitaires (franchise sur titres réels, chaîne de providers avec réponses simulées dont 403, non-écrasement d'une photo uploadée) ; mesure réelle du taux de réussite ; vérification manuelle des filtres.
