// Bootstrap — configuration non secrète.
//
// Le nom du bucket porte l'identifiant du compte : un nom de bucket est unique
// MONDIALEMENT, donc « diav1-tfstate » seul est un pari sur ce que personne
// d'autre n'a déjà pris. Le suffixe rend le nom déterministe et disponible,
// et il documente à qui appartient l'état quand on le croise dans la console.

project = "diav1"
region  = "eu-west-3"

state_bucket_name = "diav1-tfstate-431000516997"
lock_table_name   = "diav1-tfstate-lock"
