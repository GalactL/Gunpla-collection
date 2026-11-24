# Photos : repli par lien (recherche d'images) et requête HLJ assouplie

Statut : acceptée. Date : 2026-11-23. Prolonge `2026-11-23-photos-correspondance-souple.md` (PR #13) et `2026-11-23-photos-boite-et-franchises.md`.

## Pourquoi
Sur le catalogue réel, 281 kits avec grade et 279 kits sans grade restent sans photo. Un diagnostic (26 kits rejoués sur HLJ) montre que « no search result » vient surtout d'une **requête trop précise** (HLJ exige tous les mots : un code comme « AMX-004-3 » ou « XXXG-01W », un suffixe, « Graham'S », « (Gq) » font tomber de dizaines de résultats à zéro) et, pour une minorité, de produits que HLJ ne vend pas. L'utilisateur veut plus de photos, quitte à les marquer « à vérifier », et préfère un lien affiché plutôt qu'une image téléchargée.

## Résultat
1. **HLJ assoupli** : quand la recherche HLJ ne renvoie aucun produit, une seconde requête sans codes ni suffixes est tentée ; tout résultat obtenu ainsi est marqué « à vérifier ».
2. **Repli par lien** : pour un kit encore sans photo, une recherche d'images (Serper.dev) donne le premier résultat ; son lien et sa miniature sont enregistrés (rien n'est téléchargé) et affichés par le navigateur, marqués « à vérifier ».

