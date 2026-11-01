import SwiftUI

nonisolated enum EventCatalog {
    static let fallback: [String] = [
        "55m", "60m", "100m", "200m", "300m", "400m", "500m", "600m", "800m", "1000m", "1500m", "1600m", "Mile", "3000m", "3200m", "2 Mile", "5000m",
        "55m Hurdles", "60m Hurdles", "100m Hurdles", "110m Hurdles", "300m Hurdles", "400m Hurdles", "2000m Steeplechase", "1500m Racewalk",
        "4x100 Relay", "4x200 Relay", "4x400 Relay", "4x800 Relay", "Sprint Medley Relay", "Distance Medley Relay", "Shuttle Hurdle Relay",
        "High Jump", "Pole Vault", "Long Jump", "Triple Jump", "Shot Put", "Discus", "Javelin", "Weight Throw", "Hammer",
        "Pentathlon", "Heptathlon", "Decathlon",
    ]

    static func isRelay(_ name: String) -> Bool { name.localizedCaseInsensitiveContains("relay") }
    static func isField(_ name: String) -> Bool {
        ["jump", "vault", "put", "discus", "javelin", "throw", "hammer"].contains { name.localizedCaseInsensitiveContains($0) }
    }

    static func iso(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 2026, c.month ?? 1, c.day ?? 1)
    }

    static func date(_ iso: String) -> Date {
        let p = iso.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return .now }
        return Calendar.current.date(from: DateComponents(year: p[0], month: p[1], day: p[2])) ?? .now
    }
}

// MARK: - Athlete picker

/// Searchable athlete picker used by commissioner forms.
struct AthletePickerSheet: View {
    let title: String
    let multiple: Bool
    @Binding var selection: [String]
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var query: String = ""

    var body: some View {
        NavigationStack {
            let trimmed = query.trimmingCharacters(in: .whitespaces)
            let list = (store.league?.athletes ?? [])
                .filter { trimmed.isEmpty || $0.name.localizedStandardContains(trimmed) }
                .sorted { $0.name < $1.name }
            List(list) { a in
                Button {
                    Haptics.tap()
                    if multiple {
                        if selection.contains(a.id) { selection.removeAll { $0 == a.id } } else if selection.count < 6 { selection.append(a.id) }
                    } else {
                        selection = [a.id]
                        dismiss()
                    }
                } label: {
                    HStack(spacing: 12) {
                        AthleteBadge(athlete: a, size: 34)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(a.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                            PosLabel(athlete: a, suffix: a.gender.label)
                        }
                        Spacer()
                        if selection.contains(a.id) {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.green)
                        }
                    }
                }
                .listRowBackground(Theme.surface)
            }
            .screenBackground()
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search athletes")
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationBackground(Theme.bg)
    }
}

/// Row that shows selected athlete(s) and opens the picker.
struct AthleteField: View {
    let label: String
    let multiple: Bool
    @Binding var selection: [String]
    @Environment(AppStore.self) private var store
    @State private var showPicker: Bool = false

    var body: some View {
        Button {
            showPicker = true
        } label: {
            HStack {
                Text(label).foregroundStyle(.white)
                Spacer()
                Text(selection.isEmpty ? "Choose" : selection.compactMap { store.athlete($0)?.name }.joined(separator: ", "))
                    .foregroundStyle(selection.isEmpty ? Theme.green : Theme.muted)
                    .lineLimit(2)
                    .multilineTextAlignment(.trailing)
                Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(Theme.faint)
            }
        }
        .sheet(isPresented: $showPicker) {
            AthletePickerSheet(title: label, multiple: multiple, selection: $selection)
                .environment(store)
                .preferredColorScheme(.dark)
        }
    }
}

struct EventPicker: View {
    @Binding var event: String
    let events: [String]

    var body: some View {
        Picker("Event", selection: $event) {
            Text("Choose").tag("")
            ForEach(events, id: \.self) { Text($0).tag($0) }
        }
    }
}

struct OptionalIntField: View {
    let label: String
    @Binding var text: String

    var body: some View {
        HStack {
            Text(label)
            Spacer()
            TextField("—", text: $text)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 90)
        }
    }
}

