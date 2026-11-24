import AppKit
import SwiftUI
import WebKit

// MARK: Données

/// Vues et favoris d'une annonce sur un site (« lbc » ou « ebay »), relevés sur « Mes annonces » ou Seller Hub.
struct StatsSite: Hashable {
    struct Jour: Hashable { let j: String; let v: Int?; let f: Int? }
    var vues: Int? = nil, favoris: Int? = nil, at = ""
    var hist: [Jour] = []
    init(_ d: [String: Any]) {
        vues = (d["vues"] as? NSNumber)?.intValue; favoris = (d["favoris"] as? NSNumber)?.intValue; at = d["at"] as? String ?? ""
        hist = (d["hist"] as? [[String: Any]] ?? []).map { Jour(j: $0["j"] as? String ?? "", v: ($0["v"] as? NSNumber)?.intValue, f: ($0["f"] as? NSNumber)?.intValue) }
    }
    var date: Date? { ISO8601DateFormatter.avecFractions.date(from: at) ?? ISO8601DateFormatter().date(from: at) }
    /// Gagnés en 7 jours, d'après le premier relevé de la semaine.
    var semaine: (vues: Int?, favoris: Int?)? {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "UTC")
        let limite = f.string(from: Date().addingTimeInterval(-7 * 86400))
        guard let b = hist.first(where: { $0.j >= limite }), b.j != hist.last?.j else { return nil }
        return (vues.flatMap { v in b.v.map { v - $0 } }, favoris.flatMap { x in b.f.map { x - $0 } })
    }
}

extension ISO8601DateFormatter {
    static let avecFractions: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
}

extension Article {
    static func lireStats(_ d: [String: Any]) -> [String: StatsSite] {
        var r: [String: StatsSite] = [:]
        for (k, v) in d["stats"] as? [String: Any] ?? [:] { if let x = v as? [String: Any] { r[k] = StatsSite(x) } }
        return r
    }
    /// Vues et favoris de toutes les annonces de l'article (Le Bon Coin + eBay).
    var vuesTotal: Int? { let l = stats.values.compactMap(\.vues); return l.isEmpty ? nil : l.reduce(0, +) }
    var favorisTotal: Int? { let l = stats.values.compactMap(\.favoris); return l.isEmpty ? nil : l.reduce(0, +) }
}

// MARK: Relevé en arrière-plan

/// Ouvre « Mes annonces » de Le Bon Coin (et Seller Hub d'eBay quand un article y est lié) dans une vue web cachée,
/// sans rien montrer, et y lit les vues et favoris de chaque annonce (extension/stats.js, le même code que l'extension).
/// Toutes les 2 heures au plus par site, ou à la demande (« Actualiser » dans la fiche). Une page de connexion ou de
/// vérification arrête le relevé sans rien demander : il reprendra au prochain passage.
@MainActor
final class ReleveStats: NSObject, ObservableObject, WKNavigationDelegate {
    weak var appli: Appli?
    @Published private(set) var enCours: String? = nil          // site en cours de relevé
    @Published private(set) var connexion: Set<String> = []       // sites qui demandent de se connecter
    private var vue: WKWebView?
    private var file: [String] = []
    private var pages: [String] = []        // pages suivantes de « Mes annonces »
    private var lignes: [String: [String: Any]] = [:]
    private var minuterie: Timer?, veille: Timer?
    private var essais = 0, precedent = -1
    static let intervalle: TimeInterval = 2 * 3600
    static let adresses = ["lbc": "https://www.leboncoin.fr/compte/part/mes-annonces", "ebay": "https://www.ebay.fr/sh/lst/active"]

