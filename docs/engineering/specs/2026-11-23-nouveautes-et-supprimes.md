# Nouveautés et Supprimés du catalogue

## Why
Le catalogue Canal BD évolue : de nouvelles maquettes sortent, d'autres disparaissent du site. L'utilisateur veut repérer les sorties récentes sans les perdre dans le flot, et garder une trace des kits retirés.

## Outcome
Deux catégories dans le catalogue, accessibles comme des filtres de la barre de filtres : **Nouveautés** et **Supprimés**.

### Nouveautés
- Un kit est « nouveau » si sa date de publication Canal BD (`kits.release_date`) est dans les 30 derniers jours (date >= aujourd'hui − 30 jours, sans borne haute : une précommande à date future est nouvelle) ET qu'il n'est pas marqué comme lu. Un kit sans `release_date` n'est jamais nouveau.
- Il sort de Nouveautés de deux façons : automatiquement quand la date dépasse 30 jours, ou quand l'utilisateur le marque « lu » (au choix de celui des deux qui arrive en premier).
- Un kit nouveau reste **visible dans le catalogue général** avec un badge texte « Nouveau » sur sa carte ; la catégorie Nouveautés est un filtre rapide (`?new=1`) avec son compteur.
- « Marquer comme lu » : bouton sur la page du kit (`/kit/:id`) et bouton « Tout marquer comme lu » dans la vue Nouveautés filtrée. Le marquage est persistant (colonne `kits.read_at`, jamais écrasée par l'import), sans effet sur ma collection, et réversible n'est pas requis.
- Marquer comme lu retire le badge « Nouveau » et le kit de la vue Nouveautés immédiatement (sans rechargement de page, focus conservé, message de confirmation).

### Supprimés
- Un kit est « supprimé » quand un import réussi ne l'a plus trouvé sur Canal BD alors que son rayon est dans le périmètre (Gundam / Evangelion). Les kits hors périmètre ne sont jamais « supprimés ».
- Persisté par une colonne `kits.removed` (0/1), positionnée par la règle de masquage existante (`applyScope`) : à 1 si l'import a réussi (`since` connu), rayon dans le périmètre et `imported_at < since` ; remise à 0 par l'upsert quand le kit revient sur le site ; inchangée sans `since` (import en échec/vide/partiel). Migration unique : les kits déjà masqués dont le rayon est dans le périmètre passent à `removed = 1`.
- **Vue à part** : les kits supprimés n'apparaissent PAS dans le catalogue général, ses facettes et son compteur d'en-tête. Le filtre « Supprimés » (`?removed=1`) les liste, avec un badge « Supprimé » sur la carte et une bannière sur la page du kit (« Ce kit n'est plus au catalogue Canal BD. »).
- Un kit supprimé que je possède (au moins un exemplaire) reste dans ma collection (badge « Supprimé » sur sa ligne) et reste visible dans la vue Supprimés ; il n'est pas affiché dans le catalogue général. Les actions d'ajout wishlist/collection restent possibles sur sa page.
- Les relevés de photos et de prix ne changent pas (ils suivent `hidden = 0`).

## Non-goals
Pas de notifications, pas d'historique de lectures, pas de réglage de la durée (30 jours codés), pas de suppression réelle de données, pas de changement du périmètre Gundam/Evangelion.

## Acceptance
1. Un kit publié il y a 10 jours, non lu : badge « Nouveau », présent dans `?new=1` et dans le catalogue général.
2. Un kit publié il y a 31 jours ou sans date : ni badge ni présent dans `?new=1`.
3. Après « Marquer comme lu » : badge et présence dans `?new=1` disparus, persistants après rechargement et après un nouvel import ; un nouvel import ne remet pas `read_at` à NULL.
4. Une précommande à date future est nouvelle.
5. Après un import réussi qui ne contient plus le kit X (rayon dans le périmètre), `removed = 1` : X absent du catalogue général, de ses facettes et du compteur ; présent dans `?removed=1` avec badge ; si X revient dans un import, `removed = 0`.
6. Import en échec/vide : aucun kit ne passe à `removed = 1` et aucun ne revient à 0.
7. Un kit hors périmètre masqué n'est jamais dans `?removed=1`.
8. Un kit supprimé possédé reste listé dans la collection avec badge « Supprimé ».
9. Les filtres `new` et `removed` se combinent avec grade, échelle, franchise, série, recherche ; l'URL les reflète ; le sélecteur « Effacer les filtres » les remet à zéro ; `new` et `removed` ensemble ne sont pas proposés (mutuellement exclusifs côté UI : choisir l'un décoche l'autre).
10. Accessibilité : badges en texte (pas la couleur seule) ; les nouveaux contrôles ont un nom accessible ; contraste conforme à `tests/web/contrast.test.js`.

## Verification
`npm test` (tests node:test existants + nouveaux : fenêtre 30 jours incluant les bornes, read_at préservé par l'import, removed positionné/remis à 0, import en échec, collection, rendu serveur des badges et filtres).
