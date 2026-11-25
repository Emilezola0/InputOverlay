# InputMemory

Visualiseur d'inputs clavier / souris / manette, avec overlay pour les jeux.

## Télécharger (Windows)

Va dans **[Releases](https://github.com/Emilezola0/InputOverlay/releases)** et prends :
- `InputMemory-Setup-x.y.z.exe` : installeur (raccourci sur le bureau, désinstallable depuis Windows) ;
- `InputMemory-Portable-x.y.z.exe` : version portable, rien à installer, il suffit de la lancer.

**Mises à jour** : la version installée (Setup) se met à jour toute seule. Quand une nouvelle version est téléchargée, un bouton **Redémarrer** apparaît en haut de la fenêtre. La version portable signale seulement qu'une nouvelle version existe et propose de la télécharger.

L'appli n'est pas signée : au premier lancement, Windows SmartScreen peut afficher « Windows a protégé votre ordinateur ». Clique sur **Informations complémentaires**, puis sur **Exécuter quand même**.

## Développer

```powershell
npm install
npm start
```

Construire les exécutables (dans `dist/`) :

```powershell
npm run dist
```

L'icône est générée par `npm run icon` (`scripts/make-icon.js` → `build/icon.png`).

Publier une version (après `gh auth login`) :
1. changer `"version"` dans `package.json` ;
2. `npm run dist` ;
3. `npm run release -- notes.md` (notes facultatives) : crée la Release GitHub avec l'installeur, la version portable et `latest.yml`, utilisé par la mise à jour automatique.

## V1
- **Live** : clavier complet (AZERTY/QWERTY), souris, manette (Xbox/PS), touches allumées en temps réel.
- **Historique** : chaque input avec sa durée d'appui et l'écart depuis le précédent (ms ou frames), appuis simultanés regroupés, filtres par appareil, pause.
- **Overlay** : fenêtre transparente toujours au premier plan, widgets au choix, taille/opacité/disposition réglables.
- **Réglage sur place** : déverrouille l'overlay (Ctrl+Maj+L) pour le régler directement par-dessus le jeu. Une barre d'outils permet d'afficher ou masquer chaque widget, et de changer la taille globale, l'opacité et la disposition. Sur chaque widget : −/+, molette ou poignée d'angle pour sa taille, × pour le masquer. On le déplace en le faisant glisser.

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
- **Modèles intégrés** (bouton **Modèles**) : Rocket League (speedflip gauche/droite, half-flip, fast aerial, wavedash) et jeux de combat (quart de cercle, dragon punch, demi-cercle, dash). Le timing n'y est pas vérifié par défaut : réenregistre le modèle en le jouant toi-même pour l'activer.
- **Contrôles** (bouton **Contrôles**) : choisis le bouton de chaque action (Sauter, Boost, Air roll…). Les modèles les utilisent, et les séquences déjà créées depuis un modèle sont mises à jour quand tu les changes. Un ⚠ signale deux actions sur le même bouton.
- **À maintenir pendant tout l'essai** : des inputs à garder appuyés (ex. Accélérer + Boost pour le speedflip). Les relâcher ou ne pas les tenir donne « Presque ».
- **Fenêtre de délai** (⏱ min–max entre deux étapes) : par exemple « air roll pas avant 100 ms ni après 200 ms après l'annulation ». Elle est vérifiée même sans « Vérifier le timing ».
- **Angles du stick** : 0° = haut, « 35° G » = 35° à gauche, « 35° D » = 35° à droite. Avec « Vérifier les angles du stick », chaque direction a un angle attendu ± une tolérance. Sur une étape stick + bouton (ex. ↖ + saut), l'angle est mesuré au moment du bouton. Les angles s'affichent aussi sous les sticks de la manette (Live et overlay) et dans l'historique.
- **Frise** sous le test : le modèle en haut, ton essai en bas sur la même échelle de temps, avec les fenêtres de délai en jaune.
- **Catégories** et **notes** par séquence, pour ranger tes séquences par jeu.
- **Début d'un essai** :
  - *Au premier input de la séquence* (par défaut) : tout ce que tu fais avant est ignoré. Idéal en entraînement libre.
  - *Avec une touche de départ* : appuie sur un bouton que tu n'utilises pas dans la séquence (ex. View / Share), puis fais la séquence dans les 5 s. Idéal en match, où tu sautes sans arrêt.
  - *Automatique* : n'importe quel input démarre un essai.
  - Fin : dès que la dernière étape est jouée, ou après une courte pause, ou au bout de la durée du modèle + une marge.
- **Inputs pris en compte** : seulement ceux de la séquence, ceux des appareils utilisés, ou tous. **Directions de stick traversées** : en balayant le stick (↖ → ↓), les directions intermédiaires (← ↙) ne sont pas comptées en trop.
- Le widget **Entraînement** de l'overlay montre le verdict et les étapes ratées pendant que tu joues.

## Raccourcis globaux
Modifiables dans **Overlay & réglages → Raccourcis globaux**. Un raccourci déjà pris par un autre logiciel s'affiche en rouge. Par défaut :

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
- Overlay : des préréglages (Manette, Clavier + souris, Historique seul, Tout) ; l'overlay est réduit automatiquement s'il dépasse l'écran.
- Les essais d'entraînement sont sauvegardés : le récap est conservé d'une session à l'autre.
- Debug (développement uniquement, inactif dans l'exe) : `IM_SNAPSHOT=<dossier>` capture les deux fenêtres puis ferme l'app ; avec `IM_FAKE=1` (enregistrement) ou `IM_FAKE=training` (entraînement), des événements factices sont injectés dans l'app (aucune vraie touche n'est envoyée au système).
