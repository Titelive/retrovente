import SwiftUI
import WebKit

/// Modifier ou supprimer une annonce Le Bon Coin depuis l'app, en coulisses (même principe que le dépôt) :
/// l'app ouvre l'annonce sans la montrer, clique « Modifier » ou « Supprimer », remplit, et s'arrête avant l'envoi.
/// - Modification : récapitulatif dans l'app, Le Bon Coin n'est mis à jour qu'au clic sur « Enregistrer ».
/// - Suppression : la personne a confirmé dans l'app avant que quoi que ce soit parte.
/// Si Le Bon Coin demande quelque chose d'inattendu (connexion, vérification, écran inconnu), il est montré à l'écran.
extension Fenetre {
    static let delaiGestion: TimeInterval = 90

    func modifierEnCoulisses(_ a: Article) { gerer(a, .modifier) }
    func supprimerEnCoulisses(_ a: Article) { gerer(a, .supprimer) }

    private func gerer(_ a: Article, _ action: GestionAnnonce.Action) {
        guard let url = URL(string: a.annonce), url.host?.hasSuffix("leboncoin.fr") == true else { return }
        guard !enCoulisses else { NSSound.beep(); return }
        // Le panneau ne doit pas remplir la page avec une autre fiche pendant ce temps.
        if !autoSuspendu { reglageAuto = Stockage.partage.valeur("auto"); autoSuspendu = true }
        Stockage.partage.ecrire(["auto": false])
        enCoulisses = true
        debutCoulisses = Date(); etapeDepuis = Date()
        modele.gestion = GestionAnnonce(id: a.id, titre: a.titre, action: action, etape: .travail("J'ouvre ton annonce…"))
        montrer(.appli)
        lbc.load(URLRequest(url: url)); lbcCharge = true
        veilleCoulisses?.invalidate()
        veilleCoulisses = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.etapeGestion() }
        }
    }

    /// Remet le réglage « remplissage automatique » de la personne après une modification ou une suppression.
    func retablirAuto() {
        guard autoSuspendu else { return }
        autoSuspendu = false
        Stockage.partage.ecrire(["auto": reglageAuto ?? NSNull()])
    }

    /// « Enregistrer » dans l'app : clique le bouton final de la modification.
    func validerGestion() {
        guard var g = modele.gestion, case .pret = g.etape else { return }
        g.etape = .envoi; etapeDepuis = Date(); modele.gestion = g
        etapeGestion(final: true)
    }

    func etapeGestion(final: Bool = false) {
        guard enCoulisses, let g = modele.gestion else { return }
        if case .fait = g.etape { return }
        if case .aide = g.etape { return }
        if lbc.isLoading && !final { return }
        let limite: TimeInterval = g.etape == .envoi ? Fenetre.delaiPublication : Fenetre.delaiGestion
        if case .pret = g.etape {} else if Date().timeIntervalSince(g.etape == .envoi ? etapeDepuis : debutCoulisses) > limite {
            besoinDeToi("Le Bon Coin ne répond pas comme prévu"); return
        }
        guard let a = modele.articles.first(where: { $0.id == g.id }) else { besoinDeToi("fiche introuvable"); return }
        let titre = a.titreAnnonce.isEmpty ? a.titre : a.titreAnnonce
        let p: [String: Any] = [
            "action": g.action == .modifier ? "modifier" : "supprimer",
            "titre": titre, "texte": a.texteAnnonce,
            "prix": a.prixDemande.map { String(Int($0.rounded())) } ?? "",
            "vendu": a.vendu,
            "final": final || g.etape == .envoi || g.action == .supprimer,
            "apres": g.envoye,
        ]
        lbc.callAsyncJavaScript(Fenetre.jsGestion, arguments: ["p": p], in: nil, in: Scripts.monde) { [weak self] r in
            guard let self = self, self.enCoulisses, var g = self.modele.gestion, case .success(let v) = r, let e = v as? String else { return }
            switch e {
            case "verification", "connexion": self.besoinDeToi(e)
            case _ where e.hasPrefix("aide"): self.besoinDeToi(e)
            case _ where e.hasPrefix("pret:"):
                if case .pret = g.etape { return }
                g.etape = .pret(bouton: String(e.dropFirst(5))); self.modele.gestion = g
                if !NSApp.isActive { NSApp.requestUserAttention(.informationalRequest) }
            case "envoye":
                if !g.envoye { g.envoye = true; if g.etape != .envoi { g.etape = .envoi; self.etapeDepuis = Date() }; self.modele.gestion = g }
            case "fait": self.gestionFaite(g, a)
            default:
                if case .travail(let ancien) = g.etape {
                    let t = g.action == .supprimer ? "Je retire l'annonce de Le Bon Coin…"
                        : e == "formulaire" || e == "suite" ? "Je mets l'annonce à jour…" : "J'ouvre ton annonce…"
                    if t != ancien { g.etape = .travail(t); self.modele.gestion = g }
                }
            }
        }
    }

    private func gestionFaite(_ g: GestionAnnonce, _ a: Article) {
        veilleCoulisses?.invalidate(); veilleCoulisses = nil
        var g = g
        g.etape = .fait(g.action == .modifier ? "Ton annonce est à jour sur Le Bon Coin." : "L'annonce est retirée de Le Bon Coin.")
        modele.gestion = g
        if g.action == .supprimer {
            var n = a; n.annonce = ""; if n.statut == "en_vente" { n.statut = "retire" }
            Task { _ = await modele.enregistrer(n) }
        }
        // La feuille se ferme toute seule après un instant.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.2) { [weak self] in
            if case .fait? = self?.modele.gestion?.etape { self?.modele.gestion = nil }
        }
    }

    /// Le moteur, exécuté dans le monde isolé RetroRevente à chaque étape. Renvoie l'état de la page.
    static let jsGestion = """
    var n = function (s) { return String(s || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/\\s+/g, " ").trim().toLowerCase(); };
    var vis = function (x) { if (!x || !x.isConnected) return false; var r = x.getBoundingClientRect(), st = getComputedStyle(x); return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none"; };
    var clics = window.__rrGestion || (window.__rrGestion = {});
    function btns(re, racine) {
      return [].filter.call((racine || document).querySelectorAll("button, a, [role=button], [role=menuitem], input[type=submit]"), function (b) {
        return vis(b) && !b.disabled && b.getAttribute("aria-disabled") !== "true" && re.test(n(b.textContent || b.value || b.getAttribute("aria-label") || "")) && !b.closest("footer");
      });
    }
    function cliquer(cle, b) { if (clics[cle]) return false; clics[cle] = Date.now(); b.click(); return true; }
    function libelle(x) {
      var l = [x.getAttribute("aria-label"), x.getAttribute("placeholder"), x.name, x.id];
      if (x.id) { var f = document.querySelector("label[for='" + CSS.escape(x.id) + "']"); if (f) l.push(f.textContent); }
      var c = x.closest("label"); if (c) l.push(c.textContent);
      return n(l.filter(Boolean).join(" "));
    }
    function poser(el, v) {
      if (String(el.value) === v) return false;
      el.focus();
      var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); el.dispatchEvent(new Event("blur", { bubbles: true }));
      return true;
    }
    if (document.querySelector("iframe[src*='captcha-delivery'], iframe[src*='datadome'], iframe[src*='hcaptcha'], iframe[src*='recaptcha']")) return "verification";
    if ([].some.call(document.querySelectorAll("input[type=password]"), vis)) return "connexion";
    // Envoi fait, et la page a changé depuis (nouvelle page, état remis à zéro) : c'est terminé.
    if (p.apres && !clics.envoi) return "fait";
    var tout = n((document.body.innerText || "").slice(0, 8000));
    var dlg = [].filter.call(document.querySelectorAll("[role=dialog], [role=alertdialog], dialog[open]"), vis).pop();

    if (p.action === "supprimer") {
      if (/annonce (a (bien )?ete |est )?supprimee|suppression (a (bien )?ete )?(prise en compte|effectuee|confirmee)/.test(tout)) return "fait";
      if (clics.envoi && Date.now() - clics.envoi > 2500 && !dlg) return "fait";
      if (dlg) {
        var radios = [].slice.call(dlg.querySelectorAll("input[type=radio], [role=radio]"));
        var choisi = radios.some(function (r) { return r.checked || r.getAttribute("aria-checked") === "true"; });
        if (radios.length && !choisi) {
          var lab = function (r) { var l = r.closest("label") || (r.id && dlg.querySelector("label[for='" + CSS.escape(r.id) + "']")) || r.parentElement; return n(l ? l.textContent : ""); };
          var prefs = p.vendu ? [/vendu.*(leboncoin|le bon coin)/, /vendu/] : [/(ne (souhaite|veux) plus|plus (a |envie de )?vendre|change d.avis)/, /autre/];
          for (var i = 0; i < prefs.length; i++) {
            var r = radios.find(function (x) { return prefs[i].test(lab(x)); });
            if (r) { (r.closest("label") || r).click(); return "raison"; }
          }
          return "aide:raison";
        }
        var f = btns(/^(supprimer|confirmer|valider|oui)/, dlg)[0];
        if (f) { if (!clics.envoi) { clics.envoi = Date.now(); f.click(); } return "envoye"; }
        var c = btns(/^(continuer|suivant)$/, dlg)[0];
        if (c && cliquer("dlg-suite:" + n(dlg.textContent).slice(0, 60), c)) return "suite";
        return "attente";
      }
      var s = btns(/^supprimer( l.annonce| mon annonce| cette annonce)?$/)[0];
      if (s) { cliquer("supprimer", s); return "ouvre"; }
      var o = btns(/^(plus d.options|options|gerer( l.annonce)?|actions)$/)[0];
      if (o && cliquer("options", o)) return "ouvre";
      return clics.supprimer ? "attente" : "cherche";
    }

    // Modification
    if (clics.envoi && /(modification|modifications|annonce) (a|ont|est)? ?(bien )?(ete )?(enregistree|prise en compte|modifiee|mise a jour)|sera (a nouveau )?(en ligne|visible)|en cours de (validation|moderation|verification)/.test(tout)) return "fait";
    var champs = [].filter.call(document.querySelectorAll("main input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), main textarea"), vis);
    var tC = champs.find(function (x) { return x.tagName === "INPUT" && /titre|subject|title/.test(libelle(x)); });
    var dC = champs.find(function (x) { return x.tagName === "TEXTAREA" && /description|texte|body/.test(libelle(x)); }) || champs.find(function (x) { return x.tagName === "TEXTAREA"; });
    var pC = champs.find(function (x) { return x.tagName === "INPUT" && /prix|price/.test(libelle(x)); });
    if (!tC && !dC && !pC && !clics.formulaire) {
      var m = btns(/^modifier( l.annonce| mon annonce| cette annonce)?$/)[0];
      if (m) { cliquer("modifier", m); return "ouvre"; }
      return clics.modifier ? "attente" : "cherche";
    }
    clics.formulaire = 1;
    if (tC && p.titre) poser(tC, p.titre.slice(0, 100));
    if (dC && p.texte) poser(dC, p.texte);
    if (pC && p.prix) poser(pC, p.prix);
    var fin = btns(/^(valider|enregistrer|mettre a jour|publier|confirmer|deposer)( (les |mes )?modifications| mon annonce| l.annonce| sans booster.*)?$/)[0];
    if (fin) {
      if (!p.final) return "pret:" + (fin.textContent || fin.value || "Valider").trim().replace(/\\s+/g, " ");
      if (!clics.envoi) { clics.envoi = Date.now(); fin.click(); }
      return "envoye";
    }
    var suite = btns(/^continuer$/)[0];
    if (suite) {
      var h = [].find.call(document.querySelectorAll("main h1, main h2, h1, h2"), vis);
      if (cliquer("suite:" + location.pathname + "|" + n(h ? h.textContent : "").slice(0, 60), suite)) return "suite";
    }
    return "formulaire";
    """
}

