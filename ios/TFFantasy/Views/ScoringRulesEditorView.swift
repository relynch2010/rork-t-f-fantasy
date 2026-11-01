import SwiftUI

/// Main League scoring editor: categories on/off and applies-to, every point value, percentile brackets.
/// Nothing is saved until the commissioner previews Current → New on real results and confirms Publish.
struct ScoringRulesEditorView: View {
    /// Set when opened from the Admin Panel: edits become a saved draft, publishing needs typed confirmation.
    var admin: AdminAccess? = nil

    @Environment(AppStore.self) private var store
    @State private var rules: GlobalScoringRules?
    @State private var original: GlobalScoringRules?
    @State private var preview: ChangePreview?
    @State private var isPreviewing: Bool = false
    @State private var confirmPublish: Bool = false
    @State private var draftInfo: AdminDraftBody?
    @State private var savedDraft: GlobalScoringRules?
    @State private var adminPreview: AdminPreview?
    @State private var typedConfirm: String = ""
    @State private var showTypedConfirm: Bool = false
    @State private var adminBusy: Bool = false
    @State private var serverMessage: String?
    @State private var requestId: String = UUID().uuidString

    private var canEdit: Bool { admin != nil || (store.league?.canEditGlobalSettings ?? false) }
    private var changed: Bool { rules != nil && rules != original }

    var body: some View {
        Form {
            if !canEdit {
                Section { MainLeagueBanner(text: "Scoring is the same in every league. Only the platform commissioner can change it.") }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            if rules != nil {
                categoriesSection
                pointsSection
                percentileSection
                if admin != nil { adminSection } else { previewSection }
            } else {
                ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
            }
        }
        .screenBackground()
        .disabled(store.isBusy || adminBusy)
        .navigationTitle(admin == nil ? "Scoring Rules" : "Admin · Scoring")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: store.league?.globalVersion) {
            if admin != nil { await loadDraft(); return }
            guard let r = store.league?.global?.rules, !changed else { return }
            rules = r
            original = r
            preview = nil
        }
        .onChange(of: rules) { _, _ in preview = nil; adminPreview = nil }
        .alert("Type PUBLISH to confirm", isPresented: $showTypedConfirm) {
            TextField("PUBLISH", text: $typedConfirm)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
            Button("Cancel", role: .cancel) { typedConfirm = "" }
            Button("Publish", role: .destructive) { Task { await adminPublish() } }
                .disabled(typedConfirm != "PUBLISH")
        } message: {
            Text(admin?.isGlobal == true
                 ? "Creates a new scoring version for EVERY league, effective now for open weeks. Finished weeks keep their scores. The PB-only rule stays fixed."
                 : "Creates a new sandbox scoring version for this test league only, effective now for open weeks. Finished weeks keep their scores. The Main League is never affected.")
        }
        .confirmationDialog("Publish to every league?", isPresented: $confirmPublish, titleVisibility: .visible) {
            Button("Publish new version") { Task { await publish() } }
        } message: {
            Text("Creates a new scoring version for every existing league and every future league. Finished weeks keep their scores.")
        }
    }

    // MARK: Sections

    private var categoriesSection: some View {
        Section {
            ForEach(ScoringCategory.all, id: \.code) { cat in
                VStack(alignment: .leading, spacing: 6) {
                    Toggle(cat.label, isOn: enabledBinding(cat.code))
                        .disabled(!canEdit)
                    if rules?.enabled?[cat.code] != false, !["sr", "fumble"].contains(cat.code) {
                        HStack(spacing: 6) {
                            ForEach(ScoringCategory.appliesOptions, id: \.code) { opt in
                                let on = appliesOn(cat.code, opt.code)
                                Button {
                                    toggleApplies(cat.code, opt.code)
                                    Haptics.tap()
                                } label: {
                                    Text(opt.label).font(.caption.weight(.semibold))
                                        .padding(.horizontal, 9).padding(.vertical, 5)
                                        .background(on ? Theme.green.opacity(0.18) : Theme.surface2, in: .capsule)
                                        .foregroundStyle(on ? Theme.green : Theme.muted)
                                }
                                .buttonStyle(.plain)
                                .disabled(!canEdit)
                            }
                        }
                    }
                }
                .padding(.vertical, 2)
            }
        } header: {
            Text("Categories")
        } footer: {
            Text("Every category is evaluated separately for every event an athlete competes in. Highlighted chips = which results it applies to.")
        }
        .listRowBackground(Theme.surface)
    }

