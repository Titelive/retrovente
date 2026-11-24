// Les écrans natifs de RetroRevente (SwiftUI) : connexion, mes articles, fiche, nouvel article, compte.
// Liquid Glass sur macOS 26 (barre latérale, capsules, boutons de verre), à la charte : or et anis sur nuit.
import AppKit
import SwiftUI
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
            VStack(alignment: .leading, spacing: 2) {
                Text(titre).font(.system(size: 26, weight: .heavy, design: .rounded)).lineLimit(1)
                if !sousTitre.isEmpty { Text(sousTitre).font(.callout).foregroundStyle(.secondary) }
            }
            Spacer()
            HStack(spacing: 8) { boutons() }
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
            case .connecte: Accueil(appli: appli)
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
    private var visibilite: Binding<NavigationSplitViewVisibility> {
        Binding(get: { appli.barreCachee ? .detailOnly : .all },
                set: { v in appli.barreCachee = (v == .detailOnly) })
    }

    var body: some View {
        NavigationSplitView(columnVisibility: visibilite) {
            List(selection: $filtre) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Chercher un article", text: $recherche).textFieldStyle(.plain)
                    if !recherche.isEmpty { Button { recherche = "" } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain).foregroundStyle(.secondary) }
                }
                .padding(.horizontal, 10).padding(.vertical, 7).verre(Capsule())
                .listRowSeparator(.hidden)
                Section("Mes articles") {
                    ligne(nil, "Tous", "square.grid.2x2", appli.articles.count).tag(String?.none)
                    ForEach(Libelles.statuts, id: \.0) { s in
                        ligne(s.0, s.1, s.2, appli.articles.filter { $0.statut == s.0 }.count).tag(Optional(s.0))
                    }
                }
                Section("Mon espace") {
                    ligne("@trophees", "Trophées", "trophy", Trophees.liste(appli).filter { $0.ok }.count).tag(Optional("@trophees"))
                    ligne("@bilan", "Bilan des ventes", "chart.bar", nil).tag(Optional("@bilan"))
                    ligne("@compte", "Mon compte", "person.crop.circle", nil).tag(Optional("@compte"))
                }
            }
            .navigationSplitViewColumnWidth(min: 200, ideal: 230)
            .safeAreaInset(edge: .bottom) { CarteCompte(appli: appli).padding(10) }
        } detail: {
            if filtre == "@trophees" { Trophees(appli: appli) }
            else if filtre == "@bilan" { Bilan(appli: appli) }
            else if filtre == "@compte" { MonCompte(appli: appli) }
            else if let id = appli.selection, let a = appli.articles.first(where: { $0.id == id }) {
                Fiche(appli: appli, article: a, fermer: { appli.selection = nil }).id(id)
            } else {
                Grille(appli: appli, articles: visibles, titre: titre)
            }
        }
        .environment(\.basculerBarre, { withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) { appli.barreCachee.toggle() } })
        .background(Color(nsColor: .windowBackgroundColor).ignoresSafeArea())
        .sheet(isPresented: $appli.nouveauOuvert) { Nouveau(appli: appli) }
        .sheet(item: $appli.depot) { d in FeuilleDepot(appli: appli, depot: d) }
        .sheet(item: $appli.gestion) { g in FeuilleGestion(appli: appli, gestion: g) }
        .onChange(of: filtre) { _ in appli.selection = nil }
        .onChange(of: appli.compteOuvert) { o in if o { filtre = "@compte"; appli.compteOuvert = false } }
        .onChange(of: appli.selection) { id in if id != nil, filtre?.hasPrefix("@") == true { filtre = nil } }
        .onAppear { if let p = appli.page { filtre = "@" + p } }
    }
    private var titre: String { filtre.flatMap { f in Libelles.statuts.first { $0.0 == f }?.1 } ?? "Tous mes articles" }
    private var visibles: [Article] {
        appli.articles.filter { a in
            (filtre == nil || filtre?.hasPrefix("@") == true || a.statut == filtre) &&
            (recherche.isEmpty || (a.titre + " " + a.plateforme + " " + a.titreAnnonce).localizedCaseInsensitiveContains(recherche))
        }
    }
    private func ligne(_ id: String?, _ nom: String, _ symbole: String, _ n: Int?) -> some View {
        HStack {
            Label { Text(nom) } icon: { Image(systemName: symbole).foregroundStyle(Color.rrOr) }
            Spacer()
            if let n = n { Text("\(n)").font(.caption.monospacedDigit().weight(.semibold)).foregroundStyle(.secondary) }
        }
    }
}

