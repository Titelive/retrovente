// « Mon espace » en natif : trophées, bilan des ventes (seuil fiscal), cote d'un article et gestion du compte.
// Mêmes règles que l'appli web (site/app/index.html) : mêmes trophées, mêmes seuils (30 ventes ou 2 000 € par an).
import AppKit
import SwiftUI
import UniformTypeIdentifiers

private func carte<C: View>(_ titre: String, _ symbole: String, @ViewBuilder _ c: () -> C) -> some View {
    VStack(alignment: .leading, spacing: 12) {
        Label { Text(titre).font(.headline) } icon: { Image(systemName: symbole).foregroundStyle(Color.rrAccent) }
        c()
    }.padding(18).frame(maxWidth: .infinity, alignment: .leading).verre(RoundedRectangle(cornerRadius: 22))
}
private func jours(_ a: String, _ b: String) -> Double? {
    let f = ISO8601DateFormatter(); f.formatOptions = [.withFullDate]
    guard let x = f.date(from: String(a.prefix(10))), let y = f.date(from: String(b.prefix(10))) else { return nil }
    return y.timeIntervalSince(x) / 86400
}

// MARK: Trophées

struct Trophees: View {
    struct T: Identifiable { let groupe, ico, nom, desc: String; let val, max: Int; var id: String { nom }; var ok: Bool { val >= max } }
    @ObservedObject var appli: Appli

    /// Familles de trophées, dans l'ordre d'affichage (mêmes familles et mêmes symboles que le site).
    struct Famille: Hashable { let nom, symbole: String }
    static let familles: [Famille] = [
        .init(nom: "Collection", symbole: "house"), .init(nom: "Ventes", symbole: "tag"), .init(nom: "Argent", symbole: "eurosign.circle"),
        .init(nom: "Colis", symbole: "shippingbox"), .init(nom: "Consoles", symbole: "gamecontroller"), .init(nom: "Cartes et films", symbole: "film"),
        .init(nom: "Outils", symbole: "sparkles"), .init(nom: "Temps et fidélité", symbole: "stopwatch"),
    ]

