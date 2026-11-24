// IA d'Apple, en local sur le Mac (Apple Intelligence, macOS 26) : rien n'est envoyé au serveur.
// Le modèle d'Apple ne voit pas les images : Vision lit le texte de chaque photo (titre, code au dos, classification d'âge…)
// et le modèle rédige le titre, les légendes et l'annonce à partir de ce texte et de la fiche.
import AppKit
import Vision
#if canImport(FoundationModels) && arch(arm64)
import FoundationModels
#endif

enum IALocale {
    /// nil quand l'IA d'Apple est utilisable ; sinon, pourquoi elle ne l'est pas (affiché sous le bouton).
    static var indisponible: String? {
        #if canImport(FoundationModels) && arch(arm64)
        if #available(macOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available: return nil
            case .unavailable(let raison):
                switch raison {
                case .deviceNotEligible: return "Ce Mac ne prend pas en charge Apple Intelligence."
                case .appleIntelligenceNotEnabled: return "Active Apple Intelligence dans Réglages Système › Apple Intelligence et Siri."
                case .modelNotReady: return "Apple Intelligence se télécharge encore sur ce Mac. Réessaie dans quelques minutes."
                @unknown default: return "Apple Intelligence n'est pas disponible sur ce Mac."
                }
            }
        }
        return "L'IA d'Apple demande macOS 26 (Tahoe) ou plus récent."
        #else
        return "L'IA d'Apple n'est pas disponible dans cette version de l'app (Mac Intel)."
        #endif
    }

    /// Texte lu sur une photo par Vision (sur le Mac).
    static func lireTexte(_ image: NSImage) async -> String {
        guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return "" }
        return await Task.detached(priority: .userInitiated) {
            let req = VNRecognizeTextRequest()
            req.recognitionLevel = .accurate
            req.usesLanguageCorrection = true
            req.recognitionLanguages = ["fr-FR", "de-DE", "en-US", "it-IT", "es-ES"]
            do { try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req]) } catch { return "" }
            let lignes = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
            return String(lignes.joined(separator: " · ").prefix(350))
        }.value
    }

    struct Resultat { var titre: String; var texte: String; var legendes: [String] }

    enum Erreur: LocalizedError {
        case indisponible(String), reponse(String)
        var errorDescription: String? {
            switch self { case .indisponible(let r): return r; case .reponse(let r): return "L'IA d'Apple n'a pas pu rédiger l'annonce : \(r)" }
        }
    }

    /// Titre, légendes (une par photo) et texte de l'annonce, rédigés par le modèle d'Apple sur le Mac.
    static func rediger(fiche: String, textesPhotos: [String], sansNotice: Bool) async throws -> Resultat {
        if let r = indisponible { throw Erreur.indisponible(r) }
        #if canImport(FoundationModels) && arch(arm64)
        if #available(macOS 26.0, *) {
            var regles = """
            Tu rédiges des annonces Le Bon Coin en français pour un vendeur de jeux vidéo et d'objets de collection.
            Règles : n'invente rien. N'écris « neuf » ou « sous blister » que si la fiche l'indique.
            Une version étrangère (allemande, anglaise…) se dit clairement, avec les langues présentes si la fiche les donne.
            Ton simple et direct, phrases courtes, sans emoji, sans majuscules criardes.
            """
            if sansNotice { regles += "\nCette console n'a pas de notice papier : n'en parle jamais." }
            let photos = textesPhotos.enumerated().map { "Photo \($0.offset + 1) : " + ($0.element.isEmpty ? "(aucun texte lu)" : "texte lu « \($0.element) »") }.joined(separator: "\n")
            let demande = """
            Fiche de l'objet :
            \(fiche)

            Texte lu sur chaque photo :
            \(photos.isEmpty ? "(pas de photo)" : photos)

            Réponds exactement dans ce format, sans rien d'autre :
            TITRE: un titre d'annonce de 70 caractères au plus
            \(textesPhotos.indices.map { "LEGENDE \($0 + 1): ce que montre la photo \($0 + 1), en quelques mots (face avant, dos de la boîte, cartouche…), d'après le texte lu" }.joined(separator: "\n"))
            TEXTE:
            le texte complet de l'annonce (état, contenu, version, remise en main propre ou envoi)
            """
            do {
                let session = LanguageModelSession(instructions: regles)
                let reponse = try await session.respond(to: demande)
                return decouper(reponse.content, photos: textesPhotos.count)
            } catch {
                throw Erreur.reponse(error.localizedDescription)
            }
        }
        #endif
        throw Erreur.indisponible("L'IA d'Apple n'est pas disponible sur ce Mac.")
    }

    /// Découpe la réponse « TITRE: … / LEGENDE n: … / TEXTE: … ».
    static func decouper(_ s: String, photos: Int) -> Resultat {
        var titre = "", texte: [String] = [], legendes = Array(repeating: "", count: photos), dansTexte = false
        for ligne in s.components(separatedBy: .newlines) {
            let l = ligne.trimmingCharacters(in: .whitespaces)
            let maj = l.uppercased()
            if dansTexte { texte.append(ligne); continue }
            if maj.hasPrefix("TITRE") , let i = l.firstIndex(of: ":") { titre = l[l.index(after: i)...].trimmingCharacters(in: .whitespaces); continue }
            if maj.hasPrefix("LEGENDE") || maj.hasPrefix("LÉGENDE"), let i = l.firstIndex(of: ":") {
                let n = Int(l[..<i].filter(\.isNumber)) ?? 0
                if n >= 1, n <= photos { legendes[n - 1] = l[l.index(after: i)...].trimmingCharacters(in: .whitespaces) }
                continue
            }
            if maj.hasPrefix("TEXTE"), let i = l.firstIndex(of: ":") {
                dansTexte = true
                let reste = l[l.index(after: i)...].trimmingCharacters(in: .whitespaces)
                if !reste.isEmpty { texte.append(reste) }
            }
        }
        let t = texte.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return Resultat(titre: titre.trimmingCharacters(in: CharacterSet(charactersIn: "\"«» ")), texte: t, legendes: legendes)
    }
}
