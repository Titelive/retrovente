import SwiftUI
import AppKit
import PhotosUI

// MARK: Accueil : comme l'accueil du site (raccourcis d'ajout, lots à effacer, chiffres, graphique des ventes)

/// Temps gagné : minutes économisées par étape (valeurs du site, réglables dans « Voir le calcul »).
enum TempsGagne {
    static let cles = ["photos", "texte", "prix", "lbc", "suivi"]
    static let defaut: [String: Int] = ["photos": 3, "texte": 4, "prix": 4, "lbc": 2, "suivi": 1]
    static let libelles: [String: (String, String)] = [
        "photos": ("Photos", "retouche et recadrage, par article photographié"),
        "texte": ("Texte de l'annonce", "titre et description, par article"),
        "prix": ("Recherche du prix", "par article dont la cote a été estimée"),
        "lbc": ("Publication", "saisie sur Le Bon Coin, une fois par article mis en vente"),
        "suivi": ("Suivi des ventes", "par article vendu"),
    ]
    static var minutes: [String: Int] {
        get {
            let d = UserDefaults.standard.dictionary(forKey: "tempsGagne") as? [String: Int] ?? [:]
            return defaut.merging(d.mapValues { max(0, min(120, $0)) }) { _, n in n }
        }
        set { UserDefaults.standard.set(newValue, forKey: "tempsGagne") }
    }
    /// Nombre d'articles concernés par chaque étape (même calcul que le site).
    static func etapes(_ appli: Appli) -> [String: Int] {
        let o = appli.articles
        return ["photos": o.filter { !$0.photos.isEmpty }.count,
                "texte": o.filter { $0.ia || !$0.texteAnnonce.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.count,
                "prix": o.filter { $0.cote != nil }.count,
                "lbc": min(appli.profil.usageLbc, o.filter { $0.statut != "retire" || $0.publiee }.count),
                "suivi": o.filter { $0.vendu }.count]
    }
    static func total(_ appli: Appli) -> Int {
        let e = etapes(appli), m = minutes
        return cles.reduce(0) { $0 + (e[$1] ?? 0) * (m[$1] ?? 0) }
    }
    /// « 5 h 23 », « 42 min »
    static func hm(_ m: Int) -> String {
        if m < 60 { return "\(m) min" }
        let r = m % 60
        return "\(m / 60) h" + (r > 0 ? " " + String(format: "%02d", r) : "")
    }
}

struct AccueilTableau: View {
    @ObservedObject var appli: Appli
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Raccourcis(appli: appli)
            LotsAEffacer(appli: appli)
            Tuiles(appli: appli)
            if !appli.articles.filter({ !$0.estLot }).isEmpty { GraphiqueVentes(appli: appli) }
        }
    }
}

// MARK: Raccourcis d'ajout

private struct Raccourcis: View {
    @ObservedObject var appli: Appli
    var body: some View {
        HStack(spacing: 10) {
            Button { appli.nouveauMode = ""; appli.nouveauOuvert = true } label: { Label("Ajouter en photo", systemImage: "camera") }
                .boutonVerre(principal: true).controlSize(.large).help("Une photo : l'IA reconnaît l'article et remplit la fiche")
            Button { appli.cartesOuvert = true } label: { Label("Plusieurs cartes Pokémon", systemImage: "rectangle.stack") }
                .boutonVerre().controlSize(.large).help("Une photo d'une page de classeur ou de cartes étalées")
            Button { appli.nouveauMode = "film"; appli.nouveauOuvert = true } label: { Label("Un film", systemImage: "film") }
                .boutonVerre().controlSize(.large).help("Blu-Ray, Blu-Ray 4K UHD ou DVD : une photo de la jaquette")
            Button { appli.nouveauMode = "main"; appli.nouveauOuvert = true } label: { Label("Saisir à la main", systemImage: "square.and.pencil") }
                .boutonVerre().controlSize(.large)
            Spacer(minLength: 0)
        }
    }
}

// MARK: Annonces de lots à effacer

