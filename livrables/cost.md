\documentclass[11pt,a4paper]{article}

% --------------------------------------------------
% Packages
% --------------------------------------------------
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage[french]{babel}
\usepackage{lmodern}
\usepackage{geometry}
\usepackage{booktabs}
\usepackage{longtable}
\usepackage{tabularx}
\usepackage{array}
\usepackage{multirow}
\usepackage{xcolor}
\usepackage{colortbl}
\usepackage{enumitem}
\usepackage{hyperref}
\usepackage{fancyhdr}
\usepackage{titlesec}
\usepackage{lastpage}
\usepackage{pdflscape}
\usepackage{microtype}

% --------------------------------------------------
% Mise en page
% --------------------------------------------------
\geometry{
    top=2.2cm,
    bottom=2.2cm,
    left=1.6cm,
    right=1.6cm
}

\setlength{\parindent}{0pt}
\setlength{\parskip}{6pt}
\setlength{\LTpre}{6pt}
\setlength{\LTpost}{6pt}

% --------------------------------------------------
% Couleurs
% --------------------------------------------------
\definecolor{SIVAXBlue}{HTML}{1D4ED8}
\definecolor{SIVAXDark}{HTML}{1E293B}
\definecolor{SIVAXLight}{HTML}{EFF6FF}
\definecolor{TableGray}{HTML}{F8FAFC}

% --------------------------------------------------
% Hyperliens
% --------------------------------------------------
\hypersetup{
    colorlinks=true,
    linkcolor=SIVAXBlue,
    urlcolor=SIVAXBlue,
    citecolor=SIVAXBlue,
    pdftitle={Coûts prévisionnels des services tiers — SIVAX},
    pdfauthor={SIVAX}
}

% --------------------------------------------------
% Titres
% --------------------------------------------------
\titleformat{\section}
{\Large\bfseries\color{SIVAXDark}}
{\thesection.}{0.5em}{}

\titleformat{\subsection}
{\large\bfseries\color{SIVAXDark}}
{\thesubsection.}{0.5em}{}

\titleformat{\subsubsection}
{\normalsize\bfseries\color{SIVAXDark}}
{\thesubsubsection.}{0.5em}{}

% --------------------------------------------------
% En-tête / pied de page
% --------------------------------------------------
\pagestyle{fancy}
\fancyhf{}
\fancyhead[L]{\textbf{SIVAX}}
\fancyhead[R]{Coûts prévisionnels des services tiers}
\fancyfoot[L]{Version du 18 septembre 2026}
\fancyfoot[R]{Page \thepage\ / \pageref{LastPage}}
\renewcommand{\headrulewidth}{0.4pt}
\renewcommand{\footrulewidth}{0.4pt}

% --------------------------------------------------
% Colonnes
% --------------------------------------------------
\newcolumntype{Y}{>{\raggedright\arraybackslash}X}
\newcolumntype{C}{>{\centering\arraybackslash}X}
\newcolumntype{R}{>{\raggedleft\arraybackslash}X}

\begin{document}

% ==================================================
% PAGE DE TITRE
% ==================================================

\begin{titlepage}
    \centering

    \vspace*{2.3cm}

    {\Huge\bfseries\color{SIVAXBlue} SIVAX\par}

    \vspace{0.6cm}

    {\LARGE\bfseries
    Coûts prévisionnels des services tiers
    \par}

    \vspace{1cm}

    {\large
    Projection des coûts opérationnels et de montée en charge
    \par}

    \vspace{1.5cm}

    \rule{0.75\textwidth}{1pt}

    \vspace{0.7cm}

    {\large
    \textbf{Version du 18 septembre 2026}
    \par}

    \vspace{1.5cm}

    \begin{minipage}{0.82\textwidth}
        \small
        Ce document présente l'ensemble des services tiers payants
        nécessaires au fonctionnement de la plateforme SIVAX et chiffre
        leur coût prévisionnel selon deux scénarios :

        \begin{itemize}[leftmargin=1.5em]
            \item \textbf{Scénario A --- RDC à grande échelle} :
            déploiement national couvrant les 26 provinces,
            environ 519 zones de santé et environ 9\,600 aires de santé ;

            \item \textbf{Scénario B --- RDC + Cameroun} :
            ajout du Cameroun, couvrant 10 régions et environ
            200 districts de santé, sur la même plateforme, avec
            une seconde source DHIS2 et un cloisonnement des données par pays.
        \end{itemize}
        
        Pour le déploiement national en RDC, l'enveloppe budgétaire conseillée
