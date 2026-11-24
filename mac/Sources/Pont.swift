// Le pont entre les scripts de l'extension (commun.js, lbc.js, appli.js, popup.js) et l'app.
// - Stockage : remplace browser.storage.local (un fichier JSON dans ~/Library/Application Support/RetroRevente).
// - Pont : reçoit les appels de pont.js (lire, écrire, effacer, message) et y répond.
// - Ressources : sert les fichiers de l'extension embarqués dans l'app (rrext://app/…), pour le panneau « Compte ».
// - Scripts : fabrique les scripts injectés dans les pages, dans un monde isolé que la page ne voit pas.
import AppKit
import WebKit

@MainActor
final class Stockage {
    static let partage = Stockage()
    private var valeurs: [String: Any] = [:]
    private let fichier: URL

    private init() {
        let dossier = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("RetroRevente", isDirectory: true)
        try? FileManager.default.createDirectory(at: dossier, withIntermediateDirectories: true)
        fichier = dossier.appendingPathComponent("reglages.json")
        if let d = try? Data(contentsOf: fichier), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { valeurs = o }
    }

    func valeur(_ cle: String) -> Any? { valeurs[cle] }
    func texte(_ cle: String) -> String? { valeurs[cle] as? String }

    func lire(_ cles: [String]?) -> [String: Any] {
        guard let cles = cles else { return valeurs }
        var r: [String: Any] = [:]
        for c in cles { if let v = valeurs[c] { r[c] = v } }
        return r
    }
    func ecrire(_ o: [String: Any]) {
        for (c, v) in o { if v is NSNull { valeurs.removeValue(forKey: c) } else { valeurs[c] = v } }
        enregistrer()
    }
    func effacer(_ cles: [String]?) {
        if let cles = cles { cles.forEach { valeurs.removeValue(forKey: $0) } } else { valeurs = [:] }
        enregistrer()
    }
    private func enregistrer() {
        guard let d = try? JSONSerialization.data(withJSONObject: valeurs) else { return }
        try? d.write(to: fichier, options: .atomic)
    }
}

/// Texte JSON d'une valeur (pont.js le relit avec JSON.parse).
func enJSON(_ x: Any?) -> String {
    guard let x = x, !(x is NSNull) else { return "null" }
    if let d = try? JSONSerialization.data(withJSONObject: x, options: [.fragmentsAllowed]), let s = String(data: d, encoding: .utf8) { return s }
    return "null"
}

@MainActor
final class Pont: NSObject, WKScriptMessageHandlerWithReply {
    let actions: Actions
    init(actions: Actions) { self.actions = actions }

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let corps = message.body as? [String: Any], let op = corps["op"] as? String else { replyHandler(nil, "Message invalide."); return }
        let donnees: Any? = (corps["donnees"] as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8), options: [.fragmentsAllowed]) }
        let stockage = Stockage.partage
        switch op {
        case "lire":
            replyHandler(enJSON(stockage.lire(donnees as? [String])), nil)
        case "ecrire":
            stockage.ecrire(donnees as? [String: Any] ?? [:]); replyHandler("null", nil)
        case "effacer":
            stockage.effacer(donnees as? [String]); replyHandler("null", nil)
        case "message":
            let m = donnees as? [String: Any] ?? [:]
            let source = message.webView
            Task { @MainActor in
                let r = await self.actions.traiter(m, depuis: source)
                replyHandler(enJSON(r), nil)
            }
        default:
            replyHandler(nil, "Opération inconnue : \(op)")
        }
    }
}

/// Fichiers de l'extension embarqués dans l'app.
enum Extension {
    static let dossier: URL = Bundle.main.resourceURL!.appendingPathComponent("extension", isDirectory: true)
    static func texte(_ chemin: String) -> String { (try? String(contentsOf: dossier.appendingPathComponent(chemin), encoding: .utf8)) ?? "" }
    static let version: String = {
        guard let d = try? Data(contentsOf: dossier.appendingPathComponent("manifest.json")),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return "?" }
        return o["version"] as? String ?? "?"
    }()
    static func type(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }
}

