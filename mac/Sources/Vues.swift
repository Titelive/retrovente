// Les écrans natifs de RetroRevente (SwiftUI) : connexion, mes articles, fiche, nouvel article, compte.
// Liquid Glass sur macOS 26 (barre latérale, capsules, boutons de verre), à la charte : or et anis sur nuit.
import AppKit
import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

extension Color {
    /// Accent de toute l'app : le bleu du système (Liquid Glass), lisible en clair comme en sombre.
    static let rrAccent = Color(nsColor: .systemBlue)
    /// Fonds neutres : ni le doré d'avant, ni la teinte du fond d'écran que macOS ajoute aux matériaux.
    static let rrFond = Color(nsColor: .textBackgroundColor)
    static let rrSurface = Color.primary.opacity(0.035)
    static let rrCarte = Color.primary.opacity(0.05)
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
            if principal { self.buttonStyle(.glassProminent).tint(.rrAccent) } else { self.buttonStyle(.glass) }
        } else {
            if principal { self.buttonStyle(.borderedProminent).tint(.rrAccent) } else { self.buttonStyle(.bordered) }
        }
        #else
        if principal { self.buttonStyle(.borderedProminent).tint(.rrAccent) } else { self.buttonStyle(.bordered) }
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
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
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
        // Au-dessus de tout (aussi de la messagerie) : le résultat d'une action se voit toujours.
        .overlay(alignment: .bottom) { Bandeau(appli: appli).padding(.bottom, appli.messagesOuvert ? 150 : 0) }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: appli.message)
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: appli.etat == .connecte)
        .animation(.easeInOut, value: appli.fete)
        .alert("RetroRevente", isPresented: Binding(get: { appli.erreur != nil }, set: { if !$0 { appli.erreur = nil } })) {
            Button("OK") { appli.erreur = nil }
        } message: { Text(appli.erreur ?? "") }
        .tint(Color.rrAccent)
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
            LinearGradient(colors: [Color.rrNuit, Color(red: 0.07, green: 0.10, blue: 0.18)], startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()
            Circle().fill(Color.rrAccent.opacity(0.35)).frame(width: 420).blur(radius: 120).offset(x: 220, y: -160)
            Circle().fill(Color.indigo.opacity(0.25)).frame(width: 380).blur(radius: 120).offset(x: -260, y: 200)
            VStack(spacing: 18) {
                Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 72, height: 72)
                (Text("Retro").foregroundColor(.white) + Text("Revente").foregroundColor(.rrAccent)).font(.system(size: 30, weight: .heavy, design: .rounded))
                Text("Content de te revoir").font(.title3.weight(.semibold)).foregroundStyle(.white.opacity(0.8))
                VStack(spacing: 10) {
                    TextField("E-mail", text: $email).textContentType(.username)
                    SecureField("Mot de passe", text: $mdp).textContentType(.password).onSubmit(entrer)
                }
                .textFieldStyle(.plain).font(.system(size: 15))
                .padding(14).verre(RoundedRectangle(cornerRadius: 16))
                if !message.isEmpty { Text(message).font(.callout).foregroundStyle(Color.rrAccent).multilineTextAlignment(.center) }
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
        // Barre masquée mais montrée au survol : la vraie colonne s'ouvre et la page se décale (rien n'est recouvert).
        Binding(get: { appli.barreCachee && !appli.barreSurvol ? .detailOnly : .all },
                set: { v in
                    if v == .detailOnly { appli.barreSurvol = false; appli.barreCachee = true }
                    else if !appli.barreSurvol { appli.barreCachee = false }
                })
    }

    /// Barre latérale masquée : elle glisse par-dessus la page quand la souris touche le bord gauche, et se recache quand elle s'en va.
    @State private var recacher: DispatchWorkItem?
    @State private var dansPanneau = false

    @ViewBuilder private var barreLaterale: some View {
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
            .listStyle(.sidebar)
            // Fond neutre : la barre latérale de macOS prend sinon la teinte du fond d'écran (beige sur un fond orangé).
            .scrollContentBackground(.hidden)
            .background(ZStack { Color.rrFond; Color.rrSurface }.ignoresSafeArea())
            .navigationSplitViewColumnWidth(min: 200, ideal: 230)
            .safeAreaInset(edge: .bottom) {
                VStack(alignment: .leading, spacing: 8) {
                    CarteCompte(appli: appli, actif: filtre == "@compte")
                    // Le logo, tout en bas à gauche de la barre latérale, sous le compte.
                    HStack(spacing: 7) {
                        Image(nsImage: NSApp.applicationIconImage ?? NSImage()).resizable().frame(width: 22, height: 22)
                        (Text("Retro") + Text("Revente").foregroundColor(.rrAccent)).font(.system(size: 14, weight: .bold))
                    }
                    .padding(.horizontal, 8).accessibilityHidden(true)
                }.padding(10)
            }
            .onHover { dedans in
                // Ouverte au survol : elle se referme quand la souris la quitte.
                dansPanneau = dedans
                recacher?.cancel()
                guard !dedans, appli.barreSurvol else { return }
                let w = DispatchWorkItem { withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) { appli.barreSurvol = false } }
                recacher = w; DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: w)
            }
    }

    var body: some View {
        NavigationSplitView(columnVisibility: visibilite) {
            barreLaterale
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
        .overlay(alignment: .leading) {
            // Barre masquée : la souris sur le bord gauche (ou sur le bouton du haut) l'ouvre, la page se décale.
            if appli.barreCachee && !appli.barreSurvol {
                Color.clear.frame(width: 6).frame(maxHeight: .infinity).contentShape(Rectangle()).ignoresSafeArea()
                    .onHover { if $0 { withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) { appli.barreSurvol = true } } }
            }
        }
        .onChange(of: appli.barreCachee) { c in if !c { appli.barreSurvol = false } }
        .onChange(of: appli.barreSurvol) { montre in
            // Montrée depuis le bouton du haut sans que la souris entre dans le panneau : il se retire tout seul.
            guard montre else { dansPanneau = false; return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                if appli.barreSurvol, !dansPanneau { withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) { appli.barreSurvol = false } }
            }
        }
        .overlay {
            if let v = appli.visionneuse, let a = appli.articles.first(where: { $0.id == v.article }) {
                Visionneuse(article: a, index: Binding(get: { appli.visionneuse?.photo }, set: { n in appli.visionneuse = n.map { (v.article, $0) } }))
                    .transition(.opacity)
            }
        }
        .onChange(of: appli.focusRecherche) { _ in
            if appli.barreCachee { appli.barreCachee = false }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { champRecherche = true }
        }
        .onChange(of: appli.choix != nil) { c in if c, filtre != nil, filtre != "en_vente" { filtre = nil } }
        .environment(\.basculerBarre, { withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) { appli.barreCachee.toggle() } })
        .background(Color.rrFond.ignoresSafeArea())
        .sheet(isPresented: $appli.nouveauOuvert) { Nouveau(appli: appli) }
        .sheet(isPresented: $appli.cartesOuvert) { CartesPhoto(appli: appli) }
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
                Label { Text(nom) } icon: { Image(systemName: symbole).foregroundStyle(actif ? Color.white : Color.rrAccent) }
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

