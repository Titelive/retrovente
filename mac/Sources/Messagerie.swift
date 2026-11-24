import AppKit
import SwiftUI
import WebKit

// Messagerie native : la messagerie Le Bon Coin reste chargée dans un navigateur caché, posé au fond de la fenêtre et
// jamais affiché. L'app lit la liste des conversations et leurs messages (lbc.js, window.rrMessagerie), propose les
// réponses de l'IA et n'envoie un message que sur un clic « Envoyer ».

struct ConversationLbc: Identifiable, Equatable {
    let cle: String; let lignes: [String]; let image: String; let nonLu: Bool
    var id: String { cle }
    var nom: String { lignes.first ?? "Conversation" }
    /// Lignes hors nom et date : titre de l'annonce, puis dernier message.
    var details: [String] { Array(lignes.dropFirst().filter { !ConversationLbc.estDate($0) }.prefix(2)) }
    var date: String { lignes.dropFirst().first(where: ConversationLbc.estDate) ?? "" }
    static func estDate(_ s: String) -> Bool {
        s.range(of: #"^(il y a .*|hier.*|aujourd'hui.*|\d{1,2}[:h]\d{2}|\d{1,2}/\d{1,2}(/\d{2,4})?|(lun|mar|mer|jeu|ven|sam|dim)\w*\.?|\d{1,2} \p{L}+\.?( \d{4})?)$"#, options: [.regularExpression, .caseInsensitive]) != nil
    }
    init(_ d: [String: Any]) {
        cle = d["cle"] as? String ?? UUID().uuidString; lignes = d["lignes"] as? [String] ?? []
        image = d["image"] as? String ?? ""; nonLu = d["nonLu"] as? Bool ?? false
    }
}

struct MessageLbc: Identifiable, Equatable {
    let id: Int; let cote: String; let texte: String; let meta: String
}

struct FilLbc: Equatable {
    var cle = "", acheteur = "", annonce: [String] = [], dernierMoi = false, messages: [MessageLbc] = []
    init() {}
    init(_ d: [String: Any]) {
        cle = d["cle"] as? String ?? ""; acheteur = d["acheteur"] as? String ?? ""; annonce = d["annonce"] as? [String] ?? []
        dernierMoi = d["dernierMoi"] as? Bool ?? false
        messages = (d["messages"] as? [[String: Any]] ?? []).enumerated().map { i, m in
            MessageLbc(id: i, cote: m["cote"] as? String ?? "lui", texte: m["texte"] as? String ?? "", meta: m["meta"] as? String ?? "")
        }
    }
}

struct ReponseIA: Identifiable, Equatable {
    let id = UUID(); let approche: String; let titre: String; let texte: String
}

@MainActor
final class Messagerie: NSObject, ObservableObject, WKNavigationDelegate {
    enum Etat: Equatable { case veille, chargement, pret, connexion, erreur(String) }
    @Published var etat: Etat = .veille
    @Published var conversations: [ConversationLbc] = []
    @Published var ouverte: String? = nil
    @Published var fil = FilLbc()
    @Published var filCharge = false
    @Published var reponses: [ReponseIA] = []
    @Published var resume = ""
    @Published var iaCharge = false
    @Published var iaErreur = ""
    @Published var brouillon = ""
    @Published var envoi = false
    @Published var avis = ""

    weak var fenetre: Fenetre?
    private var vue: WKWebView?
    private var minuterie: Timer?
    private var charge = false

