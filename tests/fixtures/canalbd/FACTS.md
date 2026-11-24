# Structure des pages lues par l'importeur

Les fichiers de ce dossier sont des fixtures synthétiques : du HTML écrit à la main qui reprend uniquement la structure dont dépendent `src/catalogue/parse.js` et `src/catalogue/prices.js`. Ils ne contiennent aucun extrait de page réelle ; seuls les titres de kits (des noms de produits) et quelques identifiants servent d'exemples.

## Menu (`home-menu.html`)

- Un bloc `li.submenu-lvl1-item` dont le bouton `.has-submenu` s'intitule « Maquettes » liste les rayons : des liens `…/recherche/catalogue/?shelf=<id numérique>`.
- Un autre bloc du menu contient deux liens factices vers des sections réservées. Le test d'import vérifie qu'ils ne sont jamais demandés : l'importeur ne lit que le bloc « Maquettes ».

## Liste d'un rayon (`shelf-*.html`)

- Une carte par article : `article.card-book`, avec un lien `/manga-dokaze/articles/<slug>-<id>/` (l'id numérique est le `source_id`), un `h3` contenant `span.title` (série) et/ou `span.subtitle` (nom de l'article), et la date « Paru le » dans `.on-sale strong` (`jj/mm/aa`).
- Une carte sans titre existe parfois : elle est ignorée (`shelf-13221-last.html`).
- Pagination : `nav.pagination a.icon-right[data-value]` donne la page suivante ; absent sur la dernière page (paramètre `page`).
- Le prix et le stock ne sont pas dans la liste (`div.product-cell-price` vide).

## Offres d'un article (`offers-*.html`)

Fragment HTML chargé à part, lu par `parseOffers` :

- prix principal : `.product-offers .product-offer-price`, avec `meta[itemprop="price"]` et `.product-offer-price-value` ;
- sinon, prix des cartes vendeur : `.offer-card .offer-card__price` (le plus bas gagne) ;
- sinon, le texte exact « Indisponible dans cette librairie » dans `.product-unavailable`.

## Non vérifié

La stabilité de ces structures dans le temps : le parseur dépend des classes `card-book`, `pagination`, `submenu-lvl1-item`, `product-offer-price` et `offer-card__price`.