est estimée à environ \textbf{58\,000 USD par an}, réserve comprise.\\

L'extension au Cameroun porterait cette enveloppe à environ
\textbf{79\,000 USD par an}.\\

Ces montants constituent des \textbf{projections budgétaires} et non des
engagements contractuels. Ils devront être recalibrés à partir des mesures
réelles de consommation après le pilote et à chaque étape de montée en
charge.
    \end{minipage}

    \vfill

    {\small
    Montants exprimés en dollars américains (USD).\\
    Base de calcul : 730 heures par mois.\\
    Tarifs publics à la demande, sans engagement.
    \par}

\end{titlepage}

\tableofcontents
\newpage

% ==================================================
\section{Objet et périmètre}
% ==================================================

Ce document liste l'ensemble des services tiers payants nécessaires au
fonctionnement de la plateforme SIVAX et chiffre leur coût prévisionnel
pour deux scénarios de déploiement.

\subsection{Scénario A --- RDC à grande échelle}

Déploiement national couvrant les 26 provinces, environ 519 zones de santé
et environ 9\,600 aires de santé.

\subsection{Scénario B --- RDC + Cameroun}

Ajout du Cameroun, couvrant 10 régions et environ 200 districts de santé,
sur la même plateforme, avec une seconde source DHIS2 et un cloisonnement
des données par pays.

Le présent document est consacré
au coût actuel de l'infrastructure AWS relevé sur le compte, en élargissant
le périmètre à \textbf{tous} les fournisseurs et en projetant la montée
en charge.

Les montants sont exprimés en \textbf{dollars américains}, devise de
facturation de la majorité des fournisseurs.

\textbf{Base de calcul :} 730 heures par mois, tarifs publics à la demande
sans engagement.

% ==================================================
\section{Hypothèses de charge}
% ==================================================

\begin{table}[htbp]
\centering
\small
\caption{Hypothèses de charge}
\label{tab:hypotheses}
\begin{tabularx}{\textwidth}{p{0.42\textwidth} C C}
\toprule
\textbf{Paramètre} &
\textbf{Scénario A (RDC)} &
\textbf{Scénario B (RDC + Cameroun)} \\
\midrule

Utilisateurs enregistrés &
1\,500 &
2\,300 \\

Utilisateurs actifs par jour ouvré &
300 (20\,\%) &
460 \\

Questions à l'assistant IA par mois &
$\sim$33\,000 &
$\sim$50\,000 \\

Rapports IA générés par mois &
$\sim$500 &
$\sim$750 \\

Saisies vocales par mois (10\,\% des questions) &
$\sim$3\,300 ($\approx$18 h audio) &
$\sim$5\,000 ($\approx$28 h audio) \\

E-mails d'alerte et notifications par mois &
$\sim$12\,000 &
$\sim$20\,000 \\

Sources DHIS2 synchronisées &
1 (SNIS RDC) &
2 (SNIS RDC + DHIS2 Cameroun) \\

Volume base de données
(faits + historique 5 ans) &
$\sim$150 Go &
$\sim$250 Go \\

\bottomrule
\end{tabularx}
\end{table}

% ==================================================
\section{Synthèse}
% ==================================================

