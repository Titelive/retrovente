// Les écrans natifs de RetroRevente (SwiftUI) : connexion, mes articles, fiche, nouvel article, compte.
// Liquid Glass sur macOS 26 (barre latérale, capsules, boutons de verre), à la charte : or et anis sur nuit.
import AppKit
import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

extension Color {
    static let rrOr = Color(red: 0.96, green: 0.77, blue: 0.26)
    static let rrAnis = Color(red: 0.83, green: 0.96, blue: 0.48)
    static let rrNuit = Color(red: 0.10, green: 0.10, blue: 0.10)
}

// MARK: Verre (macOS 26), avec repli sur un matériau flou ailleurs

extension View {
    @ViewBuilder func verre<S: Shape>(_ forme: S, teinte: Color? = nil, interactif: Bool = false) -> some View {
        #if compiler(>=6.2)
        if #available(macOS 26.0, *) {
            self.glassEffect(verreDe(teinte, interactif), in: forme)
        } else { self.background(.regularMaterial, in: forme) }
        #else
        self.background(.regularMaterial, in: forme)
        #endif
    }
    @ViewBuilder func boutonVerre(principal: Bool = false) -> some View {
        #if compiler(>=6.2)
        if #available(macOS 26.0, *) {
            if principal { self.buttonStyle(.glassProminent).tint(.rrOr) } else { self.buttonStyle(.glass) }
        } else {
            if principal { self.buttonStyle(.borderedProminent).tint(.rrOr) } else { self.buttonStyle(.bordered) }
        }
        #else
        if principal { self.buttonStyle(.borderedProminent).tint(.rrOr) } else { self.buttonStyle(.bordered) }
        #endif
    }
}

#if compiler(>=6.2)
@available(macOS 26.0, *)
func verreDe(_ teinte: Color?, _ interactif: Bool) -> Glass {
    var g = Glass.regular
    if let t = teinte { g = g.tint(t.opacity(0.35)) }
    if interactif { g = g.interactive() }
    return g
}
#endif

/// Action « cacher / montrer la barre latérale », transmise aux en-têtes de la partie détail.
struct CleBarre: EnvironmentKey { static let defaultValue: (() -> Void)? = nil }
extension EnvironmentValues {
    var basculerBarre: (() -> Void)? { get { self[CleBarre.self] } set { self[CleBarre.self] = newValue } }
}

/// En-tête d'écran (titre, sous-titre, boutons), à la place d'une barre d'outils.
struct EnTete<Boutons: View>: View {
    let titre: String; var sousTitre: String = ""
    @ViewBuilder var boutons: () -> Boutons
    @Environment(\.basculerBarre) private var basculerBarre
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            if let b = basculerBarre {
                Button(action: b) { Image(systemName: "sidebar.left") }
                    .boutonVerre().help("Cacher ou montrer la barre latérale (⌃⌘S)")
            }
            // Titre et sous-titre sur une ligne chacun (tronqués si la fenêtre est étroite), boutons jamais repliés :
            // un texte écrasé qui passe à la ligne à chaque lettre agrandissait toute la vue au-delà de la fenêtre.
            VStack(alignment: .leading, spacing: 2) {
                Text(titre).font(.system(size: 26, weight: .heavy, design: .rounded)).lineLimit(1).truncationMode(.tail)
                if !sousTitre.isEmpty { Text(sousTitre).font(.callout).foregroundStyle(.secondary).lineLimit(1) }
            }.frame(minWidth: 80, alignment: .leading)
            Spacer(minLength: 8)
            HStack(spacing: 8) { boutons() }.lineLimit(1).fixedSize()
        }
        .padding(.horizontal, 24).padding(.top, 18).padding(.bottom, 6)
    }
}

struct Racine: View {
    @ObservedObject var appli: Appli
    var body: some View {
        ZStack {
            switch appli.etat {
            case .chargement: ProgressView().controlSize(.large)
            case .deconnecte: Connexion(appli: appli)
            case .connecte:
                // Mes articles reste construit sous la messagerie : on y revient sans rien perdre (filtre, défilement).
                ZStack {
                    Accueil(appli: appli).opacity(appli.messagesOuvert ? 0 : 1).allowsHitTesting(!appli.messagesOuvert)
                    if appli.messagesOuvert { MessagesVue(appli: appli, m: appli.messagerie) }
                }
            }
            if let t = appli.fete { Fete(titre: t).allowsHitTesting(false).transition(.opacity) }
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: appli.etat == .connecte)
        .animation(.easeInOut, value: appli.fete)
        .alert("RetroRevente", isPresented: Binding(get: { appli.erreur != nil }, set: { if !$0 { appli.erreur = nil } })) {
            Button("OK") { appli.erreur = nil }
        } message: { Text(appli.erreur ?? "") }
        .tint(Color.rrOr)
        .task { await appli.demarrer() }
    }
}

// MARK: Connexion