private struct LotsAEffacer: View {
    @ObservedObject var appli: Appli
    @State private var enCours: Set<String> = []
    private static let mesAnnonces = URL(string: "https://www.leboncoin.fr/compte/part/mes-annonces")!
    var body: some View {
        let l = appli.articles.flatMap { a in a.lotsAEffacer.map { (art: a, e: $0) } }
        if !l.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("🗑️ " + (l.count > 1 ? "\(l.count) annonces de lots à effacer" : "Une annonce de lot à effacer")).font(.title3.weight(.heavy))
                (Text("Ces lots proposent encore un article vendu. ") + Text(l.count > 1 ? "Supprime leurs annonces" : "Supprime son annonce").bold()
                    + Text(" sur Le Bon Coin et eBay pour ne pas le vendre deux fois."))
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                VStack(spacing: 0) {
                    ForEach(Array(l.enumerated()), id: \.offset) { i, x in
                        if i > 0 { Divider() }
                        ligne(x.art, x.e)
                    }
                }
                .padding(.horizontal, 14).background(.background.opacity(0.55), in: RoundedRectangle(cornerRadius: 14))
            }
            .padding(18).frame(maxWidth: .infinity, alignment: .leading)
            .background(LinearGradient(colors: [Color.rrOr.opacity(0.22), Color.rrOr.opacity(0.08)], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(Color.rrOr.opacity(0.55), lineWidth: 1.5))
            .transition(.opacity.combined(with: .move(edge: .top)))
        }
    }
    private func ligne(_ art: Article, _ e: LotAEffacer) -> some View {
        let lot = appli.articles.first { $0.id == e.id }
        let lbc = e.annonce.isEmpty ? (lot?.annonce ?? "") : e.annonce
        let eb = e.annonceEbay.isEmpty ? (lot?.annonceEbay ?? "") : e.annonceEbay
        let reste: Text = {
            guard let lot = lot, !e.defait else { return Text("Le lot est défait : son annonce est à supprimer.") }
            let n = lot.membres?.count ?? 0
            return Text("Le lot garde \(n) article\(n > 1 ? "s" : "")" + (lot.prixDemande.map { " à " + Libelles.prix($0) } ?? "") + " : supprime l'annonce, puis republie-le si tu veux.")
        }()
        let cle = art.id + "/" + e.id
        return HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text(e.titre.isEmpty ? "Lot" : e.titre).font(.callout.weight(.bold)).lineLimit(1)
                (Text("Contient ") + Text(art.titre).bold() + Text(", vendu. ") + reste)
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Button(lbc.isEmpty ? "Mes annonces" : "Le Bon Coin") {
                appli.fenetre?.ouvrir(URL(string: lbc) ?? LotsAEffacer.mesAnnonces)
            }.boutonVerre().help(lbc.isEmpty ? "Ouvrir mes annonces sur Le Bon Coin" : "Ouvrir l'annonce du lot sur Le Bon Coin")
            if let u = URL(string: eb), !eb.isEmpty {
                Button("eBay") { NSWorkspace.shared.open(u) }.boutonVerre().help("Ouvrir l'annonce du lot sur eBay")
            }
            if let lot = lot, !e.defait {
                Button("Voir le lot") { appli.selection = lot.id }.boutonVerre()
            }
            Button {
                enCours.insert(cle)
                Task { await appli.lotEfface(article: art.id, lot: e.id); enCours.remove(cle) }
            } label: { Label("C'est fait", systemImage: "checkmark") }
                .boutonVerre(principal: true).disabled(enCours.contains(cle))
        }
        .controlSize(.small).padding(.vertical, 11)
    }
}

// MARK: Chiffres

private struct Tuiles: View {
    @ObservedObject var appli: Appli
    @State private var calcul = false
    var body: some View {
        let o = appli.articles.filter { !$0.estLot }, v = o.filter { $0.vendu }
        let enVente = o.filter { ["en_vente", "reserve"].contains($0.statut) }.count
        let enc = v.reduce(0) { $0 + ($1.prixVente ?? 0) }
        HStack(spacing: 14) {
            Button { calcul = true } label: {
                tuile("Temps gagné", TempsGagne.hm(TempsGagne.total(appli)), "timer", accent: true) {
                    Text("Voir le calcul").font(.caption.weight(.semibold)).foregroundStyle(Color.rrOr).underline()
                }
            }
            .buttonStyle(.plain).help("Le temps que RetroRevente t'a fait gagner, étape par étape")
            .popover(isPresented: $calcul, arrowEdge: .bottom) { CalculTemps(appli: appli) }
            tuile("En vente", "\(enVente)", "tag") { EmptyView() }
            tuile("Vendus", "\(v.count)", "checkmark.seal") { EmptyView() }
            tuile("Encaissé", Libelles.prix(enc.rounded()), "eurosign.circle") { EmptyView() }
        }
    }
    private func tuile<P: View>(_ nom: String, _ valeur: String, _ symbole: String, accent: Bool = false, @ViewBuilder pied: () -> P) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: symbole).foregroundStyle(Color.rrOr)
                Text(nom.uppercased()).font(.system(size: 10, weight: .heavy, design: .monospaced)).tracking(1.1).foregroundStyle(.secondary)
            }
            Chiffre(texte: valeur)
            pied()
        }
        .padding(16).frame(maxWidth: .infinity, minHeight: 104, alignment: .topLeading)
        .verre(RoundedRectangle(cornerRadius: 20), teinte: accent ? Color.rrOr.opacity(0.18) : nil, interactif: accent)
    }
}