    /// À l'ouverture de l'onglet Messages : la messagerie se charge en fond (une fois), puis se relit régulièrement.
    func demarrer(_ f: Fenetre) {
        fenetre = f
        guard ProcessInfo.processInfo.environment["RR_DEMO"] == nil else { return }
        if vue == nil {
            let v = f.navigateurCache()
            v.navigationDelegate = self
            f.accueillirEnFond(v)
            vue = v
        }
        if !charge { recharger() } else { Task { await lire() } }
        minuterie?.invalidate()
        minuterie = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in Task { @MainActor in await self?.lire() } }
    }
    /// Captures de démonstration (CI) : une messagerie fictive.
    func demo() {
        etat = .pret
        conversations = [
            ConversationLbc(["cle": "c1", "lignes": ["Garnier", "Lot Nintendo 64 : 2 jeux", "Bonjour, je peux passer ce soir ?", "14:32"], "nonLu": true]),
            ConversationLbc(["cle": "c2", "lignes": ["EM54Retro", "Super Mario 64", "Merci, bien reçu !", "hier"]]),
            ConversationLbc(["cle": "c3", "lignes": ["Evelyne", "Dracaufeu holo 4/102", "Vous feriez 150 € ?", "lun."]]),
        ]
        ouverte = "c1"
        fil = FilLbc(["cle": "c1", "acheteur": "Garnier", "annonce": ["Lot Nintendo 64 : 2 jeux", "75 €"], "messages": [
            ["cote": "centre", "texte": "Aujourd'hui"],
            ["cote": "lui", "texte": "Bonjour, votre lot est toujours disponible ? Vous feriez 60 € ?", "meta": "14:28"],
            ["cote": "moi", "texte": "Bonjour Garnier ! Oui, il est disponible 🙂 Je peux le laisser à 70 €.", "meta": "14:30 · Lu"],
            ["cote": "lui", "texte": "D'accord pour 70 €. Je peux passer ce soir ?", "meta": "14:32"],
        ]])
        resume = "Garnier accepte 70 € et propose de passer ce soir."
        reponses = [
            ReponseIA(approche: "accepter", titre: "Confirmer le rendez-vous", texte: "Parfait, ce soir ça me va ! À partir de 18 h, je vous envoie l'adresse 🙂"),
            ReponseIA(approche: "ferme", titre: "Proposer l'envoi", texte: "Super ! Si c'est plus simple, je peux aussi l'envoyer avec le paiement sécurisé 🙂"),
        ]
    }
    func arreter() { minuterie?.invalidate(); minuterie = nil }

    func recharger() {
        guard let v = vue else { return }
        etat = .chargement; charge = true
        v.load(URLRequest(url: URL(string: "https://www.leboncoin.fr/messages")!))
    }

    func webView(_ v: WKWebView, didFinish n: WKNavigation!) {
        Task { for d in [1.0, 2.5, 5.0] { try? await Task.sleep(nanoseconds: UInt64(d * 1e9)); await lire(); if !conversations.isEmpty { break } } }
    }
    func webView(_ v: WKWebView, didFail n: WKNavigation!, withError e: Error) { etat = .erreur("Le Bon Coin ne répond pas.") }
    func webView(_ v: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { etat = .erreur("Le Bon Coin ne répond pas. Vérifie ta connexion.") }

    private func appel(_ js: String, _ args: [String: Any] = [:]) async -> [String: Any]? {
        guard let v = vue else { return nil }
        let r = try? await v.callAsyncJavaScript("if (!window.rrMessagerie) return null; " + js, arguments: args, in: nil, in: Scripts.monde)
        return r as? [String: Any]
    }

    /// Relit la liste (et le fil ouvert) sans rien toucher sur la page.
    func lire() async {
        guard let r = await appel("return window.rrMessagerie.liste();") else { return }
        if (r["connexion"] as? Bool) == true { etat = .connexion; return }
        let l = (r["conversations"] as? [[String: Any]] ?? []).map(ConversationLbc.init)
        if l != conversations { conversations = l }
        if !l.isEmpty || charge { etat = .pret }
        if ouverte != nil, let f = r["fil"] as? [String: Any] {
            let n = FilLbc(f)
            if n.cle == fil.cle, n != fil {
                let nouveau = n.messages.count != fil.messages.count
                fil = n
                if nouveau && !n.dernierMoi { reponses = []; Task { await proposer() } }
            }
        }
    }

    func ouvrir(_ c: ConversationLbc) async {
        guard !filCharge else { return }
        ouverte = c.cle; filCharge = true; reponses = []; resume = ""; iaErreur = ""; brouillon = ""; avis = ""
        defer { filCharge = false }
        guard let r = await appel("return await window.rrMessagerie.ouvrir(cle);", ["cle": c.cle]) else { return }
        if r["erreur"] != nil { avis = "Cette conversation n'est plus dans la liste."; await lire(); return }
        fil = FilLbc(r)
        await lire()
        if !fil.dernierMoi { await proposer() }
    }

    /// Réponses de l'IA pour la conversation ouverte (avec une consigne : « dis-lui que… »).
    func proposer(_ consigne: String = "") async {
        guard ouverte != nil, !iaCharge else { return }
        iaCharge = true; iaErreur = ""; defer { iaCharge = false }
        guard let r = await appel("return await window.rrMessagerie.suggestions(consigne);", ["consigne": consigne]) else { iaErreur = "L'IA ne répond pas."; return }
        if let e = r["erreur"] as? String { iaErreur = e; return }
        resume = r["resume"] as? String ?? ""
        reponses = (r["reponses"] as? [[String: Any]] ?? []).map { ReponseIA(approche: $0["approche"] as? String ?? "", titre: $0["titre"] as? String ?? "", texte: $0["texte"] as? String ?? "") }
    }

    /// Seulement sur le clic « Envoyer » : écrit le message dans Le Bon Coin (caché) et clique son bouton d'envoi.
    func envoyer() async {
        let t = brouillon.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !envoi, ouverte != nil else { return }
        envoi = true; avis = ""; defer { envoi = false }
        guard let r = await appel("return await window.rrMessagerie.envoyer(texte);", ["texte": t]) else { avis = "Envoi impossible : Le Bon Coin ne répond pas."; return }
        if let e = r["erreur"] as? String { avis = e; return }
        brouillon = ""; reponses = []; resume = ""
        if let f = r["fil"] as? [String: Any] { fil = FilLbc(f) }
        avis = (r["incertain"] as? Bool) == true ? "Message parti ? Je ne vois pas encore la confirmation de Le Bon Coin : vérifie dans un instant." : ""
        await lire()
    }
}

// MARK: Vues

struct MessagesVue: View {
    @ObservedObject var appli: Appli
    @ObservedObject var m: Messagerie
    @State private var consigne = ""