struct Connexion: View {
    @ObservedObject var appli: Appli
    @State private var email = ""
    @State private var mdp = ""
    @State private var message = ""
    @State private var enCours = false
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color.rrNuit, Color(red: 0.16, green: 0.17, blue: 0.08)], startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()
            Circle().fill(Color.rrOr.opacity(0.35)).frame(width: 420).blur(radius: 120).offset(x: 220, y: -160)
            Circle().fill(Color.rrAnis.opacity(0.25)).frame(width: 380).blur(radius: 120).offset(x: -260, y: 200)
            VStack(spacing: 18) {
                Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 72, height: 72)
                (Text("Retro").foregroundColor(.white) + Text("Revente").foregroundColor(.rrOr)).font(.system(size: 30, weight: .heavy, design: .rounded))
                Text("Content de te revoir").font(.title3.weight(.semibold)).foregroundStyle(.white.opacity(0.8))
                VStack(spacing: 10) {
                    TextField("E-mail", text: $email).textContentType(.username)
                    SecureField("Mot de passe", text: $mdp).textContentType(.password).onSubmit(entrer)
                }
                .textFieldStyle(.plain).font(.system(size: 15))
                .padding(14).verre(RoundedRectangle(cornerRadius: 16))
                if !message.isEmpty { Text(message).font(.callout).foregroundStyle(Color.rrOr).multilineTextAlignment(.center) }
                Button(action: entrer) {
                    HStack { if enCours { ProgressView().controlSize(.small) }; Text("Me connecter").bold() }.frame(maxWidth: .infinity).padding(.vertical, 6)
                }.boutonVerre(principal: true).controlSize(.large).keyboardShortcut(.defaultAction).disabled(enCours || email.isEmpty || mdp.isEmpty)
                HStack(spacing: 18) {
                    Button("Mot de passe oublié ?") { Task { do { try await appli.oubli(email: email); message = "Si un compte existe pour cette adresse, un e-mail vient de partir." } catch { message = (error as? ErreurRR)?.message ?? "" } } }
                        .disabled(email.isEmpty)
                    Button("Créer un compte") { appli.ouvrirSurLeWeb("/app/?inscription") }
                }.buttonStyle(.link).foregroundStyle(.white.opacity(0.75)).font(.callout)
            }
            .frame(width: 340).padding(32)
            .verre(RoundedRectangle(cornerRadius: 30))
            .environment(\.colorScheme, .dark)
        }
    }
    private func entrer() {
        guard !email.isEmpty, !mdp.isEmpty else { return }
        enCours = true; message = ""
        Task { do { try await appli.connecter(email: email, motdepasse: mdp) } catch { message = (error as? ErreurRR)?.message ?? "Connexion impossible." }; enCours = false }
    }
}

// MARK: Mes articles

struct Accueil: View {
    @ObservedObject var appli: Appli
    @State private var filtre: String? = "en_vente"
    @State private var recherche = ""
    @FocusState private var champRecherche: Bool
    private var visibilite: Binding<NavigationSplitViewVisibility> {
        Binding(get: { appli.barreCachee ? .detailOnly : .all },
                set: { v in appli.barreCachee = (v == .detailOnly) })
    }