/// Carte de joueur du membre, en bas de la barre latérale : avatar avec son niveau, pseudo, nom du niveau, formule,
/// barre d'XP et trophées. Mêmes niveau et XP que sur le site (calculés à partir des articles et des trophées).
struct CarteCompte: View {
    @ObservedObject var appli: Appli
    var actif = false
    var body: some View {
        let tr = Trophees.liste(appli), n = Niveau(appli, trophees: tr)
        Button { appli.compteOuvert = true } label: {
            VStack(alignment: .leading, spacing: 9) {
                HStack(spacing: 10) {
                    ZStack(alignment: .bottomTrailing) {
                        Avatar(profil: appli.profil, taille: 42)
                            .overlay(Circle().stroke(statut, lineWidth: 2.5))
                        Text("\(n.niv)").font(.system(size: 10, weight: .black, design: .monospaced)).foregroundStyle(.white)
                            .frame(minWidth: 18, minHeight: 18).padding(.horizontal, 2)
                            .background(Capsule().fill(Color.black.opacity(0.85))).overlay(Capsule().stroke(statut, lineWidth: 1.5))
                            .offset(x: 5, y: 4)
                            .help("Niveau \(n.niv)")
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(appli.profil.nom).font(.system(size: 14, weight: .heavy, design: .rounded)).lineLimit(1)
                        Text(n.nom.uppercased()).font(.system(size: 9, weight: .heavy, design: .monospaced)).tracking(0.6).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.up.chevron.down").font(.caption).foregroundStyle(.secondary)
                }
                // Barre d'XP vers le niveau suivant
                VStack(alignment: .leading, spacing: 4) {
                    GeometryReader { g in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.primary.opacity(0.1))
                            Capsule().fill(LinearGradient(colors: [statut.opacity(0.75), statut], startPoint: .leading, endPoint: .trailing))
                                .frame(width: max(6, g.size.width * n.part))
                        }
                    }.frame(height: 7)
                    HStack {
                        Text("\(n.xp - n.de) / \(n.a - n.de) XP").font(.system(size: 9.5, weight: .bold, design: .monospaced)).foregroundStyle(.secondary)
                        Spacer(minLength: 4)
                        Text("NIV. \(n.niv + 1)").font(.system(size: 9.5, weight: .bold, design: .monospaced)).foregroundStyle(.secondary)
                    }
                }
                HStack(spacing: 6) {
                    Text(appli.profil.formule.uppercased()).font(.system(size: 9.5, weight: .black, design: .monospaced)).tracking(0.8)
                        .foregroundStyle(.white).padding(.horizontal, 8).padding(.vertical, 4).background(Capsule().fill(statut))
                    Spacer(minLength: 0)
                    Label("\(tr.filter(\.ok).count)/\(tr.count)", systemImage: "trophy.fill").font(.system(size: 10.5, weight: .bold, design: .rounded))
                        .foregroundStyle(statut).help("Trophées débloqués")
                }
            }.padding(12).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // La carte du membre garde la couleur de son statut (Découverte, Vendeur, Collectionneur, Pass).
        .verre(RoundedRectangle(cornerRadius: 16), teinte: statut, interactif: true)
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(statut.opacity(actif ? 1 : 0.55), lineWidth: actif ? 2 : 1.2))
        .help("Mon compte (⇧⌘K) · Niveau \(n.niv) : \(n.xp) XP")
    }
    private var statut: Color { Color.statut(appli.profil.formuleId) }
}

