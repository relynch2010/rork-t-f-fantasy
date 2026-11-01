import SwiftUI

/// Mock drafts list: solo (vs bots) or league (members + bots). Fully separate from the real league.
struct MockDraftListView: View {
    @Environment(AppStore.self) private var store
    @State private var body_: MockBody?
    @State private var teams: Int = 8
    /// 0 = random draft position.
    @State private var position: Int = 0
    @State private var openId: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                banner
                VStack(alignment: .leading, spacing: 12) {
                    Stepper("Teams: \(teams)", value: $teams, in: 2...14)
                        .font(.subheadline.weight(.semibold))
                        .onChange(of: teams) { _, n in if position > n { position = n } }
                    DraftPositionPicker(position: $position, teams: teams)
                    HStack(spacing: 10) {
                        PrimaryButton(title: "Solo vs bots", systemImage: "cpu") { create("solo") }
                        SecondaryButton(title: "League mock", systemImage: "person.3.fill") { create("league") }
                    }
                }
                .card()

                let mocks = body_?.mocks ?? []
                if mocks.isEmpty {
                    EmptyStateView(icon: "timer", title: "No mock drafts yet", message: "Practice the six-round snake draft. Nothing you do here touches your real team.")
                } else {
                    VStack(spacing: 10) {
                        ForEach(mocks) { m in
                            Button { openId = m.id } label: { row(m) }
                                .buttonStyle(PressableStyle())
                        }
                    }
                }
            }
            .padding()
        }
        .background(TrackBackground())
        .navigationTitle("Mock Drafts")
        .navigationBarTitleDisplayMode(.inline)
        .task { body_ = await store.mock(nil) }
        .refreshable { body_ = await store.mock(nil) }
        .fullScreenCover(item: Binding(get: { openId.map { MockId(id: $0) } }, set: { openId = $0?.id })) { m in
            MockDraftRoomView(mockId: m.id).environment(store)
                .onDisappear { Task { body_ = await store.mock(nil) } }
        }
        .onAppear { teams = max(4, min(14, store.league?.teams.count ?? 8)) }
    }

    private var banner: some View {
        HStack(spacing: 10) {
            MockTag()
            Text("Practice only. Never affects real rosters, the real draft, standings or history.")
                .font(.caption).foregroundStyle(Theme.muted)
        }
    }

    private func row(_ m: MockSummary) -> some View {
        HStack(spacing: 12) {
            Image(systemName: m.kind == "solo" ? "cpu" : "person.3.fill")
                .foregroundStyle(.black)
                .frame(width: 40, height: 40)
                .background(Theme.flex, in: .rect(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 2) {
                Text(m.kind == "solo" ? "Solo mock" : "\(m.ownerName)'s league mock").font(.headline).foregroundStyle(.white)
                Text("\(m.seats) teams • \(m.joined) people • \(m.picks) picks • \(m.status.uppercased())")
                    .font(.caption).foregroundStyle(Theme.muted)
            }
            Spacer()
            Image(systemName: "chevron.right").foregroundStyle(Theme.faint)
        }
        .card(padding: 12)
    }

    private func create(_ kind: String) {
        Task {
            if let out = await store.mockOp(["op": "create", "kind": kind, "teams": teams, "position": position]) {
                body_ = out
                openId = out.mock?.id
            }
        }
    }
}

private struct MockId: Identifiable, Hashable { let id: String }

/// Horizontal chip row to choose a draft slot (Random, 1…N). Taken slots are dimmed.
struct DraftPositionPicker: View {
    @Binding var position: Int
    let teams: Int
    var taken: Set<Int> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Your draft position").font(.subheadline.weight(.semibold))
                Spacer()
                Text(position == 0 ? "Random" : "Pick #\(position)")
                    .font(.caption.weight(.heavy)).foregroundStyle(Theme.green)
                    .contentTransition(.numericText())
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    chip(0, label: "Random", icon: "shuffle")
                    ForEach(1...max(1, teams), id: \.self) { n in chip(n, label: "\(n)", icon: nil) }
                }
            }
            .scrollClipDisabled()
        }
        .sensoryFeedback(.selection, trigger: position)
    }

    private func chip(_ n: Int, label: String, icon: String?) -> some View {
        let selected = position == n
        let isTaken = n != 0 && taken.contains(n) && !selected
        return Button {
            withAnimation(.snappy) { position = n }
        } label: {
            HStack(spacing: 4) {
                if let icon { Image(systemName: icon).font(.caption.weight(.bold)) }
                Text(label).font(.subheadline.weight(.heavy)).monospacedDigit()
            }
            .frame(minWidth: 44, minHeight: 36)
            .padding(.horizontal, icon == nil ? 0 : 10)
            .foregroundStyle(selected ? .black : isTaken ? Theme.faint : .white)
            .background(selected ? Theme.green : Theme.surface, in: .capsule)
            .overlay(Capsule().strokeBorder(selected ? .clear : Color.white.opacity(0.12)))
        }
        .buttonStyle(PressableStyle())
        .disabled(isTaken)
        .accessibilityLabel(n == 0 ? "Random draft position" : "Draft position \(n)\(isTaken ? ", taken" : "")")
    }
}

