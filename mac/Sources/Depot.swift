import SwiftUI

/// Feuille du dépôt en coulisses : progression, puis récapitulatif et « Publier ».
/// Rien n'est publié sans un clic sur « Publier ».
struct FeuilleDepot: View {
    @ObservedObject var appli: Appli
    let depot: DepotEnCours
    private var article: Article? { appli.articles.first { $0.id == depot.id } }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 14) {
                Group {
                    if let a = article { Vignette(article: a) } else { Color.rrOr.opacity(0.15) }
                }
                .frame(width: 86, height: 86).clipShape(RoundedRectangle(cornerRadius: 14))
                VStack(alignment: .leading, spacing: 4) {
                    Text(titreAnnonce).font(.title3.weight(.bold)).lineLimit(2)
                    if let a = article {
                        Text(Libelles.prix(a.prixDemande)).font(.title2.weight(.heavy).monospacedDigit()).foregroundStyle(Color.rrOr)
                        if !a.sousTitre.isEmpty { Text(a.sousTitre).font(.callout).foregroundStyle(.secondary) }
                    }
                }
                Spacer(minLength: 0)
            }

            switch depot.etape {
            case .remplissage(let t):
                HStack(spacing: 10) { ProgressView().controlSize(.small); Text(t).font(.headline) }
                Text("Le Bon Coin se remplit en coulisses : photos, titre, description, prix, catégorie. Rien ne sera publié sans toi.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                HStack {
                    Button("Annuler") { appli.fenetre?.annulerCoulisses() }.keyboardShortcut(.cancelAction).boutonVerre()
                    Spacer()
                }
            case .pret(let bouton, let payant):
                Label("Ton annonce est prête", systemImage: "checkmark.seal.fill").font(.headline).foregroundStyle(Color.rrOr)
                if payant {
                    Label("Une option payante est cochée sur Le Bon Coin. Vérifie-la avant de publier.", systemImage: "exclamationmark.triangle.fill")
                        .font(.callout.weight(.semibold)).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                } else {
                    Text("Aucune option payante n'est cochée. Rien n'est publié tant que tu ne cliques pas sur « Publier ».")
                        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                if let t = article?.texteAnnonce, !t.isEmpty {
                    ScrollView { Text(t).font(.callout).frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled) }
                        .frame(maxHeight: 140).padding(10).verre(RoundedRectangle(cornerRadius: 12))
                }
                HStack {
                    Button("Annuler") { appli.fenetre?.annulerCoulisses() }.keyboardShortcut(.cancelAction).boutonVerre()
                    Spacer()
                    Button { appli.fenetre?.publierEnCoulisses() } label: { Label("Publier", systemImage: "paperplane.fill") }
                        .boutonVerre(principal: true).keyboardShortcut(.defaultAction)
                        .help("Clique « \(bouton) » sur Le Bon Coin")
                }
            case .aide(let t):
                Label("Le Bon Coin a besoin de toi", systemImage: "exclamationmark.triangle.fill").font(.headline).foregroundStyle(.orange)
                Text(t).font(.callout).fixedSize(horizontal: false, vertical: true)
                Text("Rien n'a été publié. Le Bon Coin reste caché : tu peux réessayer, ou l'ouvrir pour régler ça toi-même.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                HStack {
                    Button("Annuler") { appli.fenetre?.annulerCoulisses() }.keyboardShortcut(.cancelAction).boutonVerre()
                    Spacer()
                    Button { appli.fenetre?.voirCoulisses() } label: { Label("Ouvrir Le Bon Coin", systemImage: "eye") }.boutonVerre()
                    Button { appli.fenetre?.reessayerCoulisses() } label: { Label("Réessayer", systemImage: "arrow.clockwise") }
                        .boutonVerre(principal: true).keyboardShortcut(.defaultAction)
                }
            case .adresse(let t):
                ChampAdresse(appli: appli, explication: t)
            case .publication:
                HStack(spacing: 10) { ProgressView().controlSize(.small); Text("Publication sur Le Bon Coin…").font(.headline) }
            }
        }
        .padding(24).frame(width: 460)
    }
    private var titreAnnonce: String {
        let t = article?.titreAnnonce ?? ""
        return t.isEmpty ? (article?.titre ?? depot.titre) : t
    }
}

