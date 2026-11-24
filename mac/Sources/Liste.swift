import SwiftUI

// « Mes articles » au niveau du site : lots, rareté, sites, colis, statut en un clic, tri, regroupement et lots à thème.

/// Une idée de lot à thème (POST /api/lots/suggestions).
struct IdeeLot: Identifiable, Equatable {
    let id: String
    let theme: String, type: String, raison: String
    let complet: Bool
    let articles: [String]
    let conseille: Double?, somme: Double?, ajust: Double?
    init(_ d: [String: Any]) {
        theme = d["theme"] as? String ?? ""; type = d["type"] as? String ?? ""; raison = d["raison"] as? String ?? ""
        complet = d["complet"] as? Bool ?? false
        articles = d["articles"] as? [String] ?? []
        let c = d["cote"] as? [String: Any] ?? [:]
        conseille = (c["conseille"] as? NSNumber)?.doubleValue; somme = (c["somme"] as? NSNumber)?.doubleValue; ajust = (c["ajust"] as? NSNumber)?.doubleValue
        id = articles.sorted().joined(separator: ",")
    }
    var themeEnvoi: [String: Any] { ["nom": theme, "type": type, "complet": complet] }
}

struct GroupeArticles: Identifiable { let nom: String; let articles: [Article]; var id: String { nom } }

/// « 12 nov. » : date courte d'un jour AAAA-MM-JJ.
func dateCourte(_ jour: String) -> String {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "fr_FR")
    guard let d = f.date(from: String(jour.prefix(10))) else { return jour }
    let s = DateFormatter(); s.locale = Locale(identifier: "fr_FR"); s.setLocalizedDateFormatFromTemplate("d MMM")
    return s.string(from: d)
}

extension Appli {
    func parId(_ id: String) -> Article? {
        if let i = index[id], i < articles.count, articles[i].id == id { return articles[i] }
        return articles.first { $0.id == id }
    }
    /// Les lots qui contiennent vraiment cet article.
    func lotsDe(_ a: Article) -> [Article] { a.lots.compactMap(parId).filter { $0.estLot && ($0.membres ?? []).contains(a.id) } }
    /// Lots où l'article est proposé en ce moment (pas ceux retirés) : ce que compte le badge de la carte.
    func lotsActifs(_ a: Article) -> [Article] { lotsDe(a).filter { $0.statut != "retire" } }
    /// Le lot d'un article : celui avec lequel il est parti s'il est vendu, sinon le premier.
    func lotDe(_ a: Article) -> Article? { let l = lotsDe(a); return l.first { $0.vendu } ?? l.first }
    func membres(_ lot: Article) -> [Article] { (lot.membres ?? []).compactMap(parId) }
    func libre(_ a: Article) -> Bool { !a.estLot && !a.vendu }
    /// Sous 5 €, un article se vend mieux en lot.
    func petitPrix(_ a: Article) -> Bool { a.coteLot || (a.valeur.map { $0 < 5 } ?? false) }

    /// La liste affichée, comme sur le site : un lot vendu regroupe ses articles dans sa carte.
    func visibles(_ filtre: String?, _ recherche: String = "") -> [Article] {
        let l = articles.filter { a in
            let statutOk = filtre == nil || a.statut == filtre || (filtre == "vendu" && a.vendu)
            let place = choix != nil ? !a.estLot : !(lotDe(a)?.vendu ?? false)
            let cherche = recherche.isEmpty || (a.titre + " " + a.plateforme + " " + a.titreAnnonce + " " + a.themeNom).localizedCaseInsensitiveContains(recherche)
            return statutOk && place && cherche
        }
        return trier(l)
    }
    func trier(_ l: [Article]) -> [Article] {
        l.sorted { a, b in
            switch tri {
            case "nom": return a.titre.localizedStandardCompare(b.titre) == .orderedAscending
            case "rarete" where a.rangRarete != b.rangRarete: return a.rangRarete > b.rangRarete
            case "prix_d", "prix_c":
                guard let x = a.prixAffiche else { return false }
                guard let y = b.prixAffiche else { return true }   // sans prix : à la fin
                return tri == "prix_d" ? x > y : x < y
            case "ancien": return a.cree < b.cree
            default: return a.cree > b.cree
            }
        }
    }
    func grouper(_ l: [Article]) -> [GroupeArticles] {
        guard !groupe.isEmpty else { return [GroupeArticles(nom: "", articles: l)] }
        func cle(_ o: Article) -> String {
            if o.estLot && groupe != "statut" { return groupe == "console" && !o.plateforme.isEmpty ? o.plateforme.trimmingCharacters(in: .whitespaces) : "Lots" }
            switch groupe {
            case "categorie": return Libelles.nomsCategories[o.categorie] ?? "Autres"
            case "statut": return ["en_vente": "En vente", "reserve": "Réservés", "vendu": "Vendus", "envoye": "Vendus", "recu": "Vendus", "retire": "Retirés"][o.statut] ?? "Autres"
            case "rarete": return o.categorie == "cartes" ? "Cartes Pokémon" : o.categorie == "films" ? "Films" : Libelles.rareteGroupe[o.rareteJeu] ?? "Rareté non indiquée"
            default:
                if o.categorie == "cartes" { return "Cartes Pokémon" }
                if o.categorie == "films" { return "Films " + (o.plateforme.range(of: "4K", options: .caseInsensitive) != nil ? "4K UHD" : o.plateforme.isEmpty ? "sans format" : o.plateforme) }
                return o.plateforme.trimmingCharacters(in: .whitespaces).isEmpty ? "Sans console" : o.plateforme.trimmingCharacters(in: .whitespaces)
            }
        }
        var ordre: [String] = [], par: [String: (String, [Article])] = [:]
        for o in l { let k = cle(o), kk = k.lowercased(); if par[kk] == nil { par[kk] = (k, []); ordre.append(kk) }; par[kk]!.1.append(o) }
        let fixe: [String]? = groupe == "categorie" ? ["Lots", "Jeux vidéo", "Consoles", "Accessoires", "Cartes Pokémon", "Films", "Autres"]
            : groupe == "statut" ? ["En vente", "Réservés", "Vendus", "Retirés"]
            : groupe == "rarete" ? ["Lots", "Très rares", "Rares", "Peu communs", "Communs", "Rareté non indiquée", "Cartes Pokémon", "Films"] : nil
        let gs = ordre.map { par[$0]! }
        return gs.sorted { a, b in
            if let f = fixe { return (f.firstIndex(of: a.0) ?? 99) < (f.firstIndex(of: b.0) ?? 99) }
            func fin(_ n: String) -> Int { n == "Lots" ? -1 : n == "Sans console" ? 3 : n == "Cartes Pokémon" ? 2 : n.hasPrefix("Films ") ? 1 : 0 }
            if fin(a.0) != fin(b.0) { return fin(a.0) < fin(b.0) }
            if a.1.count != b.1.count { return a.1.count > b.1.count }
            return a.0.localizedStandardCompare(b.0) == .orderedAscending
        }.map { GroupeArticles(nom: $0.0, articles: $0.1) }
    }

