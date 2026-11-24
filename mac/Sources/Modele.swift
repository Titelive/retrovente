// RetroRevente en natif : le compte et les articles, lus et modifiés par l'API de retrorevente.fr (/api/…),
// avec la même session (cookie) que l'appli web. Aucune page web pour cette partie de l'app.
import AppKit
import SwiftUI

// MARK: Données

struct Photo: Identifiable, Hashable { let id: String; var legende: String }

struct Article: Identifiable, Hashable {
    var id: String = ""
    var titre = "", categorie = "jeux", plateforme = "", region = "", etat = "", contenu = ""
    var prixAchat: Double? = nil, prixDemande: Double? = nil, prixVente: Double? = nil, frais: Double? = nil
    var statut = "en_vente", titreAnnonce = "", texteAnnonce = "", annonce = "", notes = ""
    var dateMiseEnVente = "", dateVente = "", modifie = "", cree = "", remise = ""
    var photos: [Photo] = []
    var ia = false
    var cote: Cote? = nil

    init() {}
    init(_ d: [String: Any]) {
        func t(_ k: String) -> String { d[k] as? String ?? "" }
        func n(_ k: String) -> Double? { (d[k] as? NSNumber)?.doubleValue }
        id = t("id"); titre = t("titre"); categorie = t("categorie").isEmpty ? "jeux" : t("categorie")
        plateforme = t("plateforme"); region = t("region"); etat = t("etat"); contenu = t("contenu")
        prixAchat = n("prixAchat"); prixDemande = n("prixDemande"); prixVente = n("prixVente"); frais = n("frais")
        statut = t("statut").isEmpty ? "en_vente" : t("statut")
        titreAnnonce = t("titreAnnonce"); texteAnnonce = t("texteAnnonce"); annonce = t("annonce"); notes = t("notes")
        dateMiseEnVente = t("dateMiseEnVente"); dateVente = t("dateVente"); modifie = t("modifie")
        ia = d["ia"] as? Bool ?? false
        cree = t("cree"); remise = t("remise")
        cote = (d["cote"] as? [String: Any]).flatMap(Cote.init)
        if let l = d["photos"] as? [[String: Any]] {
            photos = l.compactMap { p in (p["id"] as? String).map { Photo(id: $0, legende: p["legende"] as? String ?? "") } }
        } else if d["photo"] as? Bool == true { photos = [Photo(id: "p0", legende: "")] }
    }
    /// Champs envoyés au serveur (il fusionne avec la fiche existante).
    var envoi: [String: Any] {
        func p(_ x: Double?) -> Any { x.map { $0 as Any } ?? NSNull() }
        return ["titre": titre, "categorie": categorie, "plateforme": plateforme, "region": region, "etat": etat, "contenu": contenu,
                "prixAchat": p(prixAchat), "prixDemande": p(prixDemande), "prixVente": p(prixVente), "frais": p(frais),
                "statut": statut, "titreAnnonce": titreAnnonce, "texteAnnonce": texteAnnonce, "annonce": annonce, "notes": notes, "ia": ia,
                "remise": remise, "cote": cote?.brut ?? NSNull()]
    }
    var publiee: Bool { !annonce.isEmpty }
    var sousTitre: String { [plateforme, region].filter { !$0.isEmpty }.joined(separator: " · ") }
}

/// Cote estimée par l'IA (ventes conclues, annonces) : fourchette, prix conseillé, prix pour vendre vite, relevés.
struct Cote: Hashable {
    struct Releve: Hashable { let site: String, titre: String, prix: Double?, date: String, url: String }
    let bas: Double?, haut: Double?, conseille: Double?, rapide: Double?
    let resume: String, methode: String, date: String
    let releves: [Releve]
    let brut: NSDictionary
    init?(_ d: [String: Any]) {
        func n(_ k: String) -> Double? { (d[k] as? NSNumber)?.doubleValue }
        bas = n("bas"); haut = n("haut"); conseille = n("conseille"); rapide = n("rapide")
        guard bas != nil || conseille != nil else { return nil }
        resume = d["resume"] as? String ?? ""; methode = d["methode"] as? String ?? ""; date = d["date"] as? String ?? ""
        releves = (d["releves"] as? [[String: Any]] ?? []).map {
            Releve(site: $0["site"] as? String ?? "", titre: $0["titre"] as? String ?? "", prix: ($0["prix"] as? NSNumber)?.doubleValue,
                   date: $0["date"] as? String ?? "", url: $0["url"] as? String ?? "")
        }
        brut = d as NSDictionary
    }
}

