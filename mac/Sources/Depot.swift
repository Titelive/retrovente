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
                    Button { appli.fenetre?.voirCoulisses() } label: { Label("Voir sur Le Bon Coin", systemImage: "eye") }.boutonVerre()
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
                    Button { appli.fenetre?.voirCoulisses() } label: { Label("Vérifier sur Le Bon Coin", systemImage: "eye") }.boutonVerre()
                    Button { appli.fenetre?.publierEnCoulisses() } label: { Label("Publier", systemImage: "paperplane.fill") }
                        .boutonVerre(principal: true).keyboardShortcut(.defaultAction)
                        .help("Clique « \(bouton) » sur Le Bon Coin")
                }
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