    // MARK: Statut en un clic

    func changerStatut(_ a: Article, _ s: String) async {
        guard a.statut != s else { return }
        let vente = ["vendu", "envoye", "recu"].contains(s)
        var corps: [String: Any] = ["statut": s]
        if vente, a.prixVente == nil, let p = a.prixDemande { corps["prixVente"] = p }
        do {
            let j = try await API.json("PUT", "/api/objets/\(a.id)", ["objet": corps])
            let n = Article(j["objet"] as? [String: Any] ?? [:])
            if a.estLot || j["lot"] != nil || lotDe(a) != nil { await recharger() }
            else if let i = articles.firstIndex(where: { $0.id == n.id }) { articles[i] = n }
            let prix = vente ? (n.prixVente.map { " à " + Libelles.prix($0) } ?? "") : ""
            message = "« \(n.titre) » : \(Libelles.statut(n.statut).lowercased())\(prix)."
            if vente && ["en_vente", "reserve"].contains(a.statut) { fete = n.titre; DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.fete = nil } }
        } catch { signaler(error) }
    }

    // MARK: Lots à thème

    /// Recharge les idées quand les articles libres changent (comme le site).
    func majIdees() {
        let lib = articles.filter { libre($0) && $0.statut != "retire" }
        let cle = lib.map { "\($0.id):\($0.valeur ?? -1)" }.sorted().joined(separator: ",")
        guard cle != ideesCle, lib.count >= 2 else { return }
        ideesCle = cle; ideesIA = false
        Task { await chargerIdees(ia: false) }
    }
    func chargerIdees(ia: Bool) async {
        ideesCharge = true; defer { ideesCharge = false }
        do {
            let j = try await API.json("POST", "/api/lots/suggestions", ia ? ["ia": true] : [:])
            let l = (j["suggestions"] as? [[String: Any]] ?? []).map(IdeeLot.init)
            if ia {
                var vus = Set<String>(), r: [IdeeLot] = []
                for x in l + idees where !vus.contains(x.id) { vus.insert(x.id); r.append(x) }
                idees = Array(r.prefix(10)); ideesIA = true
                message = l.isEmpty ? "Pas d'autre idée de lot pour le moment." : "L'IA a trouvé \(l.count) idée\(l.count > 1 ? "s" : "") de lot."
            } else { idees = l }
        } catch { if ia { signaler(error) } }
    }
    /// Idées encore valables : au moins 2 articles libres, et pas déjà un lot identique.
    var ideesAffichees: [IdeeLot] {
        let existe = Set(articles.filter { $0.estLot && !$0.vendu }.map { ($0.membres ?? []).sorted().joined(separator: ",") })
        return idees.filter { x in
            let ok = x.articles.filter { parId($0).map(libre) ?? false }
            return ok.count >= 2 && !existe.contains(ok.sorted().joined(separator: ","))
        }.sorted { ($0.complet ? 1 : 0) > ($1.complet ? 1 : 0) }
    }

    func commencerChoix(_ ids: [String] = [], theme: IdeeLot? = nil) {
        choix = ids.filter { parId($0).map(libre) ?? false }; choixTheme = theme; selection = nil
    }
    func basculerChoix(_ a: Article) {
        guard var c = choix else { return }
        guard libre(a) else { message = "Déjà vendu : il ne peut pas aller dans un lot."; return }
        if let i = c.firstIndex(of: a.id) { c.remove(at: i) } else { c.append(a.id) }
        choix = c
    }

    func creerLot(_ ids: [String], theme: IdeeLot?) async {
        guard ids.count >= 2 else { message = "Choisis au moins 2 articles."; return }
        let photo = await mosaique(ids.compactMap(parId))
        var corps: [String: Any] = ["articles": ids, "theme": theme?.themeEnvoi ?? NSNull()]
        if let p = photo { corps["photo"] = p }
        do {
            let j = try await API.json("POST", "/api/lots", corps)
            let id = (j["objet"] as? [String: Any])?["id"] as? String ?? ""
            choix = nil; choixTheme = nil; ideesCle = ""
            await recharger()
            if !id.isEmpty { selection = id }
            message = "Lot créé : prix conseillé, annonce et photos sont prêts. Vérifie-les avant de publier."
        } catch { signaler(error) }
    }

    /// Mosaïque des photos des articles (même mise en page que le site) : première photo du lot.
    func mosaique(_ l: [Article]) async -> String? {
        var im: [CGImage] = []
        for a in l.prefix(16) {
            guard let p = a.photos.first, let i = await Images.charger(API.urlPhoto(a.id, p.id, v: a.modifie)),
                  let cg = i.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
            im.append(cg)
        }
        guard im.count >= 2 else { return nil }
        let S: CGFloat = 1600, G: CGFloat = 10, n = im.count
        var cases: [CGRect] = []
        if n == 2 { cases = [CGRect(x: 0, y: 0, width: 0.5, height: 1), CGRect(x: 0.5, y: 0, width: 0.5, height: 1)] }
        else if n == 3 { cases = [CGRect(x: 0, y: 0, width: 0.6, height: 1), CGRect(x: 0.6, y: 0, width: 0.4, height: 0.5), CGRect(x: 0.6, y: 0.5, width: 0.4, height: 0.5)] }
        else {
            let c = Int(ceil(sqrt(Double(n)))), r = Int(ceil(Double(n) / Double(c)))
            for k in 0..<n { let y = k / c, ligne = y == r - 1 ? n - c * (r - 1) : c, x = k - y * c
                cases.append(CGRect(x: CGFloat(x) / CGFloat(ligne), y: CGFloat(y) / CGFloat(r), width: 1 / CGFloat(ligne), height: 1 / CGFloat(r))) }
        }
        guard let ctx = CGContext(data: nil, width: Int(S), height: Int(S), bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        ctx.setFillColor(CGColor(gray: 1, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: S, height: S))
        ctx.interpolationQuality = .high
        for (k, q) in cases.enumerated() {
            // repère CoreGraphics : l'origine est en bas, on retourne l'axe vertical
            let X = q.minX * S + G, W = q.width * S - 2 * G, H = q.height * S - 2 * G, Y = S - (q.minY * S + G) - H
            let i = im[k], iw = CGFloat(i.width), ih = CGFloat(i.height), s = max(W / iw, H / ih), dw = iw * s, dh = ih * s
            ctx.saveGState()
            ctx.addPath(CGPath(roundedRect: CGRect(x: X, y: Y, width: W, height: H), cornerWidth: 24, cornerHeight: 24, transform: nil)); ctx.clip()
            ctx.draw(i, in: CGRect(x: X + (W - dw) / 2, y: Y + (H - dh) / 2, width: dw, height: dh))
            ctx.restoreGState()
        }
        guard let r = ctx.makeImage() else { return nil }
        return jpegData(NSImage(cgImage: r, size: NSSize(width: S, height: S)), max: S)
    }

    /// Données à jour : au retour dans l'app, et de temps en temps (les changements faits sur le site s'y voient).
    func rafraichir(apres secondes: TimeInterval = 20) {
        guard etat == .connecte, Date().timeIntervalSince(dernierChargement) > secondes,
              ProcessInfo.processInfo.environment["RR_DEMO"] == nil else { return }
        Task { await recharger(); try? await chargerProfil() }
    }
}