// MARK: - Enter result

struct ResultEntryView: View {
    let existing: ResultRecord?
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var loaded: Bool = false
    @State private var meet: String = ""
    @State private var date: Date = .now
    @State private var event: String = ""
    @State private var athletes: [String] = []
    @State private var mark: String = ""
    @State private var place: String = ""
    @State private var heatPlace: String = ""
    @State private var seeded: String = ""
    @State private var status: String = "OK"
    @State private var best: String = "auto"
    @State private var week: Int = 1
    @State private var events: [String] = EventCatalog.fallback
    @State private var preview: ResultPreview?
    @State private var isPreviewing: Bool = false

    private var isRelay: Bool { EventCatalog.isRelay(event) }

    var body: some View {
        Form {
            Section("Meet") {
                TextField("Meet name", text: $meet)
                DatePicker("Date", selection: $date, displayedComponents: .date)
                if let league = store.league, league.week > 1 {
                    Stepper("Fantasy week: \(week)", value: $week, in: 1...max(1, league.week))
                }
            }
            Section {
                EventPicker(event: $event, events: events)
                AthleteField(label: isRelay ? "Relay team" : "Athlete", multiple: isRelay, selection: $athletes)
                TextField(EventCatalog.isField(event) ? "Mark (e.g. 21-04.5 or 6.51m)" : "Mark (e.g. 11.24 or 4:32.10)", text: $mark)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            } header: {
                Text("Event")
            } footer: {
                if isRelay { Text("Pick up to 6 relay athletes. Every athlete on the relay gets the relay points.") }
            }
            Section {
                Picker("Status", selection: $status) {
                    Text("Finished").tag("OK")
                    Text("DQ").tag("DQ")
                    Text("DNF").tag("DNF")
                }
                .pickerStyle(.segmented)
                if status == "OK" {
                    OptionalIntField(label: isRelay ? "Relay place" : "Overall place", text: $place)
                    OptionalIntField(label: EventCatalog.isField(event) ? "Place in flight" : "Place in heat", text: $heatPlace)
                    OptionalIntField(label: "Seeded athletes", text: $seeded)
                    Picker("PB / SB", selection: $best) {
                        Text("Auto-check").tag("auto")
                        Text("Personal best").tag("PB")
                        Text("Season best").tag("SB")
                        Text("Neither").tag("none")
                    }
                }
            } header: {
                Text("Placing")
            } footer: {
                Text(status == "OK" ? "Auto-check compares the mark against marks on file and earlier results. Standards are checked against the Standards Table." : "DQ/DNF: participation \(Fmt.signed(store.league?.global?.rules.participation ?? 2)) and \(Fmt.signed(store.league?.global?.rules.dqdnf ?? -4)). No other bonuses.")
            }
            Section {
                Button {
                    runPreview()
                } label: {
                    HStack {
                        Label("Preview Points", systemImage: "eye")
                        Spacer()
                        if isPreviewing { ProgressView() }
                    }
                }
                .disabled(!isValid)
                if let preview {
                    ForEach(preview.lines) { line in
                        HStack {
                            Text(line.label).font(.subheadline)
                            if isRelay, let a = store.athlete(line.athleteId) {
                                Text(a.shortName).font(.caption).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            Text(Fmt.signed(line.points)).font(.subheadline.monospacedDigit().weight(.semibold))
                                .foregroundStyle(line.points < 0 ? Theme.red : .white)
                        }
                    }
                    HStack {
                        Text("Total").font(.headline)
                        Spacer()
                        Text(Fmt.pts(preview.total)).font(Theme.score(22)).foregroundStyle(Theme.green)
                    }
                }
            } header: {
                Text("Preview")
            }
            Section {
                PrimaryButton(title: existing == nil ? "Save Result" : "Save Correction", systemImage: "checkmark", isLoading: store.isBusy) { save() }
                    .disabled(!isValid)
                    .opacity(isValid ? 1 : 0.45)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            } footer: {
                Text("Saving the same meet, event and athlete again replaces the earlier points — never double counts.")
            }
        }
        .screenBackground()
        .navigationTitle(existing == nil ? "Enter Result" : "Edit Result")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: event) { _, newValue in
            if !EventCatalog.isRelay(newValue), athletes.count > 1 { athletes = Array(athletes.prefix(1)) }
            preview = nil
        }
        .onChange(of: formSignature) { _, _ in preview = nil }
        .task { await load() }
    }