/// Chiffre qui défile quand il change (macOS 14 et plus).
private struct Chiffre: View {
    let texte: String
    var body: some View {
        let t = Text(texte).font(.system(size: 28, weight: .heavy, design: .rounded)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
        if #available(macOS 14.0, *) { t.contentTransition(.numericText()).animation(.snappy, value: texte) } else { t }
    }
}

private struct CalculTemps: View {
    @ObservedObject var appli: Appli
    @State private var m = TempsGagne.minutes
    var body: some View {
        let e = TempsGagne.etapes(appli)
        let tot = TempsGagne.cles.reduce(0) { $0 + (e[$1] ?? 0) * (m[$1] ?? 0) }
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Temps gagné").font(.title3.weight(.heavy))
                Text("Ce que tu aurais passé à la main, étape par étape. Ajuste les minutes à ta façon de faire.").font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            VStack(spacing: 10) {
                ForEach(TempsGagne.cles, id: \.self) { k in
                    let lib = TempsGagne.libelles[k]!
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(lib.0).font(.callout.weight(.bold))
                            Text("\(e[k] ?? 0) × \(lib.1)").font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 8)
                        Stepper(value: Binding(get: { m[k] ?? 0 }, set: { m[k] = $0; TempsGagne.minutes = m }), in: 0...120) {
                            Text("\(m[k] ?? 0) min").font(.callout.monospacedDigit())
                        }.fixedSize()
                        Text(TempsGagne.hm((e[k] ?? 0) * (m[k] ?? 0))).font(.callout.weight(.bold).monospacedDigit()).frame(width: 64, alignment: .trailing)
                    }
                }
            }
            Divider()
            HStack {
                Button("Valeurs d'origine") { m = TempsGagne.defaut; TempsGagne.minutes = m }.buttonStyle(.link)
                Spacer()
                Text("Total").foregroundStyle(.secondary)
                Text(TempsGagne.hm(tot)).font(.title3.weight(.heavy).monospacedDigit()).foregroundStyle(Color.rrOr)
            }
        }
        .padding(20).frame(width: 470)
        .onDisappear { appli.objectWillChange.send() }
    }
}

// MARK: Graphique « Mes ventes »

private struct MoisVentes: Identifiable {
    let id: String; let mois: Int; let annee: Int
    var enc = 0.0, ben = 0.0, nb = 0, sansAchat = 0
    var objets: [Article] = []
    func valeur(_ m: String) -> Double { m == "enc" ? enc : m == "ben" ? ben : Double(nb) }
}

