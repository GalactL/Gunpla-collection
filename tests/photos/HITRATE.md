# Taux de réussite réel du provider Gundam Wiki (Fandom)

Mesure du 2026-11-22, API réelle `https://gundam.fandom.com/api.php` (generator=search, prop=pageimages|info, top 3), via `gundamWikiProvider` et `searchName` du code livré, 1 requête/s, User-Agent `gunpla-personal-photos/1.0`. Script jetable, non versionné.

## Résultat brut

- 28 noms de kits (MG/RG/HG/PG, noms courants et quelques moins courants), requête = nom nettoyé sans grade ni échelle.
- **Recherche : 28/28 avec une page et une miniature.** Aucun « introuvable ».
- **Téléchargement de l'image : 0/28. Le CDN `static.wikia.nocookie.net` répond 403 (HTML)** à `fetch` avec notre User-Agent, et aussi à curl avec ou sans User-Agent, y compris un `Mozilla/5.0` (un seul essai de diagnostic ; je n'ai pas poussé plus loin pour ne pas contourner une protection anti-hotlink). Donc, dans l'environnement de test, la chaîne complète ne produit aucune photo. Cause non établie : blocage de l'IP de l'environnement, ou politique du CDN contre les clients non navigateur. Non testé depuis le PC de l'utilisateur : à vérifier avec un vrai « Récupérer les photos » avant de s'y fier.

## Ce qui revient (d'après le titre de page et les miniatures vues dans les réponses API)

Ce sont des **illustrations de mobile suit / artworks de la fiche wiki** (lineart ou rendu officiel du personnage-machine), **jamais des photos de boîte ou de maquette montée**. Le visuel ne ressemble donc pas à la boîte Bandai.

Je n'ai pas pu ouvrir les images (403), le jugement de correspondance repose sur la page wiki retournée :

| Nom cherché | Page wiki retournée | Correspondance |
|---|---|---|
| MG Exia | GN-001 Gundam Exia | oui |
| RG Zaku II | MS-06 Zaku II | oui (générique) |
| HG Gundam Aerial | XVX-016 Gundam Aerial | oui |
| PG Unicorn Gundam | RX-0 Unicorn Gundam | oui (la forme affichée peut différer) |
| MG FAZZ Ver.Ka | FA-010A FAZZ | oui (pas de distinction Ver.Ka) |
| MG Wing Gundam Zero EW | XXXG-00W0 Wing Gundam Zero EW | oui |
| HG Barbatos | ASW-G-08 Gundam Barbatos | oui (forme non distinguée) |
| RG RX-78-2 Gundam | RX-78-02 Gundam | plausible : c'est la version The Origin, pas le RX-78-2 classique |
| MG Strike Freedom | ZGMF-X20A Strike Freedom Gundam | oui |
| HG Gundam Calibarn | X-EX01 Gundam Calibarn | oui |
| MG RX-0 Unicorn 02 Banshee | RX-0 Unicorn Gundam 02 Banshee | oui |
| RG Sazabi | MSN-04 Sazabi | oui |
| HG Char's Zaku II | MS-06S Char's Zaku II | oui |
| MG Sinanju | MSN-06S Sinanju | oui |
| PG Perfect Strike | GAT-X105+AQM/E-YM1 Perfect Strike Gundam | oui |
| HG Barbatos Lupus Rex | ASW-G-08 Gundam Barbatos Lupus Rex | oui |
| **RG Nu Gundam** | **RX-93-ν2 Hi-ν Gundam** | **non : mauvais engin (Nu au lieu de Hi-Nu)** |
| MG Astray Red Frame | MBF-P02 Gundam Astray Red Frame | oui |
| HG Wing Gundam | XXXG-01W Wing Gundam | oui |
| MG Zeta Gundam Ver.2.0 | MSZ-006 Zeta Gundam | oui |
| HG Gundam Lfrith | XGF-02 Gundam Lfrith | oui |
| MG Gundam Epyon | OZ-13MS Gundam Epyon | oui |
| RG Strike Freedom | ZGMF-X20A Strike Freedom Gundam | oui |
| HG Destiny Gundam | ZGMF-X42S Destiny Gundam | oui |
| MG Gouf Custom | MS-07B-3 Gouf Custom | oui |
| HG Kshatriya | NZ-666 Kshatriya | oui |
| MG Hi-Nu Gundam Ver.Ka | RX-93-ν2 Hi-ν Gundam | oui |
| HG Gundam Schwarzette | MDX-0003 Gundam Schwarzette | oui |

Bilan : bon engin dans 26/28, variante discutable dans 1 (RX-78-02 Origin), mauvais engin dans 1 (Nu).

