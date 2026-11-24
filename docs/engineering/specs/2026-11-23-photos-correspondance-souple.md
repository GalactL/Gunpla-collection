# Photos : correspondance plus souple avec marqueur « à vérifier »

Statut : acceptée. Date : 2026-11-23. Prolonge `2026-11-23-photos-boite-et-franchises.md` (issues #6, #8, #10).

## Pourquoi
Sur le catalogue réel (661 kits), 95 photos HLJ ont été trouvées pour 382 kits avec grade (environ 25 %). 287 kits avec grade n'ont pas de photo. Le comparateur strict (aucun mot en trop dans la fiche HLJ) laisse de côté des kits dont la fiche est la bonne mais porte un mot de variante, de série ou de couleur. L'utilisateur accepte de gagner de la couverture au prix d'un peu de risque, à condition que les cas douteux soient repérables.

## Résultat
- Une correspondance **sûre** (règles actuelles) enregistre la photo comme aujourd'hui.
- Une correspondance **douteuse** enregistre quand même la photo, **marquée « à vérifier »**.
- Le site montre ce marqueur, permet de filtrer ces kits et de confirmer la photo.

## Décisions produit (utilisateur)
- Assouplir automatiquement, sans mesure préalable sur HLJ.
- Les cas vraiment douteux sont **acceptés avec le marqueur « à vérifier »** (et non refusés).
- Le grade reste obligatoire pour une correspondance **sûre** (famille HG/HGUC/… comme aujourd'hui). Cas sans grade : voir « Assouplissement (suite, issue à créer) ».

## Règles de correspondance
- **Sûre** : règles actuelles de `hljProvider` (grade, tous les mots distinctifs présents, mots en trop limités à la liste actuelle, code produit Bandai, https + `hlj.com`).
- **Douteuse** : grade correct, tous les mots du kit (après nettoyage des numéros de catalogue) présents comme mots entiers dans le nom de la fiche, mais la fiche contient des mots en plus hors liste actuelle (variante, série, couleur…). Parmi les candidats douteux, on retient celui qui a le moins de mots en trop ; s'il y a égalité entre deux fiches différentes, **refus** (aucune photo).
- Une correspondance sûre l'emporte toujours sur une douteuse.
- **Mots d'une seule lettre** (ex. « V » de « V Gundam », « Z ») : ils deviennent obligatoires, comme mots entiers, dans la fiche, y compris pour la correspondance sûre. Cela corrige un faux positif observé (« 165 V Gundam » a reçu la fiche « 1.5 Gundam »). C'est un resserrement, pas un assouplissement.
- Autres assouplissements : voir « Assouplissement (suite, issue à créer) » (règle partagée `rate` de `provider.js`).

## Assouplissement (suite, issue à créer) (HLJ et boutiques Shopify)
Toujours « à vérifier », jamais « sûr » sans grade concordant ; mêmes garde-fous (https, hôtes autorisés, image valide, jamais de remplacement d'une photo existante).
- **Un mot du kit manquant** : toléré si le nom du kit compte au moins 3 mots comparables, si le grade concorde, et si le mot manquant a 3 lettres ou plus sans être un chiffre romain (« Zaku I » ne prend pas « Zaku II »). Kit de 2 mots avec un mot manquant : refusé (« V Gundam » / « 1.5 Gundam », « Ingressa Milita » / « Nightingale »).
- **Classement des douteux** : d'abord le moins de mots du kit manquants, puis le moins de mots en trop ; égalité entre deux pages différentes = refus (ambigu). Une sûre l'emporte toujours.
- **Grade absent** : si le kit n'a pas de grade reconnu, ou si le titre de la fiche n'en porte pas, tous les mots du kit doivent être présents et le nom compter au moins 2 mots comparables. Un grade explicite différent, ou écrit ailleurs qu'en tête du titre, reste refusé. Un kit sans grade et d'un seul mot n'est pas cherché.
- **Boutiques, zéro produit** : une 2e requête avec le nom assoupli (`relaxName`), au plus une de plus par kit et par boutique ; résultat toujours « à vérifier », marqué relaxed/dropped comme HLJ.
- **Journal** : la ligne « uncertain » ajoute « mot manquant : x » et/ou « grade absent » ; la requête assouplie reste signalée par « relaxed query ».

## Données et affichage
- Les photos portent un indicateur « à vérifier » (colonne ajoutée à la table des photos, migration idempotente, sans perte ; les photos existantes ne sont pas marquées).
- Badge « À vérifier » sur la carte du catalogue et dans la collection ; filtre pour n'afficher que ces kits ; action « Photo vérifiée » qui retire la marque ; l'upload de l'utilisateur remplace la photo et efface la marque.
- Supposé (réversible, interface) : libellés exacts « À vérifier », « Photo vérifiée », « Photos à vérifier » ; le badge réutilise le style `.tag` existant.

## Récupération et remplacement
- Une photo uploadée n'est jamais touchée. Une photo auto **vérifiée** (marque retirée) n'est jamais changée.
- Une photo auto non marquée garde la règle actuelle de rang (remplacée seulement par une source mieux classée).
- Une photo « à vérifier » peut être remplacée par une correspondance **sûre** à la récupération suivante. Une correspondance douteuse ne remplace jamais une photo existante, quelle qu'elle soit.
- Les kits qui ont déjà une photo sûre ne sont pas réinterrogés.

## Journal et statut du job
- Une ligne par photo douteuse enregistrée : kit, fiche HLJ retenue (slug) et mots en trop. Une ligne `refused` avec la raison pour les égalités ambiguës.
- Le décompte final `job done` ajoute `uncertain` (photos douteuses enregistrées) aux décomptes existants, par source.

## Hors périmètre
Les photos déjà erronées (kits 96, 47/154, 160/206 : à remplacer par upload) ; le classement de franchise des engins Gundam sans le mot « Gundam » (autre issue) ; toute IA ; toute autre source ; la suppression ou re-évaluation automatique de photos existantes.

## Contraintes
Usage personnel, débit poli (1500 ms conservé), jamais d'exception sur échec de source, https + hôte `hlj.com`, photo uploadée jamais écrasée, le grade vient de `kits.grade`, `kits.title` inchangé.

## Scénarios d'acceptation
- [ ] Un kit HG « Gundam Aerial » face à une seule fiche HG « Gundam Aerial Permet Score Six » (mots en trop hors liste) donne une photo enregistrée marquée « à vérifier ».
- [ ] Deux fiches douteuses différentes à égalité de mots en trop : aucune photo, ligne `refused` dans le journal.
- [ ] Une correspondance sûre et une douteuse présentes ensemble : la sûre est choisie, non marquée.
- [ ] « V Gundam » ne reçoit plus la fiche « 1.5 Gundam » ; une fiche « V Gundam » réelle est toujours trouvée.
- [ ] Un mauvais grade reste refusé même avec tous les mots présents.
- [ ] Badge « À vérifier » visible sur la carte et dans la collection ; le filtre ne montre que ces kits ; « Photo vérifiée » retire la marque et la photo n'est plus jamais changée.
- [ ] L'upload de l'utilisateur remplace une photo marquée, efface la marque et n'est jamais écrasé ensuite.
- [ ] Une photo douteuse ne remplace pas une photo existante ; une sûre remplace une photo « à vérifier ».
- [ ] La migration est idempotente et conserve les photos existantes, non marquées.
- [ ] Le journal contient une ligne par photo douteuse et `job done` affiche `uncertain`.
- [ ] Les tests de faux positifs de #6/#10 restent en place ; trois assertions ont été adaptées aux nouvelles règles (grade absent ou un mot manquant) sans affaiblir les refus de faux positifs.
- [ ] Un mot manquant, kit d'au moins 3 mots : « à vérifier ».
- [ ] Kit de 2 mots avec un mot manquant : refus.
- [ ] Grade absent, tous les mots présents : « à vérifier ».
- [ ] Grade explicite différent : refus.
- [ ] Zéro résultat en boutique : requête assouplie, « à vérifier ».
- [ ] Égalité ambiguë : refus.
- [ ] V Gundam, Ingressa Milita, Zaku I-II toujours refusés.

## Vérification attendue
Tests avec HLJ simulé en passant par de vraies lignes `kits` issues de `cleanTitle` (leçon de #6), test de migration sur une base ancienne, tests de rendu du badge/filtre ; comparaison sans réseau des requêtes sur les 661 titres réels (leçon de #10). Le gain réel et le taux de photos douteuses ne sont pas mesurés avant livraison : ils se lisent sur la ligne `job done` et sur le filtre « à vérifier » après une récupération sur le PC de l'utilisateur.