final class Ressources: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start tache: WKURLSchemeTask) {
        guard let url = tache.request.url else { tache.didFailWithError(URLError(.badURL)); return }
        let base = Extension.dossier.standardizedFileURL
        let fichier = base.appendingPathComponent(url.path).standardizedFileURL
        guard fichier.path.hasPrefix(base.path + "/"), let d = try? Data(contentsOf: fichier) else {
            tache.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        let r = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
            "Content-Type": Extension.type(fichier.pathExtension), "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store",
        ])!
        tache.didReceive(r); tache.didReceive(d); tache.didFinish()
    }
    func webView(_ webView: WKWebView, stop tache: WKURLSchemeTask) {}
}

/// Scripts injectés dans les pages (mêmes règles que le manifest de l'extension).
@MainActor
enum Scripts {
    static let monde = WKContentWorld.world(name: "RetroRevente")

    static let pont: String = {
        var ressources: [String: String] = [:]
        for p in ["polices/rubik-latin.woff2", "polices/figtree-latin.woff2", "polices/silkscreen-latin.woff2", "icones/icone-128.png"] {
            if let d = try? Data(contentsOf: Extension.dossier.appendingPathComponent(p)) {
                ressources[p] = "data:" + Extension.type((p as NSString).pathExtension).components(separatedBy: ";")[0] + ";base64," + d.base64EncodedString()
            }
        }
        let mac = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let config = enJSON(["version": Extension.version, "mac": mac, "ressources": ressources])
        let source = (try? String(contentsOf: Bundle.main.resourceURL!.appendingPathComponent("pont.js"), encoding: .utf8)) ?? ""
        return source.replacingOccurrences(of: "__RR_CONFIG__", with: config)
    }()

    // retrorevente.fr/app : appli.js dès le début du chargement (« document_start »).
    static let appli = #"if (/^(https:\/\/retrorevente\.fr|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)\/app\//.test(location.href)) {"#
    // leboncoin.fr : lbc.js une fois la page construite (« document_idle »).
    static let lbc = #"if (/^https:\/\/www\.leboncoin\.fr\//.test(location.href)) {"#

    static func pages() -> [WKUserScript] {
        let debut = pont + "\n" + appli + "\n" + Extension.texte("commun.js") + "\n" + Extension.texte("appli.js") + "\n}\n"
        let fin = lbc + "\n" + Extension.texte("commun.js") + "\n" + Extension.texte("lbc.js") + "\n}\n"
        return [
            WKUserScript(source: debut, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: monde),
            WKUserScript(source: fin, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: monde),
        ]
    }

    /// Fenêtres de cookies refusées toutes seules (« Continuer sans accepter »), sur tous les sites.
    static func cookies() -> WKUserScript {
        let source = (try? String(contentsOf: Bundle.main.resourceURL!.appendingPathComponent("cookies.js"), encoding: .utf8)) ?? ""
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: monde)
    }

    /// Le panneau « Compte » (popup.html de l'extension) : la page elle-même utilise le pont.
    static func panneau() -> WKUserScript {
        WKUserScript(source: pont, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page)
    }
}

/// Bloqueur de pubs (règles WebKit « content blocker » de bloqueur.json) : domaines publicitaires bloqués,
/// emplacements de pub masqués. Compilé une fois, gardé par WebKit entre deux lancements.
@MainActor
enum Bloqueur {
    static func preparer(_ fini: @escaping (WKContentRuleList?) -> Void) {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("bloqueur.json"),
              let regles = try? String(contentsOf: url, encoding: .utf8) else { fini(nil); return }
        let id = "RetroRevente-pubs-" + String(regles.utf8.count)
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: id, encodedContentRuleList: regles) { liste, erreur in
            if let erreur = erreur { NSLog("RetroRevente : bloqueur de pubs indisponible : \(erreur.localizedDescription)") }
            DispatchQueue.main.async { fini(liste) }
        }
    }
}