    var body: some View {
        NavigationSplitView(columnVisibility: visibilite) {
            List {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Chercher un article (⌘K)", text: $recherche).textFieldStyle(.plain).focused($champRecherche)
                    if !recherche.isEmpty { Button { recherche = "" } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain).foregroundStyle(.secondary) }
                }
                .padding(.horizontal, 10).padding(.vertical, 7).verre(Capsule())
                .listRowSeparator(.hidden)
                Section("Mes articles") {
                    ligne(nil, "Tous", "square.grid.2x2", appli.visibles(nil).count)
                    ForEach(Libelles.statuts, id: \.0) { s in
                        ligne(s.0, s.1, s.2, appli.visibles(s.0).count)
                    }
                }
                Section("Mon espace") {
                    ligne("@trophees", "Trophées", "trophy", Trophees.liste(appli).filter { $0.ok }.count)
                    ligne("@bilan", "Bilan des ventes", "chart.bar", nil)
                }
            }
            .navigationSplitViewColumnWidth(min: 200, ideal: 230)
            .safeAreaInset(edge: .bottom) { CarteCompte(appli: appli, actif: filtre == "@compte").padding(10) }
        } detail: {
            if filtre == "@trophees" { Trophees(appli: appli) }
            else if filtre == "@bilan" { Bilan(appli: appli) }
            else if filtre == "@compte" { MonCompte(appli: appli) }
            else if let id = appli.selection, let a = appli.articles.first(where: { $0.id == id }) {
                Fiche(appli: appli, article: a, fermer: { appli.selection = nil }).id(id)
            } else {
                Grille(appli: appli, articles: appli.visibles(filtre?.hasPrefix("@") == true ? nil : filtre, recherche), titre: titre,
                       filtre: filtre?.hasPrefix("@") == true ? nil : filtre)
            }
        }
        .overlay(alignment: .bottom) { Bandeau(appli: appli) }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: appli.message)
        .onChange(of: appli.focusRecherche) { _ in
            if appli.barreCachee { appli.barreCachee = false }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { champRecherche = true }
        }
        .onChange(of: appli.choix != nil) { c in if c, filtre != nil, filtre != "en_vente" { filtre = nil } }
        .environment(\.basculerBarre, { withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) { appli.barreCachee.toggle() } })
        .background(Color(nsColor: .windowBackgroundColor).ignoresSafeArea())
        .sheet(isPresented: $appli.nouveauOuvert) { Nouveau(appli: appli) }
        .sheet(item: $appli.depot) { d in FeuilleDepot(appli: appli, depot: d) }
        .sheet(item: $appli.gestion) { g in FeuilleGestion(appli: appli, gestion: g) }
        .sheet(isPresented: $appli.choixDepot) { ChoixDepot(appli: appli) }
        .onChange(of: filtre) { _ in appli.selection = nil }
        .onChange(of: appli.compteOuvert) { o in if o { filtre = "@compte"; appli.compteOuvert = false } }
        .onChange(of: appli.selection) { id in if id != nil, filtre?.hasPrefix("@") == true { filtre = nil } }
        .onAppear { if let p = appli.page { filtre = p == "tous" ? nil : "@" + p } }
    }
    private var titre: String { filtre.flatMap { f in Libelles.statuts.first { $0.0 == f }?.1 } ?? "Tous mes articles" }
    /// Une ligne de la barre latérale : un vrai bouton (la sélection de List ne prenait pas « Tous » ni « Mon espace »).
    private func ligne(_ id: String?, _ nom: String, _ symbole: String, _ n: Int?) -> some View {
        let actif = filtre == id
        return Button { filtre = id; appli.selection = nil; appli.choix = nil } label: {
            HStack {
                Label { Text(nom) } icon: { Image(systemName: symbole).foregroundStyle(actif ? Color.white : Color.rrOr) }
                Spacer()
                if let n = n { Text("\(n)").font(.caption.monospacedDigit().weight(.semibold)).foregroundStyle(actif ? Color.white.opacity(0.85) : Color.secondary) }
            }
            .foregroundStyle(actif ? Color.white : Color.primary)
            .padding(.horizontal, 8).padding(.vertical, 5)
            .background(actif ? Color.accentColor : Color.clear, in: RoundedRectangle(cornerRadius: 7))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowInsets(EdgeInsets(top: 1, leading: 8, bottom: 1, trailing: 8))
    }
}

struct CarteCompte: View {
    @ObservedObject var appli: Appli
    var actif = false
    var body: some View {
        Button { appli.compteOuvert = true } label: {
            HStack(spacing: 10) {
                Avatar(profil: appli.profil, taille: 34)
                VStack(alignment: .leading, spacing: 2) {
                    Text(appli.profil.nom).font(.callout.weight(.semibold)).lineLimit(1)
                    Text(appli.profil.formule).font(.caption.weight(.medium)).foregroundStyle(Color.rrOr)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.up.chevron.down").font(.caption).foregroundStyle(.secondary)
            }.padding(10).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .verre(RoundedRectangle(cornerRadius: 16), teinte: actif ? .rrOr : nil, interactif: true)
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(actif ? Color.rrOr : .clear, lineWidth: 2))
        .help("Mon compte (⇧⌘K)")
    }
}

struct Avatar: View {
    let profil: Profil; let taille: CGFloat
    var body: some View {
        ZStack {
            Circle().fill(Color.rrAnis)
            if let i = image { Image(nsImage: i).resizable().scaledToFill() }
            else { Text(String(profil.nom.prefix(1)).uppercased()).font(.system(size: taille * 0.45, weight: .heavy, design: .rounded)).foregroundColor(.rrNuit) }
        }
        .frame(width: taille, height: taille).clipShape(Circle())
        .overlay(Circle().stroke(Color.rrOr.opacity(0.8), lineWidth: 1.5))
    }
    private var image: NSImage? {
        guard profil.avatar.hasPrefix("data:image"), let v = profil.avatar.split(separator: ",").last, let d = Data(base64Encoded: String(v)) else { return nil }
        return NSImage(data: d)
    }
}

struct Vignette: View {
    let article: Article; var photo: Photo? = nil; var taille: Images.Taille = .carte
    @State private var image: NSImage?
    init(article: Article, photo: Photo? = nil, taille: Images.Taille = .carte) {
        self.article = article; self.photo = photo; self.taille = taille
        // Déjà en mémoire : affichée dès le premier rendu (pas de case vide en revenant dans la grille).
        _image = State(initialValue: Vignette.url(article, photo).flatMap { Images.enCache($0, taille) })
    }
    static func url(_ a: Article, _ photo: Photo?) -> URL? { (photo ?? a.photos.first).map { API.urlPhoto(a.id, $0.id, v: a.modifie) } }
    var body: some View {
        // La photo remplit le cadre sans jamais en sortir (le cadre fixe la taille, la photo est rognée).
        Rectangle().fill(LinearGradient(colors: [Color.rrOr.opacity(0.18), Color.rrAnis.opacity(0.12)], startPoint: .topLeading, endPoint: .bottomTrailing))
        .overlay {
            if let i = image { Image(nsImage: i).resizable().interpolation(.medium).scaledToFill() }
            else { Image(systemName: Libelles.symboleCategorie(article.categorie)).font(.system(size: 38, weight: .light)).foregroundStyle(Color.rrOr) }
        }
        .clipped()
        .task(id: Vignette.url(article, photo)?.absoluteString ?? "") {
            guard let u = Vignette.url(article, photo) else { image = nil; return }
            if let i = Images.enCache(u, taille) { if image !== i { image = i }; return }
            let i = await Images.charger(u, taille)
            if !Task.isCancelled { image = i }
        }
    }
}

// MARK: Fiche

struct Fiche: View {
    @ObservedObject var appli: Appli
    @State var article: Article
    let fermer: () -> Void
    @State private var photo: Photo? = nil
    @State private var enCours = false
    @State private var confirmer = false
    @State private var retirer = false
    @State private var original: Article? = nil
    @State private var photosOuvert = false
    @State private var choixPhotos: [PhotosPickerItem] = []
    @State private var ajoutEnCours = 0
    @State private var cibleGalerie = false
    @State private var redaction = false