// MARK: Vues

struct Grille: View {
    @ObservedObject var appli: Appli
    let articles: [Article]; let titre: String; let filtre: String?
    private let colonnes = [GridItem(.adaptive(minimum: 200, maximum: 270), spacing: 20, alignment: .top)]

    var body: some View {
        VStack(spacing: 0) {
            EnTete(titre: titre, sousTitre: articles.isEmpty ? "" : "\(articles.count) article\(articles.count > 1 ? "s" : "")") {
                Menu {
                    Picker("Trier", selection: $appli.tri) {
                        Text("Plus récents").tag("recent"); Text("Plus anciens").tag("ancien"); Text("Prix décroissant").tag("prix_d")
                        Text("Prix croissant").tag("prix_c"); Text("Nom (A → Z)").tag("nom"); Text("Plus rares d'abord").tag("rarete")
                    }.pickerStyle(.inline)
                    Picker("Grouper", selection: $appli.groupe) {
                        Text("Sans groupe").tag(""); Text("Par support").tag("console"); Text("Par catégorie").tag("categorie")
                        Text("Par statut").tag("statut"); Text("Par rareté").tag("rarete")
                    }.pickerStyle(.inline)
                } label: { Label("Trier", systemImage: "arrow.up.arrow.down") }
                .menuStyle(.button).boutonVerre().fixedSize().help("Trier et grouper les articles")
                if !(filtre == nil || filtre == "en_vente") || appli.articles.filter({ appli.libre($0) && $0.statut != "retire" }).count < 2 {
                    Button { appli.commencerChoix() } label: { Label("Composer un lot", systemImage: "shippingbox") }.boutonVerre().disabled(appli.choix != nil)
                }
                Button { Task { await appli.recharger() } } label: { Image(systemName: "arrow.clockwise") }.boutonVerre().help("Actualiser (⌘R)")
                Button { appli.nouveauOuvert = true } label: { Label("Nouvel article", systemImage: "plus") }.boutonVerre(principal: true).keyboardShortcut("n").help("Nouvel article (⌘N)")
            }
            ScrollView {
                // Pile paresseuse : seules les cartes visibles (et leurs photos) sont construites pendant le défilement.
                LazyVStack(alignment: .leading, spacing: 26) {
                    if appli.choix == nil, filtre == nil || filtre == "en_vente" { IdeesLots(appli: appli) }
                    if articles.isEmpty {
                        VStack(spacing: 12) {
                            Image(systemName: "shippingbox").font(.system(size: 44, weight: .light)).foregroundStyle(Color.rrOr)
                            Text(appli.articles.isEmpty ? "Aucun article pour l'instant" : "Aucun article dans cette catégorie").font(.title3.weight(.semibold))
                            if appli.articles.isEmpty {
                                Text("Prends ton premier article en photo : l'annonce se remplit toute seule.").foregroundStyle(.secondary)
                                Button { appli.nouveauOuvert = true } label: { Label("Nouvel article", systemImage: "plus") }.boutonVerre(principal: true).controlSize(.large)
                            }
                        }.frame(maxWidth: .infinity).padding(.top, 80)
                    } else {
                        ForEach(appli.grouper(articles)) { g in
                            VStack(alignment: .leading, spacing: 14) {
                                if !g.nom.isEmpty {
                                    let tot = g.articles.reduce(0) { $0 + ($1.prixAffiche ?? 0) }
                                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                                        Text(g.nom).font(.title3.weight(.heavy))
                                        Text("\(g.articles.count) article\(g.articles.count > 1 ? "s" : "")\(tot > 0 ? " · " + Libelles.prix(tot) : "")").font(.callout).foregroundStyle(.secondary)
                                    }
                                }
                                LazyVGrid(columns: colonnes, alignment: .leading, spacing: 22) {
                                    ForEach(g.articles) { a in CarteArticle(appli: appli, article: a) }
                                }
                            }
                        }
                    }
                }.padding(.horizontal, 24).padding(.top, 14).padding(.bottom, appli.choix != nil ? 110 : 28)
            }
            .overlay(alignment: .bottom) { if appli.choix != nil { BarreLot(appli: appli).padding(18).transition(.move(edge: .bottom).combined(with: .opacity)) } }
            .animation(.spring(response: 0.35, dampingFraction: 0.85), value: appli.choix != nil)
        }
        .onAppear { appli.majIdees() }
        .onChange(of: appli.articles) { _ in appli.majIdees() }
    }
}

