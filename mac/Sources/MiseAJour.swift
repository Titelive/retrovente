// Mises à jour automatiques : l'app regarde au lancement puis toutes les 6 heures si une version plus récente est publiée
// sur titelive.me (comme les autres apps de Titelive ; GitHub Releases en secours), la télécharge en arrière-plan,
// vérifie sa signature Developer ID (même équipe Apple que l'app installée), puis propose de redémarrer.
// Si tu choisis « Plus tard », elle s'installe quand tu quittes l'app. Plus besoin de la commande dans Terminal.
// Menu RetroRevente : « Rechercher les mises à jour… », « Rechercher automatiquement », « Installer automatiquement ».
import AppKit

@MainActor
final class MiseAJour {
    static let shared = MiseAJour()
    /// Où sont publiées les versions : titelive.me d'abord (mac/publier-mise-a-jour.sh), GitHub Releases en secours
    /// (versions publiées avant le passage à titelive.me). Chaque dossier contient version.txt et RetroRevente-mac.zip.
    static let sources = ["https://titelive.me/retrorevente/telecharger/", "https://github.com/Titelive/retrovente/releases/download/mac/"]
    private var prete: (version: String, app: URL)?
    private var enCours = false
    private var proposee = ""
    private var minuterie: Timer?

    var versionActuelle: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0" }