private struct GraphiqueVentes: View {
    @ObservedObject var appli: Appli
    @AppStorage("ventesMesure") private var mesure = "enc"
    @AppStorage("ventesPeriode") private var periode = 12
    @State private var survol: Int? = nil
    @State private var pousse: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var sansMouvement
    private static let noms = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]

    private func donnees(_ n: Int) -> (mois: [MoisVentes], avant: [MoisVentes], sansDate: Int, sansAchat: Int) {
        let cal = Calendar(identifier: .gregorian), auj = Date()
        var mois: [MoisVentes] = [], idx: [String: Int] = [:]
        for i in stride(from: 2 * n - 1, through: 0, by: -1) {
            guard let d = cal.date(byAdding: .month, value: -i, to: auj) else { continue }
            let c = cal.dateComponents([.year, .month], from: d), k = String(format: "%04d-%02d", c.year!, c.month!)
            idx[k] = mois.count; mois.append(MoisVentes(id: k, mois: c.month! - 1, annee: c.year!))
        }
        var sansDate = 0
        for o in appli.articles where !o.estLot && o.vendu {
            guard o.dateVente.count >= 7 else { sansDate += 1; continue }
            guard let i = idx[String(o.dateVente.prefix(7))] else { continue }
            let pv = o.prixVente ?? 0
            mois[i].enc += pv; mois[i].nb += 1; mois[i].objets.append(o)
            mois[i].ben += pv - (o.frais ?? 0) - (o.prixAchat ?? 0)
            if o.prixAchat == nil { mois[i].sansAchat += 1 }
        }
        let cur = Array(mois.suffix(n))
        return (cur, Array(mois.prefix(n)), sansDate, cur.reduce(0) { $0 + $1.sansAchat })
    }
    private func fmt(_ v: Double) -> String { mesure == "nb" ? String(Int(v)) : (v < 0 ? "−" : "") + Libelles.prix(abs(v).rounded()) }
    private func court(_ v: Double) -> String {
        if mesure == "nb" { return String(Int(v)) }
        let a = abs(v), s = v < 0 ? "−" : ""
        return a >= 1000 ? s + String(format: "%.1f", a / 1000).replacingOccurrences(of: ".", with: ",").replacingOccurrences(of: ",0", with: "") + " k€" : s + "\(Int(a.rounded())) €"
    }
    private func pas(_ max: Double) -> Double {
        guard max > 0 else { return 1 }
        let e = pow(10, floor(log10(max / 4)))
        for c in [1, 2, 2.5, 5, 10] where max / (c * e) <= 4 { return c * e }
        return 10 * e
    }

    var body: some View {
        let D = donnees(periode), mois = D.mois, vals = mois.map { $0.valeur(mesure) }
        let tot = vals.reduce(0, +), totAv = D.avant.reduce(0) { $0 + $1.valeur(mesure) }, nbTot = mois.reduce(0) { $0 + $1.nb }
        let sans = nbTot == 0
        let hi = sans ? 4 : max(0, vals.max() ?? 0), lo = sans ? 0 : min(0, vals.min() ?? 0)
        let p0 = pas(max(hi, -lo, mesure == "nb" ? 1 : 10)), p = mesure == "nb" ? max(1, p0.rounded()) : p0
        let haut = max(p, ceil(hi / p) * p), bas = lo < 0 ? floor(lo / p) * p : 0, etendue = haut - bas
        let graduations = Array(stride(from: bas, through: haut + 1e-9, by: p))
        let maxI = vals.indices.max { vals[$0] < vals[$1] }
        let iEtiq: Int? = maxI.flatMap { j in !sans && vals[j] > 0 && (mesure != "nb" || vals[j] > 1) ? j : nil }

        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Label("MES VENTES", systemImage: "chart.bar.xaxis").font(.system(size: 10, weight: .heavy, design: .monospaced)).tracking(1.2).foregroundStyle(.secondary)
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Chiffre(texte: mesure == "nb" ? "\(nbTot) vente\(nbTot > 1 ? "s" : "")" : fmt(tot))
                        if totAv > 0 && nbTot > 0 {
                            let pc = Int(((tot - totAv) / totAv * 100).rounded())
                            HStack(spacing: 3) {
                                if pc != 0 { Image(systemName: pc > 0 ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill").font(.system(size: 8)) }
                                Text((pc > 0 ? "+" : pc < 0 ? "−" : "") + "\(abs(pc)) %").font(.caption.weight(.bold).monospacedDigit())
                            }
                            .foregroundStyle(pc > 0 ? Color.green : pc < 0 ? Color.red : Color.secondary)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background((pc > 0 ? Color.green : pc < 0 ? Color.red : Color.secondary).opacity(0.14), in: Capsule())
                            .help("Par rapport aux \(periode) mois d'avant (\(fmt(totAv)))")
                        }
                    }
                    Text((mesure == "enc" ? "encaissés " : mesure == "ben" ? "de bénéfice " : "") + "sur les \(periode) derniers mois").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 8) {
                    Picker("", selection: $mesure) { Text("Encaissé").tag("enc"); Text("Bénéfice").tag("ben"); Text("Ventes").tag("nb") }
                        .pickerStyle(.segmented).labelsHidden().fixedSize()
                    Picker("", selection: $periode) { Text("6 mois").tag(6); Text("12 mois").tag(12) }
                        .pickerStyle(.segmented).labelsHidden().fixedSize()
                }
            }
            // Barres : une par mois, le mois en cours en couleur ; au survol, le détail du mois.
            GeometryReader { g in
                let axe: CGFloat = 44, H = g.size.height - 22, W = g.size.width - axe
                let y = { (v: Double) -> CGFloat in H - CGFloat((v - bas) / etendue) * H }
                let lc = W / CGFloat(max(1, mois.count))
                ZStack(alignment: .topLeading) {
                    ForEach(graduations, id: \.self) { t in
                        Rectangle().fill(t == 0 ? Color.secondary.opacity(0.45) : Color.secondary.opacity(0.14))
                            .frame(width: W, height: t == 0 ? 1.2 : 1).offset(x: axe, y: y(t))
                        if !sans {
                            Text(court(t)).font(.system(size: 10).monospacedDigit()).foregroundStyle(.secondary)
                                .frame(width: axe - 8, alignment: .trailing).offset(y: y(t) - 7)
                        }
                    }
                    HStack(spacing: 0) {
                        ForEach(Array(mois.enumerated()), id: \.offset) { i, x in
                            Colonne(i: i, mois: x, valeur: sans ? [1.4, 2.2, 1.8, 3, 2.6, 3.4, 2.4, 3.1, 2.8, 3.6, 3, 3.8][(i + 12 - periode) % 12] : x.valeur(mesure),
                                    etiquette: i == iEtiq ? court(vals[i]) : nil,
                                    cours: i == mois.count - 1, sans: sans, actif: survol == i, zero: y(0), echelle: H / CGFloat(etendue), H: H, largeur: lc,
                                    pousse: pousse, sansMouvement: sansMouvement)
                            .onHover { dans in if !sans { survol = dans ? i : (survol == i ? nil : survol) } }
                        }
                    }
                    .offset(x: axe)
                    if let i = survol, i < mois.count {
                        let x = mois[i], xc = axe + lc * (CGFloat(i) + 0.5)
                        Bulle(titre: GraphiqueVentes.noms[x.mois] + " \(x.annee)", m: x, mesure: mesure, cours: i == mois.count - 1, fmt: { v in (v < 0 ? "−" : "") + Libelles.prix(abs(v).rounded()) })
                            .fixedSize()
                            .alignmentGuide(.leading) { d in xc + lc / 2 + 8 + d.width > g.size.width ? -(xc - lc / 2 - 8 - d.width) : -(xc + lc / 2 + 8) }
                            .allowsHitTesting(false)
                            .transition(.opacity)
                    }
                }
            }
            .frame(height: 230)
            .overlay {
                if sans {
                    VStack(spacing: 4) {
                        Text("Ton premier graphique arrive").font(.callout.weight(.bold))
                        Text("Passe un article en « Vendu » avec sa date : tes ventes s'afficheront ici, mois par mois.").font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    }
                    .padding(16).frame(maxWidth: 340).verre(RoundedRectangle(cornerRadius: 16))
                }
            }
            let notes = [mesure == "ben" && D.sansAchat > 0 ? "\(D.sansAchat) " + (D.sansAchat > 1 ? "ventes sans prix d'achat sont comptées" : "vente sans prix d'achat est comptée") + " comme si l'article ne t'avait rien coûté." : nil,
                         D.sansDate > 0 ? "\(D.sansDate) " + (D.sansDate > 1 ? "ventes sans date de vente ne sont pas dans le graphique." : "vente sans date de vente n'est pas dans le graphique.") : nil].compactMap { $0 }
            if !notes.isEmpty { Text(notes.joined(separator: " ")).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
        .padding(20).frame(maxWidth: .infinity, alignment: .leading)
        .verre(RoundedRectangle(cornerRadius: 24))
        .animation(.easeOut(duration: 0.15), value: survol)
        .onAppear { relancer() }
        .onChange(of: mesure) { _ in relancer() }
        .onChange(of: periode) { _ in relancer() }
    }
    private func relancer() {
        if sansMouvement { pousse = 1; return }
        var t = Transaction(); t.disablesAnimations = true
        withTransaction(t) { pousse = 0 }
        DispatchQueue.main.async { pousse = 1 }
    }
}

