import SwiftUI

/// Commissioner editor for Fantasy T&F time/mark performance tables. Nothing is pre-filled: every threshold and
/// point value is the league's own. The server validates, normalizes and scores; the app only edits the table.
struct PerformanceTablesView: View {
    @Environment(AppStore.self) private var store
    @State private var data: ScoringData?
    @State private var gender: String = "B"
    @State private var season: Int = Calendar.current.component(.year, from: .now)
    @State private var editing: String?

    var body: some View {
        List {
            Section {
                Picker("Applies to", selection: $gender) {
                    Text("All").tag("X")
                    Text("Boys").tag("B")
                    Text("Girls").tag("G")
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(2026...2032, id: \.self) { y in
                            ChipButton(title: String(y), isOn: season == y) { season = y }
                        }
                    }
                }
                .listRowBackground(Color.clear)
                Stepper("Season: \(String(season))", value: $season, in: 2000...2100)
                    .listRowBackground(Theme.surface)
            } footer: {
                Text("The meet's date picks the season's table: a 2027 meet uses the 2027 table. Only the best tier an athlete reaches scores, separately for every event they enter. A season with no table earns no time/mark points.")
            }
            if store.league?.canEditGlobalSettings != true {
                Section { MainLeagueBanner(text: "Performance tables are the same in every league. Only the platform commissioner can change them.") }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            if let data {
                let events = data.performanceEvents ?? []
                let configured = events.filter { !tiers(data, $0.event).isEmpty }.count
                Section {
                    ForEach(events, id: \.event) { ev in
                        let rows = tiers(data, ev.event)
                        Button { if store.league?.canEditGlobalSettings == true { editing = ev.event } } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(ev.event).foregroundStyle(.white)
                                    Text(kindLabel(ev.measurement)).font(.caption2).foregroundStyle(Theme.faint)
                                }
                                Spacer()
                                if rows.isEmpty {
                                    Text("Not configured").font(.caption).foregroundStyle(Theme.gold)
                                } else {
                                    Text("\(rows.count) tier\(rows.count == 1 ? "" : "s") · top +\(Fmt.pts(rows.map(\.points).max() ?? 0))")
                                        .font(.caption.monospacedDigit()).foregroundStyle(Theme.green)
                                }
                            }
                        }
                        .listRowBackground(Theme.surface)
                    }
                } header: {
                    Text("\(configured) of \(events.count) configured")
                }
            } else {
                ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
            }
        }
        .screenBackground()
        .navigationTitle("Performance Tables")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: store.league?.version) {
            if data == nil { season = store.league?.season ?? season }
            data = await store.scoringData()
        }
        .sheet(item: Binding(get: { editing.map { IdentifiedString(value: $0) } }, set: { editing = $0?.value })) { item in
            PerformanceTableEditor(
                event: item.value,
                measurement: data?.performanceEvents?.first { $0.event == item.value }?.measurement ?? "TIME",
                gender: gender,
                season: season,
                existing: data.map { tiers($0, item.value) } ?? []
            ) {
                data = await store.scoringData()
            }
            .environment(store)
            .preferredColorScheme(.dark)
        }
    }

    private func tiers(_ data: ScoringData, _ event: String) -> [PerformanceTier] {
        (data.performance ?? [])
            .filter { $0.isCurrent && $0.gender == gender && $0.season == season && TextKey.of($0.event) == TextKey.of(event) }
            .sorted { $0.points > $1.points }
    }

    private func kindLabel(_ m: String?) -> String {
        switch m {
        case "HEIGHT": return "Height · higher is better"
        case "DISTANCE": return "Distance · farther is better"
        default: return "Time · faster is better"
        }
    }
}

private struct TierDraft: Identifiable, Hashable {
    let id: UUID = UUID()
    var mark: String
    var points: String
}

struct PerformanceTableEditor: View {
    let event: String
    let measurement: String
    let gender: String
    let season: Int
    let existing: [PerformanceTier]
    let onSaved: () async -> Void

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var rows: [TierDraft] = []
    @State private var problems: [String] = []
    @State private var preview: ChangePreview?

