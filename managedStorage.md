# Configurer Managed Storage sous Firefox et Windows

## Principe

Firefox permet à une extension de lire une configuration administrée avec
`browser.storage.managed`. Sous Windows, une clé de registre associe l’identifiant
de l’extension à un manifeste JSON local. Aucun script ni processus hôte n’est
lancé pour lire ce fichier.

L’extension utilise les sources dans cet ordre :

1. valeurs par défaut intégrées ;
2. manifeste Managed Storage, lorsqu’il est présent et entièrement valide ;
3. modifications locales enregistrées depuis `options.html`, si
   `allowLocalOverrides` vaut `true`.

Les modifications locales sont enregistrées séparément dans
`browser.storage.local.localOverrides`. Elles ne modifient jamais le manifeste
administré. Les champs sont grisés à l’ouverture du panneau. **Unlock
configuration** autorise leur édition, **Validate** sauvegarde l’override local
et **Use managed values** le supprime. Si Managed Storage est absent ou invalide,
les valeurs locales déjà enregistrées restent le fallback.

## 1. Préparer le manifeste JSON

Utiliser comme modèle
[`managed-storage/michael.vanderhoudelinghen@i-city.brucity.be.json`](managed-storage/michael.vanderhoudelinghen@i-city.brucity.be.json),
puis le déployer par exemple à cet emplacement :

```text
C:\ProgramData\Brucity\InactivityDetection\michael.vanderhoudelinghen@i-city.brucity.be.json
```

Le nom et la propriété `name` doivent correspondre exactement à l’identifiant
Gecko déclaré dans `manifest.json` :

```json
{
  "name": "michael.vanderhoudelinghen@i-city.brucity.be",
  "description": "Managed configuration for the Brucity inactivity extension",
  "type": "storage",
  "data": {
    "modalAfter": 60,
    "popupLife": 30,
    "redirectUrl": "https://www.mybxl.be/en-US/self-service-kiosk/language-selection/",
    "titleFR": "Inactivité détectée",
    "txtFR": "Vous n'avez plus interagi avec la borne depuis un certain temps.\nSouhaitez-vous continuer à l'utiliser ?",
    "btnContinueFR": "Oui, continuer ma session",
    "btnQuitFR": "Non, quitter",
    "titleNL": "Inactiviteit gedetecteerd",
    "txtNL": "U hebt de kiosk al enige tijd niet meer gebruikt.\nWilt u deze blijven gebruiken?",
    "btnContinueNL": "Ja, mijn sessie voortzetten",
    "btnQuitNL": "Nee, afsluiten",
    "titleEN": "Inactivity detected",
    "txtEN": "You have not interacted with the kiosk for some time.\nWould you like to continue using it?",
    "btnContinueEN": "Yes, continue my session",
    "btnQuitEN": "No, exit",
    "hostname": "BORNE-001",
    "ip": "10.20.30.101",
    "allowLocalOverrides": true,
    "kioskRestrictionsEnabled": true,
    "kioskRestrictions": [
      {
        "id": "site-purpose",
        "enabled": true,
        "hostnames": ["www.example.be"],
        "pathPrefixes": ["/kiosk/path"],
        "selectors": [".site-header", "#sidebar"]
      }
    ]
  }
}
```

Toutes les propriétés présentées dans `data` sont obligatoires, sauf
`allowLocalOverrides`, qui vaut `true` par défaut :

- `modalAfter` et `popupLife` sont des nombres strictement positifs exprimés en
  secondes ;
- `redirectUrl` vaut `about:blank` ou une URL HTTP(S) absolue ;
- les titres, textes, libellés de boutons, `hostname` et `ip` sont des chaînes ;
- chaque `title*` accepte au plus 500 caractères, chaque `txt*` 2 000, chaque
  `btnContinue*` ou `btnQuit*` 200, et `hostname` ou `ip` 255 ; une chaîne vide
  est admise pour les métadonnées ou le texte ;
- chaque langue utilise quatre clés avec le suffixe `FR`, `NL` ou `EN` :
  `title`, `txt`, `btnContinue` et `btnQuit` ;
- `allowLocalOverrides: true` autorise **Validate** dans le panneau ;
- `allowLocalOverrides: false` impose le JSON et désactive les champs éditables.

