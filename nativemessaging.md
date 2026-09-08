# Installer et valider le Native Messaging sous Windows

L’extension communique avec l’hôte nommé
`be.brucity.inactivity_detection`. Firefox démarre `host.cmd` à la demande,
échange des messages JSON sur l’entrée/sortie standard, puis arrête le processus
quand la connexion est fermée.

L’hôte fourni dans `native-host/` lit `config.json`, ajoute automatiquement le
nom Windows de la borne (`hostname`) et sa première adresse IPv4 non locale
(`ip`), puis renvoie le tout à l’extension. L’import a lieu à l’installation de
l’extension, au démarrage de Firefox et à la demande depuis son panneau.

## 1. Préparer les fichiers de l’hôte

Créer un dossier local, par exemple :

```text
C:\Program Files\Brucity\InactivityDetectionHost\
```

Y copier :

- `native-host/host.cmd` ;
- `native-host/host.ps1` ;
- `native-host/test-host.ps1` ;
- `native-host/config.example.json`, renommé en `config.json`.

Adapter `config.json`. Toutes les options modifiables dans le panneau doivent
être présentes :

```json
{
  "modalAfter": 60,
  "popupLife": 30,
  "redirectUrl": "https://www.mybxl.be/en-US/self-service-kiosk/language-selection/",
  "titleFR": "Inactivité détectée !",
  "txtFR": "Voulez-vous maintenir la session ouverte ?",
  "titleNL": "Inactiviteit gedetecteerd !",
  "txtNL": "Wil je de sessie open houden?",
  "titleEN": "Inactivity detected!",
  "txtEN": "Do you want to keep the session open?"
}
```

`modalAfter` et `popupLife` doivent être des nombres strictement positifs.
`redirectUrl` doit valoir `about:blank` ou être une URL HTTP(S) absolue.
`hostname` et `ip` ne sont pas à saisir : l’hôte les calcule et les ajoute à la
réponse. Le panneau les affiche en lecture seule.

Ne placez pas de secret dans ce fichier : la configuration est ensuite copiée
dans `browser.storage.local` du profil Firefox.

## 2. Tester l’hôte sans Firefox

Depuis le dossier installé :

```powershell
Copy-Item .\config.example.json .\config.json
powershell.exe -ExecutionPolicy Bypass -File .\test-host.ps1
```

Si `test-host.ps1` est resté dans le dépôt, on peut aussi lui passer le chemin
du script installé :

```powershell
.\native-host\test-host.ps1 -HostScript "C:\Program Files\Brucity\InactivityDetectionHost\host.ps1"
```

Le résultat attendu contient `"ok": true`, la configuration complète,
`hostname` et `ip`. Ce test vérifie aussi le cadrage binaire imposé par le
protocole Native Messaging ; lancer `host.ps1` directement ne produit rien,
car il attend ce protocole sur stdin.

## 3. Installer le manifeste de l’hôte

Copier `native-host/be.brucity.inactivity_detection.example.json` dans le
dossier installé et le renommer
`be.brucity.inactivity_detection.json`. Vérifier son chemin absolu :

```json
{
  "name": "be.brucity.inactivity_detection",
  "description": "Configuration host for the Inactivity Detection Firefox extension",
  "path": "C:\\Program Files\\Brucity\\InactivityDetectionHost\\host.cmd",
  "type": "stdio",
  "allowed_extensions": [
    "michael.vanderhoudelinghen@i-city.brucity.be"
  ]
}
```

Les trois valeurs sensibles sont :

- `name`, qui doit être exactement celui utilisé dans `background.js` ;
- `path`, absolu et avec les antislashs échappés dans le JSON ;
- `allowed_extensions`, identique à l’ID Gecko de `manifest.json`.

## 4. Enregistrer l’hôte pour Firefox

Pour l’utilisateur Windows courant, aucun droit administrateur n’est requis :

```powershell
$nativeHostName = "be.brucity.inactivity_detection"
$nativeManifestPath = "C:\Program Files\Brucity\InactivityDetectionHost\be.brucity.inactivity_detection.json"
$nativeRegistryPath = "HKCU:\Software\Mozilla\NativeMessagingHosts\$nativeHostName"

New-Item -Path $nativeRegistryPath -Force | Out-Null
Set-Item -Path $nativeRegistryPath -Value $nativeManifestPath
```

Pour tous les utilisateurs, utiliser la même sous-clé sous `HKLM` depuis une
console élevée :

```powershell
$nativeRegistryPath = "HKLM:\Software\Mozilla\NativeMessagingHosts\$nativeHostName"
New-Item -Path $nativeRegistryPath -Force | Out-Null
Set-Item -Path $nativeRegistryPath -Value $nativeManifestPath
```

La valeur **par défaut** de la clé doit contenir le chemin du manifeste JSON,
et non celui de `host.cmd`.

Valider l’enregistrement :

```powershell
Get-Item -Path "HKCU:\Software\Mozilla\NativeMessagingHosts\be.brucity.inactivity_detection"
Get-Content -Raw "C:\Program Files\Brucity\InactivityDetectionHost\be.brucity.inactivity_detection.json" | ConvertFrom-Json
Test-Path "C:\Program Files\Brucity\InactivityDetectionHost\host.cmd"
```

## 5. Valider dans Firefox

1. Recharger l’extension dans `about:debugging#/runtime/this-firefox`.
2. Cliquer sur **Inspect** pour ouvrir la console du background.
3. Ouvrir le panneau de l’extension.
4. Cliquer sur **Import config.json**.
5. Vérifier le message de succès, `Hostname`, `IP` et toutes les options.
6. Fermer puis relancer Firefox et vérifier que les valeurs sont de nouveau
   importées automatiquement.

Si l’import automatique échoue, la dernière configuration valide est conservée.

## Diagnostic

- **No such native application** : nom d’hôte, clé de registre ou chemin du
  manifeste incorrect.
- **Permission denied / extension not allowed** : vérifier `nativeMessaging`,
  l’ID Gecko et `allowed_extensions`.
- **Invalid native manifest** : contrôler la syntaxe JSON et le chemin absolu
  échappé.
- **Host exited / disconnected** : exécuter `test-host.ps1`, vérifier
  `config.json` et consulter la console du background.
- `ip` vide : aucun IPv4 non loopback n’a été résolu pour le hostname. L’import
  reste valide et permet de diagnostiquer la configuration réseau de la borne.

Pour 17 bornes, les scripts et le manifeste peuvent être identiques. Seul
`config.json` doit varier selon l’environnement. Le dossier et la clé de
registre peuvent être déployés par GPO, Intune ou votre outil de gestion de
parc. Pour une diffusion durable, un exécutable signé est préférable au wrapper
PowerShell si la politique d’exécution de l’organisation interdit les scripts.

Références officielles : [Native messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging) et [Native manifests](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests).