/// Une colonne du graphique : la barre du mois (vers le bas si négative) et son nom.
private struct Colonne: View {
    let i: Int; let mois: MoisVentes; let valeur: Double; let etiquette: String?
    let cours: Bool; let sans: Bool; let actif: Bool
    let zero: CGFloat; let echelle: CGFloat; let H: CGFloat; let largeur: CGFloat
    let pousse: CGFloat; let sansMouvement: Bool
    private static let courts = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]
    private var style: AnyShapeStyle {
        if sans { return AnyShapeStyle(Color.secondary.opacity(0.13)) }
        if valeur < 0 { return AnyShapeStyle(Color.red.opacity(0.75)) }
        if cours { return AnyShapeStyle(LinearGradient(colors: [.rrOr, Color.rrOr.opacity(0.75)], startPoint: .top, endPoint: .bottom)) }
        return AnyShapeStyle(Color.rrOr.opacity(actif ? 0.7 : 0.42))
    }
    var body: some View {
        let h = abs(CGFloat(valeur) * echelle) * pousse
        let lib = Colonne.courts[mois.mois] + (mois.mois == 0 && i > 0 ? " " + String(String(mois.annee).suffix(2)) : "")
        VStack(spacing: 0) {
            ZStack(alignment: .top) {
                Color.clear
                if valeur != 0 {
                    RoundedRectangle(cornerRadius: 5, style: .continuous).fill(style)
                        .frame(width: min(34, largeur * 0.62), height: max(h, 2))
                        .offset(y: valeur >= 0 ? zero - h : zero)
                        .animation(sansMouvement ? nil : .spring(response: 0.55, dampingFraction: 0.78).delay(Double(i) * 0.035), value: pousse)
                }
                if let t = etiquette {
                    Text(t).font(.system(size: 10, weight: .bold).monospacedDigit())
                        .offset(y: zero - h - 16).opacity(Double(pousse))
                        .animation(sansMouvement ? nil : .easeOut.delay(Double(i) * 0.035 + 0.3), value: pousse)
                }
            }
            .frame(height: H)
            Text(lib).font(.system(size: 10, weight: cours ? .bold : .regular)).foregroundStyle(cours ? Color.primary : Color.secondary)
                .lineLimit(1).minimumScaleFactor(0.7).frame(height: 22)
        }
        .frame(width: largeur)
        .contentShape(Rectangle())
    }
}