    /// L'annonce liée n'existe plus sur Le Bon Coin : on le dit, et on propose de redéposer.
    private var bandeauAnnonceMorte: some View {
        VStack(alignment: .leading, spacing: 10) {
          HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill").font(.title2).foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text("Cette annonce n'est plus en ligne sur Le Bon Coin").font(.headline)
                Text(article.estLot ? "Elle est désactivée, supprimée ou expirée. Redépose le lot : son titre accrocheur et son annonce sont refaits avec ses articles."
                                    : "Elle est désactivée, supprimée ou expirée. Redépose-la, ou retrouve-la si tu l'as republiée sous un autre lien.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }.frame(maxWidth: .infinity, alignment: .leading)
          }
          HStack(spacing: 8) {
            Spacer(minLength: 0)
            Menu {
                Button("Retrouver dans Mes annonces") { Task { await oublierLien(); appli.fenetre?.aller(.annonces) } }
                Button("Oublier le lien") { Task { await oublierLien() } }
            } label: { Text("Autres choix") }.menuStyle(.button).boutonVerre().fixedSize()
            Button { Task { await redeposer() } } label: { Label("Redéposer", systemImage: "paperplane.fill") }
                .boutonVerre(principal: true).disabled(enCours || article.statut != "en_vente").fixedSize()
          }
        }
        .padding(14)
        .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.orange.opacity(0.5)))
    }
    private func oublierLien() async {
        var n = article; n.annonce = ""
        enCours = true; defer { enCours = false }
        if let r = await appli.enregistrer(n) { article = r; original = r; appli.message = "Lien Le Bon Coin oublié." }
    }
    /// Redépose : lot = titre et annonce refaits d'abord ; puis le lien mort est oublié et le dépôt part en coulisses.
    private func redeposer() async {
        if article.estLot { await refaireAnnonceLot() }
        var n = article; n.annonce = ""
        enCours = true
        let r = await appli.enregistrer(n)
        enCours = false
        guard let r = r else { return }
        article = r; original = r
        appli.deposer(r)
    }

    /// Titre et texte de l'annonce par l'IA. Sans `forcer`, seulement si l'annonce est vide (et pas pour un lot, refait par le serveur).
    private func rediger(forcer: Bool) async {
        guard !redaction, !article.estLot, !article.titre.isEmpty else { return }
        guard forcer || article.texteAnnonce.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        redaction = true; defer { redaction = false }
        let avant = article
        let r = await appli.rediger(article)
        guard article.id == avant.id, article.texteAnnonce == avant.texteAnnonce || forcer else { return }   // tapé entre-temps : on ne l'écrase pas
        if forcer || article.titreAnnonce.isEmpty { article.titreAnnonce = r.titre }
        article.texteAnnonce = r.texte
        // Rédaction automatique d'une fiche sans autre modification en cours : enregistrée tout de suite.
        if !forcer, avant == original, let n = await appli.enregistrer(article) { article = n; original = n }
    }

    /// Lot : titre accrocheur et annonce refaits par le serveur avec les articles du lot (comme « Mettre à jour l'annonce » du site).
    private func refaireAnnonceLot() async {
        enCours = true; defer { enCours = false }
        do {
            let j = try await API.json("POST", "/api/lots/\(article.id)/annonce", ["simple": true, "prixDemande": article.prixDemande.map { $0 as Any } ?? NSNull()])
            if let t = j["titre"] as? String, !t.isEmpty { article.titre = t; article.titreAnnonce = t }
            if let d = j["description"] as? String, !d.isEmpty { article.texteAnnonce = d }
            appli.message = "Titre et annonce refaits avec les \(appli.membres(article).count) articles du lot. Enregistre, puis mets à jour l'annonce sur Le Bon Coin."
        } catch { appli.signaler(error) }
    }

    /// Enregistre la fiche si besoin, puis reporte titre, description et prix sur l'annonce Le Bon Coin.
    private func mettreAJour() async {
        if article != original {
            enCours = true; defer { enCours = false }
            guard let n = await appli.enregistrer(article) else { return }
            article = n; original = n
        }
        appli.fenetre?.modifierEnCoulisses(article)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button(action: fermer) { Label("Mes articles", systemImage: "chevron.left") }.boutonVerre().keyboardShortcut(.cancelAction)
                Spacer()
            }.padding(.horizontal, 24).padding(.top, 14)
            EnTete(titre: article.titre.isEmpty ? "Article" : article.titre, sousTitre: [Libelles.statut(article.statut), article.sousTitre].filter { !$0.isEmpty }.joined(separator: " · ")) {
                if article.estLot {
                    Button { Task { await refaireAnnonceLot() } } label: { Label("Refaire l'annonce", systemImage: "sparkles") }.boutonVerre()
                        .help("Nouveau titre accrocheur et annonce à jour avec les articles du lot").disabled(enCours)
                }
                if let url = URL(string: article.annonce), !article.annonce.isEmpty {
                    Menu {
                        Button { _ = url; appli.fenetre?.voirAnnonce(article) } label: { Label("Voir l'annonce", systemImage: "eye") }
                        Button { Task { await mettreAJour() } } label: { Label("Mettre à jour l'annonce", systemImage: "arrow.triangle.2.circlepath") }
                        Divider()
                        Button(role: .destructive) { retirer = true } label: { Label("Supprimer de Le Bon Coin…", systemImage: "trash") }
                    } label: { Label("Le Bon Coin", systemImage: "storefront") }
                    .menuStyle(.button).boutonVerre().fixedSize()
                    .help("Voir, mettre à jour ou supprimer l'annonce Le Bon Coin")
                } else {
                    Button { appli.deposer(article) } label: { Label("Déposer sur Le Bon Coin", systemImage: "paperplane") }.boutonVerre()
                        .help("Remplit l'annonce Le Bon Coin en coulisses : tu la relis et tu publies dans l'app").disabled(article.statut != "en_vente")
                }
                Button { Task { enCours = true; if let n = await appli.enregistrer(article) { article = n; original = n }; enCours = false } } label: { Label("Enregistrer", systemImage: "checkmark") }
                    .boutonVerre(principal: true).keyboardShortcut("s").disabled(enCours || article == original)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if article.annonceMorte(appli) { bandeauAnnonceMorte }
                    HStack(alignment: .top, spacing: 24) {
                        galerie.frame(minWidth: 220, idealWidth: 340, maxWidth: 340)
                            .overlay(RoundedRectangle(cornerRadius: 22).stroke(Color.rrOr, lineWidth: cibleGalerie ? 3 : 0))
                            .onDrop(of: [.image, .fileURL], isTargeted: $cibleGalerie) { p in deposerPhotos(p) }
                        champs.frame(minWidth: 380, maxWidth: .infinity)
                    }
                }.padding(24)
            }
            .frame(minHeight: 0, maxHeight: .infinity)
        }
        .frame(minWidth: 0, minHeight: 0, alignment: .top)
        .clipped()
        // Fiches rechargées (site, autre Mac, lot refait) : la fiche ouverte suit, sauf si elle a des modifications en cours.
        .onReceive(appli.$articles) { l in
            guard let n = l.first(where: { $0.id == article.id }), n != original, article == original else { return }
            article = n; original = n
        }
        .onAppear { original = article; photo = article.photos.first; appli.verif.appli = appli; appli.verif.verifierMaintenant(article) }
        // Annonce vide : l'IA la rédige tout de suite (il reste à enregistrer).
        .task(id: article.id) { await rediger(forcer: false) }
        .confirmationDialog("Supprimer « \(article.titre) » ?", isPresented: $confirmer) {
            Button("Supprimer", role: .destructive) { Task { await appli.supprimer(article) } }
        } message: { Text("La fiche et ses photos seront effacées.") }
        .confirmationDialog("Supprimer l'annonce de Le Bon Coin ?", isPresented: $retirer) {
            Button("Supprimer de Le Bon Coin", role: .destructive) { appli.fenetre?.supprimerEnCoulisses(article) }
        } message: { Text("L'annonce « \(article.titreAnnonce.isEmpty ? article.titre : article.titreAnnonce) » sera retirée de Le Bon Coin. Ta fiche RetroRevente est gardée.") }
    }

    private var galerie: some View {
        VStack(spacing: 12) {
            Color.clear.aspectRatio(1, contentMode: .fit).overlay { Vignette(article: article, photo: photo, taille: .grande) }.clipShape(RoundedRectangle(cornerRadius: 22))
                .overlay(RoundedRectangle(cornerRadius: 22).stroke(Color.primary.opacity(0.08)))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(article.photos) { p in
                        Vignette(article: article, photo: p, taille: .mini).frame(width: 58, height: 58).clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(p == photo ? Color.rrOr : .clear, lineWidth: 2))
                            .onTapGesture { photo = p }
                            .contextMenu { Button("Retirer la photo", role: .destructive) { Task { await appli.retirerPhoto(article, p); recharger() } } }
                    }
                    if ajoutEnCours > 0 { ProgressView().controlSize(.small).frame(width: 58, height: 58) }
                    Button { photosOuvert = true } label: { Image(systemName: "photo.on.rectangle.angled").font(.title3).frame(width: 58, height: 58) }
                        .buttonStyle(.plain).verre(RoundedRectangle(cornerRadius: 12), interactif: true).help("Ajouter des photos depuis l'app Photos")
                    Button { choisirPhoto() } label: { Image(systemName: "folder").font(.title3).frame(width: 58, height: 58) }
                        .buttonStyle(.plain).verre(RoundedRectangle(cornerRadius: 12), interactif: true).help("Ajouter des photos depuis un dossier")
                }.padding(2)
            }
            .photosPicker(isPresented: $photosOuvert, selection: $choixPhotos, maxSelectionCount: 20, selectionBehavior: .ordered,
                          matching: .images, preferredItemEncoding: .automatic, photoLibrary: .shared())
            .onChange(of: choixPhotos) { l in
                guard !l.isEmpty else { return }
                choixPhotos = []
                ajoutEnCours += l.count
                Task {
                    var envoyees: [String] = []
                    for it in l {
                        if let d = try? await it.loadTransferable(type: Data.self), let i = NSImage(data: d), let j = jpegData(i),
                           await appli.ajouterPhoto(article, j), let id = it.itemIdentifier { envoyees.append(id) }
                        ajoutEnCours -= 1
                    }
                    recharger()
                    await Phototheque.retirer(envoyees)
                }
            }
            if article.publiee, let u = URL(string: article.annonce) {
                Button { _ = u; appli.fenetre?.voirAnnonce(article) } label: { Label("Voir l'annonce sur Le Bon Coin", systemImage: "arrow.up.right.square").frame(maxWidth: .infinity) }.boutonVerre()
            }
            Button(role: .destructive) { confirmer = true } label: { Label("Supprimer l'article", systemImage: "trash").frame(maxWidth: .infinity) }.boutonVerre()
        }
    }

    private var champs: some View {
        VStack(alignment: .leading, spacing: 16) {
            bloc("Article", "gamecontroller") {
                champ("Titre") { TextField("Nom du jeu, de la console…", text: $article.titre) }
                HStack {
                    champ("Catégorie") { Picker("", selection: $article.categorie) { ForEach(Libelles.categories, id: \.0) { Text($0.1).tag($0.0) } }.labelsHidden() }
                    champ("Plateforme") { TextField("Nintendo 64…", text: $article.plateforme) }
                    champ("Région") { TextField("PAL EUR…", text: $article.region) }
                }
                HStack {
                    champ("État") { Picker("", selection: $article.etat) { ForEach(Libelles.etats, id: \.0) { Text($0.1).tag($0.0) } }.labelsHidden() }
                    if !["cartes", "films"].contains(article.categorie) {
                        champ("Contenu") { Picker("", selection: $article.contenu) { ForEach(Libelles.contenus, id: \.0) { Text($0.1).tag($0.0) } }.labelsHidden() }
                    }
                }
            }
            bloc("Vente", "tag") {
                champ("Statut") {
                    Picker("", selection: $article.statut) { ForEach(Libelles.ordreStatuts, id: \.self) { Text(Libelles.statut($0)).tag($0) } }.labelsHidden().pickerStyle(.segmented)
                }
                HStack {
                    champ("Prix demandé") { prix($article.prixDemande) }
                    champ("Prix d'achat") { prix($article.prixAchat) }
                    if article.vendu {
                        champ("Vendu à") { prix($article.prixVente) }
                        champ("Frais") { prix($article.frais) }
                    }
                }
            }
            BlocCote(appli: appli, article: $article, original: $original)
            BlocStats(appli: appli, releve: appli.releve, article: article)
            bloc("Annonce Le Bon Coin", "text.alignleft") {
                HStack(spacing: 8) {
                    if redaction { ProgressView().controlSize(.small); Text("L'IA rédige ton annonce…").font(.callout).foregroundStyle(.secondary) }
                    Spacer()
                    Button { Task { await rediger(forcer: true) } } label: { Label(article.texteAnnonce.isEmpty ? "Rédiger l'annonce" : "Réécrire avec l'IA", systemImage: "sparkles") }
                        .boutonVerre().disabled(redaction || article.estLot).help("Titre et texte de l'annonce rédigés par l'IA à partir de la fiche")
                }
                champ("Titre de l'annonce") { TextField("Repris du titre si vide", text: $article.titreAnnonce) }
                champ("Texte de l'annonce") {
                    TextEditor(text: $article.texteAnnonce).font(.body).frame(minHeight: 120).scrollContentBackground(.hidden)
                        .padding(6).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                }
                champ("Lien de l'annonce") { TextField("https://www.leboncoin.fr/…", text: $article.annonce) }
            }
            bloc("Notes", "note.text") {
                TextEditor(text: $article.notes).font(.body).frame(minHeight: 60).scrollContentBackground(.hidden)
                    .padding(6).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
        }.textFieldStyle(.roundedBorder)
    }
    private func bloc<C: View>(_ titre: String, _ symbole: String, @ViewBuilder _ c: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label { Text(titre).font(.headline) } icon: { Image(systemName: symbole).foregroundStyle(Color.rrOr) }
            c()
        }.padding(18).frame(maxWidth: .infinity, alignment: .leading).verre(RoundedRectangle(cornerRadius: 22))
    }
    private func champ<C: View>(_ nom: String, @ViewBuilder _ c: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 5) { Text(nom).font(.caption.weight(.semibold)).foregroundStyle(.secondary); c() }
    }
    private func prix(_ b: Binding<Double?>) -> some View {
        TextField("—", value: b, format: .number.precision(.fractionLength(0...2))).frame(maxWidth: 110)
            .overlay(alignment: .trailing) { Text("€").foregroundStyle(.secondary).padding(.trailing, 8) }
    }
    private func recharger() { if let n = appli.articles.first(where: { $0.id == article.id }) { article.photos = n.photos; original?.photos = n.photos; photo = n.photos.last } }
    /// Photos glissées depuis l'app Photos, le Finder ou une page web.
    private func deposerPhotos(_ fournis: [NSItemProvider]) -> Bool {
        guard !fournis.isEmpty else { return false }
        ajoutEnCours += fournis.count
        Task {
            for f in fournis {
                if let i = await imageDe(f), let j = jpegData(i) { await appli.ajouterPhoto(article, j) }
                ajoutEnCours -= 1
            }
            recharger()
        }
        return true
    }
    private func choisirPhoto() {
        let o = NSOpenPanel(); o.allowedContentTypes = [.image]; o.allowsMultipleSelection = true
        guard o.runModal() == .OK else { return }
        Task {
            for u in o.urls { if let i = NSImage(contentsOf: u), let d = jpegData(i) { await appli.ajouterPhoto(article, d) } }
            recharger()
        }
    }
}