/// Carte d'un article ou d'un lot, comme sur le site.
struct CarteArticle: View {
    @ObservedObject var appli: Appli
    let article: Article
    @State private var survol = false

    private var choisi: Bool { appli.choix?.contains(article.id) ?? false }
    private var grise: Bool { appli.choix != nil && !appli.libre(article) }
    private var teinte: (fond: Color, trait: Color)? {
        switch article.statut {
        case "vendu": return (Color.rrAnis.opacity(0.22), Color.rrAnis)
        case "envoye", "recu": let c = Libelles.couleursStatut(article.statut); return (c.fond.opacity(0.75), c.texte.opacity(0.35))
        default: return nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            image
            texte
        }
        // Toutes les cartes d'une rangée ont la même hauteur (prix et statut alignés en bas).
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(teinte?.fond ?? Color(nsColor: .controlBackgroundColor))
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(contour, lineWidth: choisi || survol ? 2 : 1))
        .background(pile)
        // Ombre portée par une simple forme derrière la carte : bien moins coûteuse à dessiner pendant le défilement
        // qu'une ombre calculée sur tout le contenu (photo, étiquettes, textes).
        .background(RoundedRectangle(cornerRadius: 20).fill(Color(nsColor: .controlBackgroundColor))
            .shadow(color: .black.opacity(survol ? 0.18 : 0.07), radius: survol ? 14 : 5, y: survol ? 8 : 3))
        .scaleEffect(survol && !grise ? 1.015 : 1)
        .opacity(grise ? 0.45 : 1)
        .animation(.spring(response: 0.25, dampingFraction: 0.8), value: survol)
        .contentShape(RoundedRectangle(cornerRadius: 20))
        .onHover { survol = $0 }
        .onTapGesture {
            if appli.choix != nil { if !article.estLot { appli.basculerChoix(article) } }
            else { appli.selection = article.id }
        }
        .contextMenu {
            Button("Ouvrir la fiche") { appli.selection = article.id }
            Menu("Statut") { ForEach(Libelles.ordreStatuts, id: \.self) { s in Button(Libelles.statut(s)) { Task { await appli.changerStatut(article, s) } }.disabled(s == article.statut) } }
            if !article.estLot, !article.publiee { Button("Déposer sur Le Bon Coin") { appli.deposer(article) }.disabled(article.statut != "en_vente") }
            if article.publiee { Button("Voir l'annonce Le Bon Coin") { appli.fenetre?.voirAnnonce(article) } }
            if let u = URL(string: article.annonceEbay), !article.annonceEbay.isEmpty { Button("Voir l'annonce eBay") { NSWorkspace.shared.open(u) } }
        }
        .help(article.titre)
    }

    private var contour: Color {
        if choisi { return Color.rrOr }
        if survol { return Color.rrOr.opacity(0.7) }
        if article.estLot && !article.vendu { return Color.rrOr.opacity(0.55) }
        return teinte?.trait.opacity(0.6) ?? Color.primary.opacity(0.08)
    }
    /// Un lot : des cartes empilées derrière.
    @ViewBuilder private var pile: some View {
        if article.estLot {
            ZStack {
                RoundedRectangle(cornerRadius: 20).fill(Color(nsColor: .controlBackgroundColor)).overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.primary.opacity(0.1))).offset(x: 9, y: 9)
                RoundedRectangle(cornerRadius: 20).fill(Color(nsColor: .controlBackgroundColor)).overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.primary.opacity(0.12))).offset(x: 4.5, y: 4.5)
            }
        }
    }

    private var image: some View {
        Color.clear.aspectRatio(1, contentMode: .fit)
            .overlay { Vignette(article: article) }
            .clipped()
            .overlay(alignment: .topLeading) { etiquetteHaut.padding(10) }
            .overlay(alignment: .topTrailing) { coinHaut.padding(10) }
            .overlay(alignment: .bottomLeading) { Sites(article: article, appli: appli).padding(10) }
            .overlay(alignment: .bottomTrailing) { BadgeRarete(article: article).padding(10) }
            .overlay { if choisi { Color.rrOr.opacity(0.12) } }
    }

    @ViewBuilder private var etiquetteHaut: some View {
        if article.estLot {
            Etiquette(texte: "LOT ×\(appli.membres(article).count)", symbole: "shippingbox", fond: .rrNuit, texteCouleur: .rrAnis, pixel: true)
        } else if appli.choix == nil, !appli.lotsActifs(article).isEmpty {
            let n = appli.lotsActifs(article).count
            Etiquette(texte: n > 1 ? "DANS \(n) LOTS" : "AUSSI EN LOT", symbole: "shippingbox", fond: .rrNuit, texteCouleur: .rrAnis, pixel: true)
                .help("Aussi dans " + appli.lotsActifs(article).map { "« \($0.titre) »" }.joined(separator: ", "))
        } else if appli.choix == nil, appli.petitPrix(article), article.statut == "en_vente" {
            Etiquette(texte: "Idéal en lot", symbole: nil, fond: .rrAnis, texteCouleur: .rrNuit, pixel: false)
        }
    }
    @ViewBuilder private var coinHaut: some View {
        if appli.choix != nil, !article.estLot {
            Image(systemName: choisi ? "checkmark.circle.fill" : "circle").font(.system(size: 24, weight: .semibold))
                .foregroundStyle(choisi ? Color.rrOr : Color.white).shadow(radius: 3)
        } else if article.vendu {
            let c = Libelles.couleursStatut(article.statut)
            Etiquette(texte: Libelles.statut(article.statut).uppercased(), symbole: Libelles.symboleStatut(article.statut), fond: c.fond, texteCouleur: c.texte, pixel: true)
        } else if article.estLot, article.alerteVendus > 0 {
            Etiquette(texte: "\(article.alerteVendus) vendu\(article.alerteVendus > 1 ? "s" : "") à part", symbole: nil, fond: Color(nsColor: NSColor(hex: 0xFFE3B3)), texteCouleur: Color(nsColor: NSColor(hex: 0x6B3D00)), pixel: false)
        }
    }

    private var sousTitre: String {
        if article.estLot {
            let n = appli.membres(article).count
            let th = !article.themeNom.isEmpty && article.themeType != "support" && article.themeType != "petits prix" ? article.themeNom : ""
            return ["\(n) article\(n > 1 ? "s" : "")", article.plateforme, th].filter { !$0.isEmpty }.joined(separator: " · ")
        }
        return article.ligne
    }

    private var texte: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(article.titre).font(.headline).lineLimit(2, reservesSpace: true)
            // Une seule ligne (sous-titre, puis vues et favoris à droite) : toutes les cartes gardent la même mise en page.
            HStack(spacing: 8) {
                Text(sousTitre.isEmpty ? " " : sousTitre).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.tail)
                Spacer(minLength: 0)
                StatsCarte(article: article).lineLimit(1).fixedSize()
            }
            if let c = colis {
                Label(c, systemImage: article.livreLe.isEmpty ? "shippingbox" : "checkmark.circle").font(.caption.weight(.medium))
                    .foregroundStyle(article.livreLe.isEmpty ? Color.secondary : Libelles.couleursStatut("recu").texte).lineLimit(1)
            }
            Spacer(minLength: 0)
            HStack(alignment: .center, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text(Libelles.prix(article.prixAffiche)).font(.title3.weight(.heavy).monospacedDigit()).lineLimit(1).fixedSize()
                    if article.estLot, !article.vendu, let px = article.prixAffiche {
                        let som = appli.membres(article).reduce(0) { $0 + ($1.valeur ?? 0) }
                        // Prix barré : seulement s'il tient sans repousser la pastille de statut.
                        if som > px { Text(Libelles.prix(som.rounded())).font(.caption).strikethrough().foregroundStyle(.secondary).lineLimit(1).layoutPriority(-1) }
                    }
                }
                Spacer(minLength: 4)
                if appli.choix == nil { BoutonStatut(appli: appli, article: article) }
            }
        }.padding(12).frame(maxHeight: .infinity, alignment: .top)
    }

    private var colis: String? {
        guard article.vendu, article.remise != "main_propre", !(article.suivi.isEmpty && article.livreLe.isEmpty) else { return nil }
        let noms = ["colissimo": "Colissimo", "mondial_relay": "Mondial Relay", "relais_colis": "Relais Colis", "chronopost": "Chronopost", "dpd": "DPD", "ups": "UPS", "gls": "GLS", "lettre_suivie": "Lettre suivie"]
        let t = !article.livreLe.isEmpty ? "Livré le " + dateCourte(article.livreLe) : !article.suiviLibelle.isEmpty ? "En route" : article.statut == "envoye" ? "Suivi en cours" : "Numéro noté"
        return [noms[article.transporteur] ?? "", t].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

/// Petite étiquette sur la photo (lot, vendu, envoyé…).
struct Etiquette: View {
    let texte: String; let symbole: String?; let fond: Color; let texteCouleur: Color; let pixel: Bool
    var body: some View {
        HStack(spacing: 5) {
            if let s = symbole { Image(systemName: s).font(.system(size: 10, weight: .bold)) }
            Text(texte).font(pixel ? .system(size: 10, weight: .heavy, design: .monospaced) : .system(size: 11.5, weight: .bold)).tracking(pixel ? 0.6 : 0)
        }
        .foregroundStyle(texteCouleur)
        .padding(.horizontal, 9).padding(.vertical, 6)
        .background(Capsule().fill(fond).shadow(color: .black.opacity(0.25), radius: 5, y: 3))
    }
}

/// Pastilles « LBC » et « eBay » : l'annonce est en ligne sur ces sites (clic : l'annonce).
struct Sites: View {
    let article: Article; @ObservedObject var appli: Appli
    var body: some View {
        HStack(spacing: 4) {
            if article.annonceMorte(appli) {
                Button { appli.selection = article.id } label: {
                    HStack(spacing: 3) { Image(systemName: "xmark").font(.system(size: 8, weight: .black)); Text("LBC").strikethrough() }
                        .font(.system(size: 10, weight: .heavy)).foregroundStyle(Color(nsColor: NSColor(hex: 0xEC5A13)))
                        .padding(.horizontal, 7).padding(.vertical, 4)
                        .background(.white, in: RoundedRectangle(cornerRadius: 6))
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(nsColor: NSColor(hex: 0xEC5A13)), lineWidth: 1.5))
                }.buttonStyle(.plain).help("Annonce désactivée sur Le Bon Coin : ouvre la fiche pour la redéposer")
            } else if !article.annonce.isEmpty {
                pastille("LBC", Color(nsColor: NSColor(hex: 0xEC5A13))) { appli.fenetre?.voirAnnonce(article) }.help("Voir l'annonce sur Le Bon Coin")
            }
            if let u = URL(string: article.annonceEbay), !article.annonceEbay.isEmpty {
                pastille("eBay", Color(nsColor: NSColor(hex: 0x0064D2))) { NSWorkspace.shared.open(u) }.help("Voir l'annonce sur eBay")
            }
        }
    }
    private func pastille(_ t: String, _ c: Color, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(t).font(.system(size: 10, weight: .heavy)).foregroundStyle(.white).padding(.horizontal, 7).padding(.vertical, 4)
                .background(c, in: RoundedRectangle(cornerRadius: 6)).overlay(RoundedRectangle(cornerRadius: 6).stroke(.white.opacity(0.9), lineWidth: 1.5))
        }.buttonStyle(.plain)
    }
}