/// Niveau et XP du vendeur, comme sur le site (rien n'est stocké) : chaque étape de la vente rapporte, la vente le plus,
/// chaque trophée un gros bonus. Niveau n atteint à 50 × n × (n − 1) XP : 100, 300, 600, 1 000…
struct Niveau {
    static let noms = ["Joueur du dimanche", "Chineur", "Fouineur", "Brocanteur", "Marchand de pixels", "Négociant", "Expert rétro", "Chasseur de pépites", "Maître du grenier", "Légende 8 bits", "Légende 16 bits", "Légende 64 bits"]
    static func seuil(_ n: Int) -> Int { 50 * n * (n - 1) }
    static func nom(_ n: Int) -> String { n <= noms.count ? noms[n - 1] : "Boss final" }
    let xp: Int, niv: Int, de: Int, a: Int
    var nom: String { Niveau.nom(niv) }
    var part: CGFloat { a > de ? CGFloat(xp - de) / CGFloat(a - de) : 0 }
    @MainActor init(_ appli: Appli, trophees: [Trophees.T]) {
        let l = appli.articles.filter { !$0.estLot }, v = l.filter(\.vendu)   // comme le site : les lots ne comptent qu'à part
        let eur = v.reduce(0) { $0 + min(100, max(0, Int(($1.prixVente ?? 0).rounded()))) }
        var x = l.count * 10 + l.filter { !$0.photos.isEmpty }.count * 5 + l.filter { $0.statut != "retire" }.count * 10
        x += v.count * 40 + appli.articles.filter { $0.estLot && $0.vendu }.count * 20 + eur + trophees.filter(\.ok).count * 100
        var n = 1; while x >= Niveau.seuil(n + 1) { n += 1 }
        xp = x; niv = n; de = Niveau.seuil(n); a = Niveau.seuil(n + 1)
    }
}

extension Color {
    /// Couleur du statut du membre : gris (Découverte), anis (Vendeur), or (Collectionneur), lilas (Pass).
    static func statut(_ id: String) -> Color {
        switch id {
        case "vendeur": return Color(red: 0.45, green: 0.72, blue: 0.20)
        case "collectionneur": return Color(red: 0.85, green: 0.62, blue: 0.08)
        case "pass": return Color(red: 0.62, green: 0.42, blue: 0.95)
        default: return .gray
        }
    }
}