struct CarteCompte: View {
    @ObservedObject var appli: Appli
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
        .verre(RoundedRectangle(cornerRadius: 16), interactif: true)
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

struct Grille: View {
    @ObservedObject var appli: Appli
    let articles: [Article]; let titre: String
    var body: some View {
        VStack(spacing: 0) {
        EnTete(titre: titre, sousTitre: articles.isEmpty ? "" : "\(articles.count) article\(articles.count > 1 ? "s" : "")") {
            Button { Task { await appli.recharger() } } label: { Image(systemName: "arrow.clockwise") }.boutonVerre().help("Actualiser")
            Button { appli.nouveauOuvert = true } label: { Label("Nouvel article", systemImage: "plus") }.boutonVerre(principal: true).keyboardShortcut("n").help("Nouvel article (⌘N)")
        }
        ScrollView {
            if articles.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "shippingbox").font(.system(size: 44, weight: .light)).foregroundStyle(Color.rrOr)
                    Text("Rien ici pour l'instant").font(.title3.weight(.semibold))
                    Text("Ajoute un article : une photo suffit, l'IA s'occupe du reste.").foregroundStyle(.secondary)
                    Button { appli.nouveauOuvert = true } label: { Label("Nouvel article", systemImage: "plus") }.boutonVerre(principal: true).controlSize(.large)
                }.frame(maxWidth: .infinity).padding(.top, 120)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 190, maximum: 260), spacing: 18, alignment: .top)], alignment: .leading, spacing: 18) {
                    ForEach(articles) { a in
                        Button { appli.selection = a.id } label: { CarteArticle(article: a) }.buttonStyle(.plain)
                            .contextMenu {
                                Button("Ouvrir la fiche") { appli.selection = a.id }
                                Button("Déposer sur Le Bon Coin") { appli.deposer(a) }.disabled(a.statut != "en_vente")
                                if a.publiee { Button("Voir l'annonce") { if let u = URL(string: a.annonce) { appli.fenetre?.ouvrir(u) } } }
                            }
                    }
                }.padding(22)
            }
        }
        }
    }
}

struct CarteArticle: View {
    let article: Article
    @State private var survol = false
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                Color.clear.aspectRatio(1, contentMode: .fit).overlay { Vignette(article: article) }.clipped()
                Text(Libelles.statut(article.statut)).font(.caption2.weight(.bold)).foregroundColor(.rrNuit)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Libelles.couleurStatut(article.statut), in: Capsule()).padding(10)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(article.titre).font(.headline).lineLimit(2, reservesSpace: true)
                HStack {
                    Text(article.sousTitre.isEmpty ? " " : article.sousTitre).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    Spacer()
                    Text(Libelles.prix(article.prixDemande)).font(.callout.weight(.heavy).monospacedDigit()).foregroundStyle(Color.rrOr)
                }
            }.padding(12)
        }
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 20))
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(survol ? Color.rrOr.opacity(0.7) : Color.primary.opacity(0.08), lineWidth: survol ? 2 : 1))
        .shadow(color: .black.opacity(survol ? 0.18 : 0.08), radius: survol ? 14 : 6, y: survol ? 8 : 3)
        .scaleEffect(survol ? 1.015 : 1)
        .animation(.spring(response: 0.25, dampingFraction: 0.8), value: survol)
        .onHover { survol = $0 }
    }
}

