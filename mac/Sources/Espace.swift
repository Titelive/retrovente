// « Mon espace » en natif : trophées, bilan des ventes (seuil fiscal), cote d'un article et gestion du compte.
// Mêmes règles que l'appli web (site/app/index.html) : mêmes trophées, mêmes seuils (30 ventes ou 2 000 € par an).
import AppKit
import SwiftUI
import UniformTypeIdentifiers

private func carte<C: View>(_ titre: String, _ symbole: String, @ViewBuilder _ c: () -> C) -> some View {
    VStack(alignment: .leading, spacing: 12) {
        Label { Text(titre).font(.headline) } icon: { Image(systemName: symbole).foregroundStyle(Color.rrOr) }
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
    struct T: Identifiable { let ico, nom, desc: String; let val, max: Int; var id: String { nom }; var ok: Bool { val >= max } }
    @ObservedObject var appli: Appli

    static func liste(_ appli: Appli) -> [T] {
        let o = appli.articles.filter { !$0.estLot }, v = o.filter { $0.vendu }
        let enc = v.reduce(0) { $0 + ($1.prixVente ?? 0) }
        let plat = Set(o.filter { !["cartes", "films"].contains($0.categorie) }.map { $0.plateforme.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty })
        let n64 = o.filter { $0.plateforme.contains("64") && ($0.plateforme + " ").range(of: "nintendo|n64", options: [.regularExpression, .caseInsensitive]) != nil }.count
        let cartes = o.filter { $0.categorie == "cartes" }.count, films = o.filter { $0.categorie == "films" }.count
        let ia = o.filter { $0.ia || !$0.texteAnnonce.trimmingCharacters(in: .whitespaces).isEmpty }.count
        let photos = o.filter { !$0.photos.isEmpty }.count
        let eclair = v.filter { a in jours(a.dateMiseEnVente, a.dateVente).map { $0 <= 7 } ?? false }.count
        let plein = v.filter { a in (a.prixDemande ?? 0) > 0 && (a.prixVente ?? 0) >= (a.prixDemande ?? 0) }.count
        let rare = v.filter { ($0.prixVente ?? 0) >= 100 }.count
        let envois = v.filter { $0.statut == "envoye" || $0.statut == "recu" || $0.remise == "envoi" }.count
        let anc = Int(jours(appli.profil.cree, ISO8601DateFormatter().string(from: Date())) ?? 0)
        // Temps gagné (minutes par étape, valeurs par défaut de l'appli web).
        let lbcN = min(appli.profil.usageLbc, o.filter { $0.statut != "retire" || $0.publiee }.count)
        let minutes = photos * 3 + ia * 4 + o.filter { $0.cote != nil }.count * 4 + lbcN * 2 + v.count * 1
        let t: [(String, String, String, Int, Int)] = [
            ("🕹️", "Insert Coin", "Ajoute ton tout premier article.", o.count, 1),
            ("📸", "Photographe", "10 articles avec une photo.", photos, 10),
            ("🧺", "Grenier vidé", "10 articles ajoutés.", o.count, 10),
            ("📦", "Entrepôt", "50 articles ajoutés.", o.count, 50),
            ("💰", "Première vente", "Vends ton premier article.", v.count, 1),
            ("🔥", "Combo ×5", "5 articles vendus.", v.count, 5),
            ("🏆", "High Score", "25 articles vendus.", v.count, 25),
            ("💶", "Cent balles", "100 € encaissés.", Int(enc), 100),
            ("🐷", "Tirelire pleine", "1 000 € encaissés.", Int(enc), 1000),
            ("💎", "Pièce rare", "Un article vendu 100 € ou plus.", rare, 1),
            ("🤝", "Pas un centime de moins", "Vends au prix demandé (ou plus).", plein, 1),
            ("🚀", "Vente éclair", "Vends un article moins de 7 jours après sa mise en vente.", eclair, 1),
            ("📬", "Le facteur sonne", "5 ventes envoyées par la poste.", envois, 5),
            ("🍄", "64 bits", "Ajoute un jeu Nintendo 64.", n64, 1),
            ("🎮", "Multi-consoles", "Des articles sur 5 plateformes différentes.", plat.count, 5),
            ("⚡", "Attrapez-les tous", "Ajoute une carte Pokémon.", cartes, 1),
            ("🎬", "Moteur, ça tourne !", "Ajoute un film.", films, 1),
            ("📼", "Vidéoclub", "10 films dans tes articles.", films, 10),
            ("🤖", "Duo avec l'IA", "10 annonces rédigées avec l'IA.", ia, 10),
            ("⏱️", "Maître du temps", "10 heures gagnées avec RetroRevente.", minutes / 60, 10),
            ("🗓️", "Vétéran", "Membre depuis un an.", anc, 365),
        ]
        return t.map { T(ico: $0.0, nom: $0.1, desc: $0.2, val: min($0.3, $0.4), max: $0.4) }
    }

    var body: some View {
        let l = Trophees.liste(appli), n = l.filter { $0.ok }.count
        VStack(spacing: 0) {
            EnTete(titre: "Ta salle des trophées", sousTitre: "\(n) trophée\(n > 1 ? "s" : "") débloqué\(n > 1 ? "s" : "") sur \(l.count)") { EmptyView() }
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 200, maximum: 280), spacing: 16, alignment: .top)], alignment: .leading, spacing: 16) {
                    ForEach(l) { t in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text(t.ico).font(.system(size: 34)).grayscale(t.ok ? 0 : 1).opacity(t.ok ? 1 : 0.45)
                                Spacer()
                                if t.ok { Image(systemName: "checkmark.seal.fill").foregroundStyle(Color.rrOr).font(.title3) }
                            }
                            Text(t.nom).font(.headline)
                            Text(t.desc).font(.callout).foregroundStyle(.secondary).lineLimit(2, reservesSpace: true)
                            ProgressView(value: Double(t.val), total: Double(t.max)).tint(t.ok ? .rrOr : .secondary)
                            Text("\(t.val) / \(t.max)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        }
                        .padding(16)
                        .verre(RoundedRectangle(cornerRadius: 22), teinte: t.ok ? .rrOr : nil)
                    }
                }.padding(22)
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
                        chiffre("En vente", "\(enVente.count) · \(Libelles.prix(stock))", "tag")
                    }
                    carte("Seuil fiscal \(an)", "building.columns") {
                        if appli.profil.fiscal {
                            jauge("Ventes", Double(va.count), 30, { String(Int($0)) })
                            jauge("Montant", mt, 2000, { Libelles.prix($0) })
                            jauge("Objet le plus cher", gros, 5000, { Libelles.prix($0) })
                            Text(message(Swift.max(Double(va.count) / 30, mt / 2000), gros)).font(.callout).foregroundStyle(.secondary)
                        } else {
                            Text("Avec la formule Collectionneur, RetroRevente suit tes ventes de l'année et te prévient avant d'atteindre les seuils (30 ventes ou 2 000 €).")
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
                                Text(Libelles.prix(a.prixVente)).font(.callout.weight(.bold).monospacedDigit()).foregroundStyle(Color.rrOr).frame(width: 80, alignment: .trailing)
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
            Image(systemName: symbole).foregroundStyle(Color.rrOr).font(.title3)
            Text(valeur).font(.system(size: 22, weight: .heavy, design: .rounded)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
            Text(nom).font(.caption).foregroundStyle(.secondary)
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading).verre(RoundedRectangle(cornerRadius: 20))
    }
    private func jauge(_ nom: String, _ v: Double, _ max: Double, _ f: (Double) -> String) -> some View {
        let r = v / max
        return VStack(alignment: .leading, spacing: 4) {
            Text("\(nom) : \(f(v)) sur \(f(max))").font(.callout)
            ProgressView(value: Swift.min(1, r)).tint(r >= 1 ? .red : r >= 0.8 ? .orange : .rrOr)
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
                            Text(r.site).font(.caption.weight(.bold)).foregroundStyle(Color.rrOr).frame(width: 90, alignment: .leading)
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
                Text("L'IA cherche les ventes conclues et les annonces en cours pour estimer le bon prix.").font(.callout).foregroundStyle(.secondary)
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
            Text(texte ?? Libelles.prix(x)).font(.system(size: principal ? 24 : 18, weight: .heavy, design: .rounded)).foregroundStyle(principal ? Color.rrOr : .primary)
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

    var body: some View {
        VStack(spacing: 0) {
            EnTete(titre: "Mon compte", sousTitre: appli.profil.email) {
                Button(role: .destructive) { Task { await appli.deconnecter() } } label: { Label("Me déconnecter", systemImage: "rectangle.portrait.and.arrow.right") }.boutonVerre()
            }
            ScrollView {
                VStack(spacing: 16) {
                    if !info.isEmpty { Text(info).font(.callout).padding(12).frame(maxWidth: .infinity, alignment: .leading).verre(RoundedRectangle(cornerRadius: 14), teinte: .rrAnis) }
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
                                Text("Ajoute ton code postal et ta ville : ils remplissent l'adresse de tes dépôts Le Bon Coin.").font(.caption).foregroundStyle(.orange)
                            }
                        }
                        formule
                    }
                    HStack(alignment: .top, spacing: 16) {
                        carte("Adresse e-mail", "envelope") {
                            if !appli.profil.emailOk {
                                Text("Adresse pas encore confirmée.").font(.callout).foregroundStyle(.orange)
                                Button("Renvoyer le lien") { Task { await appli.renvoyerVerification(); info = "Lien de confirmation renvoyé." } }.buttonStyle(.link)
                            }
                            if !appli.profil.emailEnAttente.isEmpty { Text("En attente de confirmation : \(appli.profil.emailEnAttente)").font(.callout).foregroundStyle(.secondary) }
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
                    carte("Le Bon Coin", "bolt.fill") {
                        let branche = !(Stockage.partage.texte("cle") ?? "").isEmpty
                        Text(branche ? "Branché : remplissage du dépôt et réponses IA aux acheteurs actifs." : "Pas encore branché.").font(.callout)
                        Button(branche ? "Rebrancher" : "Brancher maintenant") { Task { await appli.brancherLeBonCoin(force: true); info = "Le Bon Coin est branché." } }.boutonVerre()
                    }
                    carte("Supprimer mon compte", "trash") {
                        Text("Tes articles et tes photos seront effacés définitivement.").font(.callout).foregroundStyle(.secondary)
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
                if !appli.profil.abonnement.isEmpty { Text(appli.profil.resiliation ? "Résiliée" : "Active").font(.caption.weight(.bold)).padding(.horizontal, 8).padding(.vertical, 4).background(Color.rrAnis, in: Capsule()).foregroundColor(.rrNuit) }
            }
            if let m = appli.profil.quotaMax {
                Text("Articles ce mois-ci : \(appli.profil.quotaUtilise) sur \(m)").font(.callout)
                ProgressView(value: Double(min(appli.profil.quotaUtilise, m)), total: Double(max(m, 1))).tint(.rrOr)
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
                Text("Le paiement se fait sur la page sécurisée de Stripe.").font(.caption).foregroundStyle(.secondary)
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