enum Libelles {
    static let statuts: [(String, String, String)] = [   // id, nom, symbole
        ("en_vente", "En vente", "tag"), ("reserve", "Réservés", "hand.raised"), ("vendu", "Vendus", "checkmark.seal"),
        ("envoye", "Envoyés", "shippingbox"), ("retire", "Retirés", "archivebox"),
    ]
    static func statut(_ s: String) -> String {
        ["en_vente": "En vente", "reserve": "Réservé", "vendu": "Vendu", "envoye": "Envoyé", "retire": "Retiré"][s] ?? s
    }
    static func couleurStatut(_ s: String) -> Color {
        switch s {
        case "en_vente": return Color(red: 0.83, green: 0.96, blue: 0.48)
        case "reserve": return Color(red: 1.0, green: 0.82, blue: 0.25)
        case "vendu": return Color(red: 0.37, green: 0.94, blue: 0.78)
        case "envoye": return Color(red: 0.77, green: 0.66, blue: 1.0)
        default: return Color.gray.opacity(0.5)
        }
    }
    static let categories: [(String, String)] = [("jeux", "Jeu vidéo"), ("consoles", "Console"), ("accessoires", "Accessoire"),
                                                 ("cartes", "Carte Pokémon"), ("films", "Film"), ("autres", "Autre")]
    static func symboleCategorie(_ c: String) -> String {
        ["jeux": "gamecontroller", "consoles": "tv", "accessoires": "cable.connector", "cartes": "rectangle.portrait.on.rectangle.portrait",
         "films": "film", "autres": "shippingbox"][c] ?? "gamecontroller"
    }
    static let etats: [(String, String)] = [("", "Non précisé"), ("neuf", "Neuf"), ("tres_bon", "Très bon état"), ("bon", "Bon état"),
                                            ("correct", "État correct"), ("pieces", "Pour pièces")]
    static let contenus: [(String, String)] = [("", "Non précisé"), ("seul", "Jeu seul"), ("boite", "En boîte, sans notice"),
                                               ("complet", "Complet (boîte et notice)"), ("boite_vide", "Boîte seule")]
    static func prix(_ x: Double?) -> String {
        guard let x = x else { return "—" }
        let f = NumberFormatter(); f.numberStyle = .currency; f.currencyCode = "EUR"; f.locale = Locale(identifier: "fr_FR")
        f.maximumFractionDigits = x.rounded() == x ? 0 : 2
        return f.string(from: NSNumber(value: x)) ?? "\(x) €"
    }
}

struct Profil {
    var email = "", nom = "", pseudo = "", avatar = "", lbc = "", cree = "", formule = "Découverte", formuleId = "gratuit"
    var quotaMax: Int? = nil, quotaUtilise = 0, emailOk = true, emailEnAttente = ""
    var fiscal = false, abonnement = "", statutAbonnement = "", finAbonnement = "", resiliation = false, paiement = false, client = false
    var usageLbc = 0
    init() {}
    init(_ d: [String: Any]) {
        email = d["email"] as? String ?? ""; nom = d["nom"] as? String ?? email; avatar = d["avatar"] as? String ?? ""
        pseudo = d["pseudo"] as? String ?? ""; lbc = d["lbc"] as? String ?? ""; cree = d["cree"] as? String ?? ""
        emailOk = d["emailOk"] as? Bool ?? true; emailEnAttente = d["emailEnAttente"] as? String ?? ""
        paiement = d["paiement"] as? Bool ?? false; client = d["client"] as? Bool ?? false
        usageLbc = ((d["usage"] as? [String: Any])?["lbc"] as? NSNumber)?.intValue ?? 0
        if let f = d["formule"] as? [String: Any] {
            formule = f["nom"] as? String ?? formule; formuleId = f["id"] as? String ?? formuleId
            fiscal = f["fiscal"] as? Bool ?? false; abonnement = f["abonnement"] as? String ?? ""
            statutAbonnement = f["statut"] as? String ?? ""; finAbonnement = f["fin"] as? String ?? ""
            resiliation = (f["resiliation"] as? Bool) ?? ((f["resiliation"] as? String).map { !$0.isEmpty } ?? false)
        }
        if let q = d["quota"] as? [String: Any] { quotaMax = (q["max"] as? NSNumber)?.intValue; quotaUtilise = (q["utilise"] as? NSNumber)?.intValue ?? 0 }
    }
}