/// Détail d'un mois au survol : ses ventes en photo, l'encaissé, le bénéfice et le nombre d'articles.
private struct Bulle: View {
    let titre: String; let m: MoisVentes; let mesure: String; let cours: Bool; let fmt: (Double) -> String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(titre.prefix(1).uppercased() + titre.dropFirst()).font(.callout.weight(.heavy))
            let l = m.objets.sorted { ($0.prixVente ?? 0) > ($1.prixVente ?? 0) }
            ForEach(l.prefix(3)) { o in
                HStack(spacing: 8) {
                    Text(o.titre.isEmpty ? "Sans titre" : o.titre).font(.caption).lineLimit(1).frame(maxWidth: 170, alignment: .leading)
                    Spacer(minLength: 6)
                    Text(fmt(o.prixVente ?? 0)).font(.caption.weight(.semibold).monospacedDigit())
                }
            }
            if l.count > 3 { Text("et \(l.count - 3) autre\(l.count - 3 > 1 ? "s" : "")").font(.caption2).foregroundStyle(.secondary) }
            if !l.isEmpty { Divider() }
            rang("enc", "Encaissé", fmt(m.enc)); rang("ben", "Bénéfice", fmt(m.ben)); rang("nb", "Articles vendus", "\(m.nb)")
            if cours { Text("Mois en cours").font(.caption2).foregroundStyle(.secondary) }
        }
        .padding(12).frame(minWidth: 200)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.secondary.opacity(0.2)))
        .shadow(color: .black.opacity(0.18), radius: 12, y: 4)
    }
    private func rang(_ k: String, _ nom: String, _ v: String) -> some View {
        HStack { Text(nom); Spacer(minLength: 12); Text(v).monospacedDigit() }
            .font(.caption.weight(mesure == k ? .bold : .regular)).foregroundStyle(mesure == k ? Color.rrOr : Color.primary)
    }
}

// MARK: Plusieurs cartes Pokémon sur une photo

/// Comme sur le site : l'IA repère chaque carte et TCGdex donne sa cote. Celles qui valent 5 € ou plus ont leur propre fiche
/// (photo recadrée sur la carte), les autres partent dans une fiche « Lot de N cartes ». Un clic change le tri.
struct CartesPhoto: View {
    @ObservedObject var appli: Appli
    @Environment(\.dismiss) private var fermer
    @State private var image: NSImage? = nil
    @State private var etape = 0          // 0 : photo, 1 : analyse, 2 : liste, 3 : création
    @State private var cartes: [[String: Any]] = []
    @State private var lot: [String: Any]? = nil
    @State private var message = ""
    @State private var cible = false
    @State private var photosOuvert = false
    @State private var choixPhoto: PhotosPickerItem? = nil