/// Rareté du jeu (peu commun et au-delà), avec ses losanges.
struct BadgeRarete: View {
    let article: Article
    var body: some View {
        let n = article.rangRarete
        if n >= 2, let nom = Libelles.rarete[article.rareteJeu] {
            HStack(spacing: 3) {
                ForEach(0..<(n - 1), id: \.self) { _ in Image(systemName: "diamond.fill").font(.system(size: 7)) }
                Text(nom).font(.system(size: 11, weight: .heavy, design: .rounded))
            }
            .foregroundStyle(texte)
            .padding(.horizontal, 8).frame(height: 22)
            .background(RoundedRectangle(cornerRadius: 7).fill(fond).shadow(color: .black.opacity(0.3), radius: 4, y: 2))
            .help("Rareté : " + nom)
        }
    }
    private var fond: AnyShapeStyle {
        switch article.rareteJeu {
        case "peu_commun": return AnyShapeStyle(Color(nsColor: NSColor(hex: 0xDDF3CF)))
        case "rare": return AnyShapeStyle(Color(nsColor: NSColor(hex: 0xDCE8FF)))
        default: return AnyShapeStyle(LinearGradient(colors: [Color(nsColor: NSColor(hex: 0xF7D774)), Color(nsColor: NSColor(hex: 0xFF9AD5)), Color(nsColor: NSColor(hex: 0xB98CFF)), Color(nsColor: NSColor(hex: 0x7AF5E4))], startPoint: .leading, endPoint: .trailing))
        }
    }
    private var texte: Color {
        Color(nsColor: NSColor(hex: article.rareteJeu == "peu_commun" ? 0x1F5410 : article.rareteJeu == "rare" ? 0x143F8F : 0x2A1E00))
    }
}