    private func derniere(_ s: String) -> Date { Date(timeIntervalSince1970: UserDefaults.standard.double(forKey: "statsAt_" + s)) }
    private func marquer(_ s: String) { UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "statsAt_" + s) }

    /// Sites qui ont au moins une annonce en ligne liée.
    private func sites(_ articles: [Article]) -> [String] {
        let actifs = articles.filter { ["en_vente", "reserve"].contains($0.statut) }
        return (actifs.contains { !$0.annonce.isEmpty } ? ["lbc"] : []) + (actifs.contains { !$0.annonceEbay.isEmpty } ? ["ebay"] : [])
    }
    /// Après chaque chargement des fiches, et toutes les 15 minutes : relevé des sites dont le dernier date de plus de 2 h.
    func planifier(_ articles: [Article]) {
        guard ProcessInfo.processInfo.environment["RR_DEMO"] == nil else { return }
        if veille == nil {
            veille = Timer.scheduledTimer(withTimeInterval: 900, repeats: true) { [weak self] _ in
                Task { @MainActor in if let s = self, let a = s.appli { s.planifier(a.articles) } }
            }
        }
        // Une annonce liée sans aucun chiffre (lien ajouté depuis le dernier relevé) : relevé dès 10 minutes.
        let actifs = articles.filter { ["en_vente", "reserve"].contains($0.statut) }
        for s in sites(articles) {
            let manque = actifs.contains { (s == "lbc" ? !$0.annonce.isEmpty : !$0.annonceEbay.isEmpty) && $0.stats[s] == nil }
            let delai = manque ? 600 : ReleveStats.intervalle
            if Date().timeIntervalSince(derniere(s)) > delai && !file.contains(s) && enCours != s { file.append(s) }
        }
        suivant()
    }
    /// « Actualiser » : tous les sites liés, tout de suite.
    func releverMaintenant() {
        guard let a = appli, ProcessInfo.processInfo.environment["RR_DEMO"] == nil else { return }
        connexion = []
        for s in sites(a.articles) where !file.contains(s) && enCours != s { file.append(s) }
        suivant()
    }

    private func suivant() {
        guard enCours == nil, !file.isEmpty else { return }
        let s = file.removeFirst()
        guard let u = URL(string: ReleveStats.adresses[s] ?? "") else { return suivant() }
        enCours = s; lignes = [:]; pages = []; essais = 0; precedent = -1
        if vue == nil {
            let conf = WKWebViewConfiguration()
            conf.websiteDataStore = .default()   // la même session Le Bon Coin / eBay que le reste de l'app
            conf.applicationNameForUserAgent = Fenetre.identiteSafari
            let uc = conf.userContentController
            uc.addUserScript(WKUserScript(source: Extension.texte("stats-page.js"), injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
            uc.addUserScript(WKUserScript(source: Extension.texte("stats.js"), injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: Scripts.monde))
            let v = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 1000), configuration: conf)
            v.navigationDelegate = self
            vue = v
        }
        // Taille fixe : Le Bon Coin montre « Mes annonces » en grand (avec les vues et favoris), quelle que soit la fenêtre.
        if let v = vue, v.superview == nil { appli?.fenetre?.accueillirEnFond(v, taille: NSSize(width: 1440, height: 1000)) }
        vue?.load(URLRequest(url: u))
        minuterie?.invalidate()
        minuterie = Timer.scheduledTimer(withTimeInterval: 60, repeats: false) { [weak self] _ in Task { @MainActor in self?.fin() } }
    }

    func webView(_ v: WKWebView, didFinish n: WKNavigation!) {
        guard let s = enCours else { return }
        let u = v.url, hote = u?.host?.lowercased() ?? "", chemin = u?.path.lowercased() ?? ""
        // Connexion demandée : rien à lire, on le signale dans la fiche et on reprendra plus tard.
        if hote.hasPrefix("auth.") || hote.hasPrefix("signin.") || chemin.contains("login") || chemin.contains("signin") {
            connexion.insert(s); NSLog("RetroRevente : vues et favoris %@ → connexion demandée", s); fin(); return
        }
        lire()
    }
    func webView(_ v: WKWebView, didFail n: WKNavigation!, withError e: Error) { fin() }
    func webView(_ v: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { fin() }

    /// Lit la page toutes les 2 s (elle se dessine et charge ses annonces petit à petit) jusqu'à ce que le compte ne bouge plus.
    private func lire() {
        guard let v = vue, enCours != nil else { return }
        let js = """
        (function () {
          if (document.querySelector("iframe[src*='captcha-delivery'], iframe[src*='datadome'], iframe[src*='hcaptcha'], iframe[src*='recaptcha']")) return JSON.stringify({ verification: true });
          window.scrollTo(0, document.body ? document.body.scrollHeight : 0);
          var r = typeof RR_STATS !== "undefined" ? RR_STATS.tout() : { site: "", annonces: [] };
          var s = [].find.call(document.querySelectorAll("a[rel=next], a[aria-label], a[title]"), function (a) { return a.rel === "next" || /page suivante|suivant/i.test((a.getAttribute("aria-label") || "") + " " + (a.title || "")); });
          r.suivante = s && s.href && s.href.indexOf(location.origin) === 0 ? s.href : "";
          return JSON.stringify(r);
        })()
        """
        v.evaluateJavaScript(js, in: nil, in: Scripts.monde) { [weak self] r in
            Task { @MainActor in
                guard let self = self, self.enCours != nil else { return }
                guard case .success(let x) = r, let t = x as? String, let d = t.data(using: .utf8),
                      let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return self.encore() }
                if o["verification"] as? Bool == true { NSLog("RetroRevente : vues et favoris → vérification anti-robot"); return self.fin() }
                for l in o["annonces"] as? [[String: Any]] ?? [] { if let id = l["id"] as? String { self.lignes[id] = l } }
                let n = self.lignes.count
                if n > 0 && n == self.precedent {
                    if let p = o["suivante"] as? String, !p.isEmpty, self.pages.count < 5, !self.pages.contains(p), let u = URL(string: p) {
                        self.pages.append(p); self.precedent = -1; self.essais = 0; self.vue?.load(URLRequest(url: u)); return
                    }
                    return self.fin()
                }
                self.precedent = n
                self.encore()
            }
        }
    }
    private func encore() {
        essais += 1
        if essais > 12 { return fin() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.lire() }
    }

    /// Envoi des lignes lues, puis fiches rechargées (cartes et fiche à jour).
    private func fin() {
        minuterie?.invalidate(); minuterie = nil
        guard let s = enCours else { return }
        let l = Array(lignes.values)
        enCours = nil; lignes = [:]
        vue?.stopLoading()
        marquer(s)
        NSLog("RetroRevente : vues et favoris %@ → %d annonce(s) lue(s)", s, l.count)
        Task { @MainActor in
            if !l.isEmpty {
                connexion.remove(s)
                if (try? await API.json("POST", "/api/stats", ["site": s, "annonces": l])) != nil { await appli?.recharger() }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.suivant() }
        }
    }
}

