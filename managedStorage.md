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
administré. Le bouton **Restore managed values** les supprime. Si Managed Storage
est absent ou invalide, les valeurs locales déjà enregistrées restent le
fallback.

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
    "titleFR": "Inactivité détectée !",
    "txtFR": "Voulez-vous maintenir la session ouverte ?",
    "titleNL": "Inactiviteit gedetecteerd !",
    "txtNL": "Wil je de sessie open houden?",
    "titleEN": "Inactivity detected !",
    "txtEN": "Do you want to keep the session open?",
    "hostname": "BORNE-001",
    "ip": "10.20.30.101",
    "allowLocalOverrides": true
  }
}
```

Toutes les propriétés présentées dans `data` sont obligatoires, sauf
`allowLocalOverrides`, qui vaut `true` par défaut :

- `modalAfter` et `popupLife` sont des nombres strictement positifs exprimés en
  secondes ;
- `redirectUrl` vaut `about:blank` ou une URL HTTP(S) absolue ;
- les titres, textes, `hostname` et `ip` sont des chaînes ;
- `allowLocalOverrides: true` autorise **Validate** dans le panneau ;
- `allowLocalOverrides: false` impose le JSON et désactive les champs éditables.

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

Firefox doit être complètement fermé puis relancé pour prendre en compte une
modification du manifeste Managed Storage. Le bouton **Reload managed
configuration** réapplique les valeurs déjà chargées par Firefox, mais ne force
pas Firefox à relire un fichier modifié sur disque.

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

Pour tester la priorité locale, laisser `allowLocalOverrides` à `true`, modifier
une valeur et cliquer sur **Validate**. **Restore managed values** doit rétablir
la valeur du JSON. Avec `allowLocalOverrides: false`, les champs doivent être
verrouillés.

## Diagnostic

- **Managed configuration unavailable** : vérifier le chemin de la valeur par
  défaut dans le registre, l’identifiant exact et la syntaxe JSON.
- **Une ancienne valeur reste affichée** : fermer tous les processus Firefox,
  puis relancer le navigateur.
- **Le JSON est trouvé mais refusé** : vérifier que toutes les propriétés de
  configuration sont présentes et du bon type.
- **La mauvaise configuration est chargée** : contrôler les clés `HKCU`,
  `HKLM` et leurs éventuelles vues `WOW6432Node`.

Documentation Mozilla :

- [API `storage.managed`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/managed) ;
- [format et emplacement des Managed Storage manifests](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests#managed_storage_manifests) ;
- [politiques d’entreprise Firefox et `3rdparty`](https://mozilla.github.io/policy-templates/#3rdparty).
