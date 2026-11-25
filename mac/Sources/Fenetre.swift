// La fenêtre de l'app : barre à la charte + deux navigateurs intégrés qui partagent les mêmes cookies
// (connexion Le Bon Coin et RetroRevente gardées d'une fois sur l'autre) :
// - « appli » : retrorevente.fr/app (avec appli.js de l'extension) ;
// - « lbc » : leboncoin.fr (avec lbc.js : remplissage du dépôt, panneau IA des messages, synchro de « Mes annonces »).
import AppKit
import WebKit
import SwiftUI

enum Vue { case appli, lbc }

enum Rubrique: Int, CaseIterable {
    case appli, deposer, messages, annonces
    var titre: String { ["RetroRevente", "Déposer", "Messages", "Mes annonces"][rawValue] }
    var symbole: String { ["gamecontroller", "plus.app", "bubble.left.and.bubble.right", "list.bullet.rectangle"][rawValue] }
    var aide: String { ["Ton appli RetroRevente", "Déposer une annonce sur Le Bon Coin", "Ta messagerie Le Bon Coin, avec les réponses IA", "Tes annonces en ligne sur Le Bon Coin"][rawValue] }
    var adresse: URL {
        URL(string: ["\(Actions.serveurDefaut)/app/", "https://www.leboncoin.fr/deposer-une-annonce", "https://www.leboncoin.fr/messages", "https://www.leboncoin.fr/compte/part/mes-annonces"][rawValue])!
    }
    /// La rubrique Le Bon Coin d'une adresse (pour allumer le bon onglet).
    static func de(_ url: URL?) -> Rubrique? {
        let p = url?.path ?? ""
        if p.hasPrefix("/deposer-une-annonce") { return .deposer }
        if p.hasPrefix("/messages") { return .messages }
        if p.contains("mes-annonces") || p.hasPrefix("/compte") { return .annonces }
        return nil
    }
}

