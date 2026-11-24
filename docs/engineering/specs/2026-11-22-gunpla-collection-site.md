# Site de collection Gunpla

Statut : acceptee. Date : 2026-11-22.

## Pourquoi
Suivre ma collection de maquettes Gunpla (souhaitees, possedees, montees) et parcourir le catalogue d'une librairie reelle, sans tableur ni compte en ligne.

## Résultat
Un site perso, lance en local sur mon PC, avec deux onglets de poids egal : **Catalogue Maquettes** et **Ma collection**. Le catalogue est importe en base locale ; chaque kit a une photo (auto, ou placeholder "Introuvable" remplacable par la mienne) ; j'ajoute un kit depuis le catalogue en choisissant explicitement : « Ajouter à ma wishlist » ou « Ajouter à ma collection ».

## Périmètre
- Catalogue : import de toute la section Maquettes de Canal BD / Manga Dokaze (https://www.canalbd.net/manga-dokaze/, librairie independante lilloise, pas un editeur). Gunpla prioritaire : rayons 1/144, 1/100, 1/60-1/48 (ids 13221, 13222, 13223), toute taille/grade.
- Bouton "Actualiser" qui relance l'import ; le site ne lit jamais Canal BD en direct a l'affichage.
- Parcourir, chercher, filtrer par taille, grade, serie (derives des titres).
- Nettoyage des titres bruts (retrait des codes revendeur type BANMK58880, normalisation grade/echelle).
- Photos recuperees automatiquement par recherche sur le nom nettoye, stockees localement. Upload de ma photo sur tout kit ; remplacement d'une photo auto erronee.
- Collection : une entree = un exemplaire physique.

## Hors périmètre
Mangas (~49k), hebergement en ligne, comptes/auth, multi-utilisateur, suivi de prix/alertes, notifications de stock, sous-etat "en boite".

## Décisions produit
- Statut : exactement un parmi souhaité, possédé, monté.
- Aucun statut par défaut à l'ajout depuis le catalogue : je choisis explicitement. Deux actions : « Ajouter à ma wishlist » (crée un exemplaire au statut souhaité) et « Ajouter à ma collection » (j'ouvre l'éditeur et choisis possédé ou monté, sans présélection ; l'entrée n'est créée qu'une fois un statut choisi).
- Champs d'une entree : statut, notes (texte libre, mes avis), prix payé, date d'achat, lieu d'achat.
- Deux exemplaires du meme kit = deux lignes distinctes, prix/date propres.
- Repli photo : photo auto -> placeholder "Introuvable". La couverture Canal BD n'est pas utilisee en repli.
- Photos pour usage personnel uniquement.
- Supposé (à confirmer) : la suppression d'un exemplaire est permise (« Supprimer l'exemplaire », avec confirmation).
- Supposé (à confirmer) : pas d'action « restaurer la photo auto » en v1.

## Contraintes/invariants
- Local, sans compte ; une seule commande de demarrage documentee.
- Donnees persistantes entre redemarrages ; DB et stockage de fichiers deplacables plus tard (Render : disque gratuit ephemere donc DB persistante necessaire ; scraping depuis IP Render possiblement bloque).
- Import poli : limitation de debit, uniquement au clic sur Actualiser.
- Un changement de statut ne perd jamais les notes.
- Faits observes, a re-verifier au plan : cartes de liste rendues cote serveur (titre, "Paru le", couverture sur le CDN du site source, lien /manga-dokaze/articles/<slug>-<id>/) ; pagination/filtres apparemment en JS, parametre page 2 non confirme ; prix/EAN/stock de la page produit non verifies (une page a donne 404) ; overlay age-gate 18+ ; rayon 1/100 : 124 articles tous "Indisponible" au moment du test ; titres types "BANMK58880 GUNDAM GUNPLA MG 1/100 FAZZ VER.KA" ou "1/100 MG RX-0 UNICORN GUNDAM 02 BANSHEE".

## Scénarios d'acceptation (checkables)
- [ ] Actualiser importe N kits depuis les trois rayons Gunpla et le reste de Maquettes ; N affiche.
- [ ] Relancer Actualiser ne cree pas de doublons.
- [ ] Les titres affiches n'ont plus de code revendeur et ont grade/echelle normalises.
- [ ] Chaque kit montre une photo auto ou le placeholder "Introuvable".
- [ ] J'uploade ma photo sur un kit "Introuvable" ; elle reste apres redemarrage.
- [ ] Je remplace une photo auto par la mienne.
- [ ] Filtre grade MG + echelle 1/100 : seuls les kits correspondants apparaissent ; recherche par serie fonctionne.
- [ ] « Ajouter à ma wishlist » depuis le catalogue crée un exemplaire au statut souhaité.
- [ ] « Ajouter à ma collection » ouvre l'éditeur sans statut présélectionné ; l'exemplaire n'est créé qu'une fois possédé ou monté choisi (fermer sans choisir ne crée rien).
- [ ] Ajouter deux fois le meme kit cree deux lignes avec prix/date independants.
- [ ] Passer souhaité -> possédé conserve les notes.
- [ ] (Supposé) « Supprimer l'exemplaire » demande confirmation, puis retire uniquement cet exemplaire.
- [ ] (Supposé) Aucune action « restaurer la photo auto » n'existe en v1.
- [ ] Les donnees persistent apres redemarrage.
- [ ] L'appli demarre en local avec une seule commande documentee, sans compte.

## Vérification attendue
Tests automatises du nettoyage de titres, du parsing d'import (sur fixtures HTML) et du modele collection ; verification manuelle des scenarios ci-dessus ; un import reel unique pour valider les faits observes.

## Décisions ouvertes
- Design visuel : décidé, voir `docs/design/gunpla-design-contract.md` (accepté 2026-11-22). Direction « Archive technique », un seul design fixe, clair/sombre selon le système.
- Stack technique : a trancher en /plan.
- Source des photos (site/API, licences) : a trancher en /plan.