### Règles de restriction d'interface kiosque

`kioskRestrictionsEnabled` est le commutateur global booléen. Il vaut `true`
dans les valeurs par défaut et peut être un override local quand
`allowLocalOverrides` l'autorise. `kioskRestrictions` est toujours un tableau
Managed Storage uniquement : le panneau peut l'afficher mais ne peut jamais
créer, modifier ou remplacer une règle ou un sélecteur localement.

Le tableau contient de 1 à 50 règles. Chaque règle doit contenir ces cinq
propriétés :

| Propriété | Type, cardinalité et limite |
| --- | --- |
| `id` | chaîne non vide, unique, au plus 64 caractères |
| `enabled` | booléen ; désactive cette règle sans la supprimer |
| `hostnames` | tableau non vide de 1 à 10 noms DNS, chacun au plus 253 caractères |
| `pathPrefixes` | tableau non vide de 1 à 20 chemins débutant par `/`, chacun au plus 2048 caractères |
| `selectors` | tableau non vide de 1 à 100 sélecteurs CSS valides, chacun au plus 512 caractères |

Les hostname sont comparés exactement, sans joker, seulement avec HTTPS et sans
tenir compte de la casse. Les `/` terminaux des chemins sont normalisés. Le
préfixe est borné : `/a/b` correspond à `/a/b` et `/a/b/enfant`, mais pas à
`/a/b-extra`; les paramètres et fragments sont ignorés. Le commutateur global
désactive toutes les règles, tandis que `enabled: false` ne désactive que la
règle concernée. Dans les deux cas, les éléments cachés par l'extension sont
restaurés immédiatement.

Sont invalides, par exemple, `*.example.be`, `https://example.be/path`,
`example`, `kiosk/path`, deux règles ayant le même `id`, `[data-x=`, ou un
sélecteur vide. La configuration est atomique : une seule propriété ou règle
invalide rejette tout le manifeste, conserve la dernière configuration locale
valide et écrit un diagnostic dans la console de l'extension.

Les valeurs initiales de `kioskRestrictions` sont exactement :

