// Gestionnaire natif de l'extension Safari RetroRevente (copié dans le projet par extension/outils/safari.sh).
// Seul message reconnu : { type: "son" }, qui joue le son d'alerte « à toi » avec le son système du Mac.
// Aucune connexion réseau, aucun accès aux fichiers.
import SafariServices
import os.log
#if os(macOS)
import AppKit
#else
import AudioToolbox
#endif

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) { message = item?.userInfo?[SFExtensionMessageKey] } else { message = item?.userInfo?["message"] }
        var reponse: [String: Any] = ["ok": false, "erreur": "message inconnu"]
        var attente = 0.0
        if let m = message as? [String: Any], (m["type"] as? String) == "son" {
            reponse = jouerSon()
            attente = 1.2   // laisse au son le temps de jouer avant que l'extension ne soit suspendue
        }
        let sortie = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) { sortie.userInfo = [SFExtensionMessageKey: reponse] } else { sortie.userInfo = ["message": reponse] }
        DispatchQueue.main.asyncAfter(deadline: .now() + attente) {
            context.completeRequest(returningItems: [sortie], completionHandler: nil)
        }
    }

    private func jouerSon() -> [String: Any] {
        #if os(macOS)
        var ok = false
        let jouer = {
            let son = NSSound(named: NSSound.Name("Glass")) ?? NSSound(named: NSSound.Name("Ping"))
            son?.volume = 1.0
            ok = son?.play() ?? false
            if !ok { NSSound.beep(); ok = true }
        }
        if Thread.isMainThread { jouer() } else { DispatchQueue.main.sync(execute: jouer) }
        return ["ok": ok, "via": "NSSound"]
        #else
        AudioServicesPlaySystemSound(1007)
        return ["ok": true, "via": "AudioServices"]
        #endif
    }
}