    private var pointsSection: some View {
        Section {
            pointsRow("Per-event participation", \.participation)
            pointsRow("Personal best (PB)", \.pb)
            pointsRow("Season best (SB)", \.sb)
            LabeledContent("PB that's also an SB", value: "PB only, never stacked")
            listRow("Individual place 1st–6th", \.overall)
            listRow("Relay place 1st–6th", \.relay)
            listRow("Heat / flight place 1st–3rd", \.heat)
            pointsRow("Standards cap per season", \.standardCap)
            pointsRow("School record", \.schoolRecord)
            pointsRow("Baton fumble", \.fumble)
            pointsRow("DQ / DNF", \.dqdnf)
        } header: {
            Text("Point values")
        }
        .listRowBackground(Theme.surface)
    }

    @ViewBuilder
    private var percentileSection: some View {
        Section {
            ForEach(Array((rules?.percentile ?? []).enumerated()), id: \.offset) { i, _ in
                HStack {
                    Text("Top")
                    TextField("%", value: pctBinding(i), format: .number)
                    .keyboardType(.numberPad).frame(width: 44).multilineTextAlignment(.center)
                    .background(Theme.surface2, in: .rect(cornerRadius: 6))
                    Text("% of seeded field")
                    Spacer()
                    TextField("pts", value: pctPointsBinding(i), format: .number)
                    .keyboardType(.decimalPad).frame(width: 52).multilineTextAlignment(.center)
                    .background(Theme.surface2, in: .rect(cornerRadius: 6))
                }
                .disabled(!canEdit)
            }
        } header: {
            Text("Seeded percentile brackets")
        } footer: {
            Text("An athlete's place ÷ the full field size (every school, every heat) picks the first bracket reached.")
        }
        .listRowBackground(Theme.surface)
        unseededSection
    }

    private var unseededTiers: [PercentileTier] {
        rules?.percentileUnseeded ?? [0.05, 0.1, 0.2, 0.3, 0.4].map { PercentileTier(pct: $0, pts: 0) }
    }

    private var unseededSection: some View {
        Section {
            ForEach(Array(unseededTiers.enumerated()), id: \.offset) { i, _ in
                HStack {
                    Text("Top")
                    TextField("%", value: unseededBinding(i, pct: true), format: .number)
                    .keyboardType(.numberPad).frame(width: 44).multilineTextAlignment(.center)
                    .background(Theme.surface2, in: .rect(cornerRadius: 6))
                    Text("% of unseeded section")
                    Spacer()
                    TextField("pts", value: unseededBinding(i, pct: false), format: .number)
                    .keyboardType(.decimalPad).frame(width: 52).multilineTextAlignment(.center)
                    .background(Theme.surface2, in: .rect(cornerRadius: 6))
                }
                .disabled(!canEdit)
            }
        } header: {
            Text("Unseeded section brackets")
        } footer: {
            Text("Only for athletes in an Unseeded section, ranked within that section. Seeded athletes use the brackets above.")
        }
        .listRowBackground(Theme.surface)
    }

    private func unseededBinding(_ i: Int, pct: Bool) -> Binding<Double> {
        Binding<Double>(
            get: {
                let list = unseededTiers
                guard i < list.count else { return 0 }
                return pct ? (list[i].pct * 100).rounded() : list[i].pts
            },
            set: { (v: Double) in
                guard var r = rules else { return }
                var list = unseededTiers
                guard i < list.count else { return }
                if pct { list[i].pct = max(1, min(100, v)) / 100 } else { list[i].pts = v }
                r.percentileUnseeded = list
                rules = r
            }
        )
    }

