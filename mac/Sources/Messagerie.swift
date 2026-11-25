import AppKit
import SwiftUI
import WebKit
import UserNotifications

// Messagerie native : la messagerie Le Bon Coin reste chargée dans un navigateur caché, posé au fond de la fenêtre et
// jamais affiché. L'app lit la liste des conversations et leurs messages (lbc.js, window.rrMessagerie), propose les
// réponses de l'IA et n'envoie un message que sur un clic « Envoyer ».

struct ConversationLbc: Identifiable, Equatable {
    let cle: String; let lignes: [String]; let image: String; var nonLu: Bool
    var id: String { cle }
    var nom: String { lignes.first ?? "Conversation" }
    /// Ligne « Charlotte G. - il y a 2 min » : l'acheteur et la date.
    private var signature: (String, String)? {
        for l in lignes.dropFirst() {
            if let r = l.range(of: " - ", options: .backwards) {
                let d = String(l[r.upperBound...]).trimmingCharacters(in: .whitespaces)
                if ConversationLbc.estDate(d) { return (String(l[..<r.lowerBound]).trimmingCharacters(in: .whitespaces), d) }
            }
        }
        return nil
    }
    var acheteur: String { signature?.0 ?? "" }
    /// Dernier message de la conversation (ni la signature, ni une date seule).
    var apercu: String {
        lignes.dropFirst().first { l in !ConversationLbc.estDate(l) && !(signature.map { l.hasSuffix(" - " + $0.1) } ?? false) } ?? ""
    }
    /// Lignes hors nom et date : titre de l'annonce, puis dernier message.
    var details: [String] { Array(lignes.dropFirst().filter { !ConversationLbc.estDate($0) }.prefix(2)) }
    var date: String { signature?.1 ?? lignes.dropFirst().first(where: ConversationLbc.estDate) ?? "" }
    /// Conversation sans annonce (chatbot promotionnel « Discussion avec le Père Noël »…) : pas affichée.
    var horsAnnonce: Bool { lignes.prefix(2).joined(separator: " ").range(of: #"p[èe]re no[ëe]l|chatbot|^discussion avec\b"#, options: [.regularExpression, .caseInsensitive]) != nil }
    static func estDate(_ s: String) -> Bool {
        s.range(of: #"^(il y a .*|hier.*|aujourd'hui.*|\d{1,2}[:h]\d{2}|\d{1,2}/\d{1,2}(/\d{2,4})?|(lun|mar|mer|jeu|ven|sam|dim)\w*\.?|\d{1,2} \p{L}+\.?( \d{4})?)$"#, options: [.regularExpression, .caseInsensitive]) != nil
    }
    init(_ d: [String: Any]) {
        cle = d["cle"] as? String ?? UUID().uuidString; lignes = d["lignes"] as? [String] ?? []
        image = d["image"] as? String ?? ""; nonLu = d["nonLu"] as? Bool ?? false
    }
}

struct MessageLbc: Identifiable, Equatable {
    enum Genre: Equatable { case message, heure, auto }
    let id: Int; let cote: String; var texte: String; var meta: String
    var genre: Genre = .message
    /// Première ligne d'un message automatique Le Bon Coin (« Offre reçue », « Vendu ! »…) et le reste.
    var titreAuto: String { texte.components(separatedBy: "\n").first ?? texte }
    var corpsAuto: String { texte.components(separatedBy: "\n").dropFirst().joined(separator: "\n") }
    static let premieresLignesAuto = #"^(offre (reçue|acceptée|refusée|expirée|envoyée)|vendu ?!?|paiement.*|colis.*|votre colis.*|achat.*confirm.*|transaction.*|réservé.*|annonce (désactivée|supprimée|expirée))$"#
}

struct FilLbc: Equatable {
    var cle = "", acheteur = "", annonce: [String] = [], dernierMoi = false, bloque = false, messages: [MessageLbc] = []
    init() {}
    init(_ d: [String: Any]) {
        cle = d["cle"] as? String ?? ""; acheteur = d["acheteur"] as? String ?? ""; annonce = d["annonce"] as? [String] ?? []
        dernierMoi = d["dernierMoi"] as? Bool ?? false; bloque = d["bloque"] as? Bool ?? false
        let bruts = (d["messages"] as? [[String: Any]] ?? []).enumerated().map { i, m in
            MessageLbc(id: i, cote: m["cote"] as? String ?? "lui", texte: (m["texte"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines), meta: m["meta"] as? String ?? "")
        }
        messages = FilLbc.ranger(bruts)
    }
    /// Range le fil lu dans la page : les mentions « il y a 7 min - Message automatique leboncoin » rejoignent le message
    /// qu'elles signent (qui devient une carte Le Bon Coin), les heures seules deviennent des séparateurs.
    static func ranger(_ l: [MessageLbc]) -> [MessageLbc] {
        var out: [MessageLbc] = []
        for var m in l where !m.texte.isEmpty {
            if m.texte.range(of: #"message automatique"#, options: [.regularExpression, .caseInsensitive]) != nil, m.texte.count < 90, !out.isEmpty {
                out[out.count - 1].genre = .auto
                continue
            }
            if ConversationLbc.estDate(m.texte) {
                if out.last?.genre == .heure { out[out.count - 1].texte = m.texte; continue }
                m.genre = .heure; out.append(m); continue
            }
            if m.titreAuto.range(of: MessageLbc.premieresLignesAuto, options: [.regularExpression, .caseInsensitive]) != nil { m.genre = .auto }
            out.append(m)
        }
        return out
    }
}

struct ReponseIA: Identifiable, Equatable {
    let id = UUID(); let approche: String; let titre: String; let texte: String
}

@MainActor
final class Messagerie: NSObject, ObservableObject, WKNavigationDelegate {
    enum Etat: Equatable { case veille, chargement, pret, connexion, erreur(String) }
    @Published var etat: Etat = .veille
    @Published var conversations: [ConversationLbc] = []
    @Published var ouverte: String? = nil
    @Published var fil = FilLbc()
    @Published var filCharge = false
    @Published var reponses: [ReponseIA] = []
    @Published var resume = ""
    @Published var iaCharge = false
    @Published var iaErreur = ""
    @Published var brouillon = ""
    @Published var envoi = false
    @Published var avis = ""

    /// Conversations masquées dans l'app (gardées sur Le Bon Coin) : on peut les faire réapparaître.
    @Published var masquees: Set<String> = Set(UserDefaults.standard.stringArray(forKey: "conversationsMasquees") ?? []) {
        didSet { UserDefaults.standard.set(Array(masquees), forKey: "conversationsMasquees") }
    }
    /// Conversations dont l'acheteur est bloqué (vu dans Le Bon Coin ou bloqué depuis l'app).
    @Published var bloques: Set<String> = Set(UserDefaults.standard.stringArray(forKey: "conversationsBloquees") ?? []) {
        didSet { UserDefaults.standard.set(Array(bloques), forKey: "conversationsBloquees") }
    }
    var ouverteBloquee: Bool { fil.bloque || (ouverte.map { bloques.contains($0) } ?? false) }
    @Published var suppression: String? = nil

    weak var fenetre: Fenetre?
    private var vue: WKWebView?
    private var minuterie: Timer?
    private var charge = false
    /// Début du chargement en cours : passé `delaiMax` sans conversation lue, on affiche une erreur claire.
    private var debut: Date? = nil
    private let delaiMax: TimeInterval = 35
    private var garde: Task<Void, Never>? = nil
    private var derniereErreur = ""

    /// À l'ouverture de l'onglet Messages : la messagerie se charge en fond (une fois), puis se relit régulièrement.
    func demarrer(_ f: Fenetre) {
        fenetre = f
        guard ProcessInfo.processInfo.environment["RR_DEMO"] == nil else { return }
        if vue == nil {
            let v = f.navigateurCache()
            v.navigationDelegate = self
            f.accueillirEnFond(v, taille: NSSize(width: 1440, height: 960))
            vue = v
        }
        if !charge { recharger() } else { Task { await lire() } }
        minuterie?.invalidate()
        minuterie = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in Task { @MainActor in await self?.lire() } }
    }
    /// Captures de démonstration (CI) : une messagerie fictive.
    func demo() {
        etat = .pret
        conversations = [
            ConversationLbc(["cle": "c1", "lignes": ["Garnier", "Lot Nintendo 64 : 2 jeux", "Bonjour, je peux passer ce soir ?", "14:32"], "nonLu": true]),
            ConversationLbc(["cle": "c2", "lignes": ["EM54Retro", "Super Mario 64", "Merci, bien reçu !", "hier"]]),
            ConversationLbc(["cle": "c3", "lignes": ["Evelyne", "Dracaufeu holo 4/102", "Vous feriez 150 € ?", "lun."]]),
        ]
        ouverte = "c1"
        fil = FilLbc(["cle": "c1", "acheteur": "Garnier", "annonce": ["Lot Nintendo 64 : 2 jeux", "75 €"], "messages": [
            ["cote": "centre", "texte": "Aujourd'hui"],
            ["cote": "lui", "texte": "Bonjour, votre lot est toujours disponible ? Vous feriez 60 € ?", "meta": "14:28"],
            ["cote": "moi", "texte": "Bonjour Garnier ! Oui, il est disponible 🙂 Je peux le laisser à 70 €.", "meta": "14:30 · Lu"],
            ["cote": "lui", "texte": "D'accord pour 70 €. Je peux passer ce soir ?", "meta": "14:32"],
        ]])
        resume = "Garnier accepte 70 € et propose de passer ce soir."
        reponses = [
            ReponseIA(approche: "accepter", titre: "Confirmer le rendez-vous", texte: "Parfait, ce soir ça me va ! À partir de 18 h, je vous envoie l'adresse 🙂"),
            ReponseIA(approche: "ferme", titre: "Proposer l'envoi", texte: "Super ! Si c'est plus simple, je peux aussi l'envoyer avec le paiement sécurisé 🙂"),
        ]
    }
    func arreter() { minuterie?.invalidate(); minuterie = nil }

    func recharger() {
        guard let v = vue else { return }
        NSLog("RetroRevente messagerie : chargement de la messagerie Le Bon Coin (en fond)")
        etat = .chargement; charge = true; debut = Date(); derniereErreur = ""
        v.load(URLRequest(url: URL(string: "https://www.leboncoin.fr/messages")!))
        // Garde-fou : relit toutes les 3 s jusqu'au délai maximum, puis erreur claire (plus de roue sans fin).
        garde?.cancel()
        garde = Task { [weak self] in
            while let s = self, s.debut != nil {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                guard !Task.isCancelled, let s = self, let d = s.debut else { return }
                await s.lire()
                if s.debut != nil, Date().timeIntervalSince(d) > s.delaiMax {
                    s.debut = nil
                    await s.diagnostiquer("delai")
                    s.etat = .erreur("La messagerie Le Bon Coin ne s'est pas chargée." + (s.derniereErreur.isEmpty ? "" : "\n(" + s.derniereErreur + ")"))
                    return
                }
            }
        }
    }

    func webView(_ v: WKWebView, didFinish n: WKNavigation!) {
        Task { for d in [1.0, 2.5, 5.0] { try? await Task.sleep(nanoseconds: UInt64(d * 1e9)); await lire(); if !conversations.isEmpty { break } } }
    }
    func webView(_ v: WKWebView, didFail n: WKNavigation!, withError e: Error) { echec("Le Bon Coin ne répond pas.", e) }
    func webView(_ v: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { echec("Le Bon Coin ne répond pas. Vérifie ta connexion.", e) }
    private func echec(_ t: String, _ e: Error) {
        if (e as NSError).code == NSURLErrorCancelled { return }   // navigation remplacée par une autre (redirection) : pas une erreur
        NSLog("RetroRevente messagerie : échec de chargement %@", e.localizedDescription)
        debut = nil; garde?.cancel(); etat = .erreur(t); derniereErreur = e.localizedDescription
        Task { await diagnostiquer("echec") }
    }

    private func appel(_ js: String, _ args: [String: Any] = [:]) async -> [String: Any]? {
        guard let v = vue else { return nil }
        do {
            // Résultat passé en texte JSON : rien ne se perd entre la page et l'app.
            let r = try await Messagerie.appelJS(v, "const __r = await (async () => { if (!window.rrMessagerie) return { absent: true }; " + js + " })(); return JSON.stringify(__r === undefined ? null : __r);", args)
            if let t = r as? String, let o = try? JSONSerialization.jsonObject(with: Data(t.utf8)) as? [String: Any] { return o }
            return r as? [String: Any] ?? ["erreur": "Réponse vide de la page (\(r.map { String(describing: type(of: $0)) + " " + String(describing: $0).prefix(80) } ?? "nil"))"]
        } catch {
            NSLog("RetroRevente messagerie : erreur JavaScript %@", String(describing: error))
            return ["erreur": "Erreur JavaScript", "pile": String(describing: error)]
        }
    }

    /// Relit la liste (et le fil ouvert) sans rien toucher sur la page.
    func lire() async {
        guard let r = await appel("return await window.rrMessagerie.liste();") else { return }
        if (r["absent"] as? Bool) == true { derniereErreur = "RetroRevente n'est pas encore chargé dans la page"; return }
        if let e = r["erreur"] as? String {
            derniereErreur = e
            NSLog("RetroRevente messagerie : %@ %@", e, r["pile"] as? String ?? "")
            return
        }
        if (r["connexion"] as? Bool) == true {
            if debut != nil { debut = nil; await diagnostiquer("connexion") }
            etat = .connexion; return
        }
        // null : la page ne montre que la conversation ouverte, on garde la liste déjà lue.
        let l = (r["conversations"] as? [[String: Any]]).map { $0.map(ConversationLbc.init).filter { !$0.horsAnnonce && !masquees.contains($0.cle) } } ?? conversations
        let marquee = marquerNonLus(l)
        if marquee != conversations { withAnimation(.easeOut(duration: 0.25)) { conversations = marquee } }
        if !l.isEmpty {
            if debut != nil { debut = nil; await diagnostiquer("ok") }
            etat = .pret
        } else if (r["vide"] as? Bool) == true {
            debut = nil; etat = .pret   // la page dit qu'il n'y a aucune conversation
        }
        if ouverte != nil, let f = r["fil"] as? [String: Any] {
            let n = purger(FilLbc(f))
            if n.cle == fil.cle, n != fil {
                let nouveau = n.messages.count != fil.messages.count
                fil = n
                if nouveau && !n.dernierMoi { reponses = []; Task { await proposer() } }
            }
        }
    }

    // Versions à rappel (completion handler) : les variantes async de WebKit rendaient un résultat vide sur certains macOS.
    static func appelJS(_ v: WKWebView, _ js: String, _ args: [String: Any]) async throws -> Any? {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Any?, Error>) in
            v.callAsyncJavaScript(js, arguments: args, in: nil, in: Scripts.monde) { r in
                switch r { case .success(let x): c.resume(returning: x); case .failure(let e): c.resume(throwing: e) }
            }
        }
    }
    static func evaluerJS(_ v: WKWebView, _ js: String) async throws -> Any? {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Any?, Error>) in
            v.evaluateJavaScript(js, in: nil, in: Scripts.monde) { r in
                switch r { case .success(let x): c.resume(returning: x); case .failure(let e): c.resume(throwing: e) }
            }
        }
    }

