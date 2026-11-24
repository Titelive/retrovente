import AppKit
import WebKit

/// « Voir l'annonce » : si Le Bon Coin dit « Cette annonce est désactivée » (lien périmé : annonce republiée,
/// supprimée ou vendue), l'app le dit et propose de retrouver la bonne annonce au lieu de laisser une page morte.
extension Fenetre {
    func voirAnnonce(_ a: Article) {
        guard let u = URL(string: a.annonce), !a.annonce.isEmpty else { return }
        annonceAVerifier = a.id
        ouvrir(u)
    }

    func verifierAnnonce() {
        guard let id = annonceAVerifier, lbc.url?.path.contains("/ad/") == true else { return }
        // La page se dessine après le chargement : deux lectures, tout de suite puis un peu plus tard.
        for delai in [0.4, 2.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delai) { [weak self] in
                guard let self = self, self.annonceAVerifier == id else { return }
                let js = "(function(){var t=(document.body&&document.body.innerText||'').slice(0,6000).normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase();return /cette annonce est desactivee|annonce n.est plus (disponible|en ligne)|annonce introuvable|page introuvable/.test(t)})()"
                self.lbc.evaluateJavaScript(js, in: nil, in: Scripts.monde) { r in
                    guard case .success(let v) = r, (v as? Bool) == true, self.annonceAVerifier == id else { return }
                    self.annonceAVerifier = nil
                    self.annonceMorte(id)
                }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in if self?.annonceAVerifier == id { self?.annonceAVerifier = nil } }
    }

    private func annonceMorte(_ id: String) {
        guard let a = modele.parId(id) else { return }
        modele.annoncesMortes[id] = a.annonce
        let al = NSAlert()
        al.messageText = "Cette annonce n'est plus en ligne"
        al.informativeText = "Le Bon Coin indique que l'annonce de « \(a.titre) » est désactivée. Elle a peut-être été republiée sous un autre lien, vendue ou supprimée.\n\n« Retrouver la bonne annonce » oublie ce lien et ouvre Mes annonces : RetroRevente y relie toute seule l'annonce en ligne à ta fiche."
        al.addButton(withTitle: "Retrouver la bonne annonce")
        al.addButton(withTitle: "Oublier ce lien")
        al.addButton(withTitle: "Fermer")
        al.beginSheetModal(for: fenetre) { [weak self] rep in
            guard let self = self, rep != .alertThirdButtonReturn else { return }
            Task { @MainActor in
                var n = a; n.annonce = ""
                guard await self.modele.enregistrer(n) != nil else { return }
                if rep == .alertFirstButtonReturn { self.aller(.annonces) }
                else { self.montrer(.appli); self.modele.message = "Lien Le Bon Coin oublié pour « \(a.titre) »." }
            }
        }
    }
}
