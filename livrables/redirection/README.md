# Redirection du nom racine

Ce dossier contient de quoi faire répondre `sivax.health` — le nom sans `www` —
et le renvoyer vers `https://www.sivax.health`, qui est servi par la plateforme.

## Pourquoi c'est nécessaire

Le point d'entrée de la plateforme est un load balancer AWS. Il n'a pas
d'adresse IP fixe, seulement un nom, et la norme DNS interdit un enregistrement
CNAME à l'apex d'une zone. Le nom racine ne peut donc pas pointer directement
dessus.

Deux solutions existaient : déplacer la zone DNS chez un hébergeur proposant un
enregistrement de type ALIAS, ou faire répondre le nom racine par un petit
hébergement qui redirige. C'est la seconde qui a été retenue, la première
impliquant de déplacer aussi la messagerie du domaine.

## Contenu

| Fichier | Rôle |
|---|---|
| `.htaccess` | réécriture Apache — le chemin normal |
| `index.php` | repli, utilisé seulement si `mod_rewrite` est indisponible |

Les deux font le même travail et se superposent volontairement : si l'un est
inopérant sur l'hébergement, l'autre prend le relais. Le chemin et les
paramètres de la requête sont conservés dans les deux cas.

## Mise en place

1. Chez l'hébergeur, faire pointer `sivax.health` (enregistrement A) vers
   l'hébergement web qui portera ces fichiers — **pas** vers le load balancer.
2. Déposer `index.php` et `.htaccess` à la racine du dossier public de cet
   hébergement.
3. Activer le certificat SSL gratuit de l'hébergeur **sur le nom racine**.
4. Vérifier :

```bash
curl -sI https://sivax.health/alertes | head -3
```

La réponse attendue est `HTTP/… 301` avec
`location: https://www.sivax.health/alertes` — le chemin doit être conservé.

## Le point à ne pas manquer

**Le certificat de l'étape 3 n'est pas optionnel.** Sans lui, un visiteur qui
saisit `https://sivax.health` reçoit un avertissement de sécurité *avant* que la
redirection ne s'applique — le navigateur vérifie le certificat avant de lire la
réponse. La redirection fonctionnerait en `http://` et échouerait en `https://`,
ce qui est le cas le plus fréquent aujourd'hui.

Le certificat de la plateforme, lui, couvre déjà les deux noms : il est géré par
AWS et ne demande aucune action.

## Ce qui reste possible plus tard

Si la zone DNS venait à être déplacée vers un service proposant un
enregistrement ALIAS — Route 53, entre autres — le nom racine pourrait pointer
directement sur le load balancer et cet hébergement deviendrait inutile. Rien
dans la plateforme n'en dépend : le certificat couvre déjà `sivax.health`, et
l'ingress sert déjà les deux noms.