@MainActor
final class Fenetre: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    let fenetre: NSWindow
    let actions = Actions()
    private lazy var pont = Pont(actions: actions)
    private let ressources = Ressources()
    let modele = Appli()
    private var natif: NSView!
    private var appli: WKWebView!
    var lbc: WKWebView!
    private(set) var visible: Vue = .appli
    var lbcCharge = false
    /// Dépôt en coulisses : Le Bon Coin travaille sous la vue native (voir Coulisses.swift).
    var enCoulisses = false
    var veilleCoulisses: Timer?
    var debutCoulisses = Date(), etapeDepuis = Date()
    var reglageAuto: Any? = nil, autoSuspendu = false
    var annonceAVerifier: String? = nil   // article dont on ouvre l'annonce : on vérifie qu'elle est encore en ligne
    private var onglets: [Rubrique: Bouton] = [:]
    private var precedent: Bouton!, suivant: Bouton!, recharger: Bouton!
    private let chargement = Chargement()
    private var observations: [NSKeyValueObservation] = []
    private var fenetresSurgissantes: [NSWindow: WKWebView] = [:]
    private lazy var compte = BulleCompte(fenetre: self)

    override init() {
        fenetre = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
                           styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        super.init()
        actions.fenetre = self
        fenetre.title = "RetroRevente"
        fenetre.titleVisibility = .hidden
        fenetre.titlebarAppearsTransparent = true
        fenetre.backgroundColor = Charte.nuit
        fenetre.minSize = NSSize(width: 860, height: 560)
        fenetre.delegate = self
        fenetre.isReleasedWhenClosed = false
        fenetre.tabbingMode = .disallowed
        if #available(macOS 11.0, *) { fenetre.toolbarStyle = .unified; fenetre.titlebarSeparatorStyle = .none }
        // Barre d'outils vide : elle donne une barre de titre haute, feux centrés. Nos boutons sont posés dedans
        // (pas d'éléments de barre d'outils, que macOS 26 enferme dans des pastilles de verre claires).
        let barreOutils = NSToolbar(identifier: "RetroRevente")
        barreOutils.allowsUserCustomization = false
        fenetre.toolbar = barreOutils

        appli = creerNavigateur()
        lbc = creerNavigateur()
        // macOS 26 : les pages passent sous la barre de verre.
        if Charte.verre { fenetre.styleMask.insert(.fullSizeContentView) }
        let contenu = NSView()
        // RetroRevente : écrans natifs (SwiftUI). La vue web « appli » ne sert plus qu'en secours.
        modele.fenetre = self
        // Un clic dans la fenêtre, en dehors de la feuille ouverte (nouvel article, dépôt…), la referme,
        // sauf pendant une publication ou un envoi en cours.
        NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] e in
            guard let self = self, let w = e.window, let feuille = w.attachedSheet else { return e }
            // Feuille posée sur une feuille (aperçu des photos de l'app Photos au-dessus de « Nouvel article ») : on ferme celle du dessus.
            if let dessus = feuille.attachedSheet { Fenetre.fermer(dessus, sur: feuille); return nil }
            if w === self.fenetre, self.fermerFeuille() { return nil }
            Fenetre.fermer(feuille, sur: w)   // autre feuille (aperçu des photos, choix de fichier…)
            return nil
        }
        // Données à jour : au retour dans l'app, et toutes les 90 s pendant qu'elle est au premier plan.
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.modele.rafraichir() }
        }
        Timer.scheduledTimer(withTimeInterval: 90, repeats: true) { [weak self] _ in
            Task { @MainActor in if NSApp.isActive { self?.modele.rafraichir(apres: 80) } }
        }
        let hote = NSHostingView(rootView: Racine(appli: modele))
        hote.sizingOptions = []   // la fenêtre garde sa taille, quel que soit l'écran affiché
        natif = hote
        appli.isHidden = true
        for v in [appli!, lbc!, natif!] { v.translatesAutoresizingMaskIntoConstraints = false; contenu.addSubview(v) }
        chargement.translatesAutoresizingMaskIntoConstraints = false
        contenu.addSubview(chargement)
        var c: [NSLayoutConstraint] = []
        for v in [appli!, lbc!, natif!] {
            c += [v.leadingAnchor.constraint(equalTo: contenu.leadingAnchor), v.trailingAnchor.constraint(equalTo: contenu.trailingAnchor),
                  v.topAnchor.constraint(equalTo: contenu.topAnchor), v.bottomAnchor.constraint(equalTo: contenu.bottomAnchor)]
        }
        c += [chargement.leadingAnchor.constraint(equalTo: contenu.leadingAnchor), chargement.trailingAnchor.constraint(equalTo: contenu.trailingAnchor),
              chargement.heightAnchor.constraint(equalToConstant: 2)]
        NSLayoutConstraint.activate(c)
        fenetre.contentView = contenu
        if Charte.verre, let guide = fenetre.contentLayoutGuide as? NSLayoutGuide {
            chargement.topAnchor.constraint(equalTo: guide.topAnchor).isActive = true
        } else {
            chargement.topAnchor.constraint(equalTo: contenu.topAnchor).isActive = true
        }
        fenetre.setFrameAutosaveName("RetroRevente")
        if !fenetre.setFrameUsingName("RetroRevente") { fenetre.center() }

        for v in [appli!, lbc!] {
            observations.append(v.observe(\.estimatedProgress, options: [.new]) { [weak self] _, _ in Task { @MainActor in self?.majBarre() } })
            observations.append(v.observe(\.url, options: [.new]) { [weak self] _, _ in Task { @MainActor in self?.majBarre() } })
            observations.append(v.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in Task { @MainActor in self?.majBarre() } })
        }
        installerBarre()
        ajusterSousLeVerre()
        montrer(.appli)
        // Bloqueur de pubs prêt avant la première page.
        Bloqueur.preparer { [weak self] liste in
            guard let self = self else { return }
            if let l = liste { for v in [self.appli!, self.lbc!] { v.configuration.userContentController.add(l) } }
        }
        // Captures automatiques (GitHub) : RR_DEMO=deposer|messages|annonces|compte.
        if let demo = ProcessInfo.processInfo.environment["RR_DEMO"] {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                guard let self = self else { return }
                switch demo {
                case "deposer": self.allerSurLeSite(.deposer)
                case "messages": self.aller(.messages)
                case "annonces": self.aller(.annonces)
                case "compte-lbc": self.afficherCompte(nil)
                default: break
                }
            }
        }
    }

    /// Clé WebCrypto donnée par l'app (voir CleWebCrypto.swift) : plus de mot de passe du trousseau après une mise à jour.
    @objc(_webCryptoMasterKeyForWebView:) func cleMaitresse(_ w: WKWebView) -> NSData? { CleWebCrypto.cle as NSData }
    @objc(_webCryptoMasterKeyForWebView:completionHandler:) func cleMaitresse(_ w: WKWebView, completionHandler: @escaping (NSData?) -> Void) {
        completionHandler(CleWebCrypto.cle as NSData)
    }

    private func creerNavigateur(_ conf: WKWebViewConfiguration? = nil) -> WKWebView {
        let conf = conf ?? configuration()
        let v = WKWebView(frame: .zero, configuration: conf)
        v.navigationDelegate = self
        v.uiDelegate = self
        v.allowsBackForwardNavigationGestures = true
        v.allowsMagnification = true
        if #available(macOS 13.3, *) { v.isInspectable = true }
        return v
    }

    /// Navigateur caché de la messagerie native : mêmes cookies et scripts, sans panneau ni automatismes (__rrNatif).
    func navigateurCache() -> WKWebView {
        let conf = configuration()
        conf.userContentController.addUserScript(WKUserScript(source: "window.__rrNatif = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true, in: Scripts.monde))
        let v = creerNavigateur(conf)
        v.uiDelegate = DelegueWebCrypto.partage   // pas de fenêtres surgissantes, mais la clé WebCrypto sans trousseau
        return v
    }

    /// Même réglages pour les deux navigateurs : cookies gardés, identité Safari, scripts RetroRevente.
    private func configuration() -> WKWebViewConfiguration {
        let conf = WKWebViewConfiguration()
        conf.websiteDataStore = .default()
        conf.applicationNameForUserAgent = Fenetre.identiteSafari
        conf.preferences.javaScriptCanOpenWindowsAutomatically = true
        conf.setURLSchemeHandler(ressources, forURLScheme: "rrext")
        conf.userContentController.addScriptMessageHandler(pont, contentWorld: Scripts.monde, name: "rr")
        Scripts.pages().forEach(conf.userContentController.addUserScript)
        conf.userContentController.addUserScript(Scripts.cookies())
        return conf
    }

    /// Le Bon Coin voit un Safari ordinaire (version de Safari livrée avec ce macOS).
    static let identiteSafari: String = {
        let os = ProcessInfo.processInfo.operatingSystemVersion.majorVersion
        let safari = os >= 26 ? os : os + 3   // macOS 15 → Safari 18, macOS 26 → Safari 26
        return "Version/\(safari).0 Safari/605.1.15"
    }()

    /// Configuration du panneau « Compte » (popup.html de l'extension).
    func configurationPanneau() -> WKWebViewConfiguration {
        let conf = WKWebViewConfiguration()
        conf.websiteDataStore = .default()
        conf.setURLSchemeHandler(ressources, forURLScheme: "rrext")
        conf.userContentController.addScriptMessageHandler(pont, contentWorld: .page, name: "rr")
        conf.userContentController.addUserScript(Scripts.panneau())
        return conf
    }

    // MARK: Affichage

    func montrerFenetre() {
        fenetre.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func montrer(_ vue: Vue) {
        visible = vue
        natif.isHidden = vue != .appli
        // En coulisses, Le Bon Coin reste « affiché » sous la vue native : WebKit ne le met pas en veille.
        lbc.isHidden = vue != .lbc && !enCoulisses
        fenetre.makeFirstResponder(vue == .appli ? natif : lbc)
        majBarre()
    }

    func estVisible(_ v: WKWebView) -> Bool { fenetre.isVisible && !fenetre.isMiniaturized && visible == .lbc && v === lbc }
    private var actuel: WKWebView { lbc }

    func aller(_ r: Rubrique) {
        montrerFenetre()
        // Messages : la messagerie native ; Le Bon Coin reste caché en fond.
        if r == .messages, modele.etat == .connecte { modele.messagesOuvert = true; montrer(.appli); return }
        modele.messagesOuvert = false
        if r == .appli { montrer(.appli); return }
        // Déposer : dans l'app, on choisit l'article ; Le Bon Coin travaille en coulisses, sans jamais s'afficher.
        if r == .deposer, modele.etat == .connecte { montrer(.appli); modele.selection = nil; modele.choixDepot = true; return }
        allerSurLeSite(r)
    }
    /// Le Bon Coin à l'écran (Messages, Mes annonces, ou le dépôt quand la personne le demande).
    func allerSurLeSite(_ r: Rubrique) {
        montrerFenetre()
        modele.messagesOuvert = false
        // Déjà sur la bonne page Le Bon Coin : on la montre sans la recharger (un dépôt en cours n'est pas perdu).
        if !lbcCharge || Rubrique.de(lbc.url) != r { lbc.load(URLRequest(url: r.adresse)); lbcCharge = true }
        montrer(.lbc)
    }

    /// Ouvre une adresse dans le bon navigateur (lien « Le Bon Coin » d'une fiche, « Ouvrir Mon compte »…).
    /// Vue de vérification des annonces : posée tout au fond de la fenêtre, sous l'app, jamais visible.
    /// Dans la fenêtre, Le Bon Coin la traite comme une vraie page (sans fenêtre, son anti-robot la bloque).
    /// `taille` : taille fixe (messagerie : assez large pour que Le Bon Coin montre la liste ET la conversation,
    /// quelle que soit la taille de la fenêtre).
    func accueillirEnFond(_ v: NSView, taille: NSSize? = nil) {
        guard let c = fenetre.contentView, v.superview !== c else { return }
        v.translatesAutoresizingMaskIntoConstraints = false
        c.addSubview(v, positioned: .below, relativeTo: nil)
        if let t = taille {
            NSLayoutConstraint.activate([v.leadingAnchor.constraint(equalTo: c.leadingAnchor), v.topAnchor.constraint(equalTo: c.topAnchor),
                                         v.widthAnchor.constraint(equalToConstant: t.width), v.heightAnchor.constraint(equalToConstant: t.height)])
            return
        }
        NSLayoutConstraint.activate([v.leadingAnchor.constraint(equalTo: c.leadingAnchor), v.trailingAnchor.constraint(equalTo: c.trailingAnchor),
                                     v.topAnchor.constraint(equalTo: c.topAnchor), v.bottomAnchor.constraint(equalTo: c.bottomAnchor)])
    }

    static func fermer(_ feuille: NSWindow, sur w: NSWindow) {
        if let vc = feuille.contentViewController, vc.presentingViewController != nil { vc.dismiss(nil) } else { w.endSheet(feuille, returnCode: .cancel) }
    }
    /// Ferme la feuille ouverte comme son bouton « Annuler ». Renvoie false si elle doit rester (action en cours).
    @discardableResult func fermerFeuille() -> Bool {
        if let d = modele.depot { if d.etape == .publication { return false }; annulerCoulisses(); return true }
        if let g = modele.gestion { if g.etape == .envoi { return false }; modele.gestion = nil; return true }
        if modele.nouveauOuvert { modele.nouveauOuvert = false; return true }
        if modele.choixDepot { modele.choixDepot = false; return true }
        return false
    }

    func ouvrir(_ url: URL) {
        switch Fenetre.destination(url) {
        case .appli?:
            // L'appli RetroRevente est native : « Mon compte » ouvre la fiche compte, le reste s'ouvre sur le site.
            guard url.path.hasPrefix("/app") else { NSWorkspace.shared.open(url); return }
            montrer(.appli); montrerFenetre()
            if url.query?.contains("compte") == true { modele.compteOuvert = modele.etat == .connecte }
        case .lbc?: lbc.load(URLRequest(url: url)); lbcCharge = true; montrer(.lbc); montrerFenetre()
        case nil: NSWorkspace.shared.open(url)
        }
    }
    static func destination(_ url: URL) -> Vue? {
        let h = url.host?.lowercased() ?? ""
        if h == "retrorevente.fr" || h == "www.retrorevente.fr" { return .appli }
        if h == "leboncoin.fr" || h.hasSuffix(".leboncoin.fr") { return .lbc }
        if (h == "localhost" || h == "127.0.0.1") && url.path.hasPrefix("/app") { return .appli }
        return nil
    }

    private func majBarre() {
        let rubrique: Rubrique? = visible == .appli ? (modele.messagesOuvert ? .messages : .appli) : Rubrique.de(lbc.url)
        for (r, b) in onglets { b.actif = r == rubrique }
        let web = visible == .lbc
        precedent?.disponible = web && lbc.canGoBack
        suivant?.disponible = web && lbc.canGoForward
        recharger?.disponible = web || modele.etat == .connecte
        chargement.progression = web && lbc.isLoading ? lbc.estimatedProgress : 1
    }

    // MARK: Après une publication : retour sur l'appli, qui fait la fête (confettis)

    func publiee(id: String, titre: String, url: String) {
        modele.deposee(id: id)   // pas encore en ligne : Le Bon Coin doit d'abord valider l'annonce
        // Publiée depuis l'app (en coulisses) : la fête tout de suite, Le Bon Coin n'a jamais été à l'écran.
        if enCoulisses || modele.depot != nil {
            modele.depot = nil
            montrer(.appli); modele.publiee(titre: titre)
            return
        }
        // Le temps de voir « Annonce envoyée » et d'entendre les confettis sur Le Bon Coin, puis la fête dans l'app.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
            guard let self = self else { return }
            self.montrer(.appli); self.montrerFenetre(); self.modele.publiee(titre: titre)
        }
    }

    // MARK: Menus et raccourcis

    @objc func allerAppli(_ s: Any?) { aller(.appli) }
    @objc func allerDeposer(_ s: Any?) { aller(.deposer) }
    @objc func allerMessages(_ s: Any?) { aller(.messages) }
    @objc func allerAnnonces(_ s: Any?) { aller(.annonces) }
    @objc func precedente(_ s: Any?) { if visible == .lbc { lbc.goBack() } }
    @objc func suivante(_ s: Any?) { if visible == .lbc { lbc.goForward() } }
    @objc func rechargerPage(_ s: Any?) { if visible == .lbc { lbc.reload() } else { Task { await modele.recharger() } } }
    @objc func nouvelArticle(_ s: Any?) { aller(.appli); if modele.etat == .connecte { modele.nouveauOuvert = true } }
    @objc func basculerBarre(_ s: Any?) { aller(.appli); modele.barreCachee.toggle() }
    @objc func chercherArticle(_ s: Any?) { aller(.appli); modele.selection = nil; modele.focusRecherche += 1 }
    @objc func siteWeb(_ s: Any?) { modele.ouvrirSurLeWeb() }
    @objc func tailleReelle(_ s: Any?) { actuel.pageZoom = 1 }
    @objc func agrandir(_ s: Any?) { actuel.pageZoom = min(3, actuel.pageZoom + 0.1) }
    @objc func reduire(_ s: Any?) { actuel.pageZoom = max(0.5, actuel.pageZoom - 0.1) }
    @objc func afficherFenetre(_ s: Any?) { montrerFenetre() }
    @objc func afficherCompte(_ s: Any?) {
        // Connecté : la fiche compte native. Sinon, l'écran de connexion.
        aller(.appli)
        if modele.etat == .connecte { modele.compteOuvert = true }
    }
    /// ⌥⇧R, comme dans l'extension : sur la page de dépôt, ouvre la recherche du panneau ; ailleurs, ouvre le dépôt.
    @objc func ouvrirRecherche(_ s: Any?) {
        if visible == .lbc, Rubrique.de(lbc.url) == .deposer {
            lbc.evaluateJavaScript("window.__rrPont && window.__rrPont.recevoir({type:'ouvrir-recherche'})", in: nil, in: Scripts.monde) { _ in }
        } else { aller(.deposer) }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if sender === fenetre { fenetre.orderOut(nil); return false }   // on garde les pages (un dépôt en cours) : ⌘Q pour quitter
        return true
    }
    func windowWillClose(_ notification: Notification) {
        guard let w = notification.object as? NSWindow else { return }
        fenetresSurgissantes.removeValue(forKey: w)
    }

    // MARK: Barre du haut (dans la barre de titre)

    private var boutonCompte: Bouton!
    private var boutonApparence: Bouton!
    private var cloche: Cloche!

    // MARK: Mode clair / sombre (choix gardé ; sans choix, l'app suit macOS)

    /// L'apparence affichée en ce moment : celle choisie, sinon celle de macOS.
    private var sombreAffiche: Bool {
        switch UserDefaults.standard.string(forKey: "apparence") {
        case "sombre": return true
        case "clair": return false
        default: return NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        }
    }
    @objc func basculerApparence(_ s: Any?) {
        UserDefaults.standard.set(sombreAffiche ? "clair" : "sombre", forKey: "apparence")
        appliquerApparence()
    }
    @objc func suivreApparenceSysteme(_ s: Any?) {
        UserDefaults.standard.removeObject(forKey: "apparence")
        appliquerApparence()
    }
    private func appliquerApparence() {
        let choix = UserDefaults.standard.string(forKey: "apparence")
        let nouvelle: NSAppearance? = choix == "sombre" ? NSAppearance(named: .darkAqua) : choix == "clair" ? NSAppearance(named: .aqua) : nil
        if let vue = fenetre.contentView, let image = vue.bitmapImageRepForCachingDisplay(in: vue.bounds) {
            // Fondu entre les deux apparences : une image de l'écran actuel s'efface par-dessus la nouvelle.
            vue.cacheDisplay(in: vue.bounds, to: image)
            let voile = NSImageView(frame: vue.bounds); voile.image = NSImage(size: vue.bounds.size); voile.image?.addRepresentation(image)
            voile.autoresizingMask = [.width, .height]
            if fenetre.isVisible, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion { vue.addSubview(voile) }
            NSApp.appearance = nouvelle
            NSAnimationContext.runAnimationGroup({ c in c.duration = 0.35; voile.animator().alphaValue = 0 }, completionHandler: { voile.removeFromSuperview() })
        } else { NSApp.appearance = nouvelle }
        let sombre = sombreAffiche
        boutonApparence?.changerSymbole(sombre ? "sun.max" : "moon", aide: sombre ? "Passer en mode clair (⇧⌘L)" : "Passer en mode sombre (⇧⌘L)")
    }
    private var margeFeux: NSLayoutConstraint!

    private func installerBarre() {
        let barre = BarreHaut()
        // Cacher / montrer la barre latérale : juste après les feux, comme dans les apps macOS (Notes, Mail…).
        // Le logo est en bas de la barre latérale, au-dessus du compte.
        let barreLaterale = Bouton(symbole: "sidebar.left", titre: nil, aide: "Cacher ou montrer la barre latérale (⌃⌘S)") { [weak self] in self?.basculerBarre(nil) }
        barreLaterale.auSurvol = { [weak self] in
            guard let m = self?.modele, m.barreCachee, self?.visible == .appli else { return }
            withAnimation(.easeOut(duration: 0.2)) { m.barreSurvol = true }
        }
        let boutons = Rubrique.allCases.map { r -> Bouton in
            let b = Bouton(symbole: r.symbole, titre: r.titre, aide: r.aide + " (⌘\(r.rawValue + 1))") { [weak self] in self?.aller(r) }
            onglets[r] = b; return b
        }
        precedent = Bouton(symbole: "chevron.left", titre: nil, aide: "Page précédente (⌘[)") { [weak self] in self?.precedente(nil) }
        suivant = Bouton(symbole: "chevron.right", titre: nil, aide: "Page suivante (⌘])") { [weak self] in self?.suivante(nil) }
        recharger = Bouton(symbole: "arrow.clockwise", titre: nil, aide: "Recharger la page (⌘R)") { [weak self] in self?.rechargerPage(nil) }
        boutonCompte = Bouton(symbole: "person.crop.circle", titre: nil, aide: "Mon compte RetroRevente (⇧⌘K)") { [weak self] in self?.afficherCompte(nil) }
        var rubriques: NSView = pile(boutons, espace: 4)
        boutonApparence = Bouton(symbole: "moon", titre: nil, aide: "") { [weak self] in self?.basculerApparence(nil) }
        appliquerApparence()
        cloche = Cloche(fenetre: self)
        var droite: NSView = pile([cloche.bouton, boutonApparence, precedent, suivant, recharger], espace: 2)
        #if compiler(>=6.2)
        if #available(macOS 26.0, *) { rubriques = capsuleDeVerre(rubriques); droite = capsuleDeVerre(droite) }
        #endif
        for v in [barreLaterale, rubriques, droite] as [NSView] { v.translatesAutoresizingMaskIntoConstraints = false; barre.addSubview(v) }
        margeFeux = barreLaterale.leadingAnchor.constraint(equalTo: barre.leadingAnchor, constant: 84)
        let centre = rubriques.centerXAnchor.constraint(equalTo: barre.centerXAnchor); centre.priority = .defaultHigh
        NSLayoutConstraint.activate([
            margeFeux,
            centre, rubriques.centerYAnchor.constraint(equalTo: barre.centerYAnchor),
            barreLaterale.centerYAnchor.constraint(equalTo: barre.centerYAnchor),
            rubriques.leadingAnchor.constraint(greaterThanOrEqualTo: barreLaterale.trailingAnchor, constant: 12),
            droite.leadingAnchor.constraint(greaterThanOrEqualTo: rubriques.trailingAnchor, constant: 12),
            droite.trailingAnchor.constraint(equalTo: barre.trailingAnchor, constant: -12), droite.centerYAnchor.constraint(equalTo: barre.centerYAnchor),
        ])
        guard let titre = fenetre.standardWindowButton(.closeButton)?.superview else { return }
        barre.translatesAutoresizingMaskIntoConstraints = false
        titre.addSubview(barre, positioned: .below, relativeTo: nil)
        NSLayoutConstraint.activate([
            barre.leadingAnchor.constraint(equalTo: titre.leadingAnchor), barre.trailingAnchor.constraint(equalTo: titre.trailingAnchor),
            barre.topAnchor.constraint(equalTo: titre.topAnchor), barre.bottomAnchor.constraint(equalTo: titre.bottomAnchor),
        ])
    }
    private func pile(_ vues: [NSView], espace: CGFloat) -> NSStackView {
        let p = NSStackView(views: vues)
        p.orientation = .horizontal; p.spacing = espace
        return p
    }
    private func separateur() -> NSView {
        let v = NSBox(); v.boxType = .custom; v.borderWidth = 0; v.fillColor = (Charte.verre ? NSColor.labelColor : NSColor.white).withAlphaComponent(0.14)
        v.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([v.widthAnchor.constraint(equalToConstant: 1), v.heightAnchor.constraint(equalToConstant: 18)])
        return v
    }
    // Plein écran : plus de feux à gauche.
    func windowWillEnterFullScreen(_ n: Notification) { margeFeux?.constant = 16 }
    func windowDidExitFullScreen(_ n: Notification) { margeFeux?.constant = 84; ajusterSousLeVerre() }
    func windowDidEnterFullScreen(_ n: Notification) { ajusterSousLeVerre() }
    func windowDidResize(_ n: Notification) { ajusterSousLeVerre() }

    /// macOS 26 : la page commence sous la barre de verre (elle y défile, et le haut de page reste visible).
    private func ajusterSousLeVerre() {
        guard appli != nil, lbc != nil else { return }
        #if compiler(>=6.2)
        if #available(macOS 26.0, *) {
            let haut = max(0, fenetre.frame.height - fenetre.contentLayoutRect.height)
            for v in [appli!, lbc!] where v.obscuredContentInsets.top != haut {
                v.obscuredContentInsets = NSEdgeInsets(top: haut, left: 0, bottom: 0, right: 0)
            }
        }
        #endif
    }

    // MARK: Navigation

    func webView(_ v: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, let schema = url.scheme?.lowercased() else { decisionHandler(.allow); return }
        if !["http", "https", "about", "data", "blob", "rrext"].contains(schema) {
            NSWorkspace.shared.open(url); decisionHandler(.cancel); return   // mailto:, tel:…
        }
        // ⌘-clic : ouvrir dans le bon navigateur plutôt que nulle part.
        if action.navigationType == .linkActivated, action.modifierFlags.contains(.command) {
            ouvrir(url); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }
    func webView(_ v: WKWebView, didFinish n: WKNavigation!) { majBarre(); if v === lbc { verifierCoulisses(); verifierAnnonce() } }
    func webView(_ v: WKWebView, didCommit n: WKNavigation!) { majBarre(); if v === lbc { verifierCoulisses() } }
    func webViewWebContentProcessDidTerminate(_ v: WKWebView) { v.reload() }

    // MARK: Fenêtres, dialogues, fichiers

    func webView(_ v: WKWebView, createWebViewWith conf: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        let url = action.request.url
        // Vraie fenêtre surgissante (connexion Apple / Google…) : elle doit garder le lien avec la page qui l'ouvre.
        if windowFeatures.width != nil || windowFeatures.height != nil || url == nil || url?.absoluteString == "about:blank" {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: CGFloat(truncating: windowFeatures.width ?? 520), height: CGFloat(truncating: windowFeatures.height ?? 680)),
                             styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            let nv = creerNavigateur(conf)
            w.contentView = nv; w.delegate = self; w.isReleasedWhenClosed = false
            w.center(); w.makeKeyAndOrderFront(nil)
            fenetresSurgissantes[w] = nv
            return nv
        }
        if let url = url { ouvrir(url) }
        compte.fermer()
        return nil
    }
    func webViewDidClose(_ v: WKWebView) {
        if let w = fenetresSurgissantes.first(where: { $0.value === v })?.key { w.close() }
    }

    func webView(_ v: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "OK")
        a.beginSheetModal(for: v.window ?? fenetre) { _ in completionHandler() }
    }
    func webView(_ v: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Annuler")
        a.beginSheetModal(for: v.window ?? fenetre) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webView(_ v: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = NSAlert(); a.messageText = prompt; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Annuler")
        let champ = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24)); champ.stringValue = defaultText ?? ""
        a.accessoryView = champ
        a.beginSheetModal(for: v.window ?? fenetre) { completionHandler($0 == .alertFirstButtonReturn ? champ.stringValue : nil) }
    }
    /// Choix de photos à la main sur Le Bon Coin.
    func webView(_ v: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let o = NSOpenPanel()
        o.allowsMultipleSelection = p.allowsMultipleSelection
        o.canChooseDirectories = p.allowsDirectories
        o.canChooseFiles = true
        o.beginSheetModal(for: v.window ?? fenetre) { completionHandler($0 == .OK ? o.urls : nil) }
    }
}