    static func liste(_ appli: Appli) -> [T] {
        let o = appli.articles.filter { !$0.estLot }, v = o.filter { $0.vendu }
        let lots = appli.articles.filter { $0.estLot && $0.vendu }.count
        let enc = v.reduce(0) { $0 + ($1.prixVente ?? 0) }
        let plat = Set(o.filter { !["cartes", "films"].contains($0.categorie) }.map { $0.plateforme.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty })
        func vide(_ s: String) -> Bool { s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        func motif(_ s: String, _ re: String) -> Bool { s.range(of: re, options: [.regularExpression, .caseInsensitive]) != nil }
        func jeuPlat(_ re: String) -> Int { o.filter { !["cartes", "films"].contains($0.categorie) && motif($0.plateforme, re) }.count }
        func duree(_ a: Article) -> Double? { jours(a.dateMiseEnVente, a.dateVente) }
        let n64 = o.filter { $0.plateforme.contains("64") && motif($0.plateforme + " ", "nintendo|n64") }.count
        let cartes = o.filter { $0.categorie == "cartes" }.count, films = o.filter { $0.categorie == "films" }.count
        let ia = o.filter { $0.ia || !vide($0.texteAnnonce) }.count
        let photos = o.filter { !$0.photos.isEmpty }.count
        let eclair = v.filter { a in duree(a).map { $0 <= 7 } ?? false }.count
        let plein = v.filter { a in (a.prixDemande ?? 0) > 0 && (a.prixVente ?? 0) >= (a.prixDemande ?? 0) }.count
        let rare = v.filter { ($0.prixVente ?? 0) >= 100 }.count
        let envois = v.filter { $0.statut == "envoye" || $0.statut == "recu" || $0.remise == "envoi" }.count
        // Bénéfice : seulement les ventes dont le prix d'achat est renseigné, frais déduits.
        let benef = max(0, Int(v.filter { $0.prixAchat != nil }.reduce(0.0) { $0 + ($1.prixVente ?? 0) - ($1.prixAchat ?? 0) - ($1.frais ?? 0) }.rounded(.down)))
        let anc = Int(jours(appli.profil.cree, ISO8601DateFormatter().string(from: Date())) ?? 0)
        // Temps gagné (minutes par étape, valeurs par défaut de l'appli web).
        let minutes = TempsGagne.total(appli)   // même calcul que la tuile « Temps gagné » de l'accueil
        let g: [(String, [(String, String, String, Int, Int)])] = [
            ("Collection", [
                ("🕹️", "Insert Coin", "Ajoute ton tout premier article.", o.count, 1),
                ("🧺", "Grenier vidé", "10 articles ajoutés.", o.count, 10),
                ("📦", "Entrepôt", "50 articles ajoutés.", o.count, 50),
                ("🗄️", "Inventaire plein", "100 articles ajoutés. Il va falloir un sac sans fond.", o.count, 100),
                ("📸", "Photographe", "10 articles avec une photo.", photos, 10),
                ("🖼️", "Paparazzi", "50 articles avec une photo.", photos, 50),
                ("📘", "CIB ou rien", "5 jeux complets en boîte, avec la notice.", o.filter { $0.contenu == "complet" }.count, 5),
                ("✨", "Shiny", "Un article estimé très rare dans ta collection.", o.filter { $0.rareteJeu == "tres_rare" }.count, 1),
                ("📺", "Branche la Péritel", "Ajoute une console.", o.filter { $0.categorie == "consoles" }.count, 1),
                ("🔌", "Câble link", "3 accessoires ajoutés.", o.filter { $0.categorie == "accessoires" }.count, 3),
            ]),
            ("Ventes", [
                ("💰", "Première vente", "Vends ton premier article.", v.count, 1),
                ("🔥", "Combo ×5", "5 articles vendus.", v.count, 5),
                ("💥", "Super Combo", "10 articles vendus.", v.count, 10),
                ("🏆", "High Score", "25 articles vendus.", v.count, 25),
                ("🏅", "Hall of Fame", "100 articles vendus.", v.count, 100),
                ("🚀", "Vente éclair", "Vends un article moins de 7 jours après sa mise en vente.", eclair, 1),
                ("🏁", "Speedrun", "Vends un article le jour même de sa mise en vente.", v.filter { a in duree(a).map { $0 < 1 } ?? false }.count, 1),
                ("🐢", "Rien ne sert de courir", "Vends un article plus de 90 jours après sa mise en vente.", v.filter { a in duree(a).map { $0 >= 90 } ?? false }.count, 1),
                ("🤝", "Pas un centime de moins", "Vends au prix demandé (ou plus).", plein, 1),
                ("🔨", "Enchère gagnante", "Vends un article plus cher que le prix demandé.", v.filter { ($0.prixDemande ?? 0) > 0 && ($0.prixVente ?? 0) > ($0.prixDemande ?? 0) }.count, 1),
                ("🧩", "Tout en un", "Vends un lot de plusieurs articles.", lots, 1),
                ("🎁", "Pack collector", "5 lots vendus.", lots, 5),
                ("🗝️", "Trésor caché", "Vends un article estimé rare ou très rare.", v.filter { ["rare", "tres_rare"].contains($0.rareteJeu) }.count, 1),
            ]),
            ("Argent", [
                ("💶", "Cent balles", "100 € encaissés.", Int(enc), 100),
                ("🐷", "Tirelire pleine", "1 000 € encaissés.", Int(enc), 1000),
                ("🎰", "Jackpot", "5 000 € encaissés.", Int(enc), 5000),
                ("💎", "Pièce rare", "Un article vendu 100 € ou plus.", rare, 1),
                ("👑", "Big Boss", "Un article vendu 300 € ou plus.", v.filter { ($0.prixVente ?? 0) >= 300 }.count, 1),
                ("🏺", "Le Graal", "Un article vendu 500 € ou plus.", v.filter { ($0.prixVente ?? 0) >= 500 }.count, 1),
                ("🍀", "Bonne affaire", "Vends un article au moins le double de son prix d'achat.", v.filter { ($0.prixAchat ?? 0) > 0 && ($0.prixVente ?? 0) >= 2 * ($0.prixAchat ?? 0) }.count, 1),
                ("📈", "Plus-value", "500 € de bénéfice (prix d'achat et frais déduits).", benef, 500),
            ]),
            ("Colis", [
                ("📬", "Le facteur sonne", "5 ventes envoyées par la poste.", envois, 5),
                ("📮", "Postier de l'année", "25 ventes envoyées par la poste.", envois, 25),
                ("🔍", "Suivi à la trace", "5 ventes avec un numéro de suivi.", v.filter { !vide($0.suivi) }.count, 5),
                ("🏠", "Livré à bon port", "10 colis reçus par l'acheteur.", v.filter { $0.statut == "recu" }.count, 10),
                ("📍", "Rendez-vous IRL", "3 ventes remises en main propre.", v.filter { $0.remise == "main_propre" }.count, 3),
            ]),
            ("Consoles", [
                ("🍄", "64 bits", "Ajoute un jeu Nintendo 64.", n64, 1),
                ("🦔", "Sega c'est plus fort que toi", "Ajoute un article Sega.", jeuPlat("sega|mega ?drive|genesis|saturn|dreamcast|master ?system|game ?gear|mega[- ]?cd|32x"), 1),
                ("🔋", "Piles incluses", "Ajoute un article Game Boy.", jeuPlat("game ?boy|\\bgb[ac]?\\b"), 1),
                ("💿", "Génération PlayStation", "Ajoute un article PlayStation.", jeuPlat("playstation|\\bps ?[1-5]\\b|\\bpsx\\b|\\bps ?one\\b|\\bpsp\\b|\\bvita\\b"), 1),
                ("⛩️", "Import japonais", "Ajoute un article en version japonaise.", o.filter { motif($0.region, "ntsc[- ]?j|jap|\\bjp\\b") }.count, 1),
                ("🎮", "Multi-consoles", "Des articles sur 5 plateformes différentes.", plat.count, 5),
                ("⚔️", "Console war", "Des articles sur 10 plateformes différentes.", plat.count, 10),
            ]),
            ("Cartes et films", [
                ("⚡", "Attrapez-les tous", "Ajoute une carte Pokémon.", cartes, 1),
                ("🃏", "Dresseur", "10 cartes Pokémon.", cartes, 10),
                ("📕", "Pokédex complet", "151 cartes Pokémon, comme au premier jour.", cartes, 151),
                ("🛡️", "Sous coque", "Ajoute une carte gradée.", o.filter { $0.categorie == "cartes" && !vide($0.gradation) }.count, 1),
                ("🎬", "Moteur, ça tourne !", "Ajoute un film.", films, 1),
                ("📼", "Vidéoclub", "10 films dans tes articles.", films, 10),
                ("🍿", "Cinémathèque", "25 films dans tes articles.", films, 25),
            ]),
            ("Outils", [
                ("🤖", "Duo avec l'IA", "10 annonces rédigées avec l'IA.", ia, 10),
                ("🧠", "Cerveau électronique", "50 annonces rédigées avec l'IA.", ia, 50),
                ("📊", "L'Argus", "10 articles cotés.", o.filter { $0.cote != nil }.count, 10),
                ("🧾", "Comptable", "Prix d'achat renseigné sur 10 articles.", o.filter { $0.prixAchat != nil }.count, 10),
                ("👥", "Multijoueur", "Un article en ligne sur leboncoin et sur eBay.", o.filter { !vide($0.annonce) && !vide($0.annonceEbay) }.count, 1),
            ]),
            ("Temps et fidélité", [
                ("⏱️", "Maître du temps", "10 heures gagnées avec RetroRevente.", minutes / 60, 10),
                ("⌛", "Voyageur temporel", "50 heures gagnées avec RetroRevente.", minutes / 60, 50),
                ("🔁", "Continue ?", "Membre depuis un mois.", anc, 30),
                ("🗓️", "Vétéran", "Membre depuis un an.", anc, 365),
            ]),
        ]
        return g.flatMap { f in f.1.map { T(groupe: f.0, ico: $0.0, nom: $0.1, desc: $0.2, val: max(0, min($0.3, $0.4)), max: $0.4) } }
    }

    var body: some View {
        let l = Trophees.liste(appli), n = l.filter { $0.ok }.count
        VStack(spacing: 0) {
            EnTete(titre: "Ta salle des trophées", sousTitre: "\(n) trophée\(n > 1 ? "s" : "") débloqué\(n > 1 ? "s" : "") sur \(l.count)") { EmptyView() }
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 200, maximum: 280), spacing: 16, alignment: .top)], alignment: .leading, spacing: 16) {
                    ForEach(Trophees.familles, id: \.self) { f in
                        let tf = l.filter { $0.groupe == f.nom }, k = tf.filter { $0.ok }.count
                        Section {
                            ForEach(tf) { t in CarteTrophee(t: t, rang: l.firstIndex { $0.nom == t.nom } ?? 0) }
                        } header: {
                            HStack(spacing: 10) {
                                Image(systemName: f.symbole).foregroundStyle(Color.rrAccent).font(.title3)
                                Text(f.nom).font(.title3.weight(.semibold))
                                Spacer()
                                Text("\(k) / \(tf.count)").font(.callout.monospacedDigit()).foregroundStyle(k == tf.count ? AnyShapeStyle(Color.rrAccent) : AnyShapeStyle(.secondary))
                                    .padding(.horizontal, 10).padding(.vertical, 4)
                                    .background(Capsule().strokeBorder(k == tf.count ? Color.rrAccent : Color.primary.opacity(0.15)))
                            }.padding(.top, f.nom == Trophees.familles[0].nom ? 0 : 14).padding(.bottom, 2)
                        }
                    }
                }.padding(22)
            }
        }
    }
}

