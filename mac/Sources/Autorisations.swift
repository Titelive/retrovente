// « Autoriser sans tout ouvrir » : l'explication commune aux apps de Titelive pour l'écran d'accès complet de macOS 27.3.
//
// Depuis macOS 27.3, Réglages Système › Confidentialité et sécurité propose « System & App Protection Override ».
// Si l'on choisit l'accès complet, macOS affiche « Votre Mac ne pourra pas protéger vos données contre « App » »
// avec 5 rubriques, un bouton OK par ligne et, en bas, « Allow System & App Protection Override » + « Annuler ».
// RetroRevente n'a pas besoin de cet accès complet : on explique l'écran, on dit de cliquer Annuler, puis de n'accorder
// QUE ce dont l'app a besoin (Photos, Notifications). On n'apprend jamais à tout accepter.
// Repris du module TiteliveOnboarding (AutorisationsPage.swift), adapté à macOS 13 et à la compilation sans Xcode.
import AppKit
import SwiftUI

/// Intitulés exacts de macOS 27.3 (relevés dans SecurityPrivacyExtension, langue française).
enum IntitulesMacOS {
    static let reglage = "System & App Protection Override"
    static let boutonInterdit = "Allow System & App Protection Override"
    static func titreAlerte(_ app: String) -> String { "Votre Mac ne pourra pas protéger vos données contre « \(app) »." }
    /// Les 5 rubriques de l'écran, telles que macOS les affiche (non traduites dans macOS 27.3).
    static let rubriques = [
        "Read, Change, Delete, and Export All Your Data",
        "View Hidden and Recently Deleted Photos",
        "View History and Browse As You",
        "Control Your Mac, Apps, and Settings",
        "Read and Monitor Everything",
    ]
}

enum AutorisationsTexte {
    /// Texte de l'explication (markdown : mots clés en gras). RetroRevente tutoie.
    static func message(appName: String, besoins: String, facultatif: String?) -> String {
        var t = "Si tu choisis l'accès complet, macOS affiche « Votre Mac ne pourra pas protéger vos données contre « \(appName) » ». "
            + "\(appName) **n'en a pas besoin** : clique **Annuler** en bas à droite, sans cliquer sur les **OK** des rubriques, et ne clique **jamais** sur « **\(IntitulesMacOS.boutonInterdit)** ». "
            + "Accorde seulement : \(besoins)."
        if let facultatif { t += " Facultatif : \(facultatif)." }
        return t
    }
    static func attribue(_ text: String) -> AttributedString {
        guard text.contains("**") else { return AttributedString(text) }
        return (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }
}

@MainActor
enum Autorisations {
    static let appName = "RetroRevente"
    static let besoins = "**Photos** (pour retirer de ta photothèque les photos envoyées, si tu le veux) et les **Notifications** (ventes, messages)"
    private static var fenetre: NSWindow?
    private static let cleVue = "autorisations273Vue"

    /// macOS 27.3 ou plus récent : là où l'écran d'accès complet existe.
    static var concerne: Bool {
        ProcessInfo.processInfo.isOperatingSystemAtLeast(OperatingSystemVersion(majorVersion: 27, minorVersion: 3, patchVersion: 0))
    }

    /// Une seule fois, au premier lancement sur macOS 27.3 (jamais en mode démo des captures).
    static func montrerUneFoisSiBesoin() {
        guard concerne, ProcessInfo.processInfo.environment["RR_DEMO"] == nil,
              !UserDefaults.standard.bool(forKey: cleVue) else { return }
        UserDefaults.standard.set(true, forKey: cleVue)
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { montrer() }
    }

    /// Fenêtre d'explication (menu Aide › Autoriser sans tout ouvrir).
    static func montrer() {
        if let f = fenetre { f.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return }
        let vue = AutorisationsExplication(appName: appName, besoins: besoins, fermer: { fenetre?.close() })
        let f = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 528, height: 520), styleMask: [.titled, .closable, .fullSizeContentView],
                         backing: .buffered, defer: false)
        f.title = "Autoriser sans tout ouvrir"
        f.titlebarAppearsTransparent = true
        f.isReleasedWhenClosed = false
        f.contentViewController = NSHostingController(rootView: vue)
        f.center()
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: f, queue: .main) { _ in
            MainActor.assumeIsolated { fenetre = nil }
        }
        fenetre = f
        f.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}

/// Explication complète : illustration animée + texte + boutons.
struct AutorisationsExplication: View {
    let appName: String
    let besoins: String
    var facultatif: String? = nil
    var fermer: () -> Void = {}
    private let accent = Color.rrAccent

