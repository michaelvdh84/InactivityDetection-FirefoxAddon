# Synchroniser la langue MyBxl et CSAM

## Activation administrateur

La clé **csamLanguageSyncEnabled** est un booléen facultatif, exclusivement
administré, dont la valeur par défaut est **false**. Elle ne figure pas dans
les champs éditables du panneau et ne peut pas être remplacée par localOverrides.
Ajouter cette propriété dans data du manifeste Managed Storage complet :

```json
"csamLanguageSyncEnabled": true
```

Le [modèle déployable](managed-storage/michael.vanderhoudelinghen@i-city.brucity.be.json)
la présente à false. Aucun autre défaut ni règle existante n'est modifié.
Le dépôt utilise la validation explicite de background.js comme schéma applicatif ;
il n'utilise pas de fichier JSON Schema séparé. Une politique ancienne sans cette
clé reste valide et désactive la fonctionnalité. Une valeur autre qu'un booléen
invalide tout le manifeste, selon la validation atomique existante. Une politique
absente ou invalide conserve le dernier fallback local valide, y compris la
valeur de cette clé précédemment résolue depuis une politique administrateur.

Fermer complètement Firefox et le relancer après le déploiement du JSON.
Pour une extension temporaire, recharger également le paquet modifié. La
[synchronisation administrée est en lecture seule](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/managed) ;
Firefox exige un redémarrage pour relire le manifeste.

## Fonctionnement et limites

La source est exclusivement le premier segment du chemin officiel HTTPS de
www.mybxl.be : fr-BE devient fr, nl-BE devient nl et en-US devient en
(comparaison sans tenir compte de la casse). L'inspection des pages réelles a
confirmé ces chemins ; leurs attributs HTML lang étaient respectivement fr-FR,
nl-NL et en-US. Le DOM traduit, les paramètres d'URL, les préférences du
navigateur et les domaines de traduction Google ne sont pas utilisés.

csamLanguageCore.js contient la détection et le ciblage du contrôle.
csamLanguageBackground.js mémorise chaque parcours sous une clé propre au tabId
dans [storage.session](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session).
Seuls le code langue, des identifiants internes aléatoires, un délai et des
indicateurs de tentative sont conservés. Aucune URL n'est stockée. Ce stockage
survit à la suspension de la page d'arrière-plan Manifest V3, mais disparaît
à l'arrêt de Firefox ou à la désactivation de l'extension. Les onglets fermés,
les demandes reset-session et la désactivation de la politique effacent l'état
concerné. Les enregistrements d'onglets fermés sont aussi éliminés au réveil.
Une langue n'est jamais héritée d'un autre onglet, même lors d'une duplication.
Un nouvel onglet doit lui-même avoir visité une URL MyBxl officielle.

La langue reste disponible pendant les redirections B2C, sans script ni analyse
spécifique de B2C. Le parcours expire après 15 minutes sans nouvelle navigation
MyBxl. À l'arrivée sur https://idp.iamfas.belgium.be/fas/XUI/, l'arrière-plan
marque la tentative avant d'injecter csamLanguageContent.js dans le cadre principal.
Les pages d'autorisation OAuth et le serveur FAS d'intégration ne sont pas ciblés.

Le DOM CSAM observé expose exactement quatre liens nl, fr, de et en dans
**.language-bar .language-list a[role="button"]**. La classe **active** indique
le choix courant. Les attributs Vue data-v-* sont évités car ils dépendent du
build du portail. Un lien cible unique et une langue active unique sont exigés ;
un DOM absent ou ambigu ne provoque aucune action. Le composant attend au plus
10 secondes avec un [MutationObserver](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver),
puis nettoie ses observateurs, listeners et timeout après succès, expiration,
sortie de page ou désactivation. Il active le lien existant avec click(), sans
modifier le protocole d'authentification. Une langue déjà correcte est laissée
inchangée et termine également la tentative.

Une autorisation atomique, propre au parcours et au document demandeur, précède
le clic. Rechargements, changements de langue manuels et réveils de l'arrière-plan
ne réarment pas un parcours déjà tenté, même si le sélecteur était introuvable.
Une nouvelle navigation officielle MyBxl réarme le parcours avec sa langue.
Cette limite privilégie l'absence de clics répétés. Un échec d'injection laisse
le CSAM fonctionner normalement ; aucune relance automatique n'est effectuée.
Le CSAM peut néanmoins mémoriser la langue avec ses propres cookies communs au
profil : l'extension isole ses décisions par onglet, pas le stockage du site.

Quand la politique est false, aucun onglet n'est parcouru, aucune langue n'est
détectée et aucun script de cette fonctionnalité n'est injecté. Les écouteurs de
réveil sont enregistrés synchroniquement, comme l'exige
[Firefox Manifest V3](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts),
mais leur garde de configuration ne lit pas l'URL et ne déclenche aucune action
spécifique lorsque la fonctionnalité est désactivée. Les scripts existants de
modal et de restrictions restent indépendants et gardent leur fonctionnement.

## Permissions et sécurité des données

La permission ajoutée **scripting** et le seul host_permission ajouté,
**https://idp.iamfas.belgium.be/***, permettent l'injection du composant CSAM.
Les permissions tabs et storage étaient déjà présentes. La fonctionnalité
réutilise [tabs.onUpdated](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/onUpdated)
avec un filtre MyBxl/CSAM et utilise tabId et frameId, sans recherche de l'onglet
actif. Aucune permission cookies, webRequest ou navigateur globale n'est ajoutée.
L'API [webNavigation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webNavigation)
a été examinée : ses événements détaillés ne sont pas nécessaires ici, donc sa
permission n'est pas demandée. Les portails officiels doivent conserver le même
onglet pendant le parcours B2C/CSAM.