/// Carte d'un trophée, animée : apparition en cascade, barre qui se remplit, survol, éclat doré sur les trophées débloqués.
/// « Réduire les animations » (Réglages Système › Accessibilité) : tout s'affiche directement, sans mouvement.
struct CarteTrophee: View {
    let t: Trophees.T; let rang: Int
    @Environment(\.accessibilityReduceMotion) private var sansMouvement
    @State private var visible = false
    @State private var rempli = 0.0
    @State private var survol = false
    @State private var eclat: CGFloat = -0.6
    @State private var rebond = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(t.ico).font(.system(size: 34)).grayscale(t.ok ? 0 : 1).opacity(t.ok ? 1 : 0.45)
                    .scaleEffect(rebond ? 1.18 : 1).rotationEffect(.degrees(rebond ? -8 : 0))
                Spacer()
                if t.ok {
                    Image(systemName: "checkmark.seal.fill").foregroundStyle(Color.rrAccent).font(.title3)
                        .scaleEffect(visible ? 1 : 0.2).opacity(visible ? 1 : 0)
                }
            }
            Text(t.nom).font(.headline)
            Text(t.desc).font(.callout).foregroundStyle(.secondary).lineLimit(2, reservesSpace: true)
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.primary.opacity(0.12))
                    Capsule().fill(t.ok ? Color.rrAccent : Color.secondary)
                        .frame(width: max(t.val > 0 ? 6 : 0, g.size.width * rempli))
                }
            }.frame(height: 6)
            Text("\(t.val) / \(t.max)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
        .padding(16)
        .overlay {
            // Éclat : un reflet doré qui traverse la carte de temps en temps.
            if t.ok && !sansMouvement {
                GeometryReader { g in
                    LinearGradient(colors: [.clear, Color.white.opacity(0.28), .clear], startPoint: .leading, endPoint: .trailing)
                        .frame(width: g.size.width * 0.45).rotationEffect(.degrees(20))
                        .offset(x: g.size.width * eclat)
                }
                .clipShape(RoundedRectangle(cornerRadius: 22)).allowsHitTesting(false).blendMode(.plusLighter)
            }
        }
        .verre(RoundedRectangle(cornerRadius: 22), teinte: t.ok ? .rrAccent : nil)
        .shadow(color: (t.ok ? Color.rrAccent : Color.black).opacity(survol ? 0.35 : 0), radius: survol ? 14 : 0, y: survol ? 6 : 0)
        .scaleEffect(sansMouvement ? 1 : (visible ? (survol ? 1.03 : 1) : 0.92))
        .offset(y: sansMouvement || visible ? 0 : 18)
        .opacity(visible ? 1 : 0)
        .onHover { h in
            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) { survol = h }
            if h, t.ok, !sansMouvement {
                withAnimation(.spring(response: 0.25, dampingFraction: 0.45)) { rebond = true }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { withAnimation(.spring(response: 0.35, dampingFraction: 0.5)) { rebond = false } }
            }
        }
        .task {
            let fraction = t.max > 0 ? min(1, Double(t.val) / Double(t.max)) : 0
            if sansMouvement { visible = true; rempli = fraction; return }
            let attente = Double(min(rang, 24)) * 0.04
            withAnimation(.spring(response: 0.5, dampingFraction: 0.78).delay(attente)) { visible = true }
            withAnimation(.easeOut(duration: 0.9).delay(attente + 0.25)) { rempli = fraction }
            guard t.ok else { return }
            // Premier éclat juste après l'apparition, puis un toutes les quelques secondes, décalé d'une carte à l'autre.
            try? await Task.sleep(nanoseconds: UInt64((attente + 0.9) * 1_000_000_000))
            while !Task.isCancelled {
                eclat = -0.6
                withAnimation(.easeInOut(duration: 1.1)) { eclat = 1.3 }
                try? await Task.sleep(nanoseconds: UInt64((5.5 + Double(rang % 5) * 0.7) * 1_000_000_000))
            }
        }
    }
}