    // Réglages (menu RetroRevente), activés par défaut comme dans toutes les apps de Titelive.
    var rechercheAuto: Bool {
        get { UserDefaults.standard.object(forKey: "majRechercheAuto") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "majRechercheAuto"); programmer() }
    }
    var installationAuto: Bool {
        get { UserDefaults.standard.object(forKey: "majInstallationAuto") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "majInstallationAuto") }
    }
    private(set) var derniereVerification: Date? {
        get { UserDefaults.standard.object(forKey: "majDerniereVerification") as? Date }
        set { UserDefaults.standard.set(newValue, forKey: "majDerniereVerification") }
    }

    func demarrer() {
        // Mode démo (captures du build) : pas de mise à jour.
        guard ProcessInfo.processInfo.environment["RR_DEMO"] == nil else { return }
        programmer()
        guard rechercheAuto else { return }
        Task { try? await Task.sleep(nanoseconds: 20_000_000_000); await verifier(manuel: false) }
    }
    private func programmer() {
        minuterie?.invalidate(); minuterie = nil
        guard rechercheAuto else { return }
        minuterie = Timer.scheduledTimer(withTimeInterval: 6 * 3600, repeats: true) { _ in
            Task { @MainActor in await MiseAJour.shared.verifier(manuel: false) }
        }
    }

    /// « 2.23.10 » plus récente que « 2.23.9 » : comparaison nombre par nombre.
    nonisolated static func plusRecente(_ a: String, que b: String) -> Bool {
        let x = a.split(separator: ".").map { Int($0) ?? 0 }, y = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(x.count, y.count) {
            let p = i < x.count ? x[i] : 0, q = i < y.count ? y[i] : 0
            if p != q { return p > q }
        }
        return false
    }

    /// Dernière version publiée : la première source qui répond (titelive.me, puis GitHub).
    private func derniereVersion() async throws -> (version: String, base: String) {
        var derniere: Error = URLError(.badServerResponse)
        for base in Self.sources {
            do {
                var req = URLRequest(url: URL(string: base + "version.txt")!)
                req.cachePolicy = .reloadIgnoringLocalCacheData
                let (d, rep) = try await URLSession.shared.data(for: req)
                let v = String(decoding: d, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
                if (rep as? HTTPURLResponse)?.statusCode == 200, v.range(of: #"^\d+(\.\d+)*$"#, options: .regularExpression) != nil {
                    return (v, base)
                }
            } catch { derniere = error }
        }
        throw derniere
    }

    func verifier(manuel: Bool) async {
        if let p = prete { if manuel { proposer(p.version, forcer: true) }; return }
        guard !enCours else { return }
        enCours = true; defer { enCours = false }
        do {
            let (v, base) = try await derniereVersion()
            derniereVerification = Date()
            guard Self.plusRecente(v, que: versionActuelle) else {
                if manuel { informer("RetroRevente est à jour", "Tu as la dernière version (\(versionActuelle)).") }
                return
            }
            // « Installer automatiquement » coupé : on demande avant de télécharger.
            let demande = !manuel && !installationAuto
            if demande {
                guard proposee != v else { return }
                proposee = v
                guard demander("RetroRevente \(v) est disponible", "Tu as la version \(versionActuelle). Télécharger et installer la nouvelle version ?", "Installer") else { return }
            }
            let fm = FileManager.default
            let dossier = fm.temporaryDirectory.appendingPathComponent("RetroRevente-maj-\(v)")
            try? fm.removeItem(at: dossier)
            try fm.createDirectory(at: dossier, withIntermediateDirectories: true)
            let (tmp, rz) = try await URLSession.shared.download(from: URL(string: base + "RetroRevente-mac.zip")!)
            guard (rz as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            let zip = dossier.appendingPathComponent("RetroRevente.zip")
            try fm.moveItem(at: tmp, to: zip)
            guard await Self.executer("/usr/bin/ditto", ["-x", "-k", zip.path, dossier.path]).code == 0 else { throw URLError(.cannotDecodeContentData) }
            let app = dossier.appendingPathComponent("RetroRevente.app")
            let lue = Bundle(url: app)?.infoDictionary?["CFBundleShortVersionString"] as? String
            guard lue == v, await Self.signatureSure(app) else {
                NSLog("RetroRevente mise à jour : version %@ refusée (signature ou version incorrecte)", v)
                if manuel { informer("Mise à jour refusée", "La version téléchargée n'a pas passé la vérification de signature. Rien n'a été changé.") }
                return
            }
            prete = (v, app)
            proposer(v, forcer: manuel || demande)
        } catch {
            NSLog("RetroRevente mise à jour : %@", String(describing: error))
            if manuel { informer("Mise à jour impossible pour le moment", "Vérifie ta connexion à Internet et réessaie.") }
        }
    }

    /// La nouvelle app doit être signée correctement, et par la même équipe Apple que l'app installée (quand celle-ci l'est).
    nonisolated static func signatureSure(_ app: URL) async -> Bool {
        guard await executer("/usr/bin/codesign", ["--verify", "--deep", "--strict", app.path]).code == 0 else { return false }
        let moi = await equipe(Bundle.main.bundleURL)
        guard let moi else { return true }   // app actuelle signée « ad hoc » (avant le compte développeur) : signature valide suffit
        return await equipe(app) == moi
    }
    nonisolated static func equipe(_ app: URL) async -> String? {
        let r = await executer("/usr/bin/codesign", ["-dv", app.path])
        guard let l = r.sortie.components(separatedBy: "\n").first(where: { $0.hasPrefix("TeamIdentifier=") }) else { return nil }
        let t = String(l.dropFirst("TeamIdentifier=".count)).trimmingCharacters(in: .whitespaces)
        return t.isEmpty || t == "not set" ? nil : t
    }
    nonisolated static func executer(_ outil: String, _ args: [String]) async -> (code: Int32, sortie: String) {
        await withCheckedContinuation { (c: CheckedContinuation<(code: Int32, sortie: String), Never>) in
            let p = Process(), tube = Pipe()
            p.executableURL = URL(fileURLWithPath: outil); p.arguments = args
            p.standardOutput = tube; p.standardError = tube
            p.terminationHandler = { p in
                let s = String(decoding: tube.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
                c.resume(returning: (p.terminationStatus, s))
            }
            do { try p.run() } catch { c.resume(returning: (-1, "")) }
        }
    }

    private func proposer(_ v: String, forcer: Bool) {
        guard forcer || proposee != v else { return }
        proposee = v
        let a = NSAlert()
        a.messageText = "RetroRevente \(v) est prête"
        a.informativeText = "La nouvelle version est téléchargée et vérifiée. Redémarre l'app pour l'utiliser, ou elle s'installera quand tu quitteras RetroRevente."
        a.addButton(withTitle: "Redémarrer maintenant")
        a.addButton(withTitle: "Plus tard")
        let suite: (NSApplication.ModalResponse) -> Void = { r in
            if r == .alertFirstButtonReturn { MainActor.assumeIsolated { _ = MiseAJour.shared.installer(relancer: true) } }
        }
        if let f = NSApp.keyWindow ?? NSApp.mainWindow { a.beginSheetModal(for: f, completionHandler: suite) } else { suite(a.runModal()) }
    }

    /// Remplace l'app installée par la nouvelle (l'ancienne est gardée de côté et remise en place si ça échoue).
    @discardableResult
    func installer(relancer: Bool) -> Bool {
        guard let p = prete else { return false }
        let fm = FileManager.default, actuelle = Bundle.main.bundleURL
        let ancienne = fm.temporaryDirectory.appendingPathComponent("RetroRevente-ancienne-\(UUID().uuidString).app")
        do {
            try fm.moveItem(at: actuelle, to: ancienne)
            do { try fm.moveItem(at: p.app, to: actuelle) } catch { try? fm.moveItem(at: ancienne, to: actuelle); throw error }
        } catch {
            NSLog("RetroRevente mise à jour : installation impossible %@", String(describing: error))
            prete = nil
            if relancer {
                informer("Installation impossible", "macOS n'a pas laissé RetroRevente se remplacer. Tu peux installer la nouvelle version avec la commande habituelle dans Terminal.")
            }
            return false
        }
        prete = nil
        try? fm.removeItem(at: ancienne)
        if relancer {
            // Rouvre l'app une fois celle-ci bien fermée.
            let t = Process()
            t.executableURL = URL(fileURLWithPath: "/bin/sh")
            t.arguments = ["-c", "while kill -0 \(getpid()) 2>/dev/null; do sleep 0.3; done; open \"$0\"", actuelle.path]
            try? t.run()
            NSApp.terminate(nil)
        }
        return true
    }

    private func demander(_ titre: String, _ texte: String, _ bouton: String) -> Bool {
        let a = NSAlert(); a.messageText = titre; a.informativeText = texte
        a.addButton(withTitle: bouton); a.addButton(withTitle: "Plus tard")
        return a.runModal() == .alertFirstButtonReturn
    }

    private func informer(_ titre: String, _ texte: String) {
        let a = NSAlert(); a.messageText = titre; a.informativeText = texte; a.addButton(withTitle: "OK")
        if let f = NSApp.keyWindow ?? NSApp.mainWindow { a.beginSheetModal(for: f, completionHandler: nil) } else { a.runModal() }
    }
}