// MARK: Nouvel article

struct Nouveau: View {
    @ObservedObject var appli: Appli
    @Environment(\.dismiss) private var fermer
    @State private var image: NSImage? = nil
    @State private var article = Article()
    @State private var etape = 0   // 0 : photo, 1 : reconnaissance, 2 : fiche
    @State private var message = ""
    @State private var cible = false
    @State private var photosOuvert = false
    @State private var choixPhoto: PhotosPickerItem? = nil
    @State private var idPhotos = ""   // photo venue de l'app Photos : retirée de la photothèque une fois l'article créé

    var body: some View {
        VStack(spacing: 18) {
            HStack {
                Text(etape == 2 ? "Vérifie la fiche" : "Nouvel article").font(.title2.weight(.bold))
                Spacer()
                Button("Annuler") { fermer() }.keyboardShortcut(.cancelAction)
            }
            if etape < 2 {
                ZStack {
                    RoundedRectangle(cornerRadius: 26).strokeBorder(style: StrokeStyle(lineWidth: 2, dash: [8, 6])).foregroundStyle(cible ? Color.rrOr : Color.secondary.opacity(0.4))
                    if let i = image { Image(nsImage: i).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 18)).padding(14) }
                    else {
                        VStack(spacing: 12) {
                            Image(systemName: "camera.viewfinder").font(.system(size: 52, weight: .light)).foregroundStyle(Color.rrOr)
                            Text("Glisse une photo ici").font(.title3.weight(.semibold))
                            Text("L'IA reconnaît le jeu, la console ou la carte et remplit la fiche.").foregroundStyle(.secondary)
                            HStack(spacing: 10) {
                                Button { photosOuvert = true } label: { Label("Depuis Photos…", systemImage: "photo.on.rectangle.angled") }.boutonVerre(principal: true).controlSize(.large)
                                Button { choisir() } label: { Label("Un fichier…", systemImage: "folder") }.boutonVerre().controlSize(.large)
                            }
                        }
                    }
                    if etape == 1 {
                        VStack(spacing: 10) { ProgressView().controlSize(.large); Text("Reconnaissance en cours…").font(.headline) }
                            .padding(24).verre(RoundedRectangle(cornerRadius: 22))
                    }
                }
                .frame(height: 360)
                .onDrop(of: [.fileURL, .image], isTargeted: $cible) { p in deposer(p) }
                .photosPicker(isPresented: $photosOuvert, selection: $choixPhoto, matching: .images, preferredItemEncoding: .automatic, photoLibrary: .shared())
                .onChange(of: choixPhoto) { it in
                    guard let it = it else { return }
                    choixPhoto = nil
                    Task { if let d = try? await it.loadTransferable(type: Data.self), let i = NSImage(data: d) { idPhotos = it.itemIdentifier ?? ""; reconnaitre(i) } else { message = "Photo illisible." } }
                }
                if !message.isEmpty { Text(message).foregroundStyle(Color.rrOr).multilineTextAlignment(.center) }
                HStack {
                    Button("Remplir à la main") { etape = 2 }.buttonStyle(.link)
                    Spacer()
                }
            } else {
                Form {
                    TextField("Titre", text: $article.titre)
                    Picker("Catégorie", selection: $article.categorie) { ForEach(Libelles.categories, id: \.0) { Text($0.1).tag($0.0) } }
                    TextField("Plateforme", text: $article.plateforme)
                    TextField("Région", text: $article.region)
                    Picker("État", selection: $article.etat) { ForEach(Libelles.etats, id: \.0) { Text($0.1).tag($0.0) } }
                    if !["cartes", "films"].contains(article.categorie) {
                        Picker("Contenu", selection: $article.contenu) { ForEach(Libelles.contenus, id: \.0) { Text($0.1).tag($0.0) } }
                    }
                    TextField("Prix demandé (€)", value: $article.prixDemande, format: .number)
                }.formStyle(.grouped)
                HStack {
                    Spacer()
                    Button {
                        Task {
                            etape = 3
                            if let n = await appli.creer(article, photo: image.flatMap { jpegData($0) }) {
                                let id = idPhotos; fermer(); appli.selection = n.id
                                if !n.photos.isEmpty { await Phototheque.retirer([id]) }
                            } else { etape = 2 }
                        }
                    } label: { Label("Créer l'article", systemImage: "checkmark") }
                    .boutonVerre(principal: true).controlSize(.large).keyboardShortcut(.defaultAction).disabled(article.titre.isEmpty || etape == 3)
                }
            }
        }
        .padding(26).frame(width: 560)
    }
    private func choisir() {
        let o = NSOpenPanel(); o.allowedContentTypes = [.image]
        if o.runModal() == .OK, let u = o.url, let i = NSImage(contentsOf: u) { idPhotos = ""; reconnaitre(i) }
    }
    private func deposer(_ fournis: [NSItemProvider]) -> Bool {
        guard let f = fournis.first else { return false }
        Task { if let i = await imageDe(f) { idPhotos = ""; reconnaitre(i) } }
        return true
    }
    private func reconnaitre(_ i: NSImage) {
        image = i; etape = 1; message = ""
        Task {
            guard let d = jpegData(i, max: 1000, poids: 650_000) else { message = "Photo illisible."; etape = 0; return }
            do { article = try await appli.identifier(d); etape = 2 }
            catch { message = (error as? ErreurRR)?.message ?? "Reconnaissance impossible."; etape = 0 }
        }
    }
}