// MARK: Bilan

struct Bilan: View {
    @ObservedObject var appli: Appli
    var body: some View {
        let o = appli.articles.filter { !$0.estLot }, v = o.filter { $0.vendu }
        let encaisse = v.reduce(0) { $0 + ($1.prixVente ?? 0) }
        let net = v.reduce(0) { $0 + ($1.prixVente ?? 0) - ($1.frais ?? 0) }
        let achats = v.reduce(0) { $0 + ($1.prixAchat ?? 0) }
        let an = String(Calendar.current.component(.year, from: Date()))
        let va = v.filter { $0.dateVente.hasPrefix(an) }, mt = va.reduce(0) { $0 + ($1.prixVente ?? 0) }
        let gros = va.map { $0.prixVente ?? 0 }.max() ?? 0
        let enVente = o.filter { ["en_vente", "reserve"].contains($0.statut) }
        let stock = enVente.reduce(0) { $0 + ($1.prixDemande ?? 0) }
        return VStack(spacing: 0) {
            EnTete(titre: "Bilan des ventes", sousTitre: "\(v.count) vente\(v.count > 1 ? "s" : "") en tout") { EmptyView() }
            ScrollView {
                VStack(spacing: 16) {
                    HStack(spacing: 16) {
                        chiffre("Encaissé", Libelles.prix(encaisse), "eurosign.circle")
                        chiffre("Net (après frais)", Libelles.prix(net), "banknote")
                        chiffre("Marge", achats > 0 ? Libelles.prix(net - achats) : "—", "chart.line.uptrend.xyaxis")
                        chiffre(stock > 0 ? "En vente · \(Libelles.prix(stock)) demandés" : "En vente", "\(enVente.count) article\(enVente.count > 1 ? "s" : "")", "tag")
                    }
                    carte("Seuil fiscal \(an)", "building.columns") {
                        if appli.profil.fiscal {
                            jauge("Ventes", Double(va.count), 30, { String(Int($0)) })
                            jauge("Montant", mt, 2000, { Libelles.prix($0) })
                            jauge("Objet le plus cher", gros, 5000, { Libelles.prix($0) })
                            Text(message(Swift.max(Double(va.count) / 30, mt / 2000), gros)).font(.callout).foregroundStyle(.secondary)
                        } else {
                            Text("Avec la formule **Collectionneur**, RetroRevente suit tes ventes de l'année et **te prévient avant d'atteindre les seuils** (30 ventes ou 2 000 €).")
                                .font(.callout).foregroundStyle(.secondary)
                        }
                    }
                    carte("Dernières ventes", "list.bullet") {
                        if v.isEmpty { Text("Aucune vente pour l'instant.").foregroundStyle(.secondary) }
                        ForEach(v.sorted { $0.dateVente > $1.dateVente }.prefix(12)) { a in
                            HStack {
                                Text(a.titre).lineLimit(1)
                                Spacer()
                                Text(a.dateVente).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                                Text(Libelles.prix(a.prixVente)).font(.callout.weight(.bold).monospacedDigit()).foregroundStyle(Color.rrAccent).frame(width: 80, alignment: .trailing)
                            }
                            Divider()
                        }
                    }
                }.padding(22)
            }
        }
    }
    private func chiffre(_ nom: String, _ valeur: String, _ symbole: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: symbole).foregroundStyle(Color.rrAccent).font(.title3)
            Text(valeur).font(.system(size: 22, weight: .heavy, design: .rounded)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
            Text(nom).font(.caption).foregroundStyle(.secondary)
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading).verre(RoundedRectangle(cornerRadius: 20))
    }
    private func jauge(_ nom: String, _ v: Double, _ max: Double, _ f: (Double) -> String) -> some View {
        let r = v / max
        return VStack(alignment: .leading, spacing: 4) {
            Text("\(nom) : \(f(v)) sur \(f(max))").font(.callout)
            ProgressView(value: Swift.min(1, r)).tint(r >= 1 ? .red : r >= 0.8 ? .orange : .rrAccent)
        }
    }
    private func message(_ r: Double, _ gros: Double) -> String {
        if gros > 5000 { return "Un objet vendu plus de 5 000 € n'est plus exonéré : la plus-value éventuelle se déclare et peut être imposée. Garde la preuve de ton prix d'achat." }
        let m = r >= 1 ? "Tu as dépassé un seuil : la plateforme transmettra tes ventes aux impôts. Ce n'est pas un impôt, garde simplement trace de tes prix d'achat."
            : r >= 0.8 ? "Tu approches d'un seuil. Pas de panique : vendre tes propres affaires n'est en principe pas imposable."
            : "Tu es loin des seuils, tout va bien."
        return m + " Les 5 000 € se comptent objet par objet, pas sur l'année."
    }
}