    var body: some View {
        HStack(spacing: 0) {
            liste.frame(width: 320)
            Divider()
            detail.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Color(nsColor: .windowBackgroundColor).ignoresSafeArea())
        .onAppear { if let f = appli.fenetre { m.demarrer(f) } }
        .onDisappear { m.arreter() }
    }

    private var liste: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Messages").font(.system(size: 26, weight: .heavy, design: .rounded))
                Spacer()
                Button { m.recharger() } label: { Image(systemName: "arrow.clockwise") }.boutonVerre().help("Relire la messagerie Le Bon Coin")
            }.padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 10)
            switch m.etat {
            case .veille, .chargement where m.conversations.isEmpty:
                VStack(spacing: 10) { ProgressView(); Text("Je lis ta messagerie Le Bon Coin…").foregroundStyle(.secondary) }.frame(maxWidth: .infinity, maxHeight: .infinity)
            case .connexion:
                VStack(spacing: 10) {
                    Image(systemName: "person.crop.circle.badge.exclamationmark").font(.system(size: 36)).foregroundStyle(Color.rrOr)
                    Text("Le Bon Coin te demande de te connecter.").multilineTextAlignment(.center)
                    Button("Ouvrir Le Bon Coin") { appli.fenetre?.allerSurLeSite(.messages) }.boutonVerre(principal: true)
                }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity)
            case .erreur(let t):
                VStack(spacing: 10) { Text(t).multilineTextAlignment(.center); Button("Réessayer") { m.recharger() }.boutonVerre() }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity)
            default:
                if m.conversations.isEmpty {
                    Text("Aucune conversation pour l'instant.").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 4) {
                            ForEach(m.conversations) { c in ligne(c) }
                        }.padding(.horizontal, 10).padding(.bottom, 12)
                    }
                }
            }
            Divider()
            Button { appli.fenetre?.allerSurLeSite(.messages) } label: { Label("Ouvrir sur Le Bon Coin", systemImage: "safari") }
                .buttonStyle(.link).font(.callout).padding(12)
        }
        .background(.regularMaterial)
    }

    private func ligne(_ c: ConversationLbc) -> some View {
        let active = m.ouverte == c.cle
        return Button { Task { await m.ouvrir(c) } } label: {
            HStack(alignment: .top, spacing: 10) {
                AsyncImage(url: URL(string: c.image)) { i in i.resizable().scaledToFill() } placeholder: { Color.rrOr.opacity(0.15).overlay(Image(systemName: "bubble.left").foregroundStyle(Color.rrOr)) }
                    .frame(width: 46, height: 46).clipShape(RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(c.nom).font(.callout.weight(c.nonLu ? .heavy : .semibold)).lineLimit(1)
                        Spacer(minLength: 4)
                        Text(c.date).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    ForEach(Array(c.details.enumerated()), id: \.offset) { i, t in
                        Text(t).font(i == 0 ? .caption.weight(.medium) : .caption).foregroundStyle(i == 0 ? .primary : .secondary).lineLimit(1)
                    }
                }
                if c.nonLu { Circle().fill(Color.rrOr).frame(width: 9, height: 9).padding(.top, 6) }
            }
            .padding(8).contentShape(Rectangle())
            .background(active ? Color.accentColor.opacity(0.18) : Color.clear, in: RoundedRectangle(cornerRadius: 12))
        }.buttonStyle(.plain)
    }

    @ViewBuilder private var detail: some View {
        if m.ouverte == nil {
            VStack(spacing: 12) {
                Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 46, weight: .light)).foregroundStyle(Color.rrOr)
                Text("Choisis une conversation").font(.title3.weight(.semibold))
                Text("L'IA lit le dernier message et te propose des réponses. Rien ne part sans ton clic.").foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            VStack(spacing: 0) {
                entete
                Divider()
                ScrollViewReader { p in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 8) {
                            if m.filCharge { ProgressView().frame(maxWidth: .infinity).padding() }
                            ForEach(m.fil.messages) { msg in bulle(msg).id(msg.id) }
                        }.padding(18)
                    }
                    .onChange(of: m.fil.messages.count) { _ in if let d = m.fil.messages.last { withAnimation { p.scrollTo(d.id, anchor: .bottom) } } }
                    .onAppear { if let d = m.fil.messages.last { p.scrollTo(d.id, anchor: .bottom) } }
                }
                Divider()
                redaction
            }
        }
    }

    private var entete: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(m.fil.acheteur.isEmpty ? (m.conversations.first { $0.cle == m.ouverte }?.nom ?? "Conversation") : m.fil.acheteur).font(.title3.weight(.heavy)).lineLimit(1)
                Text(m.fil.annonce.prefix(2).joined(separator: " · ")).font(.callout).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
        }.padding(.horizontal, 18).padding(.vertical, 12)
    }

    private func bulle(_ msg: MessageLbc) -> some View {
        Group {
            if msg.cote == "centre" {
                Text(msg.texte).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: .infinity)
            } else {
                HStack {
                    if msg.cote == "moi" { Spacer(minLength: 80) }
                    VStack(alignment: msg.cote == "moi" ? .trailing : .leading, spacing: 3) {
                        Text(msg.texte).textSelection(.enabled)
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .background(msg.cote == "moi" ? Color.rrOr.opacity(0.85) : Color.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 16))
                            .foregroundStyle(msg.cote == "moi" ? Color.rrNuit : Color.primary)
                        if !msg.meta.isEmpty { Text(msg.meta).font(.caption2).foregroundStyle(.secondary) }
                    }
                    if msg.cote != "moi" { Spacer(minLength: 80) }
                }
            }
        }
    }

    private var redaction: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Label("L'IA te propose", systemImage: "sparkles").font(.callout.weight(.bold)).foregroundStyle(Color.rrOr)
                if m.iaCharge { ProgressView().controlSize(.small) }
                Spacer()
                Button("Autres idées") { Task { await m.proposer() } }.boutonVerre().disabled(m.iaCharge)
            }
            if !m.iaErreur.isEmpty { Text(m.iaErreur).font(.callout).foregroundStyle(.orange) }
            else if m.fil.dernierMoi && m.reponses.isEmpty && !m.iaCharge { Text("Tu as répondu en dernier : je te proposerai une réponse dès que l'acheteur écrit.").font(.callout).foregroundStyle(.secondary) }
            else if !m.resume.isEmpty { Text(m.resume).font(.callout).foregroundStyle(.secondary).lineLimit(2) }
            if !m.reponses.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 8) {
                        ForEach(m.reponses) { r in
                            Button { m.brouillon = r.texte } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(r.titre.isEmpty ? "Réponse" : r.titre).font(.caption.weight(.bold))
                                    Text(r.texte).font(.caption).foregroundStyle(.secondary).lineLimit(4).multilineTextAlignment(.leading)
                                }.frame(width: 230, alignment: .leading).padding(10)
                                .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
                                .overlay(RoundedRectangle(cornerRadius: 12).stroke(m.brouillon == r.texte ? Color.rrOr : Color.clear, lineWidth: 2))
                            }.buttonStyle(.plain).help("Placer cette réponse dans le message (tu peux la modifier)")
                        }
                    }
                }
            }
            HStack(spacing: 6) {
                TextField("Dis à l'IA quoi répondre (ex. « propose 40 € »)", text: $consigne).textFieldStyle(.roundedBorder)
                    .onSubmit { let c = consigne; consigne = ""; Task { await m.proposer(c) } }
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextEditor(text: $m.brouillon).font(.body).frame(minHeight: 60, maxHeight: 130).scrollContentBackground(.hidden)
                    .padding(6).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
                Button { Task { await m.envoyer() } } label: {
                    HStack { if m.envoi { ProgressView().controlSize(.small) }; Label("Envoyer", systemImage: "paperplane.fill") }
                }
                .boutonVerre(principal: true).keyboardShortcut(.return, modifiers: .command)
                .disabled(m.envoi || m.brouillon.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .help("Envoie ce message à l'acheteur sur Le Bon Coin (⌘↩)")
            }
            if !m.avis.isEmpty { Text(m.avis).font(.callout).foregroundStyle(.orange) }
        }.padding(16)
    }
}