    var body: some View {
        let seules = cartes.filter { $0["seule"] as? Bool == true }.count, n = seules + (lot == nil ? 0 : 1)
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Plusieurs cartes Pokémon").font(.title2.weight(.bold))
                Spacer()
                Button("Annuler") { fermer() }.keyboardShortcut(.cancelAction)
            }
            if etape < 2 {
                ZStack {
                    RoundedRectangle(cornerRadius: 26).strokeBorder(style: StrokeStyle(lineWidth: 2, dash: [8, 6])).foregroundStyle(cible ? Color.rrOr : Color.secondary.opacity(0.4))
                    if let i = image { Image(nsImage: i).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 18)).padding(14).opacity(0.6) }
                    else {
                        VStack(spacing: 12) {
                            Image(systemName: "rectangle.stack").font(.system(size: 52, weight: .light)).foregroundStyle(Color.rrOr)
                            Text("Glisse une photo de tes cartes ici").font(.title3.weight(.semibold))
                            Text("Une page de classeur ou des cartes étalées : je repère chaque carte et je cherche sa cote.").foregroundStyle(.secondary).multilineTextAlignment(.center)
                            HStack(spacing: 10) {
                                Button { photosOuvert = true } label: { Label("Depuis Photos…", systemImage: "photo.on.rectangle.angled") }.boutonVerre(principal: true).controlSize(.large)
                                Button { choisir() } label: { Label("Un fichier…", systemImage: "folder") }.boutonVerre().controlSize(.large)
                            }
                        }.padding(.horizontal, 30)
                    }
                    if etape == 1 {
                        VStack(spacing: 10) {
                            ProgressView().controlSize(.large)
                            Text("Je repère chaque carte et je cherche sa cote…").font(.headline)
                            Text("Jusqu'à une minute").font(.caption).foregroundStyle(.secondary)
                        }.padding(24).verre(RoundedRectangle(cornerRadius: 22))
                    }
                }
                .frame(height: 360)
                .onDrop(of: [.fileURL, .image], isTargeted: $cible) { p in
                    guard let f = p.first else { return false }
                    Task { if let i = await imageDe(f) { analyser(i) } }
                    return true
                }
                .photosPicker(isPresented: $photosOuvert, selection: $choixPhoto, matching: .images, preferredItemEncoding: .automatic, photoLibrary: .shared())
                .onChange(of: choixPhoto) { it in
                    guard let it = it else { return }
                    choixPhoto = nil
                    Task { if let d = try? await it.loadTransferable(type: Data.self), let i = NSImage(data: d) { analyser(i) } else { message = "Photo illisible." } }
                }
            } else {
                Text("\(cartes.count) carte\(cartes.count > 1 ? "s" : "") repérée\(cartes.count > 1 ? "s" : ""). Celles qui valent 5 € ou plus se vendent mieux seules ; touche « Seule » ou « Lot » pour changer.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(cartes.indices, id: \.self) { i in
                            if i > 0 { Divider() }
                            ligne(i)
                        }
                    }.padding(.horizontal, 14)
                }
                .frame(maxHeight: 340).background(.background.opacity(0.5), in: RoundedRectangle(cornerRadius: 14))
                if let l = lot {
                    HStack(spacing: 10) {
                        Text("📦").font(.title2)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(l["titre"] as? String ?? "Lot de cartes").font(.callout.weight(.bold))
                            Text("Prix conseillé du lot : \(Libelles.prix((l["prix"] as? NSNumber)?.doubleValue)) (cotes cumulées : \(Libelles.prix((l["somme"] as? NSNumber)?.doubleValue)))").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.rrOr.opacity(0.14), in: RoundedRectangle(cornerRadius: 14))
                }
            }
            if !message.isEmpty { Text(message).foregroundStyle(Color.rrOr).frame(maxWidth: .infinity) }
            if etape >= 2 {
                HStack {
                    Spacer()
                    Button { creer() } label: {
                        if etape == 3 { HStack(spacing: 6) { ProgressView().controlSize(.small); Text("Je crée les fiches…") } }
                        else { Label("Créer " + (n > 1 ? "les \(n) fiches" : "la fiche") + (seules > 0 && lot != nil ? " (\(seules) seule\(seules > 1 ? "s" : "") + 1 lot)" : ""), systemImage: "checkmark") }
                    }
                    .boutonVerre(principal: true).controlSize(.large).keyboardShortcut(.defaultAction).disabled(n == 0 || etape == 3)
                }
            }
        }
        .padding(26).frame(width: 600)
    }

    private func ligne(_ i: Int) -> some View {
        let c = cartes[i], seule = c["seule"] as? Bool == true
        let t = [c["titre"] as? String, c["numero"] as? String].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        let s = [c["plateforme"] as? String, c["rarete"] as? String, c["region"] as? String].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(t.isEmpty ? "Carte" : t).font(.callout.weight(.bold)).lineLimit(1)
                if !s.isEmpty { Text(s).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
            Spacer(minLength: 8)
            Text(Libelles.prix((c["cote"] as? NSNumber)?.doubleValue)).font(.callout.weight(.semibold).monospacedDigit())
            Button { basculer(i) } label: { Text(seule ? "Seule" : "Lot").frame(width: 46) }
                .boutonVerre(principal: seule).controlSize(.small).disabled(etape == 3)
                .help(seule ? "Cette carte aura sa propre fiche : touche pour la mettre dans le lot" : "Cette carte part dans le lot : touche pour lui faire sa propre fiche")
        }.padding(.vertical, 9)
    }

    private func choisir() {
        let o = NSOpenPanel(); o.allowedContentTypes = [.image]
        if o.runModal() == .OK, let u = o.url, let i = NSImage(contentsOf: u) { analyser(i) }
    }
    private func analyser(_ i: NSImage) {
        image = i; etape = 1; message = ""
        Task {
            guard let d = jpegData(i, max: 1600, poids: 650_000) else { message = "Photo illisible."; etape = 0; return }
            do {
                let j = try await API.json("POST", "/api/ia/inventaire", ["photo": d])
                cartes = j["cartes"] as? [[String: Any]] ?? []; lot = j["lot"] as? [String: Any]
                if cartes.isEmpty { message = "Je n'ai repéré aucune carte sur cette photo."; etape = 0 } else { etape = 2 }
            } catch { message = (error as? ErreurRR)?.message ?? "Analyse impossible."; etape = 0 }
        }
    }
    private func basculer(_ i: Int) {
        cartes[i]["seule"] = !(cartes[i]["seule"] as? Bool == true)
        let reste = cartes.filter { $0["seule"] as? Bool != true }
        Task {
            do { lot = try await API.json("POST", "/api/lot-cartes", ["cartes": reste])["lot"] as? [String: Any] }
            catch { message = (error as? ErreurRR)?.message ?? "Calcul du lot impossible." }
        }
    }
    private func creer() {
        guard let img = image else { return }
        etape = 3; message = ""
        let seules = cartes.filter { $0["seule"] as? Bool == true }, l = lot
        Task {
            var faites = 0
            do {
                for c in seules {
                    _ = try await appli.creerBrut(CartesPhoto.fiche(c), photo: CartesPhoto.recadrer(img, c["cadre"] as? [String: Any]))
                    faites += 1
                }
                if let l = l {
                    let o: [String: Any] = ["titre": l["titre"] as? String ?? "Lot de cartes", "categorie": "cartes", "titreAnnonce": l["titre"] as? String ?? "",
                                            "texteAnnonce": l["description"] as? String ?? "", "prixDemande": l["prix"] ?? NSNull(), "ia": true,
                                            "notes": "Lot créé depuis une photo de plusieurs cartes."]
                    _ = try await appli.creerBrut(o, photo: jpegData(img, max: 1400, poids: 650_000))
                    faites += 1
                }
                try? await appli.chargerProfil()
                appli.message = "\(faites) fiche\(faites > 1 ? "s" : "") créée\(faites > 1 ? "s" : ""). Vérifie-les, puis publie sur Le Bon Coin 🃏"
                fermer()
            } catch {
                message = ((error as? ErreurRR)?.message ?? "Création impossible.") + (faites > 0 ? " (\(faites) fiche\(faites > 1 ? "s" : "") déjà créée\(faites > 1 ? "s" : ""))" : "")
                etape = 2
                if faites > 0 { await appli.recharger() }
            }
        }
    }
    /// Fiche d'une carte seule, comme le site : prix demandé = cote + 10 %, arrondi.
    static func fiche(_ c: [String: Any]) -> [String: Any] {
        func s(_ k: String) -> String { c[k] as? String ?? "" }
        let langues = ["français": "FR", "francais": "FR", "anglais": "EN", "japonais": "JP", "allemand": "DE", "italien": "IT", "espagnol": "ES"]
        let lg = langues[s("region").lowercased()] ?? ""
        let rar = s("rarete").range(of: "holo|reverse|full art|illustration|secr|ultra|gold|promo", options: [.regularExpression, .caseInsensitive]) != nil ? s("rarete") : ""
        var prix: Any = NSNull()
        if let cote = (c["cote"] as? NSNumber)?.doubleValue {
            let x = cote * 1.1
            prix = x < 10 ? max(1, x.rounded()) : (x / (x >= 100 ? 10 : 5)).rounded() * (x >= 100 ? 10 : 5)
        }
        let nom = [s("titre"), s("numero")].filter { !$0.isEmpty }.joined(separator: " ")
        let texte = ["Carte Pokémon " + nom + (s("plateforme").isEmpty ? "" : ", extension " + s("plateforme")) + (s("rarete").isEmpty ? "" : ", " + s("rarete").lowercased()) + (s("region").isEmpty ? "" : ", en " + s("region").lowercased()) + ".",
                     "Carte authentique.", "Envoi soigné sous sleeve et toploader, dans une enveloppe rigide.", "Remise en main propre ou envoi."].joined(separator: "\n")
        return ["titre": s("titre"), "categorie": "cartes", "plateforme": s("plateforme"), "region": s("region"), "numero": s("numero"), "rarete": s("rarete"),
                "edition": s("edition"), "etatCarte": s("etatCarte"), "etat": s("etat"), "prixDemande": prix, "ia": true,
                "titreAnnonce": String([s("titre"), s("numero"), s("plateforme"), rar, lg, s("edition")].filter { !$0.isEmpty }.joined(separator: " ").prefix(100)),
                "texteAnnonce": texte]
    }
    /// Photo recadrée en carré autour de la carte (cadre en fractions, origine en haut à gauche), comme le site.
    static func recadrer(_ img: NSImage, _ cadre: [String: Any]?) -> String? {
        func f(_ k: String) -> CGFloat { CGFloat((cadre?[k] as? NSNumber)?.doubleValue ?? 0) }
        guard let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil), f("w") > 0, f("h") > 0 else { return jpegData(img, max: 1400, poids: 650_000) }
        let W = CGFloat(cg.width), H = CGFloat(cg.height)
        let cx = (f("x") + f("w") / 2) * W, cy = (f("y") + f("h") / 2) * H
        let cote = min(max(f("w") * W, f("h") * H) * 1.15, W, H).rounded()
        let sx = max(0, min(W - cote, cx - cote / 2)).rounded(), sy = max(0, min(H - cote, cy - cote / 2)).rounded()
        guard let r = cg.cropping(to: CGRect(x: sx, y: sy, width: cote, height: cote)) else { return jpegData(img, max: 1400, poids: 650_000) }
        return jpegData(NSImage(cgImage: r, size: NSSize(width: r.width, height: r.height)), max: 1400, poids: 650_000)
    }
}
