// RetroRevente en natif : le compte et les articles, lus et modifiés par l'API de retrorevente.fr (/api/…),
// avec la même session (cookie) que l'appli web. Aucune page web pour cette partie de l'app.
import AppKit
import ImageIO
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
    // Comme sur le site : rareté, sites, lots, colis, champs des cartes et des films
    var rareteJeu = "", annonceEbay = "", numero = "", gradation = "", edition = "", annee = ""
    var membres: [String]? = nil          // lot : ses articles (nil pour un article)
    var lots: [String] = []                // article : les lots qui le contiennent
    var themeNom = "", themeType = ""
    var alerteVendus = 0                   // lot : articles vendus à part
    var suivi = "", transporteur = "", livreLe = "", suiviLibelle = ""
    var coteLot = false                    // la cote conseille de vendre en lot
    var stats: [String: StatsSite] = [:]   // vues et favoris relevés sur les sites (« lbc », « ebay »), voir Stats.swift

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
        if d["photo"] as? Bool == false { photos = [] }
        rareteJeu = t("rareteJeu"); annonceEbay = t("annonceEbay"); numero = t("numero"); gradation = t("gradation")
        edition = t("edition"); annee = t("annee")
        membres = d["articles"] as? [String]
        var l = d["lots"] as? [String] ?? []
        if let x = d["lot"] as? String, !x.isEmpty, !l.contains(x) { l.append(x) }
        lots = l
        if let th = d["theme"] as? [String: Any] { themeNom = th["nom"] as? String ?? ""; themeType = th["type"] as? String ?? "" }
        alerteVendus = ((d["alerte"] as? [String: Any])?["vendus"] as? [Any])?.count ?? 0
        suivi = t("suivi"); transporteur = t("transporteur"); livreLe = t("livreLe")
        suiviLibelle = (d["suiviEtat"] as? [String: Any])?["libelle"] as? String ?? ""
        coteLot = (d["cote"] as? [String: Any])?["lot"] as? Bool ?? false
        stats = Article.lireStats(d)
    }
    var estLot: Bool { membres != nil }
    var vendu: Bool { ["vendu", "envoye", "recu"].contains(statut) }
    /// Prix affiché : le prix de vente une fois vendu, sinon le prix demandé.
    var prixAffiche: Double? { vendu ? prixVente : prixDemande }
    /// Valeur à l'unité : le prix demandé, sinon le prix conseillé de la cote.
    var valeur: Double? { prixDemande ?? cote?.conseille }
    var rangRarete: Int { categorie == "cartes" || categorie == "films" || estLot ? 0 : (["commun": 1, "peu_commun": 2, "rare": 3, "tres_rare": 4][rareteJeu] ?? 0) }
    /// Ligne sous le titre, comme sur le site.
    var ligne: String {
        let l: [String]
        switch categorie {
        case "cartes": l = [numero, plateforme, gradation]
        case "films": l = [Libelles.formatCourt(plateforme), edition.components(separatedBy: ",").first?.trimmingCharacters(in: .whitespaces) ?? "", annee]
        default: l = [plateforme, Libelles.contenuCourt[contenu] ?? ""]
        }
        return l.filter { !$0.isEmpty }.joined(separator: " · ")
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

extension NSColor {
    convenience init(hex: UInt32) {
        self.init(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

enum Libelles {
    /// Filtres de la liste, comme sur le site (« Vendus » réunit vendus, envoyés et reçus).
    static let statuts: [(String, String, String)] = [   // id, nom, symbole
        ("en_vente", "En vente", "tag"), ("reserve", "Réservés", "clock"), ("vendu", "Vendus", "checkmark.seal"),
        ("retire", "Retirés", "archivebox"),
    ]
    /// Le parcours d'une vente (menu de statut des cartes et de la fiche).
    static let ordreStatuts = ["en_vente", "reserve", "vendu", "envoye", "recu", "retire"]
    static func statut(_ s: String) -> String {
        ["en_vente": "En vente", "reserve": "Réservé", "vendu": "Vendu", "envoye": "Envoyé", "recu": "Reçu", "retire": "Retiré"][s] ?? s
    }
    static func aideStatut(_ s: String) -> String {
        ["en_vente": "Annonce en ligne, en attente d'un acheteur", "reserve": "Un acheteur s'est engagé, pas encore payé",
         "vendu": "Payé, reste à le remettre ou l'envoyer", "envoye": "Colis parti ou remis en main propre",
         "recu": "L'acheteur l'a bien reçu, vente bouclée", "retire": "Plus en vente, gardé dans ta liste"][s] ?? ""
    }
    static func symboleStatut(_ s: String) -> String {
        ["en_vente": "tag", "reserve": "clock", "vendu": "checkmark", "envoye": "shippingbox", "recu": "house", "retire": "archivebox"][s] ?? "tag"
    }
    /// Couleurs des statuts du site (fond, texte), claires ou sombres selon l'apparence.
    static func couleursStatut(_ s: String) -> (fond: Color, texte: Color) {
        func c(_ clair: UInt32, _ sombre: UInt32) -> Color { Color(nsColor: NSColor(name: nil) { a in a.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(hex: sombre) : NSColor(hex: clair) }) }
        switch s {
        case "en_vente": return (c(0xDDF3CF, 0x1D3A14), c(0x1F5410, 0xB5F09A))
        case "reserve": return (c(0xFFEDBF, 0x3A2E0E), c(0x6A4B00, 0xFFD873))
        case "vendu": return (c(0x1A1A1A, 0xF4F4EE), c(0xE8F9B5, 0x1A1A1A))
        case "envoye": return (c(0xE3EBFF, 0x16223F), c(0x1F3F8F, 0xA9C1FF))
        case "recu": return (c(0xD2F1EA, 0x0F3531), c(0x0B5A4E, 0x8EE3CF))
        default: return (Color.primary.opacity(0.07), Color.primary.opacity(0.8))
        }
    }
    static func couleurStatut(_ s: String) -> Color { couleursStatut(s).fond }
    static let rarete = ["commun": "Commun", "peu_commun": "Peu commun", "rare": "Rare", "tres_rare": "Très rare"]
    static let rareteGroupe = ["commun": "Communs", "peu_commun": "Peu communs", "rare": "Rares", "tres_rare": "Très rares"]
    static let contenuCourt = ["seul": "Jeu en loose", "boite": "En boîte", "complet": "Complet (CIB)", "boite_vide": "Boîte seule"]
    static let nomsCategories = ["jeux": "Jeux vidéo", "consoles": "Consoles", "accessoires": "Accessoires", "cartes": "Cartes Pokémon", "films": "Films", "autres": "Autres"]
    static let typesTheme = ["licence": "Licence", "série": "Série", "studio": "Studio", "lignée": "Lignée", "univers": "Univers", "genre": "Genre", "petits prix": "Petits prix", "support": "Même console"]
    static func formatCourt(_ f: String) -> String { ["Blu-Ray 4K UHD": "4K UHD", "Blu-Ray 4K UHD + Blu-Ray": "4K UHD + Blu-Ray"][f] ?? f }
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

struct Profil: Equatable {
    var email = "", nom = "", pseudo = "", avatar = "", lbc = "", adresse = "", cree = "", formule = "Découverte", formuleId = "gratuit"
    var quotaMax: Int? = nil, quotaUtilise = 0, emailOk = true, emailEnAttente = ""
    var fiscal = false, abonnement = "", statutAbonnement = "", finAbonnement = "", resiliation = false, paiement = false, client = false
    var usageLbc = 0
    init() {}
    init(_ d: [String: Any]) {
        email = d["email"] as? String ?? ""; nom = d["nom"] as? String ?? email; avatar = d["avatar"] as? String ?? ""
        pseudo = d["pseudo"] as? String ?? ""; lbc = d["lbc"] as? String ?? ""; adresse = d["adresse"] as? String ?? ""; cree = d["cree"] as? String ?? ""
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
    static func urlPhoto(_ article: String, _ photo: String, v: String = "") -> URL {
        URL(string: "\(serveur)/api/photo/\(article)/\(photo)" + (v.isEmpty ? "" : "?v=" + (v.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")))!
    }
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
/// Fluidité : chaque photo est réduite à la taille où elle s'affiche (une vignette de carte n'a pas besoin des
/// 2000 px d'origine) et décodée hors du fil principal ; le défilement ne décode plus rien. Un même fichier n'est
/// téléchargé qu'une fois, même si plusieurs cartes le demandent en même temps.
@MainActor
final class Images {
    enum Taille: CGFloat { case mini = 200, carte = 720, grande = 1600, pleine = 0 }
    private static let images: NSCache<NSString, NSImage> = { let c = NSCache<NSString, NSImage>(); c.totalCostLimit = 300 << 20; return c }()
    private static let donnees: NSCache<NSURL, NSData> = { let c = NSCache<NSURL, NSData>(); c.totalCostLimit = 150 << 20; return c }()
    private static var enVol: [String: Task<NSImage?, Never>] = [:]
    private static var telechargements: [URL: Task<Data?, Never>] = [:]

    private static func cle(_ url: URL, _ t: Taille) -> NSString { "\(Int(t.rawValue))|\(url.absoluteString)" as NSString }
    /// Déjà prête : la vue l'affiche tout de suite, sans case vide le temps d'une image.
    static func enCache(_ url: URL, _ t: Taille = .carte) -> NSImage? { images.object(forKey: cle(url, t)) }

    static func charger(_ url: URL, _ t: Taille = .pleine) async -> NSImage? {
        let k = cle(url, t)
        if let i = images.object(forKey: k) { return i }
        if let e = enVol[k as String] { return await e.value }
        let tache = Task<NSImage?, Never> {
            guard let d = await telecharger(url) else { return nil }
            let i = await Task.detached(priority: .userInitiated) { Images.decoder(d, t.rawValue) }.value
            if let i = i { images.setObject(i, forKey: k, cost: Int(i.size.width * i.size.height * 4)) }
            return i
        }
        enVol[k as String] = tache
        let i = await tache.value
        enVol[k as String] = nil
        return i
    }
    private static func telecharger(_ url: URL) async -> Data? {
        if let d = donnees.object(forKey: url as NSURL) { return d as Data }
        if let e = telechargements[url] { return await e.value }
        let tache = Task<Data?, Never> {
            var r = URLRequest(url: url); r.setValue(API.appareil, forHTTPHeaderField: "x-rr-app")
            guard let (d, rep) = try? await URLSession.shared.data(for: r), (rep as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            donnees.setObject(d as NSData, forKey: url as NSURL, cost: d.count)
            return d
        }
        telechargements[url] = tache
        let d = await tache.value
        telechargements[url] = nil
        return d
    }
    /// Décodage réduit (ImageIO), orientation appliquée, pixels prêts : rien à décoder au moment de dessiner.
    nonisolated static func decoder(_ d: Data, _ max: CGFloat) -> NSImage? {
        guard let src = CGImageSourceCreateWithData(d as CFData, nil) else { return nil }
        var o: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true,
                                  kCGImageSourceShouldCacheImmediately: true]
        if max > 0 { o[kCGImageSourceThumbnailMaxPixelSize] = max }
        else if let p = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any] {
            o[kCGImageSourceThumbnailMaxPixelSize] = Swift.max((p[kCGImagePropertyPixelWidth] as? Int) ?? 4000, (p[kCGImagePropertyPixelHeight] as? Int) ?? 4000)
        }
        guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, o as CFDictionary) else { return NSImage(data: d) }
        return NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
    }
    static func oublier(_ url: URL) {
        donnees.removeObject(forKey: url as NSURL)
        for t in [Taille.mini, .carte, .grande, .pleine] { images.removeObject(forKey: cle(url, t)) }
    }
}

// MARK: État de l'appli

/// Dépôt « en coulisses » : Le Bon Coin est rempli sans être affiché, la personne valide dans l'app.
struct DepotEnCours: Identifiable, Equatable {
    enum Etape: Equatable {
        case remplissage(String)                 // message de progression
        case aide(String)                        // Le Bon Coin demande quelque chose : rien n'est montré sans l'accord
        case adresse(String)                     // Le Bon Coin demande où se trouve le bien : on la demande dans l'app
        case pret(bouton: String, payant: Bool)  // écran final atteint : on attend « Publier »
        case publication
    }
    let id: String; let titre: String
    var etape: Etape
}

/// Modifier ou supprimer une annonce Le Bon Coin en coulisses (voir Gestion.swift).
struct GestionAnnonce: Identifiable, Equatable {
    enum Action: Equatable { case modifier, supprimer }
    enum Etape: Equatable {
        case travail(String)       // message de progression
        case aide(String)          // Le Bon Coin demande quelque chose
        case pret(bouton: String)  // modification : écran final atteint, on attend « Enregistrer »
        case envoi
        case fait(String)
    }
    let id: String; let titre: String; let action: Action
    var etape: Etape
    var envoye = false   // le bouton final a été cliqué
}

@MainActor
final class Appli: ObservableObject {
    enum Etat { case chargement, deconnecte, connecte }
    @Published var etat: Etat = .chargement
    @Published var profil = Profil()
    @Published var articles: [Article] = [] { didSet { index = Dictionary(articles.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { a, _ in a }) } }
    private(set) var index: [String: Int] = [:]   // id → position : parId en temps constant (appelé des centaines de fois par rendu)
    @Published var erreur: String? = nil
    @Published var fete: String? = nil        // titre de l'annonce publiée (confettis)
    @Published var compteOuvert = false
    @Published var page: String? = nil       // trophees, bilan, compte (sinon : mes articles)
    @Published var nouveauOuvert = false
    @Published var messagesOuvert = false     // onglet Messages : la messagerie native (Messagerie.swift)
    let messagerie = Messagerie()
    @Published var choixDepot = false        // « Déposer » : choisir l'article, le dépôt se fait en coulisses
    @Published var selection: String? = nil   // article ouvert
    /// Barre latérale cachée (⌃⌘S ou bouton des en-têtes), retenue d'une ouverture à l'autre.
    @Published var barreCachee = UserDefaults.standard.bool(forKey: "barreCachee") {
        didSet { UserDefaults.standard.set(barreCachee, forKey: "barreCachee") }
    }
    /// Dépôt en coulisses en cours (feuille de suivi). Le remettre à nil arrête les coulisses.
    @Published var depot: DepotEnCours? = nil {
        didSet { if depot == nil, oldValue != nil { fenetre?.finCoulisses() } }
    }
    // Liste, comme sur le site : tri et regroupement (gardés), idées de lots, composition d'un lot, recherche (⌘K)
    @Published var tri = UserDefaults.standard.string(forKey: "tri") ?? "recent" { didSet { UserDefaults.standard.set(tri, forKey: "tri") } }
    @Published var groupe = UserDefaults.standard.string(forKey: "groupe") ?? "" { didSet { UserDefaults.standard.set(groupe, forKey: "groupe") } }
    @Published var idees: [IdeeLot] = []
    @Published var ideesIA = false
    @Published var ideesCharge = false
    var ideesCle = ""
    @Published var choix: [String]? = nil      // articles choisis pour un lot (nil : pas de composition en cours)
    @Published var choixTheme: IdeeLot? = nil
    @Published var focusRecherche = 0          // ⌘K : place le curseur dans la recherche
    @Published var message: String? = nil      // petit message de confirmation (statut changé, lot créé…)
    var dernierChargement = Date.distantPast
    /// Annonces Le Bon Coin vues désactivées (article → lien vérifié), gardées d'une ouverture à l'autre.
    @Published var annoncesMortes: [String: String] = UserDefaults.standard.dictionary(forKey: "annoncesMortes") as? [String: String] ?? [:] {
        didSet { UserDefaults.standard.set(annoncesMortes, forKey: "annoncesMortes") }
    }
    let verif = VerifAnnonces()
    let releve = ReleveStats()                 // vues et favoris des annonces, relevés en arrière-plan
    @Published var gestion: GestionAnnonce? = nil {
        didSet { if gestion == nil, oldValue != nil { fenetre?.finCoulisses() } }
    }
    weak var fenetre: Fenetre?

    func demarrer() async {
        // Captures automatiques (GitHub) : données d'exemple, sans réseau.
        if let d = ProcessInfo.processInfo.environment["RR_DEMO"], ["articles", "fiche", "nouveau", "compte", "depot", "gestion", "choixdepot", "fichelot", "adresse", "messages"].contains(d) {
            profil = Profil(["email": "demo@retrorevente.fr", "nom": "Titelive", "pseudo": "Titelive", "cree": "2025-06-01T10:00:00Z",
                             "formule": ["nom": "Collectionneur", "id": "collectionneur", "fiscal": true, "abonnement": "collectionneur", "statut": "active"], "quota": ["max": NSNull(), "utilise": 37]])
            let ex: [[String: Any]] = [
                ["id": "a1", "titre": "Super Mario 64", "plateforme": "Nintendo 64", "region": "PAL EUR", "etat": "bon", "contenu": "complet", "prixDemande": 45, "statut": "en_vente", "modifie": "6", "cree": "2026-11-20", "rareteJeu": "peu_commun", "lots": ["l1"], "annonce": "https://www.leboncoin.fr/ad/jeux_video/3000000001",
                 "stats": ["lbc": ["vues": 128, "favoris": 7, "at": demoIl(2), "hist": [["j": demoJour(6), "v": 96, "f": 4], ["j": demoJour(0), "v": 128, "f": 7]]]],
                 "cote": ["bas": 38, "haut": 52, "conseille": 49, "rapide": 42, "date": "2026-11-20", "resume": "Ventes eBay conclues entre 38 et 52 € en complet ; annonces Le Bon Coin entre 40 et 60 €.",
                          "releves": [["site": "eBay", "titre": "Super Mario 64 complet PAL", "prix": 45, "date": "2026-11-02", "url": "https://www.ebay.fr/"], ["site": "PriceCharting", "titre": "Cote moyenne CIB", "prix": 48, "date": "2026-11-10", "url": "https://www.pricecharting.com/"]]]],
                ["id": "a2", "titre": "The Legend of Zelda: Ocarina of Time", "plateforme": "Nintendo 64", "region": "PAL EUR", "prixDemande": 39, "statut": "en_vente", "modifie": "5", "cree": "2026-11-19", "rareteJeu": "rare", "lots": ["l1"], "annonceEbay": "https://www.ebay.fr/itm/123456789",
                 "stats": ["ebay": ["vues": 54, "favoris": 3, "at": demoIl(3), "hist": [["j": demoJour(5), "v": 41, "f": 2], ["j": demoJour(0), "v": 54, "f": 3]]]]],
                ["id": "l1", "titre": "Lot Nintendo 64 : 11 jeux et 1 accessoire, Zelda, Mario, Banjo", "annonce": "https://www.leboncoin.fr/ad/jeux_video/3000000009", "plateforme": "Nintendo 64", "prixDemande": 75, "statut": "en_vente", "modifie": "7", "cree": "2026-11-21", "articles": ["a1", "a2"], "theme": ["nom": "Nintendo 64", "type": "support"],
                 "stats": ["lbc": ["vues": 342, "favoris": 19, "at": demoIl(1), "hist": [["j": demoJour(7), "v": 250, "f": 12], ["j": demoJour(0), "v": 342, "f": 19]]]]],
                ["id": "a8", "titre": "Perfect Dark", "plateforme": "Nintendo 64", "contenu": "seul", "prixDemande": 22, "prixVente": 20, "statut": "recu", "remise": "envoi", "transporteur": "colissimo", "suivi": "6A12345678901", "livreLe": "2026-11-18", "dateVente": "2026-11-14", "modifie": "0", "cree": "2026-10-02", "rareteJeu": "peu_commun"],
                ["id": "a9", "titre": "Conker's Bad Fur Day", "plateforme": "Nintendo 64", "contenu": "seul", "prixDemande": 185, "statut": "en_vente", "modifie": "0", "cree": "2026-11-10", "rareteJeu": "tres_rare"],
                ["id": "a3", "titre": "Game Boy Color Violette", "categorie": "consoles", "plateforme": "Game Boy Color", "prixDemande": 70, "statut": "reserve", "modifie": "4"],
                ["id": "a4", "titre": "Dracaufeu holo 4/102", "categorie": "cartes", "plateforme": "Set de base", "prixDemande": 180, "statut": "en_vente", "modifie": "3"],
                ["id": "a5", "titre": "Kirby 64: The Crystal Shards", "plateforme": "Nintendo 64", "prixDemande": 55, "prixVente": 55, "frais": 3, "statut": "vendu", "dateMiseEnVente": "2026-11-01", "dateVente": "2026-11-05", "modifie": "2"],
                ["id": "a7", "titre": "Pokémon Stadium", "plateforme": "Nintendo 64", "prixDemande": 30, "prixVente": 28, "statut": "envoye", "remise": "envoi", "transporteur": "mondial_relay", "suivi": "12345678", "dateVente": "2026-10-12", "modifie": "0", "cree": "2026-10-01"],
                ["id": "a6", "titre": "Manette DualShock 2", "categorie": "accessoires", "plateforme": "PlayStation 2", "prixDemande": 15, "statut": "en_vente", "modifie": "1"],
            ]
            articles = ex.map(Article.init); etat = .connecte
            if d == "fiche" { selection = "a1"; annoncesMortes = ["a1": articles.first { $0.id == "a1" }?.annonce ?? ""] }
            else if d == "fichelot" { selection = "l1"; annoncesMortes = ["l1": articles.first { $0.id == "l1" }?.annonce ?? ""] }
            else { annoncesMortes = [:] }
            if d == "nouveau" { nouveauOuvert = true }
            if d == "choixdepot" { choixDepot = true }
            if d == "gestion" { selection = "a1"; gestion = GestionAnnonce(id: "a1", titre: articles.first { $0.id == "a1" }?.titre ?? "", action: .modifier, etape: .pret(bouton: "Valider les modifications")) }
            if d == "messages" { messagesOuvert = true; messagerie.demo() }
            if d == "adresse" { selection = "a3"; depot = DepotEnCours(id: "a3", titre: articles.first { $0.id == "a3" }?.titre ?? "", etape: .adresse("")) }
            if d == "depot" { selection = "a1"; depot = DepotEnCours(id: "a1", titre: articles.first { $0.id == "a1" }?.titre ?? "", etape: .pret(bouton: "Déposer sans booster mon annonce", payant: false)) }
            barreCachee = ProcessInfo.processInfo.environment["RR_DEMO_BARRE"] == "cachee"
            if ["trophees", "bilan", "compte", "tous"].contains(ProcessInfo.processInfo.environment["RR_DEMO_PAGE"] ?? "") { page = ProcessInfo.processInfo.environment["RR_DEMO_PAGE"] }
            return
        }
        do { try await chargerProfil(); etat = .connecte; await brancherLeBonCoin(); await recharger() }
        catch let e as ErreurRR where e.status == 401 { etat = .deconnecte }
        catch { etat = .deconnecte; erreur = (error as? ErreurRR)?.message ?? "Pas de connexion à RetroRevente." }
    }
    func chargerProfil() async throws { let p = Profil(try await API.json("GET", "/api/moi")); if p != profil { profil = p } }
    func recharger() async {
        do {
            let j = try await API.json("GET", "/api/objets")
            let n = (j["objets"] as? [[String: Any]] ?? []).map(Article.init).sorted { $0.modifie > $1.modifie }
            if n != articles { articles = n }   // rien de changé : la grille n'est pas redessinée
            dernierChargement = Date()
            verif.appli = self; verif.planifier(articles)
            releve.appli = self; releve.planifier(articles)
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
    @discardableResult func ajouterPhoto(_ a: Article, _ data: String) async -> Bool {
        do { let j = try await API.json("POST", "/api/objets/\(a.id)/photos", ["photo": data]); remplacer(Article(j["objet"] as? [String: Any] ?? [:])); return true }
        catch { signaler(error); return false }
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
    /// Dépôt en coulisses : Le Bon Coin se remplit sans s'afficher, puis l'app demande « Publier ».
    func deposer(_ a: Article) { fenetre?.deposerEnCoulisses(a) }
    /// Dépôt à l'écran, comme avec l'extension (la personne suit et publie sur Le Bon Coin).
    func deposerAVue(_ a: Article) {
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