// MARK: Confettis (annonce publiée)

struct Fete: View {
    let titre: String
    @State private var debut = Date()
    private let couleurs: [Color] = [.rrOr, .rrAnis, Color(red: 0.48, green: 0.96, blue: 0.89), Color(red: 0.73, green: 0.55, blue: 1), Color(red: 1, green: 0.6, blue: 0.84)]
    var body: some View {
        ZStack {
            TimelineView(.animation) { tl in
                Canvas { ctx, taille in
                    let t = tl.date.timeIntervalSince(debut)
                    for i in 0..<160 {
                        let g = Double(i) * 12.9898, x0 = (sin(g) * 43758.5453).truncatingRemainder(dividingBy: 1)
                        let x = abs(x0) * taille.width + sin(t * 2 + Double(i)) * 20
                        let v = 180 + Double(i % 7) * 40
                        let y = -20 + (t - Double(i % 20) * 0.04) * v
                        guard y > -20, y < taille.height + 20 else { continue }
                        var c = ctx; c.translateBy(x: x, y: y); c.rotate(by: .radians(t * 4 + Double(i)))
                        c.fill(Path(CGRect(x: -4, y: -2, width: 8, height: 4)), with: .color(couleurs[i % couleurs.count]))
                    }
                }
            }
            VStack(spacing: 8) {
                Text("🎉").font(.system(size: 56))
                Text("Annonce publiée !").font(.system(size: 28, weight: .heavy, design: .rounded))
                Text("« \(titre) » est en ligne sur Le Bon Coin.").foregroundStyle(.secondary)
            }.padding(30).verre(RoundedRectangle(cornerRadius: 28))
        }.onAppear { debut = Date() }
    }
}

/// Image d'un glisser-déposer : l'app Photos donne l'image elle-même (ou un fichier promis), le Finder une URL.
func imageDe(_ f: NSItemProvider) async -> NSImage? {
    if f.canLoadObject(ofClass: NSImage.self) {
        let i: NSImage? = await withCheckedContinuation { c in _ = f.loadObject(ofClass: NSImage.self) { o, _ in c.resume(returning: o as? NSImage) } }
        if let i = i { return i }
    }
    if f.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
        let d: Data? = await withCheckedContinuation { c in _ = f.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { d, _ in c.resume(returning: d) } }
        if let d = d, let i = NSImage(data: d) { return i }
    }
    let u: URL? = await withCheckedContinuation { c in _ = f.loadObject(ofClass: URL.self) { u, _ in c.resume(returning: u) } }
    return u.flatMap { NSImage(contentsOf: $0) }
}