// MARK: Affichage

enum StatsTexte {
    static func nombre(_ n: Int) -> String { n >= 10000 ? String(format: "%.1f k", Double(n) / 1000).replacingOccurrences(of: ".", with: ",") : n.formatted() }
    static func depuis(_ d: Date?) -> String {
        guard let d = d else { return "" }
        let m = Int(Date().timeIntervalSince(d) / 60)
        return m < 2 ? "à l'instant" : m < 60 ? "il y a \(m) min" : m < 48 * 60 ? "il y a \(m / 60) h" : "il y a \(m / 1440) jours"
    }
    static let noms = ["lbc": "Le Bon Coin", "ebay": "eBay"]
}

/// Ligne « 👁 128  ♥ 7 » d'une carte : le total des sites, le détail en bulle d'aide.
struct StatsCarte: View {
    let article: Article
    var body: some View {
        if !article.vendu, article.vuesTotal != nil || article.favorisTotal != nil {
            HStack(spacing: 10) {
                if let v = article.vuesTotal { Label(StatsTexte.nombre(v), systemImage: "eye") }
                if let f = article.favorisTotal { Label(StatsTexte.nombre(f), systemImage: "heart") }
            }
            .labelStyle(StatsLabel())
            .font(.caption.weight(.semibold).monospacedDigit()).foregroundStyle(.secondary)
            .help(aide)
        }
    }
    private var aide: String {
        ["lbc", "ebay"].compactMap { s -> String? in
            guard let x = article.stats[s] else { return nil }
            return "\(StatsTexte.noms[s] ?? s) : \(x.vues.map { "\($0) vues" } ?? "vues ?"), \(x.favoris.map { "\($0) favoris" } ?? "favoris ?") (\(StatsTexte.depuis(x.date)))"
        }.joined(separator: "\n")
    }
}
struct StatsLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View { HStack(spacing: 3) { configuration.icon.font(.system(size: 10, weight: .bold)); configuration.title } }
}

