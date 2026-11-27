// RetroRevente pour Mac : l'appli RetroRevente et Le Bon Coin dans une seule fenêtre, avec ce que faisait l'extension
// (remplissage du dépôt, réponses IA aux acheteurs, sons, confettis, synchro des prix et liens), sans Safari ni extension.
import AppKit
import UserNotifications

@MainActor
final class Delegue: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    var fenetre: Fenetre!

    func applicationDidFinishLaunching(_ n: Notification) {
        fenetre = Fenetre()
        NSApp.mainMenu = Menus.principal(cible: fenetre)
        UNUserNotificationCenter.current().delegate = self
        fenetre.montrerFenetre()
        MiseAJour.shared.demarrer()
    }
    // Mise à jour téléchargée mais pas encore installée (« Plus tard ») : elle s'installe à la fermeture.
    func applicationWillTerminate(_ n: Notification) { MiseAJour.shared.installer(relancer: false) }
    @objc func chercherMiseAJour(_ s: Any?) { Task { await MiseAJour.shared.verifier(manuel: true) } }
    func applicationShouldHandleReopen(_ s: NSApplication, hasVisibleWindows: Bool) -> Bool { fenetre.montrerFenetre(); return true }
    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { false }

    // Clic sur une notification : retour dans l'app.
    nonisolated func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive r: UNNotificationResponse, withCompletionHandler fini: @escaping () -> Void) {
        DispatchQueue.main.async { MainActor.assumeIsolated { self.fenetre.montrerFenetre() }; fini() }
    }
    nonisolated func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification, withCompletionHandler fini: @escaping (UNNotificationPresentationOptions) -> Void) {
        fini([.banner, .list])
    }

    @objc func aPropos(_ s: Any?) {
        let credits = NSAttributedString(string: "L'appli RetroRevente et Le Bon Coin réunis.\nExtension intégrée : version \(Extension.version).",
                                         attributes: [.font: NSFont.systemFont(ofSize: 11), .foregroundColor: NSColor.secondaryLabelColor])
        NSApp.orderFrontStandardAboutPanel(options: [.credits: credits])
        NSApp.activate(ignoringOtherApps: true)
    }
}

@MainActor
enum Menus {
    static func principal(cible f: Fenetre) -> NSMenu {
        let barre = NSMenu()
        func menu(_ titre: String, _ items: [NSMenuItem]) -> NSMenu {
            let m = NSMenu(title: titre); items.forEach(m.addItem)
            let i = NSMenuItem(title: titre, action: nil, keyEquivalent: ""); i.submenu = m; barre.addItem(i)
            return m
        }
        func item(_ titre: String, _ action: Selector?, _ touche: String = "", _ mod: NSEvent.ModifierFlags = .command, _ cible: AnyObject? = nil) -> NSMenuItem {
            let i = NSMenuItem(title: titre, action: action, keyEquivalent: touche)
            i.keyEquivalentModifierMask = mod; i.target = cible
            return i
        }
        let sep = { NSMenuItem.separator() }
        _ = menu("RetroRevente", [
            item("À propos de RetroRevente", #selector(Delegue.aPropos(_:)), "", [], NSApp.delegate as AnyObject),
            item("Rechercher les mises à jour…", #selector(Delegue.chercherMiseAJour(_:)), "", [], NSApp.delegate as AnyObject), sep(),
            item("Masquer RetroRevente", #selector(NSApplication.hide(_:)), "h"),
            item("Masquer les autres", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("Tout afficher", #selector(NSApplication.unhideAllApplications(_:))), sep(),
            item("Quitter RetroRevente", #selector(NSApplication.terminate(_:)), "q"),
        ])
        _ = menu("Édition", [
            item("Annuler", Selector(("undo:")), "z"), item("Rétablir", Selector(("redo:")), "z", [.command, .shift]), sep(),
            item("Couper", #selector(NSText.cut(_:)), "x"), item("Copier", #selector(NSText.copy(_:)), "c"),
            item("Coller", #selector(NSText.paste(_:)), "v"),
            item("Coller sans mise en forme", #selector(NSTextView.pasteAsPlainText(_:)), "v", [.command, .option, .shift]),
            item("Tout sélectionner", #selector(NSText.selectAll(_:)), "a"),
        ])
        _ = menu("Présentation", [
            item("Cacher ou montrer la barre latérale", #selector(Fenetre.basculerBarre(_:)), "s", [.command, .control], f),
            item("Mode clair / sombre", #selector(Fenetre.basculerApparence(_:)), "l", [.command, .shift], f),
            item("Suivre l'apparence de macOS", #selector(Fenetre.suivreApparenceSysteme(_:)), "", [], f), sep(),
            item("Recharger la page", #selector(Fenetre.rechargerPage(_:)), "r", .command, f), sep(),
            item("Taille réelle", #selector(Fenetre.tailleReelle(_:)), "0", .command, f),
            item("Agrandir", #selector(Fenetre.agrandir(_:)), "+", .command, f),
            item("Réduire", #selector(Fenetre.reduire(_:)), "-", .command, f), sep(),
            item("Plein écran", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])
        _ = menu("Fichier", [
            item("Nouvel article", #selector(Fenetre.nouvelArticle(_:)), "n", .command, f), sep(),
            item("Ouvrir RetroRevente sur le site", #selector(Fenetre.siteWeb(_:)), "", .command, f),
        ])
        _ = menu("Aller", [
            item("RetroRevente", #selector(Fenetre.allerAppli(_:)), "1", .command, f),
            item("Déposer une annonce", #selector(Fenetre.allerDeposer(_:)), "2", .command, f),
            item("Messages", #selector(Fenetre.allerMessages(_:)), "3", .command, f),
            sep(),
            item("Chercher un article", #selector(Fenetre.chercherArticle(_:)), "k", .command, f),
            item("Chercher l'article à déposer", #selector(Fenetre.ouvrirRecherche(_:)), "r", [.command, .option], f),
            item("Mon compte RetroRevente", #selector(Fenetre.afficherCompte(_:)), "k", [.command, .shift], f), sep(),
            item("Page précédente", #selector(Fenetre.precedente(_:)), "[", .command, f),
            item("Page suivante", #selector(Fenetre.suivante(_:)), "]", .command, f),
        ])
        let fen = menu("Fenêtre", [
            item("Réduire dans le Dock", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("Réduire / agrandir", #selector(NSWindow.performZoom(_:))), sep(),
            item("RetroRevente", #selector(Fenetre.afficherFenetre(_:)), "0", [.command, .option], f),
        ])
        NSApp.windowsMenu = fen
        return barre
    }
}

let app = NSApplication.shared
let delegue = MainActor.assumeIsolated { Delegue() }
app.delegate = delegue
app.setActivationPolicy(.regular)
app.run()
