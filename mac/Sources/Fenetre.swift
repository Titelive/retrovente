// La fenêtre de l'app : barre à la charte + deux navigateurs intégrés qui partagent les mêmes cookies
// (connexion Le Bon Coin et RetroRevente gardées d'une fois sur l'autre) :
// - « appli » : retrorevente.fr/app (avec appli.js de l'extension) ;
// - « lbc » : leboncoin.fr (avec lbc.js : remplissage du dépôt, panneau IA des messages, synchro de « Mes annonces »).
import AppKit
import WebKit

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
final class Fenetre: NSObject, NSWindowDelegate, NSToolbarDelegate, WKNavigationDelegate, WKUIDelegate {
    let fenetre: NSWindow
    let actions = Actions()
    private lazy var pont = Pont(actions: actions)
    private let ressources = Ressources()
    private var appli: WKWebView!
    private var lbc: WKWebView!
    private var visible: Vue = .appli
    private var lbcCharge = false
    private var onglets: [Rubrique: Bouton] = [:]
    private var precedent: Bouton!, suivant: Bouton!, recharger: Bouton!
    private let chargement = Chargement()
    private var observations: [NSKeyValueObservation] = []
    private var fenetresSurgissantes: [NSWindow: WKWebView] = [:]
    private lazy var compte = Compte(fenetre: self)

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
        let barre = NSToolbar(identifier: "RetroRevente")
        barre.delegate = self
        barre.displayMode = .iconOnly
        barre.allowsUserCustomization = false
        fenetre.toolbar = barre

        appli = creerNavigateur()
        lbc = creerNavigateur()
        let contenu = NSView()
        for v in [appli!, lbc!] { v.translatesAutoresizingMaskIntoConstraints = false; contenu.addSubview(v) }
        chargement.translatesAutoresizingMaskIntoConstraints = false
        contenu.addSubview(chargement)
        var c: [NSLayoutConstraint] = []
        for v in [appli!, lbc!] {
            c += [v.leadingAnchor.constraint(equalTo: contenu.leadingAnchor), v.trailingAnchor.constraint(equalTo: contenu.trailingAnchor),
                  v.topAnchor.constraint(equalTo: contenu.topAnchor), v.bottomAnchor.constraint(equalTo: contenu.bottomAnchor)]
        }
        c += [chargement.leadingAnchor.constraint(equalTo: contenu.leadingAnchor), chargement.trailingAnchor.constraint(equalTo: contenu.trailingAnchor),
              chargement.topAnchor.constraint(equalTo: contenu.topAnchor), chargement.heightAnchor.constraint(equalToConstant: 2)]
        NSLayoutConstraint.activate(c)
        fenetre.contentView = contenu
        fenetre.setFrameAutosaveName("RetroRevente")
        if !fenetre.setFrameUsingName("RetroRevente") { fenetre.center() }