/// Pastille de statut d'une carte : un clic ouvre le parcours de vente, le choix est enregistré tout de suite.
struct BoutonStatut: View {
    @ObservedObject var appli: Appli
    let article: Article
    @State private var ouvert = false
    var body: some View {
        let c = Libelles.couleursStatut(article.statut)
        Button { ouvert.toggle() } label: {
            HStack(spacing: 4) {
                if article.statut == "en_vente" { Circle().fill(Color(nsColor: NSColor(hex: 0x3E8E1E))).frame(width: 6, height: 6) }
                else { Image(systemName: Libelles.symboleStatut(article.statut)).font(.system(size: 9, weight: .bold)) }
                Text(Libelles.statut(article.statut)).font(.system(size: 11, weight: .bold)).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 8, weight: .bold))
            }
            .fixedSize()   // la pastille reste sur une ligne, quelle que soit la largeur de la carte
            .foregroundStyle(c.texte).padding(.horizontal, 9).padding(.vertical, 5)
            .background(c.fond, in: Capsule()).overlay(Capsule().stroke(c.texte.opacity(0.25), lineWidth: 1))
        }
        .buttonStyle(.plain).help("Changer le statut")
        .popover(isPresented: $ouvert, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Statut de **\(article.titre)**").font(.caption).foregroundStyle(.secondary).lineLimit(1).padding(.horizontal, 10).padding(.bottom, 4)
                ForEach(Libelles.ordreStatuts, id: \.self) { s in
                    let cs = Libelles.couleursStatut(s)
                    Button { ouvert = false; Task { await appli.changerStatut(article, s) } } label: {
                        HStack(spacing: 10) {
                            Image(systemName: Libelles.symboleStatut(s)).font(.system(size: 12, weight: .bold)).foregroundStyle(cs.texte)
                                .frame(width: 28, height: 28).background(cs.fond, in: RoundedRectangle(cornerRadius: 8))
                            VStack(alignment: .leading, spacing: 1) {
                                Text(Libelles.statut(s)).font(.callout.weight(.semibold))
                                Text(Libelles.aideStatut(s)).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 10)
                            if s == article.statut { Image(systemName: "checkmark").font(.callout.weight(.bold)).foregroundStyle(Color.rrOr) }
                        }.padding(.horizontal, 8).padding(.vertical, 5).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                }
            }.padding(10).frame(width: 330)
        }
    }
}

