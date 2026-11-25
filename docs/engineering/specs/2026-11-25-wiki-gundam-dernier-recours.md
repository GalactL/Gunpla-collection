# Wiki Gundam : source de photos de dernier recours

Statut : acceptée. Date : 2026-11-25.

## Pourquoi
107 kits sur 413 restent « Introuvable » (bilan interne, non publié). Le wiki Gundam Fandom (gundam.fandom.com) a été retiré (issue #8) car son CDN répondait 403 depuis le PC de l'utilisateur. L'utilisateur veut le rajouter comme source d'images, en dernier recours.

## Décision (acceptée)
Le wiki est la source de RANG LE PLUS BAS dans `providers` (`src/photos/routes.js`), après Las Cale. Ses images sont des illustrations de mecha, pas des photos de boîte.

## Comportement attendu
- Un kit sans photo, que toutes les boutiques ont refusé, est cherché sur le wiki ; si une page correspond, son image principale est enregistrée.
- Toute photo venant du wiki est « à vérifier » (`uncertain = 1`), car c'est une illustration. Elle n'est enregistrée que si le kit n'a AUCUNE photo, ne remplace jamais une photo de boîte ni un envoi manuel / lien de l'utilisateur, et n'est jamais « sûre ».
- Une photo du wiki est remplaçable par toute source mieux classée (boutiques) lors d'une actualisation. Le cas spécial `LEGACY_WIKI` de `rankOf` (`src/photos/fetch.js`) disparaît : le wiki redevient un provider avec `host: 'gundam.fandom.com'`.
- Règles de correspondance : celles des autres providers (mots du nom nettoyé par `searchName` tous présents dans le titre de la page, aucun mot manquant toléré ; « Gundam Wing » ≠ « Zero Wing »). Le grade n'est pas exigé (le wiki ne parle pas de grades).
- Si le CDN refuse (403) ou la source tombe : jamais d'exception, le disjoncteur existant (`BREAKER`) arrête la source pour le reste du job, les autres sources sont inchangées, aucun contournement de la protection du CDN, débit poli (>= 500 ms entre requêtes, User-Agent existant).
- Les stats par source du job incluent le wiki (nom `gundamwiki`).

## Hors périmètre
Photos de boîte, choix par variante (Ver.Ka, P-Bandai), changement de l'interface (le marquage « à vérifier » existe déjà), contournement de tout blocage.

## Critères d'acceptation
- [ ] Test : kit sans photo + boutiques refusent + wiki trouve → photo enregistrée, `uncertain = 1`.
- [ ] Test : kit avec photo de boutique → jamais remplacé par le wiki.
- [ ] Test : kit avec envoi manuel → intact.
- [ ] Test : « Gundam Wing » ne reçoit pas la page « Zero Wing ».
- [ ] Test : 403 au téléchargement → pas d'exception, le kit reste sans photo, source coupée après 5 échecs de suite.
- [ ] Test : une ancienne photo gundam.fandom.com est remplacée par une photo de boutique.
- [ ] `npm test` passe.

## Contraintes
Usage personnel. Un faux positif est pire qu'une absence, mais il est toléré ici car la photo est toujours marquée « à vérifier » et n'écrase jamais rien.

## Vérification
Tests automatiques avec réponses simulées (aucune requête réseau réelle). Sonde réelle à faire par l'utilisateur via « Actualiser les photos » : si le 403 persiste chez lui, la source est simplement coupée par le disjoncteur et la fonctionnalité reste sans effet.
