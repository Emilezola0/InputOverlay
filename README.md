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

## V3 : entraînement
- Onglet **Entraînement** : crée une séquence, clique sur **● Enregistrer le modèle** et joue la séquence attendue (arrêt auto après 1,5 s). Les inputs simultanés forment une étape (accord).
- Étapes modifiables : supprimer une étape, en ajouter une (**+ Étape**), ajuster l'écart en ms entre deux étapes.
- Options : tolérance de timing, vérifier ou non le timing, ignorer les appareils absents de la séquence.
- **▶ Activer le test** (ou Ctrl+Maj+T, même en jeu) : chaque essai est détecté automatiquement puis évalué étape par étape :
  - **Réussi** : bons inputs, dans la tolérance ;
  - **Presque** : un peu tôt/tard, accord incomplet ou joué en décalé, input en trop ;
  - **Raté** : étape non jouée ou timing trop loin.
- **Récap** : nombre d'essais, % réussis, parfaits, série en cours, point faible, réussite et timing moyen par étape.
- Le widget **Entraînement** de l'overlay montre le verdict et les étapes ratées pendant que tu joues.

## Raccourcis globaux
| Raccourci | Action |
|---|---|
| Ctrl+Maj+O | Afficher / masquer l'overlay |
| Ctrl+Maj+L | Verrouiller (clics traversants) / déverrouiller (déplaçable) |
| Ctrl+Maj+⌫ | Effacer l'historique |
| Ctrl+Maj+R | Démarrer / arrêter un enregistrement |
| Ctrl+Maj+T | Activer / arrêter le test d'entraînement |

## Notes
- L'overlay passe par-dessus les jeux en fenêtré ou plein écran sans bordure, pas en plein écran exclusif.
- La manette apparaît après un premier appui sur un bouton (règle de l'API Gamepad).
- Debug : `IM_SNAPSHOT=<dossier>` capture les deux fenêtres puis ferme l'app ; avec `IM_FAKE=1` (enregistrement) ou `IM_FAKE=training` (entraînement), des événements factices sont injectés dans l'app (aucune vraie touche n'est envoyée au système).