/// « Ça se vendrait mieux ensemble » : idées de lots à thème.
struct IdeesLots: View {
    @ObservedObject var appli: Appli
    var body: some View {
        let libres = appli.articles.filter { appli.libre($0) && $0.statut != "retire" }
        if libres.count >= 2 {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("LOTS À THÈME").font(.system(size: 10, weight: .heavy, design: .monospaced)).tracking(1.2).foregroundStyle(.secondary)
                        Text("Ça se vendrait mieux ensemble").font(.title2.weight(.heavy))
                    }
                    Spacer()
                    Button { Task { await appli.chargerIdees(ia: true) } } label: { Label(appli.ideesIA ? "Idées de l'IA ajoutées" : "Plus d'idées avec l'IA", systemImage: "sparkles") }
                        .boutonVerre().disabled(appli.ideesIA || appli.ideesCharge)
                    Button { appli.commencerChoix() } label: { Label("Composer un lot", systemImage: "shippingbox") }.boutonVerre()
                }
                let l = appli.ideesAffichees
                if l.isEmpty {
                    if appli.ideesCharge { ProgressView().controlSize(.small).padding(.vertical, 20) }
                    else {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Pas encore d'idée de lot").font(.callout.weight(.bold))
                            Text("Quand tu auras plusieurs jeux d'une même série, d'un même studio ou à petit prix, je te proposerai de les réunir. Tu peux aussi composer ton lot toi-même.")
                                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(14).frame(maxWidth: 360, alignment: .leading)
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(style: StrokeStyle(lineWidth: 1, dash: [4, 4])).foregroundStyle(.secondary.opacity(0.5)))
                    }
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: 14) { ForEach(l) { x in CarteIdee(appli: appli, idee: x) } }.padding(.vertical, 4).padding(.horizontal, 2)
                    }
                }
            }
        }
    }
}