// MARK: API

enum API {
    static var serveur: String { Actions.serveurDefaut }
    /// Identifiant de cet appareil (même rôle que « rr-app » de l'appli web).
    static let appareil: String = {
        if let a = UserDefaults.standard.string(forKey: "rr-app"), a.count >= 16 { return a }
        let a = (UUID().uuidString + UUID().uuidString).lowercased().filter { $0.isLetter || $0.isNumber }.prefix(32)
        UserDefaults.standard.set(String(a), forKey: "rr-app"); return String(a)
    }()

    static func json(_ methode: String, _ chemin: String, _ corps: [String: Any]? = nil) async throws -> [String: Any] {
        let d = try await brut(methode, chemin, corps)
        return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] ?? [:]
    }
    static func brut(_ methode: String, _ chemin: String, _ corps: [String: Any]? = nil) async throws -> Data {
        var r = URLRequest(url: URL(string: serveur + chemin)!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 120)
        r.httpMethod = methode
        r.setValue(serveur, forHTTPHeaderField: "Origin")
        r.setValue(appareil, forHTTPHeaderField: "x-rr-app")
        if let c = corps { r.setValue("application/json", forHTTPHeaderField: "Content-Type"); r.httpBody = try JSONSerialization.data(withJSONObject: c) }
        let (d, rep) = try await URLSession.shared.data(for: r)
        let code = (rep as? HTTPURLResponse)?.statusCode ?? 0
        if !(200..<300).contains(code) {
            let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
            throw ErreurRR(message: j?["error"] as? String ?? "RetroRevente ne répond pas (erreur \(code)).", status: code)
        }
        return d
    }
    static func urlPhoto(_ article: String, _ photo: String) -> URL { URL(string: "\(serveur)/api/photo/\(article)/\(photo)")! }
}

/// Une image choisie par la personne, en JPEG « data: » (format attendu par l'API), au plus `max` pixels de côté.
func jpegData(_ image: NSImage, max: CGFloat = 2000, poids: Int = 2_000_000) -> String? {
    guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
    var cote = max
    for _ in 0..<6 {
        let e = min(1, cote / CGFloat(Swift.max(cg.width, cg.height)))
        let w = Int(CGFloat(cg.width) * e), h = Int(CGFloat(cg.height) * e)
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        ctx.interpolationQuality = .high
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        guard let r = ctx.makeImage() else { return nil }
        let rep = NSBitmapImageRep(cgImage: r)
        if let d = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.85]) {
            let s = "data:image/jpeg;base64," + d.base64EncodedString()
            if s.count <= poids { return s }
        }
        cote *= 0.8
    }
    return nil
}

/// Images de l'API (avec la session), gardées en mémoire.
@MainActor
final class Images {
    static let cache = NSCache<NSURL, NSImage>()
    static func charger(_ url: URL) async -> NSImage? {
        if let i = cache.object(forKey: url as NSURL) { return i }
        var r = URLRequest(url: url); r.setValue(API.appareil, forHTTPHeaderField: "x-rr-app")
        guard let (d, rep) = try? await URLSession.shared.data(for: r), (rep as? HTTPURLResponse)?.statusCode == 200, let i = NSImage(data: d) else { return nil }
        cache.setObject(i, forKey: url as NSURL)
        return i
    }
    static func oublier(_ url: URL) { cache.removeObject(forKey: url as NSURL) }
}