struct Avatar: View {
    let profil: Profil; let taille: CGFloat
    var body: some View {
        ZStack {
            Circle().fill(Color.secondary.opacity(0.22))
            if let i = image { Image(nsImage: i).resizable().scaledToFill() }
            else { Text(String(profil.nom.prefix(1)).uppercased()).font(.system(size: taille * 0.45, weight: .heavy, design: .rounded)).foregroundColor(.primary) }
        }
        .frame(width: taille, height: taille).clipShape(Circle())
        .overlay(Circle().stroke(Color.rrAccent.opacity(0.8), lineWidth: 1.5))
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
        Rectangle().fill(LinearGradient(colors: [Color.rrAccent.opacity(0.12), Color.primary.opacity(0.04)], startPoint: .topLeading, endPoint: .bottomTrailing))
        .overlay {
            if let i = image { Image(nsImage: i).resizable().interpolation(.medium).scaledToFill() }
            else { Image(systemName: Libelles.symboleCategorie(article.categorie)).font(.system(size: 38, weight: .light)).foregroundStyle(Color.rrAccent) }
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
    @State private var clavier: Any?
    @State private var glissee: Photo?   // vignette qu'on fait glisser pour changer l'ordre des photos
    /// Photos venues de l'app Photos : notées une fois la fiche enregistrée, retirées de Photos une fois l'annonce publiée.
    @State private var aRetirerDePhotos: [String] = []
    private var aEnregistrer: Bool { article != original || !aRetirerDePhotos.isEmpty }

    /// L'annonce liée n'existe plus sur Le Bon Coin : on le dit, et on propose de redéposer.
    private var bandeauAnnonceMorte: some View {
        VStack(alignment: .leading, spacing: 10) {
          HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill").font(.title2).foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text("Cette annonce n'est plus en ligne sur Le Bon Coin").font(.headline)
                Text(article.estLot ? LocalizedStringKey("Elle est **désactivée, supprimée ou expirée**. **Redépose le lot** : son titre accrocheur et son annonce sont refaits avec ses articles.")
                                    : "Elle est **désactivée, supprimée ou expirée**. **Redépose-la**, ou retrouve-la si tu l'as republiée sous un autre lien.")
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
        if let e = r.etat { article.etat = e }
        // Chaque photo garde sa légende (même ordre que les photos envoyées).
        for (i, l) in r.legendes.enumerated() where i < article.photos.count && !l.isEmpty { article.photos[i].legende = l }
        // Défauts vus sur les photos : la cote est refaite en en tenant compte, et un prix demandé égal à l'ancien
        // prix conseillé suit le nouveau (un prix tapé à la main n'est jamais touché).
        if let d = r.defauts, d != article.defauts {
            article.defauts = d
            article.notes = Appli.notesAvecDefauts(article.notes, d)
            if article.cote != nil {
                let suit = article.prixDemande == nil || article.prixDemande == article.cote?.conseille
                var b = article; if suit { b.prixDemande = nil }
                if let n = await appli.estimerCote(b), article.id == avant.id {
                    article.cote = n.cote; if suit { article.prixDemande = n.prixDemande }
                    original = n
                    if !d.isEmpty { appli.message = "Défaut vu sur les photos : \(d.map(\.texte).joined(separator: ", ")). État, cote et prix ajustés." }
                    return
                }
            }
        }
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
        await apresEnregistrement()
        appli.fenetre?.modifierEnCoulisses(article)
    }
    /// Fiche enregistrée : les photos ajoutées depuis Photos sont notées ; elles n'en seront retirées qu'une fois l'annonce publiée.
    private func apresEnregistrement() async {
        let l = aRetirerDePhotos; aRetirerDePhotos = []
        Phototheque.noter(l, pour: article.id)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button(action: fermer) { Label("Mes articles", systemImage: "chevron.left") }.boutonVerre().keyboardShortcut(.cancelAction)
                Spacer()
            }.padding(.horizontal, 24).padding(.top, 14)
            EnTete(titre: article.titre.isEmpty ? "Article" : article.titre, sousTitre: [appli.enAttente(article) ? "En attente de validation par Le Bon Coin" : appli.aPublier(article) ? "À publier : pas encore sur Le Bon Coin" : Libelles.statut(article.statut), article.sousTitre].filter { !$0.isEmpty }.joined(separator: " · ")) {
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
                Button { Task { enCours = true; if let n = await appli.enregistrer(article) { article = n; original = n; await apresEnregistrement() }; enCours = false } } label: { Label(aEnregistrer ? "Enregistrer" : "Enregistré", systemImage: aEnregistrer ? "square.and.arrow.down" : "checkmark") }
                    .boutonVerre(principal: true).keyboardShortcut("s").disabled(enCours || !aEnregistrer)
                    .help(aEnregistrer ? "Enregistrer les modifications" : "Tout est déjà enregistré : modifie un champ pour réactiver le bouton")
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if article.annonceMorte(appli) { bandeauAnnonceMorte }
                    HStack(alignment: .top, spacing: 24) {
                        galerie.frame(minWidth: 220, idealWidth: 340, maxWidth: 340)
                            .overlay(RoundedRectangle(cornerRadius: 22).stroke(Color.rrAccent, lineWidth: cibleGalerie ? 3 : 0))
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
        .onAppear {
            original = article; photo = article.photos.first; appli.verif.appli = appli; appli.verif.verifierMaintenant(article)
            // Clavier : ← → passent d'une photo à l'autre, sauf pendant la saisie d'un texte ou quand la visionneuse est ouverte (elle gère ses flèches).
            clavier = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { e in
                guard e.keyCode == 123 || e.keyCode == 124,
                      e.modifierFlags.intersection([.command, .option, .control, .shift]).isEmpty,
                      appli.visionneuse == nil, !appli.messagesOuvert,
                      !(e.window?.firstResponder is NSText), article.photos.count > 1 else { return e }
                allerPhoto(e.keyCode == 123 ? -1 : 1)
                return nil
            }
        }
        .onDisappear { if let c = clavier { NSEvent.removeMonitor(c); clavier = nil } }
        // Annonce vide : l'IA la rédige tout de suite (il reste à enregistrer).
        .task(id: article.id) { await rediger(forcer: false) }
        .confirmationDialog("Supprimer « \(article.titre) » ?", isPresented: $confirmer) {
            Button("Supprimer", role: .destructive) { Task { await appli.supprimer(article) } }
        } message: { Text("La fiche et ses photos seront **effacées**.") }
        .confirmationDialog("Supprimer l'annonce de Le Bon Coin ?", isPresented: $retirer) {
            Button("Supprimer de Le Bon Coin", role: .destructive) { appli.fenetre?.supprimerEnCoulisses(article) }
        } message: { Text("L'annonce « \(article.titreAnnonce.isEmpty ? article.titre : article.titreAnnonce) » sera **retirée de Le Bon Coin**. Ta fiche RetroRevente **est gardée**.") }
    }

    private func ouvrirVisionneuse(_ p: Photo?) {
        guard !article.photos.isEmpty else { return }
        let n = p.flatMap { x in article.photos.firstIndex(where: { $0.id == x.id }) } ?? 0
        withAnimation(.easeOut(duration: 0.2)) { appli.visionneuse = (article.id, n) }
    }

    private func deplacer(_ p: Photo, vers n: Int) {
        guard let i = article.photos.firstIndex(of: p), n >= 0, n < article.photos.count, n != i else { return }
        withAnimation(.easeOut(duration: 0.2)) { article.photos.move(fromOffsets: IndexSet(integer: i), toOffset: n > i ? n + 1 : n) }
        ordreChange()
    }
    /// Nouvel ordre des photos : la liste « Photos : » de l'annonce suit, et il est enregistré tout de suite
    /// si rien d'autre n'est en cours de modification sur la fiche.
    private func ordreChange() {
        if article.texteAnnonce.range(of: "Photos :") != nil {
            article.texteAnnonce = Article.avecPhotos(article.texteAnnonce, article.photos.map(\.legende))
        }
        guard var o = original else { return }
        o.photos = article.photos; o.texteAnnonce = article.texteAnnonce
        guard o == article else { appli.message = "Nouvel ordre des photos : enregistre la fiche pour le garder."; return }
        Task { if let n = await appli.enregistrer(article) { article = n; original = n; appli.message = "Ordre des photos enregistré." } }
    }
    private var indexPhoto: Int { photo.flatMap { x in article.photos.firstIndex(where: { $0.id == x.id }) } ?? 0 }
    private func allerPhoto(_ d: Int) {
        guard !article.photos.isEmpty else { return }
        let n = indexPhoto + d
        guard n >= 0, n < article.photos.count else { return }
        withAnimation(.easeOut(duration: 0.15)) { photo = article.photos[n] }
    }
    private func flechePhoto(_ symbole: String, _ d: Int, aide: String) -> some View {
        let n = indexPhoto + d
        let possible = n >= 0 && n < article.photos.count
        return Button { allerPhoto(d) } label: {
            Image(systemName: symbole).font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                .frame(width: 34, height: 34).background(.black.opacity(0.45), in: Circle()).contentShape(Circle())
        }.buttonStyle(.plain).opacity(possible ? 1 : 0.3).disabled(!possible).help(aide)
    }

    private var galerie: some View {
        VStack(spacing: 12) {
            Color.clear.aspectRatio(1, contentMode: .fit).overlay { Vignette(article: article, photo: photo, taille: .grande) }.clipShape(RoundedRectangle(cornerRadius: 22))
                .overlay(RoundedRectangle(cornerRadius: 22).stroke(Color.primary.opacity(0.08)))
                .overlay(alignment: .bottomTrailing) {
                    if !article.photos.isEmpty {
                        Image(systemName: "arrow.up.left.and.arrow.down.right").font(.caption.weight(.bold)).foregroundStyle(.white)
                            .padding(7).background(.black.opacity(0.45), in: Circle()).padding(10).allowsHitTesting(false)
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture { ouvrirVisionneuse(photo) }
                .help("Cliquer pour voir la photo en grand (← → pour passer d'une photo à l'autre)")
                // Flèches de navigation et position de la photo (au-dessus du clic qui ouvre la visionneuse).
                .overlay {
                    if article.photos.count > 1 {
                        HStack {
                            flechePhoto("chevron.left", -1, aide: "Photo précédente (←)")
                            Spacer()
                            flechePhoto("chevron.right", 1, aide: "Photo suivante (→)")
                        }.padding(.horizontal, 10)
                    }
                }
                .overlay(alignment: .bottomLeading) {
                    if article.photos.count > 1 {
                        Text("\(indexPhoto + 1) / \(article.photos.count)").font(.caption.weight(.semibold).monospacedDigit()).foregroundStyle(.white)
                            .padding(.horizontal, 9).padding(.vertical, 5).background(.black.opacity(0.45), in: Capsule()).padding(10).allowsHitTesting(false)
                    }
                }
            ScrollViewReader { defile in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(article.photos) { p in
                        Vignette(article: article, photo: p, taille: .mini).frame(width: 58, height: 58).clipShape(RoundedRectangle(cornerRadius: 12))
                            .id(p.id)
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(p == photo ? Color.rrAccent : .clear, lineWidth: 2))
                            .onTapGesture(count: 2) { ouvrirVisionneuse(p) }
                            .onTapGesture { photo = p }
                            .opacity(glissee == p ? 0.4 : 1)
                            // Glisser une vignette sur une autre pour changer l'ordre (la 1re photo est la photo principale).
                            .onDrag { glissee = p; return NSItemProvider(object: p.id as NSString) }
                            .onDrop(of: [.text], delegate: OrdrePhotos(cible: p, photos: $article.photos, glissee: $glissee) { fin in if fin { ordreChange() } })
                            .contextMenu {
                                let i = article.photos.firstIndex(of: p) ?? 0
                                Button("Mettre en premier") { deplacer(p, vers: 0) }.disabled(i == 0)
                                Button("Déplacer à gauche") { deplacer(p, vers: i - 1) }.disabled(i == 0)
                                Button("Déplacer à droite") { deplacer(p, vers: i + 1) }.disabled(i >= article.photos.count - 1)
                                Divider()
                                Button("Retirer la photo", role: .destructive) { Task { await appli.retirerPhoto(article, p); recharger() } }
                            }
                    }
                    if ajoutEnCours > 0 { ProgressView().controlSize(.small).frame(width: 58, height: 58) }
                    Button { photosOuvert = true } label: { Image(systemName: "photo.on.rectangle.angled").font(.title3).frame(width: 58, height: 58) }
                        .buttonStyle(.plain).verre(RoundedRectangle(cornerRadius: 12), interactif: true).help("Ajouter des photos depuis l'app Photos")
                    Button { choisirPhoto() } label: { Image(systemName: "folder").font(.title3).frame(width: 58, height: 58) }
                        .buttonStyle(.plain).verre(RoundedRectangle(cornerRadius: 12), interactif: true).help("Ajouter des photos depuis un dossier")
                }.padding(2)
                // Vignette lâchée à côté des autres (entre deux, au bout de la bande) : l'ordre déjà pris est gardé.
                .onDrop(of: [.text], isTargeted: nil) { _ in
                    guard glissee != nil else { return false }
                    glissee = nil; ordreChange(); return true
                }
            }
            // La vignette choisie (flèches, clavier) reste visible dans la bande.
            .onChange(of: photo?.id) { id in
                guard let id else { return }
                withAnimation(.easeOut(duration: 0.2)) { defile.scrollTo(id, anchor: .center) }
            }
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
                    // Notées tout de suite (elles sont déjà sur la fiche) : avant, elles n'étaient notées qu'au clic sur
                    // « Enregistrer », et une seule photo du Zelda sur huit avait été retirée de Photos après la publication.
                    Phototheque.noter(envoyees, pour: article.id)
                }
            }
            if !article.photos.isEmpty { outilsPhoto }
            if article.publiee, let u = URL(string: article.annonce) {
                Button { _ = u; appli.fenetre?.voirAnnonce(article) } label: { Label("Voir l'annonce sur Le Bon Coin", systemImage: "arrow.up.right.square").frame(maxWidth: .infinity) }.boutonVerre()
            }
            Button(role: .destructive) { confirmer = true } label: { Label("Supprimer l'article", systemImage: "trash").frame(maxWidth: .infinity) }.boutonVerre().tint(.red).foregroundStyle(.red)
        }
    }

    /// Outils de la photo affichée, comme sur le site : Ajouter, Retoucher, Pivoter, Original, Exporter, Retirer.
    private var outilsPhoto: some View {
        let p = photo ?? article.photos.first
        let k = p.map { Appli.cle(article, $0) } ?? ""
        let r = appli.retouches[k], occupe = appli.retoucheEnCours.contains(k)
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
            outil("Ajouter", "photo.badge.plus", .blue) { photosOuvert = true }
            outil(occupe ? "Retouche…" : "Retoucher", "sparkles", .rrAccent, principal: true, enCours: occupe) {
                guard let p = p else { return }
                Task { await appli.retoucher(article, p); rafraichirPhotos(garder: p) }
            }.help("Retoucher la photo : fond, lumière, cadrage. L'original est gardé.")
            outil("Pivoter", "rotate.right", .pink) {
                guard let p = p else { return }
                Task { await appli.pivoter(article, p); rafraichirPhotos(garder: p) }
            }.help("Tourner d'un quart de tour")
            outil(r?.voitOriginal == true ? "Retouchée" : "Original", "rectangle.split.2x1", .purple) {
                guard let p = p else { return }
                Task { await appli.basculerOriginal(article, p); rafraichirPhotos(garder: p) }
            }.disabled(r == nil).help(r == nil ? "Retouche d'abord la photo : l'original restera à un clic" : r!.voitOriginal ? "Revenir à la photo retouchée" : "Revoir l'original")
            outil("Exporter", "square.and.arrow.down", .teal) { Task { await appli.exporterPhotos(article) } }
                .help("Enregistrer les \(article.photos.count) photos dans un dossier")
            outil("Retirer", "trash", .red) {
                guard let p = p else { return }
                Task { await appli.retirerPhoto(article, p); recharger() }
            }.help("Retirer cette photo de la fiche")
        }
        .disabled(p == nil)
        .safeAreaInset(edge: .bottom, spacing: 8) {
          VStack(spacing: 8) {
            if article.photos.count > 1 {
                let enCours = appli.retoucheTout == article.id
                Button { Task { await appli.retoucherTout(article); if let p = p { rafraichirPhotos(garder: p) } } } label: {
                    HStack(spacing: 6) {
                        if enCours { ProgressView().controlSize(.small) } else { Image(systemName: "sparkles.rectangle.stack") }
                        Text(enCours ? "Retouche des photos…" : "Retoucher les \(article.photos.count) photos")
                    }.frame(maxWidth: .infinity)
                }
                .boutonVerre().disabled(enCours || appli.retoucheTout != nil)
                .help("Retouche toutes les photos de la fiche : recadrage, lumière, objets à côté effacés. Les originaux sont gardés.")
                // Toutes les photos d'un coup : originaux ⇄ retouches.
                let e = appli.etatRetouches(article)
                if e.retouchees > 0 {
                    let versOriginal = e.originaux < e.retouchees
                    Button { Task { await appli.originalTout(article, original: versOriginal); if let p = p { rafraichirPhotos(garder: p) } } } label: {
                        Label(versOriginal ? "Original pour les \(e.retouchees) photos" : "Retouches pour les \(e.retouchees) photos",
                              systemImage: versOriginal ? "arrow.uturn.backward" : "sparkles")
                            .frame(maxWidth: .infinity)
                    }
                    .boutonVerre().disabled(appli.retoucheTout != nil)
                    .help(versOriginal ? "Remet toutes les photos retouchées à leur original (les retouches restent à un clic)" : "Remet les retouches sur toutes les photos")
                }
            }
          }
        }
    }
    private func outil(_ nom: String, _ symbole: String, _ teinte: Color, principal: Bool = false, enCours: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 5) {
                ZStack {
                    if enCours { ProgressView().controlSize(.small) } else { Image(systemName: symbole).font(.system(size: 15, weight: .semibold)) }
                }
                .frame(width: 30, height: 30).foregroundStyle(principal ? Color.white : teinte)
                .background((principal ? Color.white.opacity(0.22) : teinte.opacity(0.14)), in: RoundedRectangle(cornerRadius: 9))
                Text(nom).font(.caption.weight(.semibold)).lineLimit(1).foregroundStyle(principal ? Color.white : .primary)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 9)
            .background(principal ? AnyShapeStyle(LinearGradient(colors: [.rrAccent, Color.rrAccent.opacity(0.8)], startPoint: .top, endPoint: .bottom)) : AnyShapeStyle(teinte.opacity(0.07)),
                        in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(principal ? Color.clear : teinte.opacity(0.25)))
            .contentShape(RoundedRectangle(cornerRadius: 14))
        }.buttonStyle(.plain).disabled(enCours)
    }
    /// Après une retouche : la fiche reprend les photos et la date de modification (le lien des photos en dépend).
    private func rafraichirPhotos(garder p: Photo) {
        guard let n = appli.articles.first(where: { $0.id == article.id }) else { return }
        article.photos = n.photos; article.modifie = n.modifie
        original?.photos = n.photos; original?.modifie = n.modifie
        photo = n.photos.first { $0.id == p.id } ?? n.photos.first
    }

    private var champs: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Le statut d'abord (tout en haut), le prix plus bas, juste avant l'annonce (après la cote qui aide à le fixer).
            ParcoursStatut(statut: $article.statut, enValidation: appli.enAttente(article), aPublier: appli.aPublier(article))
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
                        champ("Contenu") { Picker("", selection: $article.contenu) { ForEach(Libelles.contenus(pour: article.plateforme), id: \.0) { Text($0.1).tag($0.0) } }.labelsHidden() }
                            .onAppear { if Libelles.sansNotice(article.plateforme), article.contenu == "boite" { article.contenu = "complet" } }
                            .onChange(of: article.plateforme) { p in if Libelles.sansNotice(p), article.contenu == "boite" { article.contenu = "complet" } }
                        // Rareté sur le marché de l'occasion, comme sur le site : établie par l'IA, pas modifiable à la main.
                        if !article.estLot {
                            champ("Rareté") {
                                HStack(spacing: 8) {
                                    if article.rangRarete >= 2 { BadgeRarete(article: article) }
                                    else if article.rareteJeu == "commun" {
                                        Text("Commun").font(.system(size: 11, weight: .heavy, design: .rounded)).foregroundStyle(.secondary)
                                            .padding(.horizontal, 8).frame(height: 22).background(RoundedRectangle(cornerRadius: 7).fill(Color.primary.opacity(0.07)))
                                    }
                                    Text(article.rareteJeu.isEmpty ? "Établie par l'IA à l'enregistrement" : "établie par l'IA").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                                .frame(height: 22)
                                .help("Rareté du jeu sur le marché de l'occasion, estimée par l'IA puis précisée par la cote")
                            }
                        }
                    }
                }
            }
            BlocCote(appli: appli, article: $article, original: $original)
            BlocStats(appli: appli, releve: appli.releve, article: article)
            bloc("Prix", "eurosign") {
                HStack(alignment: .bottom, spacing: 14) {
                    champ("Prix demandé") { prix($article.prixDemande) }
                    champ("Prix d'achat") { prix($article.prixAchat) }
                    if article.vendu {
                        champ("Vendu à") { prix($article.prixVente) }
                        champ("Frais") { prix($article.frais) }
                    }
                    Spacer(minLength: 0)
                    resultatPrix
                }
            }
            bloc("Annonce Le Bon Coin", "text.alignleft") {
                HStack(spacing: 8) {
                    if redaction {
                        ProgressView().controlSize(.small)
                        Text("L'IA **regarde chaque photo** et **rédige ton annonce**…").font(.callout).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button { Task { await rediger(forcer: true) } } label: {
                        Label(article.texteAnnonce.isEmpty ? "Rédiger avec l'IA" : "Réécrire avec l'IA", systemImage: "sparkles")
                    }
                    .buttonStyle(.borderedProminent).tint(.rrAccent).foregroundStyle(.white)
                    .disabled(redaction || article.estLot).help("Titre et texte de l'annonce rédigés par l'IA RetroRevente, qui regarde chaque photo")
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
            Label { Text(titre).font(.headline) } icon: { Image(systemName: symbole).foregroundStyle(Color.rrAccent) }
            c()
        }.padding(18).frame(maxWidth: .infinity, alignment: .leading).verre(RoundedRectangle(cornerRadius: 22))
    }
    private func champ<C: View>(_ nom: String, @ViewBuilder _ c: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 5) { Text(nom).font(.caption.weight(.semibold)).foregroundStyle(.secondary); c() }
    }
    /// Ce que rapporte l'article, en grand : marge prévue (en vente) ou bénéfice réel (vendu).
    @ViewBuilder private var resultatPrix: some View {
        let vendu = article.vendu && article.prixVente != nil
        let gain: Double? = vendu ? article.prixVente.map { $0 - (article.prixAchat ?? 0) - (article.frais ?? 0) }
                                  : article.prixDemande.flatMap { p in article.prixAchat.map { p - $0 } }
        if let g = gain {
            let c: Color = g >= 0 ? .green : .red
            VStack(alignment: .trailing, spacing: 2) {
                Text((g >= 0 ? "+" : "") + Libelles.prix(g)).font(.system(size: 26, weight: .heavy, design: .rounded)).foregroundStyle(c)
                Text(vendu ? "Bénéfice" : "Marge prévue").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14).padding(.vertical, 8).background(c.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
        } else if let p = article.prixDemande {
            VStack(alignment: .trailing, spacing: 2) {
                Text(Libelles.prix(p)).font(.system(size: 26, weight: .heavy, design: .rounded)).foregroundStyle(Color.rrAccent)
                Text("Prix demandé").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14).padding(.vertical, 8).background(Color.rrAccent.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
        }
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
    @State private var idPhotos = ""   // photo venue de l'app Photos : retirée de la photothèque une fois l'annonce publiée
    @State private var film = false    // ouvert depuis « Un film » : l'IA cherche un film sur la jaquette

    var body: some View {
        VStack(spacing: 18) {
            HStack {
                Text(etape == 2 ? "Vérifie la fiche" : film ? "Un film" : "Nouvel article").font(.title2.weight(.bold))
                Spacer()
                Button("Annuler") { fermer() }.keyboardShortcut(.cancelAction)
            }
            if etape < 2 {
                ZStack {
                    RoundedRectangle(cornerRadius: 26).strokeBorder(style: StrokeStyle(lineWidth: 2, dash: [8, 6])).foregroundStyle(cible ? Color.rrAccent : Color.secondary.opacity(0.4))
                    if let i = image { Image(nsImage: i).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 18)).padding(14) }
                    else {
                        VStack(spacing: 12) {
                            Image(systemName: film ? "film" : "camera.viewfinder").font(.system(size: 52, weight: .light)).foregroundStyle(Color.rrAccent)
                            Text(film ? "Glisse la photo de la jaquette ici" : "Glisse une photo ici").font(.title3.weight(.semibold))
                            Text(film ? LocalizedStringKey("Blu-Ray, Blu-Ray 4K UHD ou DVD : l'IA **reconnaît le film** et **remplit la fiche**.") : "L'IA **reconnaît le jeu, la console ou la carte** et **remplit la fiche**.").foregroundStyle(.secondary)
                            HStack(spacing: 10) {
                                Button { photosOuvert = true } label: { Label("Depuis Photos…", systemImage: "photo.on.rectangle.angled") }.boutonVerre(principal: true).controlSize(.large)
                                Button { choisir() } label: { Label("Un fichier…", systemImage: "folder") }.boutonVerre().controlSize(.large)
                            }
                        }
                    }
                    if etape == 1 {
                        VStack(spacing: 10) { ProgressView().controlSize(.large); Text(film ? "Je lis la jaquette…" : "Reconnaissance en cours…").font(.headline) }
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
                if !message.isEmpty { Text(message).foregroundStyle(Color.rrAccent).multilineTextAlignment(.center) }
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
                        Picker("Contenu", selection: $article.contenu) { ForEach(Libelles.contenus(pour: article.plateforme), id: \.0) { Text($0.1).tag($0.0) } }
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
                                if !n.photos.isEmpty { Phototheque.noter([id], pour: n.id) }   // retirée de Photos une fois l'annonce publiée
                            } else { etape = 2 }
                        }
                    } label: { Label("Créer l'article", systemImage: "checkmark") }
                    .boutonVerre(principal: true).controlSize(.large).keyboardShortcut(.defaultAction).disabled(article.titre.isEmpty || etape == 3)
                }
            }
        }
        .padding(26).frame(width: 560)
        .onAppear {
            film = appli.nouveauMode == "film"
            if film { article.categorie = "films" }
            if appli.nouveauMode == "main" { etape = 2 }
            appli.nouveauMode = ""
        }
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
            do { article = try await appli.identifier(d, indice: film ? "films" : ""); if film && article.categorie.isEmpty { article.categorie = "films" }; etape = 2 }
            catch { message = (error as? ErreurRR)?.message ?? "Reconnaissance impossible."; etape = 0 }
        }
    }
}