    private var isValid: Bool {
        !meet.trimmingCharacters(in: .whitespaces).isEmpty && !event.isEmpty && !athletes.isEmpty
    }

    private var formSignature: String {
        [meet, EventCatalog.iso(date), event, athletes.joined(separator: ","), mark, place, heatPlace, seeded, status, best, "\(week)"].joined(separator: "|")
    }

    private func payload() -> [String: Any] {
        var b: [String: Any] = [
            "meet": meet.trimmingCharacters(in: .whitespaces),
            "date": EventCatalog.iso(date),
            "event": event,
            "athleteIds": athletes,
            "relay": isRelay,
            "mark": mark.trimmingCharacters(in: .whitespaces),
            "status": status,
            "best": best,
            "week": week,
            "source": "form",
        ]
        if status == "OK" {
            if let v = Int(place) { b["place"] = v }
            if let v = Int(heatPlace) { b["heatPlace"] = v }
            if let v = Int(seeded) { b["seeded"] = v }
        }
        if let existing { b["resultId"] = existing.id }
        return b
    }

    private func runPreview() {
        isPreviewing = true
        Task {
            preview = await store.previewResult(payload())
            isPreviewing = false
        }
    }

    private func save() {
        var b = payload()
        b["type"] = "enterResult"
        Task {
            if await store.perform(b, success: existing == nil ? "Result saved" : "Result corrected") {
                if existing != nil {
                    dismiss()
                } else {
                    athletes = []
                    mark = ""
                    place = ""
                    heatPlace = ""
                    preview = nil
                    best = "auto"
                    status = "OK"
                }
            }
        }
    }

    private func load() async {
        guard !loaded else { return }
        loaded = true
        week = store.league?.week ?? 1
        if let e = existing {
            meet = e.meet
            date = EventCatalog.date(e.date)
            event = e.event
            athletes = e.athleteIds
            mark = e.mark
            place = e.place.map(String.init) ?? ""
            heatPlace = e.heatPlace.map(String.init) ?? ""
            seeded = e.seeded.map(String.init) ?? ""
            status = e.status
            best = e.best
            week = e.week
        }
        if let data = await store.scoringData(), !data.events.isEmpty {
            events = data.events
            if !event.isEmpty, !events.contains(event) { events.append(event) }
        }
    }
}

// MARK: - Results log

struct ResultsLogView: View {
    @Environment(AppStore.self) private var store
    @State private var data: ScoringData?
    @State private var deleteTarget: ResultRecord?
    @State private var correcting: ResultRecord?