// MARK: État de l'appli

@MainActor
final class Appli: ObservableObject {
    enum Etat { case chargement, deconnecte, connecte }
    @Published var etat: Etat = .chargement
    @Published var profil = Profil()
    @Published var articles: [Article] = []
    @Published var erreur: String? = nil
    @Published var fete: String? = nil        // titre de l'annonce publiée (confettis)
    @Published var compteOuvert = false
    @Published var page: String? = nil       // trophees, bilan, compte (sinon : mes articles)
    @Published var nouveauOuvert = false
    @Published var selection: String? = nil   // article ouvert
    weak var fenetre: Fenetre?

    func demarrer() async {
        // Captures automatiques (GitHub) : données d'exemple, sans réseau.
        if let d = ProcessInfo.processInfo.environment["RR_DEMO"], ["articles", "fiche", "nouveau", "compte"].contains(d) {
            profil = Profil(["email": "demo@retrorevente.fr", "nom": "Titelive", "pseudo": "Titelive", "cree": "2025-06-01T10:00:00Z",
                             "formule": ["nom": "Collectionneur", "id": "collectionneur", "fiscal": true, "abonnement": "collectionneur", "statut": "active"], "quota": ["max": NSNull(), "utilise": 37]])
            let ex: [[String: Any]] = [
                ["id": "a1", "titre": "Super Mario 64", "plateforme": "Nintendo 64", "region": "PAL EUR", "etat": "bon", "contenu": "complet", "prixDemande": 45, "statut": "en_vente", "modifie": "6",
                 "cote": ["bas": 38, "haut": 52, "conseille": 49, "rapide": 42, "date": "2026-11-20", "resume": "Ventes eBay conclues entre 38 et 52 € en complet ; annonces Le Bon Coin entre 40 et 60 €.",
                          "releves": [["site": "eBay", "titre": "Super Mario 64 complet PAL", "prix": 45, "date": "2026-11-02", "url": "https://www.ebay.fr/"], ["site": "PriceCharting", "titre": "Cote moyenne CIB", "prix": 48, "date": "2026-11-10", "url": "https://www.pricecharting.com/"]]]],
                ["id": "a2", "titre": "The Legend of Zelda: Ocarina of Time", "plateforme": "Nintendo 64", "region": "PAL EUR", "prixDemande": 39, "statut": "en_vente", "modifie": "5"],
                ["id": "a3", "titre": "Game Boy Color Violette", "categorie": "consoles", "plateforme": "Game Boy Color", "prixDemande": 70, "statut": "reserve", "modifie": "4"],
                ["id": "a4", "titre": "Dracaufeu holo 4/102", "categorie": "cartes", "plateforme": "Set de base", "prixDemande": 180, "statut": "en_vente", "modifie": "3"],
                ["id": "a5", "titre": "Kirby 64: The Crystal Shards", "plateforme": "Nintendo 64", "prixDemande": 55, "prixVente": 55, "frais": 3, "statut": "vendu", "dateMiseEnVente": "2026-11-01", "dateVente": "2026-11-05", "modifie": "2"],
                ["id": "a7", "titre": "Pokémon Stadium", "plateforme": "Nintendo 64", "prixDemande": 30, "prixVente": 28, "statut": "envoye", "remise": "envoi", "dateVente": "2026-10-12", "modifie": "0"],
                ["id": "a6", "titre": "Manette DualShock 2", "categorie": "accessoires", "plateforme": "PlayStation 2", "prixDemande": 15, "statut": "en_vente", "modifie": "1"],
            ]
            articles = ex.map(Article.init); etat = .connecte
            if d == "fiche" { selection = "a1" }
            if d == "nouveau" { nouveauOuvert = true }
            if ["trophees", "bilan", "compte"].contains(ProcessInfo.processInfo.environment["RR_DEMO_PAGE"] ?? "") { page = ProcessInfo.processInfo.environment["RR_DEMO_PAGE"] }
            return
        }
        do { try await chargerProfil(); etat = .connecte; await brancherLeBonCoin(); await recharger() }
        catch let e as ErreurRR where e.status == 401 { etat = .deconnecte }
        catch { etat = .deconnecte; erreur = (error as? ErreurRR)?.message ?? "Pas de connexion à RetroRevente." }
    }
    func chargerProfil() async throws { profil = Profil(try await API.json("GET", "/api/moi")) }
    func recharger() async {
        do {
            let j = try await API.json("GET", "/api/objets")
            articles = (j["objets"] as? [[String: Any]] ?? []).map(Article.init)
                .sorted { $0.modifie > $1.modifie }
        } catch { signaler(error) }
    }
    func connecter(email: String, motdepasse: String) async throws {
        _ = try await API.json("POST", "/api/connexion", ["email": email, "motdepasse": motdepasse])
        try await chargerProfil(); etat = .connecte
        await brancherLeBonCoin(force: true); await recharger()
    }
    func oubli(email: String) async throws { _ = try await API.json("POST", "/api/oubli", ["email": email]) }
    func deconnecter() async {
        _ = try? await API.json("DELETE", "/api/extension/cle")
        _ = try? await API.json("POST", "/api/deconnexion")
        Stockage.partage.effacer(["cle", "email"])
        HTTPCookieStorage.shared.cookies(for: URL(string: API.serveur)!)?.forEach(HTTPCookieStorage.shared.deleteCookie)
        articles = []; profil = Profil(); selection = nil; compteOuvert = false; etat = .deconnecte
    }
    /// Le panneau Le Bon Coin (remplissage, réponses IA) utilise une clé rre_ : l'app la crée toute seule.
    func brancherLeBonCoin(force: Bool = false) async {
        if !force, !(Stockage.partage.texte("cle") ?? "").isEmpty { return }
        guard let j = try? await API.json("POST", "/api/extension/cle"), let cle = j["cle"] as? String else { return }
        Stockage.partage.ecrire(["cle": cle, "serveur": API.serveur, "email": profil.email])
    }