## Décisions (utilisateur)
- Source : Serper.dev, premier résultat, marqué « à vérifier ». Brave exclu (interdit de stocker les résultats).
- Périmètre : tous les kits sans photo, avec ou sans grade.
- La requête HLJ assouplie est dans la même issue.
- Usage personnel uniquement ; les conditions de Serper sur le stockage des liens ne sont pas lues (risque accepté par l'utilisateur).

## Requête HLJ assouplie
- Déclenchée **seulement** si la première requête (nom nettoyé, comme aujourd'hui) renvoie **zéro produit** ; une réponse avec des produits qui ne correspondent pas ne déclenche rien.
- Requête assouplie = le nom nettoyé privé de : jetons modèle contenant un chiffre et un tiret ou lettres+chiffres (« XXXG-01W », « AMX-004-3 », « MS-09R »), jetons de version (« Ver. », « 2.0 »), apostrophe-S et « S » isolé issus d'une apostrophe, groupes entre parenthèses (« (Gq) », « ( ) »), barres obliques. Si moins de 2 mots restent : pas de seconde requête.
- Les mots exigés par le comparateur pour ce passage sont ceux de la requête assouplie ; **le grade reste obligatoire**, le code produit et l'image https `hlj.com` aussi, et les règles de départage restent (sûre préférée, égalité entre deux fiches = refus).
- Tout résultat du passage assoupli est **toujours** « à vérifier » (jamais sûr), et le journal le dit (raison « requête assouplie », mots retirés).
- Au plus une requête supplémentaire par kit et par récupération ; débit 1 500 ms conservé.

## Repli par lien
- Pour chaque kit encore sans photo locale après HLJ (strict puis assoupli) et sans entrée de recherche d'images : une requête Serper avec le nom nettoyé, plus le grade et « gunpla » pour un kit Gundam, plus la franchise pour un autre (hypothèse d'ingénierie). Premier résultat dont le lien est en https ; on garde le lien et la miniature (https aussi) et la page source.
- **Au plus une requête par kit** : un résultat vide est mémorisé (pas de nouvelle requête aux récupérations suivantes). Une erreur passagère (réseau, 5xx) ne mémorise rien. Une erreur de clé ou de quota (401, 403, 429) **arrête** l'étape pour la récupération en cours et le dit dans le journal.
- Clé : variable d'environnement `SERPER_API_KEY`, lue côté serveur uniquement ; jamais dans le code, les journaux, les réponses d'API ni le navigateur. Sans clé, l'étape est ignorée (une ligne de journal) et rien n'est mémorisé.
- Plafond de requêtes Serper par récupération : 300 (hypothèse d'ingénierie, pour borner le quota).
- Données : nouvelle table `image_links` (kit, lien, miniature, page source, indicateur « à vérifier », date de recherche ; lien vide = cherché sans résultat), migration idempotente ; la table `photos` ne change pas.
- Affichage : l'image est chargée directement par le navigateur (`loading="lazy"`, sans transmettre la provenance) ; en cas d'échec, la miniature ; en cas de nouvel échec, le cadre « Introuvable » actuel. Le serveur ne télécharge jamais ces liens.
- Priorité : une photo locale (HLJ ou upload) passe toujours avant un lien. Un upload supprime le lien. Une photo HLJ, sûre ou douteuse, remplace un lien. Un lien ne remplace jamais une photo locale.
- Le badge « À vérifier », le filtre et le bouton « Photo vérifiée » s'appliquent aussi aux liens ; « Photo vérifiée » retire la marque et garde le lien.
- Les kits qui ont un lien restent éligibles à HLJ à chaque récupération (comme une photo douteuse).

## Hors périmètre
Télécharger ou copier localement l'image d'un lien ; plusieurs candidats au choix ; Brave et autres API ; contourner un CAPTCHA ; corriger la franchise des engins Gundam sans le mot « Gundam » ; photos déjà fausses (à remplacer par upload) ; kits que HLJ et la recherche d'images ne trouvent pas.

## Contraintes
Usage personnel ; liens et miniatures en https seulement, longueur bornée, échappés à l'affichage ; aucune requête du serveur vers l'hôte d'une image ; photo uploadée jamais touchée ; jamais d'exception sur échec de source ; la clé n'apparaît nulle part ; `kits.title` inchangé.

## Scénarios d'acceptation
- [ ] HLJ renvoie zéro produit pour « Qubeley Mk-Ii » avec code puis un produit pour la requête assouplie (grade OK) : photo enregistrée « à vérifier », journal « requête assouplie ».
- [ ] Une fiche du passage assoupli au mauvais grade est refusée ; une égalité entre deux fiches est refusée.
- [ ] Une requête HLJ qui renvoie des produits non correspondants ne déclenche pas la seconde requête.
- [ ] Moins de 2 mots après nettoyage : pas de seconde requête.
- [ ] Kit sans photo après HLJ : un lien Serper (simulé) est enregistré, marqué « à vérifier », et la carte l'affiche par lien avec la miniature en repli.
- [ ] Une seule requête Serper par kit : une récupération suivante ne réinterroge pas, y compris après un résultat vide.
- [ ] 401/403/429 : l'étape s'arrête, rien n'est mémorisé pour les kits non traités, message dans le journal ; sans clé : étape ignorée.
- [ ] Un lien http, trop long ou invalide est rejeté ; la clé n'apparaît ni dans les journaux ni dans les réponses d'API.
- [ ] Un upload supprime le lien ; une photo HLJ remplace le lien ; un lien ne remplace jamais une photo locale.
- [ ] Badge, filtre et « Photo vérifiée » fonctionnent pour un lien ; la miniature est utilisée si l'image échoue.
- [ ] Migration idempotente, photos existantes et `kits.title` intacts.
- [ ] Les tests de #6, #8, #10, #12 passent inchangés.

## Vérification attendue
Tests avec HLJ et Serper simulés, en partant de vraies lignes `kits` issues de `cleanTitle` (leçon de #6) ; comparaison sans réseau, sur les 661 titres réels, des requêtes avant/après (leçon de #10) ; test de migration sur une copie de la base ; rendu serveur du badge/filtre/lien. Le gain réel n'est pas mesuré avant livraison : il se lit sur `job done` et le filtre « à vérifier » après une récupération sur le PC de l'utilisateur ; le comportement navigateur (chargement du lien, repli miniature, bouton) n'a pas de test automatisé.
