# Design contract: Gunpla collection site (rev. 2)

Statut : Accepté 2026-11-22 (direction visuelle validée par l'utilisateur après la maquette).

Authority: accepted spec `docs/engineering/specs/2026-11-22-gunpla-collection-site.md`, plus a user direction: the look draws on the Gundam series. Scope is `surface` and greenfield. UI is French, `lang="fr"`. Comps are not enabled.

**Rule: ideas, not assets.** No logos, official artwork, character or mobile-suit likenesses, emblems or trademarked marks. Series names never appear as fonts, assets or token names. Fonts come from Google Fonts only.

**Invariant (user decision): one fixed visual system.** No per-kit or per-series theming, tint or variant anywhere. Only the user's light/dark system preference (`prefers-color-scheme`) may change the theme.

## Audience, job, mode
- One collector on their own PC, desktop-first, phone-width too.
- Jobs: find a kit and add it (Catalogue), then keep each physical copy up to date (Ma collection).
- Mode **Operate** with gallery character. No hero and no marketing copy. Box art is always the hero.

## What each series language contributes (borrowed principles)
| Source | Borrowed principle | Used for |
|---|---|---|
| 0079 / Universal Century | Mechanical spec sheets (designation, key-value data), orthographic drawings with dimension lines, drawing title blocks | Card spec line, ledger headers, "Introuvable" drawing |
| Federation vs Zeon | Two opposed palette logics: pale armour grey/navy vs deep olive-grey | Light theme vs dark theme |
| Tricolour mobile-suit livery | Three primaries, each with one job | Blue = selection, red = primary action, yellow = activity/caution |
| Manga linework | Thick outer contour, thin inner detail; screentone | Two stroke weights; tone only on placeholders |
| Wing / armour design | Chamfered plate corners | One 45° cut corner on plates and panel |
| Iron-Blooded Orphans | Stencil-painted, utilitarian markings | Plate typography (stencil feel through weight and tracking, not a stencil font) |
| Witch from Mercury | Flat in-world corporate data panels with clear hierarchy, no glow | Editor form and side panel |
| Episode title cards / eyecatches | Large bold type on a flat colour field | Empty states and "Import terminé" only |

## Direction
**A. Archive technique (decided, single direction).** A UC engineering archive: pale "armour" paper, navy ink, drawing title blocks and spec lines, with the tricolour reduced to three functional roles. Federation light and Zeon dark themes. Box art carries the colour; the chrome stays a document.
Token sketch: paper #ECEEF0, ink #16203A, red #C0182B, blue #1F4E9E, yellow #F2B705; display Saira Semi Condensed.

**B. Planche (manga), rejected alternative.** Ink panel frames with heavy gutters, screentone textures, speed-line motion when adding.
Token sketch: paper #FAF8F3, ink #0A0A0A, tone 25% dot, Zen Kaku Gothic New + Bebas-style condensed.
Rejected for three reasons: heavy frames around every card become the card-scaffold slop in another form, the ink frames fight the box art, and the ledger becomes noisy. A keeps only its two-weight linework and its tone (on placeholders only).

## Decided: A, "Archive technique"

### Category rut (still refused)
```yaml
category_rut:
  composition: left sidebar + square cover-cropped cards; collection as cards
  typography: Inter/grotesk; or Orbitron-style "sci-fi" faces
  color_material: generic mecha HUD (cyan glow on black, scanlines, hexagon wallpaper, katakana filler, glass panels)
  containers: rounded cards + shadow; coloured-dot pills
  motion: hover-lift everywhere, fade-ups, glitch effects
```

### Intentional departures
1. **The Gundam reference comes from documents and livery logic, not cockpit glow.** The spec-sheet and title-block conventions structure real data: grade, scale, price, date.
2. **Box art is never cropped.** Each image sits in a 4:3 tray with `object-fit: contain`, because boxes are landscape and carry the grade band.
3. **The tricolour is functional.** Each primary has one role. None of them encodes status or grade on its own.
4. **The collection is a ledger** with tabular figures, laid out like a parts list, not cards.
5. **Filters sit in a horizontal strip**, not a sidebar, which leaves the width to the grid.

### Signature device: "Plaque de désignation"
```yaml
signature_device:
  source_in_product_truth: grade + scale are the core taxonomy derived from cleaned titles ("MG 1/100"), read like a mobile-suit designation
  expression: rectangular plate with one chamfered top-right corner; grade in Saira Semi Condensed 700, 1px divider, scale in tabular figures; 1.5px ink outline. Same plate on cards, ledger rows, panel, and as the filter toggles (pressed = navy fill, white text)
  why_it_earns_attention: one object ties both tabs and the filters together; it carries data, never decoration
```
**Companion, the status gauge:** three chamfered segments (souhaité → possédé → monté), always shown with a text label.
- Souhaité: first segment dashed.
- Possédé: two segments solid ink.
- Monté: three segments, the last one red.

### Macrostructure
- **Header = drawing title block.** Two equal tabs, `Catalogue Maquettes` and `Ma collection`, each with a count. They are `<nav>` links with `aria-current`, and the active one gets a 3px red underline. Right side: `Actualiser` + `Importé le 22/11/2026 · 1 234 kits`.
- **Catalogue strip:** three bands, never sticky.
  - Request: search (`Rechercher un kit ou une série`), then right-aligned count, zoom and sort.
  - Designation: Grade plates, then Échelle plates.
  - Refinement: Franchise, Série, Prix (min – max), then the three checkboxes grouped and right-aligned. The price error sits below, full width.
  - Below 640px: search, then count and zoom, then sort and the `Filtres (n)` button; the panel opens right after it, labels above their controls.
  - Active list or price field: 2px blue border, no fill.
- **Grid:** `auto-fill, minmax(208px,1fr)`, 24px gap.
- **Card anatomy:**
  - Tray (4:3) and plate.
  - Cleaned title (2-line clamp).
  - Spec line in ink-2 (`Série · UC`, set as a key-value pair).
  - **Two explicit add buttons:** `Ajouter à ma wishlist` (secondary, outline) and `Ajouter à ma collection` (primary, red), each with icon + text, as separate tab stops.
  - The title link opens the kit panel.
  - Once collected, a marker shows `Dans ma collection · 2`.
- **Collection:**
  - Status filter: `Tous 37 · Souhaités 7 · Possédés 21 · Montés 9`, plus search.
  - Ledger like a parts list: thumb 56px | plate + title + series | gauge + label | `Prix payé` (right-aligned, `42,90 €`) | `Date d'achat` (`12 mars 2026`) | `Lieu` | notes excerpt.
  - A second copy of the same kit shows `Exemplaire 2`.
  - Column headers are the only small-caps labels. They are real data labels.
- **Side panel (440px, chamfered top-left, 2px outer contour):**
  - **Kit view:** large tray, photo actions, both add buttons, link to the Canal BD article.
  - **Copy editor:** status radiogroup drawn as the gauge, price (comma decimals), date, place (datalist), notes, `Enregistrer`, `Supprimer l'exemplaire`.

### Tokens
- **Type:**
  - Saira Semi Condensed 600/700: tabs, plates, headings.
  - IBM Plex Sans 400/500/600: UI, body, figures. Has `tnum` and full Latin Extended.
  - Test `é è ê à ç ô œ «» É`.
- **Type scale:** 13 / 15 / 18 / 24 / 32. Title-card empty states use 40.
- **Spacing:** 4, 8, 12, 16, 24, 32, 48. Gutter 32px desktop, 16px mobile.
- **Radii:** 0, with chamfers via `clip-path` on plates and the panel only. Focus outlines must not be clipped: draw them on a wrapper.
- **Strokes:** 2px outer contour, 1px inner hairline.
- **Shadow:** on the panel and toast only.

| token | light, Federation (default) | dark, Zeon (`prefers-color-scheme`) |
|---|---|---|
| paper | #ECEEF0 | #161A17 |
| tray | #DCE0E4 | #222823 |
| ink | #16203A | #E4E7E1 |
| ink-2 | #4F5869 | #9DA59C |
| rule | #C3C9D1 | #343B35 |
| red (action, active, monté) | #C0182B | #FF5468 |
| blue (selection, pressed plates) | #1F4E9E | #8FB0E0 |
| yellow (activity/caution fill, ink text) | #F2B705 | #E0A526 |

Contrast estimates (the builder must verify):
- Red on paper about 5.3:1; white on red about 6.2:1.
- Blue on paper about 6.9:1.
- Ink on yellow about 9.8:1.
- Dark ink-2 about 6.9:1; dark red about 5.7:1.
- Yellow never carries text by itself.

### States
- **Introuvable, technical drawing:** the tray shows a line drawing of the box outline (not a robot) with dimension lines and registration marks. The kit's plate sits large inside it, light screentone fills the tray, and the screen shows `Introuvable` plus an always-visible `Ajouter ma photo`.
- **Photo pending:** tray tone + `Recherche de photo…`.
- **Loading:** static skeletons at the final ratio. No shimmer.
- **Empty states, as title cards** (flat navy field, large Saira type):
  - `Le catalogue est vide.` + `Actualiser`.
  - `Aucun exemplaire pour l'instant.` + `Parcourir le catalogue`.
  - Filter miss: `Aucun kit MG en 1/144 pour « banshee ».` + `Effacer les filtres`, kept inline (not a title card).
- **Actualiser:**
  - Running: 4px yellow/ink caution stripe under the header (static under reduced motion), plus live text `Rayon 1/100 · 412 kits lus`. Browsing stays possible and duplicate clicks are ignored.
  - Done: `Import terminé : 1 240 kits (6 nouveaux)`.
  - Error: `Import interrompu : Canal BD ne répond pas. Les 1 234 kits déjà importés restent disponibles.` + `Réessayer`.
- **Add:**
  - `Ajouter à ma wishlist` creates a `souhaité` row immediately. A toast reads `Ajouté à ma wishlist` with `Annuler` only, and the card marker updates.
  - `Ajouter à ma collection` opens the copy editor with the status choice limited to `Possédé` / `Monté`, both unselected (no default status, D11). `Enregistrer` stays disabled until one is chosen. The row is created on `Enregistrer`; closing without choosing creates nothing.
- **Upload:**
  - Native input (`image/jpeg,png,webp`); drag-and-drop is a desktop enhancement.
  - In-tray progress.
  - Caption `Ma photo` vs `Photo auto`.
  - Inline error `Photo non enregistrée : format accepté JPEG, PNG ou WebP.`
  - `Remplacer la photo` on an existing photo.
- **Editor:** a status change keeps notes. A dirty close prompts `Modifications non enregistrées` with `Enregistrer` and `Abandonner`.
- **Delete copy:** confirmation with the caution stripe and the red `Supprimer`.

### Interaction contracts
```yaml
side_panel: {focus: heading on open, Esc/outside: close (guard if dirty), restore: origin element, motion: 200ms slide-from-right; reduced: 120ms crossfade}
actualiser: {single run, latest progress wins, never blocks browsing}
upload: {one in-flight per kit, cancel restores previous image, success announced politely}
filters: {plates = toggle buttons aria-pressed, multi-select per facet, state in URL}
```

### Responsive
- **≥1024:** layout as above.
- **640–1023:** 3 columns. The ledger folds `Lieu` and notes into an expanded row.
- **<640:**
  - The tabs become a two-segment bar.
  - Search stays visible; plates go into a `Filtres (2)` sheet.
  - 2 columns, and the two add buttons stack full-width with their full labels (no truncation).
  - Ledger rows take two lines.
  - The panel becomes a full-screen sheet.
  - No horizontal page scroll, targets ≥44px.

### Motion
- Instant feedback for press and focus.
- Local motion: panel, toast, a 150ms gauge fill, and the caution stripe drifting slowly during an import (the only ambient motion, and it carries the running state).
- No hover-lift, no glitch effects, no scroll entrances. A hovered card darkens its tray one step and underlines its title.

### Accessibility
- 2px blue focus ring, offset 2px.
- Status shown by label + segment count + dash pattern.
- Alt text: `Photo de la boîte : <titre>` / `Photo personnelle : <titre>`. Drawings `alt=""` with visible text.
- Live regions for the import and the toast.
- Labelled fields, comma-decimal prices, errors next to the field.

### First viewport (1280×800)
Title-block header, then the filter strip, then two full rows of 5 cards with the box art whole. The plates read before the titles.

### Verification
- Viewports 1280, 768, 375, in light and dark.
- States: Introuvable, pending photo, import running and error, title-card empty states, editor dirty-close, upload error, delete confirmation.

## Choix de goût : DÉCIDÉS (2026-11-22)
1. **Ambiance :** suivre la préférence système, clair « Fédération » par défaut.
2. **Cadrage photo :** boîte entière (`contain`), pour ne jamais couper le bandeau grade.
3. **Système de couleur :** tricolore fonctionnelle (bleu sélection, rouge action principale, jaune activité).
4. **Police d'affichage :** Saira Semi Condensed.

## Défauts connus de la maquette à corriger dans l'implémentation
La maquette est jetable et n'est pas une base de code ; elle ne sert que de référence visuelle.
- Alignement des cartes stable : réserver un emplacement de hauteur fixe pour la ligne « Dans ma collection · N » afin que les boutons s'alignent d'une carte à l'autre.
- Plateau « Introuvable » : composition plus grande et dégagée ; plaque, libellé et bouton ne doivent pas chevaucher le dessin coté, et les cotes doivent rester lisibles.
- Thème sombre : mesurer puis corriger le contraste du bouton rouge.
- Grille : adapter le nombre de colonnes à la largeur tout en conservant l'alignement.