/// Bloc « Audience » de la fiche : vues et favoris par site, ce qui a bougé cette semaine, et « Actualiser ».
struct BlocStats: View {
    @ObservedObject var appli: Appli
    @ObservedObject var releve: ReleveStats
    let article: Article
    var body: some View {
        let sites = ["lbc", "ebay"].filter { s in s == "lbc" ? !article.annonce.isEmpty : !article.annonceEbay.isEmpty }
        if !sites.isEmpty, !article.vendu {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label { Text("Audience des annonces").font(.headline) } icon: { Image(systemName: "chart.line.uptrend.xyaxis").foregroundStyle(Color.rrOr) }
                    Spacer()
                    if releve.enCours != nil { ProgressView().controlSize(.small) }
                    Button { releve.releverMaintenant() } label: { Label("Actualiser", systemImage: "arrow.clockwise") }
                        .buttonStyle(.borderless).disabled(releve.enCours != nil)
                        .help("Relit les vues et favoris sur Mes annonces, en arrière-plan")
                }
                ForEach(sites, id: \.self) { s in ligne(s) }
            }.padding(18).frame(maxWidth: .infinity, alignment: .leading).verre(RoundedRectangle(cornerRadius: 22))
        }
    }
    @ViewBuilder private func ligne(_ s: String) -> some View {
        let couleur = Color(nsColor: NSColor(hex: s == "lbc" ? 0xEC5A13 : 0x0064D2))
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            Text(s == "lbc" ? "LBC" : "eBay").font(.system(size: 10, weight: .heavy)).foregroundStyle(.white)
                .padding(.horizontal, 7).padding(.vertical, 4).background(couleur, in: RoundedRectangle(cornerRadius: 6))
            if let x = article.stats[s] {
                chiffre(x.vues, "vue", "eye", x.semaine?.vues)
                chiffre(x.favoris, s == "ebay" ? "observateur" : "favori", "heart", x.semaine?.favoris)
                Spacer()
                Text("Relevé " + StatsTexte.depuis(x.date)).font(.caption).foregroundStyle(.secondary)
            } else if releve.connexion.contains(s) {
                Text("Connecte-toi à \(StatsTexte.noms[s] ?? s) dans l'app pour relever les vues.").font(.callout).foregroundStyle(.secondary)
            } else {
                Text(releve.enCours == s ? "Relevé en cours…" : "Pas encore relevé.").font(.callout).foregroundStyle(.secondary)
            }
        }
    }
    @ViewBuilder private func chiffre(_ n: Int?, _ mot: String, _ icone: String, _ gain: Int?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Image(systemName: icone).font(.system(size: 12, weight: .bold)).foregroundStyle(.secondary)
            Text(n.map { StatsTexte.nombre($0) } ?? "—").font(.title3.weight(.heavy).monospacedDigit())
            Text(mot + ((n ?? 0) > 1 ? "s" : "")).font(.callout).foregroundStyle(.secondary)
            if let g = gain, g > 0 { Text("+\(StatsTexte.nombre(g)) en 7 j").font(.caption.weight(.bold)).foregroundStyle(Libelles.couleursStatut("en_vente").texte) }
        }
    }
}

// Captures (RR_DEMO) : dates relatives à aujourd'hui pour les stats d'exemple.
func demoIl(_ heures: Double) -> String { ISO8601DateFormatter.avecFractions.string(from: Date().addingTimeInterval(-heures * 3600)) }
func demoJour(_ jours: Double) -> String { String(ISO8601DateFormatter().string(from: Date().addingTimeInterval(-jours * 86400)).prefix(10)) }