    var body: some View {
        List {
            if let data {
                if data.results.isEmpty && data.records.isEmpty && data.fumbles.isEmpty {
                    EmptyStateView(icon: "list.bullet.rectangle", title: "No results yet", message: "Results you enter show here so you can fix or remove them.")
                        .listRowBackground(Color.clear)
                }
                let live = data.results.filter { $0.isLive && $0.historyOnly != true }
                let manual = data.results.filter { !$0.isLive }
                if !live.isEmpty {
                    Section {
                        ForEach(live) { r in
                            Button { correcting = r } label: { resultRow(r) }
                                .listRowBackground(Theme.surface)
                        }
                    } header: {
                        Text("Live Results")
                    } footer: {
                        Text("From the live source. Tap to correct a place, mark or DQ/DNF. Corrected results are locked so later syncs don't overwrite them.")
                    }
                }
                if !manual.isEmpty {
                    Section("Manual Results") {
                        ForEach(manual) { r in
                            NavigationLink(value: LeagueRoute.enterResult(r)) { resultRow(r) }
                                .swipeActions {
                                    Button("Delete", role: .destructive) { deleteTarget = r }
                                }
                                .listRowBackground(Theme.surface)
                        }
                    }
                }
                if !data.records.isEmpty {
                    Section("School Records") {
                        ForEach(data.records) { rec in
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(store.athlete(rec.athleteId)?.name ?? rec.athleteId) • \(rec.event)").font(.subheadline.weight(.semibold))
                                Text("\(rec.school.isEmpty ? "" : "\(rec.school) • ")\(rec.mark) • \(String(rec.season))").font(.caption).foregroundStyle(Theme.muted)
                            }
                            .swipeActions {
                                Button("Delete", role: .destructive) {
                                    Task { await store.perform(["type": "deleteSchoolRecord", "id": rec.id], success: "Removed"); await reload() }
                                }
                            }
                            .listRowBackground(Theme.surface)
                        }
                    }
                }
                if !data.fumbles.isEmpty {
                    Section("Baton Fumbles") {
                        ForEach(data.fumbles) { f in
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(store.athlete(f.athleteId)?.name ?? f.athleteId) • \(f.event)").font(.subheadline.weight(.semibold))
                                Text("\(f.meet) • \(Fmt.isoDay(f.date))").font(.caption).foregroundStyle(Theme.muted)
                            }
                            .swipeActions {
                                Button("Delete", role: .destructive) {
                                    Task { await store.perform(["type": "deleteFumble", "id": f.id], success: "Removed"); await reload() }
                                }
                            }
                            .listRowBackground(Theme.surface)
                        }
                    }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
            }
        }
        .screenBackground()
        .navigationTitle("Results Log")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: store.league?.version) { await reload() }
        .refreshable { await reload() }
        .sheet(item: $correcting) { r in
            CorrectResultSheet(result: r) { Task { await reload() } }
                .environment(store)
                .preferredColorScheme(.dark)
        }
        .confirmationDialog("Delete this result?", isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } }), titleVisibility: .visible) {
            Button("Delete Result", role: .destructive) {
                guard let r = deleteTarget else { return }
                Task { await store.perform(["type": "deleteResult", "resultId": r.id], success: "Result removed"); await reload() }
            }
        } message: {
            Text("All points from it are removed.")
        }
    }

    private func reload() async { data = await store.scoringData() }

    private func resultRow(_ r: ResultRecord) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(r.athleteIds.compactMap { store.athlete($0)?.shortName }.joined(separator: ", "))
                    .font(.system(size: 15, weight: .heavy).width(.condensed))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                if r.locked == true {
                    Image(systemName: "lock.fill").font(.caption2).foregroundStyle(Theme.gold)
                }
                if r.provisional == true { LiveStatusPill(status: "LIVE", compact: true) }
                Spacer()
                Text(r.status != "OK" ? r.status : r.place.map { ordinal($0) } ?? "")
                    .font(.caption.weight(.heavy))
                    .foregroundStyle(r.status != "OK" ? Theme.red : Theme.green)
            }
            Text("\(r.event) • \(r.mark.isEmpty ? "no mark" : r.mark)").font(.subheadline).foregroundStyle(.white)
            Text("\(r.meet) • \(Fmt.isoDay(r.date)) • Wk \(r.week)").font(.caption).foregroundStyle(Theme.muted)
        }
    }

    private func ordinal(_ n: Int) -> String {
        let suffix: String
        switch (n % 100, n % 10) {
        case (11...13, _): suffix = "th"
        case (_, 1): suffix = "st"
        case (_, 2): suffix = "nd"
        case (_, 3): suffix = "rd"
        default: suffix = "th"
        }
        return "\(n)\(suffix)"
    }
}

// MARK: - Correct live result

