import AppKit
import WebKit

extension Article {
    /// L'annonce Le Bon Coin liée a été vue désactivée (lien périmé, annonce supprimée ou expirée).
    @MainActor func annonceMorte(_ appli: Appli) -> Bool { !annonce.isEmpty && appli.annoncesMortes[id] == annonce }
}

/// Vérifie en arrière-plan, sans rien montrer, que les annonces Le Bon Coin liées aux fiches sont encore en ligne.
/// Une page « Cette annonce est désactivée » marque la fiche ; une annonce revenue en ligne est démarquée.
/// Une annonce à la fois, avec une pause entre deux, et chaque lien au plus toutes les 3 heures (sauf fiche ouverte).
@MainActor
final class VerifAnnonces: NSObject, WKNavigationDelegate {
    weak var appli: Appli?
    private var vue: WKWebView?
    private var file: [(id: String, url: String)] = []
    private var actuel: (id: String, url: String)?
    private var minuterie: Timer?
    private var vues: [String: Date] = [:]      // « id|lien » → dernière vérification
    private var doutes: Set<String> = []        // vus « disparus » une fois : à confirmer
    static let intervalle: TimeInterval = 3 * 3600

    /// Après chaque chargement des fiches : les annonces liées des articles à vendre (et des lots), pas trop souvent.
    func planifier(_ articles: [Article]) {
        guard ProcessInfo.processInfo.environment["RR_DEMO"] == nil else { return }
        for a in articles where !a.annonce.isEmpty && ["en_vente", "reserve"].contains(a.statut) {
            let cle = a.id + "|" + a.annonce
            if let d = vues[cle], Date().timeIntervalSince(d) < VerifAnnonces.intervalle { continue }
            ajouter(a, enTete: false)
        }
        // un lien changé ou retiré n'est plus « mort »
        if let ap = appli {
            let actuels = Dictionary(uniqueKeysWithValues: articles.map { ($0.id, $0.annonce) })
            let gardes = ap.annoncesMortes.filter { actuels[$0.key] == $0.value }
            if gardes.count != ap.annoncesMortes.count { ap.annoncesMortes = gardes }
        }
        suivant()
    }
    /// Fiche ouverte : sa vérification passe en premier (si elle date de plus de 10 minutes).
    func verifierMaintenant(_ a: Article) {
        guard !a.annonce.isEmpty, ProcessInfo.processInfo.environment["RR_DEMO"] == nil else { return }
        if let d = vues[a.id + "|" + a.annonce], Date().timeIntervalSince(d) < 600 { return }
        ajouter(a, enTete: true); suivant()
    }
    private func ajouter(_ a: Article, enTete: Bool) {
        file.removeAll { $0.id == a.id }
        if actuel?.id == a.id && actuel?.url == a.annonce { return }
        if enTete { file.insert((a.id, a.annonce), at: 0) } else { file.append((a.id, a.annonce)) }
    }

    private func suivant() {
        guard actuel == nil, !file.isEmpty, let u = URL(string: file[0].url) else { if actuel == nil && !file.isEmpty { file.removeFirst(); suivant() }; return }
        actuel = file.removeFirst()
        if vue == nil {
            let conf = WKWebViewConfiguration()
            conf.websiteDataStore = .default()
            conf.applicationNameForUserAgent = Fenetre.identiteSafari
            let v = WKWebView(frame: NSRect(x: 0, y: 0, width: 1200, height: 900), configuration: conf)
            v.navigationDelegate = self
            vue = v
        }
        if let v = vue, v.superview == nil { appli?.fenetre?.accueillirEnFond(v, taille: NSSize(width: 1440, height: 1000)) }
        vue?.load(URLRequest(url: u))
        minuterie?.invalidate()
        minuterie = Timer.scheduledTimer(withTimeInterval: 25, repeats: false) { [weak self] _ in Task { @MainActor in self?.fini(nil) } }
    }

    private var statutHTTP = 0
    func webView(_ v: WKWebView, decidePolicyFor r: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if r.isForMainFrame { statutHTTP = (r.response as? HTTPURLResponse)?.statusCode ?? 0 }
        decisionHandler(.allow)
    }
    func webView(_ v: WKWebView, didFinish n: WKNavigation!) {
        // Le Bon Coin dessine la page après le chargement : on lit un peu plus tard. Même avec un 404 / 410, on regarde
        // la page : si l'annonce (titre, prix) s'affiche, elle est en ligne.
        let code = statutHTTP
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            guard let self = self, self.actuel != nil else { return }
            v.evaluateJavaScript(VerifAnnonces.js) { r, _ in
                Task { @MainActor in
                    var e = r as? String
                    if (e == nil || e == "") && (code == 404 || code == 410) { e = "morte" }
                    self.fini(e)
                }
            }
        }
    }
    func webView(_ v: WKWebView, didFail n: WKNavigation!, withError e: Error) { fini(nil) }
    func webView(_ v: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { fini(nil) }

    /// « morte », « vivante » ou rien (vérification anti-robot, page inconnue, réseau) : dans ce dernier cas, on ne conclut rien.
    private func fini(_ etat: String?) {
        minuterie?.invalidate(); minuterie = nil
        guard let a = actuel else { return }
        actuel = nil
        NSLog("RetroRevente : vérification de l'annonce %@ → %@ (HTTP %d)", a.url, etat ?? "sans réponse", statutHTTP)
        statutHTTP = 0
        if let e = etat, e == "morte" || e == "vivante" {
            vues[a.id + "|" + a.url] = Date()
            if let ap = appli, ap.parId(a.id)?.annonce == a.url {
                // « Disparue » seulement après deux vérifications d'affilée qui le disent (pas sur un seul faux pas).
                let cle = a.id + "|" + a.url
                if e == "morte" && !doutes.contains(cle) { doutes.insert(cle); vues[cle] = Date().addingTimeInterval(-VerifAnnonces.intervalle + 120) }
                else if e == "morte", ap.annoncesMortes[a.id] != a.url { ap.annoncesMortes[a.id] = a.url }
                if e == "vivante" { doutes.remove(cle) }
                if e == "vivante", ap.annoncesMortes[a.id] != nil { ap.annoncesMortes[a.id] = nil }
            }
        }
        vue?.stopLoading()
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.suivant() }
    }

    static let js = """
    (function () {
      var t = (document.body && document.body.innerText || "").slice(0, 8000).normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();
      if (document.querySelector("iframe[src*='captcha-delivery'], iframe[src*='datadome']")) return "";
      // L'annonce s'affiche (titre ou prix de l'annonce, gestion « Modifier l'annonce ») : en ligne, quoi que dise le reste
      // de la page (des « annonces similaires » peuvent contenir « n'est plus disponible »).
      if (/\\/ad\\//.test(location.pathname) && (document.querySelector("[data-qa-id='adview_title'], [data-qa-id='adview_price'], [data-qa-id='adview_spotlight_description_container']") || /modifier l.annonce|mettre en pause/.test(t))) return "vivante";
      var haut = t.slice(0, 3000);
      if (/cette annonce est desactivee|annonce n.est plus (disponible|en ligne)|cette annonce a expire|annonce introuvable/.test(haut)) return "morte";
      if (/\\/ad\\//.test(location.pathname) && (document.querySelector("h1") || /\\d\\s?€/.test(t))) return "vivante";
      return "";
    })()
    """
}
