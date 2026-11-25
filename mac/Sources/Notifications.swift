import AppKit
import SwiftUI
import Combine

// MARK: Centre de notifications de l'app (cloche en haut à droite)

/// Une notification gardée dans l'app : annonce prête, Le Bon Coin qui a besoin de toi, nouveau message…
struct NotifRR: Identifiable, Codable, Equatable {
    enum Cible: String, Codable { case aucune, article, messages, depot }
    var id = UUID()
    var date = Date()
    var titre: String
    var texte: String
    var symbole: String
    var cible: Cible = .aucune
    var article: String? = nil
    var lue = false
}

extension Appli {
    nonisolated private static let cleNotifs = "notificationsRR"
    /// Les 50 dernières, gardées d'un lancement à l'autre.
    nonisolated static func notifsEnregistrees() -> [NotifRR] {
        guard let d = UserDefaults.standard.data(forKey: cleNotifs), let l = try? JSONDecoder().decode([NotifRR].self, from: d) else { return [] }
        return l
    }
    func garderNotifs() {
        if let d = try? JSONEncoder().encode(Array(notifications.prefix(50))) { UserDefaults.standard.set(d, forKey: Appli.cleNotifs) }
    }
    func noter(_ titre: String, _ texte: String, symbole: String = "bell", cible: NotifRR.Cible = .aucune, article: String? = nil) {
        // Même alerte répétée dans la minute : on ne la note qu'une fois.
        if let p = notifications.first, p.titre == titre, p.texte == texte, Date().timeIntervalSince(p.date) < 60 { return }
        notifications.insert(NotifRR(titre: titre, texte: texte, symbole: symbole, cible: cible, article: article), at: 0)
        if notifications.count > 50 { notifications.removeLast(notifications.count - 50) }
        garderNotifs()
    }
    var notifsNonLues: Int { notifications.filter { !$0.lue }.count }
    func toutLire() {
        guard notifsNonLues > 0 else { return }
        for i in notifications.indices { notifications[i].lue = true }
        garderNotifs()
    }
}

/// Liste affichée dans la bulle de la cloche.
struct ListeNotifs: View {
    @ObservedObject var appli: Appli
    let ouvrir: (NotifRR) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Notifications").font(.headline)
                Spacer()
                if !appli.notifications.isEmpty {
                    Button("Tout effacer") { appli.notifications = []; appli.garderNotifs() }.buttonStyle(.link).font(.callout)
                }
            }.padding(.horizontal, 16).padding(.vertical, 12)
            Divider()
            if appli.notifications.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "bell.slash").font(.system(size: 28, weight: .light)).foregroundStyle(Color.rrOr)
                    Text("Rien de nouveau").font(.callout.weight(.semibold))
                    Text("Annonces prêtes à publier, messages et demandes de Le Bon Coin s'afficheront ici.")
                        .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }.frame(maxWidth: .infinity).padding(28)
            } else {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(appli.notifications) { n in
                            Button { ouvrir(n) } label: { ligne(n) }.buttonStyle(.plain)
                            Divider().padding(.leading, 52)
                        }
                    }
                }.frame(maxHeight: 420)
            }
        }
        .frame(width: 360)
    }
    private func ligne(_ n: NotifRR) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: n.symbole).font(.system(size: 14, weight: .semibold)).foregroundStyle(Color.rrOr)
                .frame(width: 28, height: 28).background(Color.rrOr.opacity(0.15), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(n.titre).font(.callout.weight(n.lue ? .regular : .bold)).lineLimit(1)
                    Spacer(minLength: 6)
                    Text(n.date, style: .relative).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                if !n.texte.isEmpty { Text(n.texte).font(.caption).foregroundStyle(.secondary).lineLimit(3).fixedSize(horizontal: false, vertical: true) }
            }
            if !n.lue { Circle().fill(Color.rrOr).frame(width: 8, height: 8).padding(.top, 6) }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}

/// La cloche : bulle avec la liste, pastille dorée tant qu'il reste des notifications non lues.
@MainActor
final class Cloche: NSObject {
    private unowned let fenetre: Fenetre
    let bouton: Bouton
    private let bulle = NSPopover()
    private var suivi: AnyCancellable?
    init(fenetre: Fenetre) {
        self.fenetre = fenetre
        var ouvrir: (() -> Void)?
        bouton = Bouton(symbole: "bell", titre: nil, aide: "Notifications") { ouvrir?() }
        super.init()
        ouvrir = { [weak self] in self?.basculer() }
        bulle.behavior = .transient; bulle.animates = true
        suivi = fenetre.modele.$notifications.receive(on: RunLoop.main).sink { [weak self] l in
            let n = l.filter { !$0.lue }.count
            self?.bouton.pastille = n
            self?.bouton.toolTip = n > 0 ? "Notifications (\(n) nouvelle\(n > 1 ? "s" : ""))" : "Notifications"
        }
    }
    func basculer() {
        if bulle.isShown { bulle.performClose(nil); return }
        let m = fenetre.modele
        let c = NSHostingController(rootView: ListeNotifs(appli: m) { [weak self] n in self?.ouvrir(n) })
        bulle.contentViewController = c
        bulle.show(relativeTo: bouton.bounds, of: bouton, preferredEdge: .minY)
        // Vues en ouvrant la bulle : la pastille s'éteint un instant après.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { m.toutLire() }
    }
    private func ouvrir(_ n: NotifRR) {
        bulle.performClose(nil)
        let m = fenetre.modele
        switch n.cible {
        case .messages: fenetre.aller(.messages)
        case .article, .depot:
            fenetre.aller(.appli)
            if let a = n.article, m.parId(a) != nil { m.selection = a }
        case .aucune: break
        }
    }
}
