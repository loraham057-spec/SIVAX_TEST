<?php
/**
 * Redirection du nom racine vers www.sivax.health.
 *
 * Repli de la réécriture Apache du .htaccess voisin : ce fichier prend le
 * relais si mod_rewrite est indisponible sur l'hébergement. Les deux font le
 * même travail, de sorte qu'aucun des deux ne peut rester seul en panne
 * silencieuse.
 *
 * Le chemin et les paramètres de la requête sont conservés : un visiteur qui
 * arrive sur sivax.health/alertes?province=kinshasa doit atterrir sur la même
 * page, pas sur l'accueil. C'est ce que perdent la plupart des redirections
 * posées à la main.
 */

const CIBLE = 'https://www.sivax.health';

// Même garde-fou que la RewriteCond du .htaccess : si la requête arrive déjà
// sur le nom servi, rediriger reviendrait à boucler sur soi-même. Ce cas se
// produit aussi avec mod_rewrite actif, puisque le .htaccess laisse alors
// passer la requête et Apache sert ce fichier comme page d'index.
$hote = strtolower(explode(':', $_SERVER['HTTP_HOST'] ?? '', 2)[0]);
if ($hote === 'www.sivax.health' || $hote === 'dev.sivax.health') {
    http_response_code(404);
    exit('Not Found');
}

$chemin = $_SERVER['REQUEST_URI'] ?? '/';

// Retrait des retours chariot avant toute écriture d'en-tête. PHP refuse déjà
// les en-têtes multilignes depuis 5.1.2, mais la protection est écrite ici
// plutôt que supposée ailleurs : c'est la seule donnée venue du client que ce
// fichier manipule.
$chemin = str_replace(["\r", "\n", "\0"], '', $chemin);

// Exactement une barre oblique de tête. Sans elle, une requête forgée pourrait
// produire une URL pointant vers un autre domaine ; avec deux, le navigateur
// lirait une URL protocole-relative : « //exemple.test » désigne un autre
// hôte, pas un chemin.
$chemin = '/' . ltrim($chemin, '/');

// 301 et non 302 : la redirection est permanente, donc les navigateurs et les
// moteurs de recherche la mémorisent et cessent de repasser par ici. Revers à
// connaître : si le nom racine devait un jour servir directement la
// plateforme, les navigateurs qui ont mis ce 301 en cache continueraient un
// temps de rediriger. Un 302 serait le bon choix pour une redirection que l'on
// sait provisoire.
header('Location: ' . CIBLE . $chemin, true, 301);

// Un cache d'un jour seulement, là où un 301 est mémorisé indéfiniment par
// défaut : cela laisse une porte de sortie si la cible change.
header('Cache-Control: max-age=86400');

// Corps minimal pour les clients qui ne suivent pas les redirections.
?>
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>SIVAX</title>
  <meta http-equiv="refresh" content="0; url=<?= htmlspecialchars(CIBLE . $chemin, ENT_QUOTES, 'UTF-8') ?>">
</head>
<body>
  <p>Cette adresse a déménagé.
     <a href="<?= htmlspecialchars(CIBLE . $chemin, ENT_QUOTES, 'UTF-8') ?>">Continuer vers www.sivax.health</a>.</p>
</body>
</html>
