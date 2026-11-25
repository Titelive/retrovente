import Foundation
import WebKit

/// Clé maîtresse WebCrypto des pages (Le Bon Coin, eBay) : fournie par l'app au lieu du trousseau.
/// Sans elle, WebKit range sa clé dans le trousseau, attachée à la signature de l'app : chaque mise à jour
/// (signature différente) redemandait le mot de passe « Clé maîtresse WebCrypto RetroRevente ».
/// WebKit la demande au délégué d'interface (méthodes privées de WKUIDelegate) ; on lui donne une clé gardée par l'app.
enum CleWebCrypto {
    static let cle: Data = {
        let k = "cleWebCrypto"
        if let s = UserDefaults.standard.string(forKey: k), let d = Data(base64Encoded: s), d.count == 16 { return d }
        var o = [UInt8](repeating: 0, count: 16)
        if SecRandomCopyBytes(kSecRandomDefault, o.count, &o) != errSecSuccess { o = (0..<16).map { _ in UInt8.random(in: 0...255) } }
        let d = Data(o)
        UserDefaults.standard.set(d.base64EncodedString(), forKey: k)
        return d
    }()
}

/// Délégué d'interface minimal des navigateurs cachés (messagerie, vues et favoris, vérification des annonces).
@MainActor
final class DelegueWebCrypto: NSObject, WKUIDelegate {
    static let partage = DelegueWebCrypto()
    @objc(_webCryptoMasterKeyForWebView:) func cleMaitresse(_ w: WKWebView) -> NSData? { CleWebCrypto.cle as NSData }
    @objc(_webCryptoMasterKeyForWebView:completionHandler:) func cleMaitresse(_ w: WKWebView, completionHandler: @escaping (NSData?) -> Void) {
        completionHandler(CleWebCrypto.cle as NSData)
    }
}