    var body: some View {
        VStack(spacing: 14) {
            AutorisationsIllustration(appName: appName, accent: accent)
                .frame(width: 480, height: 230)
                .verre(RoundedRectangle(cornerRadius: 24, style: .continuous), teinte: accent.opacity(0.25))
            HStack(spacing: 10) {
                Image(systemName: "lock.shield").foregroundStyle(accent)
                Text("Autoriser sans tout ouvrir")
            }
            .font(.system(size: 22, weight: .bold, design: .rounded))
            Text(AutorisationsTexte.attribue(AutorisationsTexte.message(appName: appName, besoins: besoins, facultatif: facultatif)))
                .font(.body)
                .foregroundStyle(.primary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 480)
            HStack(spacing: 10) {
                Button("Ouvrir Confidentialité et sécurité") {
                    if let u = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy") { NSWorkspace.shared.open(u) }
                }
                .boutonVerre()
                Button("J'ai compris", action: fermer).boutonVerre(principal: true).keyboardShortcut(.defaultAction)
            }
            .controlSize(.large)
        }
        .padding(24)
        .padding(.top, 12)
        .frame(width: 528)
        .tint(accent)
    }
}

/// Miniature animée de l'écran macOS : 5 rubriques et leurs cadenas, bouton d'accès complet barré,
/// « Annuler » mis en avant. Couleurs système uniquement, clair et sombre.
struct AutorisationsIllustration: View {
    let appName: String
    let accent: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// 0 : écran affiché ; 1 : les rubriques s'allument (tout serait ouvert) ; 2 : le pointeur va sur « Annuler ».
    @State private var phase = 0

    var body: some View {
        panel(reduceMotion ? 2 : phase)
            .task {
                // PhaseAnimator n'existe qu'à partir de macOS 14 : boucle équivalente.
                guard !reduceMotion else { return }
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 1_700_000_000)
                    withAnimation(.easeInOut(duration: 0.7)) { phase = (phase + 1) % 3 }
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Écran macOS « Votre Mac ne pourra pas protéger vos données contre « \(appName) » » : clique Annuler, jamais « \(IntitulesMacOS.boutonInterdit) ».")
    }

    private func panel(_ phase: Int) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.shield.fill").foregroundStyle(.orange)
                Text(IntitulesMacOS.titreAlerte(appName))
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            VStack(spacing: 3) {
                ForEach(Array(IntitulesMacOS.rubriques.enumerated()), id: \.offset) { i, rubrique in
                    row(rubrique, lit: phase == 1 && i < 2)
                }
            }
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                // Le bouton à ne jamais cliquer : barré, estompé, marqué d'une croix rouge.
                HStack(spacing: 4) {
                    Image(systemName: "xmark.octagon.fill").foregroundStyle(.red)
                    Text(IntitulesMacOS.boutonInterdit)
                        .strikethrough(true, color: .red)
                        .foregroundStyle(.red)
                        .lineLimit(1)
                }
                .font(.system(size: 9.5, weight: .medium))
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(Capsule().fill(Color.red.opacity(0.1)))
                .overlay(Capsule().strokeBorder(Color.red.opacity(0.45), style: StrokeStyle(lineWidth: 1, dash: [3, 2])))
                .opacity(0.7)
                // Le bon geste : « Annuler », en bas à droite.
                Text("Annuler")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14).padding(.vertical, 5)
                    .background(Capsule().fill(accent))
                    .overlay(Capsule().strokeBorder(accent.opacity(0.5), lineWidth: phase == 2 ? 4 : 0).padding(-3))
                    .scaleEffect(phase == 2 ? 1.08 : 1)
                    .overlay(alignment: .bottomTrailing) {
                        Image(systemName: "cursorarrow")
                            .font(.system(size: 18))
                            .foregroundStyle(.primary)
                            .offset(x: phase == 2 ? 6 : 60, y: phase == 2 ? 14 : 40)
                            .opacity(phase == 2 ? 1 : 0)
                    }
            }
            .padding(.top, 2)
        }
        .padding(12)
        .frame(width: 430)
        .scaleEffect(0.92)
        .background {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(.regularMaterial)
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(accent.opacity(0.06)))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(accent.opacity(0.35)))
        }
    }

    /// Comme dans macOS 27.3 : un seul bouton par rubrique. « OK » (rouge) ouvrirait le cadenas ; il ne faut en cliquer aucun.
    private func row(_ title: String, lit: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: lit ? "lock.open.fill" : "lock.fill")
                .foregroundStyle(lit ? Color.red : accent)
                .frame(width: 14)
            Text(title)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.primary)
                .lineLimit(1)
            Spacer(minLength: 4)
            miniButton(lit ? "Annuler" : "OK", red: !lit)
        }
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(RoundedRectangle(cornerRadius: 7).fill(lit ? Color.red.opacity(0.07) : accent.opacity(0.06)))
    }

    private func miniButton(_ label: String, red: Bool) -> some View {
        Text(label)
            .font(.system(size: 8.5, weight: .semibold))
            .foregroundStyle(red ? Color.red : Color.primary)
            .frame(minWidth: 34)
            .padding(.horizontal, 6).padding(.vertical, 1.5)
            .background(Capsule().fill(accent.opacity(0.12)))
    }
}