\begin{table}[htbp]
\centering
\small
\caption{Synthèse des coûts prévisionnels}
\label{tab:synthese}
\begin{tabularx}{\textwidth}{Y R R R R}
\toprule
\textbf{Scénario} &
\textbf{Services indispensables} &
\textbf{Avec options recommandées} &
\textbf{Par an --- indispensables} &
\textbf{Par an --- avec options} \\
\midrule

\textbf{A --- RDC grande échelle} &
\textbf{$\approx$3\,840 USD/mois} &
$\approx$4\,400 USD/mois &
\textbf{$\approx$46\,100 USD} &
$\approx$52\,800 USD \\

\textbf{B --- RDC + Cameroun} &
\textbf{$\approx$5\,100 USD/mois} &
$\approx$6\,000 USD/mois &
\textbf{$\approx$61\,200 USD} &
$\approx$72\,000 USD \\

\bottomrule
\end{tabularx}
\end{table}

Le poste dominant n'est pas l'infrastructure mais
\textbf{l'API de modèles de langage (OpenAI)}, qui représente à elle seule
plus de la moitié de la dépense et croît linéairement avec le nombre de
questions posées.

Il s'agit du poste à surveiller en priorité
(voir section \ref{sec:leviers}).

\begin{landscape}
% =================================================
\section{Détail par service}
% =================================================
\subsection{Services indispensables}

\begin{longtable}{
@{}
p{0.035\textwidth}
p{0.13\textwidth}
p{0.20\textwidth}
p{0.28\textwidth}
p{0.085\textwidth}
p{0.085\textwidth}
p{0.085\textwidth}
p{0.085\textwidth}
@{}}
\caption{Services indispensables}
\label{tab:indispensables}\\

\toprule
\textbf{\#} &
\textbf{Service} &
\textbf{Rôle} &
\textbf{Formule / base de calcul} &
\textbf{A/mois} &
\textbf{A/an} &
\textbf{B/mois} &
\textbf{B/an} \\
\midrule
\endfirsthead

\toprule
\textbf{\#} &
\textbf{Service} &
\textbf{Rôle} &
\textbf{Formule / base de calcul} &
\textbf{A/mois} &
\textbf{A/an} &
\textbf{B/mois} &
\textbf{B/an} \\
\midrule
\endhead

1 &
\textbf{AWS --- Production}
(\texttt{eu-central-1}) &
Hébergement : Kubernetes (EKS), PostgreSQL (RDS Multi-AZ), Redis
(ElastiCache), NAT, load balancer, stockage, journaux et sauvegardes &
Détail présenté à la section \ref{sec:aws} &
1\,300 &
15\,600 &
1\,600 &
19\,200 \\

2 &
\textbf{AWS --- Développement}
(\texttt{eu-west-3}) &
Environnement de recette et de test &
Inventaire actuel dans \texttt{EVALUATION-COUTS-AWS.md} + marge &
250 &
3\,000 &
250 &
3\,000 \\

3 &
\textbf{Supabase} &
Authentification, gestion des utilisateurs, base applicative :
paramètres, rapports, alertes et notifications &
Plan Pro 25 USD + compute \textit{Medium} $\sim$60 USD +
stockage/sauvegardes PITR ; scénario B : projet ou schéma dédié Cameroun &
110 &
1\,320 &
185 &
2\,220 \\

4 &
\textbf{OpenAI API} &
Assistant décisionnel (agent LangGraph), génération de rapports,
analyses IA &
\texttt{gpt-4o} : 2,50 USD/M tokens entrée, 10 USD/M sortie ;
\texttt{gpt-4o-mini} : 0,15/0,60 USD.
$\approx$0,057 USD/question et $\approx$0,50 USD/rapport &
2\,100 &
25\,200 &
2\,900 &
34\,800 \\

5 &
\textbf{ElevenLabs} &
Saisie vocale $\rightarrow$ texte avec le modèle \textit{Scribe v1} &
Plan \textit{Creator} 22 USD ($\approx$63 h STT) pour A ;
plan \textit{Pro} 99 USD ($\approx$300 h) pour B avec marge &
22 &
264 &
99 &
1\,188 \\

6 &
\textbf{Resend} &
E-mails transactionnels : alertes, notifications, réinitialisation
de mot de passe et tests de configuration &
Plan \textit{Pro} 20 USD pour 50\,000 e-mails/mois &
20 &
240 &
20 &
240 \\

7 &
\textbf{Hostinger} &
Nom de domaine \texttt{sivax.health}, hébergement de redirection
du domaine racine et boîtes e-mail &
Domaine \texttt{.health} $\approx$80 USD/an ;
hébergement \textit{Business} $\approx$4--9 USD/mois ;
5 boîtes mail $\approx$5 USD/mois ;
scénario B : domaine \texttt{.cm} $\approx$100 USD/an &
20 &
240 &
30 &
360 \\

8 &
\textbf{GitHub} &
Dépôt de code, chaîne de livraison GitHub Actions et registre
d'images de secours &
Plan \textit{Team} : 4 USD/utilisateur $\times$ 5 ;
2\,000 min/mois d'Actions incluses &
20 &
240 &
20 &
240 \\

\midrule

\multicolumn{4}{r}{\textbf{Sous-total indispensables}} &
\textbf{3\,842} &
\textbf{46\,104} &
\textbf{5\,104} &
\textbf{61\,248} \\

\bottomrule
\end{longtable}

\newpage

\subsection{Options recommandées}

\begin{longtable}{
@{}
p{0.04\textwidth}
p{0.14\textwidth}
p{0.22\textwidth}
p{0.26\textwidth}
p{0.08\textwidth}
p{0.08\textwidth}
p{0.08\textwidth}
p{0.08\textwidth}
@{}}
\caption{Options recommandées}
\label{tab:options}\\

\toprule
\textbf{\#} &
\textbf{Service} &
\textbf{Rôle} &
\textbf{Formule / base de calcul} &
\textbf{A/mois} &
\textbf{A/an} &
\textbf{B/mois} &
\textbf{B/an} \\
\midrule
\endfirsthead

\toprule
\textbf{\#} &
\textbf{Service} &
\textbf{Rôle} &
\textbf{Formule / base de calcul} &
\textbf{A/mois} &
\textbf{A/an} &
\textbf{B/mois} &
\textbf{B/an} \\
\midrule
\endhead

9 &
\textbf{Anthropic API} &
Modèle de repli ou second avis pour l'assistant
(\texttt{ANTHROPIC\_API\_KEY}) &
Budget d'usage plafonné ; Claude Sonnet
$\approx$3/15 USD par million de tokens &
200 &
2\,400 &
300 &
3\,600 \\

10 &
\textbf{Microsoft Power BI}
(Fabric) &
Onglet \textit{Power BI Embedded Report} :
rapports interactifs pour les décideurs &
Fabric F2 $\approx$263 USD + 5 licences Pro $\times$14 USD (A) ;
Fabric F4 $\approx$526 USD + 8 licences Pro (B).
Aujourd'hui : lien public « Publier sur le web » gratuit, transitoire.
Alternative Azure Power BI Embedded SKU A détaillée à la section
\ref{sec:azure-powerbi} &
333 &
3\,996 &
568 &
6\,816 \\

11 &
\textbf{Sentry} &
Suivi des erreurs applicatives front-end et back-end,
en complément de CloudWatch &
Plan \textit{Team} : 26 USD &
26 &
312 &
26 &
312 \\

\midrule

\multicolumn{4}{r}{\textbf{Sous-total options}} &
\textbf{559} &
\textbf{6\,708} &
\textbf{894} &
\textbf{10\,728} \\

\midrule

\multicolumn{4}{r}{\textbf{TOTAL GÉNÉRAL}} &
\textbf{$\approx$4\,400} &
\textbf{$\approx$52\,800} &
\textbf{$\approx$6\,000} &
\textbf{$\approx$72\,000} \\

\bottomrule
\end{longtable}

% --------------------------------------------------

\end{landscape}

% --------------------------------------------------
% ==================================================
\section{Détail OpenAI --- méthode de calcul}
% ==================================================

\begin{table}[htbp]
\centering
\small
\caption{Méthode de calcul du coût OpenAI}
\label{tab:openai}

\begin{tabularx}{\textwidth}{p{0.28\textwidth} Y p{0.22\textwidth}}
\toprule
\textbf{Élément} &
\textbf{Hypothèse} &
\textbf{Coût unitaire} \\
\midrule

Question à l'assistant
(\texttt{gpt-4o}) &
$\sim$15\,000 tokens en entrée
(contexte DHIS2 + consignes),
$\sim$1\,500 en sortie &
0,0375 + 0,015 =
\textbf{0,0525 USD} \\

Nœuds internes de l'agent
(\texttt{gpt-4o-mini}) &
$\sim$20\,000 tokens entrée,
$\sim$2\,000 sortie &
0,003 + 0,0012 =
\textbf{0,0042 USD} \\

\textbf{Coût par question} &
&
\textbf{$\approx$0,057 USD} \\

Rapport IA complet &
$\sim$10 appels,
$\sim$150\,000 tokens cumulés &
\textbf{$\approx$0,50 USD} \\

\textbf{Scénario A} &
33\,000 questions + 500 rapports &
1\,880 + 250 =
\textbf{$\approx$2\,100 USD/mois} \\

\textbf{Scénario B} &
50\,000 questions + 750 rapports &
2\,850 + 375 =
\textbf{$\approx$2\,900 USD/mois} \\

\bottomrule
\end{tabularx}
\end{table}

%==================================================
\section{Points d'attention}
\label{sec:attention}
% ==================================================

\begin{enumerate}[leftmargin=1.8em]

\item \textbf{Supabase.}

Au-delà d'environ 2\,000 utilisateurs actifs simultanés ou de 8 Go
de base de données, un passage au compute \textit{Large} pourrait
être nécessaire, soit un surcoût d'environ 50 USD/mois.

\item \textbf{Cameroun.}

Le DHIS2 camerounais utilise des identifiants d'indicateurs et une
hiérarchie d'unités d'organisation différents de ceux du SNIS RDC.

Le coût d'adaptation de l'ETL constitue un coût de développement et
non un coût de service tiers. Il n'est donc pas chiffré dans le présent
document.

\item \textbf{Variation des prix.}

Les tarifs des services d'IA évoluent régulièrement. Les tarifs cloud
et les taux de change sont également susceptibles de varier.

Une \textbf{réserve de 10 à 15\,\%} sur les montants annuels est
recommandée.

\end{enumerate}

% ==================================================
\section{Récapitulatif annuel}
% ==================================================

\begin{table}[htbp]
\centering
\small
\caption{Récapitulatif annuel}
\label{tab:recap}

\begin{tabularx}{\textwidth}{p{0.50\textwidth} R R}
\toprule
&
\textbf{Scénario A --- RDC} &
\textbf{Scénario B --- RDC + Cameroun} \\
\midrule

Services indispensables &
\textbf{46\,100 USD/an} &
\textbf{61\,200 USD/an} \\

Options recommandées &
+6\,700 USD/an &
+10\,700 USD/an \\

Réserve 10\,\% &
+5\,300 USD/an &
+7\,200 USD/an \\

\midrule

\textbf{Enveloppe budgétaire conseillée} &
\textbf{$\approx$58\,000 USD/an} &
\textbf{$\approx$79\,000 USD/an} \\

Enveloppe après leviers de maîtrise IA &
$\approx$45\,000 USD/an &
$\approx$62\,000 USD/an \\

\bottomrule
\end{tabularx}
\end{table}

\newpage

% ==================================================
\section{Plan de maintenance, support et exploitation}
% ==================================================

\subsection*{Synthèse pour décision}

\begin{center}
\colorbox{SIVAXLight}{
\begin{minipage}{0.92\textwidth}
\small
\textbf{Principe recommandé :}

\medskip

\textbf{1. Maintenance et support :}
forfait récurrent SOLIS, indicativement
\textbf{4,000 USD/mois --- 48,000 USD/an} pour le périmètre RDC.

\medskip

\textbf{2. Infrastructure et services tiers :}
budgétés séparément, conformément aux enveloppes présentées dans
le présent document.

\medskip

\textbf{3. Évolutions majeures :}
facturées séparément sur devis.

\medskip

\textbf{4. Extension Cameroun :}
révision du forfait et du SLA en fonction du nouveau périmètre,
des utilisateurs, des sources DHIS2 et des exigences opérationnelles.

\end{minipage}
}
\end{center}


La continuité de service de SIVAX nécessite un dispositif permanent de
maintenance, de supervision et d'assistance technique. Afin d'assurer à la
fois la disponibilité de la plateforme et la prévisibilité des coûts, il est
recommandé de distinguer clairement les \textbf{services tiers} des
\textbf{prestations de maintenance et de support assurées par SOLIS}.

Le modèle repose sur un \textbf{contrat annuel de maintenance et
support à facturation récurrente}, complété par une facturation séparée des
évolutions fonctionnelles importantes.

\begin{table}[htbp]
\centering
\small
\caption{Structure recommandée du dispositif contractuel}
\label{tab:maintenance}
\begin{tabularx}{\textwidth}{p{0.30\textwidth} p{0.24\textwidth} Y}
\toprule
\textbf{Composante} &
\textbf{Mode de facturation} &
\textbf{Périmètre} \\
\midrule

\textbf{Maintenance et support} &
Forfait récurrent &
Supervision, maintenance corrective, mises à jour, sécurité,
sauvegardes, assistance technique, gestion des incidents et suivi
de la performance. \\

\textbf{Services tiers} &
Coûts réels / refacturation &
AWS, OpenAI, Power BI, Supabase, ElevenLabs, Resend et autres
services nécessaires au fonctionnement de la plateforme. \\

\textbf{Évolutions majeures} &
Devis / bon de commande &
Nouveaux modules, nouvelles intégrations DHIS2, extensions
géographiques, fonctionnalités IA et modifications importantes
du périmètre fonctionnel. \\

\bottomrule
\end{tabularx}
\end{table}

\subsection*{2. Forfait indicatif SOLIS}

Pour le périmètre national RDC, un forfait de référence de l'ordre de
\textbf{4,000 USD par mois}, soit \textbf{48,000 USD par an}, peut être
retenu pour la maintenance, le support et l'exploitation technique de SIVAX.

Ce forfait serait contractualisé pour une durée de \textbf{12 mois
renouvelables}, avec une facturation trimestrielle ou semestrielle.

\textbf{\textcolor{red}{Il ne comprend pas les coûts des services tiers ni les développements
évolutifs majeurs.}}

\newpage

\subsection*{3. Principe de séparation des coûts}

\begin{itemize}[leftmargin=1.5em]
\item les \textbf{coûts AWS, OpenAI, Power BI et autres services tiers}
sont suivis séparément et peuvent être révisés en fonction de la
consommation réelle ;

\item les \textbf{incidents et opérations relevant du périmètre de
maintenance} sont couverts par le forfait ;

\item les \textbf{évolutions fonctionnelles significatives} font l'objet
d'un devis distinct ;

\item les prestations dépassant le volume d'intervention prévu au
contrat peuvent être facturées sur la base d'un tarif journalier ou
horaire préalablement convenu.

\end{itemize}

\end{document}