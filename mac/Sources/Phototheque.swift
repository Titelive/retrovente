import Photos

/// Photos choisies dans l'app Photos : retirées de la photothèque seulement À LA FIN, une fois l'annonce publiée
/// sur Le Bon Coin (réglage « Retirer de Photos », activé par défaut). Avant, elles sont seulement notées pour leur article.
/// macOS demande de confirmer la suppression, et les photos restent 30 jours dans « Supprimés récemment ».
enum Phototheque {
    static var retirerApresAjout: Bool {
        get { UserDefaults.standard.object(forKey: "retirerDePhotos") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "retirerDePhotos") }
    }
    private static let cle = "photosARetirer"   // article → identifiants Photos, gardés d'une ouverture à l'autre
    /// Photos bien envoyées sur la fiche : notées, pas encore retirées.
    static func noter(_ identifiants: [String], pour article: String) {
        let ids = identifiants.filter { !$0.isEmpty }
        guard !ids.isEmpty, !article.isEmpty else { return }
        var d = UserDefaults.standard.dictionary(forKey: cle) as? [String: [String]] ?? [:]
        d[article] = Array(Set((d[article] ?? []) + ids))
        UserDefaults.standard.set(d, forKey: cle)
    }
    /// Annonce publiée : les photos notées pour ces articles (l'annonce, ou chaque article d'un lot) quittent Photos.
    static func apresPublication(_ articles: [String]) async {
        var d = UserDefaults.standard.dictionary(forKey: cle) as? [String: [String]] ?? [:]
        let ids = articles.flatMap { d[$0] ?? [] }
        guard !ids.isEmpty else { return }
        for a in articles { d[a] = nil }
        UserDefaults.standard.set(d, forKey: cle)
        await retirer(ids)
    }
    /// Seulement les photos réellement envoyées (identifiants Photos). Ne fait rien si l'accès est refusé.
    static func retirer(_ identifiants: [String]) async {
        let ids = identifiants.filter { !$0.isEmpty }
        guard retirerApresAjout, !ids.isEmpty else { return }
        var st = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if st == .notDetermined { st = await PHPhotoLibrary.requestAuthorization(for: .readWrite) }
        guard st == .authorized || st == .limited else { NSLog("RetroRevente : accès à Photos refusé, photos gardées"); return }
        let assets = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
        guard assets.count > 0 else { return }
        do { try await PHPhotoLibrary.shared().performChanges { PHAssetChangeRequest.deleteAssets(assets) } }
        catch { NSLog("RetroRevente : photos gardées dans Photos (%@)", error.localizedDescription) }
    }
}