    /// Diagnostic sans contenu privé (structure de la page, pas les messages) : ~/Library/Application Support/RetroRevente/diag-messagerie.json
    func diagnostiquer(_ raison: String) async {
        guard let v = vue else { return }
        let js = """
        var D = /il y a|\\bhier\\b|aujourd'hui|^\\d{1,2}[:h]\\d{2}$|^\\d{1,2}\\/\\d{1,2}(\\/\\d{2,4})?$|^(lun|mar|mer|jeu|ven|sam|dim)\\w*\\.?$|^\\d{1,2} \\p{L}+\\.?( \\d{4})?$/iu;
        var masque = function (t) { return String(t || '').replace(/\\p{L}/gu, 'x').replace(/\\d/g, '9').slice(0, 80); };
        var chemin = function (e) { var l = []; for (var k = 0; e && e !== document.body && k < 9; e = e.parentElement, k++) { var r = e.getBoundingClientRect(); l.push(e.tagName.toLowerCase() + (e.getAttribute('role') ? '[role=' + e.getAttribute('role') + ']' : '') + (e.getAttribute('data-qa-id') ? '[qa=' + e.getAttribute('data-qa-id') + ']' : '') + (e.getAttribute('data-test-id') ? '[test=' + e.getAttribute('data-test-id') + ']' : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).slice(0, 3).join('.') : '') + ' ' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' t' + (e.innerText || '').length); } return l; };
        var dates = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), n;
        while ((n = w.nextNode()) && dates.length < 12) { var t = (n.nodeValue || '').trim(); if (t && t.length < 30 && D.test(t)) dates.push({ texte: t, chemin: chemin(n.parentElement) }); }
        var main = document.querySelector('main');
        return JSON.stringify({
          url: location.href.replace(/\\d{4,}/g, '#'), titre: document.title.replace(/\\d/g, '9'), etat: document.readyState,
          rrMessagerie: !!window.rrMessagerie, rrNatif: !!window.__rrNatif, fenetre: innerWidth + 'x' + innerHeight, visibilite: document.visibilityState,
          texteBody: (document.body && document.body.innerText || '').length, texteMain: main ? main.innerText.length : -1,
          iframes: [].map.call(document.querySelectorAll('iframe'), function (f) { try { var u = new URL(f.src, location.href); return u.host + u.pathname.replace(/\\d{4,}/g, '#') + ' ' + f.offsetWidth + 'x' + f.offsetHeight; } catch (e) { return '?'; } }).slice(0, 10),
          liens: [].map.call(document.querySelectorAll('a[href*=messag]'), function (a) { return a.getAttribute('href').replace(/[0-9a-f-]{8,}/gi, '#'); }).slice(0, 15),
          compte: { a: document.querySelectorAll('a[href]').length, li: document.querySelectorAll('li').length, listitem: document.querySelectorAll('[role=listitem]').length, boutons: document.querySelectorAll('button,[role=button]').length, textarea: document.querySelectorAll('textarea').length, editable: document.querySelectorAll('[contenteditable]').length, motDePasse: document.querySelectorAll('input[type=password]').length, img: document.querySelectorAll('img').length },
          dates: dates, esquisse: masque((main || document.body).innerText.replace(/\\s+/g, ' ')).slice(0, 600)
        });
        """
        var d: [String: Any] = ["vue": ["url": (v.url?.absoluteString ?? "nil").replacingOccurrences(of: #"\d{4,}"#, with: "#", options: .regularExpression), "titre": v.title ?? "", "charge": v.isLoading, "progres": v.estimatedProgress, "fenetre": v.window != nil, "taille": "\(Int(v.frame.width))x\(Int(v.frame.height))"],
                                "raison": raison, "quand": ISO8601DateFormatter().string(from: Date()), "derniereErreur": derniereErreur,
                                "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?", "conversations": conversations.count]
        do {
            let r = try await Messagerie.evaluerJS(v, js)
            if let t = r as? String, let o = try? JSONSerialization.jsonObject(with: Data(t.utf8)) { d["page"] = o }
            else { d["pageBrut"] = r.map { String(describing: type(of: $0)) + " " + String(describing: $0).prefix(200) } ?? "nil" }
        } catch { d["erreurDiagnostic"] = String(describing: error) }
        if let l = await appel("return await window.rrMessagerie.liste();") {
            d["liste"] = ["cles": Array(l.keys), "erreur": l["erreur"] ?? "", "pile": l["pile"] ?? "", "n": (l["conversations"] as? [Any])?.count ?? -1]
        }
        let dossier = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("RetroRevente")
        try? FileManager.default.createDirectory(at: dossier, withIntermediateDirectories: true)
        if let data = try? JSONSerialization.data(withJSONObject: d, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: dossier.appendingPathComponent("diag-messagerie.json"))
        }
        NSLog("RetroRevente messagerie : diagnostic %@ (%d conversations)", raison, conversations.count)
    }

    /// Le dernier clic gagne : une conversation se choisit même pendant le chargement d'une autre ou pendant que l'IA réfléchit.
    private var jetonOuverture = 0, jetonIA = 0
    func ouvrir(_ c: ConversationLbc) async {
        jetonOuverture += 1; let jeton = jetonOuverture
        marquerLue(c)
        ouverte = c.cle; filCharge = true; fil = FilLbc(); reponses = []; resume = ""; iaErreur = ""; brouillon = ""; avis = ""
        jetonIA += 1; iaCharge = false
        let r = await appel("return await window.rrMessagerie.ouvrir(cle, lignes);", ["cle": c.cle, "lignes": c.lignes])
        guard jeton == jetonOuverture else { return }
        filCharge = false
        guard let r = r else { return }
        if r["erreur"] != nil { avis = "Cette conversation n'est plus dans la liste."; await lire(); return }
        fil = purger(FilLbc(r))
        if fil.bloque { bloques.insert(c.cle) }
        await lire()
        if jeton == jetonOuverture, !fil.dernierMoi, !ouverteBloquee { await proposer() }
    }

    // Non lus : le rond jaune n'apparaît que sur une conversation dont le dernier message a changé depuis que tu l'as
    // ouverte (ou que Le Bon Coin marque non lue). Au tout premier passage, tout est considéré comme lu.
    private var vus: [String: String] = UserDefaults.standard.dictionary(forKey: "conversationsVues") as? [String: String] ?? [:] {
        didSet { UserDefaults.standard.set(vus, forKey: "conversationsVues") }
    }
    private var notifiees: Set<String> = []
    private func signature(_ c: ConversationLbc) -> String { c.apercu.isEmpty ? c.lignes.dropFirst().joined(separator: "|") : c.apercu }
    private func marquerNonLus(_ l: [ConversationLbc]) -> [ConversationLbc] {
        let premier = UserDefaults.standard.object(forKey: "conversationsVues") == nil
        var out: [ConversationLbc] = []
        for var c in l {
            let sig = signature(c)
            if c.cle == ouverte || premier { vus[c.cle] = sig; c.nonLu = false }
            else if let v = vus[c.cle] { c.nonLu = c.nonLu || v != sig }
            else { c.nonLu = true }
            if c.nonLu, !premier, !notifiees.contains(c.cle + sig) {
                notifiees.insert(c.cle + sig)
                if vus[c.cle] != nil || !vus.isEmpty { notifier(c) }
            }
            out.append(c)
        }
        if premier { UserDefaults.standard.set(vus, forKey: "conversationsVues") }
        let n = out.filter(\.nonLu).count
        NSApp.dockTile.badgeLabel = n > 0 ? "\(n)" : nil
        return out
    }
    private func notifier(_ c: ConversationLbc) {
        let titre = c.acheteur.isEmpty ? "Nouveau message" : "Message de \(c.acheteur)"
        let corps = c.apercu.isEmpty ? c.nom : "\(c.nom) : \(c.apercu)"
        fenetre?.modele.noter(titre, corps, symbole: "bubble.left.and.bubble.right", cible: .messages)
        guard !(NSApp.isActive && fenetre?.modele.messagesOuvert == true) else { return }
        let centre = UNUserNotificationCenter.current()
        centre.requestAuthorization(options: [.alert, .sound, .badge]) { ok, _ in
            guard ok else { return }
            let n = UNMutableNotificationContent()
            n.title = String(titre.prefix(80)); n.body = String(corps.prefix(200)); n.sound = .default
            centre.add(UNNotificationRequest(identifier: "rr-msg-\(Date().timeIntervalSince1970)", content: n, trigger: nil))
        }
    }
    private func marquerLue(_ c: ConversationLbc) {
        vus[c.cle] = signature(c)
        if let i = conversations.firstIndex(where: { $0.cle == c.cle }) { conversations[i].nonLu = false }
        let n = conversations.filter(\.nonLu).count
        NSApp.dockTile.badgeLabel = n > 0 ? "\(n)" : nil
    }

    func masquer(_ c: ConversationLbc) {
        masquees.insert(c.cle)
        fenetre?.modele.message = "Conversation masquée ici (elle reste sur Le Bon Coin)."
        withAnimation(.easeOut(duration: 0.25)) { conversations.removeAll { $0.cle == c.cle } }
        if ouverte == c.cle { ouverte = nil; fil = FilLbc() }
    }
    func toutAfficher() { masquees = []; Task { await lire() } }

    /// Supprime la conversation sur Le Bon Coin (l'app a demandé confirmation). Si le bouton n'est pas trouvé, on le dit.
    func supprimer(_ c: ConversationLbc) async {
        suppression = c.cle; defer { suppression = nil }
        fenetre?.modele.message = "Suppression de la conversation sur Le Bon Coin…"
        let r = await appel("return await window.rrMessagerie.supprimer(cle);", ["cle": c.cle])
        if (r?["ok"] as? Bool) == true {
            withAnimation(.easeOut(duration: 0.25)) { conversations.removeAll { $0.cle == c.cle } }
            if ouverte == c.cle { ouverte = nil; fil = FilLbc() }
            fenetre?.modele.message = "Conversation supprimée : Le Bon Coin ne l'affiche plus."
        } else {
            let pourquoi = r?["erreur"] as? String == "confirmation" ? "elle est toujours dans ta messagerie Le Bon Coin" : "je n'ai pas trouvé le bouton « Supprimer »"
            fenetre?.modele.message = "⚠️ Pas supprimée : \(pourquoi). Tu peux la masquer ici, ou la supprimer sur le site."
        }
        await lire()
    }

    /// Retire du fil ce qui n'est pas un message de cette conversation : morceaux de la liste (« Morgan - 22 nov. »,
    /// titre d'une autre annonce, aperçu d'une autre conversation) et fiche de l'acheteur, que Le Bon Coin glisse
    /// dans la colonne quand sa mise en page change (après un blocage, par exemple).
    func purger(_ f: FilLbc) -> FilLbc {
        let n: (String) -> String = { $0.lowercased().replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: CharacterSet(charactersIn: " .…")) }
        var liste = Set<String>(), noms = Set<String>()
        for c in conversations {
            let a = c.acheteur.isEmpty ? (c.lignes.first ?? "") : c.acheteur
            noms.insert(n(a)); if let p = c.lignes.first { noms.insert(n(p)) }
            for l in c.lignes where !(c.cle == ouverte && l == c.apercu) {
                liste.insert(n(l))
                if let r = l.range(of: " - ", options: .backwards) { liste.insert(n(String(l[..<r.lowerBound]))) }
            }
        }
        if !f.acheteur.isEmpty { noms.insert(n(f.acheteur)) }
        let fiche = #"^(à propos de|a propos de|membre depuis|\d+ transactions?|temps de r[ée]ponse|derni[èe]re activit[ée]|l.utilisateur est bloqu|impossible de recevoir|[()]$|\(\s*\d+\s*\)$|[0-5]([.,]\d)?$)"#
        var g = f
        g.messages = f.messages.filter { m in
            if m.genre == .heure { return true }
            let ls = m.texte.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            guard let premiere = ls.first else { return false }
            if premiere.range(of: fiche, options: [.regularExpression, .caseInsensitive]) != nil { return false }
            if ls.count == 1, noms.contains(n(premiere)) { return false }
            if m.cote != "moi", ls.allSatisfy({ liste.contains(n($0)) || noms.contains(n($0)) || $0 == "-" || ConversationLbc.estDate($0) }) { return false }
            return true
        }
        // Une heure restée seule en fin de fil (son message a été retiré) ne sert à rien.
        while g.messages.last?.genre == .heure { g.messages.removeLast() }
        return g
    }

