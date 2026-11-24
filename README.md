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

## Raccourcis globaux
| Raccourci | Action |
|---|---|
| Ctrl+Maj+O | Afficher / masquer l'overlay |
| Ctrl+Maj+L | Verrouiller (clics traversants) / déverrouiller (déplaçable) |
| Ctrl+Maj+⌫ | Effacer l'historique |

## Notes
- L'overlay passe par-dessus les jeux en fenêtré ou plein écran sans bordure, pas en plein écran exclusif.
- La manette apparaît après un premier appui sur un bouton (règle de l'API Gamepad).
- Debug : `IM_SNAPSHOT=<dossier>` capture les deux fenêtres puis ferme l'app.

## Prochaines étapes
- V2 : enregistrement de sessions + timeline.
- V3 : mode défi (séquence attendue → ce qui a été raté + récap).