/// Commissioner correction for a live-source result. Audited server-side and locked against later syncs.
struct CorrectResultSheet: View {
    let result: ResultRecord
    let onDone: () -> Void
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var status: String = "OK"
    @State private var mark: String = ""
    @State private var place: String = ""
    @State private var heatPlace: String = ""
    @State private var seeded: String = ""
    @State private var best: String = "auto"

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(result.athleteIds.compactMap { store.athlete($0)?.name }.joined(separator: ", ")).font(.headline)
                    Text("\(result.event) • \(result.meet)").foregroundStyle(Theme.muted)
                    if let d = result.detail, !d.isEmpty { Text(d).font(.caption).foregroundStyle(Theme.muted) }
                }
                Section("Correction") {
                    Picker("Status", selection: $status) {
                        Text("Finished").tag("OK")
                        Text("DQ").tag("DQ")
                        Text("DNF").tag("DNF")
                    }
                    .pickerStyle(.segmented)
                    TextField("Mark", text: $mark).autocorrectionDisabled().textInputAutocapitalization(.never)
                    if status == "OK" {
                        OptionalIntField(label: result.relay ? "Relay place" : "Overall place", text: $place)
                        OptionalIntField(label: "Place in heat/flight", text: $heatPlace)
                        OptionalIntField(label: "Seeded athletes", text: $seeded)
                        Picker("PB / SB", selection: $best) {
                            Text("Auto-check").tag("auto")
                            Text("Personal best").tag("PB")
                            Text("Season best").tag("SB")
                            Text("Neither").tag("none")
                        }
                    }
                }
                if result.locked == true {
                    Section {
                        Button("Return Control to Live Source") {
                            Task {
                                if await store.perform(["type": "unlockResult", "resultId": result.id], success: "Live source restored") { onDone(); dismiss() }
                            }
                        }
                    } footer: {
                        Text("Undoes your correction the next time results are checked.")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle("Correct Result")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.fontWeight(.bold).disabled(store.isBusy)
                }
            }
            .onAppear {
                status = result.status
                mark = result.mark
                place = result.place.map(String.init) ?? ""
                heatPlace = result.heatPlace.map(String.init) ?? ""
                seeded = result.seeded.map(String.init) ?? ""
                best = result.best
            }
        }
        .presentationDetents([.large])
    }

    private func save() {
        let body: [String: Any] = [
            "type": "correctResult", "resultId": result.id, "status": status, "mark": mark,
            "place": Int(place) as Any? ?? NSNull(), "heatPlace": Int(heatPlace) as Any? ?? NSNull(),
            "seeded": Int(seeded) as Any? ?? NSNull(), "best": best,
        ]
        Task {
            if await store.perform(body, success: "Correction saved") { onDone(); dismiss() }
        }
    }
}

// MARK: - Standards

/// Configurable ScoringStandard table: NB / Nike / States marks per gender + event for a season. Nothing is pre-filled.
struct StandardsView: View {
    @Environment(AppStore.self) private var store
    @State private var data: ScoringData?
    @State private var gender: Gender = .B
    @State private var season: Int = Calendar.current.component(.year, from: .now)
    @State private var editing: String?
    @State private var nb: String = ""
    @State private var nike: String = ""
    @State private var states: String = ""