    /// Affichage seulement (jamais dans le message envoyé) : montants, nom de l'acheteur et mots qui décident en gras.
    static func enGras(_ t: String, nom: String) -> AttributedString {
        var a = AttributedString(t)
        var motifs = [#"\d[\d  .,]*\s?€"#,
                      #"(?i)\b(offres? (déjà )?(refusée?s?|acceptée?s?|expirée?s?|reçue?s?)|nouvelle offre|contre-offre|achat immédiat|vendue?|réservée?|paiement sécurisé|remise en main propre|envoi|colis|dernier prix|prix ferme|petit geste|pas en dessous)\b"#]
        let n = nom.trimmingCharacters(in: .whitespaces)
        if n.count >= 2 { motifs.append("(?i)" + NSRegularExpression.escapedPattern(for: n)) }
        for motif in motifs {
            guard let re = try? NSRegularExpression(pattern: motif) else { continue }
            for r in re.matches(in: t, range: NSRange(t.startIndex..., in: t)) {
                guard let rs = Range(r.range, in: t), let lo = AttributedString.Index(rs.lowerBound, within: a), let hi = AttributedString.Index(rs.upperBound, within: a) else { continue }
                a[lo..<hi].inlinePresentationIntent = .stronglyEmphasized
            }
        }
        return a
    }

    /// Bloque l'acheteur sur Le Bon Coin (l'app a demandé confirmation). Si le bouton n'est pas trouvé, on le dit.
    func bloquer(_ c: ConversationLbc) async {
        suppression = c.cle; defer { suppression = nil }
        let qui = c.acheteur.isEmpty ? c.nom : c.acheteur
        fenetre?.modele.message = "Blocage de \(qui) sur Le Bon Coin…"
        let r = await appel("return await window.rrMessagerie.bloquer(cle, lignes);", ["cle": c.cle, "lignes": c.lignes])
        if (r?["ok"] as? Bool) == true, (r?["verifie"] as? Bool) == true {
            bloques.insert(c.cle); if ouverte == c.cle { reponses = []; resume = "" }
            fenetre?.modele.message = (r?["deja"] as? Bool) == true ? "Ce compte était déjà bloqué sur Le Bon Coin." : "Le Bon Coin confirme le blocage : \(qui) ne peut plus t'écrire."
        } else if (r?["ok"] as? Bool) == true {
            fenetre?.modele.message = "⚠️ J'ai cliqué « Bloquer », mais Le Bon Coin ne l'a pas confirmé. Vérifie sur le site."
        } else {
            fenetre?.modele.message = "⚠️ Pas bloqué : je n'ai pas trouvé le bouton « Bloquer » de Le Bon Coin. Tu peux le faire sur le site."
        }
        await lire()
    }

    /// Réponses de l'IA pour la conversation ouverte (avec une consigne : « dis-lui que… »).
    func proposer(_ consigne: String = "") async {
        guard let pour = ouverte, !ouverteBloquee else { return }
        jetonIA += 1; let j = jetonIA
        iaCharge = true; iaErreur = ""; defer { if j == jetonIA { iaCharge = false } }
        let rep = await appel("return await window.rrMessagerie.suggestions(consigne);", ["consigne": consigne])
        guard j == jetonIA, ouverte == pour else { return }   // une autre conversation a été choisie entre-temps
        guard let r = rep else { iaErreur = "L'IA ne répond pas."; return }
        if let e = r["erreur"] as? String { iaErreur = e; return }
        resume = r["resume"] as? String ?? ""
        reponses = (r["reponses"] as? [[String: Any]] ?? []).map { ReponseIA(approche: $0["approche"] as? String ?? "", titre: $0["titre"] as? String ?? "", texte: $0["texte"] as? String ?? "") }
    }

    /// Seulement sur le clic « Envoyer » : écrit le message dans Le Bon Coin (caché) et clique son bouton d'envoi.
    func envoyer() async {
        let t = brouillon.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !envoi, ouverte != nil else { return }
        envoi = true; avis = ""; defer { envoi = false }
        guard let r = await appel("return await window.rrMessagerie.envoyer(texte);", ["texte": t]) else { avis = "Envoi impossible : Le Bon Coin ne répond pas."; return }
        if let e = r["erreur"] as? String { avis = e; return }
        brouillon = ""; reponses = []; resume = ""
        if let f = r["fil"] as? [String: Any] { fil = purger(FilLbc(f)) }
        avis = (r["incertain"] as? Bool) == true ? "Message parti ? Je ne vois pas encore la confirmation de Le Bon Coin : vérifie dans un instant." : ""
        await lire()
    }
}

// MARK: Vues

struct MessagesVue: View {
    @ObservedObject var appli: Appli
    @ObservedObject var m: Messagerie
    @State private var consigne = ""
    @State private var survol: String? = nil
    @State private var aSupprimer: ConversationLbc? = nil
    @State private var aBloquer: ConversationLbc? = nil
    @Environment(\.accessibilityReduceMotion) private var sansMouvement