/// Feuille « Modifier / supprimer sur Le Bon Coin ».
struct FeuilleGestion: View {
    @ObservedObject var appli: Appli
    let gestion: GestionAnnonce
    private var article: Article? { appli.articles.first { $0.id == gestion.id } }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 14) {
                Group { if let a = article { Vignette(article: a) } else { Color.rrAccent.opacity(0.15) } }
                    .frame(width: 72, height: 72).clipShape(RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 4) {
                    Text(gestion.action == .modifier ? "Mettre à jour l'annonce" : "Retirer l'annonce").font(.caption.weight(.bold)).foregroundStyle(Color.rrAccent).textCase(.uppercase)
                    Text(titre).font(.title3.weight(.bold)).lineLimit(2)
                    if gestion.action == .modifier, let a = article { Text(Libelles.prix(a.prixDemande)).font(.headline.monospacedDigit()) }
                }
                Spacer(minLength: 0)
            }
            switch gestion.etape {
            case .travail(let t):
                HStack(spacing: 10) { ProgressView().controlSize(.small); Text(t).font(.headline) }
                Text(gestion.action == .modifier
                     ? "Le Bon Coin s'ouvre en coulisses avec le titre, la description et le prix de ta fiche. Rien n'est envoyé sans toi."
                     : "Le Bon Coin s'ouvre en coulisses pour retirer l'annonce, comme tu l'as demandé.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                boutons(principal: nil)
            case .pret(let b):
                Label("Les modifications sont prêtes", systemImage: "checkmark.seal.fill").font(.headline).foregroundStyle(Color.rrAccent)
                Text("Le **titre**, la **description** et le **prix** de ta fiche sont reportés sur Le Bon Coin. Rien n'est envoyé tant que tu ne cliques pas sur **« Enregistrer »**.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                boutons(principal: AnyView(
                    Button { appli.fenetre?.validerGestion() } label: { Label("Enregistrer", systemImage: "checkmark") }
                        .boutonVerre(principal: true).keyboardShortcut(.defaultAction).help("Clique « \(b) » sur Le Bon Coin")))
            case .aide(let t):
                Label("Le Bon Coin a besoin de toi", systemImage: "exclamationmark.triangle.fill").font(.headline).foregroundStyle(.orange)
                Text(t).font(.callout).fixedSize(horizontal: false, vertical: true)
                Text("**Rien n'a été envoyé.** Le Bon Coin reste caché : tu peux **réessayer**, ou l'ouvrir pour régler ça toi-même.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                boutons(principal: AnyView(HStack {
                    Button { appli.fenetre?.voirCoulisses() } label: { Label("Ouvrir Le Bon Coin", systemImage: "eye") }.boutonVerre()
                    Button { appli.fenetre?.reessayerCoulisses() } label: { Label("Réessayer", systemImage: "arrow.clockwise") }
                        .boutonVerre(principal: true).keyboardShortcut(.defaultAction)
                }))
            case .envoi:
                HStack(spacing: 10) { ProgressView().controlSize(.small); Text(gestion.action == .modifier ? "Envoi à Le Bon Coin…" : "Suppression sur Le Bon Coin…").font(.headline) }
            case .fait(let t):
                Label(t, systemImage: "checkmark.circle.fill").font(.headline).foregroundStyle(Color.rrAccent)
            }
        }
        .padding(24).frame(width: 460)
    }
    private var titre: String { let t = article?.titreAnnonce ?? ""; return t.isEmpty ? (article?.titre ?? gestion.titre) : t }
    @ViewBuilder private func boutons(principal: AnyView?) -> some View {
        HStack {
            Button("Annuler") { appli.gestion = nil }.keyboardShortcut(.cancelAction).boutonVerre()
            Spacer()
            if let p = principal { p }
        }
    }
}