        for v in [appli!, lbc!] {
            observations.append(v.observe(\.estimatedProgress, options: [.new]) { [weak self] _, _ in Task { @MainActor in self?.majBarre() } })
            observations.append(v.observe(\.url, options: [.new]) { [weak self] _, _ in Task { @MainActor in self?.majBarre() } })
            observations.append(v.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in Task { @MainActor in self?.majBarre() } })
        }
        appli.load(URLRequest(url: Rubrique.appli.adresse))
        montrer(.appli)
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

    /// Même réglages pour les deux navigateurs : cookies gardés, identité Safari, scripts RetroRevente.
    private func configuration() -> WKWebViewConfiguration {
        let conf = WKWebViewConfiguration()
        conf.websiteDataStore = .default()
        conf.applicationNameForUserAgent = Fenetre.identiteSafari
        conf.preferences.javaScriptCanOpenWindowsAutomatically = true
        conf.setURLSchemeHandler(ressources, forURLScheme: "rrext")
        conf.userContentController.addScriptMessageHandler(pont, contentWorld: Scripts.monde, name: "rr")
        Scripts.pages().forEach(conf.userContentController.addUserScript)
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
        appli.isHidden = vue != .appli
        lbc.isHidden = vue != .lbc
        fenetre.makeFirstResponder(vue == .appli ? appli : lbc)
        majBarre()
    }

    func estVisible(_ v: WKWebView) -> Bool { fenetre.isVisible && !fenetre.isMiniaturized && !v.isHidden && (v === appli || v === lbc) }
    private var actuel: WKWebView { visible == .appli ? appli : lbc }

    func aller(_ r: Rubrique) {
        montrerFenetre()
        if r == .appli {
            if appli.url == nil { appli.load(URLRequest(url: r.adresse)) }
            montrer(.appli); return
        }
        // Déjà sur la bonne page Le Bon Coin : on la montre sans la recharger (un dépôt en cours n'est pas perdu).
        if !lbcCharge || Rubrique.de(lbc.url) != r { lbc.load(URLRequest(url: r.adresse)); lbcCharge = true }
        montrer(.lbc)
    }

    /// Ouvre une adresse dans le bon navigateur (lien « Le Bon Coin » d'une fiche, « Ouvrir Mon compte »…).
    func ouvrir(_ url: URL) {
        switch Fenetre.destination(url) {
        case .appli?: appli.load(URLRequest(url: url)); montrer(.appli); montrerFenetre()
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
        let rubrique: Rubrique? = visible == .appli ? .appli : Rubrique.de(lbc.url)
        for (r, b) in onglets { b.actif = r == rubrique }
        precedent?.disponible = actuel.canGoBack
        suivant?.disponible = actuel.canGoForward
        chargement.progression = actuel.isLoading ? actuel.estimatedProgress : 1
    }

    // MARK: Après une publication : retour sur l'appli, qui fait la fête (confettis)

    func publiee(id: String, titre: String, url: String) {
        let msg: [String: Any] = ["type": "publiee", "id": id, "titre": titre, "url": url]
        if let u = appli.url, Fenetre.destination(u) == .appli, u.path.hasPrefix("/app") {
            appli.evaluateJavaScript("window.__rrPont && window.__rrPont.recevoir(\(enJSON(msg)))", in: nil, in: Scripts.monde) { _ in }
        } else {
            var c = URLComponents(url: Rubrique.appli.adresse, resolvingAgainstBaseURL: false)!
            c.queryItems = [URLQueryItem(name: "publiee", value: id)]
            appli.load(URLRequest(url: c.url!))
        }
        // Le temps de voir « Annonce envoyée » et d'entendre les confettis sur Le Bon Coin.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in self?.montrer(.appli); self?.montrerFenetre() }
    }

    // MARK: Menus et raccourcis

    @objc func allerAppli(_ s: Any?) { aller(.appli) }
    @objc func allerDeposer(_ s: Any?) { aller(.deposer) }
    @objc func allerMessages(_ s: Any?) { aller(.messages) }
    @objc func allerAnnonces(_ s: Any?) { aller(.annonces) }
    @objc func precedente(_ s: Any?) { actuel.goBack() }
    @objc func suivante(_ s: Any?) { actuel.goForward() }
    @objc func rechargerPage(_ s: Any?) { actuel.reload() }
    @objc func tailleReelle(_ s: Any?) { actuel.pageZoom = 1 }
    @objc func agrandir(_ s: Any?) { actuel.pageZoom = min(3, actuel.pageZoom + 0.1) }
    @objc func reduire(_ s: Any?) { actuel.pageZoom = max(0.5, actuel.pageZoom - 0.1) }
    @objc func afficherFenetre(_ s: Any?) { montrerFenetre() }
    @objc func afficherCompte(_ s: Any?) { compte.basculer(depuis: boutonCompte) }
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

    // MARK: Barre (NSToolbar)

    private static let idLogo = NSToolbarItem.Identifier("logo")
    private static let idOnglets = NSToolbarItem.Identifier("onglets")
    private static let idNavigation = NSToolbarItem.Identifier("navigation")
    private static let idCompte = NSToolbarItem.Identifier("compte")
    private var boutonCompte: Bouton!

    func toolbarDefaultItemIdentifiers(_ t: NSToolbar) -> [NSToolbarItem.Identifier] {
        [Fenetre.idLogo, .flexibleSpace, Fenetre.idOnglets, .flexibleSpace, Fenetre.idNavigation, Fenetre.idCompte]
    }
    func toolbarAllowedItemIdentifiers(_ t: NSToolbar) -> [NSToolbarItem.Identifier] { toolbarDefaultItemIdentifiers(t) }

    func toolbar(_ t: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        let item = NSToolbarItem(itemIdentifier: id)
        switch id {
        case Fenetre.idLogo:
            item.view = Logo(); item.label = "RetroRevente"
        case Fenetre.idOnglets:
            let boutons = Rubrique.allCases.map { r -> Bouton in
                let b = Bouton(symbole: r.symbole, titre: r.titre, aide: r.aide + " (⌘\(r.rawValue + 1))") { [weak self] in self?.aller(r) }
                onglets[r] = b; return b
            }
            item.view = pile(boutons, espace: 4); item.label = "Rubriques"
        case Fenetre.idNavigation:
            precedent = Bouton(symbole: "chevron.left", titre: nil, aide: "Page précédente (⌘[)") { [weak self] in self?.precedente(nil) }
            suivant = Bouton(symbole: "chevron.right", titre: nil, aide: "Page suivante (⌘])") { [weak self] in self?.suivante(nil) }
            recharger = Bouton(symbole: "arrow.clockwise", titre: nil, aide: "Recharger la page (⌘R)") { [weak self] in self?.rechargerPage(nil) }
            item.view = pile([precedent, suivant, recharger], espace: 2); item.label = "Navigation"
        case Fenetre.idCompte:
            boutonCompte = Bouton(symbole: "person.crop.circle", titre: nil, aide: "Mon compte RetroRevente") { [weak self] in self?.afficherCompte(nil) }
            item.view = pile([boutonCompte], espace: 0); item.label = "Compte"
        default: return nil
        }
        return item
    }
    private func pile(_ vues: [NSView], espace: CGFloat) -> NSStackView {
        let p = NSStackView(views: vues)
        p.orientation = .horizontal; p.spacing = espace
        return p
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
    func webView(_ v: WKWebView, didFinish n: WKNavigation!) { majBarre() }
    func webView(_ v: WKWebView, didCommit n: WKNavigation!) { majBarre() }
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
final class Compte: NSObject, WKNavigationDelegate {
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