struct Vignette: View {
    let article: Article; var photo: Photo? = nil
    @State private var image: NSImage? = nil
    var body: some View {
        // La photo remplit le cadre sans jamais en sortir (le cadre fixe la taille, la photo est rognée).
        Rectangle().fill(LinearGradient(colors: [Color.rrOr.opacity(0.18), Color.rrAnis.opacity(0.12)], startPoint: .topLeading, endPoint: .bottomTrailing))
        .overlay {
            if let i = image { Image(nsImage: i).resizable().scaledToFill() }
            else { Image(systemName: Libelles.symboleCategorie(article.categorie)).font(.system(size: 38, weight: .light)).foregroundStyle(Color.rrOr) }
        }
        .clipped()
        .task(id: (photo ?? article.photos.first)?.id) {
            image = nil
            guard let p = photo ?? article.photos.first else { return }
            image = await Images.charger(API.urlPhoto(article.id, p.id))
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
                if let url = URL(string: article.annonce), !article.annonce.isEmpty {
                    Menu {
                        Button { appli.fenetre?.ouvrir(url) } label: { Label("Voir l'annonce", systemImage: "eye") }
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
                HStack(alignment: .top, spacing: 24) {
                    galerie.frame(width: 340)
                    champs.frame(maxWidth: .infinity)
                }.padding(24)
            }
        }
        .onAppear { original = article; photo = article.photos.first }
        .confirmationDialog("Supprimer « \(article.titre) » ?", isPresented: $confirmer) {
            Button("Supprimer", role: .destructive) { Task { await appli.supprimer(article) } }
        } message: { Text("La fiche et ses photos seront effacées.") }
        .confirmationDialog("Supprimer l'annonce de Le Bon Coin ?", isPresented: $retirer) {
            Button("Supprimer de Le Bon Coin", role: .destructive) { appli.fenetre?.supprimerEnCoulisses(article) }
        } message: { Text("L'annonce « \(article.titreAnnonce.isEmpty ? article.titre : article.titreAnnonce) » sera retirée de Le Bon Coin. Ta fiche RetroRevente est gardée.") }
    }

    private var galerie: some View {
        VStack(spacing: 12) {
            Color.clear.aspectRatio(1, contentMode: .fit).overlay { Vignette(article: article, photo: photo) }.clipShape(RoundedRectangle(cornerRadius: 22))
                .overlay(RoundedRectangle(cornerRadius: 22).stroke(Color.primary.opacity(0.08)))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(article.photos) { p in
                        Vignette(article: article, photo: p).frame(width: 58, height: 58).clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(p == photo ? Color.rrOr : .clear, lineWidth: 2))
                            .onTapGesture { photo = p }
                            .contextMenu { Button("Retirer la photo", role: .destructive) { Task { await appli.retirerPhoto(article, p); recharger() } } }
                    }
                    Button { choisirPhoto() } label: { Image(systemName: "plus").font(.title3).frame(width: 58, height: 58) }
                        .buttonStyle(.plain).verre(RoundedRectangle(cornerRadius: 12), interactif: true).help("Ajouter une photo")
                }.padding(2)
            }
            if article.publiee, let u = URL(string: article.annonce) {
                Button { appli.fenetre?.ouvrir(u) } label: { Label("Voir l'annonce sur Le Bon Coin", systemImage: "arrow.up.right.square").frame(maxWidth: .infinity) }.boutonVerre()
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
                    Picker("", selection: $article.statut) { ForEach(Libelles.statuts, id: \.0) { Text(Libelles.statut($0.0)).tag($0.0) } }.labelsHidden().pickerStyle(.segmented)
                }
                HStack {
                    champ("Prix demandé") { prix($article.prixDemande) }
                    champ("Prix d'achat") { prix($article.prixAchat) }
                    if ["vendu", "envoye"].contains(article.statut) {
                        champ("Vendu à") { prix($article.prixVente) }
                        champ("Frais") { prix($article.frais) }
                    }
                }
            }
            BlocCote(appli: appli, article: $article, original: $original)
            bloc("Annonce Le Bon Coin", "text.alignleft") {
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
                            Button("Choisir une photo…") { choisir() }.boutonVerre(principal: true).controlSize(.large)
                        }
                    }
                    if etape == 1 {
                        VStack(spacing: 10) { ProgressView().controlSize(.large); Text("Reconnaissance en cours…").font(.headline) }
                            .padding(24).verre(RoundedRectangle(cornerRadius: 22))
                    }
                }
                .frame(height: 360)
                .onDrop(of: [.fileURL, .image], isTargeted: $cible) { p in deposer(p) }
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
                            if let n = await appli.creer(article, photo: image.flatMap { jpegData($0) }) { fermer(); appli.selection = n.id } else { etape = 2 }
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
        if o.runModal() == .OK, let u = o.url, let i = NSImage(contentsOf: u) { reconnaitre(i) }
    }
    private func deposer(_ fournis: [NSItemProvider]) -> Bool {
        guard let f = fournis.first else { return false }
        if f.canLoadObject(ofClass: NSImage.self) {
            _ = f.loadObject(ofClass: NSImage.self) { i, _ in if let i = i as? NSImage { DispatchQueue.main.async { reconnaitre(i) } } }
            return true
        }
        _ = f.loadObject(ofClass: URL.self) { u, _ in if let u = u, let i = NSImage(contentsOf: u) { DispatchQueue.main.async { reconnaitre(i) } } }
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