    @ViewBuilder
    private var previewSection: some View {
        if canEdit {
            Section {
                Button {
                    Task { await runPreview() }
                } label: {
                    Label(isPreviewing ? "Checking real results…" : "Preview change", systemImage: "eye")
                        .fontWeight(.bold)
                }
                .disabled(!changed || isPreviewing)
                if let p = preview {
                    if p.diff.isEmpty { Text("No change from the current version.").font(.caption).foregroundStyle(Theme.muted) }
                    ForEach(p.diff, id: \.key) { d in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(d.key).font(.caption.weight(.heavy)).foregroundStyle(Theme.muted)
                            Text("\(d.currentText)  →  \(d.nextText)").font(.caption.monospaced())
                        }
                    }
                    if let ex = p.example {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("REAL EXAMPLE").font(.system(size: 10, weight: .heavy)).foregroundStyle(Theme.gold)
                            Text("\(ex.name) · week \(ex.week)").font(.subheadline.weight(.semibold))
                            Text("Old score \(Fmt.short(ex.oldScore))  →  New score \(Fmt.short(ex.newScore))")
                                .font(.headline.monospacedDigit()).foregroundStyle(ex.newScore >= ex.oldScore ? Theme.green : Theme.red)
                        }
                    } else {
                        Text("No real result changes with this edit.").font(.caption).foregroundStyle(Theme.muted)
                    }
                    Text("\(p.athletesAffected) athlete-week\(p.athletesAffected == 1 ? "" : "s") affected · source: \(p.source)").font(.caption2).foregroundStyle(Theme.muted)
                    if !p.finishedWeeksProtected.isEmpty {
                        Text("Finished weeks \(p.finishedWeeksProtected.map(String.init).joined(separator: ", ")) keep their final scores.").font(.caption2).foregroundStyle(Theme.gold)
                    }
                    Button {
                        confirmPublish = true
                    } label: {
                        Text("Publish as scoring v\(p.currentVersion.scoring + 1)").fontWeight(.heavy).foregroundStyle(Theme.green)
                    }
                    .disabled(!p.ok || p.diff.isEmpty)
                }
                if changed {
                    Button("Discard changes", role: .destructive) { rules = original }
                }
            } header: {
                Text("Preview & publish")
            } footer: {
                Text("Nothing changes until you publish. Every version records who, when, old and new values.")
            }
            .listRowBackground(Theme.surface)
        }
    }

    // MARK: Admin draft → preview → publish

    @ViewBuilder
    private var adminSection: some View {
        Section {
            if let d = draftInfo {
                LabeledContent("Live now", value: d.current.label)
                if let saved = d.draft {
                    LabeledContent("Saved draft", value: "\(saved.by) · \(Date(timeIntervalSince1970: saved.at / 1000).formatted(date: .abbreviated, time: .shortened))")
                } else {
                    LabeledContent("Saved draft", value: "None")
                }
            }
            Button {
                Task { await saveDraft() }
            } label: {
                Label("Save draft", systemImage: "square.and.arrow.down").fontWeight(.bold)
            }
            .disabled(rules == nil || rules == savedDraft || adminBusy)
            Button {
                Task { await adminRunPreview() }
            } label: {
                Label(isPreviewing ? "Checking real results…" : "Preview against real meets", systemImage: "eye").fontWeight(.bold)
            }
            .disabled(!changed || isPreviewing || adminBusy)
            if let p = adminPreview {
                if p.diff.isEmpty { Text("No change from the live version.").font(.caption).foregroundStyle(Theme.muted) }
                ForEach(p.diff, id: \.key) { d in
                    HStack(alignment: .top) {
                        Text(d.key).font(.caption.weight(.heavy)).foregroundStyle(Theme.muted).frame(width: 92, alignment: .leading)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Live  \(d.currentText)").font(.caption.monospaced()).foregroundStyle(Theme.muted)
                            Text("Draft \(d.nextText)").font(.caption.monospaced().weight(.bold)).foregroundStyle(Theme.green)
                        }
                    }
                }
                if let ex = p.example {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("REAL EXAMPLE").font(.system(size: 10, weight: .heavy)).foregroundStyle(Theme.gold)
                        Text("\(ex.name) · week \(ex.week)").font(.subheadline.weight(.semibold))
                        Text("Old \(Fmt.short(ex.oldScore))  →  New \(Fmt.short(ex.newScore))")
                            .font(.headline.monospacedDigit()).foregroundStyle(ex.newScore >= ex.oldScore ? Theme.green : Theme.red)
                    }
                }
                Text("\(p.athletesAffected) athlete-week\(p.athletesAffected == 1 ? "" : "s") would change\(p.source.map { " · \($0)" } ?? "")").font(.caption2).foregroundStyle(Theme.muted)
                if !p.finishedWeeksProtected.isEmpty {
                    Text("Finished weeks \(p.finishedWeeksProtected.map(String.init).joined(separator: ", ")) stay frozen.").font(.caption2).foregroundStyle(Theme.gold)
                }
                if p.unchanged == true {
                    Label("Preview changed nothing (server verified)", systemImage: "checkmark.shield").font(.caption2).foregroundStyle(Theme.green)
                }
                Button {
                    typedConfirm = ""
                    showTypedConfirm = true
                } label: {
                    Text(admin?.isGlobal == true ? "Publish to every league…" : "Publish to this test league…").fontWeight(.heavy).foregroundStyle(Theme.green)
                }
                .disabled(!p.ok || p.diff.isEmpty || adminBusy)
            }
            if let m = serverMessage {
                Text(m).font(.caption.weight(.semibold)).foregroundStyle(Theme.gold)
            }
            if savedDraft != nil || changed {
                Button("Discard draft", role: .destructive) { Task { await discardDraft() } }
            }
        } header: {
            Text(admin?.isGlobal == true ? "Draft · global (all leagues)" : "Draft · test-league sandbox")
        } footer: {
            Text("Drafts are saved on the server and survive app restarts. Nothing goes live until you preview and type PUBLISH. Every draft, preview and publish is logged.")
        }
        .listRowBackground(Theme.surface)
    }

    private func loadDraft() async {
        guard let d = await store.tool(["op": "draftLoad"], as: AdminDraftBody.self) else { return }
        draftInfo = d
        original = d.current.rules
        savedDraft = d.draft?.rules
        if !changed || rules == nil { rules = d.draft?.rules ?? d.current.rules }
    }

    private func saveDraft() async {
        guard let r = rules, !adminBusy else { return }
        adminBusy = true
        defer { adminBusy = false }
        if let res = await store.tool(["op": "draftSave", "rules": encode(r)], as: AdminResult.self) {
            serverMessage = res.message
            savedDraft = r
            Haptics.success()
            await loadDraft()
        }
    }

    private func discardDraft() async {
        guard !adminBusy else { return }
        adminBusy = true
        defer { adminBusy = false }
        if let res = await store.tool(["op": "draftClear"], as: AdminResult.self) {
            serverMessage = res.message
            savedDraft = nil
            rules = original
            await loadDraft()
        }
    }

    private func adminRunPreview() async {
        guard let r = rules else { return }
        isPreviewing = true
        defer { isPreviewing = false }
        adminPreview = await store.tool(["op": "draftPreview", "rules": encode(r)], as: AdminPreview.self)
    }

    private func adminPublish() async {
        guard let r = rules, typedConfirm == "PUBLISH", !adminBusy else { return }
        adminBusy = true
        defer { adminBusy = false; typedConfirm = "" }
        if admin?.isGlobal == true {
            if await store.perform(["type": "updateScoring", "rules": encode(r)], success: "Server confirmed: new scoring version published to every league") {
                _ = await store.tool(["op": "draftClear"], as: AdminResult.self)
                serverMessage = "Published. Finished weeks keep their scores."
                adminPreview = nil
                await loadDraft()
            }
        } else {
            if let res = await store.tool(["op": "sandboxPublish", "rules": encode(r), "confirm": "PUBLISH", "requestId": requestId], as: AdminResult.self) {
                serverMessage = [res.message, res.finishedWeeksUnchanged == true ? "Finished weeks verified unchanged." : res.finishedWeeksUnchanged == false ? "Warning: finished-week fingerprint changed." : nil].compactMap { $0 }.joined(separator: " ")
                requestId = UUID().uuidString
                adminPreview = nil
                Haptics.success()
                await store.fetchLeague(force: true)
                await loadDraft()
            }
        }
    }

    // MARK: Actions

    private func runPreview() async {
        guard let r = rules else { return }
        isPreviewing = true
        defer { isPreviewing = false }
        preview = await store.tool(["op": "preview", "rules": encode(r)], as: ChangePreview.self)
    }

    private func publish() async {
        guard let r = rules else { return }
        if await store.perform(["type": "updateScoring", "rules": encode(r)], success: "New scoring version published to every league") {
            original = r
            preview = nil
        }
    }

    // MARK: Rows

    private func pointsRow(_ label: String, _ key: WritableKeyPath<GlobalScoringRules, Double>) -> some View {
        Stepper(value: Binding(get: { rules?[keyPath: key] ?? 0 }, set: { rules?[keyPath: key] = $0 }), in: -50...100, step: 0.5) {
            HStack {
                Text(label)
                Spacer()
                let v = rules?[keyPath: key] ?? 0
                Text(Fmt.signed(v)).font(.body.monospacedDigit().weight(.bold)).foregroundStyle(v < 0 ? Theme.red : Theme.green)
            }
        }
        .disabled(!canEdit)
    }

    private func listRow(_ label: String, _ key: WritableKeyPath<GlobalScoringRules, [Double]>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.subheadline)
            HStack(spacing: 6) {
                ForEach(Array((rules?[keyPath: key] ?? []).enumerated()), id: \.offset) { i, _ in
                    TextField("0", value: listBinding(key, i), format: .number)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.center)
                    .font(.subheadline.monospacedDigit().weight(.bold))
                    .frame(minWidth: 36, minHeight: 36)
                    .background(Theme.surface2, in: .rect(cornerRadius: 8))
                }
            }
        }
        .disabled(!canEdit)
    }

    private func listBinding(_ key: WritableKeyPath<GlobalScoringRules, [Double]>, _ i: Int) -> Binding<Double> {
        Binding<Double>(
            get: {
                let list: [Double] = rules?[keyPath: key] ?? []
                return i < list.count ? list[i] : 0
            },
            set: { (v: Double) in
                guard var r = rules else { return }
                var list: [Double] = r[keyPath: key]
                guard i < list.count else { return }
                list[i] = v
                r[keyPath: key] = list
                rules = r
            }
        )
    }

    private func pctBinding(_ i: Int) -> Binding<Double> {
        Binding<Double>(
            get: {
                guard let list = rules?.percentile, i < list.count else { return 0 }
                return (list[i].pct * 100).rounded()
            },
            set: { (v: Double) in
                guard var r = rules, i < r.percentile.count else { return }
                let clamped: Double = max(1, min(100, v))
                r.percentile[i].pct = clamped / 100
                rules = r
            }
        )
    }

    private func pctPointsBinding(_ i: Int) -> Binding<Double> {
        Binding<Double>(
            get: {
                guard let list = rules?.percentile, i < list.count else { return 0 }
                return list[i].pts
            },
            set: { (v: Double) in
                guard var r = rules, i < r.percentile.count else { return }
                r.percentile[i].pts = v
                rules = r
            }
        )
    }

    private func enabledBinding(_ code: String) -> Binding<Bool> {
        Binding(
            get: { rules?.enabled?[code] != false },
            set: { on in
                var e = rules?.enabled ?? [:]
                if on { e.removeValue(forKey: code) } else { e[code] = false }
                rules?.enabled = e
            }
        )
    }

    private func appliesOn(_ code: String, _ opt: String) -> Bool {
        guard let list = rules?.applies?[code], !list.isEmpty else { return true }
        let kinds = ["individual", "relay"], surfaces = ["track", "field"]
        if kinds.contains(opt) { return !list.contains(where: kinds.contains) || list.contains(opt) }
        return !list.contains(where: surfaces.contains) || list.contains(opt)
    }

    private func toggleApplies(_ code: String, _ opt: String) {
        let all = ScoringCategory.appliesOptions.map(\.code)
        var current = Set(all.filter { appliesOn(code, $0) })
        if current.contains(opt) { current.remove(opt) } else { current.insert(opt) }
        let group = ["individual", "relay"].contains(opt) ? ["individual", "relay"] : ["track", "field"]
        if !current.contains(where: group.contains) { Haptics.warning(); return }
        var a = rules?.applies ?? [:]
        if current.count == all.count { a.removeValue(forKey: code) } else { a[code] = all.filter(current.contains) }
        rules?.applies = a
    }

    private func encode<T: Encodable>(_ value: T) -> [String: Any] {
        guard let data = try? JSONEncoder().encode(value),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj
    }
}