- `fas-login` : `idp.iamfas.belgium.be` et `idp.iamfas.int.belgium.be`, sous
  `/fas/XUI/`, avec les sélecteurs FAS du modèle déployable (en-têtes, pieds de
  page, vidéo et aide, sans contrôles d'authentification) ;
- `ibz-pin-puk` : `www.ibz.rrn.fgov.be`, sous
  `/fr/citoyen/documents-didentite/eid/demande-dun-code-pin`, avec
  `header.header`, `#superfish-main`, `#sidebar-first`, `.footer-top` et
  `.region-footer-bottom`.

Pour ajouter un site, inspecter son DOM dans les outils de développement,
choisir le hostname HTTPS exact et le chemin le plus étroit, puis ajouter les
sélecteurs CSS stables les plus étroits qui ne touchent ni formulaires ni autres
contrôles d'authentification. Tester ensuite la page, un chemin voisin et une
page hors périmètre. Pour retirer une règle, supprimer son objet (en gardant au
moins une règle valide) ; pour la désactiver, utiliser `enabled: false`; pour
tout arrêter, utiliser `kioskRestrictionsEnabled: false`.

Masquer des éléments de page est une restriction de présentation, pas un blocage
de navigateur : cela ne bloque ni URL, ni navigation, ni requête réseau.

Ne pas placer de secret dans ce fichier. Son contenu est lisible par
l’extension et par les administrateurs de la machine.

## 2. Enregistrer le manifeste dans Windows

Pour tous les utilisateurs, ouvrir PowerShell en administrateur et créer la clé
dans `HKLM` :

```powershell
$extensionId = "michael.vanderhoudelinghen@i-city.brucity.be"
$managedManifest = "C:\ProgramData\Brucity\InactivityDetection\$extensionId.json"
$managedRegistryKey = "HKLM:\SOFTWARE\Mozilla\ManagedStorage\$extensionId"

New-Item -Path $managedRegistryKey -Force | Out-Null
Set-Item -Path $managedRegistryKey -Value $managedManifest
```

Pour le seul utilisateur connecté, remplacer `HKLM:` par `HKCU:`. La valeur
**par défaut** de la clé doit contenir le chemin absolu du manifeste JSON.

Firefox vérifie d’abord la vue 32 bits du registre, puis la vue native. Si une
ancienne clé existe dans `WOW6432Node`, vérifier qu’elle ne pointe pas vers un
autre fichier.

Valider l’installation :

```powershell
$extensionId = "michael.vanderhoudelinghen@i-city.brucity.be"
$managedManifest = "C:\ProgramData\Brucity\InactivityDetection\$extensionId.json"

Get-Item "HKLM:\SOFTWARE\Mozilla\ManagedStorage\$extensionId"
Test-Path -LiteralPath $managedManifest
Get-Content -Raw -LiteralPath $managedManifest | ConvertFrom-Json | Out-Null
```

## 3. Déployer sur plusieurs bornes

Conserver le modèle maître sur un partage ou dans l’outil de gestion du parc,
mais copier une version locale sur chaque borne avant de démarrer Firefox. La
génération peut renseigner `hostname`, `ip` et l’environnement de la borne.

Écrire d’abord un fichier temporaire, valider son JSON, puis le déplacer vers le
chemin final. Ce remplacement atomique empêche Firefox de lire un fichier
partiellement généré. La clé de registre ne doit être créée qu’une fois et peut
être distribuée par GPO, Intune ou l’outil de provisioning.

Pour chaque déploiement, mettre à jour le JSON, arrêter complètement Firefox,
installer ou mettre à jour l'extension, redémarrer Firefox, puis valider. Firefox
doit être complètement fermé puis relancé pour prendre en compte une modification
du manifeste Managed Storage. **Use managed values** supprime les overrides
locaux et réutilise les valeurs que Firefox a déjà chargées ; il ne force pas
Firefox à relire un fichier modifié sur disque.

## 4. Valider dans Firefox

1. Fermer toutes les fenêtres et tous les processus Firefox.
2. Vérifier le JSON et sa clé de registre.
3. Démarrer Firefox et charger l’extension.
4. Dans `about:debugging#/runtime/this-firefox`, ouvrir **Inspect** pour
   l’extension.
5. Exécuter dans sa console :

```javascript
browser.storage.managed.get(null).then(console.log)
```

Les propriétés placées dans `data` doivent apparaître directement. Ouvrir
ensuite le panneau : il indique si Managed Storage est chargé et si des
modifications locales sont actives.

Après avoir rechargé l’extension temporaire dans `about:debugging`, recharger
aussi l’onglet du portail : Firefox ne réinjecte pas automatiquement la nouvelle
version d’un content script dans les pages qui étaient déjà ouvertes.

Pour tester la priorité locale, laisser `allowLocalOverrides` à `true`, cliquer
sur **Unlock configuration**, modifier une valeur puis cliquer sur **Validate**.
**Use managed values** doit rétablir la valeur du JSON. Avec
`allowLocalOverrides: false`, le bouton de déverrouillage doit être désactivé.

## Diagnostic

- **Managed configuration unavailable** : vérifier le chemin de la valeur par
  défaut dans le registre, l’identifiant exact et la syntaxe JSON.
- **Une ancienne valeur reste affichée** : fermer tous les processus Firefox,
  puis relancer le navigateur. Après un rechargement de l’extension temporaire,
  recharger également l’onglet testé.
- **Managed Storage contient les bonnes valeurs mais le formulaire ou la modale
  affiche une modification précédente** : vérifier si le panneau indique que
  des overrides locaux sont actifs, puis utiliser **Use managed values**.
  On peut les inspecter dans la console avec
  `browser.storage.local.get("localOverrides").then(console.log)`.
- **Le JSON est trouvé mais refusé** : vérifier que toutes les propriétés de
  configuration sont présentes et du bon type. La console de l'extension donne
  la règle et le champ refusés; aucune partie du manifeste n'est appliquée.
- **La mauvaise configuration est chargée** : contrôler les clés `HKCU`,
  `HKLM` et leurs éventuelles vues `WOW6432Node`.

Documentation Mozilla :

- [API `storage.managed`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/managed) ;
- [format et emplacement des Managed Storage manifests](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests#managed_storage_manifests) ;
- [politiques d’entreprise Firefox et `3rdparty`](https://mozilla.github.io/policy-templates/#3rdparty).
