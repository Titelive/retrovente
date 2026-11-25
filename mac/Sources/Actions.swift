// Ce que faisait background.js dans l'extension : seul endroit qui parle à retrorevente.fr, avec la clé rre_
// (lecture des annonces, photos, réponses IA, liens). Ne contacte jamais Le Bon Coin.
// Plus ce que Safari ne savait pas faire : son joué par l'app, notification système, retour sur l'appli après publication.
import AppKit
import WebKit
import UserNotifications

struct ErreurRR: Error { let message: String; let status: Int }

@MainActor
final class Actions {
    nonisolated static let serveurDefaut = "https://retrorevente.fr"
    weak var fenetre: Fenetre?
    private let stockage = Stockage.partage
    private var sonEnCours: NSSound?

    private var serveur: String {
        let s = stockage.texte("serveur") ?? ""
        return Actions.serveurAutorise(s) ? s : Actions.serveurDefaut
    }
    nonisolated static func serveurAutorise(_ s: String) -> Bool {
        s.range(of: #"^(https://retrorevente\.fr|http://(127\.0\.0\.1|localhost)(:\d+)?)$"#, options: .regularExpression) != nil
    }

    func traiter(_ m: [String: Any], depuis vue: WKWebView?) async -> Any {
        let type = m["type"] as? String ?? ""
        do {
            switch type {
            case "etat":
                return ["connecte": !(stockage.texte("cle") ?? "").isEmpty, "email": stockage.texte("email") ?? "", "serveur": serveur, "app": "mac"]
            case "cle": return try await connecter(m)
            case "deconnecter":
                stockage.effacer(["cle", "email"]); return ["ok": true]
            case "annonces":
                return try JSONSerialization.jsonObject(with: try await appel("/api/extension/annonces").0)
            case "photo": return try await photo(m)
            case "reponse": return try await reponse(m)
            case "lien":
                let corps: [String: Any] = ["site": chaine(m["site"]) == "ebay" ? "ebay" : "lbc", "annonce": ou(m["annonce"], NSNull()), "url": ou(m["url"], NSNull()), "prix": ou(m["prix"], NSNull())]
                return try JSONSerialization.jsonObject(with: try await appel("/api/extension/lien", corps: corps).0)
            case "specifiques":
                let corps: [String: Any] = ["annonce": ou(m["annonce"], NSNull()), "champs": m["champs"] as? [Any] ?? []]
                return try JSONSerialization.jsonObject(with: try await appel("/api/extension/specifiques", corps: corps).0)
            case "vendu":
                let corps: [String: Any] = ["ids": m["ids"] as? [Any] ?? [], "prix": ou(m["prix"], NSNull()), "remise": chaine(m["remise"])]
                return try JSONSerialization.jsonObject(with: try await appel("/api/extension/vendu", corps: corps).0)
            case "stats":
                let corps: [String: Any] = ["site": chaine(m["site"]) == "ebay" ? "ebay" : "lbc", "annonces": m["annonces"] as? [Any] ?? []]
                return try JSONSerialization.jsonObject(with: try await appel("/api/extension/stats", corps: corps).0)
            case "rempli":
                _ = try await appel("/api/extension/rempli", methode: "POST"); return ["ok": true]
            case "son": return jouerSon(m["wav"] as? String)
            case "alerte": return alerte(titre: chaine(m["titre"]), texte: chaine(m["texte"]), depuis: vue)
            case "appli": return ["ok": true]
            case "publiee":
                fenetre?.publiee(id: chaine(m["id"]), titre: String(chaine(m["titre"]).prefix(120)), url: chaine(m["url"]))
                return ["ok": true, "via": "app Mac", "fermeture": false]
            default:
                return ["error": "Action inconnue : \(type)", "status": 0]
            }
        } catch let e as ErreurRR {
            return ["error": e.message, "status": e.status]
        } catch {
            return ["error": "RetroRevente ne répond pas (\(error.localizedDescription)).", "status": 0]
        }
    }

    // MARK: retrorevente.fr

    private func appel(_ chemin: String, methode: String? = nil, corps: [String: Any]? = nil) async throws -> (Data, HTTPURLResponse) {
        guard let cle = stockage.texte("cle"), !cle.isEmpty else {
            throw ErreurRR(message: "App pas encore connectée à ton compte RetroRevente.", status: 401)
        }
        guard let url = URL(string: serveur + chemin) else { throw ErreurRR(message: "Adresse invalide.", status: 0) }
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60)
        r.httpShouldHandleCookies = false
        r.setValue("Bearer " + cle, forHTTPHeaderField: "Authorization")
        if let corps = corps {
            r.httpMethod = methode ?? "POST"
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try JSONSerialization.data(withJSONObject: corps)
        } else if let methode = methode { r.httpMethod = methode }
        let (d, rep) = try await URLSession.shared.data(for: r)
        guard let h = rep as? HTTPURLResponse else { throw ErreurRR(message: "RetroRevente ne répond pas.", status: 0) }
        if h.statusCode == 401 { stockage.effacer(["cle", "email"]) }
        if !(200..<300).contains(h.statusCode) {
            let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
            throw ErreurRR(message: j?["error"] as? String ?? "RetroRevente ne répond pas (erreur \(h.statusCode)).", status: h.statusCode)
        }
        return (d, h)
    }