    var body: some View {
        HStack(spacing: 0) {
            liste.frame(width: 330)
            detail.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Color.rrFond.ignoresSafeArea())
        .onAppear { if let f = appli.fenetre { m.demarrer(f) } }
        .onDisappear { m.arreter() }
        .confirmationDialog("Supprimer la conversation avec \(aSupprimer.map { $0.acheteur.isEmpty ? $0.nom : $0.acheteur } ?? "") ?",
                            isPresented: Binding(get: { aSupprimer != nil }, set: { if !$0 { aSupprimer = nil } }), presenting: aSupprimer) { c in
            Button("Supprimer sur Le Bon Coin", role: .destructive) { Task { await m.supprimer(c) } }
            Button("Seulement la masquer ici") { m.masquer(c) }
        } message: { _ in Text("Supprimée sur Le Bon Coin, elle ne pourra pas être récupérée. Masquée, elle reste sur Le Bon Coin et tu peux la faire réapparaître.") }
        .confirmationDialog("Bloquer \(aBloquer.map { $0.acheteur.isEmpty ? $0.nom : $0.acheteur } ?? "") ?",
                            isPresented: Binding(get: { aBloquer != nil }, set: { if !$0 { aBloquer = nil } }), presenting: aBloquer) { c in
            Button("Bloquer sur Le Bon Coin", role: .destructive) { Task { await m.bloquer(c) } }
        } message: { _ in Text("Cette personne ne pourra plus t'écrire ni t'envoyer d'offre. Tu pourras la débloquer plus tard sur Le Bon Coin.") }
    }

