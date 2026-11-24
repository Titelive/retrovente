import Photos

/// Photos choisies dans l'app Photos : une fois envoyées sur RetroRevente, elles sont retirées de la photothèque
/// (réglage « Retirer de Photos après l'ajout », activé par défaut). macOS demande de confirmer chaque suppression,
/// et les photos restent 30 jours dans « Supprimés récemment ».
enum Phototheque {
    static var retirerApresAjout: Bool {
        get { UserDefaults.standard.object(forKey: "retirerDePhotos") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "retirerDePhotos") }
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
