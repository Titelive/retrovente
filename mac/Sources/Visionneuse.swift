// Visionneuse (lightbox) : une photo de la fiche en grand, par-dessus toute la fenêtre.
// ← → (ou les flèches à l'écran) pour passer d'une photo à l'autre, Échap ou un clic à côté pour fermer.
import SwiftUI
import AppKit

struct Visionneuse: View {
    let article: Article
    @Binding var index: Int?
    @Environment(\.accessibilityReduceMotion) private var sansMouvement
    @State private var image: NSImage?
    @State private var clavier: Any?
    @State private var sens: Edge = .trailing

    private var photos: [Photo] { article.photos }
    private var i: Int { min(max(index ?? 0, 0), max(photos.count - 1, 0)) }

    var body: some View {
        ZStack {
            Color.black.opacity(0.88).ignoresSafeArea().onTapGesture { fermer() }
            if let im = image {
                Image(nsImage: im).resizable().interpolation(.high).scaledToFit()
                    .padding(.horizontal, 90).padding(.top, 60).padding(.bottom, 90)
                    .shadow(color: .black.opacity(0.5), radius: 30)
                    .id(i)
                    .transition(sansMouvement ? .opacity : .asymmetric(insertion: .move(edge: sens).combined(with: .opacity), removal: .opacity))
            } else {
                ProgressView().controlSize(.large).tint(.white)
            }
            HStack {
                fleche("chevron.left", aide: "Photo précédente (←)") { aller(-1) }.opacity(i > 0 ? 1 : 0.25).disabled(i == 0)
                Spacer()
                fleche("chevron.right", aide: "Photo suivante (→)") { aller(1) }.opacity(i < photos.count - 1 ? 1 : 0.25).disabled(i >= photos.count - 1)
            }.padding(.horizontal, 24)
            VStack {
                HStack {
                    Spacer()
                    fleche("xmark", aide: "Fermer (Échap)") { fermer() }
                }.padding(20)
                Spacer()
                VStack(spacing: 6) {
                    if i < photos.count, !photos[i].legende.isEmpty {
                        Text(photos[i].legende).font(.callout.weight(.medium)).foregroundStyle(.white).multilineTextAlignment(.center)
                    }
                    Text("\(i + 1) / \(photos.count)").font(.caption.monospacedDigit()).foregroundStyle(.white.opacity(0.7))
                }
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(.black.opacity(0.45), in: Capsule())
                .padding(.bottom, 24)
            }
        }
        .task(id: i) { await charger() }
        .onAppear {
            // Clavier : ← → pour naviguer, Échap pour fermer (le reste passe à l'app).
            clavier = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { e in
                switch e.keyCode {
                case 123: aller(-1); return nil      // ←
                case 124: aller(1); return nil       // →
                case 53: fermer(); return nil        // Échap
                case 49: fermer(); return nil        // Espace, comme Coup d'œil
                default: return e
                }
            }
        }
        .onDisappear { if let c = clavier { NSEvent.removeMonitor(c); clavier = nil } }
    }

    private func fleche(_ symbole: String, aide: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbole).font(.system(size: 20, weight: .semibold)).foregroundStyle(.white)
                .frame(width: 48, height: 48).background(.white.opacity(0.14), in: Circle())
                .contentShape(Circle())
        }.buttonStyle(.plain).help(aide)
    }
    private func aller(_ d: Int) {
        let n = i + d
        guard n >= 0, n < photos.count else { return }
        sens = d > 0 ? .trailing : .leading
        withAnimation(sansMouvement ? nil : .spring(response: 0.35, dampingFraction: 0.9)) { index = n }
    }
    private func fermer() { withAnimation(.easeOut(duration: 0.2)) { index = nil } }
    private func charger() async {
        guard i < photos.count, let u = Vignette.url(article, photos[i]) else { return }
        if let c = Images.enCache(u, .grande) { image = c } else { image = nil }
        if let p = await Images.charger(u, .pleine) { withAnimation(.easeOut(duration: 0.15)) { image = p } }
    }
}