    func enregistrer(_ a: Article) async -> Article? {
        do {
            let j = try await API.json("PUT", "/api/objets/\(a.id)", ["objet": a.envoi])
            let n = Article(j["objet"] as? [String: Any] ?? [:]); remplacer(n); return n
        } catch { signaler(error); return nil }
    }
    func creer(_ a: Article, photo: String?) async -> Article? {
        var corps: [String: Any] = ["objet": a.envoi]
        if let p = photo { corps["photo"] = p }
        do {
            let j = try await API.json("POST", "/api/objets", corps)
            let n = Article(j["objet"] as? [String: Any] ?? [:]); articles.insert(n, at: 0)
            try? await chargerProfil(); return n
        } catch { signaler(error); return nil }
    }
    func supprimer(_ a: Article) async {
        do { _ = try await API.json("DELETE", "/api/objets/\(a.id)"); articles.removeAll { $0.id == a.id }; if selection == a.id { selection = nil } }
        catch { signaler(error) }
    }
    func ajouterPhoto(_ a: Article, _ data: String) async {
        do { let j = try await API.json("POST", "/api/objets/\(a.id)/photos", ["photo": data]); remplacer(Article(j["objet"] as? [String: Any] ?? [:])) }
        catch { signaler(error) }
    }
    func retirerPhoto(_ a: Article, _ p: Photo) async {
        do {
            let j = try await API.json("DELETE", "/api/objets/\(a.id)/photos/\(p.id)")
            Images.oublier(API.urlPhoto(a.id, p.id)); remplacer(Article(j["objet"] as? [String: Any] ?? [:]))
        } catch { signaler(error) }
    }
    func identifier(_ photo: String) async throws -> Article {
        let j = try await API.json("POST", "/api/ia/identifier", ["photo": photo])
        var a = Article(j["objet"] as? [String: Any] ?? [:]); a.ia = true
        if let r = (j["objet"] as? [String: Any])?["remarques"] as? String, !r.isEmpty { a.notes = r }
        return a
    }
    /// Cote IA de l'article, gardée dans sa fiche.
    func estimerCote(_ a: Article) async -> Article? {
        do {
            let j = try await API.json("POST", "/api/ia/cote", ["objet": ["titre": a.titre, "categorie": a.categorie, "plateforme": a.plateforme, "region": a.region, "etat": a.etat, "contenu": a.contenu]])
            guard let c = j["cote"] as? [String: Any] else { return nil }
            var b = a; b.cote = Cote(c)
            return await enregistrer(b)
        } catch { signaler(error); return nil }
    }