## Lecture honnête

- Le biais est réel : j'ai choisi des kits connus, présents dans le wiki. Le catalogue Canal BD contiendra des kits obscurs, des lots, des accessoires, des « Clear Color » : la recherche floue renvoie presque toujours une page, donc **le risque principal est le faux positif, pas l'absence de résultat**. Je n'ai pas mesuré ce taux de faux positifs sur des noms hors wiki.
- Les variantes (Ver.Ka, Revive, Clear, P-Bandai, Lupus vs Lupus Rex) ne sont pas distinguées : on obtient l'engin, pas le kit.
- Le repli « Introuvable » + upload utilisateur reste indispensable ; le remplacement d'une photo auto erronée l'est aussi.
- Licence : images de wiki Fandom, usage personnel uniquement (cohérent avec la spec).
- Volume de requêtes : 31 vers l'API (28 mesure + 3 sondes initiales), plus 32 vers le CDN d'images (28 téléchargements + 4 diagnostics).

## Addendum : contrôle du titre de page

Après revue, le provider refuse tout hit dont le titre de page ne contient pas, en mot entier (le trait d union fait partie du mot), un token significatif du nom nettoyé. Les deux écarts ci-dessus (RG Nu Gundam -> Hi-Nu, variante RX-78-02) ne sont pas re-mesurés sur l API réelle : Nu -> Hi-Nu est désormais refusé (donc "Introuvable"), RX-78-2 -> RX-78-02 reste accepté (zéros de tête normalisés). Seuls des tests avec résultats simulés couvrent ce contrôle.

# Source « boîte » (issue #6) : HobbyLink Japan, mesure du 2026-11-23

Objectif : une photo de boîte Bandai placée AVANT le wiki dans la chaîne (`hljProvider`, puis `gundamWikiProvider` en dernier repli).

## Sondes (une requête chacune, User-Agent `gunpla-personal-photos/1.0`, depuis l'environnement de test)

| Source | Résultat | Décision |
|---|---|---|
| bandai-hobby.net (recherche) | 200 mais page « 404 NOT FOUND » : pas de recherche serveur, rendu JS | écarté |
| 1999.co.jp (Hobby Search) | 403 | écarté (refuse les clients non navigateur, non contourné) |
| amiami.com | 403 | écarté (idem) |
| gundam.info | 301 sans contenu exploitable | écarté |
| p-bandai.com | 200, boutique, pas de recherche exploitée | non retenu |
| **hlj.com (HobbyLink Japan)** | **200**, `robots.txt` : `allow: /` (hors `/account/`), HTML de recherche rendu côté serveur, miniatures de boîte 1200x900 téléchargeables (200, JPEG) sans en-tête particulier | **retenu** |