/// « Déposer » : choisir l'article à mettre en ligne. Le dépôt se fait en coulisses, Le Bon Coin ne s'affiche pas.
struct ChoixDepot: View {
    @ObservedObject var appli: Appli
    @State private var recherche = ""
    var body: some View {
        let l = appli.articles.filter { $0.statut == "en_vente" && $0.annonce.isEmpty && !(appli.lotDe($0)?.vendu ?? false) }
            .filter { recherche.isEmpty || ($0.titre + " " + $0.plateforme).localizedCaseInsensitiveContains(recherche) }
            .sorted { $0.cree > $1.cree }
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Déposer une annonce").font(.title2.weight(.heavy))
                Text("Choisis l'article : l'annonce se remplit en coulisses, tu la relis puis tu publies, sans voir Le Bon Coin.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Chercher un article", text: $recherche).textFieldStyle(.plain)
            }.padding(.horizontal, 10).padding(.vertical, 7).verre(Capsule())
            if l.isEmpty {
                Text(recherche.isEmpty ? "Tous tes articles en vente sont déjà sur Le Bon Coin." : "Aucun article ne correspond.")
                    .foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 30)
            } else {
                ScrollView {
                    LazyVStack(spacing: 6) {
                        ForEach(l) { a in
                            Button { appli.choixDepot = false; DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { appli.deposer(a) } } label: {
                                HStack(spacing: 12) {
                                    Vignette(article: a, taille: .mini).frame(width: 46, height: 46).clipShape(RoundedRectangle(cornerRadius: 10))
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(a.titre).font(.callout.weight(.semibold)).lineLimit(1)
                                        Text(a.estLot ? "Lot · \(appli.membres(a).count) articles" : a.ligne).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                    }
                                    Spacer()
                                    Text(Libelles.prix(a.prixDemande)).font(.callout.weight(.heavy).monospacedDigit())
                                    Image(systemName: "paperplane.fill").foregroundStyle(Color.rrOr)
                                }
                                .padding(8).contentShape(Rectangle())
                                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
                            }.buttonStyle(.plain)
                        }
                    }
                }.frame(maxHeight: 380)
            }
            HStack {
                Button("Ouvrir le dépôt Le Bon Coin") { appli.choixDepot = false; appli.fenetre?.allerSurLeSite(.deposer) }.buttonStyle(.link)
                    .help("Pour déposer à la main un objet qui n'a pas de fiche")
                Spacer()
                Button("Fermer") { appli.choixDepot = false }.keyboardShortcut(.cancelAction).boutonVerre()
            }
        }
        .padding(24).frame(width: 520)
    }
}

/// Le Bon Coin demande « À quelle adresse se trouve le bien ? » : on la demande ici une fois, elle sert ensuite à chaque dépôt.
struct ChampAdresse: View {
    @ObservedObject var appli: Appli
    let explication: String
    @State private var adresse = ""
    @State private var erreur = ""
    @State private var enCours = false
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Où se trouve le bien ?", systemImage: "mappin.and.ellipse").font(.headline).foregroundStyle(Color.rrOr)
            Text(!explication.contains("pas reconnu") ? "Le Bon Coin demande l'adresse ou la ville où se trouve l'objet. Donne-la une fois : RetroRevente la remplira pour tous tes prochains dépôts."
                                 : "Le Bon Coin n'a pas reconnu cette adresse. Corrige-la (une ville avec son code postal suffit), puis continue.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                .help(explication)
            TextField("Ex. 54000 Nancy", text: $adresse).textFieldStyle(.roundedBorder).onSubmit(continuer)
            if !erreur.isEmpty { Text(erreur).font(.callout).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
            Text("Elle est enregistrée dans Mon compte. Le Bon Coin n'affiche que la ville aux acheteurs. Rien n'a été publié.").font(.caption).foregroundStyle(.secondary)
            HStack {
                Button("Annuler") { appli.fenetre?.annulerCoulisses() }.keyboardShortcut(.cancelAction).boutonVerre()
                Spacer()
                Button { appli.fenetre?.voirCoulisses() } label: { Label("Ouvrir Le Bon Coin", systemImage: "eye") }.boutonVerre()
                Button(action: continuer) { Label("Continuer", systemImage: "arrow.right") }
                    .boutonVerre(principal: true).keyboardShortcut(.defaultAction)
                    .disabled(enCours || adresse.trimmingCharacters(in: .whitespaces).count < 5)
            }
        }
        .onAppear {
            adresse = appli.profil.adresse.isEmpty ? ((Stockage.partage.lire(["adresse"])["adresse"] as? String) ?? "") : appli.profil.adresse
        }
    }
    /// Enregistrée dans Mon compte (le site, l'extension et l'app la reprennent), puis le dépôt reprend en coulisses.
    private func continuer() {
        let v = adresse.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !enCours, !v.isEmpty else { return }
        enCours = true; erreur = ""
        Task {
            do {
                appli.profil = Profil(try await API.json("POST", "/api/compte/profil", ["adresse": v]))
                appli.fenetre?.adresseCoulisses(v)
            } catch { erreur = (error as? ErreurRR)?.message ?? "Enregistrement impossible. Réessaie." }
            enCours = false
        }
    }
}