    private func connecter(_ m: [String: Any]) async throws -> Any {
        let cle = chaine(m["cle"]).trimmingCharacters(in: .whitespacesAndNewlines)
        guard cle.range(of: #"^rre_[A-Za-z0-9_-]{20,80}$"#, options: .regularExpression) != nil else {
            throw ErreurRR(message: "Clé invalide : elle commence par « rre_ ».", status: 0)
        }
        let s = chaine(m["serveur"])
        stockage.ecrire(["cle": cle, "serveur": Actions.serveurAutorise(s) ? s : Actions.serveurDefaut])
        let j = (try JSONSerialization.jsonObject(with: try await appel("/api/extension/annonces").0)) as? [String: Any] ?? [:]
        let email = j["email"] as? String ?? ""
        stockage.ecrire(["email": email])
        return ["ok": true, "email": email, "n": (j["annonces"] as? [Any])?.count ?? 0]
    }

    private func photo(_ m: [String: Any]) async throws -> Any {
        let id = chaine(m["id"]), p = chaine(m["photo"])
        guard id.range(of: "^[a-f0-9]{16}$", options: .regularExpression) != nil else { throw ErreurRR(message: "Photo inconnue.", status: 0) }
        let suite = p.range(of: "^(p0|[a-f0-9]{8})$", options: .regularExpression) != nil ? "/" + p : ""
        let (d, h) = try await appel("/api/extension/photo/" + id + suite)
        return ["type": h.value(forHTTPHeaderField: "Content-Type") ?? "image/jpeg", "base64": d.base64EncodedString()]
    }

    private func reponse(_ m: [String: Any]) async throws -> Any {
        let precedentes = (m["precedentes"] as? [Any] ?? []).prefix(3).map { String(chaine($0).prefix(500)) }
        let mesMessages = (m["mesMessages"] as? [Any] ?? []).suffix(4).map { String(chaine($0).prefix(600)) }
        let corps: [String: Any] = [
            "annonce": ou(m["annonce"], ""),
            "conversation": String(chaine(m["conversation"]).suffix(5000)),
            "lot": ou(m["lot"], NSNull()),
            "offre": ou(m["offre"], NSNull()),
            "acheteur": String(chaine(m["acheteur"]).prefix(40)),
            "consigne": String(chaine(m["consigne"]).prefix(400)),
            "suite": vrai(m["suite"]),
            "precedentes": precedentes,
            "mesMessages": mesMessages,
        ]
        return try JSONSerialization.jsonObject(with: try await appel("/api/extension/reponse", corps: corps).0)
    }

    // MARK: Ce que l'app fait elle-même

    /// Son « à toi » (pièce, power-up, jingle) : un petit WAV fabriqué par lbc.js, joué ici sans contrainte d'audio de page.
    private func jouerSon(_ wav64: String?) -> Any {
        var son: NSSound? = nil, via = "NSSound (son RetroRevente)"
        if let w = wav64, w.count < 400_000, let d = Data(base64Encoded: w) { son = NSSound(data: d) }
        if son == nil { son = NSSound(named: NSSound.Name("Glass")); via = "NSSound (Glass)" }
        son?.volume = 1
        let ok = son?.play() ?? false
        sonEnCours = son
        if !ok { NSSound.beep() }
        return ["ok": true, "via": via]
    }

    /// Notification système quand la personne doit agir, si elle regarde ailleurs.
    private func alerte(titre: String, texte: String, depuis vue: WKWebView?) -> Any {
        var titre = titre, texte = texte
        defer {
            // Gardée dans la cloche de l'app, même quand la personne regardait ailleurs.
            if let m = fenetre?.modele {
                let depot = m.depot
                m.noter(titre.isEmpty ? "RetroRevente" : titre, texte,
                        symbole: titre.lowercased().contains("prête") || titre.contains("finaliser") ? "checkmark.seal" : titre.lowercased().contains("publiée") ? "party.popper" : "exclamationmark.bubble",
                        cible: depot != nil ? .depot : .aucune, article: depot?.id)
            }
        }
        // Dépôt en coulisses : l'app prend le relais (récapitulatif, ou Le Bon Coin à l'écran s'il a besoin de toi).
        if fenetre?.signalCoulisses(titre: titre, texte: texte) == true {
            if NSApp.isActive { return ["ok": true, "via": "app Mac"] }
            if titre == "À toi de finaliser l'annonce" { titre = "Ton annonce est prête"; texte = "Reviens dans RetroRevente pour la relire et la publier." }
        }
        if NSApp.isActive, let vue = vue, fenetre?.estVisible(vue) == true { return ["ok": true, "via": "déjà sous les yeux"] }
        NSApp.requestUserAttention(.informationalRequest)
        let centre = UNUserNotificationCenter.current()
        centre.requestAuthorization(options: [.alert, .badge]) { accorde, _ in
            guard accorde else { return }
            let c = UNMutableNotificationContent()
            c.title = String((titre.isEmpty ? "RetroRevente" : titre).prefix(80))
            c.body = String(texte.prefix(200))
            centre.add(UNNotificationRequest(identifier: "rr-\(Date().timeIntervalSince1970)", content: c, trigger: nil))
        }
        return ["ok": true, "via": "notification"]
    }
}

/// « Vrai » au sens de JavaScript (pour reprendre les `x || défaut` de background.js).
func vrai(_ x: Any?) -> Bool {
    switch x {
    case nil, is NSNull: return false
    case let s as String: return !s.isEmpty
    case let n as NSNumber: return n.doubleValue != 0 && !n.doubleValue.isNaN
    default: return true
    }
}
func ou(_ x: Any?, _ defaut: Any) -> Any { vrai(x) ? x! : defaut }
func chaine(_ x: Any?) -> String {
    switch x {
    case nil, is NSNull: return ""
    case let s as String: return s
    case let n as NSNumber: return n.stringValue
    default: return String(describing: x!)
    }
}
