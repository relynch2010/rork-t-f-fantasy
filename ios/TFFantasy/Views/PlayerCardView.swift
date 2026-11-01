import PhotosUI
import SwiftUI

enum PlayerCardTab: String, CaseIterable, Identifiable {
    case overview = "Overview"
    case log = "Meet Log"
    case weeks = "By Week"
    var id: String { rawValue }
}

/// Yahoo-style player card sheet: header, availability, key stats, tabs and a context action bar.
struct PlayerCardView: View {
    let athleteId: String
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var tab: PlayerCardTab = .overview
    @State private var lines: [ScoreLine] = []
    @State private var isLoading: Bool = true
    @State private var confirmDrop: Bool = false
    @State private var expanded: Set<String> = []
    @State private var showPhotoPicker: Bool = false
    @State private var photoItem: PhotosPickerItem?
    @State private var photoSource: PhotoSource?
    @State private var confirmRemovePhoto: Bool = false
    @State private var projection: AthleteProjectionBody?

    var body: some View {
        Group {
            if let league = store.league, let athlete = store.athlete(athleteId) {
                VStack(spacing: 0) {
                    ScrollView {
                        VStack(spacing: 0) {
                            header(league, athlete)
                            divider
                            availabilityRow(league)
                            divider
                            stats(league, athlete)
                            divider
                            tabs
                            tabContent(league)
                                .padding(.bottom, 24)
                        }
                    }
                    actionBar(league, athlete)
                }
                .background(Theme.surface)
            } else {
                EmptyStateView(icon: "person.crop.circle.badge.questionmark", title: "Athlete not found", message: "They may have been removed from the pool.")
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.surface)
        .task(id: store.league?.version) {
            lines = await store.lines(for: athleteId)
            isLoading = false
            if let league = store.league, league.phaseKind == .season || league.phaseKind == .complete {
                projection = await store.athleteProjection(athleteId, week: league.displayWeek)
            }
        }
        .confirmationDialog("Drop \(store.athlete(athleteId)?.name ?? "")?", isPresented: $confirmDrop, titleVisibility: .visible) {
            Button("Drop", role: .destructive) {
                Task {
                    if await store.perform(["type": "drop", "athleteId": athleteId], success: "Dropped \(store.athlete(athleteId)?.name ?? "")") { dismiss() }
                }
            }
        } message: {
            Text("They'll go on waivers for \(store.league?.settings.waiverDays ?? 0) days.")
        }
        .photosPicker(isPresented: $showPhotoPicker, selection: $photoItem, matching: .images)
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    photoSource = PhotoSource(data: data)
                } else {
                    store.errorMessage = "That photo couldn't be loaded. Try another one."
                }
                photoItem = nil
            }
        }
        .sheet(item: $photoSource) { src in
            if let a = store.athlete(athleteId) {
                HeadshotEditorView(athlete: a, source: src).environment(store).preferredColorScheme(.dark)
            }
        }
        .confirmationDialog("Remove \(store.athlete(athleteId)?.firstName ?? "")'s photo?", isPresented: $confirmRemovePhoto, titleVisibility: .visible) {
            Button("Remove Photo", role: .destructive) {
                guard let a = store.athlete(athleteId) else { return }
                Task { await store.saveAthletePhoto(athleteId: a.id, jpeg: nil, expectAt: a.photoAt) }
            }
        }
    }

    /// Headshot. Commissioners tap it to change the photo; everyone else just sees it.
    @ViewBuilder
    private func headshot(_ league: LeagueState, _ a: Athlete) -> some View {
        if league.canEditPlayers ?? league.isCommissioner {
            Menu {
                Button { showPhotoPicker = true } label: { Label(a.photo == nil ? "Add Photo" : "Change Photo", systemImage: "photo.on.rectangle") }
                Button {
                    if let data = UIPasteboard.general.image?.jpegData(compressionQuality: 0.95) {
                        photoSource = PhotoSource(data: data)
                    } else {
                        store.errorMessage = "There's no image on the clipboard."
                    }
                } label: { Label("Paste Photo", systemImage: "doc.on.clipboard") }
                if a.photo != nil {
                    Button(role: .destructive) { confirmRemovePhoto = true } label: { Label("Remove Photo", systemImage: "trash") }
                }
            } label: {
                AthleteBadge(athlete: a, size: 76)
                    .overlay(alignment: .bottomTrailing) {
                        Image(systemName: "camera.fill")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.black)
                            .frame(width: 24, height: 24)
                            .background(Theme.green, in: .circle)
                            .overlay(Circle().strokeBorder(Theme.surface, lineWidth: 2))
                    }
            }
            .accessibilityLabel("Edit \(a.name)'s photo")
        } else {
            AthleteBadge(athlete: a, size: 76)
        }
    }

    private var divider: some View { Rectangle().fill(Theme.line).frame(height: 1) }

    // MARK: Header

    private func header(_ league: LeagueState, _ a: Athlete) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .center, spacing: 8) {
                    Text(a.name)
                        .font(.system(size: 30, weight: .bold))
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                    StatusTag(status: a.playerStatus, size: 13)
                }
                Text([a.posLabel, a.gender.label, a.school ?? ""].filter { !$0.isEmpty }.joined(separator: " • "))
                    .font(.system(size: 16))
                    .foregroundStyle(Theme.muted)
                if a.playerStatus != .active {
                    Text("Status: \(a.playerStatus.label)")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(a.playerStatus == .Q ? Theme.gold : Theme.red)
                }
                if !(league.canEditPlayers ?? league.isCommissioner) {
                    Label("Photo, positions and status are set by the Main League", systemImage: "globe")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.faint)
                }
                if league.canEditPlayers ?? league.isCommissioner {
                    Menu {
                        Picker("Status", selection: Binding(
                            get: { a.playerStatus },
                            set: { next in
                                Task { await store.perform(["type": "setStatus", "athleteId": a.id, "status": next.rawValue], success: "\(a.firstName) is now \(next.label)") }
                            }
                        )) {
                            ForEach(PlayerStatus.allCases) { Text($0.label).tag($0) }
                        }
                    } label: {
                        Label("Set status", systemImage: "cross.case")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.green)
                            .frame(minHeight: 32)
                    }
                }
                if case .waivers(let until) = league.availability(a.id) {
                    Text("Off waivers \(Fmt.monthDay(until))")
                        .font(.system(size: 16))
                        .foregroundStyle(Theme.muted)
                }
                if !a.note.isEmpty {
                    Text(a.note).font(.system(size: 14)).foregroundStyle(Theme.faint)
                }
            }
            Spacer(minLength: 0)
            VStack(spacing: 10) {
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Close")
                headshot(league, a)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 14)
        .padding(.bottom, 16)
    }

    private func availabilityRow(_ league: LeagueState) -> some View {
        HStack {
            Text("League Availability").font(.system(size: 17))
            Spacer()
            switch league.availability(athleteId) {
            case .owned(let id):
                let t = league.team(id)
                HStack(spacing: 6) {
                    TeamLogo(team: t, size: 22)
                    Text(id == league.me ? "My Team" : t?.teamName ?? "")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(id == league.me ? Theme.green : .white)
                        .lineLimit(1)
                }
            case .waivers:
                Label("Waivers", systemImage: "plus").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.waiver)
            case .freeAgent:
                Label("Free Agent", systemImage: "plus").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.freeAgent)
            }
        }
        .padding(.horizontal, 20)
        .frame(minHeight: 56)
    }

    private func stats(_ league: LeagueState, _ a: Athlete) -> some View {
        let season = league.seasonPoints(a.id)
        let rank = league.rankMap[a.id]
        let lastWeek = league.points(a.id, week: league.displayWeek)
        return HStack(spacing: 0) {
            Button {
                store.sheet = .breakdown(a.id, nil)
            } label: {
                statCell(Fmt.pts(season), "Fan Points", underline: true)
            }
            .buttonStyle(.plain)
            statCell(rank.map { "#\($0)" } ?? "–", "Rank")
            Button {
                store.sheet = .breakdown(a.id, league.displayWeek)
            } label: {
                statCell(Fmt.pts(lastWeek), "\(league.weekLabel(league.displayWeek))", underline: true)
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 14)
    }

    private func statCell(_ value: String, _ label: String, underline: Bool = false) -> some View {
        VStack(spacing: 3) {
            Text(value)
                .font(.system(size: 18, weight: .medium).monospacedDigit())
                .underline(underline, color: .white.opacity(0.3))
            Text(label).font(.system(size: 15)).foregroundStyle(Theme.muted).lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .contentShape(.rect)
    }

    private var tabs: some View {
        HStack(spacing: 0) {
            ForEach(PlayerCardTab.allCases) { t in
                Button {
                    Haptics.tap()
                    withAnimation(.snappy) { tab = t }
                } label: {
                    VStack(spacing: 10) {
                        Text(t.rawValue)
                            .font(.system(size: 18, weight: tab == t ? .bold : .medium))
                            .foregroundStyle(tab == t ? .white : Theme.muted)
                        Capsule().fill(tab == t ? Theme.green : .clear).frame(width: 110, height: 4)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 14)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
        }
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    // MARK: Tabs

    @ViewBuilder
    private func tabContent(_ league: LeagueState) -> some View {
        if isLoading && lines.isEmpty {
            ProgressView().tint(Theme.green).padding(40)
        } else {
            switch tab {
            case .overview: overview(league)
            case .log: meetLog
            case .weeks: byWeek(league)
            }
        }
    }

    private func overview(_ league: LeagueState) -> some View {
        let meets = Set(lines.map { "\($0.date)|\($0.meet)" }).count
        let events = Set(lines.map(\.sourceId)).count
        let latest = groupedMeets.first
        return VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text(league.weekLabel(league.displayWeek)).font(.system(size: 17))
                Spacer()
                statusPill(league)
            }
            Text("\(meets) meet\(meets == 1 ? "" : "s") • \(events) scored event\(events == 1 ? "" : "s") this season")
                .font(.system(size: 15))
                .foregroundStyle(Theme.muted)
            Button {
                Haptics.tap()
                store.sheet = .weekProof(athleteId, league.displayWeek)
            } label: {
                Label("\(league.weekLabel(league.displayWeek)) proof: every event + weekly total", systemImage: "checkmark.seal")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(Theme.green.opacity(0.12), in: .rect(cornerRadius: 12))
                    .foregroundStyle(Theme.green)
            }
            .buttonStyle(.plain)
            if let pb = projection, let p = pb.projection {
                ProjectionPanel(projection: p, stale: pb.stale, weekLabel: league.weekLabel(pb.week), versions: pb.versions, computedAt: pb.computedAt)
                if p.available { ProjectionWhy(athleteId: athleteId, week: pb.week) }
            }
            if (league.reviewFlags?[athleteId] ?? 0) > 0 {
                HStack(alignment: .top, spacing: 10) {
                    ReviewMark()
                    Text("Needs review: a possible result for this player is waiting for the commissioner. It earns nothing until confirmed, and it's never assigned automatically.")
                        .font(.caption).foregroundStyle(Theme.muted)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.gold.opacity(0.1), in: .rect(cornerRadius: 12))
            }
            if let latest {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Latest meet").font(.system(size: 20, weight: .bold))
                    Text("\(Fmt.isoDay(latest.date)) | \(latest.meet)").font(.system(size: 14)).foregroundStyle(Theme.muted)
                    ForEach(latest.events, id: \.sourceId) { ev in
                        eventBlock(ev)
                    }
                }
                .padding(.top, 6)
            } else {
                Text("No results yet. Points appear here as soon as the commissioner posts a meet.")
                    .font(.system(size: 16))
                    .foregroundStyle(Theme.muted)
            }
        }
        .padding(20)
    }

    private func statusPill(_ league: LeagueState) -> some View {
        let owner = league.owner(of: athleteId)
        let slot = owner.flatMap { t in Slot.allCases.first { t.athlete(in: $0) == athleteId } }
        let text: String
        let color: Color
        if slot == .IR { text = "IR SPOT"; color = Theme.red }
        else if let slot, slot.isStarter { text = "STARTING"; color = Theme.green }
        else if slot != nil { text = "BENCH"; color = Theme.muted }
        else { text = "AVAILABLE"; color = Theme.gold }
        return Text(text)
            .font(.system(size: 12, weight: .heavy))
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(color.opacity(0.35), in: .capsule)
    }

    private var meetLog: some View {
        VStack(alignment: .leading, spacing: 18) {
            if groupedMeets.isEmpty {
                EmptyStateView(icon: "list.bullet.rectangle", title: "No meets yet", message: "Every event and scoring line will show here.")
            }
            ForEach(groupedMeets, id: \.id) { meet in
                let open = expanded.contains(meet.id)
                VStack(alignment: .leading, spacing: 8) {
                    Button {
                        Haptics.tap()
                        withAnimation(.snappy) {
                            if open { expanded.remove(meet.id) } else { expanded.insert(meet.id) }
                        }
                    } label: {
                        HStack(alignment: .center) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(meet.meet).font(.system(size: 18, weight: .bold)).multilineTextAlignment(.leading)
                                Text("\(Fmt.isoDay(meet.date)) • Week \(meet.week) • \(meet.events.count) event\(meet.events.count == 1 ? "" : "s")")
                                    .font(.system(size: 13)).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            Text("\(Fmt.short(meet.total)) pts").font(Theme.score(22))
                            Image(systemName: "chevron.down")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(Theme.faint)
                                .rotationEffect(.degrees(open ? 180 : 0))
                        }
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    if open {
                        ForEach(meet.events, id: \.sourceId) { ev in eventBlock(ev) }
                    }
                }
                .padding(12)
                .background(Theme.surface2.opacity(0.5), in: .rect(cornerRadius: 14))
            }
        }
        .padding(20)
    }

    private func eventBlock(_ ev: MeetEvent) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(ev.event).font(.system(size: 15, weight: .semibold))
                Spacer()
                Text(Fmt.signed(ev.total)).font(.system(size: 15, weight: .bold).monospacedDigit())
                    .foregroundStyle(ev.total < 0 ? Theme.red : Theme.green)
            }
            ForEach(ev.lines) { line in
                HStack {
                    Text(line.label).font(.system(size: 14)).foregroundStyle(Theme.muted)
                    Spacer()
                    Text(Fmt.signed(line.points)).font(.system(size: 14).monospacedDigit())
                        .foregroundStyle(line.points < 0 ? Theme.red : .white)
                }
            }
        }
        .padding(12)
        .background(Theme.surface2, in: .rect(cornerRadius: 12))
    }

    private func byWeek(_ league: LeagueState) -> some View {
        let maxWeek = max(1, min(league.week, max(league.totalWeeks, 1)))
        return VStack(spacing: 0) {
            ForEach(1...maxWeek, id: \.self) { w in
                let pts = league.points(athleteId, week: w)
                let owner = league.owner(of: athleteId)
                let started = owner.map { t in Slot.starters.contains { league.athleteId(teamId: t.id, week: w, slot: $0) == athleteId } } ?? false
                HStack {
                    Text(league.weekLabel(w)).font(.system(size: 16))
                    if started {
                        Text("START").font(.system(size: 10, weight: .heavy)).foregroundStyle(Theme.green)
                    }
                    Spacer()
                    PointsButton(athleteId: athleteId, value: pts, week: w, size: 18)
                }
                .padding(.horizontal, 20)
                RowDivider(inset: 20)
            }
            HStack {
                Text("Season").font(.system(size: 16, weight: .bold))
                Spacer()
                Text(Fmt.pts(league.seasonPoints(athleteId))).font(Theme.score(20))
            }
            .padding(20)
        }
    }

    // MARK: Actions

    @ViewBuilder
    private func actionBar(_ league: LeagueState, _ a: Athlete) -> some View {
        let availability = league.availability(a.id)
        let inSeason = league.phaseKind == .season
        HStack(spacing: 0) {
            switch availability {
            case .owned(let id) where id == league.me:
                barButton("Drop", "minus.circle", tint: Theme.red, enabled: inSeason) { confirmDrop = true }
                barDivider
                barButton("Breakdown", "list.bullet.rectangle", tint: .white) { store.sheet = .breakdown(a.id, nil) }
            case .owned(let id):
                barButton("Trade for", "arrow.left.arrow.right", tint: Theme.green, enabled: inSeason) {
                    store.sheet = .trade(toId: id, get: [a.id], counterOf: nil)
                }
                barDivider
                barButton("Breakdown", "list.bullet.rectangle", tint: .white) { store.sheet = .breakdown(a.id, nil) }
            case .waivers:
                barButton(league.settings.isFAAB ? "Bid" : "Claim", "plus.circle", tint: Theme.waiver, enabled: inSeason) {
                    store.sheet = .add(a.id)
                }
                barDivider
                barButton("Breakdown", "list.bullet.rectangle", tint: .white) { store.sheet = .breakdown(a.id, nil) }
            case .freeAgent:
                barButton("Add", "plus.circle", tint: Theme.freeAgent, enabled: inSeason) {
                    dismiss()
                    store.requestAdd(a.id)
                }
                barDivider
                barButton("Breakdown", "list.bullet.rectangle", tint: .white) { store.sheet = .breakdown(a.id, nil) }
            }
            if league.phaseKind == .predraft || league.phaseKind == .drafting, league.draft.picks.allSatisfy({ $0.athleteId != a.id }) {
                barDivider
                let queued = league.myTeam?.queue.contains(a.id) ?? false
                barButton(queued ? "Queued" : "Queue", queued ? "star.fill" : "star", tint: Theme.gold) {
                    var q = league.myTeam?.queue ?? []
                    if queued { q.removeAll { $0 == a.id } } else { q.append(a.id) }
                    Task { await store.perform(["type": "setQueue", "ids": q]) }
                }
            }
        }
        .frame(height: 76)
        .background(Theme.surface2)
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private var barDivider: some View { Rectangle().fill(Theme.line).frame(width: 1, height: 44) }

    private func barButton(_ title: String, _ icon: String, tint: Color, enabled: Bool = true, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            VStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 24))
                Text(title).font(.system(size: 15))
            }
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(.rect)
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
    }

    // MARK: Grouping

    private var groupedMeets: [MeetGroup] { MeetGroup.group(lines) }
}

