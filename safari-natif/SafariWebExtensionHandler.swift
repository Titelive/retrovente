// Gestionnaire natif de l'extension Safari RetroRevente (copié dans le projet par extension/outils/safari.sh).
// Seul message reconnu : { type: "son", wav: "<base64>" }, qui joue le son d'alerte « à toi » choisi dans le panneau
// (pièce, power-up, jingle : un petit WAV fabriqué par l'extension). Sans wav (extension plus ancienne) : son système.
// Aucune connexion réseau, aucun accès aux fichiers.
import SafariServices
import os.log
#if os(macOS)
import AppKit
#else
import AudioToolbox
import AVFoundation
#endif

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    // Gardé en vie le temps que le son joue (sinon il est coupé dès la fin de la fonction).
    #if os(macOS)
    private var sonEnCours: NSSound?
    #else
    private var lecteur: AVAudioPlayer?
    #endif

    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) { message = item?.userInfo?[SFExtensionMessageKey] } else { message = item?.userInfo?["message"] }
        var reponse: [String: Any] = ["ok": false, "erreur": "message inconnu"]
        var attente = 0.0
        if let m = message as? [String: Any], (m["type"] as? String) == "son" {
            let donnees = (m["wav"] as? String).flatMap { Data(base64Encoded: $0) }
            reponse = jouerSon(donnees)
            attente = 1.2   // laisse au son le temps de jouer avant que l'extension ne soit suspendue
        }
        let sortie = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) { sortie.userInfo = [SFExtensionMessageKey: reponse] } else { sortie.userInfo = ["message": reponse] }
        DispatchQueue.main.asyncAfter(deadline: .now() + attente) {
            context.completeRequest(returningItems: [sortie], completionHandler: nil)
            #if os(macOS)
            self.sonEnCours = nil
            #else
            self.lecteur = nil
            #endif
        }
    }

    private func jouerSon(_ wav: Data?) -> [String: Any] {
        #if os(macOS)
        var ok = false, via = "NSSound"
        let jouer = {
            var son: NSSound? = nil
            if let wav = wav { son = NSSound(data: wav); via = "NSSound (son RetroRevente)" }
            if son == nil { son = NSSound(named: NSSound.Name("Glass")) ?? NSSound(named: NSSound.Name("Ping")); via = "NSSound (Glass)" }
            son?.volume = 1.0
            ok = son?.play() ?? false
            self.sonEnCours = son
            if !ok { NSSound.beep(); ok = true }
        }
        if Thread.isMainThread { jouer() } else { DispatchQueue.main.sync(execute: jouer) }
        return ["ok": ok, "via": via]
        #else
        if let wav = wav, let l = try? AVAudioPlayer(data: wav) {
            try? AVAudioSession.sharedInstance().setCategory(.ambient)
            l.volume = 1.0
            if l.play() { lecteur = l; return ["ok": true, "via": "AVAudioPlayer (son RetroRevente)"] }
        }
        AudioServicesPlaySystemSound(1007)
        return ["ok": true, "via": "AudioServices"]
        #endif
    }
}
