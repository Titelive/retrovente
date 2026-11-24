// La barre du haut, à la charte RetroRevente : fond nuit, icônes au trait dorées, onglet actif en pastille dorée.
import AppKit

enum Charte {
    static func rvb(_ hex: UInt32, _ a: CGFloat = 1) -> NSColor {
        NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: a)
    }
    static let nuit = rvb(0x1A1A1A)
    static let or = rvb(0xF5C542)
    static let orClair = rvb(0xFFE27A)
    static let encre = rvb(0xF4F4EE)
    static let gris = rvb(0xA6A69E)
    /// Liquid Glass (macOS 26) : la barre devient du verre posé sur la page.
    static var verre: Bool { if #available(macOS 26.0, *) { return true }; return false }
    /// Texte de la barre : blanc sur la barre nuit ; sur le verre, la couleur du système (lisible en clair et en sombre).
    static var texte: NSColor { verre ? .labelColor : encre }
    /// Or des icônes : plus soutenu sur verre clair pour rester lisible.
    static let orIcone = NSColor(name: nil) { a in
        a.bestMatch(from: [.aqua, .darkAqua]) == .aqua ? rvb(0xB98200) : rvb(0xF5C542)
    }

    static func police(_ taille: CGFloat, _ graisse: NSFont.Weight = .semibold) -> NSFont {
        let f = NSFont.systemFont(ofSize: taille, weight: graisse)
        if let d = f.fontDescriptor.withDesign(.rounded) { return NSFont(descriptor: d, size: taille) ?? f }
        return f
    }
    static func symbole(_ nom: String, _ taille: CGFloat = 15) -> NSImage? {
        let i = NSImage(systemSymbolName: nom, accessibilityDescription: nil)
        return i?.withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: taille, weight: .medium))
    }
}

/// Bouton de la barre : icône au trait dorée, texte facultatif. `actif` : pastille dorée (onglet affiché).
final class Bouton: NSView {
    private let action: () -> Void
    private let icone = NSImageView()
    private let texte: NSTextField?
    private var survol = false { didSet { needsDisplay = true } }
    private var appui = false { didSet { needsDisplay = true } }
    var actif = false { didSet { majCouleurs(); needsDisplay = true } }
    var disponible = true { didSet { alphaValue = disponible ? 1 : 0.35 } }

    init(symbole: String, titre: String?, aide: String, action: @escaping () -> Void) {
        self.action = action
        texte = titre.map { NSTextField(labelWithString: $0) }
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        icone.image = Charte.symbole(symbole)
        icone.imageScaling = .scaleProportionallyDown
        let pile = NSStackView(views: [icone] + (texte.map { [$0] } ?? []))
        pile.orientation = .horizontal; pile.spacing = 7
        pile.edgeInsets = NSEdgeInsets(top: 0, left: texte == nil ? 7 : 12, bottom: 0, right: texte == nil ? 7 : 14)
        pile.translatesAutoresizingMaskIntoConstraints = false
        addSubview(pile)
        texte?.font = Charte.police(13)
        NSLayoutConstraint.activate([
            pile.leadingAnchor.constraint(equalTo: leadingAnchor), pile.trailingAnchor.constraint(equalTo: trailingAnchor),
            pile.centerYAnchor.constraint(equalTo: centerYAnchor), heightAnchor.constraint(equalToConstant: 30),
            icone.widthAnchor.constraint(equalToConstant: 18),
        ])
        toolTip = aide
        setAccessibilityElement(true); setAccessibilityRole(.button); setAccessibilityLabel(titre ?? aide)
        majCouleurs()
    }
    required init?(coder: NSCoder) { fatalError() }