struct MockTag: View {
    var body: some View {
        Text("MOCK")
            .font(.system(size: 11, weight: .black)).tracking(1)
            .foregroundStyle(.black)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Theme.flex, in: .capsule)
    }
}

/// Live mock draft room. The server runs the clock, bots and auto-picks; this screen only shows and submits picks.
struct MockDraftRoomView: View {
    let mockId: String
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var mock: MockDraft?
    @State private var serverOffset: Double = 0
    @State private var query: String = ""
    @State private var showBoard: Bool = false
    @State private var confirmDelete: Bool = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let mock {
                    clock(mock)
                    Picker("", selection: $showBoard) {
                        Text("Players").tag(false)
                        Text("Board").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                    if showBoard { board(mock) } else { players(mock) }
                } else {
                    ProgressView().tint(Theme.green).frame(maxHeight: .infinity)
                }
            }
            .background(TrackBackground())
            .navigationTitle("Mock Draft")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }.accessibilityLabel("Close")
                }
                ToolbarItem(placement: .principal) { MockTag() }
                if let mock {
                    ToolbarItem(placement: .primaryAction) { menu(mock) }
                }
            }
            .confirmationDialog("Delete this mock draft?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    Task { if await store.mockOp(["op": "delete", "mockId": mockId]) != nil { dismiss() } }
                }
            }
        }
        .preferredColorScheme(.dark)
        .task(id: store.mockSignal) { await refresh() }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(mock?.status == "live" ? 2 : 4))
                await refresh()
            }
        }
    }

    private func refresh() async {
        guard let out = await store.mock(mockId) else { return }
        serverOffset = out.serverNow - Date().timeIntervalSince1970 * 1000
        if let m = out.mock, m.version >= (mock?.version ?? -1) {
            withAnimation(.snappy) { mock = m }
        }
    }

    private func apply(_ out: MockBody?) {
        guard let m = out?.mock else { return }
        withAnimation(.snappy) { mock = m }
    }

    @ViewBuilder
    private func menu(_ m: MockDraft) -> some View {
        let isOwner = m.ownerId == (store.league?.viewerId ?? store.user?.id)
        Menu {
            if m.status == "lobby", isOwner {
                Button("Start Now (bots fill empty seats)", systemImage: "play.fill") { Task { apply(await store.mockOp(["op": "start", "mockId": mockId])) } }
            }
            if m.status == "lobby", m.mySeat == nil {
                Button("Join", systemImage: "person.badge.plus") { Task { apply(await store.mockOp(["op": "join", "mockId": mockId])) } }
            }
            if isOwner {
                Button("Restart", systemImage: "arrow.counterclockwise") { Task { apply(await store.mockOp(["op": "reset", "mockId": mockId])) } }
                Button("Delete", systemImage: "trash", role: .destructive) { confirmDelete = true }
            } else if m.mySeat != nil, m.status == "lobby" {
                Button("Leave", systemImage: "rectangle.portrait.and.arrow.right") { Task { apply(await store.mockOp(["op": "leave", "mockId": mockId])) } }
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
    }

    private func clock(_ m: MockDraft) -> some View {
        let onClock = m.seat(m.onClock)
        let mine = m.onClock != nil && m.onClock == m.mySeat
        return VStack(spacing: 8) {
            if m.status == "lobby" {
                Text("WAITING TO START").font(.system(size: 12, weight: .heavy)).tracking(1.2).foregroundStyle(Theme.gold)
                Text("\(m.seats.filter { !$0.bot }.count) of \(m.seats.count) seats taken").font(Theme.display(26))
                Text("Bots fill empty seats when the draft starts.").font(.caption).foregroundStyle(Theme.muted)
                if let seat = m.seat(m.mySeat) {
                    DraftPositionPicker(
                        position: Binding(
                            get: { seat.slot ?? 0 },
                            set: { n in Task { apply(await store.mockOp(["op": "setPosition", "mockId": mockId, "position": n])) } }
                        ),
                        teams: m.seats.count,
                        taken: Set(m.seats.filter { !$0.bot && $0.id != seat.id }.compactMap(\.slot))
                    )
                    .padding(.horizontal)
                }
                if m.mySeat == nil {
                    PrimaryButton(title: "Join this mock", systemImage: "person.badge.plus") {
                        Task { apply(await store.mockOp(["op": "join", "mockId": mockId])) }
                    }
                    .padding(.horizontal, 40)
                }
            } else if m.status == "done" {
                Text("MOCK COMPLETE").font(.system(size: 12, weight: .heavy)).tracking(1.2).foregroundStyle(Theme.green)
                Text("\(m.picks.count) picks").font(Theme.display(28))
            } else {
                if let my = m.mySeat, let idx = m.order.firstIndex(of: my) {
                    Text("YOU PICK #\(idx + 1) OF \(m.order.count)")
                        .font(.system(size: 11, weight: .heavy)).tracking(1).foregroundStyle(Theme.green)
                }
                if m.kind == "solo", m.picks.allSatisfy({ $0.seatId != m.mySeat }), let seat = m.seat(m.mySeat), m.picks.count < m.order.count {
                    DraftPositionPicker(
                        position: Binding(
                            get: { seat.slot ?? 0 },
                            set: { n in Task { apply(await store.mockOp(["op": "setPosition", "mockId": mockId, "position": n])) } }
                        ),
                        teams: m.seats.count
                    )
                    .padding(.horizontal)
                }
                Text("PICK \(m.picks.count + 1) OF \(m.totalPicks) • ROUND \(m.picks.count / max(1, m.order.count) + 1)")
                    .font(.system(size: 12, weight: .heavy)).tracking(1).foregroundStyle(Theme.muted)
                Text(mine ? "You're on the clock" : "\(onClock?.name ?? "") is picking")
                    .font(Theme.display(26))
                    .foregroundStyle(mine ? Theme.green : .white)
                if let deadline = m.deadline {
                    TimelineView(.periodic(from: .now, by: 1)) { _ in
                        let left = Int(max(0, deadline - (Date().timeIntervalSince1970 * 1000 + serverOffset)) / 1000)
                        Text(Fmt.clock(left))
                            .font(Theme.score(34))
                            .foregroundStyle(left <= 10 ? Theme.red : .white)
                            .contentTransition(.numericText())
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(Theme.surface)
    }

    private func players(_ m: MockDraft) -> some View {
        let taken = Set(m.picks.map(\.athleteId))
        let order = store.league?.adp ?? store.league?.athletes.map(\.id) ?? []
        let mine = m.onClock != nil && m.onClock == m.mySeat
        let list = order.compactMap { store.athlete($0) }
            .filter { !taken.contains($0.id) }
            .filter { query.isEmpty || $0.name.localizedStandardContains(query) }
            .prefix(120)
        return List {
            if let seat = m.mySeat {
                Section("My mock roster") {
                    let lineup = m.lineups[seat] ?? [:]
                    ForEach([Slot.SPR, .DIS, .FLD, .FLEX, .BN1, .BN2]) { slot in
                        HStack {
                            Text(slot.short).font(.caption.weight(.heavy)).foregroundStyle(Theme.muted).frame(width: 40, alignment: .leading)
                            Text(store.athlete((lineup[slot.rawValue] ?? nil))?.name ?? "—").font(.subheadline)
                        }
                        .listRowBackground(Theme.surface)
                    }
                }
            }
            Section("Available") {
                ForEach(Array(list)) { a in
                    HStack(spacing: 10) {
                        AthleteBadge(athlete: a, size: 36)
                        AthleteNameBlock(athlete: a, compact: true)
                        Spacer()
                        if mine {
                            Button("Draft") {
                                Task { apply(await store.mockOp(["op": "pick", "mockId": mockId, "athleteId": a.id, "pickNumber": m.picks.count + 1])) }
                            }
                            .font(.caption.weight(.heavy))
                            .buttonStyle(.borderedProminent)
                            .tint(Theme.green)
                            .foregroundStyle(.black)
                        }
                    }
                    .listRowBackground(Theme.surface)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .searchable(text: $query, prompt: "Search athletes")
    }

    private func board(_ m: MockDraft) -> some View {
        List {
            ForEach(m.picks.reversed(), id: \.overall) { p in
                HStack(spacing: 10) {
                    Text("\(p.round).\(p.pickInRound)").font(.caption.monospacedDigit().weight(.bold)).foregroundStyle(Theme.muted).frame(width: 40, alignment: .leading)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(store.athlete(p.athleteId)?.name ?? "").font(.subheadline.weight(.semibold))
                        Text("\(m.seat(p.seatId)?.name ?? "")\(p.auto ? " • auto" : "")")
                            .font(.caption).foregroundStyle(p.seatId == m.mySeat ? Theme.green : Theme.muted)
                    }
                }
                .listRowBackground(Theme.surface)
            }
        }
        .scrollContentBackground(.hidden)
    }
}
