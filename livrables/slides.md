\documentclass[aspectratio=169,10pt]{beamer}

% --------------------------------------------------
% Packages
% --------------------------------------------------
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage[french]{babel}
\usepackage{lmodern}
\usepackage{booktabs}
\usepackage{array}
\usepackage{colortbl}

% --------------------------------------------------
% Couleurs (identiques à cost.md)
% --------------------------------------------------
\definecolor{SIVAXBlue}{HTML}{1D4ED8}
\definecolor{SIVAXDark}{HTML}{1E293B}
\definecolor{SIVAXLight}{HTML}{EFF6FF}
\definecolor{TableGray}{HTML}{F8FAFC}
\definecolor{SIVAXGreen}{HTML}{15803D}
\definecolor{SIVAXOrange}{HTML}{C2410C}

% --------------------------------------------------
% Thème
% --------------------------------------------------
\usetheme{default}
\setbeamertemplate{navigation symbols}{}
\setbeamercolor{frametitle}{fg=white,bg=SIVAXBlue}
\setbeamerfont{frametitle}{size=\large,series=\bfseries}
\setbeamercolor{normal text}{fg=SIVAXDark}
\setbeamercolor{structure}{fg=SIVAXBlue}
\setbeamertemplate{itemize item}{\color{SIVAXBlue}$\blacktriangleright$}
\setbeamertemplate{frametitle}{%
  \nointerlineskip
  \begin{beamercolorbox}[wd=\paperwidth,ht=2.6ex,dp=1.4ex,leftskip=0.6cm]{frametitle}
    \usebeamerfont{frametitle}\insertframetitle
    \hfill{\normalsize\mdseries\insertframesubtitle}\hspace*{0.6cm}
  \end{beamercolorbox}%
}
\setbeamertemplate{footline}{%
  \begin{beamercolorbox}[wd=\paperwidth,ht=2.2ex,dp=1ex,leftskip=0.6cm,rightskip=0.6cm]{normal text}
    \tiny\color{gray}\textbf{SIVAX} --- Présentation aux décideurs\hfill
    Montants en USD, tarifs publics à la demande --- \insertframenumber/\inserttotalframenumber
  \end{beamercolorbox}%
}