    var body: some View {
        NavigationStack {
            Form {
                if !problems.isEmpty {
                    Section {
                        ForEach(problems, id: \.self) { p in
                            Label(p, systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(Theme.red)
                        }
                    } header: { Text("Fix before saving") }
                }
                if let p = preview, p.ok {
                    Section {
                        if let ex = p.example {
                            Text("\(ex.name) · week \(ex.week): \(Fmt.short(ex.oldScore)) → \(Fmt.short(ex.newScore))").font(.subheadline.weight(.semibold))
                        } else {
                            Text("No real result changes with this table.").font(.caption).foregroundStyle(Theme.muted)
                        }
                        Text("\(p.athletesAffected) athlete-week(s) affected · next: tables v\(p.currentVersion.tables + 1)").font(.caption2).foregroundStyle(Theme.muted)
                    } header: { Text("Preview on real results") }
                }
                Section {
                    ForEach($rows) { $row in
                        HStack(spacing: 12) {
                            TextField(measurement == "TIME" ? "e.g. 55.50" : "e.g. 40-06", text: $row.mark)
                                .keyboardType(.numbersAndPunctuation)
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                            Text(measurement == "TIME" ? "or faster" : "or better").font(.caption).foregroundStyle(Theme.faint)
                            TextField("pts", text: $row.points)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .frame(width: 60)
                        }
                    }
                    .onDelete { rows.remove(atOffsets: $0) }
                    Button { rows.append(TierDraft(mark: "", points: "")) } label: { Label("Add tier", systemImage: "plus.circle.fill") }
                        .disabled(rows.count >= 12)
                } header: {
                    Text("\(gender == "X" ? "All" : gender == "G" ? "Girls" : "Boys") \(event) · \(String(season))")
                } footer: {
                    Text(measurement == "TIME"
                         ? "Times like 11.82, 55.42 or 2:04.15. Better (faster) tiers must be worth at least as many points."
                         : "Marks like 40-06, 40'6.5\", 19' 8.25\", 12.19m or 185cm. Better tiers must be worth at least as many points.")
                }
                if !existing.isEmpty {
                    Section {
                        Button("Clear this table", role: .destructive) { rows = [] }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle(event)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(preview?.ok == true ? "Publish" : "Check") { preview?.ok == true ? save() : check() }.fontWeight(.bold).disabled(store.isBusy)
                }
            }
            .onChange(of: rows) { _, _ in preview = nil }
            .onAppear {
                guard rows.isEmpty else { return }
                rows = existing.isEmpty ? [TierDraft(mark: "", points: "")] : existing.map { TierDraft(mark: $0.mark, points: Fmt.pts($0.points)) }
            }
        }
        .presentationDetents([.large])
    }

    private var tierPayload: [[String: Any]] {
        rows.filter { !$0.mark.trimmingCharacters(in: .whitespaces).isEmpty || !$0.points.trimmingCharacters(in: .whitespaces).isEmpty }
            .map { ["mark": $0.mark.trimmingCharacters(in: .whitespaces), "points": Double($0.points.replacingOccurrences(of: ",", with: ".")) ?? -1] }
    }

    /// Server-side validation + real-results preview. Nothing is saved.
    private func check() {
        Task {
            let p = await store.tool(["op": "preview", "table": ["event": event, "gender": gender, "season": season, "tiers": tierPayload]], as: ChangePreview.self)
            withAnimation(.snappy) {
                preview = p
                problems = p?.problems ?? []
            }
            if p?.ok == true { Haptics.success() } else { Haptics.warning() }
        }
    }

    private func save() {
        let filled = rows.filter { !$0.mark.trimmingCharacters(in: .whitespaces).isEmpty || !$0.points.trimmingCharacters(in: .whitespaces).isEmpty }
        let tiers: [[String: Any]] = filled.map { ["mark": $0.mark.trimmingCharacters(in: .whitespaces), "points": Double($0.points.replacingOccurrences(of: ",", with: ".")) ?? -1] }
        Task {
            let ok = await store.perform(["type": "setPerformanceTable", "event": event, "gender": gender, "season": season, "tiers": tiers], success: tiers.isEmpty ? "Table cleared" : "Table saved")
            if ok {
                await onSaved()
                dismiss()
            }
        }
    }
}