    var body: some View {
        List {
            Section {
                Picker("Gender", selection: $gender) {
                    Text("Boys").tag(Gender.B)
                    Text("Girls").tag(Gender.G)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                Stepper("Season: \(String(season))", value: $season, in: 2000...2100)
                    .listRowBackground(Theme.surface)
            } footer: {
                Text("Official qualifying marks for every league. Only the highest standard counts, up to the season cap per athlete; moving up awards just the difference.")
            }
            if store.league?.canEditGlobalSettings != true {
                Section { MainLeagueBanner(text: "Standards are the same in every league. Only the platform commissioner can change them.") }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            if let data {
                Section("Events") {
                    ForEach(data.events.isEmpty ? EventCatalog.fallback : data.events, id: \.self) { ev in
                        let rows = rowsFor(data, ev)
                        Button {
                            nb = rows.first { $0.type == "NB" }?.mark ?? ""
                            nike = rows.first { $0.type == "NIKE" }?.mark ?? ""
                            states = rows.first { $0.type == "STATES" }?.mark ?? ""
                            if store.league?.canEditGlobalSettings == true { editing = ev }
                        } label: {
                            HStack {
                                Text(ev).foregroundStyle(.white)
                                Spacer()
                                if rows.isEmpty {
                                    Text("Not set").font(.caption).foregroundStyle(Theme.faint)
                                } else {
                                    Text(rows.map { "\(label($0.type)) \($0.mark)" }.joined(separator: " · "))
                                        .font(.caption.monospacedDigit())
                                        .foregroundStyle(rows.allSatisfy(\.active) ? Theme.green : Theme.muted)
                                        .lineLimit(1)
                                }
                            }
                        }
                        .listRowBackground(Theme.surface)
                    }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
            }
        }
        .screenBackground()
        .navigationTitle("Scoring Standards")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            season = store.league?.season ?? season
            data = await store.scoringData()
        }
        .sheet(item: Binding(get: { editing.map { IdentifiedString(value: $0) } }, set: { editing = $0?.value })) { item in
            NavigationStack {
                Form {
                    Section {
                        LabeledContent("States Super (+20)") { TextField("—", text: $states).multilineTextAlignment(.trailing) }
                        LabeledContent("New Balance Nationals (+15)") { TextField("—", text: $nb).multilineTextAlignment(.trailing) }
                        LabeledContent("Nike Nationals (+12)") { TextField("—", text: $nike).multilineTextAlignment(.trailing) }
                    } footer: {
                        Text(EventCatalog.isField(item.value) ? "Enter marks like 21-04.5 or 6.51m. Leave blank for none." : "Enter times like 10.85 or 4:12.30. Leave blank for none.")
                    }
                    if let data {
                        let rows = rowsFor(data, item.value)
                        if !rows.isEmpty {
                            Section("Active") {
                                ForEach(rows) { r in
                                    Toggle("\(label(r.type)) \(r.mark)", isOn: Binding(get: { r.active }, set: { on in
                                        Task {
                                            await store.perform(["type": "toggleStandard", "id": r.id, "active": on])
                                            self.data = await store.scoringData()
                                        }
                                    }))
                                }
                            }
                        }
                    }
                }
                .scrollContentBackground(.hidden)
                .background(Theme.bg)
                .navigationTitle("\(gender.label) \(item.value)")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { editing = nil } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") {
                            let ev = item.value
                            Task {
                                if await store.perform(["type": "setStandard", "event": ev, "gender": gender.rawValue, "season": season, "nb": nb, "nike": nike, "states": states], success: "Standards saved") {
                                    editing = nil
                                    data = await store.scoringData()
                                }
                            }
                        }
                        .fontWeight(.bold)
                    }
                }
            }
            .presentationDetents([.medium, .large])
            .preferredColorScheme(.dark)
        }
    }

    private func rowsFor(_ data: ScoringData, _ ev: String) -> [ScoringStandard] {
        let order = ["STATES", "NB", "NIKE"]
        return data.standards
            .filter { $0.gender == gender && $0.season == season && TextKey.of($0.event) == TextKey.of(ev) }
            .sorted { (order.firstIndex(of: $0.type) ?? 9) < (order.firstIndex(of: $1.type) ?? 9) }
    }

    private func label(_ type: String) -> String {
        switch type {
        case "STATES": return "SS"
        case "NIKE": return "Nike"
        default: return "NB"
        }
    }
}

struct IdentifiedString: Identifiable {
    let value: String
    var id: String { value }
}

// MARK: - School record

struct SchoolRecordForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var athletes: [String] = []
    @State private var school: String = ""
    @State private var event: String = ""
    @State private var date: Date = .now
    @State private var mark: String = ""
    @State private var season: Int = Calendar.current.component(.year, from: .now)

    var body: some View {
        Form {
            Section {
                AthleteField(label: "Athlete", multiple: false, selection: $athletes)
                TextField("School", text: $school)
                EventPicker(event: $event, events: EventCatalog.fallback)
                DatePicker("Date", selection: $date, displayedComponents: .date)
                TextField("Mark", text: $mark).autocorrectionDisabled()
                Stepper("Season: \(String(season))", value: $season, in: 2000...2100)
            } footer: {
                Text("+10 points. Limited to once per athlete, per event, per season.")
            }
            Section {
                PrimaryButton(title: "Add School Record", systemImage: "rosette", isLoading: store.isBusy) {
                    guard let aid = athletes.first else { return }
                    Task {
                        let ok = await store.perform([
                            "type": "addSchoolRecord", "athleteId": aid, "school": school, "event": event,
                            "date": EventCatalog.iso(date), "mark": mark, "season": season, "week": store.league?.week ?? 1,
                        ], success: "School record added (+10)")
                        if ok { dismiss() }
                    }
                }
                .disabled(athletes.isEmpty || event.isEmpty)
                .opacity(athletes.isEmpty || event.isEmpty ? 0.45 : 1)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
        }
        .screenBackground()
        .navigationTitle("Mark School Record")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { season = store.league?.season ?? season }
    }
}