Photos obtenues : vraies boîtes Bandai (ex. HGUC Sinanju, vérifiée à l'œil). Aucun contournement d'anti-hotlink : pas de Referer ni de User-Agent navigateur.

## Correction : la première mesure ci-dessous (16/34, v1) était invalide pour le code livré

Le provider lisait le grade dans le titre du kit (« MG 1/100 Sinanju »), mais en vrai `cleanTitle` retire grade et échelle de `kits.title` et range le grade dans `kits.grade` : le provider recevait « Sinanju », ne voyait aucun grade, et **ne trouvait aucun kit gradé** (le repli wiki faisait tout). Mes tests appelaient `find('Sinanju', 'MG 1/100 Sinanju')` directement et ne l'ont pas vu ; la sonde v1 non plus (grade écrit dans le titre fourni). Corrigé : `fetchPhotoForKit` lit `kits.grade` et le passe au provider (`find(name, grade)`) ; un test passe par `cleanTitle` et une vraie base.

Choix pour un grade null ou non géré (`RE`, `MGSD`...) : **aucune requête HLJ, on ne devine pas** (un nom de fiche sans grade est ambigu entre HG/MG/RG).

## Mesure réelle du code livré, chemin réel (v2, 2026-11-23) : `cleanTitle(raw)` -> `searchName(title)` + `grade` -> `hljProvider` -> téléchargement

- Échantillon : les mêmes **34 titres** bruts de catalogue, en majuscules comme chez le revendeur (« MG 1/100 EXIA », 2 avec préfixe code « BANMK... GUNDAM GUNPLA ») : 28 kits courants MG/RG/HG/PG, 3 plus obscurs (Gusion Rebake, Jegan, Marchosias), 1 « Clear Color ... Limited », 2 accessoires (sans grade). 1 requête toutes les 1,5 s.
- **Résultat v2 : 16/34 avec une boîte, 16/16 téléchargées (200, JPEG valide, 27 à 175 Ko). 18 « introuvable »** (repli wiki). Les 16 hits sont les mêmes fiches que dans la v1 (la v1 simulait un grade correct ; la v2 prouve que le chemin réel le donne). Les 2 accessoires (grade null) et le « Clear Color » sont refusés.
- Les 16 hits, relus un par un d'après l'URL de la fiche : bon kit, bon grade (ex. « MG Sinanju », « RG Sazabi », « PG Perfect Strike »). Écarts mineurs : `HG Destiny Gundam` -> `HGCE Destiny Gundam` (même famille HG) ; `HG Kshatriya` -> `HGUC NZ-666 Kshatriya`.
- **Faux positifs observés : 0 sur 16 hits.** Mais c'est un échantillon de 34 choisi à la main, mesuré depuis l'IP de ce bac à sable : pas une garantie, et pas mesuré sur le vrai catalogue Canal BD.

## Pourquoi 18 refus (choix délibéré : un refus vaut mieux qu'une mauvaise boîte)

Règle : grade identique (HG = HGUC/HGCE/...), tous les mots du nom du kit présents sur la fiche, mots en plus tolérés seulement s'ils contiennent un chiffre (code engin) ou sont `gundam/ver/ka/the`, code produit Bandai (`BAN...`) dans l'URL. Refusés par cette règle, entre autres : « RG Zaku II » (la fiche porte « Char's »/« MS-06S »), « MG Gundam Epyon » (fiche « Epyon EW Ver. »), « HG Gundam Lfrith » (fiche avec « (Mobile Suit Gundam: The Witch from Mercury) »), « MG Hi-Nu Ver.Ka » (aucune fiche au bon grade). Assouplir les parenthèses ferait monter le taux mais ouvre les faux positifs de variante : non fait.

## Limites et non mesuré

- Dépend du HTML de recherche de hlj.com (sélecteurs `.search-widget-block`, `.product-item-name a`) : une refonte du site le casse sans erreur (le provider rend `null`, le repli wiki prend le relais). Non surveillé.
- Source revendeur : photos soumises à droits d'auteur du site ; usage personnel uniquement. Je n'ai pas lu les conditions d'utilisation du site : à vérifier avant tout usage au-delà de l'usage personnel. Volume : 1 requête de recherche + 1 image par kit, au plus 1 requête/1,5 s.
- La mesure ci-dessus vient de **cet environnement** (IP de sandbox). Le 403 observé plus haut sur le CDN du wiki (`static.wikia.nocookie.net`) n'a PAS été re-testé ici : le repli wiki reste donc probablement sans image. **Un vrai « Récupérer les photos » depuis le PC de l'utilisateur reste à faire** (taux réel sur le catalogue, comportement du CDN HLJ depuis son IP).
- Pas de mesure sur un catalogue complet (lots, éditions P-Bandai, Clear, Ver.Ka non nommées) : le taux de 16/34 vient d'un échantillon choisi à la main et sera plus bas sur des noms atypiques.
- Test automatisé : fetch simulé uniquement (403 -> repli wiki, tout échoue -> introuvable sans exception, upload jamais écrasé, mauvais grade/variante/autre kit refusés). La sonde réelle ci-dessus est un script jetable non versionné.

## Note (issue #8)

Le provider Gundam Wiki a été retiré de la chaîne par défaut : son CDN d'images a répondu 403 sur le PC de l'utilisateur. HLJ est la seule source ; les refus HLJ sont désormais comptés par raison dans le statut du job. Aucun nouveau taux de réussite n'est mesuré ici.

## Note (issue #10) : numéros de catalogue retirés de la recherche HLJ

Changement : `searchName` applique d'abord `stripCatalogueNumbers` (fetch.js). Retiré : un groupe entre parenthèses de 1 à 4 chiffres (« Qubeley Papillon (011) ») et un jeton de tête de 1 à 3 chiffres suivi d'au moins un mot (« 013 Exia Dark Matter »). Conservé : les valeurs zéro de tête (« 00 Raiser », « 0 Gundam »), « Gundam 00 », « Type 00 », un titre qui deviendrait vide. Le comparateur n'est pas modifié : il reçoit déjà le nom nettoyé et ignorait déjà les mots purement numériques ; seule la requête HLJ contenait le numéro. `kits.title` reste inchangé.

Correction (cycle 1) : la comparaison sans réseau des anciennes et nouvelles requêtes sur les 661 titres réels du catalogue (lecture seule) a montré que « 30 Minutes ... » et « 30 Mm ... » (lignes 30MM/30MF/30MS) perdaient leur « 30 » : exception ajoutée, 16 kits protégés. Requêtes modifiées : 225 -> 212 (60 numéros de tête, 152 numéros entre parenthèses), toutes relues ; aucun autre nom ne perd de nombre faisant partie du nom.

Mesure de l'issue #10 (pas refaite ici) : sur un échantillon de 18 kits refusés avec numéro de catalogue, choisis à la main, un test avec le provider livré (numéro retiré avant la recherche) en retrouve 9 sur 18. Verdict lu sur le slug de l'URL produit HLJ, pas sur le texte de la page. Les 9 autres restent refusés pour d'autres raisons (hors périmètre).

À mesurer : le taux réel sur le catalogue de l'utilisateur (relancer « Récupérer les photos », lire le nom dans la page produit des nouvelles photos, compter les faux positifs). Aucun nouveau taux n'est établi ici ; les tests automatisés utilisent un HLJ simulé.

## Note (issue #12) : correspondance sûre / douteuse, mots d'une lettre

Deux niveaux dans `hljProvider.find` (grade toujours obligatoire, mêmes garde-fous https + `hlj.com` + code produit Bandai) :

- **Sûre** : règles précédentes (tous les mots du kit présents, aucun mot en trop hors `gundam/ver/ka/the` et mots à chiffre). Enregistrée comme avant.
- **Douteuse** : même grade, tous les mots du kit présents en mots entiers, mais des mots en trop hors de cette liste (variante, série, couleur). Parmi les douteuses, la fiche qui a le moins de mots en trop ; égalité entre deux fiches différentes = refus (raison `ambiguous`). Une sûre l'emporte toujours. La photo est enregistrée avec `uncertain = 1`, ne remplace jamais une photo existante, et peut être remplacée par une correspondance sûre à la récupération suivante. Journal : une ligne par photo douteuse (fiche + mots en trop), `stats[source].uncertain` dans `job done`.
- **Mots d'une lettre** (« V » de « V Gundam », « Z », « X », lettres issues de `(G)`, `[T]`, `G.L.R.S.S.`) : obligatoires comme mots entiers, y compris pour la sûre. Ils étaient ignorés, ce qui avait donné « 1.5 Gundam » à « V Gundam ».

Comparaison sans réseau sur les 661 titres réels (base ouverte en lecture seule) : la requête HLJ (`searchName`) est inchangée ; les mots exigés passent de 2508 à 2583 (+75) sur 62 kits, dont 36 avec grade. Toutes les lignes relues, voir le rapport de la tâche.

Aucun taux de réussite ni taux de photos douteuses n'est mesuré ici : le gain réel se lira sur la ligne `job done` (`uncertain`) et sur le filtre « à vérifier » après une récupération sur le PC de l'utilisateur. Les tests utilisent un HLJ simulé.

## Note (issue #14) : requête HLJ assouplie

HLJ exige que TOUS les mots de la requête correspondent : un code modèle (« XXXG-01W », « AMX-004-3 »), une version (« Ver. 2.0 »), « Graham'S », un reste « ( ) » transforment des résultats en zéro. Quand la requête stricte renvoie **zéro produit** (pas : des produits qui ne correspondent pas), `hljProvider.find` envoie **une seule** requête de plus (`relaxName`) : le nom nettoyé sans jetons à chiffre ET tiret, sans « Ver. »/« 2.0 », sans apostrophe-S, sans groupes entre parenthèses, barres obliques remplacées par une espace. Pas de seconde requête si rien n'est retiré (même requête) ou s'il reste moins de 2 mots exigés. Au passage assoupli, les mots exigés sont ceux de la requête assouplie ; grade, code produit, image https `hlj.com` et règle d'égalité restent.

Tout résultat de ce passage est **toujours « à vérifier »** (`uncertain = 1`, jamais sûr, jamais en remplacement d'une photo existante) ; journal `uncertain (relaxed query; dropped: ...; <fiche>; extra: ...)`, décompte `stats['hlj-box'].relaxed`.

Aucun taux de réussite n'est mesuré ici (tests avec HLJ simulé). Sans réseau, sur les 661 titres réels (lecture seule) : 381 kits ont un grade, 96 auraient une requête assouplie (si la requête stricte renvoie zéro produit). Le gain réel se lira sur `job done` (`relaxed`) et le filtre « à vérifier ».

Limites connues, toutes couvertes par le marquage « à vérifier » : le retrait peut enlever un mot d'identité (version « Ver. 2.0 » d'un MG, code qui distingue des variantes « MS-06F/S Zaku II », « (Unicorn Ver.) », « (Renewal Edition) », « UNIT-01 »).