% --------------------------------------------------
% Macros
% --------------------------------------------------
% Carte de contenu : \sivaxcard{largeur}{hauteur}{titre}{texte}
\newcommand{\sivaxcard}[4]{%
  \colorbox{SIVAXLight}{%
    \begin{minipage}[t][#2][t]{#1}
      \vspace{0.5ex}
      {\small\bfseries\color{SIVAXBlue}#3\par}
      \vspace{0.4ex}
      {\scriptsize #4\par}
    \end{minipage}}%
}

% Chiffre clé : \keyfigure{valeur}{libellé}
\newcommand{\keyfigure}[2]{%
  {\Large\bfseries\color{SIVAXBlue}#1\par}
  {\scriptsize #2\par}
  \vspace{1.2ex}
}

\begin{document}

% ==================================================
% SLIDE 1 --- COÛT TOTAL DE FONCTIONNEMENT
% ==================================================
\begin{frame}{Coût annuel de fonctionnement de SIVAX}{Services tiers + maintenance et support}

\vspace{-0.5ex}
\begin{columns}[T,onlytextwidth]

% ---------- Colonne gauche : tableau ----------
\begin{column}{0.64\textwidth}

{\small\bfseries Enveloppe annuelle prévisionnelle (USD/an)\par}
\vspace{0.6ex}

\scriptsize
\renewcommand{\arraystretch}{1.25}
\begin{tabular}{@{}p{0.50\linewidth} >{\raggedleft\arraybackslash}p{0.19\linewidth} >{\raggedleft\arraybackslash}p{0.23\linewidth}@{}}
\toprule
\textbf{Poste} & \textbf{RDC} & \textbf{RDC + Cameroun} \\
\midrule
Services indispensables\newline
{\tiny\color{gray}AWS, OpenAI, Supabase, ElevenLabs, Resend, domaine, GitHub} &
46\,100 & 61\,200 \\
Options recommandées\newline
{\tiny\color{gray}IA de repli, Power BI, suivi des erreurs} &
6\,700 & 10\,700 \\
Réserve de prudence (10\,\%) &
5\,300 & 7\,200 \\
\rowcolor{TableGray}
\textbf{Sous-total services tiers} &
\textbf{$\approx$58\,000} & \textbf{$\approx$79\,000} \\
Maintenance et support SOLIS\newline
{\tiny\color{gray}forfait 4\,000 USD/mois, 12 mois renouvelables} &
48\,000 & à réviser\textsuperscript{*} \\
\midrule
\rowcolor{SIVAXLight}
\textbf{Coût total de fonctionnement} &
\textbf{\color{SIVAXBlue}$\approx$106\,000} &
\textbf{\color{SIVAXBlue}$\approx$79\,000 + forfait} \\
\bottomrule
\end{tabular}

\vspace{0.4ex}
{\tiny\color{gray}\textsuperscript{*} Forfait et SLA révisés selon le périmètre Cameroun
(utilisateurs, seconde source DHIS2, exigences opérationnelles).
Les évolutions majeures (nouveaux modules, intégrations, extensions) sont facturées sur devis.\par}

\vspace{1ex}
\sivaxcard{0.97\linewidth}{1.55cm}{Ce que couvre le forfait maintenance et support}{%
Supervision de la plateforme \textperiodcentered{} maintenance corrective
\textperiodcentered{} mises à jour et sécurité \textperiodcentered{} sauvegardes
\textperiodcentered{} assistance technique aux utilisateurs
\textperiodcentered{} gestion des incidents \textperiodcentered{} suivi de la performance
et des synchronisations DHIS2.\\[0.4ex]
\textbf{Non inclus :} coûts des services tiers (suivis et refacturés au réel) et
évolutions fonctionnelles majeures.}

\end{column}

% ---------- Colonne droite : chiffres clés ----------
\begin{column}{0.33\textwidth}

\colorbox{SIVAXLight}{%
\begin{minipage}[t][5.55cm][t]{0.92\linewidth}
\vspace{1ex}
{\small\bfseries Ce que cela représente (RDC)\par}
\vspace{1.2ex}

\keyfigure{$\approx$8\,800 USD/mois}{pour l'ensemble du service, clé en main}

\keyfigure{$\approx$5,9 USD}{par utilisateur et par mois\\(1\,500 utilisateurs enregistrés)}

\keyfigure{$\approx$11 USD}{par aire de santé et par an\\(26 provinces, 519 zones, $\sim$9\,600 aires)}

{\scriptsize\bfseries\color{SIVAXOrange}Poste à piloter : l'IA\par}
{\tiny L'API OpenAI représente plus de la moitié des services tiers et
évolue avec l'usage. Des leviers de maîtrise ramènent les services tiers à
$\approx$45\,000 USD/an (RDC).\par}
\end{minipage}}

\end{column}
\end{columns}

\vspace{0.6ex}
{\tiny\color{gray}Projections budgétaires, non contractuelles, à recalibrer sur la
consommation réelle après le pilote et à chaque étape de montée en charge.\par}

\end{frame}

% ==================================================
% SLIDE 2 --- EXPÉRIENCE UTILISATEUR
% ==================================================
\begin{frame}{De la donnée DHIS2 à la décision, en quelques clics}{L'expérience utilisateur SIVAX}

\vspace{-0.5ex}
{\small Les décideurs n'ont plus à extraire, croiser et mettre en forme les données du
SNIS : SIVAX leur apporte la réponse, directement exploitable.\par}

\vspace{1ex}
\centering
\sivaxcard{0.305\textwidth}{1.95cm}{Poser une question, obtenir la réponse}{%
Assistant IA conversationnel en français et en anglais, \textbf{saisie vocale}
incluse. Les réponses sont vérifiées sur les données DHIS2 avant d'être affichées.}\hfill
\sivaxcard{0.305\textwidth}{1.95cm}{Affichage immédiat}{%
Les tableaux de bord s'appuient sur des données synchronisées automatiquement
chaque semaine : plus d'attente sur un SNIS lent ($>$60 s par requête).}\hfill
\sivaxcard{0.305\textwidth}{1.95cm}{Lecture en un coup d'\oe il}{%
Indicateurs PEV colorés selon les \textbf{seuils OMS}
({\color{SIVAXGreen}conforme}, {\color{SIVAXOrange}à surveiller}, {\color{red}critique}),
cartes, tendances, du national jusqu'à l'aire de santé.}

\vspace{1.2ex}
\sivaxcard{0.305\textwidth}{1.95cm}{Rapports prêts à partager}{%
Rapports d'analyse générés par l'IA en quelques minutes, exportables
(PDF, PowerPoint) pour les réunions et comités de pilotage.}\hfill
\sivaxcard{0.305\textwidth}{1.95cm}{Alertes proactives}{%
Notifications par e-mail et sur le téléphone : baisse de couverture,
hausse des abandons, seuils critiques franchis. L'information vient à l'utilisateur.}\hfill
\sivaxcard{0.305\textwidth}{1.95cm}{Accessible et sûr}{%
Application installable sur ordinateur, tablette et mobile. Accès par rôle,
actions sensibles de l'assistant soumises à \textbf{validation humaine}.}

\vspace{1.4ex}
\colorbox{SIVAXBlue}{%
\begin{minipage}{0.97\textwidth}
\centering\vspace{0.6ex}
\color{white}\scriptsize
\begin{tabular}{@{}p{0.47\linewidth} p{0.47\linewidth}@{}}
\textbf{Sans SIVAX} & \textbf{Avec SIVAX} \\
Extractions manuelles, fichiers Excel, plusieurs outils,
plusieurs jours pour consolider une situation provinciale. &
Une seule plateforme, une question en langage naturel, une réponse
chiffrée et un rapport partageable en quelques minutes. \\
\end{tabular}
\vspace{0.4ex}
\end{minipage}}

\end{frame}

\end{document}