    // Compte
    func modifierProfil(_ champs: [String: Any]) async -> Bool {
        do { profil = Profil(try await API.json("POST", "/api/compte/profil", champs)); return true } catch { signaler(error); return false }
    }
    func changerMotDePasse(ancien: String, nouveau: String) async -> Bool {
        do { _ = try await API.json("POST", "/api/compte/motdepasse", ["ancien": ancien, "nouveau": nouveau]); return true } catch { signaler(error); return false }
    }
    func changerEmail(_ email: String, motdepasse: String) async -> String? {
        do {
            let j = try await API.json("POST", "/api/compte/email", ["email": email, "motdepasse": motdepasse])
            try? await chargerProfil()
            return (j["applique"] as? Bool) == true ? "Adresse changée." : "Ouvre le lien envoyé à \(email) pour confirmer."
        } catch { signaler(error); return nil }
    }
    func renvoyerVerification() async { do { _ = try await API.json("POST", "/api/verifier/renvoyer") } catch { signaler(error) } }
    /// Paiement et abonnement : pages sécurisées de Stripe, ouvertes dans le navigateur.
    func payer(offre: String, periode: String) async {
        do { if let u = (try await API.json("POST", "/api/paiement", ["offre": offre, "periode": periode]))["url"] as? String, let url = URL(string: u) { NSWorkspace.shared.open(url) } }
        catch { signaler(error) }
    }
    func portail() async {
        do { if let u = (try await API.json("POST", "/api/portail"))["url"] as? String, let url = URL(string: u) { NSWorkspace.shared.open(url) } }
        catch { signaler(error) }
    }
    func supprimerCompte(motdepasse: String) async -> Bool {
        do {
            _ = try await API.json("POST", "/api/compte/supprimer", ["motdepasse": motdepasse])
            Stockage.partage.effacer(["cle", "email"])
            HTTPCookieStorage.shared.cookies(for: URL(string: API.serveur)!)?.forEach(HTTPCookieStorage.shared.deleteCookie)
            articles = []; profil = Profil(); etat = .deconnecte; return true
        } catch { signaler(error); return false }
    }

    private func remplacer(_ n: Article) {
        guard !n.id.isEmpty else { return }
        if let i = articles.firstIndex(where: { $0.id == n.id }) { articles[i] = n } else { articles.insert(n, at: 0) }
    }
    func signaler(_ e: Error) {
        if let r = e as? ErreurRR, r.status == 401 { etat = .deconnecte; return }
        erreur = (e as? ErreurRR)?.message ?? e.localizedDescription
    }

    /// « Déposer sur Le Bon Coin » : le panneau de l'extension reprend cet article sur la page de dépôt.
    func deposer(_ a: Article) {
        Stockage.partage.ecrire(["aDeposer": ["id": a.id, "at": Date().timeIntervalSince1970 * 1000]])
        fenetre?.ouvrir(URL(string: "https://www.leboncoin.fr/deposer-une-annonce#rr=\(a.id)")!)
    }
    /// Annonce publiée sur Le Bon Coin (signalée par le panneau) : confettis et liste à jour.
    func publiee(titre: String) {
        fete = titre.isEmpty ? "Ton annonce" : titre
        Task { await recharger() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 4.5) { [weak self] in self?.fete = nil }
    }
    func ouvrirSurLeWeb(_ chemin: String = "/app/") { NSWorkspace.shared.open(URL(string: API.serveur + chemin)!) }
}
