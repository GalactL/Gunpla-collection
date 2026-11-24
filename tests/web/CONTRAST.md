# Contraste des tokens (mesuré)

Calcul WCAG 2.x (luminance relative), fait par `tests/web/contrast.test.js` sur les tokens lus dans `public/app.css` ; le test échoue si une paire passe sous son seuil. Seuils : 4,5:1 pour le texte, 3:1 pour les éléments non textuels (anneau de focus, soulignement d'onglet actif, segment « monté »).

| Paire (texte / fond) | Clair (Fédération) | Sombre (Zeon) | Usage |
|---|---|---|---|
| ink / paper | 13,87 | 14,08 | texte courant |
| ink / tray | 12,16 | 12,05 | texte dans le plateau photo |
| ink / card | 14,91 | 13,24 | plaques, champs |
| ink-2 / paper | 6,16 | 6,95 | textes secondaires, en-têtes du registre |
| ink-2 / tray | 5,40 | 5,94 | cotes « ? mm » du dessin Introuvable |
| ink-2 / card | 6,62 | 6,53 | texte des placeholders (`::placeholder` en ink-2, opacité 1) |
| red / paper | 5,30 | 5,63 | erreurs, « Supprimer l'exemplaire » |
| red / card | 5,70 | 5,29 | erreurs dans le bloc de confirmation |
| on-red / red | 6,16 (#FFFFFF) | 5,63 (#161A17) | **bouton rouge principal** |
| blue / paper | 6,83 | 7,92 | « Dans ma collection · N », filtre de statut actif, focus |
| on-blue / blue | 7,95 | 7,92 | plaques de filtre pressées |
| on-yellow / yellow | 8,87 | 8,02 | bande de prudence (aucun texte sur le jaune) |
| on-field / field | 13,87 | 10,91 | cartes-titres des états vides |
| paper / ink | 13,87 | 14,08 | toast |
| blue / tray (non-texte) | 5,99 | 6,77 | focus sur le plateau |
| red / tray (non-texte) | 4,65 | 4,81 | segment « monté » |

## Défauts corrigés

- **Bouton rouge en sombre** : du texte blanc sur `#FF5468` ne donne que 3,12:1. Le texte du bouton prend donc le papier sombre `#161A17` (5,63:1). Le token rouge du contrat est conservé.
- **Bande de prudence en sombre** : `ink` (clair en thème sombre) sur jaune donne 1,76:1, et la bande devenait illisible. Un token `--on-yellow` (`#16203A` en clair, `#161A17` en sombre) donne 8,87 et 8,02.
- **Placeholders** : le gris par défaut du navigateur (`#757575`) ne donne que 4,26 sur `card` en clair et 3,59 en sombre. La règle `::placeholder{color:var(--ink-2);opacity:1}` donne 6,62 et 6,53 (vérifié par le test).
- Les filets `rule` (1,43 en clair, 1,53 en sombre) restent décoratifs. Ils ne portent aucune information : les bordures des champs et des boutons utilisent `ink`.