// MARK: Cote (dans la fiche)

struct BlocCote: View {
    @ObservedObject var appli: Appli
    @Binding var article: Article
    @Binding var original: Article?
    @State private var enCours = false
    var body: some View {
        carte("Cote", "chart.line.uptrend.xyaxis") {
            if let c = article.cote {
                HStack(spacing: 12) {
                    valeur("Conseillé", c.conseille, principal: true)
                    valeur("Vente rapide", c.rapide)
                    valeur("Fourchette", nil, texte: [c.bas, c.haut].compactMap { $0 }.map { Libelles.prix($0) }.joined(separator: " – "))
                }
                if !c.resume.isEmpty { Text(c.resume).font(.callout).foregroundStyle(.secondary) }
                ForEach(c.releves, id: \.self) { r in
                    Button { if let u = URL(string: r.url) { NSWorkspace.shared.open(u) } } label: {
                        HStack {
                            Text(r.site).font(.caption.weight(.bold)).foregroundStyle(Color.rrAccent).frame(width: 90, alignment: .leading)
                            Text(r.titre).font(.caption).lineLimit(1)
                            Spacer()
                            Text(Libelles.prix(r.prix)).font(.caption.weight(.semibold).monospacedDigit())
                        }
                    }.buttonStyle(.plain)
                }
                HStack {
                    if let p = c.conseille, p != article.prixDemande {
                        Button("Prendre \(Libelles.prix(p)) comme prix") { article.prixDemande = p }.boutonVerre(principal: true)
                    }
                    Spacer()
                    Text(c.date.isEmpty ? "" : "Estimée le \(c.date)").font(.caption).foregroundStyle(.secondary)
                    bouton("Réestimer")
                }
            } else {
                Text("L'IA cherche les **ventes conclues** et les **annonces en cours** pour estimer **le bon prix**.").font(.callout).foregroundStyle(.secondary)
                bouton("Estimer la cote")
            }
        }
    }
    private func bouton(_ t: String) -> some View {
        Button {
            Task { enCours = true; if let n = await appli.estimerCote(article) { article.cote = n.cote; original?.cote = n.cote }; enCours = false }
        } label: { HStack { if enCours { ProgressView().controlSize(.small) }; Text(enCours ? "Recherche en cours…" : t) } }
        .boutonVerre().disabled(enCours || article.titre.isEmpty)
    }
    private func valeur(_ nom: String, _ x: Double?, principal: Bool = false, texte: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(texte ?? Libelles.prix(x)).font(.system(size: principal ? 24 : 18, weight: .heavy, design: .rounded)).foregroundStyle(principal ? Color.rrAccent : .primary)
            Text(nom).font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: Mon compte

struct MonCompte: View {
    @ObservedObject var appli: Appli
    @State private var pseudo = ""
    @State private var lbc = ""
    @State private var adresse = ""
    @State private var ancien = ""
    @State private var nouveau = ""
    @State private var email = ""
    @State private var mdpEmail = ""
    @State private var mdpSuppr = ""
    @State private var info = ""
    @State private var periode = "mois"
    @State private var confirmerSuppression = false
    @AppStorage("retirerDePhotos") private var retirerDePhotos = true

    var body: some View {
        VStack(spacing: 0) {
            EnTete(titre: "Mon compte", sousTitre: appli.profil.email) {
                Button(role: .destructive) { Task { await appli.deconnecter() } } label: { Label("Me déconnecter", systemImage: "rectangle.portrait.and.arrow.right") }.boutonVerre()
            }
            ScrollView {
                VStack(spacing: 16) {
                    if !info.isEmpty { Text(info).font(.callout).padding(12).frame(maxWidth: .infinity, alignment: .leading).verre(RoundedRectangle(cornerRadius: 14), teinte: .rrAccent) }
                    HStack(alignment: .top, spacing: 16) {
                        carte("Profil", "person") {
                            HStack(spacing: 14) {
                                Avatar(profil: appli.profil, taille: 64)
                                VStack(alignment: .leading, spacing: 6) {
                                    Button("Changer la photo…") { choisirAvatar() }.boutonVerre()
                                    if !appli.profil.avatar.isEmpty { Button("Retirer") { Task { _ = await appli.modifierProfil(["avatar": ""]) } }.buttonStyle(.link) }
                                }
                            }
                            TextField("Pseudo", text: $pseudo).textFieldStyle(.roundedBorder)
                            TextField("Code postal et ville (ex. 54000 Nancy)", text: $adresse).textFieldStyle(.roundedBorder)
                                .help("Remplit l'adresse de tes annonces Le Bon Coin. Seule la ville est affichée aux acheteurs.")
                            TextField("Ta page Le Bon Coin (facultatif)", text: $lbc).textFieldStyle(.roundedBorder)
                            Button("Enregistrer le profil") {
                                var c: [String: Any] = ["pseudo": pseudo, "lbc": lbc]
                                if adresse != appli.profil.adresse { c["adresse"] = adresse }
                                Task { if await appli.modifierProfil(c) { info = "Profil enregistré." } }
                            }
                                .boutonVerre(principal: true).disabled(pseudo == appli.profil.pseudo && lbc == appli.profil.lbc && adresse == appli.profil.adresse)
                            if appli.profil.adresse.isEmpty {
                                Text("Ajoute ton **code postal** et ta **ville** : ils remplissent l'adresse de tes dépôts Le Bon Coin.").font(.caption).foregroundStyle(.orange)
                            }
                        }
                        formule
                    }
                    HStack(alignment: .top, spacing: 16) {
                        carte("Adresse e-mail", "envelope") {
                            if !appli.profil.emailOk {
                                Text("Adresse **pas encore confirmée**.").font(.callout).foregroundStyle(.orange)
                                Button("Renvoyer le lien") { Task { await appli.renvoyerVerification(); info = "Lien de confirmation renvoyé." } }.buttonStyle(.link)
                            }
                            if !appli.profil.emailEnAttente.isEmpty { Text("**En attente de confirmation** : \(appli.profil.emailEnAttente)").font(.callout).foregroundStyle(.secondary) }
                            TextField("Nouvelle adresse", text: $email).textFieldStyle(.roundedBorder)
                            SecureField("Mot de passe actuel", text: $mdpEmail).textFieldStyle(.roundedBorder)
                            Button("Changer d'adresse") { Task { if let m = await appli.changerEmail(email, motdepasse: mdpEmail) { info = m; email = ""; mdpEmail = "" } } }
                                .boutonVerre().disabled(email.isEmpty || mdpEmail.isEmpty)
                        }
                        carte("Mot de passe", "key") {
                            SecureField("Mot de passe actuel", text: $ancien).textFieldStyle(.roundedBorder)
                            SecureField("Nouveau (8 caractères ou plus)", text: $nouveau).textFieldStyle(.roundedBorder)
                            Button("Changer le mot de passe") { Task { if await appli.changerMotDePasse(ancien: ancien, nouveau: nouveau) { info = "Mot de passe changé."; ancien = ""; nouveau = "" } } }
                                .boutonVerre().disabled(ancien.isEmpty || nouveau.count < 8)
                        }
                    }
                    ProfilVendeur(appli: appli, info: $info)
                    carte("Le Bon Coin", "bolt.fill") {
                        let branche = !(Stockage.partage.texte("cle") ?? "").isEmpty
                        Text(branche ? LocalizedStringKey("**Branché** : remplissage du dépôt et réponses IA aux acheteurs actifs.") : "Pas encore branché.").font(.callout)
                        Button(branche ? "Rebrancher" : "Brancher maintenant") { Task { await appli.brancherLeBonCoin(force: true); info = "Le Bon Coin est branché." } }.boutonVerre()
                    }
                    carte("App Photos", "photo.on.rectangle.angled") {
                        Toggle("Retirer de Photos les photos d'un article, une fois son annonce publiée", isOn: $retirerDePhotos)
                        Text("Seulement **à la fin, une fois l'annonce publiée** sur Le Bon Coin. macOS te demande de confirmer, et la photo reste **30 jours** dans « Supprimés récemment ».")
                            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    carte("Supprimer mon compte", "trash") {
                        Text("Tes articles et tes photos seront **effacés définitivement**.").font(.callout).foregroundStyle(.secondary)
                        HStack {
                            SecureField("Mot de passe", text: $mdpSuppr).textFieldStyle(.roundedBorder).frame(maxWidth: 260)
                            Button("Supprimer mon compte", role: .destructive) { confirmerSuppression = true }.boutonVerre().disabled(mdpSuppr.isEmpty)
                        }
                    }
                }.padding(22)
            }
        }
        .onAppear { pseudo = appli.profil.pseudo; lbc = appli.profil.lbc; adresse = appli.profil.adresse
            Task { try? await appli.chargerProfil(); pseudo = appli.profil.pseudo; lbc = appli.profil.lbc; adresse = appli.profil.adresse } }
        .confirmationDialog("Supprimer définitivement ton compte RetroRevente ?", isPresented: $confirmerSuppression) {
            Button("Supprimer", role: .destructive) { Task { _ = await appli.supprimerCompte(motdepasse: mdpSuppr) } }
        }
    }

    private var formule: some View {
        carte("Formule", "crown") {
            HStack {
                Text(appli.profil.formule).font(.system(size: 22, weight: .heavy, design: .rounded))
                Spacer()
                if !appli.profil.abonnement.isEmpty { Text(appli.profil.resiliation ? "Résiliée" : "Active").font(.caption.weight(.bold)).padding(.horizontal, 8).padding(.vertical, 4).background(appli.profil.resiliation ? Color.orange : Color.green, in: Capsule()).foregroundColor(.white) }
            }
            if let m = appli.profil.quotaMax {
                Text("Articles ce mois-ci : \(appli.profil.quotaUtilise) sur \(m)").font(.callout)
                ProgressView(value: Double(min(appli.profil.quotaUtilise, m)), total: Double(max(m, 1))).tint(.rrAccent)
            } else { Text("Articles illimités · \(appli.profil.quotaUtilise) ce mois-ci").font(.callout).foregroundStyle(.secondary) }
            if !appli.profil.finAbonnement.isEmpty { Text("Période en cours jusqu'au \(String(appli.profil.finAbonnement.prefix(10)))").font(.caption).foregroundStyle(.secondary) }
            Divider()
            if appli.profil.formuleId == "gratuit" || appli.profil.formuleId == "vendeur" {
                Picker("", selection: $periode) { Text("Au mois").tag("mois"); Text("À l'année").tag("an") }.pickerStyle(.segmented).labelsHidden()
                HStack {
                    if appli.profil.formuleId == "gratuit" { Button("Vendeur") { Task { await appli.payer(offre: "vendeur", periode: periode) } }.boutonVerre() }
                    Button("Collectionneur") { Task { await appli.payer(offre: "collectionneur", periode: periode) } }.boutonVerre(principal: true)
                    Button("Pass Grand ménage") { Task { await appli.payer(offre: "pass", periode: periode) } }.boutonVerre()
                }
                Text("Le paiement se fait sur la **page sécurisée de Stripe**.").font(.caption).foregroundStyle(.secondary)
            }
            if appli.profil.client { Button("Gérer mon abonnement et mes factures") { Task { await appli.portail() } }.boutonVerre() }
        }
    }

    private func choisirAvatar() {
        let o = NSOpenPanel(); o.allowedContentTypes = [.image]
        guard o.runModal() == .OK, let u = o.url, let i = NSImage(contentsOf: u), let d = jpegData(i, max: 256, poids: 110_000) else { return }
        Task { if await appli.modifierProfil(["avatar": d]) { info = "Photo de profil changée." } }
    }
}


/// « Mon profil de vendeur », comme sur le site (même champ « vendeur » du compte) : l'IA s'en sert pour les réponses
/// aux acheteurs (ton, négociation, main propre ou envoi) et pour le prix plancher des offres.
struct ProfilVendeur: View {
    @ObservedObject var appli: Appli
    @Binding var info: String
    @State private var choix: [String: String] = [:]
    @State private var note = ""
    private static let questions: [(cle: String, titre: String, symbole: String, options: [(String, String)])] = [
        ("rythme", "Ton rythme", "hourglass", [("patient", "Patient, j'attends le bon prix"), ("equilibre", "Entre les deux"), ("rapide", "Besoin de vendre vite")]),
        ("remise", "Pour la remise", "hand.raised", [("main_propre", "Main propre de préférence"), ("les_deux", "Les deux me vont"), ("envoi", "Envoi de préférence")]),
        ("echanges", "Les échanges", "arrow.left.arrow.right", [("oui", "Ouvert aux échanges"), ("non", "Pas d'échange, vente seulement")]),
        ("prix", "Tes prix", "tag", [("souple", "Je négocie volontiers"), ("raisonnable", "Un petit geste, pas plus"), ("ferme", "Prix ferme, pas de marchandage")]),
        ("ton", "Le ton de tes messages", "bubble.left", [("diplomate", "Très diplomate et affable"), ("chaleureux", "Chaleureux et passionné"), ("direct", "Direct et efficace"), ("humour", "Avec une touche d'humour")]),
    ]
    private var modifie: Bool {
        var a = appli.profil.vendeur; a["note"] = nil
        return a != choix || note != (appli.profil.vendeur["note"] ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label { Text("Mon profil de vendeur").font(.headline) } icon: { Image(systemName: "person.text.rectangle").foregroundStyle(Color.rrAccent) }
            Label { Text("L'IA s'en sert pour te proposer des **réponses aux acheteurs qui te ressemblent** : ton ton, ta façon de négocier, la main propre ou l'envoi.") }
                icon: { Image(systemName: "sparkles").foregroundStyle(Color.rrAccent) }
                .font(.callout).padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.rrAccent.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
            ForEach(Self.questions, id: \.cle) { q in
                VStack(alignment: .leading, spacing: 8) {
                    Label { Text(q.titre).font(.subheadline.weight(.semibold)) } icon: { Image(systemName: q.symbole).foregroundStyle(.secondary) }
                    HStack(spacing: 8) {
                        ForEach(q.options, id: \.0) { o in
                            let pris = choix[q.cle] == o.0
                            Button { choix[q.cle] = pris ? nil : o.0 } label: {
                                Label { Text(o.1) } icon: { if pris { Image(systemName: "checkmark") } }
                                    .font(.callout.weight(pris ? .semibold : .regular))
                                    .padding(.horizontal, 12).padding(.vertical, 7)
                                    .foregroundStyle(pris ? Color.white : Color.primary)
                                    .background(Capsule().fill(pris ? Color.rrAccent : Color.primary.opacity(0.06)))
                            }.buttonStyle(.plain)
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("**Autre chose que l'IA doit savoir ?** (facultatif)").font(.subheadline)
                TextField("ex. Pas d'envoi le dimanche, rendez-vous possible à la gare de Metz", text: $note, axis: .vertical)
                    .lineLimit(2...4).textFieldStyle(.roundedBorder)
            }
            Button("Enregistrer mon profil") {
                var v: [String: Any] = choix; v["note"] = note
                Task { if await appli.modifierProfil(["vendeur": v]) { info = "Profil de vendeur enregistré : l'IA en tient compte dans ses réponses."; lire() } }
            }.boutonVerre(principal: true).disabled(!modifie)
        }
        .padding(18).frame(maxWidth: .infinity, alignment: .leading).verre(RoundedRectangle(cornerRadius: 22))
        .onAppear(perform: lire)
        .onChange(of: appli.profil) { _ in lire() }
    }
    private func lire() { var a = appli.profil.vendeur; note = a["note"] ?? ""; a["note"] = nil; choix = a }
}
