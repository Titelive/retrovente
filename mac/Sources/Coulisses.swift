import AppKit
import WebKit

/// Dépôt « en coulisses » : la page de dépôt Le Bon Coin se remplit sous la vue native, sans être montrée.
/// Le panneau RetroRevente (lbc.js) remplit les écrans et clique « Continuer », comme dans l'extension.
/// Sur l'écran final, l'app affiche un récapitulatif : rien n'est publié tant que la personne n'a pas cliqué « Publier ».
/// Le Bon Coin n'apparaît que s'il a besoin d'elle (connexion, vérification, champ à corriger, prix à vérifier).
extension Fenetre {
    static let delaiRemplissage: TimeInterval = 150   // au-delà, on montre Le Bon Coin plutôt que d'attendre
    static let delaiPublication: TimeInterval = 30

    func deposerEnCoulisses(_ a: Article) {
        guard modele.etat == .connecte else { modele.deposerAVue(a); return }
        let maintenant = Date().timeIntervalSince1970 * 1000
        // Remplissage et « Continuer » automatiques : indispensables quand la page n'est pas à l'écran.
        Stockage.partage.ecrire(["aDeposer": ["id": a.id, "at": maintenant], "auto": true, "continuer": true, "prevenir": true])
        Stockage.partage.effacer(["publication"])
        enCoulisses = true
        debutCoulisses = Date(); etapeDepuis = Date()
        modele.depot = DepotEnCours(id: a.id, titre: a.titre, etape: .remplissage("J'ouvre Le Bon Coin…"))
        montrer(.appli)
        lbc.load(URLRequest(url: URL(string: "https://www.leboncoin.fr/deposer-une-annonce#rr=\(a.id)")!)); lbcCharge = true
        veilleCoulisses?.invalidate()
        veilleCoulisses = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.verifierCoulisses() }
        }
    }

    /// Fin des coulisses (publiée, annulée ou passée à l'écran). Appelée quand `modele.depot` redevient nil.
    func finCoulisses() {
        veilleCoulisses?.invalidate(); veilleCoulisses = nil
        retablirAuto()
        guard enCoulisses else { return }
        enCoulisses = false
        if modele.depot != nil { modele.depot = nil }
        if modele.gestion != nil { modele.gestion = nil }
        montrer(visible)
    }

    /// Le Bon Coin demande quelque chose (connexion, vérification, champ, prix…) : le site reste caché, la feuille de l'app
    /// l'explique et propose de réessayer, ou d'ouvrir Le Bon Coin si la personne le choisit.
    func besoinDeToi(_ raison: String) {
        guard enCoulisses else { return }
        veilleCoulisses?.invalidate(); veilleCoulisses = nil
        let t = Fenetre.raisonLisible(raison)
        if var d = modele.depot { d.etape = .aide(t); modele.depot = d }
        if var g = modele.gestion { g.etape = .aide(t); modele.gestion = g }
        if !NSApp.isActive { NSApp.requestUserAttention(.criticalRequest) }
        NSLog("RetroRevente : coulisses en attente (%@)", raison)
    }
    static func raisonLisible(_ r: String) -> String {
        let n = r.lowercased()
        if n.contains("connexion") { return "Le Bon Coin te demande de te connecter. Ouvre-le une fois pour te connecter, puis réessaie." }
        if n.contains("vérification") || n.contains("verification") { return "Le Bon Coin veut vérifier que tu n'es pas un robot. Ouvre-le pour valider la vérification, puis réessaie." }
        if n.contains("trop long") || n.contains("ne répond") { return "Le Bon Coin met trop de temps à répondre." }
        if n.hasPrefix("page ") { return "Le Bon Coin a ouvert une page inattendue." }
        if n.contains("publication non confirmée") { return "Je n'ai pas vu la confirmation de Le Bon Coin. Regarde dans Mes annonces avant de republier." }
        if n.contains("bouton final") { return "Je ne trouve pas le bouton de publication de Le Bon Coin." }
        if n.contains("aide:raison") { return "Le Bon Coin demande la raison de la suppression." }
        return r
    }

    /// Annuler depuis la feuille : la page reste remplie dans l'onglet « Déposer » si la personne veut la reprendre.
    func annulerCoulisses() { modele.depot = nil; modele.gestion = nil }
    /// Seulement à la demande de la personne : Le Bon Coin à l'écran, là où en est le dépôt.
    func voirCoulisses() {
        let etait = enCoulisses
        modele.depot = nil; modele.gestion = nil
        if etait || lbcCharge { montrer(.lbc); montrerFenetre() }
    }
    /// Adresse du bien donnée dans l'app : gardée pour les prochains dépôts, puis le dépôt reprend en coulisses.
    func adresseCoulisses(_ adresse: String) {
        let v = adresse.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !v.isEmpty else { return }
        Stockage.partage.ecrire(["adresse": v])
        reessayerCoulisses()
    }
    /// « Réessayer » : on reprend le dépôt ou la gestion depuis le début, toujours en coulisses.
    func reessayerCoulisses() {
        if let d = modele.depot, let a = modele.parId(d.id) { modele.depot = nil; deposerEnCoulisses(a) }
        else if let g = modele.gestion, let a = modele.parId(g.id) { modele.gestion = nil; g.action == .modifier ? modifierEnCoulisses(a) : supprimerEnCoulisses(a) }
    }

    /// Signal du panneau (alerte « À toi ») pendant un dépôt en coulisses. Vrai s'il a été pris en charge.
    func signalCoulisses(titre: String, texte: String) -> Bool {
        guard enCoulisses, var d = modele.depot else { return false }
        switch titre {
        case "À toi de finaliser l'annonce":
            let nom = texte.components(separatedBy: "« ").dropFirst().first?.components(separatedBy: " »").first ?? "Publier"
            d.etape = .pret(bouton: nom, payant: false); etapeDepuis = Date()
            modele.depot = d
            // Option payante cochée ? (la même lecture que le panneau ; jamais rien de coché par l'app)
            lbc.evaluateJavaScript(Fenetre.jsPayant, in: nil, in: Scripts.monde) { [weak self] r in
                guard let self = self, case .success(let v) = r, (v as? Bool) == true,
                      var d = self.modele.depot, case .pret(let b, _) = d.etape else { return }
                d.etape = .pret(bouton: b, payant: true); self.modele.depot = d
            }
            return true
        case "Annonce publiée !":
            return true
        case "Adresse du bien":
            veilleCoulisses?.invalidate(); veilleCoulisses = nil
            d.etape = .adresse(texte); modele.depot = d
            if !NSApp.isActive { NSApp.requestUserAttention(.criticalRequest) }
            return true
        default:   // « RetroRevente a besoin de toi », « Prix à vérifier »…
            besoinDeToi(texte.isEmpty ? titre : texte)
            return true
        }
    }

    /// « Publier » dans l'app : clique le bouton final de Le Bon Coin, qui reste caché.
    func publierEnCoulisses() {
        guard enCoulisses, var d = modele.depot, case .pret = d.etape else { return }
        // Le panneau reconnaît la publication grâce à cette marque (un clic de l'app n'est pas un « vrai » clic).
        Stockage.partage.ecrire(["publication": ["id": d.id, "titre": d.titre, "at": Date().timeIntervalSince1970 * 1000]])
        d.etape = .publication; etapeDepuis = Date(); modele.depot = d
        lbc.evaluateJavaScript(Fenetre.jsPublier, in: nil, in: Scripts.monde) { [weak self] r in
            guard let self = self else { return }
            if case .success(let v) = r, (v as? String) == "ok" { return }
            self.besoinDeToi("bouton final introuvable")
        }
    }

    /// Veille : connexion, vérification anti-robot, page inattendue ou attente trop longue → Le Bon Coin à l'écran.
    func verifierCoulisses() {
        if enCoulisses, modele.gestion != nil { return }   // la veille de la gestion s'en charge (Gestion.swift)
        guard enCoulisses, let d = modele.depot else { return }
        if case .aide = d.etape { return }
        if case .adresse = d.etape { return }
        let url = lbc.url
        let hote = url?.host?.lowercased() ?? ""
        let chemin = url?.path.lowercased() ?? ""
        if case .publication = d.etape {
            if Date().timeIntervalSince(etapeDepuis) > Fenetre.delaiPublication { besoinDeToi("publication non confirmée") }
            return
        }
        if lbc.isLoading { return }
        if url != nil, !(hote.hasSuffix("leboncoin.fr") && chemin.hasPrefix("/deposer")) { besoinDeToi("page \(hote)\(chemin)"); return }
        if case .remplissage = d.etape, Date().timeIntervalSince(debutCoulisses) > Fenetre.delaiRemplissage { besoinDeToi("trop long"); return }
        lbc.evaluateJavaScript(Fenetre.jsEtat, in: nil, in: Scripts.monde) { [weak self] r in
            guard let self = self, self.enCoulisses, case .success(let v) = r, let e = v as? String else { return }
            if e == "verification" { self.besoinDeToi("vérification Le Bon Coin"); return }
            if e == "connexion" { self.besoinDeToi("connexion Le Bon Coin"); return }
            if var d = self.modele.depot, case .remplissage(let ancien) = d.etape {
                let t = e == "photos" ? "J'ajoute les photos…" : e == "rempli" ? "Je remplis l'annonce…" : "J'ouvre Le Bon Coin…"
                if t != ancien { d.etape = .remplissage(t); self.modele.depot = d }
            }
        }
    }

    // MARK: Scripts (exécutés dans le monde isolé RetroRevente, invisibles pour la page)

    private static let jsOutils = """
    var n = function (s) { return String(s || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/\\s+/g, " ").trim().toLowerCase(); };
    var vis = function (x) { var r = x.getBoundingClientRect(), st = getComputedStyle(x); return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none"; };
    """
    static let jsPublier = "(function () {" + jsOutils + """
    var F = /^(publier|deposer (sans booster )?(mon |l.|votre )?annonce|valider et publier|mettre en ligne)/;
    var b = [].find.call(document.querySelectorAll("button, [role=button], input[type=submit]"), function (x) {
      return vis(x) && F.test(n(x.textContent || x.value || "")) && !x.closest("nav, header, footer") && !x.disabled;
    });
    if (!b) return "absent";
    b.click(); return "ok";
    })()
    """
    static let jsPayant = "(function () {" + jsOutils + """
    return [].some.call(document.querySelectorAll("input[type=checkbox]:checked, [role=checkbox][aria-checked=true]"), function (x) {
      var z = x.closest("label") || x.parentElement; for (var i = 0; z && i < 3 && !/€/.test(z.textContent); i++) z = z.parentElement;
      return !!(z && /€/.test(z.textContent));
    });
    })()
    """
    static let jsEtat = "(function () {" + jsOutils + """
    if (document.querySelector("iframe[src*='captcha-delivery'], iframe[src*='datadome'], iframe[src*='hcaptcha'], iframe[src*='recaptcha']")) return "verification";
    if ([].some.call(document.querySelectorAll("input[type=password]"), vis)) return "connexion";
    if ([].some.call(document.querySelectorAll("[role=progressbar], [aria-busy=true]"), vis)) return "photos";
    return document.querySelector("main input, main textarea") ? "rempli" : "chargement";
    })()
    """
}