// MARK: Confettis (annonce publiée)

struct Fete: View {
    let titre: String
    @State private var debut = Date()
    private let couleurs: [Color] = [.rrAccent, .cyan, .indigo, Color(red: 0.73, green: 0.55, blue: 1), .white]
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
                Text("« \(titre) » est **en ligne** sur Le Bon Coin.").foregroundStyle(.secondary)
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


// MARK: Parcours de vente (haut de la fiche)

/// Le statut de l'article en grand : les étapes de la vente reliées, l'étape actuelle mise en avant, « Retiré » à part.
struct ParcoursStatut: View {
    @Binding var statut: String
    var enValidation = false
    var aPublier = false
    private let etapes = ["en_vente", "reserve", "vendu", "envoye", "recu"]
    private var rang: Int? { etapes.firstIndex(of: statut) }

    var body: some View {
        let cs = Libelles.couleursStatut(statut)
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                Image(systemName: enValidation ? "hourglass" : aPublier ? "paperplane" : Libelles.symboleStatut(statut)).font(.system(size: 22, weight: .bold))
                    .foregroundStyle(enValidation ? Color.orange : aPublier ? Color.secondary : cs.texte)
                    .frame(width: 50, height: 50).background(enValidation ? Color.orange.opacity(0.15) : aPublier ? Color.primary.opacity(0.08) : cs.fond, in: RoundedRectangle(cornerRadius: 14))
                VStack(alignment: .leading, spacing: 2) {
                    Text(enValidation ? "En validation" : aPublier ? "À publier" : Libelles.statut(statut)).font(.system(size: 24, weight: .heavy, design: .rounded))
                    Text(enValidation ? "Déposée : Le Bon Coin **doit encore la valider** avant qu'elle soit en ligne."
                         : aPublier ? "**Pas encore en ligne** : dépose-la sur Le Bon Coin et clique sur « Publier » pour la mettre en vente."
                         : LocalizedStringKey(Libelles.aideStatut(statut)))
                        .font(.callout).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Button { choisir(statut == "retire" ? "en_vente" : "retire") } label: {
                    Label(statut == "retire" ? "Remettre en vente" : "Retirer", systemImage: statut == "retire" ? "arrow.uturn.backward" : "archivebox")
                }.boutonVerre().help(statut == "retire" ? "Remettre l'article en vente" : "Plus en vente : l'article reste dans ta liste")
            }
            HStack(alignment: .top, spacing: 0) {
                ForEach(Array(etapes.enumerated()), id: \.offset) { i, e in
                    if i > 0 {
                        Capsule().fill(rang.map { i <= $0 } == true ? Color.rrAccent : Color.primary.opacity(0.12))
                            .frame(height: 4).padding(.top, 26).frame(maxWidth: .infinity)
                    }
                    etape(e, i)
                }
            }
            .padding(.horizontal, 6).padding(.bottom, 4)
            .opacity(statut == "retire" ? 0.45 : 1)
        }
        .padding(18).frame(maxWidth: .infinity, alignment: .leading).verre(RoundedRectangle(cornerRadius: 22))
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: statut)
    }

    private func etape(_ e: String, _ i: Int) -> some View {
        let fait = rang.map { i < $0 } ?? false, actuel = rang == i && !(aPublier && i == 0)
        return Button { choisir(e) } label: {
            VStack(spacing: 6) {
                // Le halo de l'étape actuelle tient DANS le cadre (56 pt) : rien ne déborde sur le libellé ni sur le bord de la carte.
                ZStack {
                    if actuel { Circle().fill(Color.rrAccent.opacity(0.22)) }
                    Circle().fill(actuel || fait ? Color.rrAccent : Color.primary.opacity(0.06)).padding(actuel ? 5 : 6)
                    Image(systemName: fait ? "checkmark" : Libelles.symboleStatut(e)).font(.system(size: actuel ? 18 : 16, weight: .bold))
                        .foregroundStyle(actuel || fait ? Color.white : Color.secondary)
                }
                .frame(width: 56, height: 56)
                Text(Libelles.statut(e)).font(.caption.weight(actuel ? .heavy : .semibold)).foregroundStyle(actuel ? Color.primary : Color.secondary).fixedSize()
            }.contentShape(Rectangle())
        }.buttonStyle(.plain).help(Libelles.aideStatut(e))
    }
    private func choisir(_ e: String) { withAnimation { statut = e } }
}


/// Glisser-déposer des vignettes de la fiche : la photo glissée prend la place de celle survolée.
struct OrdrePhotos: DropDelegate {
    let cible: Photo
    @Binding var photos: [Photo]
    @Binding var glissee: Photo?
    let fini: (Bool) -> Void
    func validateDrop(info: DropInfo) -> Bool { glissee != nil }
    func dropEntered(info: DropInfo) {
        guard let g = glissee, g != cible, let de = photos.firstIndex(of: g), let a = photos.firstIndex(of: cible) else { return }
        withAnimation(.easeOut(duration: 0.15)) { photos.move(fromOffsets: IndexSet(integer: de), toOffset: a > de ? a + 1 : a) }
    }
    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .move) }
    func performDrop(info: DropInfo) -> Bool {
        let bouge = glissee != nil
        glissee = nil
        fini(bouge)
        return true
    }
}