// MARK: - Fumble

struct FumbleForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var athletes: [String] = []
    @State private var meet: String = ""
    @State private var event: String = "4x100 Relay"
    @State private var date: Date = .now
    @State private var teamId: String = ""

    var body: some View {
        Form {
            Section {
                TextField("Meet", text: $meet)
                Picker("Event", selection: $event) {
                    ForEach(EventCatalog.fallback.filter(EventCatalog.isRelay), id: \.self) { Text($0).tag($0) }
                }
                AthleteField(label: "Athlete", multiple: false, selection: $athletes)
                Picker("Fantasy team", selection: $teamId) {
                    Text("Current owner").tag("")
                    ForEach(store.league?.teams ?? []) { t in Text(t.teamName).tag(t.id) }
                }
                DatePicker("Date", selection: $date, displayedComponents: .date)
            } footer: {
                Text("−5 points to the athlete.")
            }
            Section {
                PrimaryButton(title: "Add Baton Fumble", systemImage: "exclamationmark.triangle", tint: Theme.red, isLoading: store.isBusy) {
                    guard let aid = athletes.first else { return }
                    Task {
                        let ok = await store.perform([
                            "type": "addFumble", "athleteId": aid, "meet": meet, "event": event,
                            "teamId": teamId, "date": EventCatalog.iso(date), "week": store.league?.week ?? 1,
                        ], success: "Baton fumble recorded (−5)")
                        if ok { dismiss() }
                    }
                }
                .disabled(athletes.isEmpty || meet.isEmpty)
                .opacity(athletes.isEmpty || meet.isEmpty ? 0.45 : 1)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
        }
        .screenBackground()
        .navigationTitle("Add Baton Fumble")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: athletes) { _, ids in
            if let id = ids.first, let owner = store.league?.owner(of: id) { teamId = owner.id }
        }
    }
}

// MARK: - Athlete editor

struct AthleteEditorView: View {
    @Environment(AppStore.self) private var store
    @State private var query: String = ""
    @State private var editing: Athlete?
    @State private var isAdding: Bool = false
    @State private var isImporting: Bool = false

    var body: some View {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        let list = (store.league?.athletes ?? []).filter { trimmed.isEmpty || $0.name.localizedStandardContains(trimmed) }.sorted { $0.name < $1.name }
        List {
            Section {
                ForEach(list) { a in
                    Button {
                        editing = a
                    } label: {
                        HStack(spacing: 12) {
                            AthleteBadge(athlete: a, size: 34)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(a.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                                PosLabel(athlete: a, suffix: [a.gender.label, a.school].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " • "))
                            }
                            Spacer()
                            if let owner = store.league?.owner(of: a.id) {
                                Text(owner.teamName).font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
                            }
                        }
                    }
                    .listRowBackground(Theme.surface)
                }
            } header: {
                if let league = store.league, league.ownsMeets {
                    Text("\(league.schoolName) players")
                }
            } footer: {
                if let league = store.league, league.ownsMeets {
                    Text("\(league.athletes.count) athletes. Player names and positions are shared by every league at \(league.schoolName). Removing a player only affects this league.")
                } else {
                    Text("\(store.league?.athletes.count ?? 0) athletes. Only you can see this editor.")
                }
            }
            if let league = store.league, league.ownsMeets, let removed = league.excludedAthletes, !removed.isEmpty, trimmed.isEmpty {
                Section {
                    ForEach(removed) { r in
                        HStack {
                            Text(r.name).foregroundStyle(Theme.muted)
                            Spacer()
                            Button("Add Back") {
                                Task { await store.perform(["type": "restoreAthlete", "athleteId": r.id], success: "\(r.name) is back in this league") }
                            }
                            .font(.subheadline.weight(.semibold))
                            .tint(Theme.green)
                            .disabled(store.isBusy)
                        }
                        .listRowBackground(Theme.surface)
                    }
                } header: {
                    Text("Removed from this league")
                } footer: {
                    Text("Other leagues at \(league.schoolName) still have these players.")
                }
            }
        }
        .screenBackground()
        .searchable(text: $query, prompt: "Search athletes")
        .navigationTitle("Athlete Editor")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if store.league?.ownsMeets == true {
                    Menu {
                        Button("Add One Player", systemImage: "person.badge.plus") { isAdding = true }
                        Button("Import Roster", systemImage: "list.bullet.clipboard") { isImporting = true }
                    } label: { Image(systemName: "plus") }
                    .accessibilityLabel("Add athletes")
                } else {
                    Button { isAdding = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Add athlete")
                }
            }
        }
        .sheet(isPresented: $isImporting) {
            RosterImportView().environment(store).preferredColorScheme(.dark)
        }
        .sheet(item: $editing) { a in
            AthleteFormSheet(athlete: a).environment(store).preferredColorScheme(.dark)
        }
        .sheet(isPresented: $isAdding) {
            AthleteFormSheet(athlete: nil).environment(store).preferredColorScheme(.dark)
        }
    }
}