    private func majCouleurs() {
        if Charte.verre {
            icone.contentTintColor = Charte.orIcone
            texte?.textColor = .labelColor
            texte?.font = Charte.police(13, actif ? .bold : .semibold)
        } else {
            icone.contentTintColor = actif ? Charte.orClair : Charte.or
            texte?.textColor = actif ? Charte.orClair : Charte.encre
        }
    }
    override func draw(_ dirtyRect: NSRect) {
        let fond: NSColor? = actif ? Charte.or.withAlphaComponent(appui ? 0.26 : 0.18)
            : appui ? Bouton.voile.withAlphaComponent(0.14) : survol && disponible ? Bouton.voile.withAlphaComponent(0.08) : nil
        guard let f = fond else { return }
        f.setFill()
        NSBezierPath(roundedRect: bounds, xRadius: bounds.height / 2, yRadius: bounds.height / 2).fill()
        if actif {
            Charte.or.withAlphaComponent(0.55).setStroke()
            let p = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: bounds.height / 2 - 0.5, yRadius: bounds.height / 2 - 0.5)
            p.lineWidth = 1; p.stroke()
        }
    }
    private static var voile: NSColor { Charte.verre ? .labelColor : .white }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    /// Change l'icône (bouton clair / sombre).
    func changerSymbole(_ nom: String, aide: String) { icone.image = Charte.symbole(nom); toolTip = aide; majCouleurs() }
    /// Appelé quand la souris arrive sur le bouton (barre latérale : elle s'aperçoit au survol).
    var auSurvol: (() -> Void)?
    override func mouseEntered(with event: NSEvent) { survol = true; auSurvol?() }
    override func mouseExited(with event: NSEvent) { survol = false; appui = false }
    override func mouseDown(with event: NSEvent) { if disponible { appui = true } }
    override func mouseUp(with event: NSEvent) {
        let dedans = bounds.contains(convert(event.locationInWindow, from: nil))
        if appui && dedans { action() }
        appui = false
    }
    override var mouseDownCanMoveWindow: Bool { false }
    override func accessibilityPerformPress() -> Bool { if disponible { action() }; return true }
}

/// Fond de la barre du haut : nuit, avec un filet en bas. Les zones vides déplacent la fenêtre (comme une barre de titre).
final class BarreHaut: NSView {
    override func draw(_ dirtyRect: NSRect) {
        if Charte.verre { return }   // macOS 26 : rien derrière, la page passe sous le verre
        Charte.nuit.setFill(); bounds.fill()
        NSColor.white.withAlphaComponent(0.07).setFill()
        NSRect(x: 0, y: isFlipped ? bounds.height - 1 : 0, width: bounds.width, height: 1).fill()
    }
    override var mouseDownCanMoveWindow: Bool { true }
}

/// Logo à gauche de la barre : l'icône de l'app et le nom.
final class Logo: NSView {
    init() {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        let image = NSImageView(image: NSApp.applicationIconImage ?? NSImage())
        image.imageScaling = .scaleProportionallyUpOrDown
        let nom = NSTextField(labelWithAttributedString: {
            let a = NSMutableAttributedString(string: "Retro", attributes: [.font: Charte.police(15, .bold), .foregroundColor: Charte.texte])
            a.append(NSAttributedString(string: "Revente", attributes: [.font: Charte.police(15, .bold), .foregroundColor: Charte.verre ? Charte.orIcone : Charte.or]))
            return a
        }())
        nom.maximumNumberOfLines = 1; nom.lineBreakMode = .byClipping
        nom.setContentCompressionResistancePriority(.required, for: .horizontal)
        let pile = NSStackView(views: [image, nom])
        pile.setContentCompressionResistancePriority(.required, for: .horizontal)
        pile.spacing = 7; pile.translatesAutoresizingMaskIntoConstraints = false
        addSubview(pile)
        NSLayoutConstraint.activate([
            image.widthAnchor.constraint(equalToConstant: 24), image.heightAnchor.constraint(equalToConstant: 24),
            pile.leadingAnchor.constraint(equalTo: leadingAnchor), pile.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -10),
            pile.centerYAnchor.constraint(equalTo: centerYAnchor), heightAnchor.constraint(equalToConstant: 30),
        ])
        setAccessibilityElement(false)
    }
    required init?(coder: NSCoder) { fatalError() }
    override var mouseDownCanMoveWindow: Bool { true }
}

/// Fine ligne dorée de chargement, sous la barre.
final class Chargement: NSView {
    var progression: Double = 1 { didSet { isHidden = progression >= 1; needsDisplay = true } }
    override func draw(_ dirtyRect: NSRect) {
        Charte.or.setFill()
        NSRect(x: 0, y: 0, width: bounds.width * CGFloat(max(0.08, progression)), height: bounds.height).fill()
    }
}

#if compiler(>=6.2)
/// Une capsule de verre Liquid Glass autour de `vue` (macOS 26).
@available(macOS 26.0, *)
func capsuleDeVerre(_ vue: NSView, marge: CGFloat = 4) -> NSView {
    let dedans = NSView()
    vue.translatesAutoresizingMaskIntoConstraints = false
    dedans.addSubview(vue)
    NSLayoutConstraint.activate([
        vue.leadingAnchor.constraint(equalTo: dedans.leadingAnchor, constant: marge),
        vue.trailingAnchor.constraint(equalTo: dedans.trailingAnchor, constant: -marge),
        vue.topAnchor.constraint(equalTo: dedans.topAnchor, constant: marge),
        vue.bottomAnchor.constraint(equalTo: dedans.bottomAnchor, constant: -marge),
    ])
    let verre = NSGlassEffectView()
    verre.contentView = dedans
    verre.cornerRadius = 19
    return verre
}
#endif