/// Le panneau « Compte » : le popup de l'extension (compte connecté, annonces prêtes), dans une bulle sous le bouton.
@MainActor
final class BulleCompte: NSObject, WKNavigationDelegate {
    private unowned let fenetre: Fenetre
    private let bulle = NSPopover()
    private lazy var vue: WKWebView = {
        let v = WKWebView(frame: NSRect(x: 0, y: 0, width: 340, height: 480), configuration: fenetre.configurationPanneau())
        v.navigationDelegate = self
        v.uiDelegate = fenetre
        v.setValue(false, forKey: "drawsBackground")
        return v
    }()
    init(fenetre: Fenetre) {
        self.fenetre = fenetre
        super.init()
        bulle.behavior = .transient
        bulle.animates = true
    }
    func basculer(depuis b: NSView?) {
        if bulle.isShown { bulle.performClose(nil); return }
        let c = NSViewController(); c.view = vue
        bulle.contentViewController = c
        bulle.contentSize = vue.frame.size
        vue.load(URLRequest(url: URL(string: "rrext://app/popup.html")!))
        if let b = b { bulle.show(relativeTo: b.bounds, of: b, preferredEdge: .minY) }
    }
    func fermer() { if bulle.isShown { bulle.performClose(nil) } }
    func webView(_ v: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = action.request.url, u.scheme == "http" || u.scheme == "https" { fenetre.ouvrir(u); fermer(); decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func webView(_ v: WKWebView, didFinish n: WKNavigation!) { ajuster() }
    /// La bulle prend la hauteur du contenu (le popup change selon que le compte est connecté ou non).
    private func ajuster() {
        for delai in [0.0, 0.4, 1.2] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delai) { [weak self] in
                self?.vue.evaluateJavaScript("document.body.scrollHeight") { r, _ in
                    guard let self = self, let h = r as? Double, h > 100 else { return }
                    self.bulle.contentSize = NSSize(width: 340, height: min(640, h))
                }
            }
        }
    }
}