struct AthleteFormSheet: View {
    let athlete: Athlete?
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var name: String = ""
    @State private var school: String = ""
    @State private var gender: Gender = .B
    @State private var pos: String = "SPR"
    @State private var confirmRemove: Bool = false

    /// Structured position codes (the server validates and stores these as a position set + flex flag).
    static let positionOptions: [(code: String, label: String)] = [
        ("SPR", "Sprinter"), ("SPR/DIS", "Sprinter/Distance"), ("SPR/FLD", "Sprinter/Field"),
        ("DIS", "Distance"), ("DIS/FLD", "Distance/Field"), ("FLD", "Field"), ("FLEX", "Flex"),
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Full name", text: $name)
                    if let league = store.league, league.ownsMeets {
                        LabeledContent("School", value: league.schoolName)
                    } else {
                        TextField("School (used for live result matching)", text: $school)
                    }
                    Picker("Gender", selection: $gender) {
                        Text("Boys").tag(Gender.B)
                        Text("Girls").tag(Gender.G)
                    }
                    .pickerStyle(.segmented)
                    Picker("Position", selection: $pos) {
                        ForEach(Self.positionOptions, id: \.code) { Text($0.label).tag($0.code) }
                    }
                } footer: {
                    Text("Position controls which lineup spots they can start in. Multi-position athletes can start in either spot. It never limits which events score, and past weeks aren't changed.")
                }
                if athlete != nil {
                    Section {
                        Button("Remove from Pool", role: .destructive) { confirmRemove = true }
                            .listRowBackground(Theme.surface)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle(athlete == nil ? "Add Athlete" : "Edit Athlete")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .fontWeight(.bold)
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || store.isBusy)
                }
            }
            .confirmationDialog("Remove \(athlete?.name ?? "")?", isPresented: $confirmRemove, titleVisibility: .visible) {
                Button("Remove", role: .destructive) {
                    guard let a = athlete else { return }
                    Task { if await store.perform(["type": "removeAthlete", "athleteId": a.id], success: "\(a.name) removed") { dismiss() } }
                }
            } message: {
                if store.league?.ownsMeets == true {
                    Text("They're removed from this league's player pool only. Players on a roster, already drafted or with points can't be removed.")
                } else {
                    Text("They'll be dropped from any roster and pending trades.")
                }
            }
            .onAppear {
                guard let a = athlete else { return }
                name = a.name
                school = a.school ?? ""
                gender = a.gender
                pos = a.posCode
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        let schoolValue = store.league?.ownsMeets == true ? (store.league?.schoolName ?? "") : school.trimmingCharacters(in: .whitespaces)
        var body: [String: Any] = ["name": trimmed, "school": schoolValue, "gender": gender.rawValue, "position": pos]
        if let a = athlete {
            body["type"] = "editAthlete"
            body["athleteId"] = a.id
            body["expectPosition"] = a.posCode
        } else {
            body["type"] = "addAthlete"
        }
        Task {
            if await store.perform(body, success: athlete == nil ? "\(trimmed) added" : "Saved") { dismiss() }
        }
    }
}