/// One event's scoring lines within a meet.
struct MeetEvent: Hashable {
    let sourceId: String
    let event: String
    let lines: [ScoreLine]
    var total: Double { lines.reduce(0) { $0 + $1.points } }
}

/// Lines grouped by meet (newest first), then by event.
struct MeetGroup: Hashable {
    let id: String
    let meet: String
    let date: String
    let week: Int
    let events: [MeetEvent]
    var total: Double { events.reduce(0) { $0 + $1.total } }

    static func group(_ lines: [ScoreLine]) -> [MeetGroup] {
        let byMeet = Dictionary(grouping: lines) { "\($0.date)|\($0.meet)" }
        return byMeet.map { key, meetLines in
            let bySource = Dictionary(grouping: meetLines, by: \.sourceId)
            let events = bySource.map { sid, ls in MeetEvent(sourceId: sid, event: ls.first?.event ?? "", lines: ls) }
                .sorted { $0.event < $1.event }
            return MeetGroup(id: key, meet: meetLines.first?.meet ?? "", date: meetLines.first?.date ?? "", week: meetLines.first?.week ?? 0, events: events)
        }
        .sorted { $0.date > $1.date || ($0.date == $1.date && $0.meet < $1.meet) }
    }
}

/// Projected vs actual for one athlete. Every number comes from the server's scoring engine.
struct ProjectionPanel: View {
    let projection: PlayerProjection
    let stale: Bool
    let weekLabel: String
    var versions: String?
    var computedAt: Double?
    @State private var openEvent: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                ProjTag()
                Text(weekLabel.uppercased()).font(.system(size: 11, weight: .heavy)).tracking(0.8).foregroundStyle(Theme.muted)
                Spacer()
                if let c = projection.confidence {
                    Text("\(c.uppercased()) CONFIDENCE")
                        .font(.system(size: 10, weight: .heavy)).tracking(0.6)
                        .foregroundStyle(c == "High" ? Theme.green : c == "Medium" ? Theme.gold : Theme.muted)
                }
            }
            if !projection.available || (projection.total == 0 && ProjStateStyle.short(projection.state) != nil) {
                Text(projection.stateLabel ?? (projection.available ? ProjStateStyle.label(projection.state) : "Projection unavailable")).font(.headline)
                Text(projection.note).font(.caption).foregroundStyle(Theme.muted)
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 18) {
                    figure(Fmt.pts(projection.total), "PROJECTED TOTAL", dashed: true)
                    figure(Fmt.pts(projection.actual), "ACTUAL", dashed: false)
                    figure(Fmt.pts(projection.projected), "REMAINING", dashed: true)
                }
                if let up = projection.upside, up > projection.projected, projection.projected > 0 {
                    Text("Upside on a strong day: \(Fmt.pts(up)) · not part of the projection")
                        .font(.caption2.weight(.semibold)).foregroundStyle(Theme.faint)
                }
                VStack(spacing: 0) {
                    ForEach(projection.events, id: \.event) { e in
                        Button {
                            withAnimation(.snappy) { openEvent = openEvent == e.event ? nil : e.event }
                        } label: {
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(e.event).font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                                    Text(detail(e)).font(.caption).foregroundStyle(Theme.muted).lineLimit(2)
                                }
                                Spacer()
                                Text(e.status == "projected" ? "~\(Fmt.pts(e.points))" : Fmt.pts(e.points))
                                    .font(Theme.score(17))
                                    .foregroundStyle(e.status == "projected" ? Theme.muted : e.status == "done" ? Theme.faint : .white)
                            }
                            .padding(.vertical, 8)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        if openEvent == e.event { projDetail(e) }
                        if e.event != projection.events.last?.event { RowDivider(inset: 0) }
                    }
                }
                Text("Projected points never count in matchups, standings or history.\(versions.map { " · \($0)" } ?? "")\(computedAt.map { " · \(Fmt.dateTime($0))" } ?? "")")
                    .font(.caption2).foregroundStyle(Theme.faint)
                if stale {
                    Label("Live source is down. This is the last good projection and may be out of date.", systemImage: "wifi.exclamationmark")
                        .font(.caption).foregroundStyle(Theme.gold)
                }
            }
        }
        .padding(14)
        .background(Theme.raised.opacity(0.5), in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.muted.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
    }

    private func projDetail(_ e: ProjEvent) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let b = e.basis, !b.isEmpty {
                Text("IF THEY COMPETE AT THE PROJECTED MARK").font(.system(size: 9, weight: .heavy)).foregroundStyle(Theme.faint)
                ForEach(Array(b.enumerated()), id: \.offset) { _, l in
                    HStack { Text(l.label).font(.caption); Spacer(); Text(Fmt.signed(l.points)).font(.caption.monospacedDigit()) }
                }
                HStack { Text("Event if competing").font(.caption.weight(.semibold)); Spacer(); Text(Fmt.short(e.ifCompetes)).font(.caption.weight(.bold).monospacedDigit()) }
            }
            ForEach(e.assumptions ?? [], id: \.self) { a in
                Label(a, systemImage: "info.circle").font(.caption2).foregroundStyle(Theme.muted)
            }
            if let s = e.sources, !s.isEmpty {
                Text("Based on: " + s.prefix(4).map { "\($0.mark) (\($0.meet), \(Fmt.isoDay($0.date)))" }.joined(separator: "; "))
                    .font(.caption2).foregroundStyle(Theme.faint)
            }
        }
        .padding(.bottom, 8)
    }

    private func detail(_ e: ProjEvent) -> String {
        switch e.status {
        case "actual": return "ACTUAL • replaces the projection"
        case "live": return "LIVE • in progress"
        case "done": return "Didn't compete this week"
        default:
            var parts: [String] = []
            if let m = e.mark { parts.append("Proj \(m)") }
            parts.append("\(Int((e.probability * 100).rounded()))% to enter")
            if e.tableMissing { parts.append("no performance table") }
            return parts.joined(separator: " • ")
        }
    }

    private func figure(_ value: String, _ label: String, dashed: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(Theme.score(24)).foregroundStyle(dashed ? Theme.muted : .white)
            Text(label).font(.system(size: 9, weight: .heavy)).tracking(0.6).foregroundStyle(Theme.faint)
        }
    }
}