    // MARK: Liste des conversations

    private var nonLus: Int { m.conversations.filter(\.nonLu).count }

    private var liste: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("Messages").font(.system(size: 28, weight: .heavy, design: .rounded))
                if nonLus > 0 {
                    Text("\(nonLus)").font(.caption.weight(.heavy).monospacedDigit()).foregroundStyle(.white)
                        .padding(.horizontal, 7).padding(.vertical, 2).background(Color.rrAccent, in: Capsule())
                        .transition(.scale.combined(with: .opacity))
                }
                Spacer()
                Menu {
                    Button("Relire la messagerie") { m.recharger() }
                    if !m.masquees.isEmpty { Button("Réafficher les conversations masquées (\(m.masquees.count))") { m.toutAfficher() } }
                    Divider()
                    Button("Ouvrir sur Le Bon Coin") { appli.fenetre?.allerSurLeSite(.messages) }
                } label: { Image(systemName: "ellipsis.circle").font(.title3) } primaryAction: { m.recharger() }
                .menuStyle(.borderlessButton).fixedSize().help("Relire (clic) · plus d'options (flèche)")
            }
            .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 12)
            .animation(.spring(response: 0.3, dampingFraction: 0.8), value: nonLus)
            switch m.etat {
            case .veille, .chargement where m.conversations.isEmpty:
                etatVide(symbole: nil, texte: "Je lis ta messagerie Le Bon Coin…")
            case .connexion:
                VStack(spacing: 12) {
                    Image(systemName: "person.crop.circle.badge.exclamationmark").font(.system(size: 38)).foregroundStyle(Color.rrAccent)
                    Text("Le Bon Coin te demande de te connecter.").multilineTextAlignment(.center)
                    Button("Ouvrir Le Bon Coin") { appli.fenetre?.allerSurLeSite(.messages) }.boutonVerre(principal: true)
                }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity)
            case .erreur(let t):
                VStack(spacing: 12) { Text(t).multilineTextAlignment(.center).foregroundStyle(.secondary); Button("Réessayer") { m.recharger() }.boutonVerre() }
                    .padding(24).frame(maxWidth: .infinity, maxHeight: .infinity)
            default:
                if m.conversations.isEmpty {
                    etatVide(symbole: "tray", texte: "Aucune conversation pour l'instant.")
                } else {
                    ScrollView {
                        LazyVStack(spacing: 6) {
                            ForEach(m.conversations) { c in
                                ligne(c).transition(.asymmetric(insertion: .move(edge: .top).combined(with: .opacity), removal: .move(edge: .leading).combined(with: .opacity)))
                            }
                        }.padding(.horizontal, 12).padding(.bottom, 14)
                    }
                }
            }
        }
        .background(Color.rrSurface)
        .overlay(alignment: .trailing) { Rectangle().fill(Color.primary.opacity(0.06)).frame(width: 1) }
    }

    private func etatVide(symbole: String?, texte: String) -> some View {
        VStack(spacing: 12) {
            if let s = symbole { Image(systemName: s).font(.system(size: 34, weight: .light)).foregroundStyle(.secondary) } else { ProgressView() }
            Text(texte).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func vignette(_ url: String, taille: CGFloat, rayon: CGFloat) -> some View {
        AsyncImage(url: URL(string: url)) { i in i.resizable().scaledToFill() } placeholder: {
            LinearGradient(colors: [Color.rrAccent.opacity(0.35), Color.rrAccent.opacity(0.12)], startPoint: .topLeading, endPoint: .bottomTrailing)
                .overlay(Image(systemName: "gamecontroller.fill").foregroundStyle(Color.rrAccent))
        }
        .frame(width: taille, height: taille).clipShape(RoundedRectangle(cornerRadius: rayon, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: rayon, style: .continuous).stroke(Color.primary.opacity(0.08)))
    }

    private func ligne(_ c: ConversationLbc) -> some View {
        let active = m.ouverte == c.cle, survole = survol == c.cle
        return Button { Task { await m.ouvrir(c) } } label: {
            HStack(alignment: .center, spacing: 12) {
                vignette(c.image, taille: 52, rayon: 13)
                    .shadow(color: .black.opacity(0.18), radius: 4, y: 2)
                    .overlay(alignment: .topTrailing) {
                        if c.nonLu {
                            Circle().fill(Color.rrAccent).frame(width: 12, height: 12)
                                .overlay(Circle().stroke(Color.rrFond, lineWidth: 2)).offset(x: 4, y: -4)
                                .transition(.scale)
                        }
                    }
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(c.acheteur.isEmpty ? c.nom : c.acheteur).font(.system(size: 13.5, weight: c.nonLu ? .heavy : .semibold, design: .rounded)).lineLimit(1)
                        if m.bloques.contains(c.cle) {
                            Label("Bloqué", systemImage: "nosign").labelStyle(.titleAndIcon).font(.caption2.weight(.bold)).foregroundStyle(.red)
                                .padding(.horizontal, 6).padding(.vertical, 2).background(Color.red.opacity(0.1), in: Capsule())
                        }
                        Spacer(minLength: 4)
                        Text(c.date).font(.caption2.weight(c.nonLu ? .bold : .regular)).foregroundStyle(c.nonLu ? Color.rrAccent : .secondary).lineLimit(1)
                    }
                    if !c.acheteur.isEmpty {
                        Text(c.nom).font(.caption.weight(.semibold)).foregroundStyle(Color.rrAccent.opacity(0.9)).lineLimit(1)
                    }
                    Text(c.apercu.isEmpty ? (c.details.last ?? "") : c.apercu).font(.caption)
                        .foregroundStyle(c.nonLu ? .primary : .secondary).lineLimit(1)
                }
            }
            .padding(.horizontal, 10).padding(.vertical, 9).contentShape(Rectangle())
            .background {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(active ? Color.rrAccent.opacity(0.18) : survole ? Color.primary.opacity(0.06) : .clear)
            }
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(active ? Color.rrAccent.opacity(0.7) : .clear, lineWidth: 1.5))
            .opacity(m.suppression == c.cle ? 0.4 : 1)
        }
        .buttonStyle(.plain)
        .onHover { h in withAnimation(.easeOut(duration: 0.12)) { survol = h ? c.cle : (survol == c.cle ? nil : survol) } }
        .contextMenu {
            Button("Masquer cette conversation") { m.masquer(c) }
            Button("Bloquer cet utilisateur…", role: .destructive) { aBloquer = c }
            Button("Supprimer…", role: .destructive) { aSupprimer = c }
        }
    }

    // MARK: Conversation

    private var acheteurOuvert: String { m.fil.acheteur.isEmpty ? (conversationOuverte?.acheteur ?? "") : m.fil.acheteur }
    private var conversationOuverte: ConversationLbc? { m.conversations.first { $0.cle == m.ouverte } }

    @ViewBuilder private var detail: some View {
        if m.ouverte == nil {
            VStack(spacing: 14) {
                ZStack {
                    Circle().fill(Color.rrAccent.opacity(0.14)).frame(width: 110, height: 110)
                    Image(systemName: "bubble.left.and.bubble.right.fill").font(.system(size: 44)).foregroundStyle(Color.rrAccent)
                }
                Text("Choisis une conversation").font(.title2.weight(.heavy))
                Text("L'IA lit le dernier message et te propose des réponses.\nRien ne part sans ton clic.").multilineTextAlignment(.center).foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            VStack(spacing: 0) {
                entete
                ScrollViewReader { p in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 6) {
                            if m.filCharge { ProgressView().frame(maxWidth: .infinity).padding() }
                            ForEach(Array(m.fil.messages.enumerated()), id: \.element.id) { i, msg in
                                element(msg, precedent: i > 0 ? m.fil.messages[i - 1] : nil).id(msg.id)
                                    .transition(sansMouvement ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                            }
                        }
                        .padding(.horizontal, 22).padding(.vertical, 18)
                        .animation(sansMouvement ? nil : .spring(response: 0.35, dampingFraction: 0.85), value: m.fil.messages.count)
                    }
                    .onChange(of: m.fil.messages.count) { _ in if let d = m.fil.messages.last { withAnimation { p.scrollTo(d.id, anchor: .bottom) } } }
                    .onAppear { if let d = m.fil.messages.last { p.scrollTo(d.id, anchor: .bottom) } }
                }
                .background(
                    LinearGradient(colors: [Color.rrAccent.opacity(0.04), .clear], startPoint: .top, endPoint: .bottom)
                )
                if m.ouverteBloquee {
                    HStack(spacing: 10) {
                        Image(systemName: "nosign").font(.title3).foregroundStyle(.red)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Utilisateur bloqué").font(.headline)
                            Text("Le Bon Coin ne vous laisse plus vous écrire. Si tu changes d'avis, tu peux débloquer ce compte sur le site.").font(.callout).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .padding(16).background(Color.red.opacity(0.07))
                    .overlay(alignment: .top) { Rectangle().fill(Color.primary.opacity(0.06)).frame(height: 1) }
                } else {
                    redaction
                }
            }
        }
    }

    private var entete: some View {
        let c = conversationOuverte
        let nom = m.fil.acheteur.isEmpty ? (c?.acheteur.isEmpty == false ? c!.acheteur : "Conversation") : m.fil.acheteur
        let prix = m.fil.annonce.first { $0.range(of: #"\d\s?€"#, options: .regularExpression) != nil }
        return HStack(spacing: 14) {
            vignette(c?.image ?? "", taille: 48, rayon: 12).shadow(color: .black.opacity(0.2), radius: 5, y: 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(nom).font(.system(size: 18, weight: .heavy, design: .rounded)).lineLimit(1)
                Text(c?.nom ?? m.fil.annonce.first ?? "").font(.callout).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            if let p = prix {
                Text(p).font(.callout.weight(.heavy).monospacedDigit()).foregroundStyle(.white)
                    .padding(.horizontal, 12).padding(.vertical, 6).background(Color.rrAccent, in: Capsule())
            }
            if let c = c {
                Menu {
                    Button("Masquer cette conversation") { m.masquer(c) }
                    Button("Bloquer cet utilisateur…", role: .destructive) { aBloquer = c }
                    Button("Supprimer…", role: .destructive) { aSupprimer = c }
                } label: { Image(systemName: "ellipsis.circle").font(.title3) }
                .menuStyle(.borderlessButton).fixedSize()
            }
        }
        .padding(.horizontal, 22).padding(.vertical, 14)
        .background(Color.rrFond)
        .overlay(alignment: .bottom) { Rectangle().fill(Color.primary.opacity(0.06)).frame(height: 1) }
    }

    @ViewBuilder private func element(_ msg: MessageLbc, precedent: MessageLbc?) -> some View {
        switch msg.genre {
        case .heure:
            Text(msg.texte).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                .padding(.horizontal, 10).padding(.vertical, 3).background(Color.primary.opacity(0.06), in: Capsule())
                .frame(maxWidth: .infinity).padding(.vertical, 6)
        case .auto:
            carteLbc(msg).frame(maxWidth: .infinity).padding(.vertical, 6)
        case .message:
            if msg.cote == "centre" {
                Text(msg.texte).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.vertical, 4)
            } else {
                bulle(msg, suite: precedent?.genre == .message && precedent?.cote == msg.cote)
            }
        }
    }

    private func bulle(_ msg: MessageLbc, suite: Bool) -> some View {
        let moi = msg.cote == "moi"
        let initiale = String((m.fil.acheteur.isEmpty ? (conversationOuverte?.acheteur ?? "?") : m.fil.acheteur).prefix(1)).uppercased()
        return HStack(alignment: .bottom, spacing: 8) {
            if moi { Spacer(minLength: 90) }
            else {
                Circle().fill(Color.secondary.opacity(suite ? 0 : 0.22)).frame(width: 28, height: 28)
                    .overlay(Text(suite ? "" : initiale).font(.caption.weight(.heavy)).foregroundStyle(.primary))
            }
            VStack(alignment: moi ? .trailing : .leading, spacing: 3) {
                Text(msg.texte).textSelection(.enabled).font(.system(size: 13.5))
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .foregroundStyle(moi ? Color.white : Color.primary)
                    .background {
                        if moi {
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(LinearGradient(colors: [Color.rrAccent.opacity(0.85), Color.rrAccent], startPoint: .topLeading, endPoint: .bottomTrailing))
                                .shadow(color: Color.rrAccent.opacity(0.25), radius: 6, y: 2)
                        } else {
                            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.rrCarte)
                                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Color.primary.opacity(0.07)))
                                .shadow(color: .black.opacity(0.08), radius: 4, y: 1)
                        }
                    }
                if !msg.meta.isEmpty { Text(msg.meta).font(.caption2).foregroundStyle(.secondary).padding(.horizontal, 6) }
            }
            if !moi { Spacer(minLength: 90) }
        }
        .padding(.top, suite ? 0 : 6)
    }

    /// Message automatique Le Bon Coin (offre, vente, envoi…) : une carte à part, avec son icône et sa couleur.
    private func carteLbc(_ msg: MessageLbc) -> some View {
        let t = msg.titreAuto.lowercased()
        let (icone, teinte): (String, Color) =
            t.contains("refus") || t.contains("expir") ? ("xmark.circle.fill", .red)
            : t.contains("offre") && t.contains("accept") ? ("checkmark.seal.fill", .green)
            : t.contains("offre") ? ("tag.fill", .blue)
            : t.contains("vendu") || t.contains("paiement") ? ("eurosign.circle.fill", .green)
            : t.contains("colis") || t.contains("commande") || t.contains("envoi") ? ("shippingbox.fill", .orange)
            : ("info.circle.fill", Color.rrAccent)
        return HStack(alignment: .top, spacing: 12) {
            Image(systemName: icone).font(.system(size: 22)).foregroundStyle(teinte)
                .frame(width: 40, height: 40).background(teinte.opacity(0.15), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(msg.titreAuto).font(.callout.weight(.heavy))
                    Spacer(minLength: 8)
                    Text("Le Bon Coin").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                }
                if !msg.corpsAuto.isEmpty { Text(msg.corpsAuto).font(.callout).foregroundStyle(.secondary).textSelection(.enabled) }
                if !msg.meta.isEmpty { Text(msg.meta).font(.caption2).foregroundStyle(.tertiary) }
            }
        }
        .padding(14).frame(maxWidth: 520, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.rrCarte))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(teinte.opacity(0.35), lineWidth: 1))
        .overlay(alignment: .leading) { RoundedRectangle(cornerRadius: 2).fill(teinte).frame(width: 4).padding(.vertical, 12) }
    }

    // MARK: Réponse

    private var peutEnvoyer: Bool { !m.envoi && !m.brouillon.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private var redaction: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles").foregroundStyle(Color.rrAccent)
                Text("L'IA te propose").font(.callout.weight(.heavy))
                if m.iaCharge { ProgressView().controlSize(.small) }
                Spacer()
                Button { Task { await m.proposer() } } label: { Label("Autres idées", systemImage: "arrow.triangle.2.circlepath") }
                    .buttonStyle(.borderless).foregroundStyle(Color.rrAccent).disabled(m.iaCharge)
            }
            if !m.iaErreur.isEmpty { Text(m.iaErreur).font(.callout).foregroundStyle(.orange) }
            else if m.fil.dernierMoi && m.reponses.isEmpty && !m.iaCharge { Text("Tu as répondu en dernier : je te proposerai une réponse dès que l'acheteur écrit.").font(.callout).foregroundStyle(.secondary) }
            else if !m.resume.isEmpty { Text(Messagerie.enGras(m.resume, nom: acheteurOuvert)).font(.callout).foregroundStyle(.secondary).lineLimit(2) }
            if !m.reponses.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 10) {
                        ForEach(m.reponses) { r in
                            let choisie = m.brouillon == r.texte
                            Button { withAnimation(.easeOut(duration: 0.15)) { m.brouillon = r.texte } } label: {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(r.titre.isEmpty ? "Réponse" : r.titre).font(.caption.weight(.heavy)).foregroundStyle(choisie ? Color.white : Color.rrAccent)
                                    Text(Messagerie.enGras(r.texte, nom: acheteurOuvert)).font(.caption).foregroundStyle(choisie ? Color.white.opacity(0.9) : .secondary).lineLimit(4).multilineTextAlignment(.leading)
                                }
                                .frame(width: 240, alignment: .leading).padding(12)
                                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(choisie ? AnyShapeStyle(Color.rrAccent) : AnyShapeStyle(Color.rrCarte)))
                                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color.primary.opacity(choisie ? 0 : 0.08)))
                            }.buttonStyle(.plain).help("Placer cette réponse dans le message (tu peux la modifier)")
                        }
                    }.padding(.vertical, 2)
                }
            }
            HStack(spacing: 8) {
                Image(systemName: "wand.and.stars").foregroundStyle(.secondary)
                TextField("Dis à l'IA quoi répondre (ex. « propose 40 € »)", text: $consigne).textFieldStyle(.plain)
                    .onSubmit { let c = consigne; consigne = ""; Task { await m.proposer(c) } }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Color.primary.opacity(0.05), in: Capsule())
            HStack(alignment: .bottom, spacing: 10) {
                TextEditor(text: $m.brouillon).font(.system(size: 13.5)).frame(minHeight: 44, maxHeight: 130).scrollContentBackground(.hidden)
                    .padding(.horizontal, 10).padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.primary.opacity(0.05)))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(peutEnvoyer ? Color.rrAccent.opacity(0.6) : Color.primary.opacity(0.08)))
                Button { Task { await m.envoyer() } } label: {
                    ZStack {
                        Circle().fill(peutEnvoyer ? Color.rrAccent : Color.primary.opacity(0.1)).frame(width: 42, height: 42)
                            .shadow(color: Color.rrAccent.opacity(peutEnvoyer ? 0.4 : 0), radius: 8, y: 2)
                        if m.envoi { ProgressView().controlSize(.small) }
                        else { Image(systemName: "paperplane.fill").font(.system(size: 16, weight: .bold)).foregroundStyle(peutEnvoyer ? Color.white : .secondary) }
                    }
                }
                .buttonStyle(.plain).keyboardShortcut(.return, modifiers: .command)
                .disabled(!peutEnvoyer)
                .help("Envoie ce message à l'acheteur sur Le Bon Coin (⌘↩)")
                .scaleEffect(peutEnvoyer ? 1 : 0.92).animation(.spring(response: 0.3, dampingFraction: 0.6), value: peutEnvoyer)
            }
            if !m.avis.isEmpty { Text(m.avis).font(.callout).foregroundStyle(.orange) }
        }
        .padding(18)
        .background(Color.rrFond)
        .overlay(alignment: .top) { Rectangle().fill(Color.primary.opacity(0.06)).frame(height: 1) }
    }
}