struct CarteIdee: View {
    @ObservedObject var appli: Appli
    let idee: IdeeLot
    @State private var enCours = false
    var body: some View {
        let m = idee.articles.compactMap(appli.parId)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                ZStack {
                    ForEach(Array(m.prefix(3).enumerated()), id: \.offset) { i, a in
                        Vignette(article: a, taille: .mini).frame(width: 44, height: 44).clipShape(RoundedRectangle(cornerRadius: 9))
                            .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color(nsColor: .controlBackgroundColor), lineWidth: 2))
                            .rotationEffect(.degrees(Double(i - 1) * 7)).offset(x: CGFloat(i) * 14)
                    }
                }.frame(width: 76, height: 50, alignment: .leading)
                VStack(alignment: .leading, spacing: 2) {
                    Text((idee.complet ? "Série complète" : Libelles.typesTheme[idee.type] ?? "Thème").uppercased())
                        .font(.system(size: 9.5, weight: .heavy, design: .monospaced)).tracking(0.8).foregroundStyle(Color.rrOr)
                    Text(idee.theme).font(.headline).lineLimit(1)
                }
            }
            Text(m.map(\.titre).joined(separator: ", ")).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            if !idee.raison.isEmpty { Text(idee.raison).font(.caption).lineLimit(2) }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if let c = idee.conseille {
                    Text(Libelles.prix(c)).font(.title3.weight(.heavy))
                    if let s = idee.somme, c < s.rounded() { Text(Libelles.prix(s.rounded()) + " à l'unité").font(.caption).strikethrough().foregroundStyle(.secondary) }
                    if let a = idee.ajust { let p = Int((a * 100).rounded()); Text(p > 0 ? "+\(p) %" : "−\(-p) %").font(.caption.weight(.bold)).foregroundStyle(p > 0 ? Color.green : Color.secondary) }
                } else { Text("Ajoute un prix à ces articles pour estimer le lot.").font(.caption).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 0)
            HStack {
                Button { Task { enCours = true; await appli.creerLot(idee.articles.filter { appli.parId($0).map(appli.libre) ?? false }, theme: idee); enCours = false } } label: {
                    if enCours { ProgressView().controlSize(.small) } else { Text("Créer ce lot") }
                }.boutonVerre(principal: true).disabled(enCours)
                Button("Ajuster") { appli.commencerChoix(idee.articles, theme: idee) }.boutonVerre()
            }
        }
        .padding(14).frame(width: 290, height: 230, alignment: .topLeading)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(idee.complet ? Color.rrOr : Color.primary.opacity(0.08), lineWidth: idee.complet ? 2 : 1))
    }
}

/// Barre de composition d'un lot (en bas de la liste).
struct BarreLot: View {
    @ObservedObject var appli: Appli
    @State private var cote: (conseille: Double?, somme: Double?) = (nil, nil)
    @State private var enCours = false
    var body: some View {
        let n = appli.choix?.count ?? 0
        HStack(spacing: 14) {
            Image(systemName: "shippingbox.fill").font(.title2).foregroundStyle(Color.rrOr)
            VStack(alignment: .leading, spacing: 2) {
                Text(n > 0 ? "\(n) article\(n > 1 ? "s" : "") dans ton lot" : "Choisis les articles").font(.headline)
                if let t = appli.choixTheme { Text(t.theme).font(.caption).foregroundStyle(.secondary) }
                else { Text("Clique sur les cartes pour les ajouter ou les retirer.").font(.caption).foregroundStyle(.secondary) }
            }
            if n >= 2, let c = cote.conseille {
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text(Libelles.prix(c)).font(.title3.weight(.heavy))
                    if let s = cote.somme, c < s.rounded() { Text(Libelles.prix(s.rounded())).font(.caption).strikethrough().foregroundStyle(.secondary) }
                }
            }
            Spacer()
            Button("Annuler") { appli.choix = nil; appli.choixTheme = nil }.boutonVerre().keyboardShortcut(.cancelAction)
            Button { Task { enCours = true; await appli.creerLot(appli.choix ?? [], theme: appli.choixTheme); enCours = false } } label: {
                if enCours { ProgressView().controlSize(.small) } else { Label("Créer le lot", systemImage: "checkmark") }
            }.boutonVerre(principal: true).disabled(n < 2 || enCours)
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .verre(RoundedRectangle(cornerRadius: 22))
        .shadow(color: .black.opacity(0.15), radius: 18, y: 8)
        .task(id: appli.choix ?? []) {
            guard let ids = appli.choix, ids.count >= 2 else { cote = (nil, nil); return }
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled, let j = try? await API.json("POST", "/api/lots/cote", ["articles": ids, "theme": appli.choixTheme?.themeEnvoi ?? NSNull()]),
                  let c = j["cote"] as? [String: Any] else { return }
            cote = ((c["conseille"] as? NSNumber)?.doubleValue, (c["somme"] as? NSNumber)?.doubleValue)
        }
    }
}

/// Petit message de confirmation, en bas de la fenêtre.
struct Bandeau: View {
    @ObservedObject var appli: Appli
    var body: some View {
        if let m = appli.message {
            Text(m).font(.callout.weight(.medium)).multilineTextAlignment(.center)
                .padding(.horizontal, 16).padding(.vertical, 10)
                .verre(Capsule(), teinte: .rrOr)
                .padding(.bottom, 22).padding(.horizontal, 40)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: m) { try? await Task.sleep(nanoseconds: 3_800_000_000); if appli.message == m { appli.message = nil } }
                .onTapGesture { appli.message = nil }
        }
    }
}
