# InputMemory

Visualiseur d'inputs clavier / souris / manette, avec overlay pour les jeux.

## Lancer

```powershell
npm install
npm start
```

## V1
- **Live** : clavier complet (AZERTY/QWERTY), souris, manette (Xbox/PS), touches allumées en temps réel.
- **Historique** : chaque input avec sa durée d'appui et l'écart depuis le précédent (ms ou frames), appuis simultanés regroupés, filtres par appareil, pause.
- **Overlay** : fenêtre transparente toujours au premier plan, widgets au choix, taille/opacité/disposition réglables.

## V2 : enregistrements
- Bouton **● Enregistrer** (ou Ctrl+Maj+R, même en jeu) : capture tout avec un horodatage précis ; un badge REC apparaît sur l'overlay.
- Onglet **Enregistrements** : liste des sessions (renommer, exporter/importer en JSON, mettre à la corbeille).
- **Timeline** : une piste par input, barres = durée d'appui ; Ctrl+molette pour zoomer, Maj+molette pour défiler, clic pour se placer.
- **Rejeu** : clavier/souris/manette et historique rejoués à la vitesse voulue (×0.1 à ×2), frame par frame avec ←/→.
- **Statistiques** : inputs/minute, écart moyen, inputs les plus utilisés et maintien moyen.
- Sessions stockées dans `%APPDATA%/inputmemory/recordings`.

## Raccourcis globaux
| Raccourci | Action |
|---|---|
| Ctrl+Maj+O | Afficher / masquer l'overlay |
| Ctrl+Maj+L | Verrouiller (clics traversants) / déverrouiller (déplaçable) |
| Ctrl+Maj+⌫ | Effacer l'historique |
| Ctrl+Maj+R | Démarrer / arrêter un enregistrement |

## Notes
- L'overlay passe par-dessus les jeux en fenêtré ou plein écran sans bordure, pas en plein écran exclusif.
- La manette apparaît après un premier appui sur un bouton (règle de l'API Gamepad).
- Debug : `IM_SNAPSHOT=<dossier>` capture les deux fenêtres puis ferme l'app ; avec `IM_FAKE=1`, des événements factices sont injectés dans l'app (aucune vraie touche n'est envoyée au système).

## Prochaines étapes
- V3 : mode défi (séquence attendue → ce qui a été raté + récap).