/// "Why this projection": plain-language reason from verified evidence only (AI-written when available).
struct ProjectionWhy: View {
    let athleteId: String
    let week: Int
    @Environment(AppStore.self) private var store
    @State private var text: ProjectionExplanation?
    @State private var isLoading: Bool = false
    @State private var showFacts: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let text {
                HStack(spacing: 6) {
                    Image(systemName: text.source == "ai" ? "sparkles" : "text.alignleft").foregroundStyle(Theme.gold)
                    Text("WHY THIS PROJECTION").font(.system(size: 10, weight: .heavy)).tracking(0.8).foregroundStyle(Theme.gold)
                    Spacer()
                    Button(showFacts ? "Hide evidence" : "Evidence") { withAnimation(.snappy) { showFacts.toggle() } }
                        .font(.caption.weight(.semibold)).foregroundStyle(Theme.green)
                }
                Text(text.text).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                if showFacts {
                    ForEach(text.facts, id: \.self) { f in
                        Label(f, systemImage: "checkmark.circle").font(.caption2).foregroundStyle(Theme.muted)
                    }
                }
                Text(text.source == "ai" ? "Written by AI from the verified facts above. A note, never a number." : "Summary of the verified facts.")
                    .font(.caption2).foregroundStyle(Theme.faint)
            } else {
                Button {
                    Task {
                        isLoading = true
                        text = await store.explainProjection(athleteId, week: week)
                        isLoading = false
                    }
                } label: {
                    HStack {
                        if isLoading { ProgressView().controlSize(.small) } else { Image(systemName: "sparkles") }
                        Text(isLoading ? "Reading their results…" : "Why this projection?")
                    }
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .foregroundStyle(Theme.gold)
                    .background(Theme.gold.opacity(0.1), in: .rect(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .disabled(isLoading)
            }
        }
        .animation(.snappy, value: text)
    }
}

/// "PROJ" tag so projected numbers never look like final points.
struct ProjTag: View {
    var body: some View {
        Text("PROJ")
            .font(.system(size: 10, weight: .black)).tracking(0.8)
            .lineLimit(1)
            .fixedSize()
            .foregroundStyle(Theme.muted)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .fixedSize()
            .overlay(Capsule().strokeBorder(Theme.muted, style: StrokeStyle(lineWidth: 1, dash: [3, 2])))
    }
}