Les [scripts de contenu](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts)
accèdent au DOM isolé de Firefox. [runtime.sendMessage](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/sendMessage)
sert à obtenir et consommer la langue. L'arrière-plan valide le cadre principal,
le domaine et le chemin du demandeur, l'onglet courant du demandeur et les
identifiants du parcours avant d'autoriser le clic. Les erreurs restent silencieuses.
Seuls l’origine et le chemin de navigation sont examinés : les paramètres et
fragments reçus des API de navigation sont éliminés avant analyse et ne sont
jamais conservés ni journalisés. Aucun identifiant citoyen, champ de formulaire
ou cookie n’est lu ni journalisé par ce composant. La langue globale de Firefox
et Accept-Language ne sont pas modifiés. state, nonce et redirect_uri sont
laissés au fournisseur d'identité.

## Applicabilité des références serveur

Le [guide FAS OIDC BOSA](https://bosa.belgium.be/sites/default/files/content/documents/DTdocs/FAS/FAS_OIDC_Integration_Guide.pdf)
indique ui_locales comme option recommandé parmi en, de, fr et nl. Cette solution
côté serveur suppose une adaptation du client OIDC ; elle n'est pas appliquée
par l'extension. La [politique cookies BOSA](https://sma-help.bosa.belgium.be/fr/fas-politique-cookies)
décrit fas2-saml-locale comme mémorisation de la langue de la dernière page visitée
pendant un an. Ce contexte explique la persistance possible d'une langue, mais
ne justifie aucune lecture ou modification de cookie par l'extension.

La [personnalisation linguistique B2C](https://learn.microsoft.com/en-us/azure/active-directory-b2c/language-customization)
documente ui_locales et le fallback navigateur/politique. Les
[résolveurs B2C](https://learn.microsoft.com/en-us/azure/active-directory-b2c/claim-resolver-overview)
fournissent notamment Culture:LanguageName et Culture:RFC5646. Ces mécanismes
peuvent participer à une correction côté B2C avec la politique appropriée ;
ils ne prouvent pas que le parcours MyBxl actuel transmet la langue au CSAM.
La fonctionnalité présente se limite au sélecteur existant du CSAM.

## Validation

Contrôles exécutés sur cette modification : 66 tests Node réussis, syntaxe des
huit scripts vérifiée avec `node --check`, validation JSON de `manifest.json` et
des deux fichiers Managed Storage, puis `git diff --check` sans erreur.
`web-ext` n’était pas installé ; son lint n’a pas été exécuté et aucune
dépendance n’a été ajoutée.

Vérifications réellement exécutées dans Firefox le 7 octobre 2026 : chemins
MyBxl français, néerlandais et anglais ; inspection du sélecteur CSAM pendant
un parcours MyBxl → B2C → CSAM sans authentification ; essai du composant
isolé sur le DOM CSAM réel avec autorisation simulée, qui a activé successivement
`nl`, `en`, `fr`. Une langue déjà correcte a produit zéro clic ; après une
synchronisation vers `nl`, un choix manuel vers `en` est resté actif sans
réapplication. Cela valide le ciblage et le clic DOM, sans valider le circuit
complet d’injection et de politique de l’extension installée.

Les tests Node couvrent les trois langues officielles, les faux domaines et
traductions, les onglets indépendants, le parcours B2C simulé, l'état déjà correct,
l'accès direct, le sélecteur introuvable, le chargement asynchrone, les claims
concurrents, la politique désactivée, le changement manuel après synchronisation,
la fermeture, le reset, l'expiration et le réveil de l'arrière-plan. Les tests de
configuration couvrent les anciennes politiques, la validation atomique et le
refus d'override local. Les tests existants doivent être exécutés également.

```powershell
node --test tests/*.test.js
node --check csamLanguageCore.js
node --check csamLanguageBackground.js
node --check csamLanguageContent.js
node --check background.js
```

Les observations réelles et les résultats exécutés sont précisés dans le compte
rendu de livraison. Les tests unitaires simulent les API Firefox ; ils ne
remplacent pas un essai de l'extension complète et de la politique déployée.

Essais manuels restant à effectuer avec le paquet complet dans un profil Firefox
de test, sans présenter ces vérifications comme acquises :

1. Déployer une politique true ; ouvrir MyBxl en français, néerlandais et anglais,
   puis traverser B2C vers CSAM dans le même onglet. Vérifier la langue et un seul clic.
2. Ouvrir deux onglets MyBxl de langues différentes ; mener les deux parcours et
   vérifier que chaque onglet applique son propre choix malgré les cookies CSAM.
3. Vérifier une langue déjà correcte, un accès CSAM direct dans un onglet neuf,
   un sélecteur absent, puis une apparition du sélecteur au-delà des 10 secondes.
4. Après synchronisation, choisir une autre langue manuellement puis recharger.
   Vérifier que le choix manuel reste libre et qu'aucun clic n'est répété.
5. Désactiver la politique et redémarrer Firefox ; vérifier l'absence d'injection,
   de détection et de changement de langue. Vérifier aussi l'arrêt d'une attente
   lors d'une désactivation effective.
6. Suspendre/réveiller l'arrière-plan pendant B2C et après un clic ; fermer un
   onglet et recommencer dans un nouvel onglet. Aucun état d'un autre onglet ne doit servir.
7. Refaire les vérifications habituelles : timer et Continue, page de départ,
   restrictions FAS/IBZ, overrides, reset et persistance des options.

Le logout Dynamics existant vise sa session locale ; la déconnexion de l'identité
externe dépend toujours du réglage External logout du portail et n'est pas
vérifiée par ces essais de langue.
